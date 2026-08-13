"""Metaphor authoring + review API for Red Team Studio.

Endpoints under /api/metaphor-eval/*. Mirrors image_eval_routes.py:
  - POST /api/jobs                 — kick off propose+judge for capsule(s)
  - GET  /api/jobs / /api/jobs/{id} — list / inspect runs
  - POST /api/jobs/{id}/cancel     — cooperative cancel
  - GET  /api/capsules             — list capsules with current metaphor state
  - GET  /api/capsules/{id}        — full capsule view incl. proposal history
  - POST /api/capsules/{id}/regenerate — re-run propose+judge for one capsule
  - POST /api/capsules/{id}/review — human approve/reject/edit a winner
"""

from __future__ import annotations

import logging
import re
import threading
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import auth as auth_module
import db
from metaphor_eval_policy import JUDGE_NAMES, make_eval_identity
from metaphor_eval_service import SERVICE

log = logging.getLogger(__name__)

router = APIRouter(prefix="/metaphor-eval", tags=["metaphor-eval"])

_auth_sessions: dict | None = None
_running_threads: dict[str, threading.Thread] = {}
# Cross-worker in-flight job dedup is enforced via the eval_runs_locks table
# (db/009 + db.acquire_scope_dedup); see metaphor_eval_routes.api_create_job.
# We keep an in-process set as a fast-path optimization to avoid round-tripping
# the DB on the most common case (same operator double-clicking) but the DB
# row is the authoritative truth.
_running_scopes: set[str] = set()
_scope_lock = threading.Lock()

_ALLOWED_COMMANDS = {"evaluate", "regenerate"}
_ALLOWED_REVIEW_STATUSES = {
    "auto_accepted", "human_approved", "needs_review", "auto_rejected", "unset",
}
_ALLOWED_ROLES = {"admin", "operator"}

# Edit-then-approve hard limits. The lifted metaphor will be injected into
# tutor LLM prompts that go to children, so reject anything that smells like
# prompt injection or pasted noise. These are conservative; a domain-aware
# review queue (PR-A0d) is the gentler UX layer on top.
_METAPHOR_MAX_LEN = 200
_METAPHOR_MIN_LEN = 3
_INJECTION_PATTERNS = re.compile(
    # Common prompt-injection markers. Anchored on word boundaries where it matters
    # so "the system" doesn't false-positive on "system:".
    r"(ignore (previous|prior|all) instructions"
    r"|(?:^|\s)system\s*:"
    r"|(?:^|\s)assistant\s*:"
    r"|```"
    r"|<\|.*?\|>)",
    re.IGNORECASE,
)
# Strips ASCII control chars AND zero-width / bidi-override / formatting chars
# that can defeat the regex check by hiding inside otherwise-clean text.
# Per pre-ship review pass-2 NEW-1 — covers U+200B-U+200F (ZWSP/ZWNJ/ZWJ/LRM/RLM),
# U+202A-U+202E (LRE/RLE/PDF/LRO/RLO), U+2060 (word-joiner), U+FEFF (BOM),
# U+00AD (soft hyphen).
_CONTROL_CHARS = re.compile(
    "[\x00-\x08\x0b\x0c\x0e-\x1f\x7f"
    "­"           # soft hyphen
    "​-‏"    # ZWSP / ZWNJ / ZWJ / LRM / RLM
    "‪-‮"    # LRE / RLE / PDF / LRO / RLO
    "⁠"           # word-joiner
    "﻿]"          # BOM
)


def init_auth(auth_sessions_ref: dict) -> None:
    global _auth_sessions
    _auth_sessions = auth_sessions_ref
    auth_module.init(auth_sessions_ref)  # ensure auth_module sees the same store


def require_admin(request: Request):
    """Raise 401/403 unless the caller is an admin/operator. Returns the auth dict.

    Falls back gracefully when the session pre-dates the role field by
    backfilling from the DB (auth_module._resolve_role does the lookup once
    and caches it on the session payload).
    """
    try:
        return auth_module.require_role(request, _ALLOWED_ROLES)
    except HTTPException as exc:
        # Preserve the existing JSONResponse error shape used elsewhere in this module
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


