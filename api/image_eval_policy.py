"""Shared policy/constants for image generation evaluation flows.

This module codifies March 31 decisions so CLI, API, and UI use one source.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


JUDGE_NAMES = [
    "child_safety",
    "fact_checker",
    "misinterpretation_hunter",
    "visual_clarity",
    "text_accuracy",
    "pedagogical_effectiveness",
    "cultural_representation",
]

# Transcript-aligned defaults:
# - SHIP if high score and no severe issues
# - REVIEW gray band for human-in-the-loop
# - REGENERATE when low score or critical risk
DEFAULT_THRESHOLDS = {
    "ship": 0.85,
    "review": 0.50,
}

STEM_WEIGHTS = {
    "child_safety": 0.20,
    "fact_checker": 0.20,
    "misinterpretation_hunter": 0.15,
    "visual_clarity": 0.10,
    "text_accuracy": 0.10,
    "pedagogical_effectiveness": 0.15,
    "cultural_representation": 0.10,
}

HUMANITIES_WEIGHTS = {
    "child_safety": 0.20,
    "fact_checker": 0.10,
    "misinterpretation_hunter": 0.20,
    "visual_clarity": 0.10,
    "text_accuracy": 0.10,
    "pedagogical_effectiveness": 0.20,
    "cultural_representation": 0.10,
}

HUMANITIES_SUBJECTS = {"English", "History", "Art", "Music", "Drama"}

# Unified weights: 7 image judges + 3 pair coherence judges (when distillation context is available).
# Image judges are scaled down proportionally to make room for pair coherence checks.
UNIFIED_STEM_WEIGHTS = {
    "child_safety": 0.14,
    "fact_checker": 0.14,
    "misinterpretation_hunter": 0.10,
    "visual_clarity": 0.07,
    "text_accuracy": 0.07,
    "pedagogical_effectiveness": 0.10,
    "cultural_representation": 0.07,
    # Pair coherence judges
    "visual_text_alignment": 0.12,
    "pedagogical_coherence": 0.10,
    "cognitive_load": 0.09,
}

UNIFIED_HUMANITIES_WEIGHTS = {
    "child_safety": 0.14,
    "fact_checker": 0.07,
    "misinterpretation_hunter": 0.14,
    "visual_clarity": 0.07,
    "text_accuracy": 0.07,
    "pedagogical_effectiveness": 0.14,
    "cultural_representation": 0.07,
    # Pair coherence judges
    "visual_text_alignment": 0.12,
    "pedagogical_coherence": 0.10,
    "cognitive_load": 0.08,
}

CRITICAL_FLAGS = {
    "unsafe_content",
    "garbled_text",
    "offensive_content",
}
CRITICAL_FLAG_COMBO = ("factual_error", "reinforces_misconception")

EVAL_RUBRIC_VERSION = 2  # v1 = 7 image judges, v2 = unified 10 judges with pair coherence


def make_eval_identity(*, unified: bool, mode: str, judge_names: list[str]) -> dict:
    """Build evaluation identity fingerprint for skip/re-eval decisions."""
    return {
        "rubric_version": EVAL_RUBRIC_VERSION,
        "unified": unified,
        "decision_mode": mode,
        "judge_names": sorted(judge_names),
    }


DEFAULT_GUARDRAILS = {
    "max_iterations_per_variant": 3,
    "max_variants_per_fact": 10,
    "max_regeneration_per_command": 200,
    "max_total_images_per_command": 500,
    "max_evaluations_per_command": 500,
    "max_runtime_seconds_per_command": 900,
    "require_human_review_after_failed_iterations": 2,
}


@dataclass
class DecisionResult:
    composite: float
    decision: str
    reasons: list[str]


def compute_composite_and_decision(
    *,
    judges: dict[str, dict[str, Any]],
    subject: str,
    thresholds: dict[str, float] | None = None,
    mode: str = "combined_consensus",
    unified: bool = False,
) -> DecisionResult:
    """Compute weighted score and tier decision.

    mode:
      - combined_consensus: weighted score + hard critical-flag checks
      - master_judge: currently same scoring path with explicit mode marker

    unified: when True, use the 10-judge unified weights that include pair
    coherence judges (visual_text_alignment, pedagogical_coherence, cognitive_load).
    Only set to True when distillation context was available during evaluation.
    """
    _thresholds = thresholds or DEFAULT_THRESHOLDS
    if unified:
        weights = UNIFIED_HUMANITIES_WEIGHTS if subject in HUMANITIES_SUBJECTS else UNIFIED_STEM_WEIGHTS
    else:
        weights = HUMANITIES_WEIGHTS if subject in HUMANITIES_SUBJECTS else STEM_WEIGHTS

    composite = 0.0
    for judge_name, weight in weights.items():
        score = float(judges.get(judge_name, {}).get("score", 0.0))
        composite += score * weight

    all_flags: set[str] = set()
    for data in judges.values():
        all_flags.update(data.get("flags") or [])

    reasons: list[str] = []
    if any(flag in CRITICAL_FLAGS for flag in all_flags):
        reasons.append("critical_flag")
        return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)
    if all(flag in all_flags for flag in CRITICAL_FLAG_COMBO):
        reasons.append("critical_combo")
        return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)

    # Hard-fail pair-coherence critical flags in unified mode
    if unified:
        from pair_eval_policy import PAIR_CRITICAL_FLAGS
        pair_critical = all_flags & PAIR_CRITICAL_FLAGS
        if pair_critical:
            reasons.append(f"pair_critical_flag:{','.join(sorted(pair_critical))}")
            return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)

    # Keep mode in reasons to preserve auditability of the decision strategy.
    reasons.append(f"mode:{mode}")
    ship_threshold = float(_thresholds["ship"])
    review_threshold = float(_thresholds["review"])
    if mode == "master_judge":
        # Conservative path: push auto-ship slightly higher and penalize very weak judges.
        ship_threshold = min(0.99, ship_threshold + 0.03)
        check_names = list(weights.keys())
        if any(float(judges.get(name, {}).get("score", 0.0)) < 0.35 for name in check_names):
            reasons.append("master_judge_low_outlier")
            return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)
    if composite >= ship_threshold:
        return DecisionResult(composite=composite, decision="SHIP", reasons=reasons)
    if composite >= review_threshold:
        return DecisionResult(composite=composite, decision="REVIEW", reasons=reasons)
    return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)
