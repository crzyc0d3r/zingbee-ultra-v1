"""Tests for the SessionEngine Vocabulary Bank derivation (ADO #25).

Covers: term surfacing as TEACH starts, the legacy semicolon-string fallback,
the enriched vocabulary_bank shape, status mapping (current/taught/mastered),
dedup across facts, assessment-phase definition masking, and serialize/restore
round-trip. No LLM or DB calls. Run with:
    pytest api/tests/test_session_engine_vocab_bank.py -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from session_engine import SessionEngine

DECISION_TREE = {"prompt_registry": {
    "step_teach": {"template": "[step_teach] vocab=$vocabulary"},
    "step_check": {"template": "[step_check]"},
}}
PERSONA = {"tutor_name": "Aris", "persona_description": "a helpful tutor",
           "persona_traits": ["patient"]}
CURRICULUM = {"subject": "Biology", "subject_lower": "biology",
              "age_range": "10-12", "phase": 1, "capsule_name": "Organisms"}

# f1 uses the legacy semicolon string (the real shape in production today);
# f2 carries an enriched vocabulary_bank; f3 shares a term with f1 (dedup);
# f4 is malformed on purpose.
FACTS = [
    {"id": "f1", "meta_data": {
        "core_fact": "Life processes show something is alive",
        "scaffold": ["TEACH", "TRY"],
        "vocabulary": "life process; living",
    }},
    {"id": "f2", "meta_data": {
        "core_fact": "Cells are the unit of life",
        "scaffold": ["TEACH", "TRY"],
        "vocabulary": "cell; membrane",  # legacy string also present
        "vocabulary_bank": [
            {"term": "cell", "definition": "The smallest unit of a living thing."},
            {"term": "membrane", "definition": "The thin layer around a cell."},
        ],
    }},
    {"id": "f3", "meta_data": {
        "core_fact": "All living things are organisms",
        "scaffold": ["TEACH", "TRY"],
        "vocabulary": "organism; Living",  # 'Living' dups f1's 'living' (case)
    }},
    {"id": "f4", "meta_data": {
        "core_fact": "Edge case fact",
        "scaffold": ["TEACH", "TRY"],
        "vocabulary": ["  ", {"definition": "no term"}, "valid_term"],
    }},
]


def make_engine(facts=FACTS):
    eng = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
    eng.init_session([dict(f) for f in facts], session_id="s1",
                     student_id="stu1", capsule_id="cap1")
    return eng


class TestEntryParsing(unittest.TestCase):
    def test_semicolon_string_splits_to_terms_without_definitions(self):
        out = SessionEngine._vocab_entries({"vocabulary": "life process; living"})
        self.assertEqual(out, [
            {"term": "life process", "definition": ""},
            {"term": "living", "definition": ""},
        ])

    def test_enriched_bank_preferred_over_legacy_string(self):
        out = SessionEngine._vocab_entries(FACTS[1]["meta_data"])
        self.assertEqual([e["term"] for e in out], ["cell", "membrane"])
        self.assertEqual(out[0]["definition"], "The smallest unit of a living thing.")

    def test_malformed_entries_skipped(self):
        out = SessionEngine._vocab_entries(FACTS[3]["meta_data"])
        self.assertEqual(out, [{"term": "valid_term", "definition": ""}])

    def test_missing_vocabulary_yields_empty(self):
        self.assertEqual(SessionEngine._vocab_entries({}), [])

    def test_non_string_term_coerced_not_crashing(self):
        # A bad import / hand-edit can leave a non-string term in JSONB; it must
        # not raise (which would kill the panel for the whole session).
        out = SessionEngine._vocab_entries({"vocabulary_bank": [
            {"term": 123, "definition": "numeric term"},
            {"term": "ok", "definition": 456},
        ]})
        self.assertEqual(out, [
            {"term": "123", "definition": "numeric term"},
            {"term": "ok", "definition": "456"},
        ])


class TestBankSurfacing(unittest.TestCase):
    def test_only_current_fact_terms_after_init(self):
        eng = make_engine()
        bank = eng.vocab_bank()
        self.assertEqual({t["term"] for t in bank}, {"life process", "living"})
        self.assertTrue(all(t["status"] == "current" for t in bank))
        self.assertTrue(all(t["fact_id"] == "f1" for t in bank))

    def test_current_fact_terms_listed_first(self):
        eng = make_engine()
        # Mark f1 taught, advance current to f2.
        eng.state["fact_statuses"]["f1"]["teach_complete"] = True
        eng.state["current_fact_index"] = 1
        bank = eng.vocab_bank()
        # f2 (current) terms must precede f1's.
        self.assertEqual(bank[0]["fact_id"], "f2")
        self.assertEqual(bank[0]["status"], "current")

    def test_grows_as_teach_progresses(self):
        eng = make_engine()
        eng.state["fact_statuses"]["f1"]["teach_complete"] = True
        eng.state["current_fact_index"] = 1  # f2 current
        terms = {t["term"] for t in eng.vocab_bank()}
        self.assertEqual(terms, {"life process", "living", "cell", "membrane"})

    def test_mastered_status_mapping(self):
        eng = make_engine()
        eng.state["fact_statuses"]["f1"]["final_status"] = "MASTERED"
        eng.state["current_fact_index"] = 1  # f2 current, f1 mastered
        by_fact = {t["fact_id"]: t["status"] for t in eng.vocab_bank()}
        self.assertEqual(by_fact["f1"], "mastered")
        self.assertEqual(by_fact["f2"], "current")

    def test_dedup_case_insensitive_first_wins(self):
        eng = make_engine()
        # Surface f1 (taught) and f3 (current) — 'living'/'Living' collide.
        eng.state["fact_statuses"]["f1"]["teach_complete"] = True
        eng.state["current_fact_index"] = 2  # f3 current
        terms = [t["term"] for t in eng.vocab_bank()]
        # only one 'living' variant; f1's lowercase 'living' wins (seen first
        # because f1 already taught, f3 surfaces too but dup is dropped)
        living_variants = [t for t in terms if t.lower() == "living"]
        self.assertEqual(len(living_variants), 1)

    def test_untaught_fact_excluded(self):
        eng = make_engine()
        bank = eng.vocab_bank()
        self.assertNotIn("cell", {t["term"] for t in bank})


class TestMasking(unittest.TestCase):
    def test_definitions_masked_in_evidence_collect_and_retry(self):
        for phase in ("COLLECT", "RETRY"):
            eng = make_engine([FACTS[1]])
            eng.state["current_phase"] = "EVIDENCE"
            eng.state["evidence_phase"] = phase
            self.assertTrue(eng.definitions_masked(), phase)
            self.assertTrue(all(t["definition"] == "" for t in eng.vocab_bank()))
            # terms still present (the cue stays, the answer doesn't)
            self.assertEqual({t["term"] for t in eng.vocab_bank()},
                             {"cell", "membrane"})

    def test_definitions_visible_in_evidence_remediation(self):
        eng = make_engine([FACTS[1]])
        eng.state["current_phase"] = "EVIDENCE"
        eng.state["evidence_phase"] = "REMEDIATION"
        self.assertFalse(eng.definitions_masked())
        self.assertEqual(eng.vocab_bank()[0]["definition"],
                         "The smallest unit of a living thing.")

    def test_definitions_visible_in_teach(self):
        eng = make_engine([FACTS[1]])
        self.assertFalse(eng.definitions_masked())
        self.assertTrue(eng.vocab_bank()[0]["definition"])


class TestRoundTrip(unittest.TestCase):
    def test_serialize_restore_yields_identical_bank(self):
        eng = make_engine()
        # f1 must be genuinely COMPLETE for the position to be legal —
        # v006.11 restore heals any position that sits past an incomplete
        # fact back to that fact, which would (correctly) change the bank.
        eng.state["fact_statuses"]["f1"]["teach_complete"] = True
        eng.state["fact_statuses"]["f1"]["scaffold_complete"] = True
        eng.state["current_fact_index"] = 1
        before = eng.vocab_bank()

        saved = eng.serialize()
        eng2 = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
        eng2.restore(saved)
        after = eng2.vocab_bank()

        self.assertEqual(before, after)

    def test_empty_state_returns_empty(self):
        eng = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
        self.assertEqual(eng.vocab_bank(), [])


if __name__ == "__main__":
    unittest.main()