def _is_unauthorized(maybe_auth) -> bool:
    return isinstance(maybe_auth, JSONResponse)


def _sanitize_metaphor_text(text: str) -> str:
    """Strip control chars + Unicode-normalize + collapse whitespace; raise
    ValueError on injection-shaped input.

    Pass-2 hardening: NFKC-normalize BEFORE the regex so compatibility forms
    (fullwidth, math italic) and some homoglyphs collapse to canonical ASCII.
    The control-chars regex also strips zero-width / bidi-override / formatting
    chars (ZWSP, RLO, BOM, soft hyphen, word-joiner) that would otherwise let
    the literal substring "system:" hide between invisible characters.
    Also logs every rejection so an audit reader can spot probe attempts.
    """
    if not isinstance(text, str):
        raise ValueError("metaphor must be a string")
    normalized = unicodedata.normalize("NFKC", text)
    cleaned = _CONTROL_CHARS.sub("", normalized).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if len(cleaned) < _METAPHOR_MIN_LEN:
        log.warning("metaphor sanitizer rejected input: too short (%d chars)", len(cleaned))
        raise ValueError(f"metaphor too short (min {_METAPHOR_MIN_LEN} chars)")
    if len(cleaned) > _METAPHOR_MAX_LEN:
        log.warning("metaphor sanitizer rejected input: too long (%d chars)", len(cleaned))
        raise ValueError(f"metaphor too long (max {_METAPHOR_MAX_LEN} chars)")
    if _INJECTION_PATTERNS.search(cleaned):
        # Log a truncated snippet so security audit can investigate without
        # echoing the full payload (which may itself be the attack).
        log.warning("metaphor sanitizer rejected injection-shaped input: %r", cleaned[:80])
        raise ValueError("metaphor contains text that resembles prompt injection")
    return cleaned


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class JobScope(BaseModel):
    capsule_id: str | None = None
    subject: str | None = None
    phase: int | None = None


class JobBody(BaseModel):
    command: Literal["evaluate", "regenerate"]
    scope: JobScope
    options: dict[str, Any] = Field(default_factory=dict)


class ReviewBody(BaseModel):
    action: Literal["approve", "reject", "edit_then_approve"]
    candidate_id: str | None = None  # id from capsule.meta_data.metaphor_proposals[*].candidates[*]
    edited_metaphor: str | None = None  # required for edit_then_approve
    note: str = ""


# ---------------------------------------------------------------------------
# Async job runner (mirrors image_eval pattern)
# ---------------------------------------------------------------------------

def _scope_key(command: str, scope: dict[str, Any]) -> str:
    """Stable key for in-flight job dedup. evaluate is keyed on capsule_id OR
    (subject, phase) so concurrent batches over the same scope are blocked.
    regenerate keys on capsule_id alone."""
    if scope.get("capsule_id"):
        return f"capsule:{scope['capsule_id']}"
    parts = [f"cmd:{command}"]
    if scope.get("subject"):
        parts.append(f"subject:{scope['subject']}")
    if scope.get("phase") is not None:
        parts.append(f"phase:{scope['phase']}")
    return "|".join(parts)


