"""Tests for the ADO #26 engagement-quality follow-up.

Covers:
  A* — TEACH advancement signal fix + bounded diagnostic camp guard
  C* — deterministic, fact-anchored chip builder (rotation, no-repeat, ordering)
  D  — hint chip in TRY (offer gating + routing, no attempt increment, cap)

All behavior is behind feature flags, so each test sets the relevant env flag.
No LLM or DB calls. Run with:
    pytest api/tests/test_engagement_quality.py -v
"""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engagement
from session_engine import SessionEngine

# Registry includes every template the engine may render so render_prompt never
# returns "" mid-test and _unroutable_intents never excludes example/explore.
DECISION_TREE = {"prompt_registry": {
    "step_teach": {"template": "[teach] $core_fact"},
    "step_teach_confused": {"template": "[confused] $core_fact"},
    "step_teach_confirm": {"template": "[confirm] $core_fact"},
    "step_teach_reteach": {"template": "[reteach] $core_fact"},
    "step_teach_continue": {"template": "[continue] $core_fact"},
    "step_teach_example": {"template": "[example] $core_fact"},
    "step_teach_explore": {"template": "[explore] $stretch_questions"},
    "step_try": {"template": "[try] $core_fact"},
    "step_try_hint": {"template": "[hint #$hint_number] $core_fact"},
    "step_check": {"template": "[check]"},
    "step_evidence": {"template": "[evidence]"},
    "step_recall_engage": {"template": "[recall]"},
    "step_capsule_closure_recap": {"template": "[recap]"},
}}
PERSONA = {"tutor_name": "Aris", "persona_description": "a helpful tutor",
           "persona_traits": ["patient"]}
CURRICULUM = {"subject": "Biology", "age_range": "10-12", "phase": 1,
              "capsule_name": "Shapes"}
FACTS = [{"id": "f1", "meta_data": {
    "core_fact": "A triangle has three sides and three vertices",
    "scaffold": ["TEACH", "TRY"],
    "vocabulary": "vertex; side",
    "stretch_questions": ["Why can't a triangle have a curved side?"],
}}]


def make_engine():
    eng = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
    eng.init_session([dict(f) for f in FACTS], session_id="s1",
                     student_id="stu1", capsule_id="cap1")
    return eng


class _StubSession:
    """Minimal duck-typed session for resolve_for_session/match_for_session."""
    def __init__(self, engine):
        self._session_engine = engine
        self.logged = []

    def log_execution(self, event, details, agent=None):
        self.logged.append((event, details))


def _set(**flags):
    for k, v in flags.items():
        os.environ[k] = "1" if v else "0"


def _clear(*names):
    for n in names:
        os.environ.pop(n, None)


# ---------------------------------------------------------------------------
# A* — TEACH advancement signal
# ---------------------------------------------------------------------------
class TestTeachSignalFix(unittest.TestCase):
    def tearDown(self):
        _clear("TEACH_SIGNAL_FIX")

    def test_correct_answer_advances_when_flag_on(self):
        _set(TEACH_SIGNAL_FIX=True)
        eng = make_engine()
        self.assertEqual(eng.current_phase, "TEACH")
        res = eng.process_assessor_result("student_correct", student_message="three sides")
        self.assertTrue(res["state_changed"])
        self.assertEqual(eng.current_phase, "TRY")
        self.assertTrue(eng.fact_status("f1")["teach_complete"])

    def test_correct_answer_does_not_advance_when_flag_off(self):
        _set(TEACH_SIGNAL_FIX=False)
        eng = make_engine()
        eng.process_assessor_result("student_correct", student_message="three sides")
        self.assertEqual(eng.current_phase, "TEACH")
        self.assertFalse(eng.fact_status("f1")["teach_complete"])

    def test_bounded_guard_fires_checkpoint_then_guided_try(self):
        _set(TEACH_SIGNAL_FIX=True)
        eng = make_engine()
        # turn 1: substantive but non-advancing -> wait
        r1 = eng.process_assessor_result("teaching", student_message="um, sides?")
        self.assertEqual(r1["action"], "wait")
        # turn 2: second non-advancing -> diagnostic check-question
        r2 = eng.process_assessor_result("teaching", student_message="not sure")
        self.assertEqual(r2["action"], "teach_checkpoint")
        self.assertTrue(eng.fact_status("f1")["teach_checkpoint_done"])
        self.assertEqual(eng.current_phase, "TEACH")
        # turn 3: still not advancing -> guided TRY (never silently skip)
        r3 = eng.process_assessor_result("teaching", student_message="still nope")
        self.assertEqual(eng.current_phase, "TRY")
        self.assertEqual(r3["action"], "engagement_guided_try")

    def test_guard_silent_when_flag_off(self):
        _set(TEACH_SIGNAL_FIX=False)
        eng = make_engine()
        for _ in range(4):
            r = eng.process_assessor_result("teaching", student_message="hmm")
        self.assertEqual(eng.current_phase, "TEACH")
        self.assertEqual(r["action"], "wait")


