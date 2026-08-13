"""Tests for the No-Completion-Without-Evidence guard (ADO #28).

The guard fires inside _process_evidence: a fact can only earn
evidence_result=PASSED / MASTERED when the learner's actual message is
substantive (not "yes", "I understand", chip text, empty/emoji). A
non-substantive pass-grade gets up to 2 gentle probes ("explain it in your
own words"), then strikes out to PARTIAL_MASTERY (UNVERIFIED) — NEVER into
remediation (re-teaching a kid who answered correctly violates the spec's
Diagnostic-Before-Reteach rule).

Also covers the _complete_capsule default-MASTERED hole, the evidence
audit trail, and serialize/restore back-compat for the new fields.
No LLM or DB calls. Run: pytest api/tests/test_session_engine_evidence_guard.py -v
"""

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from session_engine import SessionEngine

PROMPT_IDS = [
    "step_teach", "step_teach_reteach", "step_teach_confused",
    "step_teach_continue", "step_teach_example", "step_teach_explore",
    "step_try", "step_try_retry", "step_check", "step_check_remediation",
    "step_evidence", "step_evidence_retry", "step_evidence_probe",
    "step_recall_engage", "step_capsule_closure", "step_capsule_closure_recap",
]
REGISTRY = {pid: {"template": f"[{pid}]"} for pid in PROMPT_IDS}
DECISION_TREE = {"prompt_registry": REGISTRY}
PERSONA = {"tutor_name": "Aris", "persona_description": "a helpful tutor",
           "persona_traits": ["patient"]}
CURRICULUM = {"subject": "Biology", "subject_lower": "biology",
              "age_range": "10-12", "phase": 1, "capsule_name": "Organisms"}
FACTS = [
    {"id": "f1", "meta_data": {"core_fact": "All living things are organisms",
                               "scaffold": ["TEACH", "TRY"]}},
    {"id": "f2", "meta_data": {"core_fact": "Cells are the unit of life",
                               "scaffold": ["TEACH", "TRY"]}},
]

SUBSTANTIVE = "because living things grow and respond to the world"


def make_engine():
    # Deep-copy so per-test prompt mutations (e.g. emptying step_evidence_probe)
    # don't leak into the shared module-level registry.
    eng = SessionEngine(copy.deepcopy(DECISION_TREE), PERSONA, CURRICULUM)
    eng.init_session([dict(f) for f in FACTS], session_id="s1",
                     student_id="stu1", capsule_id="cap1")
    return eng


def evidence_engine():
    """Engine parked at the start of EVIDENCE COLLECT (queue=[f1,f2])."""
    eng = make_engine()
    eng._start_evidence()
    return eng


class TestInitAndRestore(unittest.TestCase):
    def test_new_fields_initialized(self):
        eng = make_engine()
        for fs in eng.state["fact_statuses"].values():
            self.assertEqual(fs["evidence_probe_count"], 0)
            self.assertFalse(fs["evidence_probe_pending"])
            self.assertEqual(fs["evidence_responses"], [])

    def test_restore_backcompat_without_guard_fields(self):
        eng = evidence_engine()
        saved = eng.serialize()
        for fs in saved["state"]["fact_statuses"].values():
            fs.pop("evidence_probe_count", None)
            fs.pop("evidence_probe_pending", None)
            fs.pop("evidence_responses", None)
        eng2 = SessionEngine(DECISION_TREE, PERSONA, CURRICULUM)
        eng2.restore(saved)
        # A "yes" at EVIDENCE must fire the probe, not KeyError
        r = eng2.process_assessor_result("student_correct", student_message="yes")
        self.assertEqual(r["action"], "evidence_probe")


