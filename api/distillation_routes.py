"""Distillation pipeline API routes for Red Team Studio."""

from __future__ import annotations

import asyncio
import atexit
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import db
from distillation_pipeline import PIPELINE
from image_eval_service import SERVICE as IMAGE_SERVICE

log = logging.getLogger(__name__)

router = APIRouter(prefix="/distillations/api", tags=["distillations"])

_auth_sessions = None
_running_threads: dict[str, threading.Thread] = {}
_running_threads_lock = threading.Lock()  # H-1: protects _running_threads count-check + insert
_regen_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="regen")
atexit.register(_regen_pool.shutdown, wait=False)

# H-20: derive allowed commands from pipeline (single source of truth)
_ALLOWED_COMMANDS = PIPELINE.SUPPORTED_COMMANDS

MAX_CONCURRENT_JOBS = 5
_CANCEL_TTL = 5.0  # H-11: cancellation check TTL in seconds


def init_auth(auth_sessions_ref: dict):
    global _auth_sessions
    _auth_sessions = auth_sessions_ref


def reset_zombie_regenerations():
    """Reset any variants stuck in 'regenerating' status from a prior process crash."""
    try:
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                for table in ("curriculum_fact_distillations", "curriculum_fact_images"):
                    cur.execute(f"""
                        SELECT id, curriculum_fact_id, meta_data
                        FROM {table}
                        WHERE EXISTS (
                            SELECT 1 FROM unnest(meta_data) AS v
                            WHERE v->>'status' = 'regenerating'
                        )
                        FOR UPDATE
                    """)
                    rows = cur.fetchall()
                    for row in rows:
                        variants = list(row.get("meta_data") or [])
                        changed = False
                        for idx, v in enumerate(variants):
                            if v.get("status") == "regenerating":
                                v = dict(v)
                                v["status"] = "rejected"
                                review = dict(v.get("human_review") or {})
                                review["status"] = "regeneration_failed"
                                review["note"] = "Reset on startup — regeneration was interrupted"
                                v["human_review"] = review
                                variants[idx] = v
                                changed = True
                        if changed:
                            payload = json.dumps(variants)
                            cur.execute(f"""
                                UPDATE {table}
                                   SET meta_data = (
                                       SELECT COALESCE(array_agg(elem), ARRAY[]::jsonb[])
                                       FROM jsonb_array_elements(%s::jsonb) elem
                                   )
                                 WHERE id = %s
                            """, (payload, row["id"]))
                            log.info("Reset zombie regenerating variants in %s row %s", table, row["id"])
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        # Also mark stale "running" distillation jobs as failed
        try:
            conn2 = db.get_conn()
            try:
                with conn2.cursor() as cur:
                    cur.execute("""
                        UPDATE eval_runs
                           SET status = 'failed',
                               completed_at = NOW()
                         WHERE status = 'running'
                           AND config LIKE 'distillation:%%'
                         RETURNING job_id
                    """)
                    stale = cur.fetchall()
                    for row in stale:
                        log.info("Marked stale distillation job %s as failed on startup", row["job_id"])
                conn2.commit()
            except Exception:
                conn2.rollback()
                raise
            finally:
                conn2.close()
        except Exception:
            log.exception("Failed to reset stale running jobs on startup")
    except Exception:
        log.exception("Failed to reset zombie regenerations on startup")


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
        _auth_sessions.pop(token, None)  # H-1: pop instead of del to avoid KeyError on concurrent expiry
        return None
    return info


def _require_operator(request: Request):
    """Auth check that also blocks student role. Returns (info, status_code) or (None, error_code)."""
    info = require_auth(request)
    if not info:
        return None, 401
    if info.get("role") == "student":
        return None, 403
    return info, 200


class ScopeBody(BaseModel):
    subject: str | None = None
    phase: int
    theme: str
    capsule: str


class CommandBody(BaseModel):
    command: str = Field(..., description="Pipeline command")
    scope: ScopeBody
    options: dict[str, Any] = Field(default_factory=dict)


class ReviewActionBody(BaseModel):
    type: str = Field(..., description="'explanation', 'image', or 'pair'")
    factId: str
    variantId: str
    action: str = Field(..., description="'approve', 'reject', 'needs_work', or 'regenerate'")
    note: str = Field("", max_length=2000)
    scope: dict[str, Any] | None = None


class BulkReviewActionBody(BaseModel):
    type: str = Field(..., description="'explanation' or 'image'")
    action: str = Field(..., description="'approve' or 'reject'")
    phase: int | None = None
    theme: str | None = None
    capsule: str | None = None
    subject: str | None = None
    minScore: float | None = None
    factIds: list[str] | None = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Job management
# ---------------------------------------------------------------------------

def _run_async_job(job_id: str, body: CommandBody, actor: str):
    try:
        _cancel_state = {"value": False, "checked_at": 0.0}

        def _is_cancelled() -> bool:
            # H-11: cache cancellation state with 5s TTL to avoid per-iteration DB connections
            now = time.monotonic()
            if now - _cancel_state["checked_at"] < _CANCEL_TTL:
                return _cancel_state["value"]
            try:
                row = db.get_eval_run(job_id)
                result = bool((row.get("result") or {}).get("cancelRequested")) if row else True
            except Exception:
                log.warning("DB check failed for cancellation of %s", job_id)
                result = _cancel_state["value"]  # use cached value on DB error
            _cancel_state["value"] = result
            _cancel_state["checked_at"] = now
            return result

        def _on_progress(snapshot: dict[str, Any]):
            try:
                row = db.get_eval_run(job_id)
                if not row:
                    return
                existing = row.get("result") or {}
                if existing.get("cancelRequested"):
                    snapshot["cancelRequested"] = True
                db.save_eval_result(job_id, snapshot)
            except Exception:
                log.warning("Failed to persist progress for %s", job_id)

        summary = PIPELINE.run_command(
            job_id=job_id,
            command=body.command,
            scope=body.scope.model_dump(),
            options=body.options,
            actor=actor,
            progress_callback=_on_progress,
            is_cancelled=_is_cancelled,
        )
        db.save_eval_result(job_id, summary)
        status = summary.get("status", "")
        if status == "completed":
            db.complete_eval_run(job_id, "completed", exit_code=0, result=summary)
        elif status == "cancelled":
            db.complete_eval_run(job_id, "cancelled", exit_code=130, error="cancelled", result=summary)
        else:
            db.complete_eval_run(job_id, "failed", exit_code=2, error="pipeline_failed", result=summary)
    except Exception as exc:
        log.exception("distillation job failed: %s", exc)
        safe_error = type(exc).__name__
        db.complete_eval_run(job_id, "failed", exit_code=2, error=f"pipeline_error: {safe_error}")
    finally:
        _running_threads.pop(job_id, None)


