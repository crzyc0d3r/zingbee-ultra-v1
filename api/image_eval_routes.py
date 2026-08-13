"""Image generation/evaluation command API for red-team Data UI."""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import db
from image_eval_policy import JUDGE_NAMES
from image_prompting import supported_prompt_strategies
from image_eval_service import SERVICE

log = logging.getLogger(__name__)

router = APIRouter(prefix="/image-eval", tags=["image-eval"])

_auth_sessions = None
_running_threads: dict[str, threading.Thread] = {}

_ALLOWED_COMMANDS = {"generate", "evaluate", "reprompt", "loop"}
_DEFAULT_IMAGE_MODEL_OPTIONS = [
    "xai:grok-imagine-image",
    "google:gemini-2.5-flash-image",
    "google:gemini-3.1-flash-image-preview",
    "google:gemini-3-pro-image-preview",
]


def init_auth(auth_sessions_ref: dict):
    global _auth_sessions
    _auth_sessions = auth_sessions_ref


def require_auth(request: Request):
    if _auth_sessions is None:
        return None
    token = request.cookies.get("session_token")
    if not token:
        return None
    info = _auth_sessions.get(token)
    if not info:
        return None
    if datetime.now(tz=timezone.utc) > info["expires"]:
        del _auth_sessions[token]
        return None
    return info


class ScopeBody(BaseModel):
    subject: str | None = None
    phase: int
    theme: str
    capsule: str


class CommandBody(BaseModel):
    command: str = Field(..., description="generate|evaluate|reprompt|loop")
    scope: ScopeBody
    options: dict[str, Any] = Field(default_factory=dict)


def _csv_or_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [x.strip() for x in value.split(",") if x.strip()]
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    return [str(value).strip()] if str(value).strip() else []


def _normalize_judge_params(raw_params: Any) -> dict[str, dict[str, float | int]]:
    if not isinstance(raw_params, dict):
        return {}
    normalized: dict[str, dict[str, float | int]] = {}
    allowed = set(JUDGE_NAMES)
    for judge_name, payload in raw_params.items():
        if judge_name not in allowed or not isinstance(payload, dict):
            continue
        entry: dict[str, float | int] = {}
        temp = payload.get("temperature")
        if temp is not None:
            try:
                t = float(temp)
                if 0.0 <= t <= 2.0:
                    entry["temperature"] = round(t, 3)
            except (TypeError, ValueError):
                pass
        max_tokens = payload.get("max_tokens")
        if max_tokens is not None:
            try:
                mt = int(max_tokens)
                if 1 <= mt <= 8192:
                    entry["max_tokens"] = mt
            except (TypeError, ValueError):
                pass
        if entry:
            normalized[judge_name] = entry
    return normalized


