"""Structured trace logging for ZingBee Ultra.

Provides:
  - `trace_id` / `span_id` / `user_id` / `student_id` contextvars propagated
    through async + threads.
  - `event(name, **fields)` — emits a structured log record with the trace
    context attached. The Cloud Logging handler set up in web_ui.py picks up
    `extra={"json_fields": ...}` and surfaces them as the entry's jsonPayload.
  - `TraceFilter` — logging filter that injects trace context onto every log
    record so even ad-hoc `logging.info(...)` calls carry trace_id.
  - `TraceMiddleware` — FastAPI middleware that allocates a trace_id per
    request, logs http.request_start / http.request_end, and propagates
    the X-Request-ID header.

Cloud Logging picks the fields up automatically because google-cloud-logging's
StructuredLogHandler reads `extra` keys and maps `json_fields` into the
entry's jsonPayload (see google-cloud-logging docs).
"""
from __future__ import annotations

import contextvars
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

_log = logging.getLogger("trace")

# ---------------------------------------------------------------------------
# Local file sink — when Cloud Logging isn't configured (dev), we still want
# the logs viewer to show recent trace events. Write every structured event
# to a JSONL file under api/logs/ that the read API can tail.
# ---------------------------------------------------------------------------

_LOG_DIR = Path(__file__).parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)
_LOCAL_LOG_FILE = _LOG_DIR / "trace.jsonl"
_LOG_LOCK = threading.Lock()
# Rotate when the file exceeds this size (keeps the read endpoint fast).
_MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB


def _local_log_path() -> Path:
    return _LOCAL_LOG_FILE


def _write_local(record: dict) -> None:
    """Append one JSON line to the local trace file. Rotates on size."""
    try:
        with _LOG_LOCK:
            # Cheap size check; rotate if exceeded.
            if _LOCAL_LOG_FILE.exists() and _LOCAL_LOG_FILE.stat().st_size > _MAX_FILE_BYTES:
                rotated = _LOG_DIR / f"trace.{int(time.time())}.jsonl"
                _LOCAL_LOG_FILE.rename(rotated)
            with _LOCAL_LOG_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, default=str) + "\n")
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Context variables
# ---------------------------------------------------------------------------

_trace_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("trace_id", default=None)
_span_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("span_id", default=None)
_user_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("user_id", default=None)
_student_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("student_id", default=None)
_session_db_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("session_db_id", default=None)


def get_trace_id() -> Optional[str]:
    return _trace_id.get()


def set_trace_id(trace_id: str) -> None:
    _trace_id.set(trace_id)


def set_user_context(user_id: Optional[str] = None, student_id: Optional[str] = None,
                     session_db_id: Optional[str] = None) -> None:
    if user_id is not None:
        _user_id.set(user_id)
    if student_id is not None:
        _student_id.set(student_id)
    if session_db_id is not None:
        _session_db_id.set(session_db_id)


def _context_snapshot() -> dict[str, Any]:
    return {
        "trace_id": _trace_id.get(),
        "span_id": _span_id.get(),
        "user_id": _user_id.get(),
        "student_id": _student_id.get(),
        "session_db_id": _session_db_id.get(),
    }


# ---------------------------------------------------------------------------
# Structured event emission
# ---------------------------------------------------------------------------

def event(name: str, level: int = logging.INFO, **fields: Any) -> None:
    """Emit a structured trace event. `name` is the event type (e.g.
    "llm.request", "db.query", "http.request_end"); `fields` are arbitrary
    JSON-serializable payload values that show up in Cloud Logging's
    jsonPayload.

    INSTRUMENTATION INVARIANT: this function must never raise. A logging
    failure must not break the calling code path (LLM call, DB query, HTTP
    handler). All work is wrapped in a top-level try/except.
    """
    try:
        json_fields = {
            "event": name,
            **_context_snapshot(),
            **{k: v for k, v in fields.items() if v is not None},
        }
        # google-cloud-logging picks up `extra={"json_fields": {...}}` and
        # routes the dict into entry.jsonPayload. Local stdout still shows the
        # message text — the event name is a useful human-readable tag.
        _log.log(level, name, extra={"json_fields": json_fields})
        # Local sink so the dev logs viewer has something to show without GCP.
        _write_local({
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "severity": logging.getLevelName(level),
            "log_name": "zingbee-ultra-api",
            "payload": json_fields,
        })
    except Exception:
        # Last-resort fallback so a logging failure never crashes a caller.
        # We DON'T re-raise; trace events are best-effort by design.
        try:
            _log.warning("trace_event_emit_failed", extra={"event_name": name})
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Logging filter — injects trace context onto EVERY log record so that
# plain `logging.info("foo")` calls still carry trace_id in Cloud Logging.
# ---------------------------------------------------------------------------

class TraceFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        snap = _context_snapshot()
        existing = getattr(record, "json_fields", None) or {}
        merged = {**snap, **existing}
        # Drop None values so they don't clutter jsonPayload
        record.json_fields = {k: v for k, v in merged.items() if v is not None}
        return True


# ---------------------------------------------------------------------------
# FastAPI middleware
# ---------------------------------------------------------------------------

class TraceMiddleware(BaseHTTPMiddleware):
    """Per-request trace_id, request/response logging, X-Request-ID echo."""

    # Paths that flood the logs if traced; skip them.
    SKIP_PATHS = {"/health", "/healthz", "/favicon.ico"}

    async def dispatch(self, request: Request, call_next):
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)

        incoming = request.headers.get("x-request-id")
        trace_id = incoming or uuid.uuid4().hex
        token = _trace_id.set(trace_id)
        # Reset any per-request user context (caller will fill in once auth runs).
        u_token = _user_id.set(None)
        s_token = _student_id.set(None)
        sd_token = _session_db_id.set(None)
        start = time.time()
        try:
            event("http.request_start",
                  method=request.method,
                  path=request.url.path,
                  query=str(request.url.query) if request.url.query else None,
                  client_ip=request.client.host if request.client else None,
                  user_agent=request.headers.get("user-agent"))
            try:
                response: Response = await call_next(request)
                status = response.status_code
            except Exception as e:
                event("http.request_error",
                      level=logging.ERROR,
                      method=request.method,
                      path=request.url.path,
                      error=str(e),
                      duration_ms=int((time.time() - start) * 1000))
                raise
            duration_ms = int((time.time() - start) * 1000)
            event("http.request_end",
                  level=logging.WARNING if status >= 500 else logging.INFO,
                  method=request.method,
                  path=request.url.path,
                  status=status,
                  duration_ms=duration_ms)
            try:
                response.headers["x-request-id"] = trace_id
            except Exception:
                # Some response types (e.g. already-sent streaming responses)
                # may reject header mutation. Logging the trace header is a
                # nice-to-have; never break a successful response over it.
                pass
            return response
        finally:
            _trace_id.reset(token)
            _user_id.reset(u_token)
            _student_id.reset(s_token)
            _session_db_id.reset(sd_token)


# ---------------------------------------------------------------------------
# Helpers for non-FastAPI code paths (background threads)
# ---------------------------------------------------------------------------

def with_trace(trace_id: Optional[str] = None):
    """Context manager that sets a trace_id for the duration of a `with` block.
    Useful for background threads spawned with no inherited context."""
    class _Cm:
        def __enter__(self_inner):
            self_inner.tid = _trace_id.set(trace_id or uuid.uuid4().hex)
            return _trace_id.get()
        def __exit__(self_inner, *a):
            _trace_id.reset(self_inner.tid)
    return _Cm()
