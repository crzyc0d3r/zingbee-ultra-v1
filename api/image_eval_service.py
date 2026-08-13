"""Command-gated image generation/evaluation services.

All stage transitions are explicit and operator-triggered:
  - generate
  - evaluate
  - reprompt
  - loop
"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx

import db
from helpers import extract_json
from image_eval_policy import (
    DEFAULT_GUARDRAILS,
    DEFAULT_THRESHOLDS,
    JUDGE_NAMES,
    compute_composite_and_decision,
    make_eval_identity,
)
from pair_eval_policy import (
    PAIR_JUDGE_NAMES,
    PAIR_JUDGE_SYSTEM_PROMPTS,
    PAIR_CRITICAL_FLAGS,
    build_pair_judge_user_prompt,
)
from image_prompting import build_educational_image_prompt, supported_prompt_strategies
from tools.image_store import persist_image
from tools.media_tool import generate_from_prompt


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_prompt_version() -> str:
    return "pv-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _prompt_hash(prompt: str) -> str:
    return hashlib.sha1(prompt.encode("utf-8")).hexdigest()[:16]


def _build_prompt_version_payload(prompt: str, prompt_version: str | None = None) -> dict[str, Any]:
    version = prompt_version or _new_prompt_version()
    return {
        "id": version,
        "created_at": _utc_now_iso(),
        "source": "image_prompting.build_educational_image_prompt",
        "hash": _prompt_hash(prompt),
    }


def _resolve_provider_model(model_spec: str) -> tuple[str, str]:
    raw = (model_spec or "").strip()
    if not raw:
        return "xai", "grok-imagine-image"
    if ":" in raw:
        provider, model = raw.split(":", 1)
        return provider.strip().lower(), model.strip()
    lowered = raw.lower()
    if "gemini" in lowered:
        return "google", raw
    if "vertex" in lowered or "imagen" in lowered:
        return "vertex", raw
    if "nano" in lowered or "banana" in lowered:
        return "nano_banana", raw
    return "xai", raw



def _mime_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(ext, "image/jpeg")


def _download_image_to_base64(url: str) -> tuple[str, str]:
    with httpx.Client(timeout=45.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        mime = content_type.split(";")[0].strip() if content_type else "image/jpeg"
        return base64.b64encode(resp.content).decode("utf-8"), mime


def _first_env(*names: str) -> str:
    for name in names:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return ""


def _clamp_float(value: Any, *, minimum: float, maximum: float, default: float) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, num))


def _clamp_int(value: Any, *, minimum: int, maximum: int, default: int) -> int:
    try:
        num = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, num))


def _normalize_decision_mode(value: Any) -> str:
    mode = str(value or "combined_consensus").strip()
    if mode not in {"combined_consensus", "master_judge"}:
        return "combined_consensus"
    return mode


def _generation_prerequisite_issues(model_specs: list[str]) -> list[str]:
    """Return actionable prerequisite issues for selected image providers."""
    providers: set[str] = set()
    for spec in model_specs:
        provider, _ = _resolve_provider_model(str(spec))
        providers.add(provider)

    issues: list[str] = []
    if "xai" in providers:
        if not _first_env("XAI_IMAGE_API_KEY", "XAI_API_KEY"):
            issues.append("Missing XAI image key. Set XAI_IMAGE_API_KEY (or fallback XAI_API_KEY).")
        try:
            import xai_sdk  # type: ignore  # noqa: F401
        except Exception:
            issues.append("Missing Python package xai-sdk. Install with: python3 -m pip install xai-sdk==1.11.0")

    if {"google", "gemini", "google_gemini", "google-gemini"} & providers:
        if not _first_env("GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"):
            issues.append("Missing Google API key. Set GOOGLE_AI_API_KEY (or fallback GOOGLE_API_KEY).")

    if {"vertex", "google_vertex", "google-vertex"} & providers:
        if not _first_env("VERTEX_IMAGE_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT"):
            issues.append("Missing Vertex project. Set VERTEX_IMAGE_PROJECT (or fallback GOOGLE_CLOUD_PROJECT).")
        if not _first_env("VERTEX_IMAGE_ACCESS_TOKEN", "GOOGLE_OAUTH_ACCESS_TOKEN"):
            if not _first_env("GOOGLE_APPLICATION_CREDENTIALS"):
                issues.append(
                    "Missing Vertex auth. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON, "
                    "or provide VERTEX_IMAGE_ACCESS_TOKEN."
                )
            try:
                import google.auth  # type: ignore  # noqa: F401
            except Exception:
                issues.append("Missing Python package google-auth. Install with: python3 -m pip install google-auth")

    if {"nano_banana", "nano-banana", "nanobanana"} & providers:
        if not _first_env("NANO_BANANA_API_KEY") or not _first_env("NANO_BANANA_BASE_URL"):
            issues.append(
                "Missing Nano Banana config. Set NANO_BANANA_API_KEY and NANO_BANANA_BASE_URL for nano_banana provider."
            )

    return issues


class ImageEvalService:
    def __init__(self):
        self.thresholds = copy.deepcopy(DEFAULT_THRESHOLDS)
        self.guardrails = copy.deepcopy(DEFAULT_GUARDRAILS)

    # ---------------------------------------------------------------------
    # Public command entrypoint
    # ---------------------------------------------------------------------
    def run_command(
        self,
        *,
        job_id: str,
        command: str,
        scope: dict[str, Any],
        options: dict[str, Any],
        actor: str,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> dict[str, Any]:
        start = time.time()
        max_runtime_sec = _clamp_int(
            options.get("max_runtime_sec"),
            minimum=10,
            maximum=7200,
            default=int(self.guardrails["max_runtime_seconds_per_command"]),
        )
        deadline = start + max_runtime_sec
        summary = {
            "runType": "image_eval",
            "jobId": job_id,
            "command": command,
            "scope": scope,
            "actor": actor,
            "startedAt": _utc_now_iso(),
            "status": "running",
            "items": [],
            "errors": [],
            "promptVersion": options.get("prompt_version") or "",
            "imageModels": options.get("image_models") or [],
            "promptStrategies": options.get("prompt_strategies") or [],
            "currentStage": "queued",
            "itemsProcessed": 0,
            "totalCandidates": 0,
            "limits": {
                "maxRuntimeSec": max_runtime_sec,
                "maxTotalImages": int(self.guardrails["max_total_images_per_command"]),
                "maxEvaluations": int(self.guardrails["max_evaluations_per_command"]),
            },
        }

        def _report(
            *,
            stage: str,
            processed: int | None = None,
            total: int | None = None,
            note: str | None = None,
        ):
            summary["currentStage"] = stage
            if processed is not None:
                summary["itemsProcessed"] = max(0, int(processed))
            if total is not None:
                summary["totalCandidates"] = max(0, int(total))
            if note:
                summary["lastNote"] = note
            if progress_callback:
                progress_callback(copy.deepcopy(summary))

        def _check_cancelled():
            if is_cancelled and is_cancelled():
                raise RuntimeError("cancel_requested:user")
            if time.time() >= deadline:
                raise RuntimeError("cancel_requested:timeout")

        try:
            _report(stage=f"{command}:starting", processed=0, total=0)
            if command in {"evaluate", "loop"} and not any(
                [
                    bool(_first_env("XAI_IMAGE_API_KEY", "XAI_API_KEY")),
                    bool(os.environ.get("OPENAI_API_KEY")),
                    bool(_first_env("GOOGLE_AI_API_KEY", "GOOGLE_API_KEY")),
                    bool(os.environ.get("ANTHROPIC_API_KEY")),
                ]
            ):
                summary["errors"].append("No judge API keys detected; using heuristic fallback judges.")
            if command == "generate":
                summary["items"] = self.command_generate(
                    scope=scope,
                    options=options,
                    actor=actor,
                    report_progress=_report,
                    check_cancelled=_check_cancelled,
                )
            elif command == "evaluate":
                summary["items"] = self.command_evaluate(
                    scope=scope,
                    options=options,
                    actor=actor,
                    report_progress=_report,
                    check_cancelled=_check_cancelled,
                )
            elif command == "reprompt":
                summary["items"] = self.command_reprompt(
                    scope=scope,
                    options=options,
                    actor=actor,
                    report_progress=_report,
                    check_cancelled=_check_cancelled,
                )
            elif command == "loop":
                summary["items"] = self.command_loop(
                    scope=scope,
                    options=options,
                    actor=actor,
                    report_progress=_report,
                    check_cancelled=_check_cancelled,
                )
            else:
                raise ValueError(f"Unsupported command: {command}")

            summary["status"] = "completed"
            summary["completedAt"] = _utc_now_iso()
            summary["durationSec"] = round(time.time() - start, 2)
            summary["count"] = len(summary["items"])
            summary["itemsProcessed"] = len(summary["items"])
            summary["currentStage"] = f"{command}:completed"
            _report(stage=summary["currentStage"], processed=summary["itemsProcessed"], total=summary["totalCandidates"])
            return summary
        except RuntimeError as exc:
            reason = str(exc)
            if not reason.startswith("cancel_requested"):
                raise
            summary["status"] = "cancelled"
            summary["completedAt"] = _utc_now_iso()
            summary["durationSec"] = round(time.time() - start, 2)
            cancel_reason = "user"
            if ":" in reason:
                cancel_reason = reason.split(":", 1)[1] or "user"
            summary["cancelReason"] = cancel_reason
            summary["errors"].append(f"cancelled:{cancel_reason}")
            _report(stage=f"{command}:cancelled")
            return summary
        except Exception as exc:
            summary["status"] = "failed"
            summary["completedAt"] = _utc_now_iso()
            summary["durationSec"] = round(time.time() - start, 2)
            summary["errors"].append(str(exc))
            _report(stage=f"{command}:failed", note=str(exc))
            return summary

    # ---------------------------------------------------------------------
    # Commands
    # ---------------------------------------------------------------------
    def command_generate(
        self,
        *,
        scope: dict[str, Any],
        options: dict[str, Any],
        actor: str,
        report_progress: Callable[..., None] | None = None,
        check_cancelled: Callable[[], None] | None = None,
    ) -> list[dict[str, Any]]:
        fact_ids = options.get("fact_ids") if isinstance(options.get("fact_ids"), list) else None
        facts = self._load_scope_facts(scope, fact_ids=fact_ids)
        variants_per_fact = int(options.get("variants_per_fact") or 1)
        variants_per_fact = min(max(1, variants_per_fact), self.guardrails["max_variants_per_fact"])
        max_facts = int(options.get("max_facts") or len(facts))
        prompt_version = options.get("prompt_version") or _new_prompt_version()
        dry_run = bool(options.get("dry_run", False))
        source_prompts = options.get("source_prompts") if isinstance(options.get("source_prompts"), dict) else {}
        distillation_variant_id = options.get("distillation_variant_id") or None
        model_specs = options.get("image_models") or ["xai:grok-imagine-image"]
        if not dry_run:
            prereq_issues = _generation_prerequisite_issues(model_specs)
            if prereq_issues:
                raise ValueError("Image generation prerequisites missing: " + " | ".join(prereq_issues))
        prompt_strategies = options.get("prompt_strategies") or ["baseline"]
        allowed_strategies = set(supported_prompt_strategies())
        prompt_strategies = [s for s in prompt_strategies if s in allowed_strategies] or ["baseline"]
        results: list[dict[str, Any]] = []
        generated_count = 0
        total_candidates = len(facts[:max_facts]) * variants_per_fact * len(prompt_strategies) * len(model_specs)
        total_candidates = min(total_candidates, int(self.guardrails["max_total_images_per_command"]))
        if report_progress:
            report_progress(stage="generate:running", processed=0, total=total_candidates)

        for fact in facts[:max_facts]:
            for _ in range(variants_per_fact):
                for strategy in prompt_strategies:
                    fact_key = str(fact["fact_id"])
                    override_prompt = source_prompts.get(fact_key)
                    if override_prompt:
                        prompt = str(override_prompt)
                    else:
                        prompt = build_educational_image_prompt(
                            fact_text=fact["fact_text"],
                            subject=fact["subject_name"],
                            age_range=fact["age_range"],
                            capsule_name=fact["capsule_name"],
                            theme_name=fact["theme_name"],
                            strategy=strategy,
                        )
                    prompt_meta = _build_prompt_version_payload(prompt, prompt_version)
                    for model_spec in model_specs:
                        if check_cancelled:
                            check_cancelled()
                        if generated_count >= int(self.guardrails["max_total_images_per_command"]):
                            return results
                        provider, model_name = _resolve_provider_model(str(model_spec))
                        combo_id = hashlib.sha1(
                            f"{provider}:{model_name}|{prompt_meta['id']}|{strategy}".encode("utf-8")
                        ).hexdigest()[:16]
                        variant = {
                            "id": str(uuid.uuid4()),
                            "created_at": _utc_now_iso(),
                            "created_by": actor,
                            "scope": {
                                "phase": fact["phase"],
                                "theme": fact["theme_name"],
                                "capsule": fact["capsule_name"],
                            },
                            "subject": fact["subject_name"],
                            "age_range": fact["age_range"],
                            "capsule": fact["capsule_name"],
                            "curriculum_capsule_id": fact["curriculum_capsule_id"],
                            "fact_text": fact["fact_text"],
                            "fact_order": fact["fact_order"],
                            "prompt_strategy": strategy,
                            "combination_id": combo_id,
                            "prompt_version": prompt_meta["id"],
                            "prompt_version_meta": prompt_meta,
                            "image_prompt": prompt,
                            "generation": {
                                "status": "pending" if dry_run else "generated",
                                "provider": provider,
                                "model": model_name,
                            },
                            "distillation_variant_id": distillation_variant_id,
                            "evaluation": {},
                            "pair_evaluation": {},
                            "reprompt_iterations": [],
                            "human_review": {},
                        }

                        if not dry_run:
                            raw = json.loads(
                                generate_from_prompt(
                                    image_prompt=prompt,
                                    provider=provider,
                                    model=model_name,
                                )
                            )
                            if not raw.get("success"):
                                variant["generation"] = {
                                    "status": "failed",
                                    "provider": provider,
                                    "model": model_name,
                                    "error": raw.get("error", "generation_failed"),
                                }
                            else:
                                persisted = persist_image(
                                    image_url=raw["image_url"],
                                    topic=fact["fact_text"][:120],
                                    description=f"phase {fact['phase']} / {fact['theme_name']} / {fact['capsule_name']}",
                                    style="educational",
                                    full_prompt=prompt,
                                    capsule_name=fact["capsule_name"],
                                )
                                variant["image_url"] = persisted
                                variant["generation"]["tokens_used"] = raw.get("tokens_used", 0)
                                variant["generation"]["source_url"] = raw.get("image_url")

                        appended = db.append_curriculum_fact_image_variant(
                            str(fact["fact_id"]), variant, dedup_key=combo_id,
                        )
                        if appended is None:
                            # Duplicate variant — skip
                            if report_progress:
                                report_progress(
                                    stage="generate:running",
                                    processed=generated_count,
                                    total=total_candidates,
                                    note=f"skipped duplicate combo {combo_id}",
                                )
                            continue
                        generated_count += 1
                        results.append({
                            "fact_id": str(fact["fact_id"]),
                            "variant_id": variant["id"],
                            "status": variant["generation"]["status"],
                            "provider": provider,
                            "model": model_name,
                            "prompt_strategy": strategy,
                            "combination_id": combo_id,
                            "prompt_version": variant["prompt_version"],
                            "image_url": variant.get("image_url", ""),
                            "error": variant["generation"].get("error", ""),
                        })
                        if report_progress:
                            report_progress(
                                stage="generate:running",
                                processed=generated_count,
                                total=total_candidates,
                                note=f"generated {generated_count}/{total_candidates}",
                            )
        if not dry_run and results:
            generated_ok = sum(1 for r in results if r.get("status") == "generated")
            if generated_ok == 0:
                reasons = sorted({str(r.get("error") or "").strip() for r in results if str(r.get("error") or "").strip()})
                sample = " | ".join(reasons[:3]) if reasons else "unknown_generation_error"
                raise ValueError(f"Image generation failed for all variants. Reasons: {sample}")
        return results

    def regenerate_single_variant(
        self,
        *,
        scope: dict[str, Any],
        fact_id: str,
        variant_id: str,
        actor: str,
        next_prompt_version: str | None = None,
    ) -> dict[str, Any]:
        rows = db.list_curriculum_image_variants(
            subject_name=scope.get("subject"),
            phase=scope["phase"],
            theme_name=scope["theme"],
            capsule_name=scope["capsule"],
            fact_id=fact_id,
            variant_id=variant_id,
        )
        if not rows:
            raise ValueError("Variant not found in requested scope")
        row = rows[0]
        variant = row["variant"]
        eval_data = variant.get("evaluation") or {}
        revised = self._build_reprompt_from_judges(
            original_prompt=variant.get("image_prompt", ""),
            judges=(eval_data.get("judges") or {}),
        )
        prompt_meta = _build_prompt_version_payload(revised, next_prompt_version or _new_prompt_version())
        iteration = {
            "at": _utc_now_iso(),
            "by": actor,
            "from_prompt_version": variant.get("prompt_version", ""),
            "to_prompt_version": prompt_meta["id"],
            "reasons": self._judge_reason_summary(eval_data.get("judges") or {}),
            "original_prompt": variant.get("image_prompt", ""),
            "revised_prompt": revised,
        }

        def _mutate(v: dict[str, Any]) -> dict[str, Any]:
            arr = list(v.get("reprompt_iterations") or [])
            arr.append(iteration)
            v["reprompt_iterations"] = arr
            v["image_prompt"] = revised
            v["prompt_version"] = prompt_meta["id"]
            v["prompt_version_meta"] = prompt_meta
            return v

        db.update_curriculum_fact_variant(fact_id, variant_id, _mutate)
        model_name = str((variant.get("generation") or {}).get("model") or "grok-imagine-image")
        provider_name = str((variant.get("generation") or {}).get("provider") or "xai")
        model_spec = f"{provider_name}:{model_name}"
        generated = self.command_generate(
            scope=scope,
            options={
                "prompt_version": prompt_meta["id"],
                "variants_per_fact": 1,
                "max_facts": 1,
                "dry_run": False,
                "image_models": [model_spec],
                "prompt_strategies": [variant.get("prompt_strategy") or "baseline"],
                "fact_ids": [fact_id],
                "source_prompts": {str(fact_id): revised},
                "distillation_variant_id": variant.get("distillation_variant_id"),
            },
            actor=actor,
        )
        return {
            "fact_id": fact_id,
            "source_variant_id": variant_id,
            "new_prompt_version": prompt_meta["id"],
            "generated": generated[:1],
        }

    def command_evaluate(
        self,
        *,
        scope: dict[str, Any],
        options: dict[str, Any],
        actor: str,
        report_progress: Callable[..., None] | None = None,
        check_cancelled: Callable[[], None] | None = None,
    ) -> list[dict[str, Any]]:
        prompt_version = options.get("prompt_version")
        limit = int(options.get("limit") or 0)
        mode = _normalize_decision_mode(options.get("decision_mode"))
        max_evaluations = int(options.get("max_evaluations") or int(self.guardrails["max_evaluations_per_command"]))
        max_evaluations = max(1, max_evaluations)
        judge_params = options.get("judge_params") if isinstance(options.get("judge_params"), dict) else {}
        rows = db.list_curriculum_image_variants(
            subject_name=scope.get("subject"),
            phase=scope["phase"],
            theme_name=scope["theme"],
            capsule_name=scope["capsule"],
            prompt_version=prompt_version,
            model=options.get("model"),
            prompt_strategy=options.get("prompt_strategy"),
        )
        if limit > 0:
            rows = rows[:limit]
        rows = rows[:max_evaluations]

        results: list[dict[str, Any]] = []
        total = len(rows)
        scanned = 0
        if report_progress:
            report_progress(stage="evaluate:running", processed=0, total=total)
        for row in rows:
            if check_cancelled:
                check_cancelled()
            scanned += 1
            variant = row["variant"]
            image_url = variant.get("image_url")
            if not image_url:
                if report_progress:
                    report_progress(
                        stage="evaluate:running",
                        processed=scanned,
                        total=total,
                        note=f"scanned {scanned}/{total}",
                    )
                continue
            # Look up linked distillation context FIRST (needed for identity check)
            dist_text = ""
            dist_strategy = ""
            dist_ctx = options.get("distillation_context") or {}
            dist_vid = variant.get("distillation_variant_id", "")
            if dist_vid and dist_vid in dist_ctx:
                dist_text = dist_ctx[dist_vid].get("text", "")
                dist_strategy = dist_ctx[dist_vid].get("strategy", "")

            # Determine which judges will run
            is_unified = bool(dist_text)
            current_judge_names = list(JUDGE_NAMES) + (list(PAIR_JUDGE_NAMES) if is_unified else [])

            # Skip already-evaluated variants unless identity changed or force flag set
            existing_eval = variant.get("evaluation") or {}
            if existing_eval.get("evaluated_at") and not options.get("force"):
                stored_id = existing_eval.get("eval_identity") or {}
                current_id = make_eval_identity(
                    unified=is_unified,
                    mode=mode,
                    judge_names=current_judge_names,
                )
                if (stored_id.get("rubric_version") == current_id["rubric_version"]
                        and stored_id.get("unified") == current_id["unified"]
                        and stored_id.get("judge_names") == current_id["judge_names"]):
                    if report_progress:
                        report_progress(
                            stage="evaluate:running",
                            processed=scanned,
                            total=total,
                            note=f"scanned {scanned}/{total} (skipped — current rubric)",
                        )
                    continue
                # Identity mismatch — fall through to re-evaluate

            judges, applied_judge_params = self._evaluate_variant_with_judges(
                row,
                variant,
                judge_overrides=judge_params,
                distillation_text=dist_text,
                distillation_strategy=dist_strategy,
            )
            decision = compute_composite_and_decision(
                judges=judges,
                subject=row["subject_name"],
                thresholds=self.thresholds,
                mode=mode,
                unified=is_unified,
            )

            eval_id = make_eval_identity(
                unified=is_unified,
                mode=mode,
                judge_names=list(judges.keys()),
            )

            def _mutate(v: dict[str, Any]) -> dict[str, Any]:
                # Reset human review on re-evaluation (stale approval is meaningless)
                if existing_eval.get("evaluated_at"):
                    v["human_review"] = {}
                evaluation = {
                    "evaluated_at": _utc_now_iso(),
                    "evaluated_by": actor,
                    "decision_mode": mode,
                    "composite": round(decision.composite, 4),
                    "decision": decision.decision,
                    "reasons": decision.reasons,
                    "judges": judges,
                    "judge_params": applied_judge_params,
                    "eval_identity": eval_id,
                }
                v["evaluation"] = evaluation
                if "human_review" not in v:
                    v["human_review"] = {}
                if decision.decision == "REVIEW":
                    v["human_review"]["status"] = "pending"
                return v

            db.update_curriculum_fact_variant(row["fact_id"], variant["id"], _mutate)
            results.append({
                "fact_id": row["fact_id"],
                "variant_id": variant["id"],
                "prompt_version": variant.get("prompt_version", ""),
                "decision": decision.decision,
                "composite": round(decision.composite, 4),
            })
            if report_progress:
                report_progress(
                    stage="evaluate:running",
                    processed=scanned,
                    total=total,
                    note=f"scanned {scanned}/{total}; evaluated {len(results)}",
                )
        return results

    def command_reprompt(
        self,
        *,
        scope: dict[str, Any],
        options: dict[str, Any],
        actor: str,
        report_progress: Callable[..., None] | None = None,
        check_cancelled: Callable[[], None] | None = None,
    ) -> list[dict[str, Any]]:
        prompt_version = options.get("prompt_version")
        rows = db.list_curriculum_image_variants(
            subject_name=scope.get("subject"),
            phase=scope["phase"],
            theme_name=scope["theme"],
            capsule_name=scope["capsule"],
            prompt_version=prompt_version,
            model=options.get("model"),
            prompt_strategy=options.get("prompt_strategy"),
        )
        results = []
        total = len(rows)
        if report_progress:
            report_progress(stage="reprompt:running", processed=0, total=total)
        for row in rows:
            if check_cancelled:
                check_cancelled()
            variant = row["variant"]
            eval_data = variant.get("evaluation") or {}
            if eval_data.get("decision") not in {"REGENERATE", "REVIEW"}:
                continue

            iterations = list(variant.get("reprompt_iterations") or [])
            if len(iterations) >= int(self.guardrails["max_iterations_per_variant"]):
                continue
            revised = self._build_reprompt_from_judges(
                original_prompt=variant.get("image_prompt", ""),
                judges=(eval_data.get("judges") or {}),
            )
            next_prompt_version = options.get("next_prompt_version") or _new_prompt_version()
            prompt_meta = _build_prompt_version_payload(revised, next_prompt_version)
            iteration = {
                "at": _utc_now_iso(),
                "by": actor,
                "from_prompt_version": variant.get("prompt_version", ""),
                "to_prompt_version": prompt_meta["id"],
                "reasons": self._judge_reason_summary(eval_data.get("judges") or {}),
                "original_prompt": variant.get("image_prompt", ""),
                "revised_prompt": revised,
            }

            def _mutate(v: dict[str, Any]) -> dict[str, Any]:
                arr = list(v.get("reprompt_iterations") or [])
                arr.append(iteration)
                v["reprompt_iterations"] = arr
                v["image_prompt"] = revised
                v["prompt_version"] = prompt_meta["id"]
                v["prompt_version_meta"] = prompt_meta
                failed_iterations = len(arr)
                if failed_iterations >= int(self.guardrails["require_human_review_after_failed_iterations"]):
                    review = dict(v.get("human_review") or {})
                    review["status"] = "pending"
                    review["reason"] = "max_failed_iterations"
                    v["human_review"] = review
                return v

            db.update_curriculum_fact_variant(row["fact_id"], variant["id"], _mutate)
            results.append({
                "fact_id": row["fact_id"],
                "variant_id": variant["id"],
                "new_prompt_version": prompt_meta["id"],
                "status": "reprompted",
            })
            if report_progress:
                report_progress(
                    stage="reprompt:running",
                    processed=len(results),
                    total=total,
                    note=f"reprompted {len(results)}/{total}",
                )
        return results

    def command_loop(
        self,
        *,
        scope: dict[str, Any],
        options: dict[str, Any],
        actor: str,
        report_progress: Callable[..., None] | None = None,
        check_cancelled: Callable[[], None] | None = None,
    ) -> list[dict[str, Any]]:
        """Explicitly run one supervised iteration chain per variant."""
        max_cycles = int(options.get("max_cycles") or 1)
        max_cycles = min(max_cycles, int(self.guardrails["max_iterations_per_variant"]))
        current_prompt_version = options.get("prompt_version")
        loop_max_facts = int(options.get("max_facts") or 1)
        loop_max_facts = max(1, loop_max_facts)
        regeneration_budget = int(options.get("max_regeneration_per_command") or int(self.guardrails["max_regeneration_per_command"]))
        regeneration_count = 0
        summary: list[dict[str, Any]] = []

        for cycle in range(max_cycles):
            if check_cancelled:
                check_cancelled()
            if report_progress:
                report_progress(stage="loop:evaluate", processed=cycle, total=max_cycles)
            eval_results = self.command_evaluate(
                scope=scope,
                options={
                    "prompt_version": current_prompt_version,
                    "model": options.get("model"),
                    "prompt_strategy": options.get("prompt_strategy"),
                    "decision_mode": options.get("decision_mode"),
                    "judge_params": options.get("judge_params"),
                    "max_evaluations": options.get("max_evaluations"),
                },
                actor=actor,
                report_progress=report_progress,
                check_cancelled=check_cancelled,
            )
            regen_candidates = [r for r in eval_results if r["decision"] == "REGENERATE"]
            review_candidates = [r for r in eval_results if r["decision"] == "REVIEW"]
            summary.append({
                "cycle": cycle + 1,
                "evaluated": len(eval_results),
                "regenerate": len(regen_candidates),
                "review": len(review_candidates),
            })
            if not regen_candidates:
                break
            regeneration_count += len(regen_candidates)
            if regeneration_count >= regeneration_budget:
                break

            # Guardrail: loop remains explicit command; regeneration still bounded by limits.
            if not bool(options.get("allow_generate_after_reprompt", True)):
                self.command_reprompt(
                    scope=scope,
                    options={
                        "prompt_version": current_prompt_version,
                        "next_prompt_version": options.get("next_prompt_version"),
                        "model": options.get("model"),
                        "prompt_strategy": options.get("prompt_strategy"),
                    },
                    actor=actor,
                    report_progress=report_progress,
                    check_cancelled=check_cancelled,
                )
                break

            if report_progress:
                report_progress(stage="loop:reprompt", processed=cycle, total=max_cycles)
            cycle_prompt_version = options.get("next_prompt_version") or _new_prompt_version()
            reprompt_results = self.command_reprompt(
                scope=scope,
                options={
                    "prompt_version": current_prompt_version,
                    "next_prompt_version": cycle_prompt_version,
                    "model": options.get("model"),
                    "prompt_strategy": options.get("prompt_strategy"),
                },
                actor=actor,
                report_progress=report_progress,
                check_cancelled=check_cancelled,
            )
            if not reprompt_results:
                break
            if report_progress:
                report_progress(stage="loop:generate", processed=cycle + 1, total=max_cycles)
            # Target only the specific facts that failed evaluation, not the whole scope
            failed_fact_ids = sorted({r["fact_id"] for r in regen_candidates})
            self.command_generate(
                scope=scope,
                options={
                    "prompt_version": cycle_prompt_version,
                    "variants_per_fact": 1,
                    "max_facts": loop_max_facts,
                    "dry_run": False,
                    "image_models": options.get("image_models") or ["xai:grok-imagine-image"],
                    "prompt_strategies": options.get("prompt_strategies") or ["baseline"],
                    "fact_ids": failed_fact_ids,
                },
                actor=actor,
                report_progress=report_progress,
                check_cancelled=check_cancelled,
            )
            current_prompt_version = cycle_prompt_version
        return summary

    # ---------------------------------------------------------------------
    # Internals
    # ---------------------------------------------------------------------
    def _load_scope_facts(self, scope: dict[str, Any], fact_ids: list[str] | None = None) -> list[dict[str, Any]]:
        phase = int(scope["phase"])
        theme = scope["theme"]
        capsule = scope["capsule"]
        rows = db.list_facts_for_capsule_scope(
            phase,
            theme,
            capsule,
            subject_name=scope.get("subject"),
            fact_ids=fact_ids,
        )
        if not rows:
            raise ValueError("No facts found for scope")
        return rows

    def _judge_reason_summary(self, judges: dict[str, Any]) -> list[str]:
        notes: list[str] = []
        for name, payload in judges.items():
            score = float(payload.get("score", 0.0))
            if score < 0.7:
                notes.append(f"{name}:{score:.2f}")
        return notes

    def _build_reprompt_from_judges(self, *, original_prompt: str, judges: dict[str, Any]) -> str:
        """Deterministic reprompting from judge feedback."""
        adjustments = []
        low_flags: set[str] = set()
        for name, payload in judges.items():
            score = float(payload.get("score", 0.0))
            if score < 0.8:
                adjustments.append(name)
            for flag in payload.get("flags") or []:
                low_flags.add(flag)

        guardrail_lines = []
        if "garbled_text" in low_flags or "misspelled_text" in low_flags:
            guardrail_lines.append("No visible text or labels in the image.")
        if "unsafe_content" in low_flags or "offensive_content" in low_flags:
            guardrail_lines.append("Keep content child-safe, friendly, and non-threatening.")
        if "ai_artifacts" in low_flags:
            guardrail_lines.append("Avoid visual artifacts; keep anatomy and geometry coherent.")
        if "reinforces_misconception" in low_flags:
            guardrail_lines.append("Depict only the scientifically correct interpretation of the fact.")
        if not guardrail_lines:
            guardrail_lines.append("Improve clarity, factual precision, and pedagogical focus.")

        block = " ".join(guardrail_lines)
        return (
            f"{original_prompt.strip()} "
            f"Additional guardrails from judges ({', '.join(adjustments) or 'general'}): {block}"
        )

    def _evaluate_variant_with_judges(
        self,
        row: dict[str, Any],
        variant: dict[str, Any],
        *,
        judge_overrides: dict[str, Any] | None = None,
        distillation_text: str = "",
        distillation_strategy: str = "",
    ) -> tuple[dict[str, Any], dict[str, dict[str, float | int]]]:
        """Run all judges (LLM-backed if keys exist, otherwise deterministic fallback).

        When distillation_text is provided, judges evaluate the image against
        both the underlying fact AND the distillation/explanation it depicts.
        """
        image_url = variant.get("image_url")
        judges: dict[str, Any] = {}
        applied_params: dict[str, dict[str, float | int]] = {}
        image_b64 = ""
        mime = "image/jpeg"
        try:
            image_b64, mime = _download_image_to_base64(image_url)
        except Exception:
            image_b64 = ""
        # If image download failed, skip LLM judges entirely -- scoring an empty image is meaningless
        if not image_b64:
            for judge_name in JUDGE_NAMES:
                judges[judge_name] = {
                    "score": 0.0,
                    "reasoning": "Image download failed; cannot evaluate",
                    "flags": ["evaluation_error", "image_download_failed"],
                    "provider": "skip",
                }
                applied_params[judge_name] = {"temperature": 0.0, "max_tokens": 0}
            return judges, applied_params
        resolved_overrides = judge_overrides or {}
        for judge_name in JUDGE_NAMES:
            judge_result, judge_params = self._evaluate_one_judge(
                judge_name=judge_name,
                row=row,
                variant=variant,
                image_b64=image_b64,
                mime=mime,
                judge_overrides=resolved_overrides,
                distillation_text=distillation_text,
                distillation_strategy=distillation_strategy,
            )
            judges[judge_name] = judge_result
            applied_params[judge_name] = judge_params

        # Run pair coherence judges when distillation context is available.
        # These evaluate how well the image and explanation work together.
        if distillation_text:
            for pair_judge_name in PAIR_JUDGE_NAMES:
                provider = self.provider_for_judge(pair_judge_name)
                pair_params = self._resolve_judge_params(pair_judge_name, provider, resolved_overrides)
                if not provider:
                    judges[pair_judge_name] = {
                        "score": 0.0,
                        "reasoning": "No API key available for pair judge",
                        "flags": ["evaluation_error"],
                        "provider": "skip",
                    }
                    applied_params[pair_judge_name] = pair_params
                    continue

                system_prompt = PAIR_JUDGE_SYSTEM_PROMPTS[pair_judge_name]
                user_prompt = build_pair_judge_user_prompt(
                    judge_name=pair_judge_name,
                    fact_text=row.get("fact_text", ""),
                    explanation_text=distillation_text,
                    explanation_strategy=distillation_strategy,
                    age_range=row.get("age_range", "10-12"),
                    subject=row.get("subject_name", ""),
                )
                full_prompt = f"{system_prompt}\n\n{user_prompt}"

                try:
                    raw_response = self.call_provider(
                        provider,
                        full_prompt,
                        image_b64,
                        mime,
                        temperature=float(pair_params["temperature"]),
                        max_tokens=int(pair_params["max_tokens"]),
                        judge_name=pair_judge_name,
                    )
                    parsed = extract_json(raw_response, default={
                        "score": 0.0,
                        "reasoning": "unparseable pair judge response",
                        "flags": ["evaluation_error"],
                    })
                    parsed["score"] = max(0.0, min(1.0, float(parsed.get("score", 0.0))))
                    parsed["provider"] = provider
                    judges[pair_judge_name] = parsed
                except Exception as exc:
                    judges[pair_judge_name] = {
                        "score": 0.0,
                        "reasoning": f"Pair judge error: {exc}",
                        "flags": ["evaluation_error"],
                        "provider": provider,
                    }
                applied_params[pair_judge_name] = pair_params

        return judges, applied_params

    def _evaluate_one_judge(
        self,
        *,
        judge_name: str,
        row: dict[str, Any],
        variant: dict[str, Any],
        image_b64: str,
        mime: str,
        judge_overrides: dict[str, Any] | None = None,
        distillation_text: str = "",
        distillation_strategy: str = "",
    ) -> tuple[dict[str, Any], dict[str, float | int]]:
        # Prefer deterministic fallback when keys are not configured.
        provider = self.provider_for_judge(judge_name)
        judge_params = self._resolve_judge_params(judge_name, provider, judge_overrides or {})
        if not provider:
            return self._fallback_judge(judge_name, variant), judge_params

        prompt = self._judge_prompt(
            judge_name, row, variant,
            distillation_text=distillation_text,
            distillation_strategy=distillation_strategy,
        )
        try:
            result = self.call_provider(
                provider,
                prompt,
                image_b64,
                mime,
                temperature=float(judge_params["temperature"]),
                max_tokens=int(judge_params["max_tokens"]),
                judge_name=judge_name,
            )
            parsed = extract_json(result, default={"score": 0.0, "reasoning": "unparseable judge response", "flags": ["evaluation_error"]})
            parsed["score"] = max(0.0, min(1.0, float(parsed.get("score", 0.0))))
            parsed["provider"] = provider
            return parsed, judge_params
        except Exception:
            fallback = self._fallback_judge(judge_name, variant)
            fallback["flags"].append("evaluation_error")
            return fallback, judge_params

    def _resolve_judge_params(
        self,
        judge_name: str,
        provider: str | None,
        judge_overrides: dict[str, Any],
    ) -> dict[str, float | int]:
        base_max_tokens = 2048 if provider == "google" else 1024
        defaults = {
            "temperature": 0.2,
            "max_tokens": base_max_tokens,
        }
        payload = judge_overrides.get(judge_name) if isinstance(judge_overrides, dict) else {}
        if not isinstance(payload, dict):
            return defaults
        return {
            "temperature": _clamp_float(
                payload.get("temperature"),
                minimum=0.0,
                maximum=2.0,
                default=defaults["temperature"],
            ),
            "max_tokens": _clamp_int(
                payload.get("max_tokens"),
                minimum=1,
                maximum=8192,
                default=defaults["max_tokens"],
            ),
        }

    def _fallback_judge(self, judge_name: str, variant: dict[str, Any]) -> dict[str, Any]:
        """Heuristic fallback when no LLM API keys are configured.

        SAFETY: Scores are capped at 0.75 so fallback-judged variants NEVER
        auto-SHIP (threshold 0.85). They always land in REVIEW, requiring
        human approval. This is critical for child safety.
        """
        prompt = (variant.get("image_prompt") or "").lower()
        score = 0.70
        flags: list[str] = ["fallback_judge"]
        if "text box" in prompt or "speech bubble" in prompt:
            score -= 0.2
            flags.append("garbled_text")
        if "blood" in prompt or "gore" in prompt:
            score -= 0.25
            flags.append("unsafe_content")
        if "no text" in prompt:
            score += 0.05
        # Cap at 0.75 to ensure fallback-scored variants never reach SHIP threshold
        return {
            "score": max(0.0, min(0.75, score)),
            "reasoning": f"heuristic fallback for {judge_name} — requires human review",
            "flags": flags,
            "provider": "fallback",
        }

    def _has_local_models(self) -> bool:
        """Check if local models are enabled and multimodal Gemma is available."""
        from model_router import _is_enabled
        if not _is_enabled():
            return False
        return bool(os.environ.get("LOCAL_GEMMA_URL"))

    def provider_for_judge(self, judge_name: str) -> str | None:
        has_local = self._has_local_models()
        has_xai = bool(_first_env("XAI_IMAGE_API_KEY", "XAI_API_KEY"))
        has_openai = bool(os.environ.get("OPENAI_API_KEY"))
        has_google = bool(_first_env("GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"))
        has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))

        # Local models for non-safety judges (child_safety stays on frontier)
        if has_local and judge_name != "child_safety":
            return "local"

        if has_xai and judge_name in {"child_safety", "text_accuracy"}:
            return "xai"
        if has_openai and judge_name in {"cultural_representation"}:
            return "openai"
        if has_google and judge_name in {"visual_clarity", "fact_checker"}:
            return "google"
        if has_anthropic and judge_name in {"misinterpretation_hunter", "pedagogical_effectiveness"}:
            return "anthropic"
        if has_xai:
            return "xai"
        if has_google:
            return "google"
        if has_openai:
            return "openai"
        if has_anthropic:
            return "anthropic"
        return None

    def _call_local(
        self,
        prompt: str,
        image_b64: str,
        mime: str,
        *,
        temperature: float,
        max_tokens: int,
        judge_name: str | None = None,
    ) -> str:
        """Call a local Gemma model for image evaluation.

        Model size selected per judge via model_router._JUDGE_MODEL_MAP.
        """
        from model_router import call_local_image_judge, Provider
        if not os.environ.get("LOCAL_GEMMA_URL"):
            raise ConnectionError("Image judging requires multimodal model — LOCAL_GEMMA_URL not set")
        return call_local_image_judge(
            prompt, image_b64, mime,
            temperature=temperature,
            max_tokens=max_tokens,
            provider=Provider.LOCAL_GEMMA,
            judge_name=judge_name,
        )

    def call_provider(
        self,
        provider: str,
        prompt: str,
        image_b64: str,
        mime: str,
        *,
        temperature: float,
        max_tokens: int,
        judge_name: str | None = None,
    ) -> str:
        if provider == "local":
            return self._call_local(prompt, image_b64, mime, temperature=temperature, max_tokens=max_tokens, judge_name=judge_name)
        if provider == "xai":
            return self._call_xai(prompt, image_b64, mime, temperature=temperature, max_tokens=max_tokens)
        if provider == "openai":
            return self._call_openai(prompt, image_b64, mime, temperature=temperature, max_tokens=max_tokens)
        if provider == "google":
            return self._call_google(prompt, image_b64, mime, temperature=temperature, max_tokens=max_tokens)
        if provider == "anthropic":
            return self._call_anthropic(prompt, image_b64, mime, temperature=temperature, max_tokens=max_tokens)
        raise ValueError(f"unsupported provider {provider}")

    def _call_xai(self, prompt: str, image_b64: str, mime: str, *, temperature: float, max_tokens: int) -> str:
        api_key = _first_env("XAI_IMAGE_API_KEY", "XAI_API_KEY")
        model = os.environ.get("XAI_EVAL_MODEL", "grok-4")
        with httpx.Client(timeout=120) as client:
            resp = client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "Return valid JSON only."},
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                                {"type": "text", "text": prompt},
                            ],
                        },
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    def _call_openai(self, prompt: str, image_b64: str, mime: str, *, temperature: float, max_tokens: int) -> str:
        api_key = os.environ.get("OPENAI_API_KEY")
        model = os.environ.get("OPENAI_EVAL_MODEL", "gpt-4o")
        with httpx.Client(timeout=120) as client:
            resp = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": "Return valid JSON only."},
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}", "detail": "high"}},
                                {"type": "text", "text": prompt},
                            ],
                        },
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    def _call_google(self, prompt: str, image_b64: str, mime: str, *, temperature: float, max_tokens: int) -> str:
        api_key = _first_env("GOOGLE_AI_API_KEY", "GOOGLE_API_KEY")
        model = os.environ.get("GOOGLE_EVAL_MODEL", "gemini-3-flash-preview")
        with httpx.Client(timeout=120) as client:
            resp = client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
                json={
                    "contents": [{
                        "parts": [
                            {"inline_data": {"mime_type": mime, "data": image_b64}},
                            {"text": prompt},
                        ]
                    }],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "temperature": temperature,
                        "maxOutputTokens": max_tokens,
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]

    def _call_anthropic(self, prompt: str, image_b64: str, mime: str, *, temperature: float, max_tokens: int) -> str:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        model = os.environ.get("ANTHROPIC_EVAL_MODEL", "claude-sonnet-4-20250514")
        with httpx.Client(timeout=120) as client:
            resp = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": mime, "data": image_b64}},
                            {"type": "text", "text": prompt},
                        ],
                    }],
                },
            )
            resp.raise_for_status()
            return resp.json()["content"][0]["text"]

    def _judge_prompt(
        self,
        judge_name: str,
        row: dict[str, Any],
        variant: dict[str, Any],
        *,
        distillation_text: str = "",
        distillation_strategy: str = "",
    ) -> str:
        fact = row["fact_text"]
        subject = row["subject_name"]
        age = row["age_range"]
        capsule = row["capsule_name"]
        misconceptions = row.get("misconceptions") or ""
        base = (
            "Return strict JSON with keys: score (0..1), reasoning, flags (string array). "
            f"Subject={subject}; Age={age}; Capsule={capsule}; Fact={fact}. "
            f"Image prompt used: {variant.get('image_prompt','')[:280]}."
        )
        # Distillation context: when the image was generated from a specific explanation,
        # judges should evaluate the image against both the fact AND the explanation it depicts.
        if distillation_text:
            base += (
                f" This image was generated to accompany the following teaching explanation "
                f"(strategy: {distillation_strategy}): {distillation_text[:600]}. "
                f"Evaluate whether the image accurately depicts what the explanation describes "
                f"AND correctly represents the underlying fact."
            )
        misconception_context = ""
        if misconceptions and judge_name in {"misinterpretation_hunter", "fact_checker", "pedagogical_effectiveness"}:
            misconception_context = f" Known misconceptions for this fact: {misconceptions[:500]}. Check whether the image reinforces any of these."
        judge_specific = {
            "child_safety": "Evaluate child safety and emotional appropriateness for the target age group.",
            "fact_checker": f"Evaluate factual correctness for the stated fact.{misconception_context}",
            "misinterpretation_hunter": f"Evaluate whether image could reinforce misconceptions or be misinterpreted by a child.{misconception_context}",
            "visual_clarity": "Evaluate visual clarity, AI artifacts, composition, and focal point.",
            "text_accuracy": "Evaluate all visible text, labels, symbols, and numbers for accuracy and legibility.",
            "pedagogical_effectiveness": f"Evaluate whether image actually helps a student learn the target fact.{misconception_context}",
            "cultural_representation": "Evaluate inclusion, diversity, and stereotyping risk.",
        }
        return f"{base} {judge_specific.get(judge_name, '')}"


SERVICE = ImageEvalService()
