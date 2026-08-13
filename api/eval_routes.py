"""Evals UI and API routes for ZingBee RT Studio.

Provides /evals UI and /evals/api/* JSON endpoints for viewing eval results
and managing background eval jobs. Mount this router in the main FastAPI app.
Follows the same pattern as admin_routes.py.
"""

import logging
import os
import signal
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse

import db

log = logging.getLogger(__name__)

router = APIRouter(prefix="/evals", tags=["evals"])

# Path to evals project (lives in project root, not in api/)
EVALS_PROJECT_DIR = Path(__file__).resolve().parent.parent / "evals"
RUN_SCRIPT = EVALS_PROJECT_DIR / "run_evals.sh"

# ---------------------------------------------------------------------------
# Auth dependency - reuses web_ui.py auth_sessions dict
# ---------------------------------------------------------------------------

_auth_sessions = None


def init_auth(auth_sessions_ref: dict):
    """Bind the shared auth_sessions dict. Call from web_ui.py at startup."""
    global _auth_sessions
    _auth_sessions = auth_sessions_ref
    _recover_running_jobs()


def require_auth(request: Request) -> dict:
    """Check session cookie auth. Returns user info dict or None."""
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


# ---------------------------------------------------------------------------
# In-memory process registry (tracks Popen objects for exit code checking)
# ---------------------------------------------------------------------------

_running_procs: dict[str, subprocess.Popen] = {}

# ---------------------------------------------------------------------------
# Log reader thread (pipes subprocess stdout -> DB in batches)
# ---------------------------------------------------------------------------

_FLUSH_INTERVAL = 0.5   # seconds between DB writes
_FLUSH_SIZE = 4096       # bytes before forced flush


def _log_reader_thread(job_id: str, pipe):
    """Read lines from subprocess stdout pipe and batch-append to DB."""
    buf = []
    buf_size = 0
    last_flush = time.monotonic()
    try:
        for raw_line in iter(pipe.readline, b""):
            try:
                line = raw_line.decode("utf-8", errors="replace")
            except Exception:
                line = repr(raw_line)
            buf.append(line)
            buf_size += len(line)
            now = time.monotonic()
            if buf_size >= _FLUSH_SIZE or (now - last_flush) >= _FLUSH_INTERVAL:
                chunk = "".join(buf)
                buf.clear()
                buf_size = 0
                last_flush = now
                try:
                    db.append_eval_log(job_id, chunk)
                except Exception as e:
                    log.warning("Failed to append eval log for %s: %s", job_id, e)
        # Flush remaining buffer at EOF
        if buf:
            try:
                db.append_eval_log(job_id, "".join(buf))
            except Exception as e:
                log.warning("Final log flush failed for %s: %s", job_id, e)
    except Exception as e:
        log.warning("Log reader thread error for %s: %s", job_id, e)
    finally:
        pipe.close()


# ---------------------------------------------------------------------------
# Process status checking
# ---------------------------------------------------------------------------

def _check_pid_alive(pid: int) -> bool:
    """Check if a process with given PID is still running."""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _update_job_statuses():
    """Check running jobs whose processes have finished and update the DB."""
    rows = db.fetchall(
        "SELECT job_id, pid FROM eval_runs WHERE status = 'running'"
    )
    for row in rows:
        jid = row["job_id"]
        pid = row["pid"]
        if not pid:
            continue

        proc = _running_procs.get(jid)
        if proc is not None:
            rc = proc.poll()
            if rc is not None:
                # pytest: 0 = all passed, 1 = some failed (normal), >=2 = error
                status = "completed" if rc in (0, 1) else "failed"
                error = f"Process exited with code {rc}" if rc >= 2 else None
                try:
                    db.finalize_eval_result(jid)
                except Exception as e:
                    log.warning("Failed to finalize eval result for %s: %s", jid, e)
                db.complete_eval_run(jid, status, exit_code=rc, error=error)
                _running_procs.pop(jid, None)
        else:
            if not _check_pid_alive(pid):
                try:
                    db.finalize_eval_result(jid)
                except Exception as e:
                    log.warning("Failed to finalize eval result for %s: %s", jid, e)
                db.complete_eval_run(
                    jid, "completed",
                    error="Process finished (exit code unavailable — server was restarted during run)",
                )