# ---------------------------------------------------------------------------
# C* — deterministic fact-anchored chips
# ---------------------------------------------------------------------------
class TestDeterministicChips(unittest.TestCase):
    def test_chips_are_anchored_to_fact_topic(self):
        meta = {"core_fact": "A triangle has three sides", "vocabulary": "vertex; side"}
        chips = engagement.build_fact_chips("TEACH", None, meta, rotation_index=0)
        joined = " ".join(c["text"] for c in chips)
        # example/explore phrasing fills {topic} with the first vocab term
        self.assertIn("vertex", joined)
        self.assertGreaterEqual(len(chips), 2)

    def test_ordering_help_first_advance_last(self):
        meta = {"core_fact": "x", "vocabulary": "vertex"}
        chips = engagement.build_fact_chips("TEACH", None, meta, rotation_index=0)
        intents = [c["intent"] for c in chips]
        if "confused" in intents:
            self.assertEqual(intents[0], "confused")
        if "ready" in intents:
            self.assertEqual(intents[-1], "ready")

    def test_rotation_avoids_repeating_last_offered(self):
        meta = {"core_fact": "x", "vocabulary": "vertex"}
        first = engagement.build_fact_chips("TEACH", None, meta, 0)
        first_intents = [c["intent"] for c in first]
        second = engagement.build_fact_chips("TEACH", None, meta, 1,
                                             last_offered=first_intents)
        self.assertNotEqual([c["intent"] for c in second], first_intents)

    def test_exclude_drops_unroutable_intents(self):
        meta = {"core_fact": "x", "vocabulary": "vertex"}
        chips = engagement.build_fact_chips("TEACH", None, meta, 0,
                                            exclude={"example", "explore"})
        self.assertTrue(all(c["intent"] not in ("example", "explore") for c in chips))
        self.assertGreaterEqual(len(chips), 2)

    def test_resolve_for_session_teach_uses_builder(self):
        _set(ENGAGEMENT_DETERMINISTIC_CHIPS=True)
        try:
            eng = make_engine()
            sess = _StubSession(eng)
            tagged = engagement.resolve_for_session(sess, raw_suggestions=[])
            self.assertGreaterEqual(len(tagged), 2)
            self.assertTrue(all(c["intent"] for c in tagged))
            self.assertEqual(eng.state["last_offered_intents"],
                             [c["intent"] for c in tagged])
        finally:
            _clear("ENGAGEMENT_DETERMINISTIC_CHIPS")


# ---------------------------------------------------------------------------
# D — hint chip in TRY
# ---------------------------------------------------------------------------
class TestTryHint(unittest.TestCase):
    def tearDown(self):
        _clear("TRY_HINT", "ENGAGEMENT_DETERMINISTIC_CHIPS")

    def _engine_in_try(self):
        _set(TEACH_SIGNAL_FIX=True)
        eng = make_engine()
        eng.process_assessor_result("student_correct", student_message="ok")  # -> TRY
        _clear("TEACH_SIGNAL_FIX")
        self.assertEqual(eng.current_phase, "TRY")
        return eng

    def test_hint_chip_offered_only_after_an_attempt(self):
        _set(TRY_HINT=True, ENGAGEMENT_DETERMINISTIC_CHIPS=True)
        eng = self._engine_in_try()
        sess = _StubSession(eng)
        # no attempts yet -> no chip
        self.assertEqual(engagement.resolve_for_session(sess, []), [])
        # after one wrong attempt -> single hint chip
        eng.fact_status("f1")["try_attempts"] = 1
        chips = engagement.resolve_for_session(sess, [])
        self.assertEqual([c["intent"] for c in chips], ["hint"])

    def test_hint_routing_does_not_count_as_attempt_and_caps(self):
        _set(TRY_HINT=True)
        eng = self._engine_in_try()
        eng.fact_status("f1")["try_attempts"] = 1
        r1 = eng.process_assessor_result("student_wants_hint", student_message="hint")
        self.assertEqual(r1["action"], "try_hint")
        self.assertEqual(eng.fact_status("f1")["try_attempts"], 1)  # unchanged
        self.assertEqual(eng.fact_status("f1")["hints_given"], 1)
        self.assertEqual(eng.current_phase, "TRY")
        # second hint ok, third hits the cap
        eng.process_assessor_result("student_wants_hint", student_message="hint")
        r3 = eng.process_assessor_result("student_wants_hint", student_message="hint")
        self.assertEqual(r3["action"], "hint_cap_reached")
        self.assertEqual(eng.fact_status("f1")["hints_given"], 2)

    def test_hint_inert_when_flag_off(self):
        _set(TRY_HINT=False)
        eng = self._engine_in_try()
        eng.fact_status("f1")["try_attempts"] = 1
        r = eng.process_assessor_result("student_wants_hint", student_message="hint")
        self.assertEqual(r["action"], "wait")
        self.assertEqual(eng.fact_status("f1")["hints_given"], 0)