def _check_prerequisites(command: str, scope: dict) -> list[str]:
    """Check if prerequisites are met for a pipeline command. Returns list of blocking issues."""
    issues = []
    scope_kwargs = {
        "subject_name": scope.get("subject"),
        "phase": scope.get("phase"),
        "theme_name": scope.get("theme"),
        "capsule_name": scope.get("capsule"),
    }

    if command == "evaluate_explanations":
        drafts = db.list_distillation_variants(**scope_kwargs, status="draft")
        if not drafts:
            issues.append("No draft distillations to evaluate. Run Generate first.")

    elif command == "generate_images":
        approved = db.list_distillation_variants(**scope_kwargs, status="approved")
        if not approved:
            issues.append("No approved distillations. Generate and evaluate distillations first.")
        else:
            # M-5: also check that approved variants actually have image prompts
            with_prompts = [r for r in approved if r["variant"].get("image_prompt")]
            if not with_prompts:
                issues.append(
                    "No approved distillations have image prompts. "
                    "Re-run Evaluate Explanations to generate image prompts."
                )

    elif command in ("evaluate_images", "evaluate_pairs"):
        images = db.list_curriculum_image_variants(**scope_kwargs)
        if not images:
            issues.append("No images to evaluate. Generate images first.")

    return issues


@router.post("/prerequisites")
async def api_check_prerequisites(body: CommandBody, request: Request):
    """Check if prerequisites are met for a command before starting it."""
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)
    issues = _check_prerequisites(body.command, body.scope.model_dump())
    return {"ok": len(issues) == 0, "issues": issues}


@router.post("/jobs")
async def api_create_job(body: CommandBody, request: Request):
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)
    if body.command not in _ALLOWED_COMMANDS:
        return JSONResponse({"error": f"Unsupported command: {body.command}"}, status_code=400)

    # H-1: lock count-check + insert atomically to prevent concurrent job limit bypass
    with _running_threads_lock:
        active = sum(1 for t in _running_threads.values() if t.is_alive())
        if active >= MAX_CONCURRENT_JOBS:
            return JSONResponse({"error": "Too many concurrent jobs"}, status_code=429)

        actor = auth.get("email") or auth.get("display_name") or "operator"
        job_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + "_dist_" + uuid.uuid4().hex[:6]

        targets = [t for t in [
            f"subject:{body.scope.subject}" if body.scope.subject else "",
            f"phase:{body.scope.phase}",
            f"theme:{body.scope.theme}",
            f"capsule:{body.scope.capsule}",
        ] if t]

        db.create_eval_run(
            job_id=job_id, targets=targets, config=f"distillation:{body.command}",
            persona="operator", enable_grading=True, max_turns=None, pid=0,
        )
        db.save_eval_result(job_id, {
            "runType": "distillation",
            "jobId": job_id,
            "status": "queued",
            "command": body.command,
            "scope": body.scope.model_dump(),
            "currentStage": "queued",
            "itemsProcessed": 0,
            "totalCandidates": 0,
            "queuedAt": _utc_now_iso(),
            "actor": actor,
        })

        thread = threading.Thread(target=_run_async_job, args=(job_id, body, actor), daemon=True)
        _running_threads[job_id] = thread
        thread.start()

    return {"jobId": job_id, "status": "running"}


@router.get("/jobs")
async def api_list_jobs(request: Request):
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)
    rows = db.fetchall(
        "SELECT * FROM eval_runs WHERE config LIKE %s ORDER BY started_at DESC LIMIT 500",
        ("distillation:%",),
    )
    jobs = []
    for row in rows:
        result = row.get("result") or {}
        status = row["status"]
        if status == "running" and result.get("cancelRequested"):
            status = "cancel_requested"
        jobs.append({
            "id": row["job_id"],
            "status": status,
            "command": row["config"].split("distillation:", 1)[-1],
            "scope": result.get("scope", {}),
            "currentStage": result.get("currentStage", ""),
            "itemsProcessed": result.get("itemsProcessed", 0),
            "totalCandidates": result.get("totalCandidates", 0),
            "startedAt": row["started_at"].isoformat() if row.get("started_at") else None,
            "completedAt": row["completed_at"].isoformat() if row.get("completed_at") else None,
        })
    return {"jobs": jobs}


@router.post("/jobs/{job_id}/cancel")
async def api_cancel_job(job_id: str, request: Request):
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)
    row = db.get_eval_run(job_id)
    if not row or not str(row.get("config", "")).startswith("distillation:"):
        return JSONResponse({"error": "Job not found"}, status_code=404)
    if row["status"] != "running":
        return {"ok": True, "status": row["status"]}
    existing = row.get("result") or {}
    existing["cancelRequested"] = True
    existing["currentStage"] = "cancel_requested"
    db.save_eval_result(job_id, existing)
    return {"ok": True, "status": "cancel_requested"}


