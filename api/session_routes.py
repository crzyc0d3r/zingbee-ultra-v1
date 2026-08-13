"""Session Viewer UI and API routes for ZingBee RT Studio.

Provides /sessions UI and /sessions/api/* JSON endpoints for browsing
all tutoring sessions, viewing chat transcripts, execution logs, and
session metadata. Mount this router in the main FastAPI app.
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

import db as database

log = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])

# Whitelist of sortable columns (frontend key -> SQL expression)
_SORT_COLUMNS = {
    "student_name": "COALESCE(u.first_name || ' ' || u.last_name, st.student_id)",
    "subject_name": "sub.name",
    "capsule_name": "cc.name",
    "start_time": "s.start_time",
    "duration_seconds": "s.duration_seconds",
    "questions_asked": "s.questions_asked",
    "correct_answers": "s.correct_answers",
    "accuracy": "s.accuracy",
    "total_tokens": "s.total_tokens",
    "message_count": "message_count",
}

# ---------------------------------------------------------------------------
# Auth dependency - reuses web_ui.py auth_sessions dict
# ---------------------------------------------------------------------------

_auth_sessions = None


def init_auth(auth_sessions_ref: dict):
    """Bind the shared auth_sessions dict. Call from web_ui.py at startup."""
    global _auth_sessions
    _auth_sessions = auth_sessions_ref


def require_auth(request: Request) -> dict:
    """Check session cookie auth. Returns user info dict or None."""
    from datetime import datetime, timezone
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
# API endpoints
# ---------------------------------------------------------------------------

@router.get("/api/list")
async def api_list_sessions(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    student_id: Optional[str] = None,
    search: Optional[str] = None,
    order_by: Optional[str] = None,
    order_dir: Optional[str] = Query(None, pattern="^(ASC|DESC)$"),
):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        conn = database.get_conn()
        try:
            with conn.cursor() as cur:
                where_clauses = []
                params = []
                if student_id:
                    where_clauses.append("s.student_id = %s")
                    params.append(student_id)
                if search:
                    where_clauses.append(
                        "(st.student_id ILIKE %s OR cc.name ILIKE %s OR s.id::text ILIKE %s)"
                    )
                    params.extend([f"%{search}%"] * 3)
                where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

                # Count
                cur.execute(f"SELECT count(*) FROM learning_sessions s LEFT JOIN students st ON s.student_id = st.student_id LEFT JOIN curriculum_capsules cc ON s.curriculum_capsule_id = cc.id{where_sql}", params)
                total = cur.fetchone()["count"]

                # Rows
                cur.execute(f"""
                    SELECT s.id, s.student_id, COALESCE(u.first_name || ' ' || u.last_name, st.student_id) AS student_name,
                           s.curriculum_capsule_id, cc.name AS capsule_name,
                           sub.name AS subject_name,
                           s.start_time, s.end_time, s.duration_seconds,
                           s.questions_asked, s.correct_answers,
                           s.total_tokens, s.facts_taught_count, s.accuracy,
                           s.tutor_id, t.persona->>'tutor_name' AS tutor_name,
                           (SELECT count(*) FROM learning_session_messages sm WHERE sm.learning_session_id = s.id) AS message_count
                    FROM learning_sessions s
                    LEFT JOIN students st ON s.student_id = st.student_id
                    LEFT JOIN users u ON st.user_id = u.id
                    LEFT JOIN curriculum_capsules cc ON s.curriculum_capsule_id = cc.id
                    LEFT JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
                    LEFT JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
                    LEFT JOIN subjects sub ON sc.subject_id = sub.id
                    LEFT JOIN tutors t ON s.tutor_id = t.id
                    {where_sql}
                    ORDER BY {_SORT_COLUMNS.get(order_by, "s.start_time")} {"ASC" if order_dir == "ASC" else "DESC"} NULLS LAST
                    LIMIT %s OFFSET %s
                """, params + [limit, offset])
                rows = cur.fetchall()
        finally:
            conn.close()

        # Serialize
        sessions = []
        for r in rows:
            sessions.append({
                "id": str(r["id"]),
                "student_id": r["student_id"],
                "student_name": r["student_name"] or r["student_id"][:12],
                "capsule_name": r["capsule_name"] or "Unknown",
                "subject_name": r["subject_name"] or "",
                "start_time": r["start_time"].isoformat() if r["start_time"] else None,
                "end_time": r["end_time"].isoformat() if r["end_time"] else None,
                "duration_seconds": r["duration_seconds"],
                "questions_asked": r["questions_asked"] or 0,
                "correct_answers": r["correct_answers"] or 0,
                "total_tokens": r["total_tokens"] or 0,
                "facts_taught_count": r["facts_taught_count"] or 0,
                "accuracy": float(r["accuracy"]) if r["accuracy"] else None,
                "tutor_id": str(r["tutor_id"]) if r["tutor_id"] else None,
                "tutor_name": r["tutor_name"],
                "message_count": r["message_count"],
            })
        return {"sessions": sessions, "total": total, "limit": limit, "offset": offset}
    except Exception as e:
        log.exception("list_sessions failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/students")
async def api_list_students(request: Request):
    """List all students for filter dropdown."""
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        rows = database.fetchall(
            """SELECT st.student_id, COALESCE(u.first_name || ' ' || u.last_name, st.student_id) AS name
               FROM students st
               LEFT JOIN users u ON st.user_id = u.id
               ORDER BY st.created_date"""
        )
        return [{"student_id": r["student_id"], "name": r["name"] or r["student_id"][:12]} for r in rows]
    except Exception as e:
        log.exception("list_students failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.delete("/api/{learning_session_id}")
async def api_delete_session(learning_session_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        database.delete_session(learning_session_id)
        return {"ok": True}
    except Exception as e:
        log.exception("delete_session failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/{learning_session_id}")
async def api_session_detail(learning_session_id: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        conn = database.get_conn()
        try:
            with conn.cursor() as cur:
                # Session row with joins
                cur.execute("""
                    SELECT s.*, COALESCE(u.first_name || ' ' || u.last_name, st.student_id) AS student_name,
                           cc.name AS capsule_name,
                           sub.name AS subject_name,
                           tut.persona->>'tutor_name' AS tutor_name
                    FROM learning_sessions s
                    LEFT JOIN students st ON s.student_id = st.student_id
                    LEFT JOIN users u ON st.user_id = u.id
                    LEFT JOIN curriculum_capsules cc ON s.curriculum_capsule_id = cc.id
                    LEFT JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
                    LEFT JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
                    LEFT JOIN subjects sub ON sc.subject_id = sub.id
                    LEFT JOIN tutors tut ON s.tutor_id = tut.id
                    WHERE s.id = %s
                """, (learning_session_id,))
                session = cur.fetchone()
                if not session:
                    return JSONResponse({"error": "Session not found"}, status_code=404)

                # Messages
                cur.execute("""
                    SELECT id, role, content, created_date
                    FROM learning_session_messages
                    WHERE learning_session_id = %s
                    ORDER BY created_date ASC
                """, (learning_session_id,))
                messages = cur.fetchall()

                # Reconstruct fact interactions from execution_log events
                interactions = []
                if session.get("execution_log"):
                    elog = session["execution_log"]
                    if isinstance(elog, str):
                        try:
                            elog = json.loads(elog)
                        except Exception:
                            elog = []
                    for entry in elog:
                        evt = entry.get("step", "") or entry.get("event", "")
                        data = entry.get("details", {}) or entry.get("data", {})
                        if evt in ("FACT_EXPOSURE", "FACT_ASSESSED", "CHECK_FAILED"):
                            interactions.append({
                                "interaction_type": data.get("interaction_type", evt.lower()),
                                "understood": data.get("understood"),
                                "exposure_number": data.get("exposure_count"),
                                "is_meaningful": data.get("counted", True),
                                "step_at_time": data.get("to_phase"),
                                "interaction_data": [],
                                "created_at": entry.get("timestamp", entry.get("ts")),
                                "fact_text": data.get("fact", ""),
                            })
                        elif evt == "V6_TRANSITION":
                            interactions.append({
                                "interaction_type": data.get("action", ""),
                                "understood": None,
                                "exposure_number": None,
                                "is_meaningful": True,
                                "step_at_time": data.get("to_phase"),
                                "step_from": data.get("from_phase"),
                                "step_position": data.get("step_position"),
                                "step_total": data.get("step_total"),
                                "reason": data.get("reason", ""),
                                "interaction_data": [],
                                "created_at": entry.get("timestamp", entry.get("ts")),
                                "fact_text": data.get("fact", ""),
                            })

                # Feedback for this session
                cur.execute("""
                    SELECT sentiment, comment, created_date,
                           message_index, message_text, context_messages
                    FROM learning_session_feedback
                    WHERE learning_session_id = %s
                    ORDER BY created_date ASC
                """, (learning_session_id,))
                feedback = cur.fetchall()
        finally:
            conn.close()

        # Serialize
        def ts(dt):
            return dt.isoformat() if dt else None

        exec_log = session.get("execution_log") or []
        if isinstance(exec_log, str):
            try:
                exec_log = json.loads(exec_log)
            except Exception:
                exec_log = []

        return {
            "id": str(session["id"]),
            "student_id": session["student_id"],
            "student_name": session["student_name"] or session["student_id"][:12],
            "capsule_name": session["capsule_name"] or "Unknown",
            "subject_name": session["subject_name"] or "",
            "start_time": ts(session["start_time"]),
            "end_time": ts(session["end_time"]),
            "duration_seconds": session["duration_seconds"],
            "questions_asked": session["questions_asked"] or 0,
            "correct_answers": session["correct_answers"] or 0,
            "total_tokens": session["total_tokens"] or 0,
            "facts_taught_count": session["facts_taught_count"] or 0,
            "accuracy": float(session["accuracy"]) if session["accuracy"] else None,
            "tutor_id": str(session["tutor_id"]) if session.get("tutor_id") else None,
            "tutor_name": session.get("tutor_name"),
            "execution_log": exec_log,
            "system_log": (lambda sl: json.loads(sl) if isinstance(sl, str) else sl)(session.get("system_log") or []),
            "messages": [
                {
                    "id": str(m["id"]),
                    "role": m["role"],
                    "content": m["content"],
                    "created_at": ts(m["created_date"]),
                }
                for m in messages
            ],
            "interactions": [
                {
                    "type": i["interaction_type"],
                    "understood": i["understood"],
                    "exposure": i["exposure_number"],
                    "is_meaningful": i.get("is_meaningful", True),
                    "step": i.get("step_at_time"),
                    "fact_text": i.get("fact_text", ""),
                    "created_at": i.get("created_at"),
                    "messages": [],
                }
                for i in interactions
            ],
            "feedback": [
                {
                    "sentiment": f["sentiment"],
                    "comment": f["comment"],
                    "created_at": ts(f["created_date"]),
                    "message_index": f.get("message_index"),
                    "message_text": f.get("message_text") or "",
                    "context_messages": (
                        json.loads(f["context_messages"])
                        if isinstance(f.get("context_messages"), str)
                        else (f.get("context_messages") or [])
                    ),
                }
                for f in feedback
            ],
        }
    except Exception as e:
        log.exception("session_detail failed")
        return JSONResponse({"error": str(e)}, status_code=500)


# ---------------------------------------------------------------------------
# Session Viewer UI
# ---------------------------------------------------------------------------

