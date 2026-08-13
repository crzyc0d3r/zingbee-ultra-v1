"""Tests for the tutor_missing_acknowledgment compliance flag (ADO #26).

Observational only — an event is logged, never a correction turn.
Run with: pytest api/tests/test_assessor_engagement.py -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from assessor import check_compliance, run_assessor


class TestMissingAcknowledgment(unittest.TestCase):
    def test_flag_produces_violation_event_no_correction(self):
        assessment = {"tutor_compliance": {"tutor_missing_acknowledgment": True}}
        result = check_compliance(assessment, "TEACH")
        subtypes = [e["subtype"] for e in result["log_events"]]
        self.assertIn("missing_acknowledgment", subtypes)
        self.assertIsNone(result["pending_correction"])

    def test_flag_applies_in_every_step(self):
        # Acknowledgment is required everywhere — no step gate
        for step in ("TEACH", "TRY", "CHECK", "EVIDENCE", "RECALL",
                     "CHECK_REMEDIATION"):
            assessment = {"tutor_compliance": {"tutor_missing_acknowledgment": True}}
            result = check_compliance(assessment, step)
            subtypes = [e["subtype"] for e in result["log_events"]]
            self.assertIn("missing_acknowledgment", subtypes, f"missing in {step}")

    def test_absent_flag_produces_no_event(self):
        result = check_compliance({"tutor_compliance": {}}, "TEACH")
        subtypes = [e["subtype"] for e in result["log_events"]]
        self.assertNotIn("missing_acknowledgment", subtypes)

    def test_default_result_includes_acknowledgment_key(self):
        # run_assessor's defaults must carry the new flag so downstream
        # setdefault logic keeps the key present even on LLM failure
        def _boom(*a, **k):
            raise RuntimeError("no llm in tests")

        class _PE:
            def get_llm_config(self, role):
                return {}
            def build_assessor_prompt(self, **kwargs):
                return "sys", "user"

        result = run_assessor("t", "s", "p", {"core_fact": "f"}, "TEACH",
                              [], 0, 1, _boom, _PE())
        self.assertIn("tutor_missing_acknowledgment", result["tutor_compliance"])
        self.assertFalse(result["tutor_compliance"]["tutor_missing_acknowledgment"])


if __name__ == "__main__":
    unittest.main()
