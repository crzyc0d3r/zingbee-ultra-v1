"""Shape tests for the canonical ZSM-v006 state-machine contract.

Verifies that zsm-v006.json is structurally valid: required top-level keys
exist, every transition's itype is declared in the taxonomy, and every
transition's from/to phases are known phases.

Behavioral tests (asserting the real engine matches the contract) come in Task 4.

Run with: pytest api/tests/test_state_machine_contract.py -v
"""

import os
import sys
from copy import deepcopy
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import unittest
from state_machine import loader
from session_engine import SessionEngine


class TestContractShape(unittest.TestCase):
    def setUp(self):
        self.c = loader.load_contract()

    def test_required_keys_present(self):
        self.assertIn("version", self.c)
        self.assertTrue(loader.transitions(self.c), "transitions must be non-empty")

    def test_every_transition_itype_is_in_taxonomy(self):
        allowed = set(loader.taxonomy(self.c)["all_types"])
        for t in loader.transitions(self.c):
            self.assertIn(t["itype"], allowed,
                          f"transition itype {t['itype']!r} not in taxonomy")

    def test_every_transition_target_is_a_known_phase(self):
        phases = set(loader.taxonomy(self.c)["valid_per_phase"].keys())
        for t in loader.transitions(self.c):
            self.assertIn(t["from"], phases)
            self.assertIn(t["to"], phases)


# ---------------------------------------------------------------------------
# Behavioral golden test (Task 4): drive the REAL SessionEngine through each
# itype-driven contract row and assert the engine produces the documented
# `to` phase and `action`.
# ---------------------------------------------------------------------------
#
# Fixtures mirror api/tests/test_session_engine_engagement.py and
# test_session_engine_evidence_guard.py (module-level DECISION_TREE / PERSONA /
# CURRICULUM / FACTS, make_engine(), deepcopy of the decision tree).
#
# This branch is off `main` — the engine has NO feature flags. Every contract
# row's `flags` is `{}`, so _apply_flags is a deliberate no-op kept only to honor
# the brief's row-iteration shape (it documents that no flag gating exists here).

PROMPT_IDS = [
    "step_teach", "step_teach_reteach", "step_teach_confused", "step_teach_confirm",
    "step_teach_continue", "step_teach_example", "step_teach_explore", "step_try",
    "step_try_hint", "step_try_retry", "step_check_remediation",
    "step_evidence", "step_evidence_retry", "step_evidence_probe", "step_recall_engage",
    "step_capsule_closure", "step_capsule_closure_recap",
]
DECISION_TREE = {"prompt_registry": {k: {"template": f"[{k}]"} for k in PROMPT_IDS}}
PERSONA = {"tutor_name": "Aris", "persona_description": "a helpful tutor",
           "persona_traits": ["patient"]}
CURRICULUM = {"subject": "Biology", "subject_lower": "biology",
              "age_range": "10-12", "phase": 1, "capsule_name": "Organisms"}

# A genuinely substantive EVIDENCE answer — keeps the ADO #28 substance guard
# from intercepting student_correct with a probe (which would mask the row's
# real transition).
SUBSTANTIVE = "because living things grow respond and adapt to the world around them"

FLAG_NAMES = ["TEACH_SIGNAL_FIX", "TRY_HINT", "ENGAGEMENT_DETERMINISTIC_CHIPS"]


def _apply_flags(flags: dict):
    """Set the environment to match a contract row's `flags` map: export each flag
    the row requires true, and force every other known flag OFF. So a flags={} row
    runs fully flag-free and a flag-gated row runs with exactly its flags on —
    pinning (transition x flag) per the design's flag matrix (ADO #88)."""
    flags = flags or {}
    for name in FLAG_NAMES:
        if flags.get(name):
            os.environ[name] = "true"
        else:
            os.environ.pop(name, None)