def _run_async_job(job_id: str, body: JobBody, actor: str, scope_key: str) -> None:
    try:
        def _is_cancelled() -> bool:
            row = db.get_eval_run(job_id)
            if not row:
                return True
            result = row.get("result") or {}
            return bool(result.get("cancelRequested"))

        def _on_progress(snapshot: dict[str, Any]) -> None:
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
            scope=body.scope.model_dump(exclude_none=True),
            options=body.options or {},
            actor=actor,
            progress_callback=_on_progress,
            is_cancelled=_is_cancelled,
        )
        # Re-check cancel state from the DB before persisting final status:
        # a cancel that arrived between the service's last is_cancelled check
        # and now would otherwise be discarded as the run completes naturally.
        # Per pre-ship review pass-2 NEW-4.
        cancel_seen_late = False
        try:
            row = db.get_eval_run(job_id)
            if row and (row.get("result") or {}).get("cancelRequested"):
                cancel_seen_late = True
        except Exception:
            pass
        if cancel_seen_late and summary.get("status") not in ("cancelled", "failed"):
            summary["status"] = "cancelled"
            summary["cancelReason"] = summary.get("cancelReason") or "user_late"
        db.save_eval_result(job_id, summary)
        if summary.get("status") == "completed":
            db.complete_eval_run(job_id, "completed", exit_code=0, result=summary)
        elif summary.get("status") == "cancelled":
            db.complete_eval_run(job_id, "cancelled", exit_code=130, error="cancelled by user", result=summary)
        else:
            db.complete_eval_run(
                job_id, "failed", exit_code=2,
                error="metaphor_eval_command_failed", result=summary,
            )
    except Exception as exc:
        log.exception("metaphor-eval job failed: %s", exc)
        # Redact env-var names + bearer-style secrets from the persisted error
        # so a low-privilege operator (or a future audit log reader) can't
        # fingerprint infra topology from the failure surface.
        try:
            db.complete_eval_run(job_id, "failed", exit_code=2, error=_redact_error(exc))
        except Exception:
            log.exception("failed to record metaphor-eval failure for job %s", job_id)
    finally:
        _running_threads.pop(job_id, None)
        with _scope_lock:
            _running_scopes.discard(scope_key)
        try:
            db.release_scope_dedup(scope_key)
        except Exception:
            log.exception("metaphor-eval: failed to release scope dedup for %s", scope_key)


def _redact_error(exc: BaseException) -> str:
    msg = f"{type(exc).__name__}: {exc}"
    msg = re.sub(r"(xai-[A-Za-z0-9]+|sk-[A-Za-z0-9_-]+|Bearer\s+\S+)", "[REDACTED]", msg)
    msg = re.sub(r"(VLLM_[A-Z_]+|XAI_[A-Z_]+|LOCAL_[A-Z_]+)\s*=\s*\S+", r"\1=[REDACTED]", msg)
    return msg[:500]


# ---------------------------------------------------------------------------
# Job endpoints
# ---------------------------------------------------------------------------

@router.post("/api/jobs")
async def api_create_job(body: JobBody, request: Request):
    auth = require_admin(request)
    if _is_unauthorized(auth):
        return auth
    if body.command not in _ALLOWED_COMMANDS:
        return JSONResponse({"error": f"Unsupported command: {body.command}"}, status_code=400)

    # Scope sanity: regenerate needs a capsule_id; evaluate accepts either capsule_id or subject
    scope = body.scope.model_dump(exclude_none=True)
    if body.command == "regenerate" and not scope.get("capsule_id"):
        return JSONResponse({"error": "regenerate requires scope.capsule_id"}, status_code=400)
    if body.command == "evaluate" and not (scope.get("capsule_id") or scope.get("subject")):
        return JSONResponse({"error": "evaluate requires scope.capsule_id or scope.subject"}, status_code=400)
    if scope.get("subject") == "all":
        return JSONResponse({"error": "scope.subject 'all' not supported; pick a concrete subject"}, status_code=400)

    # In-flight dedup so two operators clicking "Run batch" on the same scope
    # don't both fire 1 proposer + 15 judges per capsule (doubled spend).
    # The DB row in eval_runs_locks is the authoritative cross-worker check;
    # the in-process set is just a fast-path so the same worker doesn't
    # round-trip the DB to discover its own duplicate click.
    scope_key = _scope_key(body.command, scope)
    job_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + "_metaphor_" + uuid.uuid4().hex[:6]
    with _scope_lock:
        if scope_key in _running_scopes:
            return JSONResponse(
                {"error": f"A job is already running for this scope ({scope_key}); wait or cancel it first."},
                status_code=409,
            )
        _running_scopes.add(scope_key)
    if not db.acquire_scope_dedup(scope_key, job_id):
        # Some other worker holds the lock. Drop the in-process marker so a
        # legitimate re-attempt after the other worker finishes can proceed.
        with _scope_lock:
            _running_scopes.discard(scope_key)
        return JSONResponse(
            {"error": f"A job is already running for this scope ({scope_key}) on another worker; wait or cancel it first."},
            status_code=409,
        )

    # Past this point any failure between here and `thread.start()` MUST
    # release both the in-process scope set AND the DB-backed dedup row,
    # otherwise the scope stays locked until the zombie reaper sweep.
    targets = [f"command:{body.command}"]
    if scope.get("capsule_id"):
        targets.append(f"capsule:{scope['capsule_id']}")
    if scope.get("subject"):
        targets.append(f"subject:{scope['subject']}")
    if scope.get("phase") is not None:
        targets.append(f"phase:{scope['phase']}")

    actor = auth.get("email") or auth.get("display_name") or "operator"
    try:
        db.create_eval_run(
            job_id=job_id,
            targets=targets,
            config=f"metaphor_eval:{body.command}",
            persona="operator",
            enable_grading=True,
            max_turns=None,
            pid=0,
        )
        db.save_eval_result(job_id, {
            "runType": "metaphor_eval",
            "jobId": job_id,
            "status": "queued",
            "command": body.command,
            "scope": scope,
            "currentStage": "queued",
            "itemsProcessed": 0,
            "totalCandidates": 0,
            "queuedAt": datetime.now(tz=timezone.utc).isoformat(),
            "actor": actor,
        })
        thread = threading.Thread(target=_run_async_job, args=(job_id, body, actor, scope_key), daemon=True)
        _running_threads[job_id] = thread
        thread.start()
    except Exception as exc:
        # Don't leak the scope dedup if anything between lock acquire and
        # thread.start() fails (DB outage, OS thread limit, etc.). Without
        # this, the scope stays locked until the next zombie sweep.
        with _scope_lock:
            _running_scopes.discard(scope_key)
        try:
            db.release_scope_dedup(scope_key)
        except Exception:
            log.exception("metaphor-eval: dedup release also failed for %s", scope_key)
        log.exception("metaphor-eval: failed to launch job %s", job_id)
        return JSONResponse({"error": f"Failed to launch job: {_redact_error(exc)}"}, status_code=500)
    return {"jobId": job_id, "status": "running"}


