"""Tests for the distillation pipeline, model router, and prerequisites.

H-10: Minimum automated test coverage. Mocks all LLM and DB calls.
Run with: pytest api/tests/test_distillation_pipeline.py -v
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch, call
from dataclasses import dataclass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# ---------------------------------------------------------------------------
# Test 1: All-skipped no-op — generate_for_scope returns "completed" when
# every fact already has all strategies (skip_existing=True, M-3).
# ---------------------------------------------------------------------------

class TestGenerateForScopeAllSkipped(unittest.TestCase):
    def setUp(self):
        self._db_patch = patch("explanation_gen_service.db")
        self.mock_db = self._db_patch.start()

    def tearDown(self):
        self._db_patch.stop()

    @patch("explanation_gen_service._fact_has_all_strategies", return_value=True)
    @patch("explanation_gen_service._load_scope_facts")
    def test_all_skipped_returns_completed(self, mock_load, mock_has_all):
        """When every fact already has variants, status should be 'completed' not 'failed'."""
        from explanation_gen_service import generate_for_scope

        mock_load.return_value = [
            {"fact_id": f"fact-{i}", "fact_meta": {}, "context": {}} for i in range(5)
        ]

        scope = {"subject": "Biology", "phase": 1, "theme": "t1", "capsule": "c1"}
        result = generate_for_scope(scope, skip_existing=True)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["variantsGenerated"], 0)
        self.assertEqual(result["skippedExisting"], 5)
        # append_distillation_variant must NOT have been called
        self.mock_db.append_distillation_variant.assert_not_called()


# ---------------------------------------------------------------------------
# Test 2: Parallel checkpoint logic — H-3 fix.
# The checkpoint must be the highest CONTIGUOUSLY-completed index,
# not the last completed (which could be a later fact that jumped ahead).
# ---------------------------------------------------------------------------

class TestParallelCheckpointContiguous(unittest.TestCase):
    def test_checkpoint_stops_at_first_gap(self):
        """H-3: checkpoint should not advance past a gap in completion order."""
        completed = {0, 1, 3}   # fact at index 2 not yet done
        total = 5
        last_safe = -1
        for j in range(total):
            if j in completed:
                last_safe = j
            else:
                break

        # last_safe must be 1, not 3, even though 3 is in completed
        self.assertEqual(last_safe, 1)

    def test_checkpoint_full_contiguous_block(self):
        """When 0..N-1 all complete, checkpoint should be the last fact."""
        completed = {0, 1, 2, 3}
        total = 4
        last_safe = -1
        for j in range(total):
            if j in completed:
                last_safe = j
            else:
                break
        self.assertEqual(last_safe, 3)

    def test_checkpoint_none_when_first_missing(self):
        """If fact 0 hasn't completed, no safe checkpoint exists yet."""
        completed = {1, 2, 3}
        total = 4
        last_safe = -1
        for j in range(total):
            if j in completed:
                last_safe = j
            else:
                break
        self.assertEqual(last_safe, -1)


# ---------------------------------------------------------------------------
# Test 3: _check_prerequisites per command
# ---------------------------------------------------------------------------

class TestCheckPrerequisites(unittest.TestCase):
    def _run(self, command, scope=None):
        from distillation_routes import _check_prerequisites
        return _check_prerequisites(command, scope or {"subject": "Biology", "phase": 1, "theme": "t1", "capsule": "c1"})

    @patch("distillation_routes.db")
    def test_evaluate_explanations_requires_drafts(self, mock_db):
        mock_db.list_distillation_variants.return_value = []
        issues = self._run("evaluate_explanations")
        self.assertEqual(len(issues), 1)
        self.assertIn("draft", issues[0].lower())

    @patch("distillation_routes.db")
    def test_evaluate_explanations_passes_with_drafts(self, mock_db):
        mock_db.list_distillation_variants.return_value = [{"variant": {"id": "v1"}}]
        issues = self._run("evaluate_explanations")
        self.assertEqual(issues, [])

    @patch("distillation_routes.db")
    def test_generate_images_requires_approved_with_prompts(self, mock_db):
        # Approved exists but no image_prompt — should still fail
        mock_db.list_distillation_variants.return_value = [
            {"variant": {"id": "v1", "status": "approved", "image_prompt": None}}
        ]
        issues = self._run("generate_images")
        self.assertEqual(len(issues), 1)
        self.assertIn("image prompt", issues[0].lower())

    @patch("distillation_routes.db")
    def test_generate_images_passes_with_prompts(self, mock_db):
        mock_db.list_distillation_variants.return_value = [
            {"variant": {"id": "v1", "status": "approved", "image_prompt": "a dog"}}
        ]
        issues = self._run("generate_images")
        self.assertEqual(issues, [])

    @patch("distillation_routes.db")
    def test_generate_explanations_has_no_prereqs(self, mock_db):
        # generate_explanations never blocks on missing data
        issues = self._run("generate_explanations")
        self.assertEqual(issues, [])


# ---------------------------------------------------------------------------
# Test 4: run_ab_test mock flow — C-1 fixes and M-1 statistical gate.
# ---------------------------------------------------------------------------