def _facts(n, scaffold=None):
    sc = list(scaffold or ["TEACH", "TRY"])
    return [{"id": f"f{i}", "meta_data": {
        "core_fact": f"fact {i}", "scaffold": list(sc),
        "stretch_questions": ["why?"],
        "micro_checks": [{"type": "recall", "question": "q?"}]}}
        for i in range(1, n + 1)]


def make_engine(n=3, scaffold=None):
    eng = SessionEngine(deepcopy(DECISION_TREE), PERSONA, CURRICULUM)
    eng.init_session(_facts(n, scaffold), session_id="s1",
                     student_id="stu1", capsule_id="cap1")
    return eng


def _rebuild(eng, n=3, scaffold=None):
    """Re-initialize an engine in place with a different fact count / scaffold.
    Used by drive_to_phase when a row's condition needs a non-default fixture
    (e.g. a multi-TEACH scaffold, or 5 facts for the LIGHT remediation tier)."""
    eng.init_session(_facts(n, scaffold), session_id="s1",
                     student_id="stu1", capsule_id="cap1")


def _msg_for(itype):
    """The student_message to pass for an itype. EVIDENCE answer types need a
    substantive message; everything else can be a short stub."""
    if itype in ("student_correct", "student_partially_correct"):
        return SUBSTANTIVE
    if itype == "student_incorrect":
        return "totally wrong nonsense answer"
    return "ok"


def _teach_then_try(eng):
    """Move current fact from its opening TEACH into TRY (default scaffold)."""
    eng.process_assessor_result("student_understands")  # TEACH -> TRY


# Conditions whose contract rows cannot be deterministically reached via public
# process_assessor_result calls on this engine, with the reason. Asserted in a
# dedicated test so the "uncovered" set can never silently grow.
UNREACHABLE = {
    # student_incorrect / student_confused ALWAYS append the current fid to
    # evidence_failed, so when the queue empties evidence_failed is non-empty by
    # construction — the "...AND evidence_failed_empty -> CAPSULE_COMPLETE" rows
    # describe a state the engine cannot produce for these itypes.
    ("EVIDENCE", "student_incorrect",
     "evidence_followup==false AND queue_empty_after_pop AND evidence_failed_empty"):
        "student_incorrect always populates evidence_failed; empty branch unreachable",
    ("EVIDENCE", "student_confused",
     "evidence_followup==false AND queue_empty_after_pop AND evidence_failed_empty"):
        "student_confused always populates evidence_failed; empty branch unreachable",
}