@router.get("/api/jobs")
async def api_list_jobs(request: Request, command: str | None = None):
    auth = require_admin(request)
    if _is_unauthorized(auth):
        return auth
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
        ("metaphor_eval:%",),
    )
    jobs = []
    for row in rows:
        result = row.get("result") or {}
        command_name = row["config"].split("metaphor_eval:", 1)[-1]
        if command and command_name != command:
            continue
        status = row["status"]
        if status == "running" and result.get("cancelRequested"):
            status = "cancel_requested"
        jobs.append({
            "id": row["job_id"],
            "status": status,
            "command": command_name,
            "scope": result.get("scope", {}),
            "currentStage": result.get("currentStage", ""),
            "itemsProcessed": result.get("itemsProcessed", 0),
            "totalCandidates": result.get("totalCandidates", 0),
            "startedAt": row["started_at"].isoformat() if row.get("started_at") else None,
            "completedAt": row["completed_at"].isoformat() if row.get("completed_at") else None,
            "count": result.get("count", 0),
            "durationSec": result.get("durationSec", 0),
        })
    return {"jobs": jobs, "count": len(jobs)}


@router.get("/api/jobs/{job_id}")
async def api_get_job(job_id: str, request: Request):
    auth = require_admin(request)
    if _is_unauthorized(auth):
        return auth
    row = db.get_eval_run(job_id)
    if not row or not str(row.get("config", "")).startswith("metaphor_eval:"):
        return JSONResponse({"error": "Job not found"}, status_code=404)
    result = row.get("result") or {}
    status = row["status"]
    if status == "running" and result.get("cancelRequested"):
        status = "cancel_requested"
    return {
        "id": job_id,
        "status": status,
        "command": row["config"].split("metaphor_eval:", 1)[-1],
        "scope": result.get("scope", {}),
        "currentStage": result.get("currentStage", ""),
        "itemsProcessed": result.get("itemsProcessed", 0),
        "totalCandidates": result.get("totalCandidates", 0),
        "errors": result.get("errors", []),
        "result": result,
    }


