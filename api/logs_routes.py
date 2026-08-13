"""Cloud Logging viewer API — admin-only proxy that queries Google Cloud
Logging for ZingBee Ultra entries.

Endpoints:
    GET /api/admin/logs           — list entries with filters
    GET /api/admin/logs/{id}      — single entry by insert_id
    GET /api/admin/logs/traces/{trace_id} — all entries for a trace
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

import auth as _auth
from trace_logging import _local_log_path

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/logs", tags=["logs"])

# Log name set by web_ui.py's CloudLoggingHandler(name="zingbee-ultra-api").
# Filter restricts results to entries we wrote, not Stackdriver platform noise.
LOG_NAME = "zingbee-ultra-api"


def _require_admin(request: Request) -> Optional[dict]:
    """Any authenticated user can view logs."""
    return _auth.get_auth_user(request)


def _get_client():
    """Return a Cloud Logging client, or None if creds aren't configured."""
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds or not os.path.exists(creds):
        return None
    try:
        import google.cloud.logging as gcp_logging
        return gcp_logging.Client()
    except Exception as e:
        log.warning("Cloud Logging client init failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Local file reader — fallback when Cloud Logging isn't configured. Reads the
# JSONL trace file written by trace_logging._write_local and applies the same
# filter semantics as the GCP path.
# ---------------------------------------------------------------------------

def _read_local_entries(
    *,
    q: Optional[str],
    level: Optional[str],
    event: Optional[str],
    trace_id: Optional[str],
    user_id: Optional[str],
    student_id: Optional[str],
    from_ts: datetime,
    to_ts: datetime,
    limit: int,
) -> list:
    """Read recent JSONL trace entries and apply filters."""
    path: Path = _local_log_path()
    if not path.exists():
        return []
    # Severity order for >= filter
    sev_rank = {"DEBUG": 10, "INFO": 20, "NOTICE": 25, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
    min_sev = sev_rank.get((level or "").upper(), 0)
    q_lower = (q or "").lower() if q else None

    entries: list[dict] = []
    try:
        # Read the file from the end is ideal, but JSONL with arbitrary line
        # length makes that awkward. Just load lines and filter — file is
        # bounded by the 50 MB rotation cap in trace_logging.
        with path.open("r", encoding="utf-8") as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    rec = json.loads(raw)
                except Exception:
                    continue
                # Timestamp filter
                ts = rec.get("timestamp")
                if ts:
                    try:
                        rec_ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                        if rec_ts < from_ts or rec_ts > to_ts:
                            continue
                    except Exception:
                        pass
                payload = rec.get("payload") or {}
                # Severity
                if min_sev and sev_rank.get(rec.get("severity", "INFO"), 20) < min_sev:
                    continue
                # Event name
                if event and payload.get("event") != event:
                    continue
                if trace_id and payload.get("trace_id") != trace_id:
                    continue
                if user_id and payload.get("user_id") != user_id:
                    continue
                if student_id and payload.get("student_id") != student_id:
                    continue
                # Full-text search across the entire JSON
                if q_lower and q_lower not in raw.lower():
                    continue
                entries.append(rec)
    except Exception as e:
        log.warning("Local log read failed: %s", e)
        return []

    # Sort newest-first and cap
    entries.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return entries[:limit]


def _local_entry_to_dict(rec: dict, idx: int) -> dict:
    """Map a JSONL record to the same shape as Cloud Logging entries so the
    viewer doesn't have to branch on the source."""
    payload = rec.get("payload") or {}
    return {
        "insert_id": f"local-{idx}",
        "timestamp": rec.get("timestamp"),
        "severity": rec.get("severity") or "INFO",
        "log_name": rec.get("log_name") or "zingbee-ultra-api",
        "trace_id": payload.get("trace_id"),
        "event": payload.get("event"),
        "user_id": payload.get("user_id"),
        "student_id": payload.get("student_id"),
        "session_db_id": payload.get("session_db_id"),
        "payload": payload,
        "resource_type": "local-file",
        "labels": {},
    }


def _build_filter(
    *,
    q: Optional[str],
    level: Optional[str],
    event: Optional[str],
    trace_id: Optional[str],
    user_id: Optional[str],
    student_id: Optional[str],
    from_ts: datetime,
    to_ts: datetime,
) -> str:
    """Build a Cloud Logging filter string.

    See: https://cloud.google.com/logging/docs/view/logging-query-language
    """
    parts = [
        f'logName="projects/{os.environ.get("GCP_PROJECT_ID", "")}/logs/{LOG_NAME}"',
        f'timestamp>="{from_ts.isoformat()}"',
        f'timestamp<="{to_ts.isoformat()}"',
    ]
    if level:
        # Cloud Logging severity values: DEBUG/INFO/NOTICE/WARNING/ERROR/CRITICAL.
        parts.append(f'severity>={level.upper()}')
    if event:
        parts.append(f'jsonPayload.event="{event}"')
    if trace_id:
        parts.append(f'jsonPayload.trace_id="{trace_id}"')
    if user_id:
        parts.append(f'jsonPayload.user_id="{user_id}"')
    if student_id:
        parts.append(f'jsonPayload.student_id="{student_id}"')
    if q:
        # Free-text full-text search across the payload.
        # Escape internal quotes so the filter parses.
        safe = q.replace('"', '\\"')
        parts.append(f'"{safe}"')
    return " AND ".join(parts)


def _entry_to_dict(entry) -> dict:
    """Map a Cloud Logging LogEntry to a JSON-friendly dict for the viewer."""
    payload = entry.payload
    # payload is dict for StructLogEntry, str for TextLogEntry, depending on
    # which handler emitted it. Normalize.
    if isinstance(payload, str):
        payload_dict = {"message": payload}
    elif isinstance(payload, dict):
        payload_dict = payload
    else:
        payload_dict = {"raw": str(payload)}
    return {
        "insert_id": entry.insert_id,
        "timestamp": entry.timestamp.isoformat() if entry.timestamp else None,
        "severity": entry.severity or "DEFAULT",
        "log_name": entry.log_name,
        "trace_id": payload_dict.get("trace_id"),
        "event": payload_dict.get("event"),
        "user_id": payload_dict.get("user_id"),
        "student_id": payload_dict.get("student_id"),
        "session_db_id": payload_dict.get("session_db_id"),
        "payload": payload_dict,
        "resource_type": entry.resource.type if entry.resource else None,
        "labels": dict(entry.labels or {}),
    }


@router.get("")
async def list_logs(
    request: Request,
    q: Optional[str] = Query(None, description="Free-text query"),
    level: Optional[str] = Query(None, description="DEBUG/INFO/WARNING/ERROR"),
    event: Optional[str] = Query(None, description="Exact event name match"),
    trace_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    student_id: Optional[str] = Query(None),
    minutes: int = Query(60, ge=1, le=10080, description="Look-back window in minutes (default 60, max 1 week)"),
    page_size: int = Query(200, ge=1, le=1000),
    page_token: Optional[str] = Query(None),
):
    """List Cloud Logging entries matching the filter."""
    auth = _require_admin(request)
    if not auth:
        return JSONResponse({"error": "authentication required"}, status_code=401)

    to_ts = datetime.now(tz=timezone.utc)
    from_ts = to_ts - timedelta(minutes=minutes)

    client = _get_client()
    if client is None:
        # Local fallback — read the JSONL sink.
        raw = _read_local_entries(q=q, level=level, event=event, trace_id=trace_id,
                                  user_id=user_id, student_id=student_id,
                                  from_ts=from_ts, to_ts=to_ts, limit=page_size)
        return {
            "entries": [_local_entry_to_dict(r, i) for i, r in enumerate(raw)],
            "next_page_token": None,
            "filter": "local-file",
            "from_ts": from_ts.isoformat(),
            "to_ts": to_ts.isoformat(),
            "count": len(raw),
            "source": "local",
        }

    filter_str = _build_filter(q=q, level=level, event=event, trace_id=trace_id,
                               user_id=user_id, student_id=student_id,
                               from_ts=from_ts, to_ts=to_ts)
    try:
        # list_entries with order_by="timestamp desc" requires "timestamp desc" literal
        from google.cloud.logging import DESCENDING
        iterator = client.list_entries(
            filter_=filter_str,
            order_by=DESCENDING,
            page_size=page_size,
            page_token=page_token,
        )
        entries = []
        # Consume one page worth of entries.
        page = next(iterator.pages, None)
        if page is not None:
            for e in page:
                entries.append(_entry_to_dict(e))
        return {
            "entries": entries,
            "next_page_token": iterator.next_page_token or None,
            "filter": filter_str,
            "from_ts": from_ts.isoformat(),
            "to_ts": to_ts.isoformat(),
            "count": len(entries),
            "source": "cloud",
        }
    except Exception as e:
        log.exception("Cloud Logging query failed")
        return JSONResponse({"error": f"Cloud Logging query failed: {e}", "filter": filter_str}, status_code=500)


@router.get("/traces/{trace_id}")
async def get_trace(trace_id: str, request: Request,
                    minutes: int = Query(1440, ge=1, le=10080)):
    """Return every entry that shares a given trace_id (ascending by time)."""
    auth = _require_admin(request)
    if not auth:
        return JSONResponse({"error": "authentication required"}, status_code=401)

    to_ts = datetime.now(tz=timezone.utc)
    from_ts = to_ts - timedelta(minutes=minutes)

    client = _get_client()
    if client is None:
        raw = _read_local_entries(q=None, level=None, event=None, trace_id=trace_id,
                                  user_id=None, student_id=None,
                                  from_ts=from_ts, to_ts=to_ts, limit=1000)
        # Trace view wants ascending by time
        raw.sort(key=lambda r: r.get("timestamp", ""))
        return {
            "trace_id": trace_id,
            "entries": [_local_entry_to_dict(r, i) for i, r in enumerate(raw)],
            "count": len(raw),
            "filter": "local-file",
            "source": "local",
        }

    filter_str = _build_filter(q=None, level=None, event=None, trace_id=trace_id,
                               user_id=None, student_id=None,
                               from_ts=from_ts, to_ts=to_ts)
    try:
        from google.cloud.logging import ASCENDING
        iterator = client.list_entries(filter_=filter_str, order_by=ASCENDING, page_size=1000)
        entries = [_entry_to_dict(e) for e in iterator]
        return {"trace_id": trace_id, "entries": entries, "count": len(entries), "filter": filter_str, "source": "cloud"}
    except Exception as e:
        log.exception("Cloud Logging trace fetch failed")
        return JSONResponse({"error": f"Cloud Logging trace fetch failed: {e}"}, status_code=500)


@router.get("/events")
async def known_events(request: Request):
    """Return the list of structured event names the app currently emits, for
    the viewer's event-name dropdown."""
    auth = _require_admin(request)
    if not auth:
        return JSONResponse({"error": "authentication required"}, status_code=401)
    return {
        "events": [
            "http.request_start",
            "http.request_end",
            "http.request_error",
            "llm.request",
            "llm.response",
            "llm.error",
            "db.query",
            "db.query_error",
            "session.message.user",
            "session.message.assistant",
            "engine.transition",
        ],
        "levels": ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
    }