@router.post("/jobs/{job_id}/restart")
async def api_restart_job(job_id: str, request: Request):
    """Cancel the old job and start a fresh one with the same scope/command."""
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)
    row = db.get_eval_run(job_id)
    if not row:
        return JSONResponse({"error": "Job not found"}, status_code=404)
    # H-2: Cancel the existing job and wait for it to stop before spawning a replacement
    old_thread = _running_threads.get(job_id)
    if row["status"] == "running":
        existing = row.get("result") or {}
        existing["cancelRequested"] = True
        existing["currentStage"] = "cancel_requested"
        db.save_eval_result(job_id, existing)
        if old_thread and old_thread.is_alive():
            await asyncio.to_thread(old_thread.join, 30)
    result = row.get("result") or {}
    scope = result.get("scope", {})
    command = row["config"].split("distillation:", 1)[-1]
    # Resume from last checkpoint if available
    options = {}
    checkpoint = result.get("checkpointFactId")
    if checkpoint and command == "generate_explanations":
        options["resume_from_fact"] = checkpoint
        options["skip_existing"] = True
    body = CommandBody(command=command, scope=ScopeBody(**scope), options=options)
    return await api_create_job(body, request)


# ---------------------------------------------------------------------------
# Variant management
# ---------------------------------------------------------------------------

@router.get("/variants")
async def api_list_variants(
    request: Request,
    phase: int,
    theme: str,
    capsule: str,
    subject: str | None = None,
    status: str | None = None,
    strategy: str | None = None,
):
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)
    rows = db.list_distillation_variants(
        subject_name=subject, phase=phase, theme_name=theme,
        capsule_name=capsule, status=status, strategy=strategy,
    )
    out = []
    for row in rows:
        v = row["variant"]
        evaluation = v.get("evaluation") or {}
        out.append({
            "factId": row["fact_id"],
            "factOrder": row["fact_order"],
            "factText": row["fact_text"],
            "variantId": v.get("id"),
            "status": v.get("status"),
            "strategy": v.get("strategy"),
            "text": v.get("text"),
            "wordCount": v.get("word_count"),
            "suggestions": v.get("suggestions", []),
            "imagePrompt": v.get("image_prompt"),
            "compositeScore": evaluation.get("composite_score"),
            "decision": evaluation.get("decision"),
            "scores": evaluation.get("scores", {}),
            "reasons": evaluation.get("reasons", []),
            "humanReviewStatus": (v.get("human_review") or {}).get("status"),
            "createdAt": v.get("created_at"),
        })
    return {"variants": out}


@router.get("/review/queue")
async def api_review_queue(
    request: Request,
    phase: int,
    theme: str,
    capsule: str,
    subject: str | None = None,
    queue_filter: str = "review",
):
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    explanations = db.list_distillation_variants(
        subject_name=subject, phase=phase, theme_name=theme, capsule_name=capsule,
    )
    images = db.list_curriculum_image_variants(
        subject_name=subject, phase=phase, theme_name=theme, capsule_name=capsule,
    )

    explanation_queue = []
    for row in explanations:
        v = row["variant"]
        status = v.get("status", "")
        if queue_filter == "review" and status != "review":
            continue
        if queue_filter == "draft" and status != "draft":
            continue
        if queue_filter == "approved" and status != "approved":
            continue
        evaluation = v.get("evaluation") or {}
        explanation_queue.append({
            "type": "explanation",
            "factId": row["fact_id"],
            "factOrder": row["fact_order"],
            "factText": row["fact_text"],
            "variantId": v.get("id"),
            "status": status,
            "strategy": v.get("strategy"),
            "text": v.get("text"),
            "suggestions": v.get("suggestions", []),
            "compositeScore": evaluation.get("composite_score"),
            "decision": evaluation.get("decision"),
            "scores": evaluation.get("scores", {}),
        })

    image_queue = []
    for row in images:
        v = row["variant"]
        evaluation = v.get("evaluation") or {}
        human_status = (v.get("human_review") or {}).get("status", "")
        decision = evaluation.get("decision", "")
        if queue_filter == "review" and decision != "REVIEW" and human_status not in ("", "pending"):
            continue
        image_queue.append({
            "type": "image",
            "factId": row["fact_id"],
            "factOrder": row["fact_order"],
            "factText": row["fact_text"],
            "variantId": v.get("id"),
            "imageUrl": v.get("image_url"),
            "imagePrompt": v.get("image_prompt", ""),
            "composite": evaluation.get("composite"),
            "decision": decision,
            "scores": evaluation.get("scores", {}),
            "humanReviewStatus": human_status,
        })

    return {
        "explanations": explanation_queue,
        "images": image_queue,
        "counts": {
            "explanations": len(explanation_queue),
            "images": len(image_queue),
        },
    }


# ---------------------------------------------------------------------------
# Regeneration helpers
# ---------------------------------------------------------------------------

def _safe_regen_explanation(fact_id: str, variant_id: str, scope_data: dict, actor: str):
    """Run explanation regeneration with error recovery."""
    try:
        result = PIPELINE.regenerate_single_explanation(
            fact_id=fact_id, variant_id=variant_id, scope=scope_data, actor=actor,
        )
        if result.get("status") == "error":
            log.warning("Regen returned error for %s/%s: %s", fact_id, variant_id, result.get("error"))
    except Exception:
        log.exception("Explanation regen failed for %s/%s", fact_id, variant_id)
        try:
            def _rollback(v):
                v["status"] = "rejected"
                review = dict(v.get("human_review") or {})
                review["status"] = "regeneration_failed"
                v["human_review"] = review
                return v
            db.update_distillation_variant(fact_id, variant_id, _rollback)
        except Exception:
            log.exception("Failed to rollback regen status for %s/%s", fact_id, variant_id)


def _safe_regen_image(scope_data: dict, fact_id: str, variant_id: str, actor: str):
    """Run image regeneration with error recovery."""
    try:
        IMAGE_SERVICE.regenerate_single_variant(
            scope=scope_data, fact_id=fact_id, variant_id=variant_id, actor=actor,
        )
    except Exception:
        log.exception("Image regen failed for %s/%s", fact_id, variant_id)
        try:
            def _rollback(v):
                review = dict(v.get("human_review") or {})
                review["status"] = "regeneration_failed"
                v["human_review"] = review
                return v
            db.update_curriculum_fact_variant(fact_id, variant_id, _rollback)
        except Exception:
            log.exception("Failed to rollback image regen status for %s/%s", fact_id, variant_id)