@router.post("/api/jobs/{job_id}/cancel")
async def api_cancel_job(job_id: str, request: Request):
    auth = require_admin(request)
    if _is_unauthorized(auth):
        return auth
    row = db.get_eval_run(job_id)
    if not row or not str(row.get("config", "")).startswith("metaphor_eval:"):
        return JSONResponse({"error": "Job not found"}, status_code=404)
    if row["status"] not in {"running"}:
        return {"ok": True, "status": row["status"]}
    existing = row.get("result") or {}
    existing["cancelRequested"] = True
    existing["cancelRequestedAt"] = datetime.now(tz=timezone.utc).isoformat()
    existing["currentStage"] = "cancel_requested"
    db.save_eval_result(job_id, existing)
    return {"ok": True, "status": "cancel_requested"}


# ---------------------------------------------------------------------------
# Capsule + review endpoints
# ---------------------------------------------------------------------------

@router.get("/api/capsules")
async def api_list_capsules(
    request: Request,
    subject: str | None = None,
    phase: int | None = None,
    status: str | None = None,
    limit: int = 500,
):
    """List capsules with current metaphor state. status filter:
      auto_accepted | human_approved | needs_review | auto_rejected | unset.
    """
    auth = require_admin(request)
    if _is_unauthorized(auth):
        return auth
    if status and status not in _ALLOWED_REVIEW_STATUSES:
        return JSONResponse(
            {"error": f"Unknown status filter '{status}'. Expected one of: {sorted(_ALLOWED_REVIEW_STATUSES)}"},
            status_code=400,
        )
    # The list endpoint hits all 500 capsules — projecting in-SQL avoids
    # shipping the full meta_data jsonb (judge breakdowns + reasoning) over
    # the wire on every poll. The detail endpoint is the one that returns
    # the full proposal history.
    rows = db.list_capsules_with_metaphor_summary(subject_name=subject, phase=phase)
    out = []
    cap = max(1, min(int(limit), 5000))
    for row in rows:
        rstatus = row.get("review_status") or ("unset" if not row.get("metaphor") else "auto_accepted")
        if status and rstatus != status:
            continue
        out.append({
            "capsuleId": str(row["capsule_id"]),
            "capsuleName": row["capsule_name"],
            "subjectName": row["subject_name"],
            "themeName": row["theme_name"],
            "phase": row["phase"],
            "ageRange": row["age_range"],
            "metaphor": row.get("metaphor", "") or "",
            "reviewStatus": rstatus,
            "lastRunId": row.get("winner_run_id") or "",
            "proposalRuns": int(row.get("proposal_runs") or 0),
        })
        if len(out) >= cap:
            break
    return {"capsules": out, "count": len(out)}


@router.get("/api/capsules/{capsule_id}")
async def api_get_capsule(capsule_id: str, request: Request):
    auth = require_admin(request)
    if _is_unauthorized(auth):
        return auth
    capsule = db.get_capsule_with_scope(capsule_id)
    if not capsule:
        return JSONResponse({"error": "Capsule not found"}, status_code=404)
    meta = db.get_capsule_meta_data(capsule_id) or {}
    facts = db.list_facts_for_capsule_scope(
        phase=int(capsule["phase"]),
        theme_name=capsule["theme_name"],
        capsule_name=capsule["capsule_name"],
        subject_name=capsule.get("subject_name"),
    )
    return {
        "capsuleId": str(capsule["capsule_id"]),
        "capsuleName": capsule["capsule_name"],
        "subjectName": capsule.get("subject_name"),
        "themeName": capsule.get("theme_name"),
        "phase": capsule.get("phase"),
        "ageRange": capsule.get("age_range"),
        "metaphor": meta.get("metaphor", ""),
        "metaphorSustainedExamples": meta.get("metaphor_sustained_examples") or {},
        "metaphorReview": meta.get("metaphor_review") or {},
        "metaphorProposals": meta.get("metaphor_proposals") or [],
        "facts": [
            {
                "factId": str(f["fact_id"]),
                "factOrder": f["fact_order"],
                "factText": f["fact_text"],
            }
            for f in facts
        ],
        "evalIdentity": make_eval_identity(),
    }


