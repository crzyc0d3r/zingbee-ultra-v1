"""Tests for SessionEngine engagement routing (ADO #26).

Covers the example/explore teach detours with their cap (guided-TRY handoff,
never a silent advance), RECALL engagement turns, capsule closure flow with
deferred session end, and restore() back-compat for pre-engagement state dicts.
No LLM or DB calls. Run with: pytest api/tests/test_session_engine_engagement.py -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from session_engine import SessionEngine

PROMPT_IDS = [
    "step_teach", "step_teach_reteach", "step_teach_confused",
    "step_teach_continue", "step_teach_example", "step_teach_explore",
    "step_try", "step_try_retry", "step_check", "step_check_remediation",
    "step_evidence", "step_evidence_retry", "step_recall_engage",
    "step_capsule_closure", "step_capsule_closure_recap",
]

# Marker templates: rendering "step_x" produces "[step_x]" so tests can assert
# exactly which template drove a transition.
REGISTRY = {pid: {"template": f"[{pid}]"} for pid in PROMPT_IDS}
REGISTRY["step_teach_explore"]["template"] = "[step_teach_explore]\n$stretch_questions"

DECISION_TREE = {"prompt_registry": REGISTRY}
PERSONA = {"tutor_name": "Aris", "persona_description": "a helpful tutor",
           "persona_traits": ["patient"]}
CURRICULUM = {"subject": "Biology", "subject_lower": "biology",
              "age_range": "10-12", "phase": 1, "capsule_name": "Organisms"}

FACTS = [
    {"id": "f1", "meta_data": {
        "core_fact": "All living things are organisms",
        "scaffold": ["TEACH", "TRY"],
        "stretch_questions": ["How would you classify a virus?",
                              "Is a flame alive?"],
    }},
    {"id": "f2", "meta_data": {
        "core_fact": "Cells are the unit of life",
        "scaffold": ["TEACH", "TRY"],
        # no stretch_questions on purpose
    }},
]


def make_engine():
    eng = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
    eng.init_session([dict(f) for f in FACTS], session_id="s1",
                     student_id="stu1", capsule_id="cap1")
    return eng


class TestInitState(unittest.TestCase):
    def test_new_state_keys_initialized(self):
        eng = make_engine()
        self.assertEqual(eng.state["last_suggestions"], [])
        self.assertEqual(eng.state["recall_turns"], 0)
        self.assertIsNone(eng.state["closure_state"])
        self.assertFalse(eng.state["closure_ended"])
        for fs in eng.state["fact_statuses"].values():
            self.assertEqual(fs["engagement_detours"], 0)


class TestExampleExploreRouting(unittest.TestCase):
    def test_wants_example_renders_example_template_and_stays_teach(self):
        eng = make_engine()
        r = eng.process_assessor_result("student_wants_example")
        self.assertEqual(r["new_phase"], "TEACH")
        self.assertEqual(r["action"], "teach_example")
        self.assertIn("[step_teach_example]", r["prompt_text"])
        self.assertEqual(eng.state["teach_context"], "example")
        self.assertEqual(eng.fact_status("f1")["engagement_detours"], 1)

    def test_wants_explore_renders_explore_template_with_stretch_questions(self):
        eng = make_engine()
        r = eng.process_assessor_result("student_wants_explore")
        self.assertEqual(r["new_phase"], "TEACH")
        self.assertEqual(r["action"], "teach_explore")
        self.assertIn("[step_teach_explore]", r["prompt_text"])
        self.assertIn("- How would you classify a virus?", r["prompt_text"])
        self.assertIn("- Is a flame alive?", r["prompt_text"])
        self.assertEqual(eng.state["teach_context"], "explore")

    def test_explore_without_stretch_questions_gets_invent_fallback(self):
        eng = make_engine()
        # advance to fact 2 (no stretch_questions)
        eng.process_assessor_result("student_understands")   # f1 TEACH -> TRY
        eng.process_assessor_result("student_correct")       # f1 TRY -> f2 TEACH
        self.assertEqual(eng.current_fact_id, "f2")
        r = eng.process_assessor_result("student_wants_explore")
        self.assertIn("invent one stretch question", r["prompt_text"].lower())

    def test_third_detour_becomes_guided_try_not_silent_advance(self):
        # Amendment 1: the cap is a handoff ("let's do one together"),
        # never a silent move-on.
        eng = make_engine()
        eng.process_assessor_result("student_wants_example")
        eng.process_assessor_result("student_wants_explore")
        r = eng.process_assessor_result("student_wants_example")
        self.assertEqual(r["new_phase"], "TRY")
        self.assertEqual(r["action"], "engagement_guided_try")
        self.assertIn("[step_try]", r["prompt_text"])
        self.assertIn("GUIDED_TRY", r["prompt_text"])
        self.assertEqual(eng.current_phase, "TRY")
        # still the same fact — the request was honored, not skipped
        self.assertEqual(eng.current_fact_id, "f1")

    def test_detours_suppressed_during_evidence_remediation(self):
        # Tiered remediation (LIGHT skips TRY) must not be bypassable by
        # example/explore detours (pre-ship review data-integrity finding)
        eng = make_engine()
        eng.state["evidence_phase"] = "REMEDIATION"
        r = eng.process_assessor_result("student_wants_example")
        self.assertEqual(r["action"], "wait")
        self.assertEqual(eng.fact_status("f1").get("engagement_detours", 0), 0)

    def test_no_transition_turn_clears_lingering_detour_context(self):
        # A question after an example detour must not leave teach_context
        # pinned to "example" for later re-renders
        eng = make_engine()
        eng.process_assessor_result("student_wants_example")
        self.assertEqual(eng.state["teach_context"], "example")
        eng.process_assessor_result("student_question")
        self.assertIsNone(eng.state["teach_context"])

    def test_detour_counter_is_per_fact(self):
        eng = make_engine()
        eng.process_assessor_result("student_wants_example")
        eng.process_assessor_result("student_wants_example")
        # complete f1
        eng.process_assessor_result("student_understands")
        eng.process_assessor_result("student_correct")
        self.assertEqual(eng.current_fact_id, "f2")
        r = eng.process_assessor_result("student_wants_example")
        self.assertEqual(r["action"], "teach_example")  # fresh budget on f2
        self.assertEqual(eng.fact_status("f2")["engagement_detours"], 1)

    def test_render_step_transition_maps_new_contexts(self):
        eng = make_engine()
        eng.state["teach_context"] = "example"
        self.assertIn("[step_teach_example]", eng.render_step_transition())
        eng.state["teach_context"] = "explore"
        self.assertIn("[step_teach_explore]", eng.render_step_transition())

    def test_stretch_questions_formatted_even_without_extra_vars(self):
        # render_step_transition path must never leak a raw Python list repr
        eng = make_engine()
        eng.state["teach_context"] = "explore"
        rendered = eng.render_step_transition()
        self.assertNotIn("['", rendered)
        self.assertIn("- How would you classify a virus?", rendered)


class TestRecallEngagement(unittest.TestCase):
    def _recall_engine(self):
        eng = make_engine()
        eng.state["current_phase"] = "RECALL"
        return eng

    def test_recall_more_stays_in_recall(self):
        eng = self._recall_engine()
        r = eng.process_assessor_result("recall_more")
        self.assertEqual(r["new_phase"], "RECALL")
        self.assertEqual(r["action"], "recall_engage")
        self.assertIn("[step_recall_engage]", r["prompt_text"])
        self.assertEqual(eng.state["recall_turns"], 1)

    def test_recall_capped_at_two_extra_turns(self):
        eng = self._recall_engine()
        eng.process_assessor_result("recall_more")
        eng.state["current_phase"] = "RECALL"
        eng.process_assessor_result("recall_more")
        eng.state["current_phase"] = "RECALL"
        r = eng.process_assessor_result("recall_more")
        self.assertEqual(r["new_phase"], "TEACH")

    def test_other_input_transitions_to_teach_as_before(self):
        eng = self._recall_engine()
        r = eng.process_assessor_result("student_correct")
        self.assertEqual(r["new_phase"], "TEACH")


class TestClosureFlow(unittest.TestCase):
    def _completed_engine(self):
        eng = make_engine()
        r = eng._complete_capsule()
        return eng, r

    def test_completion_offers_closure_choice_instead_of_ending(self):
        eng, r = self._completed_engine()
        self.assertIn("[step_capsule_closure]", r["prompt_text"])
        self.assertEqual(eng.state["closure_state"], "offered")
        self.assertFalse(eng.should_end_session())  # deferred end

    def test_completion_action_still_reports_mastery_status(self):
        eng, r = self._completed_engine()
        self.assertIn(r["action"], ("FULLY_MASTERED", "COMPLETED_WITH_GAPS"))

    def test_recap_then_end(self):
        eng, _ = self._completed_engine()
        r = eng.process_assessor_result("closure_recap")
        self.assertIn("[step_capsule_closure_recap]", r["prompt_text"])
        self.assertEqual(eng.state["closure_state"], "recap_done")
        self.assertFalse(eng.should_end_session())
        r2 = eng.process_assessor_result("confirmation")
        self.assertEqual(r2["action"], "closure_end")
        self.assertTrue(eng.should_end_session())

    def test_direct_end_choice(self):
        eng, _ = self._completed_engine()
        r = eng.process_assessor_result("closure_end")
        self.assertEqual(r["action"], "closure_end")
        self.assertTrue(eng.should_end_session())

    def test_recap_only_offered_once(self):
        eng, _ = self._completed_engine()
        eng.process_assessor_result("closure_recap")
        r = eng.process_assessor_result("closure_recap")
        self.assertEqual(r["action"], "closure_end")
        self.assertTrue(eng.should_end_session())

    def test_typed_reply_while_offered_leans_recap_not_silent_end(self):
        # Pre-ship review: students TYPE ("yes recap please") — assessor maps that
        # to ordinary types, which must not silently end the session
        for itype in ("confirmation", "student_understands", "student_question",
                      "student_correct", "teaching"):
            eng, _ = self._completed_engine()
            r = eng.process_assessor_result(itype)
            self.assertEqual(r["action"], "closure_recap", itype)
            self.assertFalse(eng.should_end_session(), itype)

    def test_move_on_while_offered_ends(self):
        eng, _ = self._completed_engine()
        r = eng.process_assessor_result("student_move_on")
        self.assertEqual(r["action"], "closure_end")
        self.assertTrue(eng.should_end_session())

    def test_is_capsule_complete_unchanged(self):
        eng, _ = self._completed_engine()
        self.assertTrue(eng.is_capsule_complete())


class TestRestoreBackCompat(unittest.TestCase):
    def test_restore_old_state_without_engagement_keys(self):
        # Simulate a pre-#26 serialized blob: no last_suggestions, recall_turns,
        # closure_*, or per-fact engagement_detours
        eng = make_engine()
        saved = eng.serialize()
        for key in ("last_suggestions", "recall_turns",
                    "closure_state", "closure_ended"):
            saved["state"].pop(key, None)
        for fs in saved["state"]["fact_statuses"].values():
            fs.pop("engagement_detours", None)

        eng2 = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
        eng2.restore(saved)

        self.assertEqual(eng2.state["last_suggestions"], [])
        self.assertEqual(eng2.state["recall_turns"], 0)
        self.assertIsNone(eng2.state["closure_state"])
        self.assertFalse(eng2.state["closure_ended"])
        # And a detour on restored state must not crash
        r = eng2.process_assessor_result("student_wants_example")
        self.assertEqual(r["action"], "teach_example")

    def test_restored_session_in_closure_can_still_end(self):
        # Amendment 4: session persisted at "closure offered" must resume sanely
        eng = make_engine()
        eng._complete_capsule()
        saved = eng.serialize()

        eng2 = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
        eng2.restore(saved)
        r = eng2.process_assessor_result("closure_end")
        self.assertEqual(r["action"], "closure_end")
        self.assertTrue(eng2.should_end_session())

    def test_restore_from_removed_check_phase_does_not_strand(self):
        # v006.9: CHECK/CHECK_REMEDIATION were removed. A blob saved mid-CHECK has
        # no handler now — without migration process_assessor_result would return
        # "wait" every turn forever. restore() must land it back in a dispatchable
        # phase so the student advances.
        for stale_phase in ("CHECK", "CHECK_REMEDIATION"):
            eng = make_engine()
            saved = eng.serialize()
            saved["state"]["current_phase"] = stale_phase
            saved["state"]["in_check_remediation"] = True  # legacy leftover

            eng2 = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
            eng2.restore(saved)

            self.assertIn(eng2.current_phase, SessionEngine._PHASE_HANDLERS,
                          f"{stale_phase} not remapped to a dispatchable phase")
            # A real turn must advance, not silently wait.
            r = eng2.process_assessor_result("student_understands")
            self.assertTrue(r["state_changed"],
                            f"resumed {stale_phase} session stranded on wait")
            self.assertNotEqual(r["action"], "wait")


if __name__ == "__main__":
    unittest.main()
