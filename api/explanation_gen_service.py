"""Explanation generation service for pre-generating fact distillations.

Generates 5 explanation variations per fact using different pedagogical strategies.
Pulls from the same runtime prompt sources (decision_tree.prompt_registry) to stay
in sync with live tutoring prompts.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import db
from helpers import parse_suggestions, parse_images
from model_router import call_llm, TaskType

import db as _db_module  # avoid shadowing local 'db' imports elsewhere
from prompt_engine import PromptEngine

log = logging.getLogger(__name__)

STRATEGIES = ["direct", "analogy", "story", "visual_verbal", "socratic"]

_MAX_PARALLEL_WORKERS = 8  # H-12: cap parallel workers to prevent DB connection exhaustion

# C-3: Override content safety
_OVERRIDE_MAX_LEN = 8000
_OVERRIDE_INJECTION_PATTERNS = [
    "ignore all previous",
    "ignore previous instructions",
    "disregard all",
    "<script",
    "javascript:",
    "you are now",
    "new persona",
]

# H-19: Image prompt safety blocklist
_IMAGE_PROMPT_BLOCKLIST = [
    "nude", "naked", "sexual", "violent", "gore", "weapon",
    "inappropriate", "explicit",
]

STRATEGY_INSTRUCTIONS = {
    "direct": (
        "Explain this fact in a straightforward, clear manner. "
        "Use precise language appropriate for the student's age."
    ),
    "analogy": (
        "Explain this fact using a relatable analogy or metaphor that a student "
        "of this age would connect with. Make the comparison vivid and memorable."
    ),
    "story": (
        "Explain this fact through a short narrative or scenario. "
        "Set the scene briefly, then weave the fact into the story naturally."
    ),
    "visual_verbal": (
        "Explain this fact using vivid visual language. Help the student picture "
        "the concept in their mind. Describe what it looks like, how it works visually."
    ),
    "socratic": (
        "Start with a thought-provoking question related to this fact, then "
        "guide the student to the answer through your explanation."
    ),
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fact_hash(meta_data: dict) -> str:
    """Hash a fact's meta_data for staleness detection."""
    raw = json.dumps(meta_data, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _template_hash(strategy_instruction: str) -> str:
    """Hash the strategy instruction used at generation time.

    M-13: stored on each variant so the optimizer can detect variants generated
    with a stale prompt template (e.g. after STRATEGY_INSTRUCTIONS changes in a deploy).
    The session_engine already filters by fact_hash; callers needing to flag template-stale
    variants should compare variant["template_hash"] against
    hashlib.sha256(STRATEGY_INSTRUCTIONS[strategy].encode()).hexdigest()[:16].
    """
    return hashlib.sha256(strategy_instruction.encode()).hexdigest()[:16]


def _load_scope_facts(scope: dict) -> list[dict]:
    """Load facts for a scope (subject/phase/theme/capsule) with full context.

    Returns list of dicts with: fact_id, fact_order, fact_meta, capsule_id,
    capsule_name, theme_name, phase, age_range, subject_name, context (session_context).
    """
    log.info("_load_scope_facts: scope=%s", scope)
    capsule_row = db.get_capsule_scope(
        scope["phase"], scope["theme"], scope["capsule"],
        subject_name=scope.get("subject"),
    )
    if not capsule_row:
        log.warning("_load_scope_facts: capsule NOT FOUND for scope=%s", scope)
        return []

    capsule_id = str(capsule_row["capsule_id"])
    log.info("_load_scope_facts: capsule found id=%s", capsule_id)
    ctx = db.get_session_context(capsule_id)
    if not ctx:
        log.warning("_load_scope_facts: session_context NOT FOUND for capsule_id=%s", capsule_id)
        return []

    facts = db.get_capsule_facts(capsule_id)
    log.info("_load_scope_facts: %d facts loaded for capsule_id=%s", len(facts), capsule_id)
    result = []
    for fact in facts:
        result.append({
            "fact_id": str(fact["id"]),
            "fact_order": fact["order"],
            "fact_meta": fact.get("meta_data") or {},
            "capsule_id": capsule_id,
            "capsule_name": ctx.get("capsule_name", ""),
            "theme_name": ctx.get("theme_name", ""),
            "phase": ctx.get("phase"),
            "age_range": ctx.get("age_range", ""),
            "subject_name": ctx.get("subject_name", ""),
            "context": ctx,
        })
    return result


def _build_prompt_engine(ctx: dict) -> PromptEngine:
    """Build a PromptEngine from a session context dict (same as runtime)."""
    decision_tree = ctx.get("decision_tree", {})
    persona = ctx.get("persona", {})
    curriculum = {
        "subject": ctx.get("subject_name", ""),
        "subject_lower": (ctx.get("subject_name") or "").lower(),
        "age_range": ctx.get("age_range", "10-12"),
        "phase": str(ctx.get("phase", 1)),
        "capsule_name": ctx.get("capsule_name", ""),
    }
    return PromptEngine(decision_tree, persona, curriculum)


def _validate_override_content(content: str) -> str:
    """Truncate and check override content for injection patterns. (C-3)"""
    if len(content) > _OVERRIDE_MAX_LEN:
        log.warning("Override content truncated from %d to %d chars", len(content), _OVERRIDE_MAX_LEN)
        content = content[:_OVERRIDE_MAX_LEN]
    content_lower = content.lower()
    for pattern in _OVERRIDE_INJECTION_PATTERNS:
        if pattern in content_lower:
            log.error("Potential injection pattern %r in override content — skipping override", pattern)
            raise ValueError(f"Override content contains disallowed pattern: {pattern!r}")
    return content


def _screen_image_prompt(image_prompt: str) -> str | None:
    """Return None and log if image_prompt contains unsafe content. (H-19)"""
    if not image_prompt:
        return None
    lc = image_prompt.lower()
    for word in _IMAGE_PROMPT_BLOCKLIST:
        if word in lc:
            log.warning("Image prompt flagged for unsafe content (%r), suppressing", word)
            return None
    return image_prompt


def apply_prompt_overrides(prompt_text: str, fact_info: dict, strategy: str) -> str:
    """Layer prompt overrides from the prompt_overrides table onto a base prompt.

    Queries overrides matching the scope hierarchy (capsule > theme > phase > subject > global)
    and applies them in specificity order. If no overrides exist, returns original prompt unchanged.
    """
    scope_keys = {"global": "all"}
    subject = fact_info.get("subject_name", "")
    phase = fact_info.get("phase")
    capsule_id = fact_info.get("capsule_id", "")

    if subject:
        scope_keys["subject"] = subject
    if subject and phase:
        scope_keys["phase"] = f"{subject}:{phase}"
    # H-8: Use theme UUID from capsule for consistent scope_key matching with optimizer
    capsule_theme_id = None
    try:
        if capsule_id:
            theme_row = _db_module.fetchone(
                "SELECT curriculum_theme_id FROM curriculum_capsules WHERE id = %s",
                (capsule_id,),
            )
            if theme_row:
                capsule_theme_id = str(theme_row["curriculum_theme_id"])
    except Exception as e:
        log.warning("Failed to look up theme UUID for scope_keys: %s", e)
    if capsule_theme_id:
        scope_keys["theme"] = capsule_theme_id
    elif fact_info.get("theme_name"):
        scope_keys["theme"] = fact_info["theme_name"]
    if capsule_id:
        scope_keys["capsule"] = capsule_id

    try:
        overrides = _db_module.get_prompt_overrides(scope_keys, "explanation_gen_system", strategy)
    except Exception as e:
        log.warning("Failed to load prompt overrides: %s", e)
        return prompt_text

    if not overrides:
        return prompt_text

    result = prompt_text
    for ov in overrides:
        ov_type = ov.get("override_type", "append")
        raw_content = ov.get("content", "")
        try:
            ov_content = _validate_override_content(raw_content)
        except ValueError as e:
            log.error("Skipping override %s due to validation failure: %s", ov.get("id"), e)
            continue
        if ov_type == "replace":
            result = ov_content
        elif ov_type == "prepend":
            result = ov_content + "\n\n" + result
        elif ov_type == "append":
            result = result + "\n\n" + ov_content

    return result


def generate_explanations_for_fact(
    fact_info: dict,
    *,
    strategies: list[str] | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> list[dict]:
    """Generate explanation variants for a single fact.

    Uses the runtime prompt template (step_teach) from the decision tree,
    augmented with a strategy-specific instruction.

    Returns list of draft distillation variant dicts ready for storage.
    """
    ctx = fact_info["context"]
    pe = _build_prompt_engine(ctx)
    fact_meta = fact_info["fact_meta"]
    strategies = strategies or STRATEGIES

    # Get the step_teach prompt rendered with fact vars (same as runtime)
    base_prompt = pe.build_step_transition("step_teach", fact_meta)

    tutor_name = (ctx.get("persona") or {}).get("tutor_name", "Tutor")
    age_range = ctx.get("age_range", "10-12")
    subject = ctx.get("subject_name", "")

    variants = []
    for strategy in strategies:
        strategy_instruction = STRATEGY_INSTRUCTIONS.get(strategy, "")

        # Compose the generation prompt: runtime template + strategy instruction
        system_msg = (
            f"You are {tutor_name}, a {subject} tutor for students aged {age_range}. "
            f"Generate a teaching explanation for a fact. "
            f"Your explanation must include an <EDUCATIONAL_IMAGE> block with a prompt "
            f"for generating a matching educational illustration, and a <SUGGESTIONS> "
            f"block with 2-3 student response options.\n\n"
            f"Strategy: {strategy_instruction}\n\n"
            f"IMPORTANT: Do NOT ask the student any questions. This is a TEACH step - "
            f"you are explaining, not quizzing."
        )

        # Apply per-scope prompt overrides (from prompt_overrides table)
        system_msg = apply_prompt_overrides(system_msg, fact_info, strategy)

        user_msg = base_prompt

        try:
            response = call_llm(
                TaskType.EXPLANATION_GEN,
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
                model=model,
            )
            text = response.content
        except Exception as e:
            log.error("LLM call failed for fact %s strategy %s: %s", fact_info["fact_id"], strategy, e)
            continue

        # Parse the response using the same parsers as runtime
        suggestions_result = parse_suggestions(text)
        images_result = parse_images(suggestions_result.get("clean_text", text))

        clean_text = images_result.get("clean_text", text).strip()
        raw_image_prompt = images_result.get("image_prompt")
        image_prompt = _screen_image_prompt(raw_image_prompt)  # H-19: safety screen before storage
        suggestions = suggestions_result.get("suggestions", [])

        variant = {
            "id": str(uuid.uuid4()),
            "version": "dv-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"),
            "status": "draft",
            "fact_hash": _fact_hash(fact_meta),
            "template_hash": _template_hash(strategy_instruction),  # M-13
            "strategy": strategy,
            "text": clean_text,
            "word_count": len(clean_text.split()),
            "generation_model": model or "default",
            "suggestions": suggestions[:3] if suggestions else ["Got it!", "I don't understand yet"],
            "image_prompt": image_prompt,
            "evaluation": {
                "scores": {},
                "composite_score": None,
                "decision": None,
            },
            "human_review": {
                "status": None,
                "reviewer": None,
                "reviewed_at": None,
            },
            "created_at": _utc_now_iso(),
        }
        variants.append(variant)

    return variants


def _fact_has_all_strategies(fact_id: str, strategies: list[str]) -> bool:
    """Check if a fact already has variants for all requested strategies."""
    try:
        existing = db.list_distillation_variants(fact_id=fact_id)
        existing_strategies = {
            r["variant"].get("strategy") for r in existing
            if r["variant"].get("status") not in ("rejected",)
        }
        return all(s in existing_strategies for s in strategies)
    except Exception:
        return False


def generate_for_scope(
    scope: dict,
    *,
    strategies: list[str] | None = None,
    model: str | None = None,
    max_facts: int = 0,
    skip_existing: bool = False,
    resume_from_fact: str | None = None,
    max_workers: int = 1,
    progress_callback: Callable[[dict], None] | None = None,
    is_cancelled: Callable[[], bool] | None = None,
) -> dict:
    """Generate explanation variants for all facts in a scope.

    Args:
        scope: {subject, phase, theme, capsule}
        strategies: List of strategies to use (default: all 5)
        model: LLM model override
        max_facts: Limit number of facts (0 = all)
        skip_existing: Skip facts that already have variants for all strategies
        resume_from_fact: Skip facts until this fact_id is reached (for job resume)
        max_workers: Parallel workers for generation (default 1 = serial)
        progress_callback: Called with progress snapshots
        is_cancelled: Check if job was cancelled

    Returns summary dict.
    """
    strategies = strategies or STRATEGIES
    facts = _load_scope_facts(scope)

    # Resume support: skip facts we've already processed in a prior run
    if resume_from_fact:
        resume_idx = None
        for idx, f in enumerate(facts):
            if f["fact_id"] == resume_from_fact:
                resume_idx = idx
                break
        if resume_idx is not None:
            facts = facts[resume_idx:]
            log.info("generate_for_scope: resuming from fact %s (skipped %d)", resume_from_fact, resume_idx)

    if max_facts > 0:
        facts = facts[:max_facts]

    # Skip existing: filter out facts that already have all strategies covered
    skipped = 0
    if skip_existing:
        filtered = []
        for f in facts:
            if _fact_has_all_strategies(f["fact_id"], strategies):
                skipped += 1
            else:
                filtered.append(f)
        facts = filtered
        if skipped:
            log.info("generate_for_scope: skipped %d facts with existing variants", skipped)

    total = len(facts)
    log.info("generate_for_scope: %d facts to process (max_facts=%s, skipped=%d, scope=%s)",
             total, max_facts, skipped, scope)
    generated = 0
    errors = []
    checkpoint_fact_id = None

    def _process_fact(fact_info: dict) -> tuple[int, list[str]]:
        """Process a single fact. Returns (count, errors)."""
        try:
            variants = generate_explanations_for_fact(
                fact_info, strategies=strategies, model=model,
            )
            for variant in variants:
                db.append_distillation_variant(fact_info["fact_id"], variant)
            return len(variants), []
        except Exception as e:
            log.error("Failed to generate for fact %s: %s", fact_info["fact_id"], e)
            return 0, [f"fact {fact_info['fact_id']}: {e}"]

    if max_workers > 1 and total > 1:
        # H-12: cap workers to prevent DB connection exhaustion
        workers = min(max_workers, _MAX_PARALLEL_WORKERS, total)
        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=workers) as pool:
            future_to_idx = {}
            for i, fact_info in enumerate(facts):
                if is_cancelled and is_cancelled():
                    break
                future = pool.submit(_process_fact, fact_info)
                future_to_idx[future] = (i, fact_info)

            completed_indices: set[int] = set()
            items_done = 0
            for future in as_completed(future_to_idx):
                if is_cancelled and is_cancelled():
                    break
                i, fact_info = future_to_idx[future]
                try:
                    count, errs = future.result()
                    generated += count
                    errors.extend(errs)
                except Exception as e:
                    errors.append(f"fact {fact_info['fact_id']}: {e}")

                completed_indices.add(i)
                items_done += 1

                # H-3: checkpoint = highest contiguously-completed index (safe to resume from)
                last_safe = -1
                for j in range(total):
                    if j in completed_indices:
                        last_safe = j
                    else:
                        break
                if last_safe >= 0:
                    checkpoint_fact_id = facts[last_safe]["fact_id"]

                if progress_callback:
                    progress_callback({
                        "status": "running",
                        "currentStage": "generating_explanations",
                        "itemsProcessed": items_done,
                        "totalCandidates": total,
                        "variantsGenerated": generated,
                        "skippedExisting": skipped,
                        "checkpointFactId": checkpoint_fact_id,
                        "errors": errors[-5:],
                    })
    else:
        # Serial processing (default)
        for i, fact_info in enumerate(facts):
            if is_cancelled and is_cancelled():
                break

            count, errs = _process_fact(fact_info)
            generated += count
            errors.extend(errs)
            checkpoint_fact_id = fact_info["fact_id"]

            if progress_callback:
                progress_callback({
                    "status": "running",
                    "currentStage": "generating_explanations",
                    "itemsProcessed": i + 1,
                    "totalCandidates": total,
                    "variantsGenerated": generated,
                    "skippedExisting": skipped,
                    "checkpointFactId": checkpoint_fact_id,
                    "errors": errors[-5:],
                })

    was_cancelled = is_cancelled and is_cancelled()
    if was_cancelled:
        status = "cancelled"
    elif generated == 0 and skipped > 0:
        status = "completed"  # M-3: all facts already had variants — valid no-op
    elif generated == 0:
        status = "failed"
    else:
        status = "completed"

    log.info("generate_for_scope: status=%s, generated=%d, skipped=%d, errors=%d",
             status, generated, skipped, len(errors))

    facts_done = min(len(facts), total)
    return {
        "status": status,
        "factsProcessed": facts_done,
        "variantsGenerated": generated,
        "skippedExisting": skipped,
        "checkpointFactId": checkpoint_fact_id,
        "errors": errors,
        # UI-expected fields (display aliases)
        "itemsProcessed": facts_done,
        "totalCandidates": total,
        "currentStage": status,
        **({"error": "No variants generated — check scope has facts and LLM keys are configured"} if generated == 0 and not was_cancelled else {}),
    }