def drive_to_phase(eng, phase, condition, itype):
    """Position `eng` into `phase` with `condition` satisfied, ready to receive
    `itype` via process_assessor_result. Raises NotImplementedError for the
    documented UNREACHABLE rows so the caller can skip+account for them.

    Uses only public process_assessor_result calls plus the same direct-state
    setup the existing engine tests already rely on (e.g. _start_evidence,
    setting current_phase='RECALL', priming attempt counters)."""

    if phase == "TEACH":
        # Fresh engine opens in TEACH on f1. Most TEACH conditions need a
        # specific scaffold or attempt count, handled by the caller via the
        # scaffold/prime args below.
        if condition in ("teach_attempts<3", "any", "TRY_in_remaining_scaffold",
                          "evidence_phase!=REMEDIATION AND engagement_detours<=2"):
            return
        if condition == "scaffold_next_is_TRY":
            return  # default scaffold [TEACH,TRY]: understands -> TRY
        if condition == "scaffold_next_is_TEACH":
            _rebuild(eng, scaffold=["TEACH", "TEACH", "TRY"])
            return
        if condition == "scaffold_exhausted":
            _rebuild(eng, scaffold=["TEACH"], n=2)  # exhaust -> advance_fact (next fact TEACH)
            return
        if condition == "teach_attempts>=3":
            _rebuild(eng, scaffold=["TEACH", "TEACH", "TRY"])
            eng.fact_status("f1")["teach_attempts"] = 2  # +1 from confused -> 3
            return
        if condition == "no_TRY_in_remaining_scaffold":
            _rebuild(eng, scaffold=["TEACH"], n=2)
            return
        if condition == "evidence_phase!=REMEDIATION AND engagement_detours>2":
            eng.process_assessor_result("student_wants_example")
            eng.process_assessor_result("student_wants_example")  # detours now 2
            return
        if condition == "evidence_phase==REMEDIATION":
            eng.state["evidence_phase"] = "REMEDIATION"
            return
        # --- ADO #26 TEACH_SIGNAL_FIX flag-gated rows (flag set by _apply_flags) ---
        if condition == "signal_fix AND scaffold_next_is_TRY AND evidence_phase!=REMEDIATION":
            return  # default scaffold [TEACH,TRY]; correct/partial -> _advance_scaffold -> TRY
        if condition == "signal_fix AND teach_wait_turns<1 AND evidence_phase!=REMEDIATION":
            return  # first non-advancing 'teaching' turn: counter 0->1, still a wait
        if condition == "signal_fix AND teach_wait_turns>=1 AND not_checkpoint AND evidence_phase!=REMEDIATION":
            eng.fact_status("f1")["teach_wait_turns"] = 1  # this turn -> 2 -> checkpoint
            return
        if condition == "signal_fix AND teach_checkpoint_done AND evidence_phase!=REMEDIATION":
            eng.fact_status("f1")["teach_checkpoint_done"] = True
            return
        raise NotImplementedError(f"TEACH/{condition}")

    if phase == "TRY":
        _teach_then_try(eng)
        fs = eng.fact_status("f1")
        # Contract attempt conditions are POST-increment (the engine checks
        # fs[try_attempts] AFTER incrementing on an answer turn). So prime to
        # target-1 for answer itypes.
        if condition in ("any", "try_attempts<2"):
            return
        if condition == "try_attempts>=2":          # partial: post>=2 -> pre 1
            fs["try_attempts"] = 1
            return
        if condition == "try_attempts>=2 AND try_attempts<3":  # incorrect post 2 -> pre 1
            fs["try_attempts"] = 1
            return
        if condition == "try_attempts>=3":          # incorrect post 3 -> pre 2
            fs["try_attempts"] = 2
            return
        # --- ADO #26 TRY_HINT flag-gated rows (flag set by _apply_flags) ---
        if condition == "TRY_HINT_off":
            return  # student_wants_hint with TRY_HINT off -> wait
        if condition == "hints_given<2":
            return  # fresh fact: hints_given == 0 -> render hint, action try_hint
        if condition == "hints_given>=2":
            fs["hints_given"] = 2
            return  # cap reached -> action hint_cap_reached
        raise NotImplementedError(f"TRY/{condition}")

    if phase == "EVIDENCE":
        key = (phase, itype, condition)
        if key in UNREACHABLE:
            raise NotImplementedError(UNREACHABLE[key])
        return _drive_to_evidence(eng, condition, itype)

    if phase == "RECALL":
        eng.state["current_phase"] = "RECALL"
        if condition == "recall_turns>=2":
            eng.state["recall_turns"] = 2
        return

    if phase == "CAPSULE_COMPLETE":
        eng._complete_capsule()  # sets closure_state="offered"
        if condition == "closure_state==recap_done":
            eng.state["closure_state"] = "recap_done"
        # "any" and "closure_state==offered" both satisfied by _complete_capsule
        return

    raise NotImplementedError(f"{phase}/{condition}")