def _validate_scope(scope_data: dict) -> str | None:
    """Validate scope has required keys. Returns error message or None."""
    for key in ("phase", "theme", "capsule"):
        if not scope_data.get(key):
            return f"Missing required scope field: {key}"
    return None


@router.post("/review/action")
async def api_review_action(body: ReviewActionBody, request: Request):
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    item_type = body.type
    fact_id = body.factId
    variant_id = body.variantId
    action = body.action
    note = body.note

    if not fact_id or not variant_id or action not in {"approve", "reject", "needs_work", "regenerate"}:
        return JSONResponse({"error": "Invalid parameters"}, status_code=400)

    scope_data = body.scope or {}
    if action == "regenerate":
        scope_error = _validate_scope(scope_data)
        if scope_error:
            return JSONResponse({"error": scope_error}, status_code=400)

    actor = auth.get("email") or auth.get("display_name") or "operator"
    now = datetime.now(tz=timezone.utc).isoformat()

    if item_type == "explanation":
        was_already_regenerating = False

        def _mut(v):
            nonlocal was_already_regenerating
            if action == "regenerate" and v.get("status") == "regenerating":
                was_already_regenerating = True
                return v
            review = dict(v.get("human_review") or {})
            review["status"] = action
            review["updated_by"] = actor
            review["updated_at"] = now
            if note:
                review["note"] = note
            v["human_review"] = review
            if action == "approve":
                v["status"] = "approved"
            elif action in ("reject", "needs_work"):
                v["status"] = "rejected"
            elif action == "regenerate":
                v["status"] = "regenerating"
            return v
        result = db.update_distillation_variant(fact_id, variant_id, _mut)

        if action == "regenerate" and result and not was_already_regenerating:
            _regen_pool.submit(_safe_regen_explanation, fact_id, variant_id, scope_data, actor)
    elif item_type == "image":
        was_already_regenerating = False

        def _mut(v):
            nonlocal was_already_regenerating
            if action == "regenerate" and v.get("status") == "regenerating":
                was_already_regenerating = True
                return v
            review = dict(v.get("human_review") or {})
            review["status"] = action
            review["updated_by"] = actor
            review["updated_at"] = now
            if note:
                review["note"] = note
            v["human_review"] = review
            if action == "approve":
                v["status"] = "approved"
            elif action in ("reject", "needs_work"):
                v["status"] = "rejected"
            elif action == "regenerate":
                v["status"] = "regenerating"
            return v
        result = db.update_curriculum_fact_variant(fact_id, variant_id, _mut)

        if action == "regenerate" and result and not was_already_regenerating:
            _regen_pool.submit(_safe_regen_image, scope_data, fact_id, variant_id, actor)
    elif item_type == "pair":
        def _mut(v):
            v["pair_human_review"] = {
                "status": action,
                "updated_by": actor,
                "updated_at": now,
            }
            if note:
                v["pair_human_review"]["note"] = note
            return v
        result = db.update_curriculum_fact_variant(fact_id, variant_id, _mut)
    else:
        return JSONResponse({"error": "type must be 'explanation', 'image', or 'pair'"}, status_code=400)

    if not result:
        return JSONResponse({"error": "Variant not found"}, status_code=404)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Bulk review actions
# ---------------------------------------------------------------------------

@router.post("/review/bulk-action")
async def api_bulk_review_action(body: BulkReviewActionBody, request: Request):
    """Bulk approve/reject variants matching criteria."""
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    item_type = body.type
    action = body.action
    min_score = body.minScore
    fact_ids = body.factIds

    if action not in ("approve", "reject"):
        return JSONResponse({"error": "Bulk action must be 'approve' or 'reject'"}, status_code=400)

    actor = auth.get("email") or auth.get("display_name") or "operator"
    now = datetime.now(tz=timezone.utc).isoformat()
    affected = 0

    if item_type == "explanation":
        phase = body.phase
        theme = body.theme
        capsule = body.capsule
        subject = body.subject
        if not phase or not theme or not capsule:
            return JSONResponse({"error": "scope (phase, theme, capsule) required"}, status_code=400)

        rows = db.list_distillation_variants(
            subject_name=subject, phase=phase, theme_name=theme, capsule_name=capsule,
        )
        updates = []
        for row in rows:
            v = row["variant"]
            fid = row["fact_id"]
            vid = v.get("id")

            if action == "approve" and v.get("status") == "approved":
                continue
            if action == "reject" and v.get("status") == "rejected":
                continue
            if fact_ids and fid not in fact_ids:
                continue
            if min_score is not None:
                score = (v.get("evaluation") or {}).get("composite_score")
                if score is None or score < min_score:
                    continue

            def _mut(v, _action=action, _actor=actor, _now=now):
                review = dict(v.get("human_review") or {})
                review["status"] = _action
                review["updated_by"] = _actor
                review["updated_at"] = _now
                review["bulk"] = True
                v["human_review"] = review
                v["status"] = "approved" if _action == "approve" else "rejected"
                return v

            updates.append((fid, vid, _mut))

        affected = db.bulk_update_distillation_variants(updates)

    elif item_type == "image":
        phase = body.phase
        theme = body.theme
        capsule = body.capsule
        subject = body.subject
        if not phase or not theme or not capsule:
            return JSONResponse({"error": "scope (phase, theme, capsule) required"}, status_code=400)

        rows = db.list_curriculum_image_variants(
            subject_name=subject, phase=phase, theme_name=theme, capsule_name=capsule,
        )
        updates = []
        for row in rows:
            v = row["variant"]
            fid = row["fact_id"]
            vid = v.get("id")

            if action == "approve" and v.get("status") == "approved":
                continue
            if action == "reject" and v.get("status") == "rejected":
                continue
            if fact_ids and fid not in fact_ids:
                continue
            if min_score is not None:
                score = (v.get("evaluation") or {}).get("composite")
                if score is None or score < min_score:
                    continue

            def _mut(v, _action=action, _actor=actor, _now=now):
                review = dict(v.get("human_review") or {})
                review["status"] = _action
                review["updated_by"] = _actor
                review["updated_at"] = _now
                review["bulk"] = True
                v["human_review"] = review
                v["status"] = "approved" if _action == "approve" else "rejected"
                return v

            updates.append((fid, vid, _mut))

        affected = db.bulk_update_image_variants(updates)

    else:
        return JSONResponse({"error": "type must be 'explanation' or 'image'"}, status_code=400)

    return {"ok": True, "affected": affected}


