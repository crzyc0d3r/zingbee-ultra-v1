"""Tests for api/engagement.py — conversational engagement prompts (ADO #26).

Covers intent-tag parsing, the curated fallback pool, deterministic chip
matching, and the intent→interaction map. No LLM or DB calls.
Run with: pytest api/tests/test_engagement.py -v
"""

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engagement
from classifier import classify_skip


# ---------------------------------------------------------------------------
# tag_suggestions — strips `intent:` prefixes, tolerates untagged lines
# ---------------------------------------------------------------------------

class TestTagSuggestions(unittest.TestCase):
    def test_valid_prefix_stripped_and_tagged(self):
        out = engagement.tag_suggestions(["example: Can we go through an example?"])
        self.assertEqual(out, [{"text": "Can we go through an example?", "intent": "example"}])

    def test_prefix_case_insensitive(self):
        out = engagement.tag_suggestions(["READY: Let me try it", "Confused: I'm lost"])
        self.assertEqual(out[0], {"text": "Let me try it", "intent": "ready"})
        self.assertEqual(out[1], {"text": "I'm lost", "intent": "confused"})

    def test_unprefixed_line_passes_through_untagged(self):
        out = engagement.tag_suggestions(["Tell me more about volcanoes"])
        self.assertEqual(out, [{"text": "Tell me more about volcanoes", "intent": None}])

    def test_unknown_prefix_not_treated_as_intent(self):
        # "banana:" is not in the intent vocabulary — line must pass through whole
        out = engagement.tag_suggestions(["banana: do the thing"])
        self.assertEqual(out, [{"text": "banana: do the thing", "intent": None}])

    def test_prefix_never_leaks_into_text(self):
        lines = [f"{i}: chip for {i}" for i in engagement.INTENTS]
        for item in engagement.tag_suggestions(lines):
            self.assertIsNotNone(item["intent"])
            self.assertNotIn(":", item["text"].split()[0])

    def test_empty_input(self):
        self.assertEqual(engagement.tag_suggestions([]), [])

    def test_whitespace_around_prefix_tolerated(self):
        out = engagement.tag_suggestions(["  explore :  What else can this do?  "])
        self.assertEqual(out, [{"text": "What else can this do?", "intent": "explore"}])


# ---------------------------------------------------------------------------
# fallback_suggestions — curated pool: variety, safety, ordering
# ---------------------------------------------------------------------------

KNOWN_KEYS = [
    ("TEACH", None),
    ("TEACH", "confused"),
    ("TEACH", "reteach"),
    ("TEACH", "example"),
    ("TEACH", "explore"),
    ("RECALL", None),
    ("CAPSULE_COMPLETE", None),
]


class TestFallbackSuggestions(unittest.TestCase):
    def _all_chips(self):
        """Every chip in every set of every pool (text mode + voice mode)."""
        chips = []
        for phase, ctx in KNOWN_KEYS:
            for seed in range(20):
                chips.extend(engagement.fallback_suggestions(
                    phase, ctx, rng=random.Random(seed)))
                chips.extend(engagement.fallback_suggestions(
                    phase, ctx, rng=random.Random(seed), voice=True))
        return chips

    def test_returns_two_or_three_tagged_chips(self):
        for phase, ctx in KNOWN_KEYS:
            out = engagement.fallback_suggestions(phase, ctx, rng=random.Random(1))
            self.assertTrue(2 <= len(out) <= 3, f"{phase}/{ctx}: {len(out)} chips")
            for item in out:
                self.assertIn(item["intent"], engagement.INTENTS,
                              f"{phase}/{ctx}: untagged fallback chip {item!r}")

    def test_unknown_phase_falls_back_to_teach_pool(self):
        out = engagement.fallback_suggestions("SOMETHING_NEW", None, rng=random.Random(1))
        self.assertTrue(2 <= len(out) <= 3)

    def test_variety_across_draws(self):
        seen = {tuple(c["text"] for c in engagement.fallback_suggestions(
            "TEACH", None, rng=random.Random(seed))) for seed in range(10)}
        self.assertGreaterEqual(len(seen), 2, "TEACH pool shows no variety across draws")

    def test_no_forbidden_moveon_substrings(self):
        # classifier.classify_skip line ~68 substring-matches these and would
        # mis-route an untagged chip as move_on
        forbidden = ("skip", "move on", "already know", "next fact")
        for chip in self._all_chips():
            lower = chip["text"].lower()
            for kw in forbidden:
                self.assertNotIn(kw, lower, f"chip {chip['text']!r} contains {kw!r}")

    def test_chips_never_skip_classified_as_move_on(self):
        # Cross-check against the REAL classifier, not a copied list
        for chip in self._all_chips():
            result = classify_skip(chip["text"])
            if result is not None:
                self.assertNotEqual(result["type"], "move_on",
                                    f"chip {chip['text']!r} skip-classifies as move_on")

    def test_chip_wording_max_twelve_words(self):
        for chip in self._all_chips():
            self.assertLessEqual(len(chip["text"].split()), 12,
                                 f"chip too long: {chip['text']!r}")

    def test_ordering_confused_first_ready_last(self):
        # Amendment 3: semantic position stability
        for phase, ctx in KNOWN_KEYS:
            for seed in range(10):
                out = engagement.fallback_suggestions(phase, ctx, rng=random.Random(seed))
                intents = [c["intent"] for c in out]
                if "confused" in intents:
                    self.assertEqual(intents[0], "confused",
                                     f"{phase}/{ctx} seed {seed}: confused not first: {intents}")
                if "ready" in intents:
                    self.assertEqual(intents[-1], "ready",
                                     f"{phase}/{ctx} seed {seed}: ready not last: {intents}")

    def test_voice_pool_limited_to_routable_intents(self):
        # Amendment 5: voice has no deterministic routing yet — only offer
        # agency the classifier/goodbye path can honor. "end" is allowed only
        # because its text rides the goodbye regex ("i'm done" at message end).
        for phase, ctx in KNOWN_KEYS:
            for seed in range(10):
                out = engagement.fallback_suggestions(
                    phase, ctx, rng=random.Random(seed), voice=True)
                for chip in out:
                    self.assertIn(chip["intent"],
                                  ("ready", "confused", "continue", "end"),
                                  f"voice chip with unroutable intent: {chip!r}")
                    if chip["intent"] == "end":
                        self.assertTrue(chip["text"].lower().endswith("i'm done"),
                                        "voice end chip must ride the goodbye regex")

    def test_never_the_old_binary_pair(self):
        for chip in self._all_chips():
            self.assertNotIn(chip["text"], ("Got it", "I don't understand yet",
                                            "Makes sense", "Understood", "Great!"))