# Registry without step_try_hint — simulates code deployed before the prompt seed.
DECISION_TREE_NO_HINT = {"prompt_registry": {
    k: v for k, v in DECISION_TREE["prompt_registry"].items() if k != "step_try_hint"
}}


def make_engine_no_hint():
    eng = SessionEngine(DECISION_TREE_NO_HINT, PERSONA, CURRICULUM)
    eng.init_session([dict(f) for f in FACTS], session_id="s1",
                     student_id="stu1", capsule_id="cap1")
    return eng


# ---------------------------------------------------------------------------
# Pre-ship review critical fixes
# ---------------------------------------------------------------------------
class TestShipCheckFixes(unittest.TestCase):
    def tearDown(self):
        _clear("TEACH_SIGNAL_FIX", "TRY_HINT", "ENGAGEMENT_DETERMINISTIC_CHIPS")

    def test_correct_does_not_fast_track_during_evidence_remediation(self):
        # Critical #1: a correct answer during EVIDENCE remediation must NOT
        # _advance_scaffold (which could fast-track a failed fact to MASTERED).
        _set(TEACH_SIGNAL_FIX=True)
        eng = make_engine()
        eng.state["evidence_phase"] = "REMEDIATION"
        eng.state["current_phase"] = "TEACH"  # remediation reuses TEACH
        r = eng.process_assessor_result("student_correct", student_message="three sides")
        self.assertEqual(eng.current_phase, "TEACH")           # did not advance
        self.assertFalse(eng.fact_status("f1")["teach_complete"])
        self.assertEqual(r["action"], "wait")

    def test_hint_chip_withheld_when_template_missing(self):
        # Critical #2: no step_try_hint template -> chip must not be offered.
        _set(TRY_HINT=True, ENGAGEMENT_DETERMINISTIC_CHIPS=True, TEACH_SIGNAL_FIX=True)
        eng = make_engine_no_hint()
        eng.process_assessor_result("student_correct", student_message="ok")  # -> TRY
        self.assertEqual(eng.current_phase, "TRY")
        eng.fact_status("f1")["try_attempts"] = 1
        sess = _StubSession(eng)
        self.assertEqual(engagement.resolve_for_session(sess, []), [])

    def test_hint_route_does_not_burn_hint_when_template_missing(self):
        # Critical #2: clicking a (stale) hint with no template must not consume
        # a hint or claim a transition.
        _set(TRY_HINT=True, TEACH_SIGNAL_FIX=True)
        eng = make_engine_no_hint()
        eng.process_assessor_result("student_correct", student_message="ok")  # -> TRY
        eng.fact_status("f1")["try_attempts"] = 1
        r = eng.process_assessor_result("student_wants_hint", student_message="hint")
        self.assertEqual(r["action"], "hint_unavailable")
        self.assertEqual(eng.fact_status("f1")["hints_given"], 0)
        self.assertFalse(r["state_changed"])


class TestRobustness(unittest.TestCase):
    def tearDown(self):
        _clear("TEACH_SIGNAL_FIX", "TRY_HINT")

    def test_questions_do_not_trigger_camp_checkpoint(self):
        # H5: a curious learner asking questions must not be force-checkpointed.
        _set(TEACH_SIGNAL_FIX=True)
        eng = make_engine()
        for _ in range(4):
            r = eng.process_assessor_result("student_question", student_message="why?")
        self.assertEqual(eng.current_phase, "TEACH")
        self.assertEqual(r["action"], "wait")
        self.assertFalse(eng.fact_status("f1")["teach_checkpoint_done"])

    def test_fact_status_self_heals_missing_fid(self):
        # H8: a missing fact record must be created + persisted, not a throwaway.
        eng = make_engine()
        del eng.state["fact_statuses"]["f1"]
        fsd = eng.fact_status("f1")
        self.assertEqual(fsd["hints_given"], 0)
        fsd["hints_given"] += 1
        self.assertEqual(eng.fact_status("f1")["hints_given"], 1)  # persisted

    def test_restore_backfills_new_keys_on_legacy_blob(self):
        # H8: a pre-ADO-#26 serialized session must resume with all new keys.
        eng = make_engine()
        saved = eng.serialize()
        for fsd in saved["state"]["fact_statuses"].values():
            for k in ("teach_wait_turns", "teach_checkpoint_done", "hints_given",
                      "engagement_detours"):
                fsd.pop(k, None)
        saved["state"].pop("last_offered_intents", None)
        saved["state"].pop("chip_rotation_index", None)
        eng2 = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
        eng2.restore(saved)
        self.assertIn("last_offered_intents", eng2.state)
        self.assertIn("chip_rotation_index", eng2.state)
        fsd = eng2.fact_status("f1")
        self.assertEqual(fsd["teach_wait_turns"], 0)
        self.assertEqual(fsd["hints_given"], 0)


if __name__ == "__main__":
    unittest.main()