@router.get("/coverage")
async def api_coverage(
    request: Request,
    phase: int,
    theme: str,
    capsule: str,
    subject: str | None = None,
):
    """Show which facts have approved explanations and images. Includes ALL capsule facts."""
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    capsule_row = db.get_capsule_scope(phase, theme, capsule, subject_name=subject)
    all_capsule_facts: list[dict] = []
    if capsule_row:
        capsule_id = str(capsule_row["capsule_id"])
        all_capsule_facts = db.get_capsule_facts(capsule_id)

    explanations = db.list_distillation_variants(
        subject_name=subject, phase=phase, theme_name=theme, capsule_name=capsule,
    )
    images = db.list_curriculum_image_variants(
        subject_name=subject, phase=phase, theme_name=theme, capsule_name=capsule,
    )

    fact_explanations: dict[str, dict] = {}
    for row in explanations:
        fid = row["fact_id"]
        if fid not in fact_explanations:
            fact_explanations[fid] = {"factText": row["fact_text"], "total": 0, "approved": 0, "review": 0}
        fact_explanations[fid]["total"] += 1
        status = row["variant"].get("status", "")
        if status == "approved":
            fact_explanations[fid]["approved"] += 1
        elif status == "review":
            fact_explanations[fid]["review"] += 1

    fact_images: dict[str, dict] = {}
    for row in images:
        fid = row["fact_id"]
        if fid not in fact_images:
            fact_images[fid] = {"total": 0, "ship": 0, "review": 0, "pair_ship": 0, "pair_total": 0}
        fact_images[fid]["total"] += 1
        decision = (row["variant"].get("evaluation") or {}).get("decision", "")
        if decision == "SHIP":
            fact_images[fid]["ship"] += 1
        elif decision == "REVIEW":
            fact_images[fid]["review"] += 1
        # Track pair evaluation status for linked variants
        pair_eval = row["variant"].get("pair_evaluation") or {}
        pair_human = row["variant"].get("pair_human_review") or {}
        if row["variant"].get("distillation_variant_id"):
            fact_images[fid]["pair_total"] += 1
            if (pair_eval.get("decision") or "").upper() == "SHIP" or pair_human.get("status") == "approve":
                fact_images[fid]["pair_ship"] += 1

    coverage = []
    seen_fact_ids = set()
    for fact in all_capsule_facts:
        fid = str(fact["id"])
        seen_fact_ids.add(fid)
        fact_text = (fact.get("meta_data") or {}).get("core_fact", f"Fact #{fact.get('order', '?')}")
        exp = fact_explanations.get(fid, {"factText": fact_text, "total": 0, "approved": 0, "review": 0})
        img = fact_images.get(fid, {"total": 0, "ship": 0, "review": 0, "pair_ship": 0, "pair_total": 0})
        has_pairs = img["pair_total"] > 0
        pair_ready = img["pair_ship"] >= 1 if has_pairs else True
        coverage.append({
            "factId": fid,
            "factText": exp.get("factText") or fact_text,
            "factOrder": fact.get("order"),
            "explanations": {"total": exp["total"], "approved": exp["approved"], "review": exp["review"]},
            "images": {"total": img["total"], "ship": img["ship"], "review": img["review"]},
            "pairs": {"total": img["pair_total"], "ship": img["pair_ship"]},
            "ready": exp["approved"] >= 1 and img["ship"] >= 1 and pair_ready,
        })

    for fid in sorted(set(fact_explanations.keys()) | set(fact_images.keys())):
        if fid in seen_fact_ids:
            continue
        exp = fact_explanations.get(fid, {"factText": "", "total": 0, "approved": 0, "review": 0})
        img = fact_images.get(fid, {"total": 0, "ship": 0, "review": 0, "pair_ship": 0, "pair_total": 0})
        has_pairs = img["pair_total"] > 0
        pair_ready = img["pair_ship"] >= 1 if has_pairs else True
        coverage.append({
            "factId": fid,
            "factText": exp["factText"],
            "factOrder": None,
            "explanations": {"total": exp["total"], "approved": exp["approved"], "review": exp["review"]},
            "images": {"total": img["total"], "ship": img["ship"], "review": img["review"]},
            "pairs": {"total": img["pair_total"], "ship": img["pair_ship"]},
            "ready": exp["approved"] >= 1 and img["ship"] >= 1 and pair_ready,
        })

    total_facts = len(coverage)
    ready_facts = sum(1 for c in coverage if c["ready"])
    facts_with_approved_exp = sum(1 for c in coverage if c["explanations"]["approved"] >= 1)
    facts_with_shipped_img = sum(1 for c in coverage if c["images"]["ship"] >= 1)
    not_started = sum(1 for c in coverage if c["explanations"]["total"] == 0 and c["images"]["total"] == 0)
    in_progress = sum(1 for c in coverage if not c["ready"] and (c["explanations"]["total"] > 0 or c["images"]["total"] > 0))
    return {
        "coverage": coverage,
        "summary": {
            "totalFacts": total_facts,
            "readyFacts": ready_facts,
            "coveragePercent": round(ready_facts / total_facts * 100, 1) if total_facts else 0,
            "factsWithApprovedExplanation": facts_with_approved_exp,
            "factsWithShippedImage": facts_with_shipped_img,
            "notStarted": not_started,
            "inProgress": in_progress,
        },
    }