def _recover_running_jobs():
    """On startup, handle eval jobs that were running before the restart.

    - Dead processes: mark as failed (log output is preserved in DB).
    - Still-alive processes: leave as 'running' — _update_job_statuses()
      will detect completion on the next poll via PID liveness checks.
      (We lose the Popen handle so exit code will be unavailable, but the
      process can finish normally and its log output was already flushed.)
    """
    try:
        rows = db.fetchall(
            "SELECT job_id, pid FROM eval_runs WHERE status = 'running'"
        )
        for row in rows:
            pid = row["pid"]
            if not pid or not _check_pid_alive(pid):
                db.complete_eval_run(
                    row["job_id"], "failed",
                    error="Interrupted by server restart (logs preserved)",
                )
            else:
                log.info(
                    "Eval job %s (PID %s) still alive after restart; "
                    "leaving as running (exit code will be unavailable)",
                    row["job_id"], pid,
                )
    except Exception as e:
        if "does not exist" in str(e):
            log.info("eval_runs table not found — skipping recovery (first run?)")
        else:
            log.warning("Failed to recover running eval jobs: %s", e)


# ---------------------------------------------------------------------------
# API: Runs
# ---------------------------------------------------------------------------

@router.get("/api/runs")
async def api_list_runs(request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    rows = db.list_eval_runs(limit=500)
    runs = []
    for row in rows:
        if row["status"] not in ("completed", "failed"):
            continue

        jid = row["job_id"]
        result = row.get("result") or {}

        runs.append({
            "id": jid,
            "config": row["config"],
            "startedAt": row["started_at"].isoformat() if row.get("started_at") else None,
            "capsuleCount": result.get("capsuleCount", 0),
            "subjects": result.get("subjects", []),
            "avgScores": result.get("avgScores", {}),
            "totalTokens": result.get("totalTokens", 0),
            "totalDuration": result.get("totalDuration", 0),
        })

    return {"runs": runs}


@router.get("/api/runs/{run_id}")
async def api_get_run(run_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    row = db.get_eval_run(run_id)
    if not row:
        return JSONResponse({"error": "Run not found"}, status_code=404)

    result = row.get("result") or {}

    return {
        "id": run_id,
        "config": row["config"],
        "capsules": result.get("capsules", []),
    }


# ---------------------------------------------------------------------------
# API: Jobs (background eval job management)
# ---------------------------------------------------------------------------

_ALLOWED_TARGETS = {"smoke", "biology", "math", "chemistry", "english", "physics", "guardrails", "all"}
_ALLOWED_CONFIGS = {"baseline", "smoke", "low_temp", "high_temp", "fast_model", "low_reasoning", "high_reasoning", "short_response", "long_response", "with_images"}
_ALLOWED_PERSONAS = {"engaged_beginner", "confused", "advanced", "adversarial"}


def _row_to_job(row) -> dict:
    """Convert a DB eval_runs row to the camelCase dict the frontend expects."""
    return {
        "id": row["job_id"],
        "targets": row["targets"] or [],
        "config": row["config"],
        "persona": row["persona"],
        "enableGrading": row["enable_grading"],
        "maxTurns": row["max_turns"],
        "status": row["status"],
        "pid": row["pid"],
        "startedAt": row["started_at"].isoformat() if row["started_at"] else None,
        "completedAt": row["completed_at"].isoformat() if row["completed_at"] else None,
        "exitCode": row["exit_code"],
        "error": row["error"],
    }


@router.get("/api/jobs")
async def api_list_jobs(request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    _update_job_statuses()
    rows = db.list_eval_runs()
    return {"jobs": [_row_to_job(r) for r in rows]}


@router.post("/api/jobs")
async def api_create_job(request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    if not RUN_SCRIPT.exists():
        return JSONResponse({"error": "run_evals.sh not found"}, status_code=500)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    targets = body.get("targets", ["smoke"])
    config = body.get("config", "baseline")
    persona = body.get("persona", "engaged_beginner")
    enable_grading = body.get("enableGrading", False)
    max_turns = body.get("maxTurns")

    # Validate inputs against allowlists
    if not isinstance(targets, list) or not targets:
        return JSONResponse({"error": "targets must be a non-empty list"}, status_code=400)
    for t in targets:
        base = t.split(":")[0]
        if base not in _ALLOWED_TARGETS:
            return JSONResponse({"error": f"Invalid target: {t}"}, status_code=400)
    if config not in _ALLOWED_CONFIGS:
        return JSONResponse({"error": f"Invalid config: {config}"}, status_code=400)
    if persona not in _ALLOWED_PERSONAS:
        return JSONResponse({"error": f"Invalid persona: {persona}"}, status_code=400)
    if max_turns is not None:
        if not isinstance(max_turns, int) or max_turns < 1 or max_turns > 200:
            return JSONResponse({"error": "maxTurns must be 1-200"}, status_code=400)

    # Unique job ID: timestamp + short UUID suffix to prevent collisions
    job_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]

    # Build command
    cmd = [str(RUN_SCRIPT)] + targets
    cmd += ["--config", config]
    cmd += ["--persona", persona]
    cmd += ["--job-id", job_id]
    if enable_grading:
        cmd += ["--grade"]
    if max_turns:
        cmd += ["--max-turns", str(max_turns)]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=str(EVALS_PROJECT_DIR),
            start_new_session=True,
        )
    except Exception as e:
        return JSONResponse({"error": f"Failed to start: {e}"}, status_code=500)

    # Register in-memory for exit code tracking
    _running_procs[job_id] = proc

    # Persist to DB
    row = db.create_eval_run(
        job_id, targets, config, persona, enable_grading, max_turns, proc.pid,
    )

    # Spawn daemon thread to pipe stdout -> DB
    t = threading.Thread(
        target=_log_reader_thread, args=(job_id, proc.stdout), daemon=True,
    )
    t.start()

    return _row_to_job(row)


@router.get("/api/jobs/{job_id}")
async def api_get_job(job_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    _update_job_statuses()
    row = db.get_eval_run(job_id)
    if not row:
        return JSONResponse({"error": "Job not found"}, status_code=404)

    job = _row_to_job(row)
    job["log"] = db.get_eval_log_tail(job_id)
    return job


@router.delete("/api/runs/{run_id}")
async def api_delete_run(run_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    row = db.get_eval_run(run_id)
    if not row:
        return JSONResponse({"error": "Run not found"}, status_code=404)

    if row["status"] == "running":
        return JSONResponse({"error": "Cannot delete a running job"}, status_code=400)

    db.delete_eval_run(run_id)
    return {"ok": True}


@router.delete("/api/jobs/{job_id}")
async def api_delete_job(job_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    row = db.get_eval_run(job_id)
    if not row:
        return JSONResponse({"error": "Job not found"}, status_code=404)

    if row["status"] == "running":
        return JSONResponse({"error": "Cannot delete a running job — cancel it first"}, status_code=400)

    db.delete_eval_run(job_id)
    return {"ok": True}


@router.post("/api/jobs/{job_id}/cancel")
async def api_cancel_job(job_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    row = db.get_eval_run(job_id)
    if not row:
        return JSONResponse({"error": "Job not found"}, status_code=404)

    if row["status"] != "running":
        return JSONResponse({"error": "Job is not running"}, status_code=400)

    pid = row["pid"]
    if pid:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except Exception:
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass

    _running_procs.pop(job_id, None)
    db.complete_eval_run(job_id, "cancelled")

    return {"ok": True}


# ---------------------------------------------------------------------------
# Evals UI page (single HTML page with JS)
# ---------------------------------------------------------------------------