@router.post("/api/capsules/{capsule_id}/review")
async def api_review_capsule(capsule_id: str, body: ReviewBody, request: Request):
    auth = require_admin(request)
    if _is_unauthorized(auth):
        return auth
    actor = auth.get("email") or auth.get("display_name") or "operator"

    if body.action == "edit_then_approve" and not (body.edited_metaphor or "").strip():
        return JSONResponse({"error": "edited_metaphor is required for edit_then_approve"}, status_code=400)

    # Pre-validate edited_metaphor *before* taking the row lock so we don't
    # serialize on a doomed write. The lifted text gets injected into student
    # tutor prompts (PR-A1), so this is the load-bearing safety check.
    edited_clean: str | None = None
    if body.action == "edit_then_approve":
        try:
            edited_clean = _sanitize_metaphor_text(body.edited_metaphor or "")
        except ValueError as exc:
            return JSONResponse({"error": f"Invalid edited_metaphor: {exc}"}, status_code=400)

    now_iso = datetime.now(tz=timezone.utc).isoformat()

    def _archive_prior_review(meta: dict[str, Any], reason: str) -> None:
        prior = meta.get("metaphor_review")
        if not prior:
            return
        history = list(meta.get("metaphor_review_history") or [])
        history.append({**prior, "archived_at": now_iso, "archive_reason": reason})
        # Cap audit history at 50 entries — prevents unbounded JSONB growth on
        # heavily-revisited capsules. Preserve the FIRST entry plus the last
        # 49 so the original audit anchor survives long capsule lifetimes.
        # Per pre-ship review pass-2 N1.
        if len(history) > 50:
            history = [history[0]] + history[-49:]
        meta["metaphor_review_history"] = history

    def _mutate(meta: dict[str, Any]) -> dict[str, Any]:
        proposals_history = list(meta.get("metaphor_proposals") or [])
        candidate, sustained = _find_candidate(proposals_history, body.candidate_id)

        if body.action == "approve":
            if not candidate:
                raise ValueError("candidate_id not found in proposal history")
            metaphor_text = str(candidate.get("metaphor", "")).strip()
            try:
                metaphor_text = _sanitize_metaphor_text(metaphor_text)
            except ValueError as exc:
                # Candidate metaphor that was AI-generated and stored without
                # validation — refuse to lift it without an explicit edit_then_approve.
                raise ValueError(f"Stored candidate fails safety check: {exc}; use edit_then_approve")
            _archive_prior_review(meta, "approve")
            meta["metaphor"] = metaphor_text
            meta["metaphor_sustained_examples"] = sustained or {}
            meta["metaphor_review"] = {
                "status": "human_approved",
                "reviewer": actor,
                "reviewed_at": now_iso,
                "winner_id": candidate.get("id"),
                "winner_run_id": candidate.get("run_id"),
                "note": (body.note or "")[:500],
            }
        elif body.action == "edit_then_approve":
            base_examples = (sustained or {}) if candidate else {}
            _archive_prior_review(meta, "edit_then_approve")
            meta["metaphor"] = edited_clean or ""
            meta["metaphor_sustained_examples"] = base_examples
            meta["metaphor_review"] = {
                "status": "human_approved",
                "reviewer": actor,
                "reviewed_at": now_iso,
                "winner_id": candidate.get("id") if candidate else None,
                "winner_run_id": candidate.get("run_id") if candidate else None,
                "edited": True,
                "note": (body.note or "")[:500],
            }
        elif body.action == "reject":
            # Clear any previously accepted metaphor — reviewer wants regenerate.
            # Archive the prior review first so the audit trail captures what was rejected.
            _archive_prior_review(meta, "reject")
            meta.pop("metaphor", None)
            meta.pop("metaphor_sustained_examples", None)
            meta["metaphor_review"] = {
                "status": "needs_review",
                "reviewer": actor,
                "reviewed_at": now_iso,
                "rejected": True,
                "note": (body.note or "")[:500],
            }
        return meta

    try:
        db.update_capsule_meta_data(capsule_id, _mutate)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return {"ok": True}