@router.get("/pairs")
async def api_pairs(
    request: Request,
    phase: int,
    theme: str,
    capsule: str,
    subject: str | None = None,
    pair_decision: str | None = None,
    limit: int = 500,
):
    """Return explanation+image pairs with both individual and pair evaluation scores."""
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    # Get approved explanations
    explanations = db.list_distillation_variants(
        subject_name=subject, phase=phase, theme_name=theme, capsule_name=capsule,
        status="approved",
    )

    # Get all image variants in this scope
    images = db.list_curriculum_image_variants(
        subject_name=subject, phase=phase, theme_name=theme, capsule_name=capsule,
    )

    # Index images by distillation_variant_id
    images_by_dist_id: dict[str, list[dict]] = {}
    for img_row in images:
        dist_id = img_row["variant"].get("distillation_variant_id")
        if dist_id:
            images_by_dist_id.setdefault(dist_id, []).append(img_row)

    pairs = []
    max_items = max(1, min(limit, 5000))

    for expl_row in explanations:
        expl_variant = expl_row["variant"]
        dist_id = expl_variant.get("id")
        if not dist_id:
            continue

        linked_images = images_by_dist_id.get(dist_id, [])
        if not linked_images:
            continue

        for img_row in linked_images:
            img_variant = img_row["variant"]
            img_eval = img_variant.get("evaluation") or {}
            pair_eval = img_variant.get("pair_evaluation") or {}
            expl_eval = expl_variant.get("evaluation") or {}

            # Filter by pair decision if requested
            if pair_decision:
                if (pair_eval.get("decision") or "").upper() != pair_decision.upper():
                    continue

            pairs.append({
                "factId": expl_row["fact_id"],
                "factOrder": expl_row["fact_order"],
                "factText": expl_row["fact_text"],
                # Explanation side
                "explanation": {
                    "variantId": expl_variant.get("id"),
                    "strategy": expl_variant.get("strategy", ""),
                    "text": expl_variant.get("text", ""),
                    "wordCount": expl_variant.get("word_count", 0),
                    "suggestions": expl_variant.get("suggestions") or [],
                    "imagePrompt": expl_variant.get("image_prompt", ""),
                    "compositeScore": expl_eval.get("composite_score"),
                    "decision": expl_eval.get("decision"),
                    "scores": expl_eval.get("scores") or {},
                },
                # Image side
                "image": {
                    "variantId": img_variant.get("id"),
                    "imageUrl": img_variant.get("image_url"),
                    "provider": (img_variant.get("generation") or {}).get("provider", ""),
                    "model": (img_variant.get("generation") or {}).get("model", ""),
                    "promptStrategy": img_variant.get("prompt_strategy", ""),
                    "promptVersion": img_variant.get("prompt_version", ""),
                    "composite": img_eval.get("composite"),
                    "decision": img_eval.get("decision"),
                    "judges": img_eval.get("judges") or {},
                },
                # Pair evaluation
                "pairEvaluation": {
                    "composite": pair_eval.get("composite"),
                    "decision": pair_eval.get("decision"),
                    "reasons": pair_eval.get("reasons") or [],
                    "judges": pair_eval.get("judges") or {},
                    "evaluatedAt": pair_eval.get("evaluated_at"),
                },
            })

            if len(pairs) >= max_items:
                break
        if len(pairs) >= max_items:
            break

    summary = {"total": len(pairs), "ship": 0, "review": 0, "regenerate": 0, "unevaluated": 0}
    for p in pairs:
        d = (p["pairEvaluation"].get("decision") or "").upper()
        if d == "SHIP":
            summary["ship"] += 1
        elif d == "REVIEW":
            summary["review"] += 1
        elif d == "REGENERATE":
            summary["regenerate"] += 1
        else:
            summary["unevaluated"] += 1

    return {"pairs": pairs, "summary": summary}


# ---------------------------------------------------------------------------
# Pipeline health analytics
# ---------------------------------------------------------------------------

