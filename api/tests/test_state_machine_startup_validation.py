"""Phase 3a (ADO-87) — load-bearing startup validation.

Asserts the engine refuses to start a session when its dispatchable phase set
has drifted from the canonical state-machine contract, that a clean engine +
contract validates without error, and that SM_CONTRACT_VALIDATION gates it.

Run with: pytest api/tests/test_state_machine_startup_validation.py -v
"""

import os
import sys
import unittest
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import session_engine
from session_engine import SessionEngine, StateMachineContractError
from state_machine import loader

PERSONA = {"tutor_name": "Aris", "persona_description": "a helpful tutor",
           "persona_traits": ["patient"]}
CURRICULUM = {"subject": "Biology", "subject_lower": "biology",
              "age_range": "10-12", "phase": 1, "capsule_name": "Organisms"}
DECISION_TREE = {"prompt_registry": {"step_teach": {"template": "[step_teach]"}}}


def _facts(n=2):
    return [{"id": f"f{i}", "meta_data": {"core_fact": f"fact {i}",
             "scaffold": ["TEACH", "TRY"]}} for i in range(1, n + 1)]


def _new_engine():
    return SessionEngine(deepcopy(DECISION_TREE), PERSONA, CURRICULUM)


class TestContractAgreesWithEngine(unittest.TestCase):
    """The shipped engine and the shipped contract must agree — this is the
    invariant the startup check enforces in production."""

    def test_real_contract_validates_clean(self):
        eng = _new_engine()
        problems = eng.validate_against_contract(strict=False)
        self.assertEqual(problems, [], "engine/contract drift: " + "; ".join(problems))

    def test_engine_phase_set_equals_contract_phase_set(self):
        c = loader.load_contract()
        contract_phases = set(loader.taxonomy(c)["valid_per_phase"].keys())
        self.assertEqual(set(SessionEngine._PHASE_HANDLERS), contract_phases)


class TestDriftIsRejected(unittest.TestCase):
    """A tampered contract must make validate_against_contract raise loudly."""

    def setUp(self):
        self.c = loader.load_contract()

    def test_contract_phase_engine_cannot_dispatch_raises(self):
        bad = deepcopy(self.c)
        bad["taxonomy"]["valid_per_phase"]["WARMUP"] = ["confirmation"]
        eng = _new_engine()
        with self.assertRaises(StateMachineContractError) as ctx:
            eng.validate_against_contract(contract=bad)
        self.assertIn("WARMUP", str(ctx.exception))

    def test_engine_phase_absent_from_contract_raises(self):
        bad = deepcopy(self.c)
        bad["taxonomy"]["valid_per_phase"].pop("RECALL")
        eng = _new_engine()
        with self.assertRaises(StateMachineContractError) as ctx:
            eng.validate_against_contract(contract=bad)
        self.assertIn("RECALL", str(ctx.exception))

    def test_undeclared_itype_in_valid_per_phase_raises(self):
        bad = deepcopy(self.c)
        bad["taxonomy"]["valid_per_phase"]["TEACH"].append("student_does_a_backflip")
        eng = _new_engine()
        with self.assertRaises(StateMachineContractError) as ctx:
            eng.validate_against_contract(contract=bad)
        self.assertIn("student_does_a_backflip", str(ctx.exception))

    def test_strict_false_collects_problems_without_raising(self):
        bad = deepcopy(self.c)
        bad["taxonomy"]["valid_per_phase"]["WARMUP"] = ["confirmation"]
        eng = _new_engine()
        problems = eng.validate_against_contract(contract=bad, strict=False)
        self.assertTrue(any("WARMUP" in p for p in problems))


class TestStartupGate(unittest.TestCase):
    """init_session runs the gate once per process, honoring SM_CONTRACT_VALIDATION."""

    def setUp(self):
        session_engine._CONTRACT_VALIDATED = False
        self._saved_handlers = dict(SessionEngine._PHASE_HANDLERS)
        self._saved_flag = os.environ.get("SM_CONTRACT_VALIDATION")

    def tearDown(self):
        SessionEngine._PHASE_HANDLERS = self._saved_handlers
        session_engine._CONTRACT_VALIDATED = False
        if self._saved_flag is None:
            os.environ.pop("SM_CONTRACT_VALIDATION", None)
        else:
            os.environ["SM_CONTRACT_VALIDATION"] = self._saved_flag

    def test_clean_engine_starts(self):
        os.environ.pop("SM_CONTRACT_VALIDATION", None)  # default mode
        eng = _new_engine()
        eng.init_session(_facts(), session_id="s1", student_id="stu1", capsule_id="cap1")
        self.assertEqual(eng.current_phase, "TEACH")

    def test_drifted_engine_refuses_to_start(self):
        os.environ.pop("SM_CONTRACT_VALIDATION", None)  # default mode → drift fatal
        # Drift the engine's dispatch set away from the contract.
        SessionEngine._PHASE_HANDLERS = dict(self._saved_handlers,
                                             BOGUS_PHASE="_process_teach")
        eng = _new_engine()
        with self.assertRaises(StateMachineContractError):
            eng.init_session(_facts(), session_id="s1", student_id="stu1", capsule_id="cap1")

    def test_flag_off_disables_gate(self):
        os.environ["SM_CONTRACT_VALIDATION"] = "false"
        SessionEngine._PHASE_HANDLERS = dict(self._saved_handlers,
                                             BOGUS_PHASE="_process_teach")
        eng = _new_engine()
        eng.init_session(_facts(), session_id="s1", student_id="stu1", capsule_id="cap1")
        self.assertEqual(eng.current_phase, "TEACH")

    def test_load_failure_default_mode_is_warn_only_and_does_not_latch(self):
        # A missing/unreadable contract file must NOT take down tutoring in the
        # default mode, AND must not latch the guardrail off for the process —
        # the next session retries the load.
        os.environ.pop("SM_CONTRACT_VALIDATION", None)
        from state_machine import loader as _loader
        orig = _loader.load_contract

        def _boom(*a, **k):
            raise FileNotFoundError("contract missing")

        _loader.load_contract = _boom
        try:
            eng = _new_engine()
            eng.init_session(_facts(), session_id="s1", student_id="stu1", capsule_id="cap1")
            self.assertEqual(eng.current_phase, "TEACH")  # session still starts
            self.assertFalse(session_engine._CONTRACT_VALIDATED,
                             "load failure must not latch the guardrail off")
        finally:
            _loader.load_contract = orig

    def test_load_failure_strict_mode_is_fatal(self):
        os.environ["SM_CONTRACT_VALIDATION"] = "strict"
        from state_machine import loader as _loader
        orig = _loader.load_contract

        def _boom(*a, **k):
            raise FileNotFoundError("contract missing")

        _loader.load_contract = _boom
        try:
            eng = _new_engine()
            with self.assertRaises(FileNotFoundError):
                eng.init_session(_facts(), session_id="s1", student_id="stu1", capsule_id="cap1")
        finally:
            _loader.load_contract = orig


if __name__ == "__main__":
    unittest.main()