def _drive_to_evidence(eng, condition, itype):
    """Position the engine inside EVIDENCE COLLECT for the given condition.

    Sizing strategy:
      - queue_has_next  -> 2 facts, act on f1 (f2 still queued)
      - queue_empty_after_pop / evidence_failed_nonempty / remediation entry
        -> arrange the queue so this turn empties it, with the right failure
        state. LIGHT remediation tier needs failure-rate <=20% (1 of 5)."""
    # "any" is used by the EVIDENCE non-answer rows (question/confirmation/
    # teaching/off_topic -> wait). Park in COLLECT with a 2-fact queue intact so
    # the post-fix no-op is observable (and the pre-fix FAILED is caught) without
    # the turn emptying the queue into remediation/completion.
    if condition == "any":
        _rebuild(eng, n=2)
        eng._start_evidence()
        return

    followup = "evidence_followup==true" in condition
    has_next = "queue_has_next" in condition
    # All four "evidence_remediation_LIGHT" rows enter remediation when the LAST
    # fact fails and the queue empties. The action string encodes the tier, which
    # is failure-rate driven (the contract uses LIGHT as the representative
    # entry-point action — see task-3 report). Build a 5-fact run where the first
    # 4 pass so the single trailing failure is 1/5 = 20% = LIGHT, matching the
    # contract's representative action exactly.
    light = (itype in ("student_incorrect", "student_confused")
             and "queue_empty_after_pop" in condition)

    if light:
        _rebuild(eng, n=5)
        eng._start_evidence()
        for _ in range(4):
            eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        # queue now [f5]; this itype empties it -> 1 failed of 5 -> LIGHT tier
        if followup:
            eng.fact_status("f5")["evidence_followup"] = True
        return

    if has_next:
        _rebuild(eng, n=2)
        eng._start_evidence()       # queue [f1,f2]
        if followup:
            eng.fact_status("f1")["evidence_followup"] = True
        return

    # queue_empty_after_pop, single fact
    _rebuild(eng, n=1)
    eng._start_evidence()           # queue [f1]
    if followup:
        eng.fact_status("f1")["evidence_followup"] = True
    return


class TestTransitionsMatchEngine(unittest.TestCase):
    """For every itype-driven contract row, drive the real engine to the row's
    `from` phase with its `condition` satisfied, fire the itype, and assert the
    engine returns the row's `to` and `action`."""

    # Rows whose `action` is the remediation TIER, which depends on failure
    # rate. The contract uses LIGHT as the representative entry-point action;
    # drive_to_phase sets up a <=20% failure rate so the engine actually emits
    # evidence_remediation_LIGHT.
    def test_each_contract_row_matches_engine(self):
        c = loader.load_contract()
        asserted = 0
        skipped = []
        failures = []
        for t in loader.transitions(c):
            if "from" not in t:  # comment-only separator rows
                continue
            _apply_flags(t.get("flags"))
            eng = make_engine()
            try:
                drive_to_phase(eng, t["from"], t["condition"], t["itype"])
            except NotImplementedError as e:
                skipped.append(f"{t['from']}/{t['itype']} [{t['condition']}]: {e}")
                continue
            try:
                res = eng.process_assessor_result(t["itype"],
                                                  student_message=_msg_for(t["itype"]))
            except Exception as e:  # noqa: BLE001 — engine refused a documented transition
                failures.append(f"{t['from']}/{t['itype']} [{t['condition']}] raised {e!r}")
                continue
            if res.get("new_phase") != t["to"] or res.get("action") != t["action"]:
                failures.append(
                    f"{t['from']}/{t['itype']} [{t['condition']}] expected "
                    f"{t['to']}/{t['action']} got {res.get('new_phase')}/{res.get('action')}")
            else:
                asserted += 1

        # Coverage report (printed on success too, for the task record).
        total = sum(1 for t in loader.transitions(c) if "from" in t)
        print(f"\n[contract coverage] {asserted} of {total} itype-driven rows "
              f"asserted; {len(skipped)} documented-unreachable skipped.")
        for s in skipped:
            print(f"  SKIP {s}")

        self.assertFalse(failures, "contract drift:\n" + "\n".join(failures))
        # Only the two documented EVIDENCE failed_empty rows may be skipped.
        self.assertEqual(len(skipped), 2,
                         "unexpected uncovered rows:\n" + "\n".join(skipped))

    def test_uncovered_rows_are_exactly_the_documented_set(self):
        c = loader.load_contract()
        present = {(t["from"], t["itype"], t["condition"])
                   for t in loader.transitions(c) if "from" in t}
        for key in UNREACHABLE:
            self.assertIn(key, present,
                          f"documented-unreachable row {key} not found in contract "
                          "(stale UNREACHABLE entry)")