@router.get("/health")
async def api_health(
    request: Request,
    subject: str | None = None,
    phase: int | None = None,
    drilldown: str | None = None,
):
    """Aggregate pipeline health stats across scopes.

    All params optional:
    - No params → global health across all subjects
    - subject=Biology → Biology only
    - subject=Biology&phase=2 → Biology Phase 2
    - drilldown=phase → include per-phase breakdown in byPhase
    """
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    raw = db.get_pipeline_health(subject_name=subject, phase=phase)

    # --- Build fact count lookup: (subject, phase) -> total_facts ---
    fact_lookup: dict[tuple[str, int], int] = {}
    for row in raw["fact_counts"]:
        fact_lookup[(row["subject"], row["phase"])] = row["total_facts"]

    # --- Build approved/ship fact lookup ---
    approved_lookup: dict[tuple[str, int], int] = {}
    for row in raw["facts_with_approved"]:
        approved_lookup[(row["subject"], row["phase"])] = row["cnt"]

    ship_lookup: dict[tuple[str, int], int] = {}
    for row in raw["facts_with_ship"]:
        ship_lookup[(row["subject"], row["phase"])] = row["cnt"]

    # --- Aggregate distillation stats ---
    # Per subject: {subject -> {total, approved, review, draft, rejected}}
    # Per strategy: {strategy -> {total, approved, rejected, scores[]}}
    subj_dist: dict[str, dict] = {}
    phase_dist: dict[tuple[str, int], dict] = {}
    strat_stats: dict[str, dict] = {}
    dist_scores: list[float] = []

    for row in raw["dist_stats"]:
        subj = row["subject"]
        ph = row["phase"]
        status = row["status"] or "unknown"
        strategy = row["strategy"] or "unknown"
        composite = row["composite"]

        # Per subject
        if subj not in subj_dist:
            subj_dist[subj] = {"total": 0, "approved": 0, "review": 0, "draft": 0, "rejected": 0}
        subj_dist[subj]["total"] += 1
        if status in subj_dist[subj]:
            subj_dist[subj][status] += 1

        # Per phase
        key = (subj, ph)
        if key not in phase_dist:
            phase_dist[key] = {"total": 0, "approved": 0, "review": 0, "draft": 0, "rejected": 0}
        phase_dist[key]["total"] += 1
        if status in phase_dist[key]:
            phase_dist[key][status] += 1

        # Per strategy
        if strategy not in strat_stats:
            strat_stats[strategy] = {"total": 0, "approved": 0, "rejected": 0, "scores": []}
        strat_stats[strategy]["total"] += 1
        if status == "approved":
            strat_stats[strategy]["approved"] += 1
        elif status == "rejected":
            strat_stats[strategy]["rejected"] += 1
        if composite is not None:
            strat_stats[strategy]["scores"].append(composite)
            dist_scores.append(composite)

    # --- Aggregate image stats ---
    subj_img: dict[str, dict] = {}
    subj_pair: dict[str, dict] = {}
    phase_img: dict[tuple[str, int], dict] = {}
    img_scores: list[float] = []

    for row in raw["img_stats"]:
        subj = row["subject"]
        ph = row["phase"]
        decision = (row["decision"] or "").upper()
        pair_decision = (row["pair_decision"] or "").upper()
        composite = row["composite"]

        # Per subject images
        if subj not in subj_img:
            subj_img[subj] = {"total": 0, "ship": 0, "review": 0, "regenerate": 0}
        subj_img[subj]["total"] += 1
        if decision == "SHIP":
            subj_img[subj]["ship"] += 1
        elif decision == "REVIEW":
            subj_img[subj]["review"] += 1
        elif decision == "REGENERATE":
            subj_img[subj]["regenerate"] += 1

        # Per subject pairs
        if subj not in subj_pair:
            subj_pair[subj] = {"total": 0, "ship": 0, "review": 0, "regenerate": 0}
        if pair_decision:
            subj_pair[subj]["total"] += 1
            if pair_decision == "SHIP":
                subj_pair[subj]["ship"] += 1
            elif pair_decision == "REVIEW":
                subj_pair[subj]["review"] += 1
            elif pair_decision == "REGENERATE":
                subj_pair[subj]["regenerate"] += 1

        # Per phase images
        key = (subj, ph)
        if key not in phase_img:
            phase_img[key] = {"total": 0, "ship": 0, "review": 0, "regenerate": 0}
        phase_img[key]["total"] += 1
        if decision == "SHIP":
            phase_img[key]["ship"] += 1
        elif decision == "REVIEW":
            phase_img[key]["review"] += 1
        elif decision == "REGENERATE":
            phase_img[key]["regenerate"] += 1

        if composite is not None:
            img_scores.append(composite)

    # --- Build response ---
    all_subjects = sorted(set(row["subject"] for row in raw["fact_counts"]))

    # --- Build distinct-fact lookups from SQL COUNT(DISTINCT) ---
    dist_fact_lookup: dict[tuple[str, int], int] = {}
    for row in raw["facts_with_dist"]:
        dist_fact_lookup[(row["subject"], row["phase"])] = row["cnt"]

    img_fact_lookup: dict[tuple[str, int], int] = {}
    for row in raw["facts_with_img"]:
        img_fact_lookup[(row["subject"], row["phase"])] = row["cnt"]

    # Global health
    total_facts = sum(fact_lookup.values())
    total_approved = sum(approved_lookup.values())
    total_ship = sum(ship_lookup.values())
    total_dist = sum(d["total"] for d in subj_dist.values())
    total_img = sum(d["total"] for d in subj_img.values())
    total_pair_ship = sum(d["ship"] for d in subj_pair.values())
    total_facts_with_dist = sum(dist_fact_lookup.values())
    total_facts_with_img = sum(img_fact_lookup.values())
    pipeline_complete = min(total_approved, total_ship)  # rough: facts with both

    # bySubject
    by_subject = []
    for subj in all_subjects:
        subj_facts = sum(fact_lookup.get((subj, ph), 0) for ph in range(1, 6))
        subj_approved_facts = sum(approved_lookup.get((subj, ph), 0) for ph in range(1, 6))
        subj_ship_facts = sum(ship_lookup.get((subj, ph), 0) for ph in range(1, 6))
        ready = min(subj_approved_facts, subj_ship_facts)
        by_subject.append({
            "subject": subj,
            "totalFacts": subj_facts,
            "distillations": subj_dist.get(subj, {"total": 0, "approved": 0, "review": 0, "draft": 0, "rejected": 0}),
            "images": subj_img.get(subj, {"total": 0, "ship": 0, "review": 0, "regenerate": 0}),
            "pairs": subj_pair.get(subj, {"total": 0, "ship": 0, "review": 0, "regenerate": 0}),
            "coveragePercent": round(ready / subj_facts * 100, 1) if subj_facts else 0,
        })

    # byPhase (only when drilldown=phase)
    by_phase = []
    if drilldown == "phase":
        for (subj, ph), total in sorted(fact_lookup.items()):
            approved_facts = approved_lookup.get((subj, ph), 0)
            ship_facts = ship_lookup.get((subj, ph), 0)
            ready = min(approved_facts, ship_facts)
            by_phase.append({
                "subject": subj,
                "phase": ph,
                "totalFacts": total,
                "distillations": phase_dist.get((subj, ph), {"total": 0, "approved": 0, "review": 0, "draft": 0, "rejected": 0}),
                "images": phase_img.get((subj, ph), {"total": 0, "ship": 0, "review": 0, "regenerate": 0}),
                "coveragePercent": round(ready / total * 100, 1) if total else 0,
            })

    # byStrategy
    by_strategy = {}
    for strat, data in sorted(strat_stats.items()):
        scores = data["scores"]
        by_strategy[strat] = {
            "total": data["total"],
            "approved": data["approved"],
            "rejected": data["rejected"],
            "avgScore": round(sum(scores) / len(scores), 3) if scores else 0,
            "sampleSize": len(scores),
        }

    # Quality distribution
    def _bucket(scores: list[float]) -> dict[str, int]:
        buckets = {"0-50": 0, "50-70": 0, "70-85": 0, "85-100": 0}
        for s in scores:
            pct = s * 100 if s <= 1 else s
            if pct < 50:
                buckets["0-50"] += 1
            elif pct < 70:
                buckets["50-70"] += 1
            elif pct < 85:
                buckets["70-85"] += 1
            else:
                buckets["85-100"] += 1
        return buckets

    # Rejection rates
    total_dist_rejected = sum(d["rejected"] for d in subj_dist.values())
    total_img_regen = sum(d["regenerate"] for d in subj_img.values())

    return {
        "health": {
            "totalFacts": total_facts,
            "factsWithDistillations": total_facts_with_dist,
            "factsWithApprovedDistillation": total_approved,
            "factsWithImages": total_facts_with_img,
            "factsWithShippedImage": total_ship,
            "factsWithShippedPair": total_pair_ship,
            "pipelineComplete": pipeline_complete,
            "coveragePercent": round(pipeline_complete / total_facts * 100, 1) if total_facts else 0,
        },
        "bySubject": by_subject,
        "byPhase": by_phase,
        "byStrategy": by_strategy,
        "qualityDistribution": {
            "explanations": _bucket(dist_scores),
            "images": _bucket(img_scores),
        },
        "rejectionRates": {
            "explanations": {
                "total": total_dist,
                "rejected": total_dist_rejected,
                "rate": round(total_dist_rejected / total_dist, 3) if total_dist else 0,
            },
            "images": {
                "total": total_img,
                "regenerated": total_img_regen,
                "rate": round(total_img_regen / total_img, 3) if total_img else 0,
            },
        },
        "recentActivity": {
            "jobsLast24h": (raw["recent_jobs"] or {}).get("jobs_last_24h", 0),
        },
    }