@router.post("/api/capsules/{capsule_id}/regenerate")
async def api_regenerate_capsule(capsule_id: str, request: Request):
    """Kick off a regenerate as an async job. Synchronous version held a uvicorn
    worker for 60-180s per call; with 4 workers and 4 reviewers clicking, the
    API would freeze for everyone. Now mirrors the batch evaluate path."""
    auth = require_admin(request)
    if _is_unauthorized(auth):
        return auth
    actor = auth.get("email") or auth.get("display_name") or "operator"

    # Reuse the same in-flight dedup the /api/jobs route uses, keyed by capsule_id.
    scope = {"capsule_id": capsule_id}
    scope_key = _scope_key("regenerate", scope)
    job_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + "_metaphor_" + uuid.uuid4().hex[:6]
    with _scope_lock:
        if scope_key in _running_scopes:
            return JSONResponse(
                {"error": f"A regenerate is already running for capsule {capsule_id}"},
                status_code=409,
            )
        _running_scopes.add(scope_key)
    if not db.acquire_scope_dedup(scope_key, job_id):
        with _scope_lock:
            _running_scopes.discard(scope_key)
        return JSONResponse(
            {"error": f"A regenerate is already running for capsule {capsule_id} on another worker"},
            status_code=409,
        )

    try:
        db.create_eval_run(
            job_id=job_id,
            targets=["command:regenerate", f"capsule:{capsule_id}"],
            config="metaphor_eval:regenerate",
            persona="operator",
            enable_grading=True,
            max_turns=None,
            pid=0,
        )
        db.save_eval_result(job_id, {
            "runType": "metaphor_eval",
            "jobId": job_id,
            "status": "queued",
            "command": "regenerate",
            "scope": scope,
            "currentStage": "queued",
            "itemsProcessed": 0,
            "totalCandidates": 1,
            "queuedAt": datetime.now(tz=timezone.utc).isoformat(),
            "actor": actor,
        })
        body = JobBody(command="regenerate", scope=JobScope(capsule_id=capsule_id), options={})
        thread = threading.Thread(target=_run_async_job, args=(job_id, body, actor, scope_key), daemon=True)
        _running_threads[job_id] = thread
        thread.start()
    except Exception as exc:
        with _scope_lock:
            _running_scopes.discard(scope_key)
        try:
            db.release_scope_dedup(scope_key)
        except Exception:
            log.exception("metaphor-eval regenerate: dedup release also failed for %s", scope_key)
        log.exception("metaphor-eval: failed to launch regenerate for capsule %s", capsule_id)
        return JSONResponse({"error": f"Failed to launch regenerate: {_redact_error(exc)}"}, status_code=500)
    return {"ok": True, "jobId": job_id, "status": "running"}


@router.get("/api/coverage")
async def api_coverage(request: Request, subject: str | None = None, phase: int | None = None):
    """Aggregate coverage stats — used by the review queue header to show progress to ≥95%."""
    auth = require_admin(request)
    if _is_unauthorized(auth):
        return auth
    rows = db.list_capsules_with_metaphor_summary(subject_name=subject, phase=phase)
    total = len(rows)
    counts = {"auto_accepted": 0, "human_approved": 0, "needs_review": 0, "auto_rejected": 0, "unset": 0}
    for row in rows:
        rstatus = row.get("review_status") or ("unset" if not row.get("metaphor") else "auto_accepted")
        counts[rstatus] = counts.get(rstatus, 0) + 1
    accepted = counts["auto_accepted"] + counts["human_approved"]
    coverage_pct = (accepted / total) if total else 0.0
    return {
        "total": total,
        "counts": counts,
        "acceptedCount": accepted,
        "coveragePct": round(coverage_pct, 4),
        "judgeNames": JUDGE_NAMES,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_candidate(proposal_runs: list[dict[str, Any]], candidate_id: str | None):
    """Locate a candidate dict + its sustained_examples by id across all runs.

    Returns (candidate_dict_or_None, sustained_examples_dict_or_None).
    Walks newest run first so the freshest match wins.
    """
    if not candidate_id:
        return None, None
    for run in reversed(proposal_runs):
        for cand in run.get("candidates") or []:
            if cand.get("id") == candidate_id:
                return cand, cand.get("sustained_examples_per_fact") or {}
    return None, None