class TestPracticeCompletesSession(unittest.TestCase):
    """v006.10: the last fact's TRY completion ends the session with EVIDENCE
    primed. EVIDENCE questions never run in the same session as teaching — the
    next session restores the engine and runs the final check."""

    def test_last_try_ends_session_with_evidence_primed(self):
        _apply_flags({})
        eng = make_engine(n=1)
        _teach_then_try(eng)
        res = eng.process_assessor_result("student_correct",
                                          student_message=SUBSTANTIVE)
        self.assertEqual(res.get("new_phase"), "EVIDENCE")
        self.assertEqual(res.get("action"), "practice_complete_end")
        self.assertTrue(res.get("prompt_text"),
                        "wrap-up transition must carry a tutor instruction")
        self.assertTrue(eng.should_end_session())
        self.assertEqual(eng.state["evidence_phase"], "COLLECT")
        self.assertEqual(eng.state["evidence_queue"], ["f1"])

    def test_mid_capsule_fact_completion_also_ends_session(self):
        """v006.11: ONE fact per session — completing any fact ends the
        session with the next incomplete fact primed at TEACH."""
        _apply_flags({})
        eng = make_engine(n=2)
        _teach_then_try(eng)
        res = eng.process_assessor_result("student_correct",
                                          student_message=SUBSTANTIVE)
        self.assertEqual(res.get("new_phase"), "TEACH")
        self.assertEqual(res.get("action"), "fact_complete_end")
        self.assertTrue(eng.should_end_session())
        self.assertEqual(eng.current_fact_id, "f2")
        self.assertTrue(eng.fact_status("f1").get("scaffold_complete"))

    def test_restored_session_resumes_evidence_without_ending(self):
        _apply_flags({})
        eng = make_engine(n=1)
        _teach_then_try(eng)
        eng.process_assessor_result("student_correct",
                                    student_message=SUBSTANTIVE)
        saved = deepcopy(eng.serialize())

        eng2 = SessionEngine(deepcopy(DECISION_TREE), PERSONA, CURRICULUM)
        eng2.restore(saved)
        self.assertEqual(eng2.current_phase, "EVIDENCE")
        self.assertFalse(eng2.should_end_session(),
                         "restored session must run EVIDENCE, not instantly end")
        res = eng2.process_assessor_result("student_correct",
                                           student_message=SUBSTANTIVE)
        self.assertEqual(res.get("new_phase"), "CAPSULE_COMPLETE")
        self.assertEqual(res.get("action"), "FULLY_MASTERED")