def _normalize_options(command: str, raw: dict[str, Any] | None) -> dict[str, Any]:
    def _to_int(value: Any, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
        if value is None or value == "":
            num = default
        else:
            num = int(value)
        if minimum is not None:
            num = max(minimum, num)
        if maximum is not None:
            num = min(maximum, num)
        return num

    def _opt_str(key: str):
        v = raw.get(key)
        if v:
            out[key] = str(v).strip()

    raw = raw or {}
    out: dict[str, Any] = {}

    # -- Shared across all commands --
    _opt_str("prompt_version")
    out["max_runtime_sec"] = _to_int(raw.get("max_runtime_sec"), 900, minimum=10, maximum=7200)
    image_models = _csv_or_list(raw.get("image_models"))
    prompt_strategies = _csv_or_list(raw.get("prompt_strategies"))
    if image_models:
        out["image_models"] = image_models
    if prompt_strategies:
        out["prompt_strategies"] = prompt_strategies

    # -- Filter fields (evaluate, reprompt, loop) --
    if command in {"evaluate", "reprompt", "loop"}:
        _opt_str("model")
        _opt_str("prompt_strategy")

    # -- Evaluation fields (evaluate, loop) --
    if command in {"evaluate", "loop"}:
        out["max_evaluations"] = _to_int(raw.get("max_evaluations"), 500, minimum=1, maximum=5000)
        judge_params = _normalize_judge_params(raw.get("judge_params"))
        if judge_params:
            out["judge_params"] = judge_params

    # -- Command-specific --
    if command == "generate":
        out["variants_per_fact"] = _to_int(raw.get("variants_per_fact"), 1, minimum=1, maximum=10)
        out["max_facts"] = _to_int(raw.get("max_facts"), 0, minimum=0, maximum=500)
        out["dry_run"] = bool(raw.get("dry_run", False))
        out["max_total_images"] = _to_int(raw.get("max_total_images"), 500, minimum=1, maximum=2000)
    elif command == "evaluate":
        out["limit"] = _to_int(raw.get("limit"), 0, minimum=0, maximum=5000)
        out["decision_mode"] = str(raw.get("decision_mode") or "combined_consensus")
        out["force"] = bool(raw.get("force", False))
    elif command == "reprompt":
        _opt_str("next_prompt_version")
    elif command == "loop":
        out["max_cycles"] = _to_int(raw.get("max_cycles"), 1, minimum=1, maximum=10)
        out["max_facts"] = _to_int(raw.get("max_facts"), 1, minimum=1, maximum=500)
        out["allow_generate_after_reprompt"] = bool(raw.get("allow_generate_after_reprompt", True))
        _opt_str("next_prompt_version")
        out["max_regeneration_per_command"] = _to_int(raw.get("max_regeneration_per_command"), 200, minimum=1, maximum=2000)
    return out


def _scope_targets(scope: ScopeBody, prompt_version: str = "") -> list[str]:
    targets = [
        f"subject:{scope.subject}" if scope.subject else "",
        f"phase:{scope.phase}",
        f"theme:{scope.theme}",
        f"capsule:{scope.capsule}",
    ]
    targets = [t for t in targets if t]
    if prompt_version:
        targets.append(f"prompt_version:{prompt_version}")
    return targets


def _run_async_job(job_id: str, body: CommandBody, actor: str):
    try:
        normalized_options = _normalize_options(body.command, body.options)

        def _is_cancelled() -> bool:
            row = db.get_eval_run(job_id)
            if not row:
                return True
            result = row.get("result") or {}
            return bool(result.get("cancelRequested"))

        def _on_progress(snapshot: dict[str, Any]):
            row = db.get_eval_run(job_id)
            if not row:
                return
            existing = row.get("result") or {}
            if existing.get("cancelRequested"):
                snapshot["cancelRequested"] = True
            db.save_eval_result(job_id, snapshot)

        summary = SERVICE.run_command(
            job_id=job_id,
            command=body.command,
            scope=body.scope.model_dump(),
            options=normalized_options,
            actor=actor,
            progress_callback=_on_progress,
            is_cancelled=_is_cancelled,
        )
        db.save_eval_result(job_id, summary)
        if summary.get("status") == "completed":
            db.complete_eval_run(job_id, "completed", exit_code=0, result=summary)
        elif summary.get("status") == "cancelled":
            db.complete_eval_run(job_id, "cancelled", exit_code=130, error="cancelled by user", result=summary)
        else:
            db.complete_eval_run(
                job_id,
                "failed",
                exit_code=2,
                error="image_eval_command_failed",
                result=summary,
            )
    except Exception as exc:
        log.exception("image-eval job failed: %s", exc)
        db.complete_eval_run(job_id, "failed", exit_code=2, error=str(exc))
    finally:
        _running_threads.pop(job_id, None)


@router.post("/api/jobs")
async def api_create_job(body: CommandBody, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    if body.command not in _ALLOWED_COMMANDS:
        return JSONResponse({"error": f"Unsupported command: {body.command}"}, status_code=400)

    scope_row = db.get_capsule_scope(
        body.scope.phase,
        body.scope.theme,
        body.scope.capsule,
        subject_name=body.scope.subject,
    )
    if not scope_row:
        return JSONResponse({"error": "Invalid scope. subject/phase/theme/capsule not found"}, status_code=400)

    try:
        options = _normalize_options(body.command, body.options)
    except (TypeError, ValueError) as exc:
        return JSONResponse({"error": f"Invalid options payload: {exc}"}, status_code=400)
    prompt_version = str(options.get("prompt_version", "")).strip()
    image_models = options.get("image_models") or []
    prompt_strategies = options.get("prompt_strategies") or []
    job_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + "_img_" + uuid.uuid4().hex[:6]
    targets = _scope_targets(body.scope, prompt_version)
    for model in image_models:
        targets.append(f"model:{model}")
    for strategy in prompt_strategies:
        targets.append(f"prompt_strategy:{strategy}")
    db.create_eval_run(
        job_id=job_id,
        targets=targets,
        config=f"image_eval:{body.command}",
        persona="operator",
        enable_grading=True,
        max_turns=None,
        pid=0,
    )
    db.save_eval_result(
        job_id,
        {
            "runType": "image_eval",
            "jobId": job_id,
            "status": "queued",
            "command": body.command,
            "scope": body.scope.model_dump(),
            "promptVersion": prompt_version,
            "imageModels": image_models,
            "promptStrategies": prompt_strategies,
            "currentStage": "queued",
            "itemsProcessed": 0,
            "totalCandidates": 0,
            "queuedAt": datetime.now(tz=timezone.utc).isoformat(),
            "actor": auth.get("email") or auth.get("display_name") or "operator",
        },
    )

    actor = auth.get("email") or auth.get("display_name") or "operator"
    thread = threading.Thread(target=_run_async_job, args=(job_id, body, actor), daemon=True)
    _running_threads[job_id] = thread
    thread.start()
    return {"jobId": job_id, "status": "running"}


@router.get("/api/jobs")
async def api_list_jobs(request: Request, command: str | None = None):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    if command and command not in _ALLOWED_COMMANDS:
        return JSONResponse({"error": f"Unsupported command filter: {command}"}, status_code=400)
    rows = db.fetchall(
        """
        SELECT *
        FROM eval_runs
        WHERE config LIKE %s
        ORDER BY started_at DESC
        LIMIT 500
        """,
        ("image_eval:%",),
    )
    jobs = []
    for row in rows:
        result = row.get("result") or {}
        command_name = row["config"].split("image_eval:", 1)[-1]
        if command and command_name != command:
            continue
        status = row["status"]
        if status == "running" and result.get("cancelRequested"):
            status = "cancel_requested"
        jobs.append(
            {
                "id": row["job_id"],
                "status": status,
                "command": command_name,
                "scope": result.get("scope", {}),
                "promptVersion": result.get("promptVersion", ""),
                "imageModels": result.get("imageModels", []),
                "promptStrategies": result.get("promptStrategies", []),
                "currentStage": result.get("currentStage", ""),
                "itemsProcessed": result.get("itemsProcessed", 0),
                "totalCandidates": result.get("totalCandidates", 0),
                "startedAt": row["started_at"].isoformat() if row.get("started_at") else None,
                "completedAt": row["completed_at"].isoformat() if row.get("completed_at") else None,
                "count": result.get("count", 0),
                "durationSec": result.get("durationSec", 0),
            }
        )
    return {"jobs": jobs}


@router.get("/api/jobs/{job_id}")
async def api_get_job(job_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    row = db.get_eval_run(job_id)
    if not row or not str(row.get("config", "")).startswith("image_eval:"):
        return JSONResponse({"error": "Job not found"}, status_code=404)
    result = row.get("result") or {}
    status = row["status"]
    if status == "running" and result.get("cancelRequested"):
        status = "cancel_requested"
    return {
        "id": job_id,
        "status": status,
        "command": row["config"].split("image_eval:", 1)[-1],
        "scope": result.get("scope", {}),
        "promptVersion": result.get("promptVersion", ""),
        "imageModels": result.get("imageModels", []),
        "promptStrategies": result.get("promptStrategies", []),
        "currentStage": result.get("currentStage", ""),
        "itemsProcessed": result.get("itemsProcessed", 0),
        "totalCandidates": result.get("totalCandidates", 0),
        "errors": result.get("errors", []),
        "result": result,
        "logTail": db.get_eval_log_tail(job_id, 30000),
    }


@router.post("/api/jobs/{job_id}/cancel")
async def api_cancel_job(job_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    row = db.get_eval_run(job_id)
    if not row or not str(row.get("config", "")).startswith("image_eval:"):
        return JSONResponse({"error": "Job not found"}, status_code=404)
    if row["status"] not in {"running"}:
        return {"ok": True, "status": row["status"]}
    existing_result = row.get("result") or {}
    existing_result["cancelRequested"] = True
    existing_result["cancelRequestedAt"] = datetime.now(tz=timezone.utc).isoformat()
    existing_result["currentStage"] = "cancel_requested"
    db.save_eval_result(job_id, existing_result)
    return {"ok": True, "status": "cancel_requested"}


@router.get("/api/variants")
async def api_list_variants(
    request: Request,
    phase: int,
    theme: str,
    capsule: str,
    subject: str | None = None,
    prompt_version: str | None = None,
    model: str | None = None,
    prompt_strategy: str | None = None,
):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    rows = db.list_curriculum_image_variants(
        subject_name=subject,
        phase=phase,
        theme_name=theme,
        capsule_name=capsule,
        prompt_version=prompt_version,
        model=model,
        prompt_strategy=prompt_strategy,
    )
    out = []
    for row in rows:
        variant = row["variant"]
        evaluation = variant.get("evaluation") or {}
        out.append(
            {
                "factId": row["fact_id"],
                "factOrder": row["fact_order"],
                "factText": row["fact_text"],
                "variantId": variant.get("id"),
                "imageUrl": variant.get("image_url"),
                "provider": (variant.get("generation") or {}).get("provider", ""),
                "model": (variant.get("generation") or {}).get("model", ""),
                "promptStrategy": variant.get("prompt_strategy", "baseline"),
                "combinationId": variant.get("combination_id", ""),
                "promptVersion": variant.get("prompt_version", ""),
                "composite": evaluation.get("composite"),
                "decision": evaluation.get("decision"),
                "reasons": evaluation.get("reasons") or [],
                "judges": evaluation.get("judges") or {},
                "humanReviewStatus": (variant.get("human_review") or {}).get("status"),
                "evaluatedAt": evaluation.get("evaluated_at"),
                "distillationVariantId": variant.get("distillation_variant_id"),
                "pairEvaluation": variant.get("pair_evaluation") or {},
            }
        )
    return {"variants": out}


@router.get("/api/options")
async def api_get_options(
    request: Request,
    subject: str | None = None,
    phase: int = 1,
    theme: str = "",
    capsule: str = "",
):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    if not theme or not capsule:
        return {
            "availableImageModels": _DEFAULT_IMAGE_MODEL_OPTIONS,
            "availablePromptStrategies": supported_prompt_strategies(),
            "promptVersions": [],
            "models": [],
            "promptStrategies": [],
        }

    rows = db.list_curriculum_image_variants(
        subject_name=subject,
        phase=phase,
        theme_name=theme,
        capsule_name=capsule,
    )
    prompt_versions: set[str] = set()
    models: set[str] = set()
    prompt_strategies: set[str] = set()
    for row in rows:
        variant = row.get("variant") or {}
        pv = str(variant.get("prompt_version") or "").strip()
        if pv:
            prompt_versions.add(pv)
        m = str((variant.get("generation") or {}).get("model") or "").strip()
        if m:
            models.add(m)
        s = str(variant.get("prompt_strategy") or "").strip()
        if s:
            prompt_strategies.add(s)

    return {
        "availableImageModels": _DEFAULT_IMAGE_MODEL_OPTIONS,
        "availablePromptStrategies": supported_prompt_strategies(),
        "promptVersions": sorted(prompt_versions),
        "models": sorted(models),
        "promptStrategies": sorted(prompt_strategies),
    }


@router.get("/api/dashboard/summary")
async def api_dashboard_summary(
    request: Request,
    phase: int,
    theme: str,
    capsule: str,
    subject: str | None = None,
    prompt_version: str | None = None,
    model: str | None = None,
    prompt_strategy: str | None = None,
):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    rows = db.list_curriculum_image_variants(
        subject_name=subject,
        phase=phase,
        theme_name=theme,
        capsule_name=capsule,
        prompt_version=prompt_version,
        model=model,
        prompt_strategy=prompt_strategy,
    )
    summary = {
        "total": 0,
        "ship": 0,
        "review": 0,
        "regenerate": 0,
        "pendingHuman": 0,
        "needsWorkHuman": 0,
        "approvedHuman": 0,
        "byCombo": {},
    }
    for row in rows:
        variant = row.get("variant") or {}
        evaluation = variant.get("evaluation") or {}
        decision = str(evaluation.get("decision") or "").upper()
        human_status = str((variant.get("human_review") or {}).get("status") or "").lower()
        combo = (
            f"{(variant.get('generation') or {}).get('provider') or 'unknown'}:"
            f"{(variant.get('generation') or {}).get('model') or 'unknown'}|"
            f"{variant.get('prompt_strategy') or 'baseline'}|"
            f"{variant.get('prompt_version') or '-'}"
        )
        summary["total"] += 1
        summary["byCombo"][combo] = int(summary["byCombo"].get(combo, 0)) + 1
        if decision == "SHIP":
            summary["ship"] += 1
        elif decision == "REVIEW":
            summary["review"] += 1
        elif decision == "REGENERATE":
            summary["regenerate"] += 1

        if human_status in {"approve", "approved"}:
            summary["approvedHuman"] += 1
        elif human_status in {"needs_work", "reject"}:
            summary["needsWorkHuman"] += 1
        elif human_status == "pending" or decision == "REVIEW" or not human_status:
            summary["pendingHuman"] += 1
    return summary


@router.get("/api/hitl/queue")
async def api_hitl_queue(
    request: Request,
    phase: int,
    theme: str,
    capsule: str,
    subject: str | None = None,
    prompt_version: str | None = None,
    model: str | None = None,
    prompt_strategy: str | None = None,
    queue_filter: str = "pending",
    limit: int = 500,
):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    if queue_filter not in {"pending", "needs_work", "review", "all"}:
        return JSONResponse({"error": "queue_filter must be pending|needs_work|review|all"}, status_code=400)
    rows = db.list_curriculum_image_variants(
        subject_name=subject,
        phase=phase,
        theme_name=theme,
        capsule_name=capsule,
        prompt_version=prompt_version,
        model=model,
        prompt_strategy=prompt_strategy,
    )
    out = []
    max_items = max(1, min(limit, 5000))
    for row in rows:
        variant = row.get("variant") or {}
        evaluation = variant.get("evaluation") or {}
        review = variant.get("human_review") or {}
        decision = str(evaluation.get("decision") or "").upper()
        human_status = str(review.get("status") or "").lower()
        if queue_filter == "pending":
            if not (human_status in {"", "pending"} or decision == "REVIEW"):
                continue
        elif queue_filter == "needs_work":
            if not (human_status in {"needs_work", "reject"} or decision == "REGENERATE"):
                continue
        elif queue_filter == "review":
            if decision != "REVIEW":
                continue
        out.append(
            {
                "factId": row["fact_id"],
                "factOrder": row["fact_order"],
                "factText": row["fact_text"],
                "variantId": variant.get("id"),
                "imageUrl": variant.get("image_url"),
                "provider": (variant.get("generation") or {}).get("provider", ""),
                "model": (variant.get("generation") or {}).get("model", ""),
                "promptStrategy": variant.get("prompt_strategy", "baseline"),
                "combinationId": variant.get("combination_id", ""),
                "promptVersion": variant.get("prompt_version", ""),
                "decision": evaluation.get("decision"),
                "composite": evaluation.get("composite"),
                "reasons": evaluation.get("reasons") or [],
                "judges": evaluation.get("judges") or {},
                "humanReviewStatus": review.get("status"),
                "humanReviewNote": review.get("note"),
                "humanReviewUpdatedBy": review.get("updated_by"),
                "humanReviewUpdatedAt": review.get("updated_at"),
                "humanOverride": evaluation.get("human_override") or {},
                "evaluatedAt": evaluation.get("evaluated_at"),
                "distillationVariantId": variant.get("distillation_variant_id"),
                "pairEvaluation": variant.get("pair_evaluation") or {},
            }
        )
        if len(out) >= max_items:
            break
    return {"queue": out, "count": len(out), "queueFilter": queue_filter}


@router.post("/api/variants/{fact_id}/{variant_id}/review")
async def api_review_variant(fact_id: str, variant_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    body = await request.json()
    action = body.get("action")
    if action not in {"approve", "reject", "needs_work"}:
        return JSONResponse({"error": "Invalid action"}, status_code=400)

    actor = auth.get("email") or auth.get("display_name") or "operator"
    note = body.get("note", "")

    def _mut(v: dict[str, Any]) -> dict[str, Any]:
        review = dict(v.get("human_review") or {})
        review["status"] = action
        review["note"] = note
        review["updated_by"] = actor
        review["updated_at"] = datetime.now(tz=timezone.utc).isoformat()
        v["human_review"] = review
        return v

    row = db.update_curriculum_fact_variant(fact_id, variant_id, _mut)
    if not row:
        return JSONResponse({"error": "Variant not found"}, status_code=404)
    return {"ok": True}


@router.post("/api/variants/{fact_id}/{variant_id}/override")
async def api_override_variant_score(fact_id: str, variant_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    body = await request.json()
    decision = str(body.get("decision") or "").strip().upper()
    if decision not in {"SHIP", "REVIEW", "REGENERATE"}:
        return JSONResponse({"error": "decision must be SHIP|REVIEW|REGENERATE"}, status_code=400)
    try:
        composite = float(body.get("composite"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "composite must be a number"}, status_code=400)
    if composite < 0.0 or composite > 1.0:
        return JSONResponse({"error": "composite must be between 0 and 1"}, status_code=400)
    note = str(body.get("note") or "").strip()
    actor = auth.get("email") or auth.get("display_name") or "operator"

    def _mut(v: dict[str, Any]) -> dict[str, Any]:
        evaluation = dict(v.get("evaluation") or {})
        original_composite = evaluation.get("composite")
        original_decision = evaluation.get("decision")
        evaluation["composite"] = round(composite, 4)
        evaluation["decision"] = decision
        overrides = dict(evaluation.get("human_override") or {})
        overrides["by"] = actor
        overrides["at"] = datetime.now(tz=timezone.utc).isoformat()
        overrides["note"] = note
        overrides["original_composite"] = original_composite
        overrides["original_decision"] = original_decision
        evaluation["human_override"] = overrides
        v["evaluation"] = evaluation
        review = dict(v.get("human_review") or {})
        review["status"] = "approved" if decision == "SHIP" else "needs_work"
        review["note"] = note
        review["updated_by"] = actor
        review["updated_at"] = datetime.now(tz=timezone.utc).isoformat()
        v["human_review"] = review
        return v

    row = db.update_curriculum_fact_variant(fact_id, variant_id, _mut)
    if not row:
        return JSONResponse({"error": "Variant not found"}, status_code=404)
    return {"ok": True}


@router.post("/api/variants/{fact_id}/{variant_id}/regenerate")
async def api_regenerate_variant(fact_id: str, variant_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    body = await request.json()
    subject = body.get("subject")
    try:
        phase = int(body.get("phase"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "phase must be a valid integer"}, status_code=400)
    theme = body.get("theme")
    capsule = body.get("capsule")
    next_prompt_version = str(body.get("next_prompt_version") or "").strip() or None
    if not phase or not theme or not capsule:
        return JSONResponse({"error": "phase/theme/capsule required"}, status_code=400)

    actor = auth.get("email") or auth.get("display_name") or "operator"
    summary = SERVICE.regenerate_single_variant(
        scope={"subject": subject, "phase": phase, "theme": theme, "capsule": capsule},
        fact_id=fact_id,
        variant_id=variant_id,
        actor=actor,
        next_prompt_version=next_prompt_version,
    )
    return {"ok": True, "result": summary}