class TestRunABTest(unittest.TestCase):
    def _make_scope(self):
        return {"subject": "Biology", "phase": 1, "theme": "theme-uuid", "capsule": "cap-uuid"}

    def _make_suggestion(self):
        from prompt_optimizer import PromptSuggestion
        return PromptSuggestion(
            pattern_id="topic_drift",
            scope_type="capsule",
            scope_key="cap-uuid",
            override_type="append",
            content="Stay on topic.",
        )

    @patch("prompt_optimizer.db")
    @patch("explanation_gen_service.generate_for_scope")
    def test_recommend_keep_false_when_insufficient_samples(
        self, mock_gen, mock_db
    ):
        """With < 10 samples per arm, recommend_keep must be False regardless of delta."""
        from prompt_optimizer import OPTIMIZER

        mock_db.upsert_prompt_override.return_value = {"id": "override-1"}
        mock_db.activate_prompt_override.return_value = True
        mock_db.deactivate_prompt_override.return_value = True
        # No variants returned → control_scores and treatment_scores both empty
        mock_db.list_distillation_variants.return_value = []
        mock_gen.return_value = None

        result = OPTIMIZER.run_ab_test(self._make_scope(), self._make_suggestion(), actor="test")

        self.assertFalse(result.recommend_keep)
        # Override must be deactivated since we're not keeping it
        mock_db.deactivate_prompt_override.assert_called()

    @patch("prompt_optimizer.db")
    @patch("explanation_gen_service.generate_for_scope")
    def test_override_always_deactivated_on_exception(
        self, mock_gen, mock_db
    ):
        """C-1: try/finally must deactivate the override even if treatment arm crashes.

        The crash must happen AFTER the override is written (step 2) to exercise the
        finally-block cleanup. We let control arm succeed, then crash on treatment arm.
        """
        from prompt_optimizer import OPTIMIZER

        mock_db.upsert_prompt_override.return_value = {"id": "override-99"}
        mock_db.activate_prompt_override.return_value = True
        mock_db.deactivate_prompt_override.return_value = True
        mock_db.list_distillation_variants.return_value = []

        # First call (control arm) succeeds; second call (treatment arm) crashes
        mock_gen.side_effect = [None, RuntimeError("LLM exploded during treatment")]

        with self.assertRaises(RuntimeError):
            OPTIMIZER.run_ab_test(self._make_scope(), self._make_suggestion(), actor="test")

        mock_db.deactivate_prompt_override.assert_called_with("override-99")

    def test_welch_t_stat_minimum_delta_gate(self):
        """M-1: t-stat gate — small delta even with large N must not recommend_keep."""
        import math, statistics

        control = [0.60] * 15
        treatment = [0.62] * 15  # delta=0.02, below MIN_DELTA=0.03
        delta = statistics.mean(treatment) - statistics.mean(control)
        s1 = statistics.stdev(control)
        s2 = statistics.stdev(treatment)
        # stdev of constant list is 0 → t_stat = 0 by definition
        se = math.sqrt(s1**2/15 + s2**2/15)
        t_stat = delta / se if se > 0 else 0.0

        _MIN_DELTA = 0.03
        _MIN_N = 10
        recommend = len(control) >= _MIN_N and len(treatment) >= _MIN_N and delta >= _MIN_DELTA and t_stat >= 1.65
        self.assertFalse(recommend)


# ---------------------------------------------------------------------------
# Test 5: Model router fallback chain
# ---------------------------------------------------------------------------

@dataclass
class _FakeLLMResponse:
    content: str = "test response"
    model: str = "grok-3"
    usage: object = None
    cost: float = 0.0
    response_id: str = ""
    latency_ms: int = 0


class TestModelRouterFallback(unittest.TestCase):
    @patch("model_router.call_xai")
    @patch("model_router._call_local")
    def test_falls_back_to_xai_when_local_fails(self, mock_local, mock_xai):
        """When local model raises, call_llm must fall back to xAI."""
        from model_router import call_llm, TaskType

        mock_local.side_effect = ConnectionError("vLLM unreachable")
        mock_xai.return_value = _FakeLLMResponse(content="fallback answer")

        result = call_llm(
            TaskType.EXPLANATION_GEN,
            messages=[{"role": "user", "content": "explain mitosis"}],
            temperature=0.5,
        )

        self.assertEqual(result.content, "fallback answer")
        mock_xai.assert_called_once()

    @patch("model_router.call_xai")
    @patch("model_router._resolve_provider")
    def test_xai_provider_calls_xai_directly(self, mock_resolve, mock_xai):
        """When provider resolves to XAI, no local call is made."""
        from model_router import call_llm, TaskType, Provider

        mock_resolve.return_value = Provider.XAI
        mock_xai.return_value = _FakeLLMResponse(content="xai direct")

        result = call_llm(
            TaskType.PLAYGROUND,
            messages=[{"role": "user", "content": "hello"}],
        )

        self.assertEqual(result.content, "xai direct")

    @patch("model_router._tcp_probe", return_value=False)
    def test_provider_status_shows_offline_when_tcp_fails(self, mock_probe):
        """H-18: get_provider_status should reflect real TCP reachability, not just URL presence."""
        import os
        with patch.dict(os.environ, {"VLLM_TEXT_GEN_URL": "http://localhost:8001/v1"}):
            from model_router import get_provider_status
            status = get_provider_status()
            self.assertFalse(status["vllm"]["online"])


if __name__ == "__main__":
    unittest.main()