class TestSubstantivePasses(unittest.TestCase):
    def test_substantive_correct_masters(self):
        eng = evidence_engine()
        r = eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        self.assertEqual(eng.fact_status("f1")["evidence_result"], "PASSED")
        self.assertEqual(eng.fact_status("f1")["final_status"], "MASTERED")
        self.assertEqual(r["action"], "evidence_next")  # popped, advanced to f2

    def test_single_domain_word_passes_without_probe(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_correct", student_message="organisms")
        self.assertEqual(eng.fact_status("f1")["final_status"], "MASTERED")

    def test_none_message_bypasses_guard(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_correct")  # legacy caller, no message
        self.assertEqual(eng.fact_status("f1")["final_status"], "MASTERED")


class TestProbe(unittest.TestCase):
    def test_bare_yes_triggers_probe_not_mastery(self):
        eng = evidence_engine()
        r = eng.process_assessor_result("student_correct", student_message="yes")
        self.assertEqual(r["action"], "evidence_probe")
        self.assertIn("[step_evidence_probe]", r["prompt_text"])
        self.assertEqual(eng.current_fact_id, "f1")              # not popped
        self.assertIsNone(eng.fact_status("f1")["evidence_result"])
        self.assertNotEqual(eng.fact_status("f1")["final_status"], "MASTERED")
        self.assertEqual(eng.fact_status("f1")["evidence_probe_count"], 1)
        self.assertTrue(eng.fact_status("f1")["evidence_probe_pending"])

    def test_i_understand_triggers_probe(self):
        eng = evidence_engine()
        r = eng.process_assessor_result("student_correct", student_message="I understand")
        self.assertEqual(r["action"], "evidence_probe")

    def test_probe_then_substantive_masters(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_correct", student_message="yes")
        r = eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        self.assertEqual(eng.fact_status("f1")["final_status"], "MASTERED")
        self.assertEqual(r["action"], "evidence_next")

    def test_two_probes_then_strikeout_partial_not_remediation(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_correct", student_message="yes")
        eng.process_assessor_result("student_correct", student_message="ok")
        r = eng.process_assessor_result("student_correct", student_message="sure")
        fs = eng.fact_status("f1")
        self.assertEqual(fs["final_status"], "PARTIAL_MASTERY")
        self.assertNotIn("f1", eng.state["evidence_failed"])     # never remediation
        self.assertEqual(r["action"], "evidence_next")           # advanced to f2
        # guard alone must not have entered remediation
        self.assertEqual(eng.state["evidence_phase"], "COLLECT")
        # audit trail marks the unverified strike-out
        self.assertFalse(fs["evidence_responses"][-1]["verified"])

    def test_probe_does_not_increment_evidence_attempts(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_correct", student_message="yes")
        self.assertEqual(eng.fact_status("f1")["evidence_attempts"], 0)
        eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        self.assertEqual(eng.fact_status("f1")["evidence_attempts"], 1)

    def test_empty_template_skips_guard(self):
        eng = evidence_engine()
        eng.prompts["step_evidence_probe"] = {"template": ""}
        eng.process_assessor_result("student_correct", student_message="yes")
        # No probe possible -> treat as substantive -> MASTERED, budget untouched
        self.assertEqual(eng.fact_status("f1")["final_status"], "MASTERED")
        self.assertEqual(eng.fact_status("f1")["evidence_probe_count"], 0)

    def test_missing_template_key_skips_guard(self):
        # Guard-active detection must use the raw registry, not a render call.
        eng = evidence_engine()
        eng.prompts.pop("step_evidence_probe", None)
        eng.process_assessor_result("student_correct", student_message="yes")
        self.assertEqual(eng.fact_status("f1")["final_status"], "MASTERED")
        self.assertEqual(eng.fact_status("f1")["evidence_probe_count"], 0)


class TestProbePendingConversation(unittest.TestCase):
    def test_question_during_probe_stays_no_fail_no_burn(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_correct", student_message="yes")
        r = eng.process_assessor_result("student_question",
                                        student_message="what do you mean?")
        self.assertEqual(r["action"], "evidence_probe_clarify")
        self.assertEqual(eng.current_fact_id, "f1")
        self.assertIsNone(eng.fact_status("f1")["evidence_result"])
        self.assertEqual(eng.fact_status("f1")["evidence_probe_count"], 1)  # not burned

    def test_has_pending_evidence_probe_durable_flag(self):
        # Compliance-correction suppression must key off durable engine state,
        # not the volatile per-turn _last_engine_action (which isn't set on a
        # no-fact_discussed turn).
        eng = evidence_engine()
        self.assertFalse(eng.has_pending_evidence_probe())
        eng.process_assessor_result("student_correct", student_message="yes")
        self.assertTrue(eng.has_pending_evidence_probe())
        # resolved substantively -> no longer pending
        eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        self.assertFalse(eng.has_pending_evidence_probe())

    def test_has_pending_probe_false_outside_evidence(self):
        eng = make_engine()  # phase TEACH, empty evidence_queue
        self.assertFalse(eng.has_pending_evidence_probe())


class TestForfeitAndFail(unittest.TestCase):
    def test_move_on_forfeits_not_probed(self):
        eng = evidence_engine()
        r = eng.process_assessor_result("student_move_on", student_message="skip")
        self.assertEqual(eng.fact_status("f1")["final_status"], "FORFEITED")
        self.assertEqual(eng.fact_status("f1")["evidence_probe_count"], 0)
        self.assertEqual(r["action"], "evidence_next")

    def test_incorrect_fails_directly_no_probe(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_incorrect", student_message="banana")
        self.assertEqual(eng.fact_status("f1")["evidence_result"], "FAILED")
        self.assertEqual(eng.fact_status("f1")["evidence_probe_count"], 0)
        self.assertIn("f1", eng.state["evidence_failed"])

    def test_move_on_during_preserved_followup_forfeits(self):
        eng = evidence_engine()
        # partially_correct (substantive) -> followup pending
        eng.process_assessor_result("student_partially_correct",
                                    student_message="kind of, they breathe")
        self.assertTrue(eng.fact_status("f1")["evidence_followup"])
        r = eng.process_assessor_result("student_move_on", student_message="skip")
        self.assertEqual(eng.fact_status("f1")["final_status"], "FORFEITED")
        self.assertEqual(r["action"], "evidence_next")


class TestFollowupProbeInteraction(unittest.TestCase):
    def test_nonsubstantive_correct_in_followup_probes_preserving_followup(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_partially_correct",
                                    student_message="kind of, they breathe")
        self.assertTrue(eng.fact_status("f1")["evidence_followup"])
        r = eng.process_assessor_result("student_correct", student_message="yes")
        self.assertEqual(r["action"], "evidence_probe")
        self.assertTrue(eng.fact_status("f1")["evidence_followup"])   # preserved
        self.assertIsNone(eng.fact_status("f1")["evidence_result"])
        # then substantive resolves the followup -> MASTERED
        eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        self.assertEqual(eng.fact_status("f1")["final_status"], "MASTERED")


class TestRetryBudget(unittest.TestCase):
    def test_retry_resets_one_probe(self):
        eng = evidence_engine()
        # Fail both facts to drive into remediation -> retry
        eng.process_assessor_result("student_incorrect", student_message="no idea here")
        eng.process_assessor_result("student_incorrect", student_message="no idea here")
        # remediation started; march back to EVIDENCE RETRY via retry entry
        eng._evidence_retry()
        self.assertEqual(eng.state["evidence_phase"], "RETRY")
        # both facts had probe budget reset to allow 1 in RETRY
        for fid in ("f1", "f2"):
            self.assertLessEqual(eng.fact_status(fid)["evidence_probe_count"], 1)
        r = eng.process_assessor_result("student_correct", student_message="yes")
        self.assertEqual(r["action"], "evidence_probe")  # one probe available in RETRY


class TestChipTextGuard(unittest.TestCase):
    def test_typed_chip_text_is_nonsubstantive(self):
        eng = evidence_engine()
        eng.state["last_suggestions"] = [{"text": "I'm ready to try", "intent": "ready"}]
        r = eng.process_assessor_result("student_correct",
                                        student_message="I'm ready to try")
        self.assertEqual(r["action"], "evidence_probe")


class TestCompleteCapsuleHole(unittest.TestCase):
    def test_no_evidence_result_defaults_to_partial_not_mastered(self):
        eng = make_engine()
        # f1 explicitly passed; f2 left with no evidence_result at all
        eng.state["fact_statuses"]["f1"]["evidence_result"] = "PASSED"
        r = eng._complete_capsule()
        self.assertEqual(eng.fact_status("f1")["final_status"], "MASTERED")
        self.assertEqual(eng.fact_status("f2")["final_status"], "PARTIAL_MASTERY")
        self.assertEqual(r["action"], "COMPLETED_WITH_GAPS")

    def test_all_passed_still_fully_mastered(self):
        eng = make_engine()
        for fid in ("f1", "f2"):
            eng.state["fact_statuses"][fid]["evidence_result"] = "PASSED"
        r = eng._complete_capsule()
        self.assertEqual(r["action"], "FULLY_MASTERED")


class TestAuditTrail(unittest.TestCase):
    def test_responses_captured_and_truncated(self):
        eng = evidence_engine()
        long = "x" * 800
        eng.process_assessor_result("student_correct", student_message=long)
        resp = eng.fact_status("f1")["evidence_responses"]
        self.assertTrue(resp)
        self.assertLessEqual(len(resp[0]["text"]), 500)
        self.assertIn("substantive", resp[0])

    def test_audit_keys_match_serialized_vocabulary(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        entry = eng.fact_status("f1")["evidence_responses"][0]
        self.assertIn("interaction_type", entry)   # not "itype"
        self.assertIn("ts", entry)                 # not "at"
        self.assertNotIn("itype", entry)
        self.assertNotIn("at", entry)

    def test_pass_marks_verified_true(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        self.assertTrue(eng.fact_status("f1")["evidence_responses"][-1]["verified"])

    def test_followup_pass_marks_verified_true(self):
        eng = evidence_engine()
        eng.process_assessor_result("student_partially_correct",
                                    student_message="kind of, they breathe")
        eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        self.assertTrue(eng.fact_status("f1")["evidence_responses"][-1]["verified"])

    def test_responses_capped_at_ten(self):
        eng = evidence_engine()
        for i in range(15):
            eng.fact_status("f1")["evidence_probe_count"] = 0  # keep probing path open
            eng.process_assessor_result("student_correct", student_message="yes")
            eng.state["evidence_queue"] = ["f1", "f2"]  # keep f1 current
            eng.state["current_fact_index"] = 0
        self.assertLessEqual(len(eng.fact_status("f1")["evidence_responses"]), 10)


if __name__ == "__main__":
    unittest.main()