# ---------------------------------------------------------------------------
# Providers status
# ---------------------------------------------------------------------------

@router.get("/providers")
async def api_providers(request: Request):
    """Return available model providers and their online status."""
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    from model_router import get_provider_status
    return get_provider_status()


# ---------------------------------------------------------------------------
# Prompt overrides CRUD
# ---------------------------------------------------------------------------

class PromptOverrideBody(BaseModel):
    scope_type: str = Field(..., description="global, subject, phase, theme, or capsule")
    scope_key: str
    prompt_id: str = Field(default="explanation_gen_system")
    strategy: str | None = None
    override_type: str = Field(..., description="replace, prepend, or append")
    content: str = Field(..., max_length=8000)  # M-11: cap to prevent context exhaustion
    source: str = Field(default="manual")


@router.get("/prompt-overrides")
async def api_list_prompt_overrides(
    request: Request,
    scope_type: str | None = None,
    scope_key: str | None = None,
):
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    rows = db.list_prompt_overrides(scope_type=scope_type, scope_key=scope_key)
    overrides = []
    for row in rows:
        overrides.append({
            "id": str(row["id"]),
            "scopeType": row["scope_type"],
            "scopeKey": row["scope_key"],
            "promptId": row["prompt_id"],
            "strategy": row.get("strategy"),
            "overrideType": row["override_type"],
            "content": row["content"],
            "active": row["active"],
            "createdBy": row.get("created_by"),
            "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
            "updatedAt": row["updated_at"].isoformat() if row.get("updated_at") else None,
            "source": row.get("source", "manual"),
            "performanceData": row.get("performance_data"),
        })
    return {"overrides": overrides}


@router.post("/prompt-overrides")
async def api_upsert_prompt_override(body: PromptOverrideBody, request: Request):
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    actor = auth.get("email") or auth.get("display_name") or "operator"
    row = db.upsert_prompt_override(
        scope_type=body.scope_type,
        scope_key=body.scope_key,
        prompt_id=body.prompt_id,
        strategy=body.strategy,
        override_type=body.override_type,
        content=body.content,
        created_by=actor,
        source=body.source,
    )
    return {"ok": True, "id": str(row.get("id", ""))}


@router.delete("/prompt-overrides/{override_id}")
async def api_delete_prompt_override(override_id: str, request: Request):
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    found = db.deactivate_prompt_override(override_id)
    if not found:
        return JSONResponse({"error": "Override not found"}, status_code=404)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Prompt analysis (optimizer)
# ---------------------------------------------------------------------------

@router.get("/prompt-analysis")
async def api_prompt_analysis(
    request: Request,
    phase: int,
    theme: str,
    capsule: str,
    subject: str | None = None,
):
    """Quick read-only analysis of judge feedback for a scope."""
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    from prompt_optimizer import OPTIMIZER
    scope = {"subject": subject, "phase": phase, "theme": theme, "capsule": capsule}
    report = OPTIMIZER.analyze_scope(scope)

    return {
        "scope": scope,
        "totalVariants": report.total_variants,
        "evaluatedVariants": report.evaluated_variants,
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


class ApplySuggestionBody(BaseModel):
    scope_type: str
    scope_key: str
    prompt_id: str = "explanation_gen_system"
    strategy: str | None = None
    override_type: str
    content: str
    pattern_id: str
    rationale: str = ""
    expected_improvement: float = 0.0


@router.post("/prompt-analysis/apply")
async def api_apply_suggestion(body: ApplySuggestionBody, request: Request):
    """Apply a prompt optimizer suggestion as a prompt override."""
    auth, auth_status = _require_operator(request)
    if not auth:
        error_msg = "Forbidden" if auth_status == 403 else "Not authenticated"
        return JSONResponse({"error": error_msg}, status_code=auth_status)

    actor = auth.get("email") or auth.get("display_name") or "operator"
    row = db.upsert_prompt_override(
        scope_type=body.scope_type,
        scope_key=body.scope_key,
        prompt_id=body.prompt_id,
        strategy=body.strategy,
        override_type=body.override_type,
        content=body.content,
        created_by=actor,
        source="auto_optimizer",
        performance_data={
            "pattern_id": body.pattern_id,
            "expected_improvement": body.expected_improvement,
            "rationale": body.rationale,
        },
    )
    return {"ok": True, "id": str(row.get("id", ""))}
