"""Shared image prompt builder used by runtime and bulk generation."""

from __future__ import annotations


def build_educational_image_prompt(
    *,
    fact_text: str,
    subject: str,
    age_range: str,
    capsule_name: str,
    theme_name: str = "",
    strategy: str = "baseline",
) -> str:
    """Build the canonical fallback educational image prompt.

    This is intentionally centralized so interactive tutoring and batch generation
    use the same latest prompt structure.
    """
    topic_parts = [p for p in [capsule_name, theme_name] if p]
    topic = " - ".join(topic_parts) if topic_parts else subject
    base = (
        f"A bright, engaging educational illustration about {topic}. "
        f"Target learner age: {age_range}. "
        f"Core fact to teach: {fact_text}. "
        "Pixar-style cartoon, cheerful colors, clean lines, one unified scene. "
        "No speech bubbles, no text boxes, no labels unless absolutely necessary. "
        "Focus only on the single concept represented by the core fact."
    )
    strategy_key = (strategy or "baseline").strip().lower()
    if strategy_key == "text_free":
        return base + " Do not include any visible text, labels, symbols, or numbers."
    if strategy_key == "pedagogy":
        return base + " Use concrete visual scaffolding suitable for teaching and memory retention."
    if strategy_key == "visual_clarity":
        return base + " Keep a single focal point, low clutter, high contrast, and artifact-free anatomy."
    if strategy_key in ("high_fidelity", "nano_banana_pro"):
        return base + " Optimize for high-detail diffusion rendering while keeping educational clarity."
    return base


def supported_prompt_strategies() -> list[str]:
    return [
        "baseline",
        "text_free",
        "pedagogy",
        "visual_clarity",
        "high_fidelity",
        "nano_banana_pro",
    ]