class TestOneFactPerSession(unittest.TestCase):
    """v006.11: each session teaches exactly one fact, and sessions always
    resume at the FIRST incomplete fact in display order — previously skipped
    facts are picked back up instead of leaving permanent holes."""

    def test_next_session_resumes_next_fact_in_order(self):
        _apply_flags({})
        eng = make_engine(n=3)
        _teach_then_try(eng)
        eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        saved = deepcopy(eng.serialize())

        eng2 = SessionEngine(deepcopy(DECISION_TREE), PERSONA, CURRICULUM)
        eng2.restore(saved)
        self.assertFalse(eng2.should_end_session())
        self.assertEqual(eng2.current_phase, "TEACH")
        self.assertEqual(eng2.current_fact_id, "f2")
        self.assertEqual(eng2.remaining_fact_texts(), ["fact 2", "fact 3"])

    def test_restore_heals_position_back_to_skipped_fact(self):
        """A stale position past incomplete facts (how older engine versions
        left skips behind) snaps back to the earliest incomplete fact."""
        _apply_flags({})
        eng = make_engine(n=3)
        _teach_then_try(eng)
        eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        saved = deepcopy(eng.serialize())
        # Simulate a legacy blob whose position jumped past f2 to f3
        saved["state"]["current_fact_index"] = 2
        saved["state"]["practice_complete_end"] = False

        eng2 = SessionEngine(deepcopy(DECISION_TREE), PERSONA, CURRICULUM)
        eng2.restore(saved)
        self.assertEqual(eng2.current_fact_id, "f2",
                         "restore must heal back to the first incomplete fact")

    def test_restore_never_resumes_mid_try_and_resets_attempts(self):
        """A new session is a FRESH run of its fact. A mid-TRY save must come
        back as TEACH with attempt counters reset — otherwise the first reply
        gets graded as a TRY answer to a question the greeting never asked,
        and carried-over try_attempts let one partial answer complete the
        fact ('2 attempts = accept') and end the session in a single turn."""
        _apply_flags({})
        eng = make_engine(n=2)
        _teach_then_try(eng)
        # One partial attempt recorded, still in TRY on f1
        eng.process_assessor_result("student_partially_correct",
                                    student_message=SUBSTANTIVE)
        self.assertEqual(eng.current_phase, "TRY")
        self.assertEqual(eng.fact_status("f1")["try_attempts"], 1)
        saved = deepcopy(eng.serialize())

        eng2 = SessionEngine(deepcopy(DECISION_TREE), PERSONA, CURRICULUM)
        eng2.restore(saved)
        self.assertEqual(eng2.current_phase, "TEACH")
        self.assertEqual(eng2.current_fact_id, "f1")
        self.assertEqual(eng2.fact_status("f1")["try_attempts"], 0)

        # In the fresh session, a single partial answer must be a retry
        # prompt (attempt 1), NOT an accepted completion.
        eng2.process_assessor_result("student_understands")  # TEACH -> TRY
        r = eng2.process_assessor_result("student_partially_correct",
                                         student_message=SUBSTANTIVE)
        self.assertEqual(r.get("action"), "feedback_reassess")
        self.assertFalse(eng2.should_end_session())

    def test_start_at_fact_overrides_position_and_prompt_order(self):
        """An explicit start-session selection positions the session on that
        fact; the prompt's remaining list leads with it; completing it primes
        the first incomplete fact again (display order)."""
        _apply_flags({})
        eng = make_engine(n=3)
        self.assertTrue(eng.start_at_fact("f2"))
        self.assertEqual(eng.current_fact_id, "f2")
        self.assertEqual(eng.remaining_fact_texts(),
                         ["fact 2", "fact 1", "fact 3"])
        _teach_then_try(eng)
        r = eng.process_assessor_result("student_correct",
                                        student_message=SUBSTANTIVE)
        self.assertEqual(r.get("action"), "fact_complete_end")
        self.assertEqual(eng.current_fact_id, "f1")

    def test_start_at_fact_refuses_completed_or_unknown_facts(self):
        _apply_flags({})
        eng = make_engine(n=2)
        _teach_then_try(eng)
        eng.process_assessor_result("student_correct",
                                    student_message=SUBSTANTIVE)  # f1 done
        self.assertFalse(eng.start_at_fact("f1"), "completed fact must be refused")
        self.assertFalse(eng.start_at_fact("no-such-fact"))
        self.assertEqual(eng.current_fact_id, "f2")

    def test_completed_fact_counts_as_taught_without_teach_confirmation(self):
        """A fact finished via move_on -> TRY -> correct never got an explicit
        TEACH confirmation, so teach_complete was unset and the fact was
        missing from facts_taught — report-card is_taught, progress bars, and
        start-session pills all showed it as not done."""
        _apply_flags({})
        eng = make_engine(n=2)
        eng.process_assessor_result("student_move_on")  # TEACH -> TRY, no confirm
        r = eng.process_assessor_result("student_correct",
                                        student_message=SUBSTANTIVE)
        self.assertEqual(r.get("action"), "fact_complete_end")
        self.assertIn("fact 1", eng.facts_taught)

    def test_restore_with_everything_complete_primes_evidence(self):
        _apply_flags({})
        eng = make_engine(n=1)
        _teach_then_try(eng)
        eng.process_assessor_result("student_correct", student_message=SUBSTANTIVE)
        saved = deepcopy(eng.serialize())
        # Simulate a legacy blob left in TEACH despite all facts complete
        saved["state"]["current_phase"] = "TEACH"
        saved["state"]["evidence_phase"] = None
        saved["state"]["practice_complete_end"] = False

        eng2 = SessionEngine(deepcopy(DECISION_TREE), PERSONA, CURRICULUM)
        eng2.restore(saved)
        self.assertEqual(eng2.current_phase, "EVIDENCE")
        self.assertEqual(eng2.state.get("evidence_phase"), "COLLECT")
        self.assertFalse(eng2.should_end_session())


