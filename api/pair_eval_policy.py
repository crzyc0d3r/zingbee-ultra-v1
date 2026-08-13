"""Policy/constants for explanation+image pair evaluation judges.

Mirrors image_eval_policy.py / explanation_eval_policy.py structure.
Reuses the same DecisionResult dataclass and threshold tiers
(SHIP >= 0.85, REVIEW >= 0.50, REGENERATE < 0.50).

These judges evaluate the *coherence* of an explanation+image pair,
not the quality of each in isolation (that's handled by the individual
explanation and image eval pipelines).
"""

from __future__ import annotations

from typing import Any

from image_eval_policy import DecisionResult, DEFAULT_THRESHOLDS


PAIR_JUDGE_NAMES = [
    "visual_text_alignment",
    "pedagogical_coherence",
    "cognitive_load",
]

PAIR_WEIGHTS = {
    "visual_text_alignment": 0.40,
    "pedagogical_coherence": 0.35,
    "cognitive_load": 0.25,
}

# Critical flags that auto-REGENERATE a pair
PAIR_CRITICAL_FLAGS = {
    "image_contradicts_text",
    "unsafe_content",
    "completely_unrelated",
}

PAIR_JUDGE_SYSTEM_PROMPTS = {
    "visual_text_alignment": (
        "You are an educational content alignment expert. You are given a teaching "
        "explanation and an accompanying image, both created for the same curriculum fact.\n\n"
        "Assess whether the image accurately depicts, illustrates, or supports what "
        "the explanation describes. Does the image match the specific content of this "
        "explanation? Would a student looking at both understand the same concept?\n\n"
        "Score 1.0 = perfect visual match to the explanation text.\n"
        "Score 0.0 = image is completely unrelated or contradicts the explanation.\n\n"
        "Respond with JSON only: {\"score\": 0.0-1.0, \"flags\": [], \"reasoning\": \"...\"}\n"
        "Flags to use if applicable: image_contradicts_text, partially_related, "
        "wrong_subject, misleading_visual, unsafe_content"
    ),
    "pedagogical_coherence": (
        "You are a learning experience designer. You are given a teaching explanation "
        "and an accompanying image for a student of a specific age range.\n\n"
        "Assess whether the explanation and image work together as a coherent learning "
        "unit. Does the image reinforce the key concept in the explanation? Would a "
        "student understand more by seeing both together than either alone? Does the "
        "image add pedagogical value rather than being decorative?\n\n"
        "Score 1.0 = the pair creates a powerful, unified learning experience.\n"
        "Score 0.0 = the image adds no value or actively confuses the learning.\n\n"
        "Respond with JSON only: {\"score\": 0.0-1.0, \"flags\": [], \"reasoning\": \"...\"}\n"
        "Flags to use if applicable: purely_decorative, confusing_combination, "
        "reinforces_misconception, completely_unrelated, unsafe_content"
    ),
    "cognitive_load": (
        "You are a cognitive science expert specialising in educational materials. "
        "You are given a teaching explanation and an accompanying image for a student "
        "of a specific age range.\n\n"
        "Assess the cognitive load of the pair. Is the combination balanced and "
        "digestible, or is it overwhelming? Does the image duplicate information "
        "already clear in the text (redundant) or does it complement it? Is there "
        "too much visual complexity competing with the text?\n\n"
        "Score 1.0 = perfectly balanced, complementary pair with appropriate load.\n"
        "Score 0.0 = overwhelming, contradictory, or completely redundant.\n\n"
        "Respond with JSON only: {\"score\": 0.0-1.0, \"flags\": [], \"reasoning\": \"...\"}\n"
        "Flags to use if applicable: overwhelming, redundant, visually_cluttered, "
        "text_image_conflict"
    ),
}


def build_pair_judge_user_prompt(
    *,
    judge_name: str,
    fact_text: str,
    explanation_text: str,
    explanation_strategy: str,
    age_range: str,
    subject: str,
) -> str:
    """Build the text portion of the multimodal user message for a pair judge."""
    return (
        f"Subject: {subject}\n"
        f"Age range: {age_range}\n"
        f"Curriculum fact: {fact_text}\n"
        f"Explanation strategy: {explanation_strategy}\n\n"
        f"--- EXPLANATION TEXT ---\n{explanation_text}\n--- END EXPLANATION ---\n\n"
        "The accompanying image is attached. Evaluate the explanation+image pair "
        "according to your criteria."
    )


def compute_pair_decision(
    *,
    judges: dict[str, dict[str, Any]],
    thresholds: dict[str, float] | None = None,
) -> DecisionResult:
    """Compute weighted score and tier decision for a pair evaluation."""
    _thresholds = thresholds or DEFAULT_THRESHOLDS

    composite = 0.0
    for judge_name, weight in PAIR_WEIGHTS.items():
        score = float(judges.get(judge_name, {}).get("score", 0.0))
        composite += score * weight

    all_flags: set[str] = set()
    for data in judges.values():
        all_flags.update(data.get("flags") or [])

    reasons: list[str] = []

    if any(flag in PAIR_CRITICAL_FLAGS for flag in all_flags):
        matched = [f for f in all_flags if f in PAIR_CRITICAL_FLAGS]
        reasons.append(f"critical_flag:{','.join(matched)}")
        return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)

    ship_threshold = float(_thresholds["ship"])
    review_threshold = float(_thresholds["review"])

    if composite >= ship_threshold:
        return DecisionResult(composite=composite, decision="SHIP", reasons=reasons)
    if composite >= review_threshold:
        return DecisionResult(composite=composite, decision="REVIEW", reasons=reasons)
    return DecisionResult(composite=composite, decision="REGENERATE", reasons=reasons)
