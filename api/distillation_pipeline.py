"""Distillation pipeline orchestrator.

Chains explanation generation -> evaluation -> image generation -> image evaluation.
Explanations stored in curriculum_fact_distillations, images in curriculum_fact_images.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable

import db
from explanation_gen_service import generate_for_scope, _load_scope_facts, STRATEGIES
from helpers import extract_json
from explanation_eval_policy import (
    EXPLANATION_JUDGE_NAMES,
    JUDGE_SYSTEM_PROMPTS,
    JUDGE_TEMPERATURES,
    TEACH_QUESTION_CHECK_PROMPT,
    compute_explanation_decision,
)
from image_eval_service import SERVICE as IMAGE_SERVICE, _download_image_to_base64
from pair_eval_policy import (
    PAIR_JUDGE_NAMES,
    PAIR_JUDGE_SYSTEM_PROMPTS,
    build_pair_judge_user_prompt,
    compute_pair_decision,
)
from model_router import call_llm, TaskType

log = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _evaluate_single_explanation(
    variant: dict,
    fact_text: str,
    age_range: str,
    subject: str,
    *,
    judge_model: str | None = None,
    judge_temperature: float = 0.1,
) -> dict:
    """Run all explanation judges on a single variant. Returns updated variant dict."""
    explanation_text = variant.get("text", "")
    strategy = variant.get("strategy", "")

    judges_result: dict[str, dict[str, Any]] = {}

    for judge_name in EXPLANATION_JUDGE_NAMES:
        system_prompt = JUDGE_SYSTEM_PROMPTS.get(judge_name, "")
        user_prompt = (
            f"Fact: {fact_text}\n"
            f"Target age range: {age_range}\n"
            f"Subject: {subject}\n"
            f"Explanation strategy: {strategy}\n\n"
            f"Explanation to evaluate:\n{explanation_text}"
        )
        # M-6: use per-judge temperature for independent signal; fall back to caller value
        temp = JUDGE_TEMPERATURES.get(judge_name, judge_temperature)

        try:
            response = call_llm(
                TaskType.EXPLANATION_EVAL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temp,
                max_tokens=500,
                model=judge_model,
            )
            text = response.content
            # Extract JSON from response
            result = extract_json(text)
            judges_result[judge_name] = {
                "score": float(result.get("score", 0.0)),
                "flags": result.get("flags", []),
                "reasoning": result.get("reasoning", ""),
            }
        except Exception as e:
            log.error("Judge %s failed: %s", judge_name, e)
            judges_result[judge_name] = {"score": None, "flags": ["judge_error"], "reasoning": str(e), "unavailable": True}

    # Question check for TEACH explanations
    try:
        qc_response = call_llm(
            TaskType.EXPLANATION_EVAL,
            messages=[
                {"role": "system", "content": TEACH_QUESTION_CHECK_PROMPT},
                {"role": "user", "content": f"Explanation:\n{explanation_text}"},
            ],
            temperature=0.0,
            max_tokens=200,
            model=judge_model,
        )
        qc_text = qc_response.content
        qc_result = extract_json(qc_text)
        if qc_result.get("asks_question"):
            # Add the flag to the clarity judge
            if "clarity" in judges_result:
                judges_result["clarity"]["flags"].append("asks_question_during_teach")
            else:
                judges_result["clarity"] = {
                    "score": 0.3,
                    "flags": ["asks_question_during_teach"],
                    "reasoning": "Explanation asks questions during TEACH phase",
                }
    except Exception as e:
        log.warning("Question check failed: %s", e)

    # Compute decision
    decision = compute_explanation_decision(judges=judges_result)

    variant["evaluation"] = {
        "scores": judges_result,
        "composite_score": round(decision.composite, 4),
        "decision": decision.decision,
        "reasons": decision.reasons,
        "evaluated_at": _utc_now_iso(),
    }

    # Update status based on decision
    if decision.decision == "SHIP":
        variant["status"] = "approved"
    elif decision.decision == "REVIEW":
        variant["status"] = "review"
    elif decision.decision == "REGENERATE":
        variant["status"] = "rejected"

    return variant



class DistillationPipeline:
    """Orchestrates the full distillation pipeline."""

    SUPPORTED_COMMANDS = {
        "generate_explanations", "evaluate_explanations",
        "generate_images", "evaluate_images", "evaluate_pairs",
        "full_loop", "optimize_prompts",
    }

    def run_command(
        self,
        *,
        job_id: str,
        command: str,
        scope: dict,
        options: dict | None = None,
        actor: str = "pipeline",
        progress_callback: Callable[[dict], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> dict:
        options = options or {}
        start = time.time()

        if command == "generate_explanations":
            return self._cmd_generate_explanations(scope, options, progress_callback, is_cancelled)
        elif command == "evaluate_explanations":
            return self._cmd_evaluate_explanations(scope, options, progress_callback, is_cancelled)
        elif command == "generate_images":
            return self._cmd_generate_images(job_id, scope, options, actor, progress_callback, is_cancelled)
        elif command == "evaluate_images":
            return self._cmd_evaluate_images(job_id, scope, options, actor, progress_callback, is_cancelled)
        elif command == "evaluate_pairs":
            return self._cmd_evaluate_pairs(scope, options, actor, progress_callback, is_cancelled)
        elif command == "full_loop":
            return self._cmd_full_loop(job_id, scope, options, actor, progress_callback, is_cancelled)
        elif command == "optimize_prompts":
            return self._cmd_optimize_prompts(scope, options, actor, progress_callback, is_cancelled)
        else:
            return {"status": "error", "error": f"Unknown command: {command}"}

    def _cmd_generate_explanations(self, scope, options, progress_callback, is_cancelled):
        strategies = options.get("strategies") or STRATEGIES
        return generate_for_scope(
            scope,
            strategies=strategies,
            model=options.get("model"),
            max_facts=options.get("max_facts", 0),
            skip_existing=options.get("skip_existing", False),
            resume_from_fact=options.get("resume_from_fact"),
            max_workers=options.get("max_workers", 1),
            progress_callback=progress_callback,
            is_cancelled=is_cancelled,
        )

    def _cmd_evaluate_explanations(self, scope, options, progress_callback, is_cancelled):
        """Evaluate all draft/unevaluated explanation variants in scope."""
        variants = db.list_distillation_variants(
            subject_name=scope.get("subject"),
            phase=scope.get("phase"),
            theme_name=scope.get("theme"),
            capsule_name=scope.get("capsule"),
            status="draft",
        )

        total = len(variants)
        evaluated = 0
        max_evals = options.get("max_evaluations", 500)

        for i, row in enumerate(variants):
            if is_cancelled and is_cancelled():
                break
            if evaluated >= max_evals:
                break

            variant = row["variant"]
            fact_text = row["fact_text"]
            age_range = row.get("age_range", "10-12")
            subject = row.get("subject_name", "")

            updated = _evaluate_single_explanation(
                variant, fact_text, age_range, subject,
                judge_model=options.get("judge_model"),
            )

            # Persist evaluation (merge into locked copy, don't replace whole variant)
            def _apply_eval(v, _eval=updated["evaluation"], _status=updated.get("status")):
                v["evaluation"] = _eval
                if _status:
                    v["status"] = _status
                return v
            db.update_distillation_variant(
                row["fact_id"],
                variant["id"],
                _apply_eval,
            )
            evaluated += 1

            if progress_callback:
                progress_callback({
                    "status": "running",
                    "currentStage": "evaluating_explanations",
                    "itemsProcessed": evaluated,
                    "totalCandidates": min(total, max_evals),
                })

        was_cancelled = is_cancelled and is_cancelled()
        if was_cancelled:
            status = "cancelled"
        elif evaluated == 0:
            status = "failed"
        else:
            status = "completed"

        return {
            "status": status,
            "evaluated": evaluated,
            "total": total,
            **({"error": "No variants evaluated — check scope has draft distillations"} if evaluated == 0 and not was_cancelled else {}),
        }

    def _cmd_generate_images(self, job_id, scope, options, actor, progress_callback, is_cancelled):
        """Generate 5 images per approved explanation using the existing image pipeline."""
        approved = db.list_distillation_variants(
            subject_name=scope.get("subject"),
            phase=scope.get("phase"),
            theme_name=scope.get("theme"),
            capsule_name=scope.get("capsule"),
            status="approved",
        )

        total = len(approved)
        # Filter to rows with usable image prompts
        approved = [r for r in approved if r["variant"].get("image_prompt")]
        usable = len(approved)

        # Apply explanation cap (img_max_explanations takes priority, falls back to max_facts)
        max_explanations = options.get("img_max_explanations") or options.get("max_facts", 0)
        if max_explanations > 0:
            approved = approved[:max_explanations]

        generated = 0
        variants_per_explanation = options.get("variants_per_fact", 5)

        for i, row in enumerate(approved):
            if is_cancelled and is_cancelled():
                break

            variant = row["variant"]
            image_prompt = variant.get("image_prompt")

            # Use existing image service to generate images for this fact
            # The image_prompt was generated in the context of this explanation
            image_scope = {
                "subject": scope.get("subject"),
                "phase": scope["phase"],
                "theme": scope["theme"],
                "capsule": scope["capsule"],
            }

            fact_id = str(row["fact_id"])
            try:
                result = IMAGE_SERVICE.run_command(
                    job_id=f"{job_id}_img_{i}",
                    command="generate",
                    scope=image_scope,
                    options={
                        "variants_per_fact": variants_per_explanation,
                        "max_facts": 1,
                        "fact_ids": [fact_id],
                        "source_prompts": {fact_id: image_prompt},
                        "distillation_variant_id": variant["id"],
                        "max_runtime_sec": options.get("max_runtime_sec", 300),
                    },
                    actor=actor,
                )
                generated += result.get("count", 0)
            except Exception as e:
                log.error("Image generation failed for explanation %s: %s", variant["id"], e)

            if progress_callback:
                progress_callback({
                    "status": "running",
                    "currentStage": "generating_images",
                    "itemsProcessed": i + 1,
                    "totalApproved": total,
                    "usableApproved": usable,
                    "cappedTo": len(approved),
                    "imagesGenerated": generated,
                })

        was_cancelled = is_cancelled and is_cancelled()
        if was_cancelled:
            status = "cancelled"
        elif generated == 0:
            status = "failed"
        else:
            status = "completed"

        return {
            "status": status,
            "explanationsProcessed": i + 1 if approved else 0,
            "totalApproved": total,
            "usableApproved": usable,
            "imagesGenerated": generated,
            **({"error": "No images generated — check approved distillations have image prompts"} if generated == 0 and not was_cancelled else {}),
        }

    def _cmd_evaluate_images(self, job_id, scope, options, actor, progress_callback, is_cancelled):
        """Evaluate images against both the distillation AND the underlying fact.

        Builds a distillation_context dict mapping distillation_variant_id -> {text, strategy}
        so that image judges can see the explanation text the image was generated from.
        """
        # Build distillation context: map variant_id -> {text, strategy}
        distillation_context = {}
        try:
            approved = db.list_distillation_variants(
                subject_name=scope.get("subject"),
                phase=scope.get("phase"),
                theme_name=scope.get("theme"),
                capsule_name=scope.get("capsule"),
                status="approved",
            )
            for row in approved:
                v = row["variant"]
                vid = v.get("id")
                if vid:
                    distillation_context[vid] = {
                        "text": v.get("text", ""),
                        "strategy": v.get("strategy", ""),
                    }
        except Exception as e:
            log.warning("Failed to load distillation context for image eval: %s", e)

        return IMAGE_SERVICE.run_command(
            job_id=f"{job_id}_imgeval",
            command="evaluate",
            scope=scope,
            options={
                "max_evaluations": options.get("max_evaluations", 500),
                "max_runtime_sec": options.get("max_runtime_sec", 900),
                "decision_mode": options.get("decision_mode", "combined_consensus"),
                "distillation_context": distillation_context,
            },
            actor=actor,
            progress_callback=progress_callback,
            is_cancelled=is_cancelled,
        )

    def _cmd_evaluate_pairs(self, scope, options, actor, progress_callback, is_cancelled):
        """DEPRECATED: Pair coherence is now evaluated as part of image evaluation (Stage 4).

        This method is kept for backward compatibility but will be removed in a future release.
        Use evaluate_images instead — it runs both image judges and pair coherence judges
        in a single pass when distillation context is available.
        """
        log.warning("evaluate_pairs is deprecated — pair coherence is now part of evaluate_images")
        start = time.time()
        max_runtime_sec = int(options.get("max_runtime_sec", 900))
        deadline = start + max_runtime_sec

        approved = db.list_distillation_variants(
            subject_name=scope.get("subject"),
            phase=scope.get("phase"),
            theme_name=scope.get("theme"),
            capsule_name=scope.get("capsule"),
            status="approved",
        )

        max_evals = int(options.get("max_pair_evaluations", 500))
        evaluated = 0
        skipped = 0
        errors = []

        for i, expl_row in enumerate(approved):
            if is_cancelled and is_cancelled():
                break
            if evaluated >= max_evals:
                break
            if time.time() >= deadline:
                log.info("Pair evaluation hit runtime limit (%ds)", max_runtime_sec)
                break

            expl_variant = expl_row["variant"]
            distillation_variant_id = expl_variant.get("id")
            if not distillation_variant_id:
                continue

            # Find image variants linked to this explanation
            image_rows = db.list_curriculum_image_variants(
                subject_name=scope.get("subject"),
                phase=scope.get("phase"),
                theme_name=scope.get("theme"),
                capsule_name=scope.get("capsule"),
                fact_id=str(expl_row["fact_id"]),
                distillation_variant_id=distillation_variant_id,
            )

            if not image_rows:
                skipped += 1
                continue

            for img_row in image_rows:
                if is_cancelled and is_cancelled():
                    break
                if evaluated >= max_evals:
                    break

                img_variant = img_row["variant"]
                image_url = img_variant.get("image_url")
                if not image_url:
                    skipped += 1
                    continue

                # Skip already-evaluated pairs unless force=True
                existing_pair_eval = img_variant.get("pair_evaluation") or {}
                if existing_pair_eval.get("decision") and not options.get("force"):
                    skipped += 1
                    continue

                try:
                    image_b64, mime = _download_image_to_base64(image_url)
                except Exception as exc:
                    log.warning("Failed to download image %s: %s", image_url, exc)
                    errors.append({"variant_id": img_variant.get("id"), "error": str(exc)})
                    continue

                # Run pair judges
                judges_result = {}
                for judge_name in PAIR_JUDGE_NAMES:
                    provider = IMAGE_SERVICE.provider_for_judge(judge_name)
                    if not provider:
                        judges_result[judge_name] = {
                            "score": 0.0,
                            "reasoning": "No API key available for judge evaluation",
                            "flags": ["evaluation_error"],
                            "provider": "skip",
                        }
                        continue

                    system_prompt = PAIR_JUDGE_SYSTEM_PROMPTS[judge_name]
                    user_prompt = build_pair_judge_user_prompt(
                        judge_name=judge_name,
                        fact_text=expl_row.get("fact_text", ""),
                        explanation_text=expl_variant.get("text", ""),
                        explanation_strategy=expl_variant.get("strategy", ""),
                        age_range=expl_row.get("age_range", "10-12"),
                        subject=expl_row.get("subject_name", ""),
                    )
                    full_prompt = f"{system_prompt}\n\n{user_prompt}"

                    try:
                        raw_response = IMAGE_SERVICE.call_provider(
                            provider,
                            full_prompt,
                            image_b64,
                            mime,
                            temperature=0.2,
                            max_tokens=1024,
                            judge_name=judge_name,
                        )
                        parsed = extract_json(raw_response)
                        parsed["score"] = max(0.0, min(1.0, float(parsed.get("score", 0.0))))
                        parsed["provider"] = provider
                        judges_result[judge_name] = parsed
                    except Exception as exc:
                        log.warning("Pair judge %s failed: %s", judge_name, exc)
                        judges_result[judge_name] = {
                            "score": 0.0,
                            "reasoning": f"Judge error: {exc}",
                            "flags": ["evaluation_error"],
                            "provider": provider,
                        }

                decision_result = compute_pair_decision(judges=judges_result)

                # Persist pair evaluation on the image variant
                def _apply_pair_eval(v, _judges=judges_result, _dr=decision_result, _actor=actor):
                    v["pair_evaluation"] = {
                        "judges": _judges,
                        "composite": round(_dr.composite, 4),
                        "decision": _dr.decision,
                        "reasons": _dr.reasons,
                        "evaluated_at": _utc_now_iso(),
                        "evaluated_by": _actor,
                    }
                    return v

                try:
                    db.update_curriculum_fact_variant(
                        str(img_row["fact_id"]),
                        img_variant["id"],
                        _apply_pair_eval,
                    )
                except Exception as exc:
                    log.error("Failed to persist pair eval for variant %s: %s", img_variant.get("id"), exc)
                    errors.append({"variant_id": img_variant.get("id"), "error": f"persist_failed: {exc}"})
                    continue
                evaluated += 1

                if progress_callback:
                    progress_callback({
                        "status": "running",
                        "currentStage": "evaluating_pairs",
                        "itemsProcessed": evaluated,
                        "totalCandidates": min(len(approved) * 2, max_evals),
                        "skipped": skipped,
                    })

        return {
            "status": "completed" if not (is_cancelled and is_cancelled()) else "cancelled",
            "pairsEvaluated": evaluated,
            "skipped": skipped,
            "errors": errors,
        }

    def _cmd_optimize_prompts(self, scope, options, actor, progress_callback, is_cancelled):
        """Analyze judge feedback and suggest/apply prompt improvements."""
        from prompt_optimizer import OPTIMIZER

        if progress_callback:
            progress_callback({"status": "running", "currentStage": "analyzing_feedback"})

        report = OPTIMIZER.analyze_scope(scope)
        result = {
            "status": "completed",
            "totalVariants": report.total_variants,
            "evaluatedVariants": report.evaluated_variants,
            "patternsDetected": len(report.patterns),
            "suggestionsGenerated": len(report.suggestions),
            "patterns": [
                {
                    "patternId": p.pattern_id,
                    "severity": p.severity,
                    "affectedPct": p.affected_pct,
                    "judgeName": p.judge_name,
                    "description": p.description,
                }
                for p in report.patterns
            ],
            "suggestions": [
                {
                    "patternId": s.pattern_id,
                    "scopeType": s.scope_type,
                    "scopeKey": s.scope_key,
                    "strategy": s.strategy,
                    "overrideType": s.override_type,
                    "content": s.content,
                    "rationale": s.rationale,
                    "expectedImprovement": s.expected_improvement,
                }
                for s in report.suggestions
            ],
            "byStrategy": report.by_strategy,
            "byJudge": report.by_judge,
            "analyzedAt": report.analyzed_at,
        }

        # Auto-apply top suggestions if requested
        if options.get("auto_apply") and report.suggestions:
            applied = []
            for suggestion in report.suggestions:
                if is_cancelled and is_cancelled():
                    break
                override_id = OPTIMIZER.apply_suggestion(suggestion, actor)
                applied.append({"overrideId": override_id, "patternId": suggestion.pattern_id})
            result["applied"] = applied
            result["appliedCount"] = len(applied)

        # Run A/B tests if requested
        if options.get("ab_test") and report.suggestions:
            ab_results = []
            sample_size = options.get("ab_sample_size", 10)
            for suggestion in report.suggestions[:3]:  # limit to top 3
                if is_cancelled and is_cancelled():
                    break
                if progress_callback:
                    progress_callback({
                        "status": "running",
                        "currentStage": f"ab_testing_{suggestion.pattern_id}",
                    })
                ab = OPTIMIZER.run_ab_test(scope, suggestion, actor, sample_size=sample_size)
                ab_results.append({
                    "patternId": suggestion.pattern_id,
                    "controlMean": ab.control_mean,
                    "treatmentMean": ab.treatment_mean,
                    "improvementDelta": ab.improvement_delta,
                    "sampleSize": ab.sample_size,
                    "recommendKeep": ab.recommend_keep,
                })
            result["abTests"] = ab_results

        return result

    def _cmd_full_loop(self, job_id, scope, options, actor, progress_callback, is_cancelled):
        """Full pipeline: generate → evaluate → [optimize] → generate images → evaluate images.

        Image evaluation includes pair coherence judges when distillation context is available.
        When optimize_between_iterations=true, runs the prompt optimizer after Stage 2.
        """
        results = {}

        # Stage 1: Generate distillations
        if progress_callback:
            progress_callback({"status": "running", "currentStage": "generate_explanations"})
        results["explanations"] = self._cmd_generate_explanations(scope, options, progress_callback, is_cancelled)
        if is_cancelled and is_cancelled():
            return {"status": "cancelled", "stages": results}

        # Stage 2: Evaluate distillations (vs fact)
        if progress_callback:
            progress_callback({"status": "running", "currentStage": "evaluate_explanations"})
        results["explanation_eval"] = self._cmd_evaluate_explanations(scope, options, progress_callback, is_cancelled)
        if is_cancelled and is_cancelled():
            return {"status": "cancelled", "stages": results}

        # Stage 2.5 (optional): Optimize prompts based on evaluation feedback
        if options.get("optimize_between_iterations"):
            if progress_callback:
                progress_callback({"status": "running", "currentStage": "optimizing_prompts"})
            optimize_opts = {"auto_apply": True}
            results["optimization"] = self._cmd_optimize_prompts(scope, optimize_opts, actor, progress_callback, is_cancelled)
            if is_cancelled and is_cancelled():
                return {"status": "cancelled", "stages": results}

            # Re-generate variants that were REGENERATE'd, now with improved prompts
            if progress_callback:
                progress_callback({"status": "running", "currentStage": "regenerating_failed"})
            regen_options = {**options, "status_filter": "rejected"}
            results["regen"] = self._cmd_generate_explanations(scope, regen_options, progress_callback, is_cancelled)
            if is_cancelled and is_cancelled():
                return {"status": "cancelled", "stages": results}

            # Re-evaluate the regenerated variants
            if progress_callback:
                progress_callback({"status": "running", "currentStage": "re_evaluating"})
            results["regen_eval"] = self._cmd_evaluate_explanations(scope, options, progress_callback, is_cancelled)
            if is_cancelled and is_cancelled():
                return {"status": "cancelled", "stages": results}

        # Stage 3: Generate images for approved distillations
        if progress_callback:
            progress_callback({"status": "running", "currentStage": "generate_images"})
        results["images"] = self._cmd_generate_images(job_id, scope, options, actor, progress_callback, is_cancelled)
        if is_cancelled and is_cancelled():
            return {"status": "cancelled", "stages": results}

        # Stage 4: Evaluate images (vs distillation AND fact, with pair coherence)
        if progress_callback:
            progress_callback({"status": "running", "currentStage": "evaluate_images"})
        results["image_eval"] = self._cmd_evaluate_images(job_id, scope, options, actor, progress_callback, is_cancelled)

        return {
            "status": "completed" if not (is_cancelled and is_cancelled()) else "cancelled",
            "stages": results,
        }


    def regenerate_single_explanation(
        self,
        *,
        fact_id: str,
        variant_id: str,
        scope: dict,
        actor: str = "pipeline",
    ) -> dict:
        """Regenerate a single explanation variant in-place.

        Uses atomic DB guard to claim the variant, generates a fresh explanation
        using the same strategy, then merges new content into the locked DB copy.
        """
        strategy_holder: list[str] = []
        already_regenerating = False

        def _claim(v):
            nonlocal already_regenerating
            if v.get("status") == "regenerating":
                already_regenerating = True
                strategy_holder.append(v.get("strategy", "direct"))
                return v
            strategy_holder.append(v.get("strategy", "direct"))
            v["status"] = "regenerating"
            return v

        claimed = db.update_distillation_variant(fact_id, variant_id, _claim)
        if not claimed:
            log.warning("Variant %s not found for fact %s", variant_id, fact_id)
            return {"status": "error", "error": "variant_not_found"}
        if already_regenerating:
            log.info("Variant %s already being regenerated, skipping", variant_id)
            return {"status": "skipped", "reason": "already_regenerating"}

        strategy = strategy_holder[0] if strategy_holder else "direct"

        facts = _load_scope_facts(scope)
        fact_info = None
        for f in facts:
            if f["fact_id"] == fact_id:
                fact_info = f
                break

        if not fact_info:
            log.warning("Fact %s not found in scope", fact_id)
            db.update_distillation_variant(fact_id, variant_id, lambda v: {**v, "status": "rejected"})
            return {"status": "error", "error": "fact_not_found"}

        from explanation_gen_service import generate_explanations_for_fact
        new_variants = generate_explanations_for_fact(fact_info, strategies=[strategy])

        if not new_variants:
            db.update_distillation_variant(fact_id, variant_id, lambda v: {**v, "status": "rejected"})
            return {"status": "error", "error": "generation_failed"}

        new_variant = new_variants[0]

        def _mutate(v):
            v["text"] = new_variant["text"]
            v["word_count"] = new_variant["word_count"]
            v["suggestions"] = new_variant["suggestions"]
            v["image_prompt"] = new_variant["image_prompt"]
            v["status"] = "draft"
            v["evaluation"] = new_variant["evaluation"]
            v["human_review"] = {
                "status": None,
                "updated_by": None,
                "updated_at": None,
                "regenerated_by": actor,
                "regenerated_at": _utc_now_iso(),
            }
            v["version"] = new_variant["version"]
            return v

        db.update_distillation_variant(fact_id, variant_id, _mutate)

        # Invalidate stale pair evaluations on linked image variants
        linked = db.list_curriculum_image_variants(distillation_variant_id=variant_id)
        for img_row in linked:
            img_fid = img_row["fact_id"]
            img_vid = str(img_row["variant"]["id"])
            def _clear_pair(v, _vid=img_vid):
                v["pair_evaluation"] = {}
                v.pop("pair_human_review", None)
                return v
            db.update_curriculum_fact_variant(img_fid, img_vid, _clear_pair)
        if linked:
            log.info("Cleared pair evaluations on %d linked image variant(s) for explanation %s",
                     len(linked), variant_id)

        log.info("Regenerated variant %s for fact %s (strategy=%s, actor=%s)",
                 variant_id, fact_id, strategy, actor)
        return {"status": "completed", "variantId": variant_id, "strategy": strategy}


PIPELINE = DistillationPipeline()