# ---------------------------------------------------------------------------
# resolve_suggestions — phase gating + LLM-chips-else-fallback in one place
# ---------------------------------------------------------------------------

class TestResolveSuggestions(unittest.TestCase):
    LLM_LINES = ["example: Show me one in a story", "ready: I want to try"]

    def test_teach_uses_llm_chips_when_two_or_more(self):
        tagged, used_fallback = engagement.resolve_suggestions(
            self.LLM_LINES, "TEACH", rng=random.Random(1))
        self.assertFalse(used_fallback)
        self.assertEqual([c["intent"] for c in tagged], ["example", "ready"])

    def test_fewer_than_two_parsed_chips_triggers_fallback(self):
        tagged, used_fallback = engagement.resolve_suggestions(
            ["ready: just one chip"], "TEACH", rng=random.Random(1))
        self.assertTrue(used_fallback)
        self.assertTrue(2 <= len(tagged) <= 3)

    def test_assessment_phases_get_no_chips(self):
        for phase in ("TRY", "CHECK", "EVIDENCE", "CHECK_REMEDIATION"):
            tagged, used_fallback = engagement.resolve_suggestions(
                self.LLM_LINES, phase, rng=random.Random(1))
            self.assertEqual(tagged, [], f"{phase} must stay chip-free")
            self.assertFalse(used_fallback)

    def test_recall_gets_chips(self):
        tagged, _ = engagement.resolve_suggestions([], "RECALL", rng=random.Random(1))
        self.assertTrue(len(tagged) >= 2)

    def test_closure_chips_only_while_offered(self):
        tagged, _ = engagement.resolve_suggestions(
            [], "CAPSULE_COMPLETE", closure_offered=True, rng=random.Random(1))
        self.assertTrue(len(tagged) >= 2)
        tagged, _ = engagement.resolve_suggestions(
            [], "CAPSULE_COMPLETE", closure_offered=True, closure_ended=True,
            rng=random.Random(1))
        self.assertEqual(tagged, [])
        tagged, _ = engagement.resolve_suggestions(
            [], "CAPSULE_COMPLETE", rng=random.Random(1))
        self.assertEqual(tagged, [])

    def test_untagged_only_chips_trigger_fallback(self):
        # Untagged-only sets (LLM format drift OR stale pre-gen data) can't
        # route deterministically and may be old binary-style chips — the
        # curated tagged pool replaces them (pre-ship review finding)
        tagged, used_fallback = engagement.resolve_suggestions(
            ["Tell me more", "Another example please"], "TEACH",
            rng=random.Random(1))
        self.assertTrue(used_fallback)
        for chip in tagged:
            self.assertIsNotNone(chip["intent"])

    def test_mixed_chips_with_two_tagged_kept(self):
        tagged, used_fallback = engagement.resolve_suggestions(
            ["ready: Let me try", "Tell me more", "confused: I'm lost"],
            "TEACH", rng=random.Random(1))
        self.assertFalse(used_fallback)
        self.assertEqual(len(tagged), 3)

    def test_non_string_suggestion_lines_skipped(self):
        # Malformed pre-gen JSONB must never crash a chat turn
        out = engagement.tag_suggestions([None, 42, {"x": 1}, "ready: ok then"])
        self.assertEqual(out, [{"text": "ok then", "intent": "ready"}])

    def test_exclude_intents_filters_llm_and_fallback(self):
        # An intent whose route can't render must never be offered — neither
        # from LLM chips nor from the fallback pool that replaces them
        for seed in range(10):
            tagged, used_fallback = engagement.resolve_suggestions(
                ["example: Show me one", "ready: I'll try", "explore: Go deeper"],
                "TEACH", rng=random.Random(seed),
                exclude_intents={"example", "explore"})
            self.assertTrue(used_fallback)  # only 1 tagged survivor -> pool
            for chip in tagged:
                self.assertNotIn(chip["intent"], ("example", "explore"))

    def test_exclude_intents_keeps_llm_chips_when_enough_survive(self):
        tagged, used_fallback = engagement.resolve_suggestions(
            ["confused: I'm lost", "ready: I'll try", "explore: Go deeper"],
            "TEACH", rng=random.Random(1), exclude_intents={"explore"})
        self.assertFalse(used_fallback)
        self.assertEqual([c["intent"] for c in tagged], ["confused", "ready"])

    def test_voice_mode_uses_voice_pool(self):
        tagged, used_fallback = engagement.resolve_suggestions(
            [], "TEACH", voice=True, rng=random.Random(1))
        self.assertTrue(used_fallback)
        for chip in tagged:
            self.assertIn(chip["intent"], ("ready", "confused", "continue"))