class TestNoSilentCatchAll(unittest.TestCase):
    """Every interaction_type valid for a phase must produce an explicit,
    intended outcome — not fall into a generic else that mis-grades (e.g.
    EVIDENCE marking a clarifying question FAILED)."""
    NON_ANSWER = {"student_question", "confirmation", "teaching", "off_topic"}

    def test_evidence_does_not_fail_facts_on_non_answer_types(self):
        c = loader.load_contract()
        for itype in self.NON_ANSWER:
            if itype not in loader.taxonomy(c)["valid_per_phase"]["EVIDENCE"]:
                continue
            _apply_flags({})
            eng = make_engine(n=2)
            eng._start_evidence()
            before_failed = list(eng.state.get("evidence_failed", []))
            fid = eng.state["evidence_queue"][0]
            r = eng.process_assessor_result(itype,
                                            student_message="wait, what does that mean?")
            self.assertEqual(eng.state.get("evidence_failed", []), before_failed,
                             f"EVIDENCE marked a fact FAILED on non-answer type {itype!r}")
            self.assertIsNone(eng.fact_status(fid).get("evidence_result"),
                              f"EVIDENCE recorded a result on non-answer type {itype!r}")
            self.assertEqual(r.get("action"), "wait",
                             f"EVIDENCE non-answer {itype!r} should be a wait no-op")
            self.assertEqual(r.get("new_phase"), "EVIDENCE")

    def test_evidence_followup_does_not_fail_facts_on_non_answer_types(self):
        """ADO-89: a non-answer turn during the partial-correct second-chance
        (evidence_followup=True) must NOT burn the fact to FAILED or consume the
        follow-up — same no-op guarantee as the normal COLLECT path."""
        c = loader.load_contract()
        for itype in self.NON_ANSWER:
            if itype not in loader.taxonomy(c)["valid_per_phase"]["EVIDENCE"]:
                continue
            _apply_flags({})
            eng = make_engine(n=2)
            eng._start_evidence()
            fid = eng.state["evidence_queue"][0]
            eng.fact_status(fid)["evidence_followup"] = True  # mid second-chance
            before_failed = list(eng.state.get("evidence_failed", []))
            r = eng.process_assessor_result(itype,
                                            student_message="wait, what does that mean?")
            self.assertEqual(eng.state.get("evidence_failed", []), before_failed,
                             f"EVIDENCE followup marked a fact FAILED on {itype!r}")
            self.assertIsNone(eng.fact_status(fid).get("evidence_result"),
                              f"EVIDENCE followup recorded a result on {itype!r}")
            self.assertTrue(eng.fact_status(fid).get("evidence_followup"),
                            f"EVIDENCE followup slot consumed by non-answer {itype!r}")
            self.assertEqual(r.get("action"), "wait",
                             f"EVIDENCE followup non-answer {itype!r} should be a wait no-op")
            self.assertEqual(r.get("new_phase"), "EVIDENCE")


if __name__ == "__main__":
    unittest.main()
