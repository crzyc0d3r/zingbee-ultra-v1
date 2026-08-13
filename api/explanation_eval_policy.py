"""Policy/constants for explanation evaluation judges.

Mirrors image_eval_policy.py structure. Reuses the same DecisionResult dataclass
and threshold tiers (SHIP >= 0.85, REVIEW >= 0.50, REGENERATE < 0.50).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from image_eval_policy import DecisionResult, DEFAULT_THRESHOLDS


EXPLANATION_JUDGE_NAMES = [
    "pedagogical_accuracy",
    "age_appropriateness",
    "fact_alignment",
    "clarity",
    "engagement",
]

EXPLANATION_WEIGHTS = {
    "pedagogical_accuracy": 0.25,
    "age_appropriateness": 0.20,
    "fact_alignment": 0.20,
    "clarity": 0.20,
    "engagement": 0.15,
}

# Critical flags that auto-REGENERATE an explanation
EXPLANATION_CRITICAL_FLAGS = {
    "factual_error",
    "inappropriate_content",
    "asks_question_during_teach",
}

# System prompts for each judge
JUDGE_SYSTEM_PROMPTS = {
    "pedagogical_accuracy": (
        "You are an expert curriculum evaluator. Assess whether this teaching explanation "
        "is factually correct and pedagogically sound. Does it teach the concept accurately? "
        "Are there any factual errors or misleading simplifications?\n\n"
        "Respond with JSON: {\"score\": 0.0-1.0, \"flags\": [], \"reasoning\": \"...\"}\n"
        "Flags to use if applicable: factual_error, misleading_simplification"
    ),
    "age_appropriateness": (
        "You are a child development specialist. Assess whether this teaching explanation "
        "uses language, vocabulary, and concepts appropriate for the target age range. "
        "Is it too simple? Too complex? Does it use inappropriate terms?\n\n"
        "Respond with JSON: {\"score\": 0.0-1.0, \"flags\": [], \"reasoning\": \"...\"}\n"
        "Flags to use if applicable: inappropriate_content, too_complex, too_simple"
    ),
    "fact_alignment": (
        "You are a curriculum alignment checker. Assess whether this explanation accurately "
        "teaches the SPECIFIC fact provided, not a related or adjacent concept. "
        "Does the explanation drift to other topics?\n\n"
        "Respond with JSON: {\"score\": 0.0-1.0, \"flags\": [], \"reasoning\": \"...\"}\n"
        "Flags to use if applicable: topic_drift, wrong_fact"
    ),
    "clarity": (
        "You are a writing clarity expert for educational content. Assess whether this "
        "explanation is clear, concise, and unambiguous. Can a student understand it "
        "on first reading? Are there confusing sentences or vague references?\n\n"
        "Respond with JSON: {\"score\": 0.0-1.0, \"flags\": [], \"reasoning\": \"...\"}\n"
        "Flags to use if applicable: ambiguous, verbose, confusing"
    ),
    "engagement": (
        "You are a student engagement specialist. Assess whether this explanation is "
        "interesting and engaging for a student of the target age. Would they want to "
        "keep reading? Does it connect to their world?\n\n"
        "Respond with JSON: {\"score\": 0.0-1.0, \"flags\": [], \"reasoning\": \"...\"}\n"
        "Flags to use if applicable: boring, disconnected"
    ),
}

# M-6: Per-judge temperatures for independent signal.
# Divergent temperatures reduce inter-rater correlation and expose genuine disagreement.
JUDGE_TEMPERATURES = {
    "pedagogical_accuracy": 0.15,  # near-deterministic on factual correctness
    "age_appropriateness":  0.30,  # more variation — age calibration is subjective
    "fact_alignment":       0.10,  # near-deterministic on topic drift detection
    "clarity":              0.20,
    "engagement":           0.40,  # highest subjectivity; most variation needed
}

# Additional check: TEACH explanations must not ask questions
TEACH_QUESTION_CHECK_PROMPT = (
    "Does this teaching explanation ask the student any direct questions? "
    "TEACH phase explanations must be declarative, not interrogative. "
    "Respond with JSON: {\"asks_question\": true/false, \"reasoning\": \"...\"}"
)


def compute_explanation_decision(
    *,
    judges: dict[str, dict[str, Any]],
    thresholds: dict[str, float] | None = None,
) -> DecisionResult:
    """Compute weighted score and tier decision for an explanation.

    Same logic as image_eval_policy but with explanation-specific weights and flags.
    """
    _thresholds = thresholds or DEFAULT_THRESHOLDS

    # Skip unavailable judges (API errors) — don't penalise content for infra failures
    available_judges = {
        name: data for name, data in judges.items()
        if not data.get("unavailable")
    }

    composite = 0.0
    active_weight = 0.0
    for judge_name, weight in EXPLANATION_WEIGHTS.items():
        judge_data = available_judges.get(judge_name)
        if judge_data is None:
            continue
        score_val = judge_data.get("score")
        if score_val is None:
            continue
        composite += float(score_val) * weight
        active_weight += weight

    # Re-normalise if some judges were unavailable
    if active_weight > 0 and active_weight < 1.0:
        composite = composite / active_weight

    all_flags: set[str] = set()
    for data in judges.values():
        all_flags.update(data.get("flags") or [])
    # judge_error is informational, not a content quality signal
    all_flags.discard("judge_error")

    reasons: list[str] = []

    # Critical flag check
    if any(flag in EXPLANATION_CRITICAL_FLAGS for flag in all_flags):
        matched = [f for f in all_flags if f in EXPLANATION_CRITICAL_FLAGS]
        reasons.append(f"critical_flag:{','.join(matched)}")
        return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)

    # Per-dimension safety floors for child-facing content (C-2)
    age_data = available_judges.get("age_appropriateness")
    fact_data = available_judges.get("fact_alignment")
    age_score = age_data.get("score") if age_data else None
    fact_score = fact_data.get("score") if fact_data else None
    if age_score is not None and age_score < 0.6:
        reasons.append(f"age_appropriateness_floor:{age_score:.2f}<0.60")
        return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)
    if fact_score is not None and fact_score < 0.65:
        reasons.append(f"fact_alignment_floor:{fact_score:.2f}<0.65")
        return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)

    ship_threshold = float(_thresholds["ship"])
    review_threshold = float(_thresholds["review"])

    if composite >= ship_threshold:
        return DecisionResult(composite=composite, decision="SHIP", reasons=reasons)
    if composite >= review_threshold:
        return DecisionResult(composite=composite, decision="REVIEW", reasons=reasons)
    return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)