# ---------------------------------------------------------------------------
# match_chip — deterministic routing for clicked chips
# ---------------------------------------------------------------------------

class TestMatchChip(unittest.TestCase):
    LAST = [
        {"text": "Can we go through an example?", "intent": "example"},
        {"text": "I'm ready to try it myself", "intent": "ready"},
        {"text": "Tell me more about volcanoes", "intent": None},
    ]

    def test_exact_match_returns_intent(self):
        self.assertEqual(engagement.match_chip("Can we go through an example?", self.LAST),
                         "example")

    def test_match_is_trim_and_case_insensitive(self):
        self.assertEqual(engagement.match_chip("  i'm ready to TRY it myself \n", self.LAST),
                         "ready")

    def test_free_text_returns_none(self):
        self.assertIsNone(engagement.match_chip("what is a volcano?", self.LAST))

    def test_untagged_chip_returns_none(self):
        # Untagged chip click must fall through to the classifier
        self.assertIsNone(engagement.match_chip("Tell me more about volcanoes", self.LAST))

    def test_empty_or_missing_last_suggestions(self):
        self.assertIsNone(engagement.match_chip("anything", []))
        self.assertIsNone(engagement.match_chip("anything", None))


# ---------------------------------------------------------------------------
# match_for_session — phase gating + consumption (pre-ship review hardening)
# ---------------------------------------------------------------------------

class _StubEngine:
    def __init__(self, phase, last, prompts=None, recall_turns=0):
        self.state = {"last_suggestions": last, "recall_turns": recall_turns,
                      "closure_state": None, "closure_ended": False,
                      "teach_context": None}
        self._phase = phase
        self.current_fact_text = "All living things are organisms"
        self.prompts = prompts if prompts is not None else {
            pid: {"template": "x"} for pid in
            ("step_teach_example", "step_teach_explore",
             "step_recall_engage", "step_capsule_closure_recap")}

    @property
    def current_phase(self):
        return self._phase


class _StubSession:
    def __init__(self, engine):
        self._session_engine = engine
        self.progress = {}
        self.events = []

    def log_execution(self, step, details, agent=None):
        self.events.append((step, details))


CHIPS = [{"text": "Show me an example", "intent": "example"}]


class TestMatchForSession(unittest.TestCase):
    def test_match_in_teach_consumes_chips(self):
        s = _StubSession(_StubEngine("TEACH", list(CHIPS)))
        self.assertEqual(engagement.match_for_session(s, "Show me an example"),
                         "example")
        # consumed: an immediate duplicate send must NOT double-fire
        self.assertEqual(s._session_engine.state["last_suggestions"], [])
        self.assertIsNone(engagement.match_for_session(s, "Show me an example"))

    def test_stale_chips_never_match_in_assessment_phases(self):
        # Stale TEACH chips surviving into CHECK/EVIDENCE (voice turns, failed
        # tutor streams, second tabs) must not force types onto unanswered
        # facts (pre-ship review data-integrity finding)
        for phase in ("TRY", "CHECK", "EVIDENCE", "CHECK_REMEDIATION"):
            s = _StubSession(_StubEngine(phase, list(CHIPS)))
            self.assertIsNone(
                engagement.match_for_session(s, "Show me an example"), phase)

    def test_miss_does_not_consume(self):
        s = _StubSession(_StubEngine("TEACH", list(CHIPS)))
        self.assertIsNone(engagement.match_for_session(s, "what is a volcano?"))
        self.assertEqual(len(s._session_engine.state["last_suggestions"]), 1)

    def test_chip_match_event_carries_fact_and_phase(self):
        # Monitoring (ADO #26 dashboard) attributes clicks to a fact via these
        s = _StubSession(_StubEngine("TEACH", list(CHIPS)))
        engagement.match_for_session(s, "Show me an example")
        evt = next(d for step, d in s.events if step == "CHIP_MATCH")
        self.assertEqual(evt["intent"], "example")
        self.assertTrue(evt["hit"])
        self.assertEqual(evt["fact"], "All living things are organisms")
        self.assertEqual(evt["phase"], "TEACH")
        self.assertEqual(evt["offered"], ["example"])

    def test_chip_match_event_on_miss_records_fact(self):
        s = _StubSession(_StubEngine("TEACH", list(CHIPS)))
        engagement.match_for_session(s, "free typed answer")
        evt = next(d for step, d in s.events if step == "CHIP_MATCH")
        self.assertFalse(evt["hit"])
        self.assertIsNone(evt["intent"])
        self.assertEqual(evt["fact"], "All living things are organisms")


class TestResolveForSessionExclusions(unittest.TestCase):
    def test_missing_templates_exclude_their_intents(self):
        # Code deployed before the prompt script ran: example/explore chips
        # must not be offered when their templates can't render
        eng = _StubEngine("TEACH", [], prompts={})
        s = _StubSession(eng)
        tagged = engagement.resolve_for_session(
            s, ["example: Show me one", "explore: Deeper", "ready: I'll try"])
        for chip in tagged:
            self.assertNotIn(chip["intent"],
                             ("example", "explore", "recall_more", "recap"))

    def test_recall_cap_excludes_recall_more_chip(self):
        eng = _StubEngine("RECALL", [], recall_turns=2)
        s = _StubSession(eng)
        tagged = engagement.resolve_for_session(s, [])
        for chip in tagged:
            self.assertNotEqual(chip["intent"], "recall_more")


# ---------------------------------------------------------------------------
# texts + intent map integrity
# ---------------------------------------------------------------------------

class TestShapes(unittest.TestCase):
    def test_texts_extracts_client_shape(self):
        tagged = [{"text": "A", "intent": "ready"}, {"text": "B", "intent": None}]
        self.assertEqual(engagement.texts(tagged), ["A", "B"])

    def test_every_intent_has_interaction_mapping(self):
        for intent in engagement.INTENTS:
            self.assertIn(intent, engagement.INTENT_TO_INTERACTION)

    def test_ready_chip_in_teach_routes_as_move_on(self):
        """A chip that says "let me try" must deliver a TRY: in TEACH, `ready`
        routes as student_move_on (move_on_teach_to_try jumps the remaining
        TEACH scaffold steps) instead of advancing the scaffold one step."""
        self.assertEqual(engagement.intent_interaction("ready", "TEACH"),
                         "student_move_on")

    def test_ready_chip_outside_teach_keeps_understanding_route(self):
        for phase in (None, "RECALL", "CAPSULE_COMPLETE", "TRY"):
            self.assertEqual(engagement.intent_interaction("ready", phase),
                             "student_understands")

    def test_intent_interaction_matches_static_map_for_other_intents(self):
        for intent, itype in engagement.INTENT_TO_INTERACTION.items():
            if intent == "ready":
                continue
            for phase in (None, "TEACH", "RECALL"):
                self.assertEqual(engagement.intent_interaction(intent, phase), itype)

    def test_intent_interaction_none_intent_returns_none(self):
        self.assertIsNone(engagement.intent_interaction(None, "TEACH"))

    def test_interaction_targets_are_known_values(self):
        allowed = {"student_wants_example", "student_wants_explore",
                   "student_understands", "student_confused",
                   "closure_recap", "closure_end", "recall_more",
                   "student_wants_hint"}  # ADO #26 D
        self.assertTrue(set(engagement.INTENT_TO_INTERACTION.values()) <= allowed)


if __name__ == "__main__":
    unittest.main()
