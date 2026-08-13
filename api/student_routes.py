"""Student / session-info routes for ZingBee RT Studio.

Extracted from web_ui.py. Provides endpoints for session reset, end-session,
feedback, session status, student details, report cards, session details,
session image polling, and greeting.

Mount this router in the main FastAPI app and call init() to wire up shared state.
"""

import json
import logging
import random
import threading
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from report_card_utils import traverse_report_card_capsules, get_capsule_status
from pydantic import BaseModel

from auth import get_auth_user, verify_student_ownership, require_auth, require_student_access, format_display_name
import db as database
import engagement
from llm import call_xai, REASONING_LEVEL
from helpers import parse_suggestions, parse_images
from tools.curriculum_tool import get_capsule_by_name
from tools.progress_tool import get_student_progress
from tools.media_tool import generate_from_prompt, XAI_API_KEY

log = logging.getLogger(__name__)

router = APIRouter(tags=["student"])

# ---- Shared state, set by init() ------------------------------------------

_sessions = None
_SessionState = None
_generate_image = None
_persist_image = None
_is_valid_subject = None


def init(sessions_ref, session_state_cls, generate_image_fn, persist_image_fn, is_valid_subject_fn):
    global _sessions, _SessionState, _generate_image, _persist_image, _is_valid_subject
    _sessions = sessions_ref
    _SessionState = session_state_cls
    _generate_image = generate_image_fn
    _persist_image = persist_image_fn
    _is_valid_subject = is_valid_subject_fn


# ---- Helpers ---------------------------------------------------------------

def _get_session(student_id):
    if student_id not in _sessions or not _sessions[student_id].is_active:
        _sessions[student_id] = _SessionState(student_id)
    return _sessions[student_id]


def _read_student_file(student_id: str, subject: str = "Biology") -> dict:
    """Read student progress from DB (replaces JSON file read)."""
    student = database.get_student(student_id)
    if not student:
        return {"source": "database", "exists": False, "content": None}
    content = json.loads(get_student_progress(student_id, subject))
    return {"source": "database", "exists": True, "content": content}


# ---- Pydantic models ------------------------------------------------------

class FeedbackRequest(BaseModel):
    sentiment: str
    comment: str = ""
    message_index: int
    # Frontend-authoritative message text. The index alone can drift between
    # client and server (LLM retry rows on server, rehydrated sessions with
    # different message counts, etc.) so we use the text as the source of
    # truth and treat the index as a hint for locating context.
    message_text: str = ""


class LearningSessionFeedbackRequest(BaseModel):
    session_db_id: str = ""
    sentiment: str
    comment: str = ""


# ---- Routes ----------------------------------------------------------------

@router.post("/api/reset/{student_id}")
async def reset_session(student_id: str, request: Request, subject: str = "Biology"):
    """Reset session and wipe student progress data."""
    auth = require_student_access(request, student_id)
    if not _is_valid_subject(subject):
        subject = "Biology"
    # Clear in-memory session
    if student_id in _sessions:
        del _sessions[student_id]

    # Reset student in DB to first capsule of the given subject
    cap = database.get_first_capsule_for_subject(subject)
    if cap:
        student = database.get_student(student_id)
        if student:
            database.reset_student(student_id)
        else:
            return JSONResponse({"error": "Student not found"}, status_code=404)

    return {"status": "reset", "student_id": student_id, "progress_wiped": True}


@router.post("/api/end-session/{student_id}")
async def end_session(student_id: str, request: Request):
    """End and save the current session, returning a rich summary for the end-session screen."""
    auth = require_student_access(request, student_id)
    if student_id not in _sessions:
        return {"status": "error", "message": "No active session"}

    session = _sessions[student_id]
    if not session.is_active:
        return {"status": "error", "message": "Session already ended"}

    session_record = session.end_session()
    knowledge = session.get_knowledge_stats()

    # Per-fact progress from DB for all capsules covered this session
    fact_details = []
    for cap_name in session._capsules_covered:
        cap_kp = session.progress.get("knowledge_points", {}).get(cap_name, {})
        cap_facts = (cap_kp.get("facts_introduced", []) + cap_kp.get("facts_taught", []) +
                     cap_kp.get("facts_assessed", []) + cap_kp.get("facts_mastered", []))
        all_facts_set = list(dict.fromkeys(cap_facts))  # dedupe preserving order
        for fact_text in all_facts_set:
            introduced = fact_text in cap_kp.get("facts_introduced", [])
            taught = fact_text in cap_kp.get("facts_taught", [])
            assessed = fact_text in cap_kp.get("facts_assessed", [])
            mastered = fact_text in cap_kp.get("facts_mastered", [])
            status = ("mastered" if mastered else
                      "assessed" if assessed else
                      "taught" if taught else
                      "introduced" if introduced else "not_started")
            fact_details.append({
                "capsule": cap_name,
                "fact": fact_text,
                "status": status,
                "introduced": introduced,
                "taught": taught,
                "assessed": assessed,
                "mastered": mastered,
            })

    # Include fact progress from report_card for richer data (exposure counts etc)
    db_fact_progress = []
    if session._capsule_db_id:
        try:
            rc = database.get_report_card(student_id)
            rc_facts = database.get_fact_progress_from_report_card(rc, session._capsule_db_id)
            # Resolve fact_id -> fact_text for display
            reverse_map = {str(v): k for k, v in (session._fact_id_map or {}).items()}
            for f in rc_facts:
                db_fact_progress.append({
                    "fact_text": reverse_map.get(f["fact_id"], f["fact_id"][:12]),
                    "exposure_count": f["exposure_count"],
                    "correct_count": f["correct_count"],
                    "incorrect_count": f["incorrect_count"],
                    "is_taught": f["is_taught"],
                    "is_assessed": f["is_assessed"],
                    "is_mastered": f["is_mastered"],
                })
        except Exception:
            pass

    # Summarize execution log events by type
    exec_summary = {}
    for entry in session.execution_log:
        etype = entry.get("event", "UNKNOWN")
        exec_summary[etype] = exec_summary.get(etype, 0) + 1

    return {
        "status": "ended",
        "session": session_record,
        "subject": session.subject,
        "tutor_name": session.tutor_name,
        "knowledge": knowledge,
        "fact_details": fact_details,
        "db_fact_progress": db_fact_progress,
        "capsules_covered": session._capsules_covered,
        "execution_summary": exec_summary,
        "session_db_id": str(session.session_db_id) if session.session_db_id else None,
    }


@router.post("/api/end-session-beacon/{student_id}")
async def end_session_beacon(student_id: str, request: Request):
    """Lightweight session-end called via navigator.sendBeacon on tab close
    or page hide. sendBeacon can't read responses or set custom headers,
    so this relies on cookie-based auth and always returns 204. Skips the
    rich-summary work of /api/end-session since nothing is displayed."""
    auth = require_student_access(request, student_id)
    session = _sessions._cache.get(student_id) if hasattr(_sessions, "_cache") else _sessions.get(student_id)
    if session is None or not getattr(session, "is_active", False):
        return JSONResponse(None, status_code=204)
    try:
        session.end_session()
    except Exception as exc:
        log.warning("end_session_beacon failed for student %s: %s", student_id, exc)
    finally:
        if hasattr(_sessions, "_cache"):
            _sessions._cache.pop(student_id, None)
    return JSONResponse(None, status_code=204)


@router.post("/api/feedback")
async def submit_feedback(body: FeedbackRequest, request: Request):
    """Record tester feedback (thumbs-up/down) on an assistant message."""
    auth = require_auth(request)
    if body.sentiment not in ("positive", "negative", "idea", "question"):
        return JSONResponse({"error": "sentiment must be 'positive', 'negative', 'idea', or 'question'"}, status_code=400)

    user_id = auth["user_id"]
    student_id = auth["student_id"]
    if not student_id or student_id not in _sessions:
        return JSONResponse({"error": "No active session"}, status_code=400)

    session = _sessions[student_id]

    # Authoritative source for the message being rated is what the client
    # actually displayed. Fall back to index-based lookup only if the client
    # didn't send the text.
    assistant_msgs = [m for m in session.messages if m["role"] == "assistant"]
    message_text = body.message_text or ""
    if not message_text and 0 <= body.message_index < len(assistant_msgs):
        message_text = assistant_msgs[body.message_index].get("content", "")

    # Locate the message in session.messages for context. Prefer matching by
    # content (robust across rehydrate / retry shifts); fall back to the
    # provided index. If neither works, ship feedback without context rather
    # than rejecting the submission.
    full_idx = None
    if message_text:
        for i, m in enumerate(session.messages):
            if m.get("role") == "assistant" and m.get("content") == message_text:
                full_idx = i
                break
    if full_idx is None and 0 <= body.message_index < len(assistant_msgs):
        count = -1
        for i, m in enumerate(session.messages):
            if m["role"] == "assistant":
                count += 1
                if count == body.message_index:
                    full_idx = i
                    break

    if full_idx is not None:
        context_start = max(0, full_idx - 2)
        context_end = min(len(session.messages), full_idx + 2)
        context_messages = [
            {"role": m["role"], "content": m.get("content", "")}
            for m in session.messages[context_start:context_end]
            if m["role"] != "system"
        ]
    else:
        context_messages = []

    # Snapshot execution log and session stats
    execution_snapshot = list(session.execution_log)
    session_stats = {
        "questions": session.question_count,
        "correct": session.correct_count,
        "total_tokens": session.total_tokens,
        "facts_taught": len(session.session_taught_facts),
        "facts_mastered": sum(1 for f in session.session_taught_facts if f),  # count of set entries
        "current_step": session.progress["current_position"].get("step_name", ""),
        "capsule_name": session.capsule_name,
    }

    try:
        row = database.save_learning_session_feedback(
            learning_session_id=session.session_db_id,
            user_id=user_id,
            student_id=student_id,
            sentiment=body.sentiment,
            comment=body.comment or None,
            message_index=body.message_index,
            message_text=message_text,
            context_messages=context_messages,
            execution_snapshot=execution_snapshot,
            session_stats=session_stats,
        )
        return {"status": "ok", "feedback_id": str(row["id"])}
    except Exception as e:
        logging.warning("save_learning_session_feedback failed: %s", e)
        return JSONResponse({"error": "Failed to save feedback"}, status_code=500)


@router.get("/api/feedback/{learning_session_id}")
async def get_feedback(learning_session_id: str, request: Request):
    """Get all feedback entries for a session."""
    auth = require_auth(request)
    rows = database.get_learning_session_feedback(learning_session_id)
    return {"feedback": [dict(r) for r in (rows or [])]}


@router.post("/api/learning-session-feedback")
async def submit_learning_session_feedback(body: LearningSessionFeedbackRequest, request: Request):
    """Record overall learning session feedback from the end-session screen."""
    auth = require_auth(request)
    if body.sentiment not in ("positive", "negative", "idea", "question"):
        return JSONResponse({"error": "sentiment must be 'positive', 'negative', 'idea', or 'question'"}, status_code=400)
    # Resolve learning_session_id: use provided value, else try in-memory session, else latest DB session
    learning_session_id = body.session_db_id or None
    if not learning_session_id:
        student_id = auth.get("student_id")
        if student_id and student_id in _sessions and _sessions[student_id].session_db_id:
            learning_session_id = str(_sessions[student_id].session_db_id)
        elif student_id:
            try:
                row = database.fetchone(
                    "SELECT id FROM learning_sessions WHERE student_id = %s ORDER BY start_time DESC LIMIT 1",
                    (student_id,)
                )
                if row:
                    learning_session_id = str(row["id"])
            except Exception:
                pass
    try:
        row = database.save_learning_session_feedback(
            learning_session_id=learning_session_id,
            user_id=auth["user_id"],
            student_id=auth["student_id"],
            sentiment=body.sentiment,
            comment=body.comment or None,
            message_index=-1,  # -1 indicates session-level feedback
            message_text="[SESSION FEEDBACK]",
            context_messages=None,
            execution_snapshot=None,
            session_stats=None,
        )
        return {"status": "ok", "feedback_id": str(row["id"])}
    except Exception as e:
        logging.warning("save_learning_session_feedback failed: %s", e)
        return JSONResponse({"error": "Failed to save feedback"}, status_code=500)


@router.get("/api/session-status/{student_id}")
async def get_session_status(student_id: str, request: Request):
    """Get current session status including duration."""
    auth = require_student_access(request, student_id)
    if student_id not in _sessions:
        return {"active": False, "duration_seconds": 0}

    session = _sessions[student_id]
    return {
        "active": session.is_active,
        "duration_seconds": session.get_session_duration(),
        "questions": session.question_count,
        "correct": session.correct_count,
        "facts_taught": len(session.session_taught_facts),
        "tokens": session.total_tokens
    }


@router.get("/api/student-status/{student_id}")
async def get_student_status(student_id: str, request: Request, subject: str = "Biology"):
    """Check if a student has prior session history for a subject."""
    auth = require_student_access(request, student_id)
    student = database.get_student(student_id)
    if not student:
        return {"has_history": False, "capsule_name": "", "subject_match": False}

    # Check report_card for progress in this subject
    rc = database.get_report_card(student_id)
    subject_row = database.get_subject_by_name(subject)
    sid = str(subject_row["id"]) if subject_row else ""
    subject_data = rc.get(sid, {})
    subject_match = bool(subject_data)
    has_history = bool(subject_data)
    capsule_name = ""
    has_progress = False

    # Find the current capsule and check if it has actual taught facts
    for _sid, _phase, _tid, _cid, cdata in traverse_report_card_capsules(rc):
        if _sid != sid:
            continue
        status = get_capsule_status(cdata)
        if status in ("in_progress", "completed"):
            has_progress = True
        if cdata.get("name"):
            capsule_name = cdata["name"]

    # Find all subjects with progress from report_card
    all_subjects_with_progress = []
    for subj_id, subj_data in rc.items():
        if not isinstance(subj_data, dict) or "phases" not in subj_data:
            continue
        subj_row = database.fetchone("SELECT name FROM subjects WHERE id = %s", (subj_id,))
        if subj_row:
            all_subjects_with_progress.append(subj_row["name"])

    # Find the last subject from the most recent learning_session
    last_subject_name = None
    last_sess = database.fetchone("""
        SELECT sub.name FROM learning_sessions ls
        JOIN curriculum_capsules cc ON ls.curriculum_capsule_id = cc.id
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects sub ON sc.subject_id = sub.id
        WHERE ls.student_id = %s
        ORDER BY ls.start_time DESC LIMIT 1
    """, (student_id,))
    if last_sess:
        last_subject_name = last_sess["name"]

    return {
        "has_history": has_history,
        "has_progress": has_progress,
        "capsule_name": capsule_name,
        "subject_match": subject_match,
        "subjects_with_progress": all_subjects_with_progress,
        "last_subject": last_subject_name,
    }


@router.get("/api/student-details/{student_id}")
async def get_student_details(student_id: str, request: Request, subject: str = "Biology"):
    """Get student progress details for the student details modal."""
    auth = require_student_access(request, student_id)
    progress_json = get_student_progress(student_id, subject)
    progress = json.loads(progress_json)
    if "error" in progress:
        return {"error": progress["error"]}
    pos = progress.get("current_position", {})
    completed = progress.get("completed_capsules", [])
    sessions_list = progress.get("session_history", [])
    return {
        "subject": subject,
        "current_position": {
            "phase": pos.get("phase"),
            "step_name": pos.get("step_name"),
            "theme_name": pos.get("theme_name"),
            "capsule_name": pos.get("capsule_name"),
            "current_fact": progress.get("knowledge_points", {}).get(pos.get("capsule_name", ""), {}).get("current_fact"),
        },
        "total_credits": progress.get("total_credits", 0),
        "completed_capsules": [c.get("capsule_name", "") for c in completed],
        "recent_sessions": [{"date": s.get("date", "")[:10], "capsule": s.get("capsule", ""), "facts_taught": s.get("facts_taught", 0)} for s in sessions_list[:10]],
    }


def _batch_name_lookup(table: str, ids: set) -> dict:
    """Batch-fetch id->name mapping."""
    if not ids:
        return {}
    assert table in ("curriculum_themes", "curriculum_capsules", "subjects")
    placeholders = ",".join(["%s"] * len(ids))
    rows = database.fetchall(f"SELECT id, name FROM {table} WHERE id::text IN ({placeholders})", tuple(ids))
    return {str(r["id"]): r["name"] for r in rows}


def _batch_fact_text_lookup(fact_ids: set) -> dict:
    """Batch-fetch fact_id -> core_fact text mapping from curriculum_facts."""
    if not fact_ids:
        return {}
    placeholders = ",".join(["%s"] * len(fact_ids))
    rows = database.fetchall(
        f"SELECT id, meta_data->>'core_fact' AS fact_text FROM curriculum_facts WHERE id::text IN ({placeholders})",
        tuple(fact_ids),
    )
    return {str(r["id"]): (r["fact_text"] or "") for r in rows}


# ---------------------------------------------------------------------------
# Report Card endpoints
# ---------------------------------------------------------------------------

def _build_subject_section(subject_name: str, subject_uuid: str, subject_data: dict,
                            theme_names: dict, capsule_names: dict, fact_texts: dict) -> dict:
    """Build a single subject's report-card payload from its report_card bucket."""
    summary = {
        "total_facts": subject_data.get("total_facts", 0),
        "mastered_facts": subject_data.get("mastered_facts", 0),
        "taught_facts": subject_data.get("taught_facts", 0),
        "total_capsules": subject_data.get("total_capsules", 0),
        "completed_capsules": subject_data.get("completed_capsules", 0),
        "total_credits": subject_data.get("total_credits", 0),
        "total_exposures": subject_data.get("total_exposures", 0),
    }

    phases = []
    phases_data = subject_data.get("phases", {})
    for phase_num in sorted(phases_data.keys(), key=lambda x: int(x)):
        phase_info = phases_data[phase_num]
        themes_list = []
        for t_uuid, t_info in phase_info.get("themes", {}).items():
            capsules_list = []
            for c_uuid, c_info in t_info.get("capsules", {}).items():
                total_correct = c_info.get("total_correct", 0)
                total_incorrect = c_info.get("total_incorrect", 0)
                total_attempts = total_correct + total_incorrect
                accuracy = round((total_correct / total_attempts) * 100, 1) if total_attempts > 0 else 0.0
                # Per-fact detail: report_card stores fact progress inline at capsule.facts
                facts_list = []
                for f_uuid, f_info in (c_info.get("facts") or {}).items():
                    if not isinstance(f_info, dict):
                        continue
                    facts_list.append({
                        "fact_id": f_uuid,
                        "fact_text": fact_texts.get(f_uuid, "") or "",
                        "is_taught": bool(f_info.get("is_taught")),
                        "is_assessed": bool(f_info.get("is_assessed")),
                        "is_mastered": bool(f_info.get("is_mastered")),
                        "exposure_count": int(f_info.get("exposure_count", 0) or 0),
                        "correct_count": int(f_info.get("correct_count", 0) or 0),
                        "incorrect_count": int(f_info.get("incorrect_count", 0) or 0),
                    })
                capsules_list.append({
                    "capsule_name": capsule_names.get(c_uuid, c_uuid),
                    "status": c_info.get("status", "not_started"),
                    "total_facts": c_info.get("total_facts", 0),
                    "mastered_count": c_info.get("mastered_count", 0),
                    "taught_count": c_info.get("taught_count", 0),
                    "total_exposures": c_info.get("total_exposures", 0),
                    "total_correct": total_correct,
                    "total_incorrect": total_incorrect,
                    "credits": c_info.get("credits", 0),
                    "accuracy": accuracy,
                    "facts": facts_list,
                })
            themes_list.append({
                "theme_name": theme_names.get(t_uuid, t_uuid),
                "total_capsules": t_info.get("total_capsules", 0),
                "completed_capsules": t_info.get("completed_capsules", 0),
                "total_facts": t_info.get("total_facts", 0),
                "mastered_facts": t_info.get("mastered_facts", 0),
                "capsules": capsules_list,
            })
        phases.append({
            "phase": int(phase_num),
            "total_facts": phase_info.get("total_facts", 0),
            "mastered_facts": phase_info.get("mastered_facts", 0),
            "taught_facts": phase_info.get("taught_facts", 0),
            "total_capsules": phase_info.get("total_capsules", 0),
            "completed_capsules": phase_info.get("completed_capsules", 0),
            "themes": themes_list,
        })

    return {
        "subject": subject_name,
        "subject_id": subject_uuid,
        "summary": summary,
        "phases": phases,
    }


def _collect_ids_from_subject(subject_data: dict, theme_ids: set, capsule_ids: set, fact_ids: set) -> None:
    """Walk a subject's phases/themes/capsules/facts and accumulate all referenced UUIDs."""
    for _phase_num, phase_info in (subject_data.get("phases") or {}).items():
        for t_uuid, t_info in (phase_info.get("themes") or {}).items():
            theme_ids.add(t_uuid)
            for c_uuid, c_info in (t_info.get("capsules") or {}).items():
                capsule_ids.add(c_uuid)
                for f_uuid in (c_info.get("facts") or {}).keys():
                    fact_ids.add(f_uuid)


async def _build_report_card(student_id: str, subject: str):
    """Shared logic for building report card response.

    If ``subject == "all"`` (or any non-matching value when the caller wants
    every subject), returns ``{subjects: [<section>, ...]}``. Otherwise
    returns a single subject section flattened at the top level (back-compat).
    """
    student = database.get_student(student_id)
    if not student:
        return JSONResponse({"error": "Student not found"}, status_code=404)

    report_card = database.get_report_card(student_id)

    want_all = (subject or "").strip().lower() == "all"

    # Filter to UUID-keyed buckets that actually hold subject data
    subject_buckets = {
        k: v for k, v in (report_card or {}).items()
        if isinstance(v, dict) and isinstance(k, str) and len(k) == 36 and "-" in k
    }

    if want_all:
        # Resolve all subject names in one go
        all_subj_names = _batch_name_lookup("subjects", set(subject_buckets.keys()))

        theme_ids, capsule_ids, fact_ids = set(), set(), set()
        for sub_data in subject_buckets.values():
            _collect_ids_from_subject(sub_data, theme_ids, capsule_ids, fact_ids)

        theme_names = _batch_name_lookup("curriculum_themes", theme_ids)
        capsule_names = _batch_name_lookup("curriculum_capsules", capsule_ids)
        fact_texts = _batch_fact_text_lookup(fact_ids)

        sections = []
        for sub_uuid, sub_data in subject_buckets.items():
            sub_name = all_subj_names.get(sub_uuid, sub_uuid)
            sections.append(_build_subject_section(sub_name, sub_uuid, sub_data,
                                                   theme_names, capsule_names, fact_texts))
        # Stable order: by subject name
        sections.sort(key=lambda s: (s.get("subject") or "").lower())

        return {
            "student_name": format_display_name(student),
            "subjects": sections,
        }

    # ---- Single-subject path (back-compat) ----
    subj = database.get_subject_by_name(subject)
    subject_uuid = str(subj["id"]) if subj else None
    subject_data = subject_buckets.get(subject_uuid or "", {}) if subject_uuid else {}

    # Auto-detect: if requested subject has no data, pick the first subject that does
    if not subject_data and subject_buckets:
        for rc_uuid, rc_data in subject_buckets.items():
            if rc_data.get("total_facts", 0) > 0:
                subject_uuid = rc_uuid
                subject_data = rc_data
                row = database.fetchone("SELECT name FROM subjects WHERE id::text = %s", (rc_uuid,))
                if row:
                    subject = row["name"]
                break

    theme_ids, capsule_ids, fact_ids = set(), set(), set()
    _collect_ids_from_subject(subject_data, theme_ids, capsule_ids, fact_ids)
    theme_names = _batch_name_lookup("curriculum_themes", theme_ids)
    capsule_names = _batch_name_lookup("curriculum_capsules", capsule_ids)
    fact_texts = _batch_fact_text_lookup(fact_ids)

    section = _build_subject_section(subject, subject_uuid or "", subject_data,
                                     theme_names, capsule_names, fact_texts)

    return {
        "student_name": format_display_name(student),
        "subject": section["subject"],
        "summary": section["summary"],
        "phases": section["phases"],
    }


@router.get("/api/student-report-card/{student_id}")
async def get_student_report_card(student_id: str, request: Request, subject: str = "Biology"):
    """Get rich report card data for a student (parent/student access)."""
    auth = require_student_access(request, student_id)
    return await _build_report_card(student_id, subject)


@router.get("/admin/api/student-report-card/{student_id}")
async def admin_get_student_report_card(student_id: str, request: Request, subject: str = "Biology"):
    """Get rich report card data for a student (admin access, no ownership check)."""
    auth = require_auth(request)
    return await _build_report_card(student_id, subject)


@router.get("/api/session-details/{student_id}")
async def get_session_details(student_id: str, request: Request):
    """Get comprehensive session + student details for the details popup."""
    auth = require_student_access(request, student_id)
    if student_id not in _sessions:
        return {"error": "No active session"}

    session = _sessions[student_id]
    duration = session.get_session_duration()
    kp = session.progress.get("knowledge_points", {}).get(session.capsule_name, {})
    knowledge = session.get_knowledge_stats()
    progress = session.progress
    session_history = progress.get("session_history", [])
    interactions = progress.get("interactions", [])

    # Extract human-readable insights from execution_log
    insights = []
    for entry in session.execution_log:
        step = entry.get("step", "")
        details = entry.get("details", {})
        ts = entry.get("timestamp", "")
        # Shorten timestamp to HH:MM:SS
        short_ts = ts[11:19] if len(ts) >= 19 else ts

        if step == "SESSION_START":
            insights.append({"time": short_ts, "text": f"Session started for {details.get('student_id', student_id)}", "type": "info"})
        elif step == "PROGRESS_LOADED":
            insights.append({"time": short_ts, "text": f"Loaded progress: capsule={details.get('capsule', '?')}, step={details.get('step', '?')}", "type": "info"})
        elif step == "CURRICULUM_LOADED":
            phase = details.get("phase", "?")
            fpath = details.get("curriculum_file", "?")
            theme = details.get("theme", "?")
            fc = details.get("facts_count", "?")
            insights.append({"time": short_ts, "text": f"Curriculum loaded: Phase {phase}, {theme}, {fc} facts", "type": "info"})
            insights.append({"time": short_ts, "text": f"File: {fpath}", "type": "info"})
        elif step == "FACT_EXPOSURE":
            fact = details.get("fact", "?")
            count = details.get("exposure_count", "?")
            insights.append({"time": short_ts, "text": f"Fact exposure #{count}: {fact}", "type": "teach"})
        elif step == "FACT_TAUGHT":
            fact = details.get("fact", details.get("fact_text", ""))
            idx = details.get("fact_index", "?")
            insights.append({"time": short_ts, "text": f"Fact #{idx} taught: {fact}", "type": "teach"})
        elif step == "FACT_MASTERED":
            fact = details.get("fact", details.get("fact_text", ""))
            insights.append({"time": short_ts, "text": f"Fact mastered: {fact}", "type": "mastery"})
        elif step == "STEP_TRANSITION":
            insights.append({"time": short_ts, "text": f"Step: {details.get('from', '?')} -> {details.get('to', '?')} | fact: {details.get('fact', '')}", "type": "step"})
        elif step == "CYCLE_ADVANCE":
            insights.append({"time": short_ts, "text": f"Cycle advance ({details.get('step', '?')}) | fact: {details.get('fact', '')}", "type": "step"})
        elif step == "CAPSULE_SWITCH":
            insights.append({"time": short_ts, "text": f"Capsule switch: {details.get('from', '?')} -> {details.get('to', '?')}", "type": "capsule"})
        elif step == "GUARDRAIL_TRIGGERED":
            insights.append({"time": short_ts, "text": f"Guardrail: {details.get('reason', 'off-topic')}", "type": "warn"})
        elif step == "IMAGE_REQUEST":
            topic = details.get("topic", "?")
            desc = details.get("description", "")
            desc_short = desc
            trigger = details.get("trigger", "")
            label = f"Image request: {topic}" + (f" ({trigger})" if trigger else "")
            if desc_short:
                label += f" — {desc_short}"
            insights.append({"time": short_ts, "text": label, "type": "media"})
        elif step in ("IMAGE_GENERATE_FULL", "IMAGE_GENERATE_RESULT"):
            ok = details.get("success", False)
            prompt = details.get("full_prompt", "")
            model = details.get("model", "?")
            url = details.get("image_url", "")
            prompt_short = prompt
            if ok:
                insights.append({"time": short_ts, "text": f"Image generated [{model}]: {url}", "type": "media"})
            else:
                insights.append({"time": short_ts, "text": f"Image FAILED [{model}]: {details.get('error', '?')}", "type": "warn"})
            insights.append({"time": short_ts, "text": f"Prompt sent: {prompt_short}", "type": "media"})
        elif step in ("IMAGE_GENERATION_FAILED", "IMAGE_GENERATION_ERROR", "IMAGE_REQUEST_ERROR"):
            insights.append({"time": short_ts, "text": f"Image error: {details.get('error', '?')}", "type": "warn"})
        elif step == "IMAGE_SKIP":
            insights.append({"time": short_ts, "text": f"Image skipped: {details.get('reason', '?')}", "type": "media"})
        elif step == "SESSION_END":
            insights.append({"time": short_ts, "text": "Session ended", "type": "info"})
        elif step == "GREETING_SENT":
            insights.append({"time": short_ts, "text": "Greeting sent to student", "type": "info"})
        elif step == "USER_INPUT":
            msg = details.get("message", "")
            msg_short = msg
            insights.append({"time": short_ts, "text": f"Student: {msg_short}", "type": "info"})
        elif step == "LLM_REQUEST":
            model = details.get("model", "?")
            n = details.get("message_count", "?")
            phase = details.get("phase", "chat")
            streaming = " (streaming)" if details.get("streaming") else ""
            insights.append({"time": short_ts, "text": f"LLM REQUEST [{model}] {phase}{streaming} ({n} msgs)", "type": "llm"})
        elif step == "LLM_RESPONSE":
            tokens = details.get("tokens_used", "?")
            ms = details.get("latency_ms", "?")
            insights.append({"time": short_ts, "text": f"LLM RESPONSE ({tokens} tokens, {ms}ms)", "type": "llm"})
        elif step == "ASSESSMENT_LLM_REQUEST":
            model = details.get("model", "?")
            purpose = details.get("purpose", "?")
            insights.append({"time": short_ts, "text": f"Assessment REQUEST [{model}]: {purpose}", "type": "llm"})
        elif step == "ASSESSMENT_LLM_RESPONSE":
            tokens = details.get("tokens_used", "?")
            ms = details.get("latency_ms", "?")
            insights.append({"time": short_ts, "text": f"Assessment RESPONSE ({tokens} tokens, {ms}ms)", "type": "llm"})
        elif step == "LLM_CALL":
            tokens = details.get("tokens", details.get("total_tokens", "?"))
            insights.append({"time": short_ts, "text": f"LLM call ({tokens} tokens)", "type": "llm"})

    return {
        "student": {
            "id": student_id,
            "name": progress.get("name", "Unknown"),
            "created_at": progress.get("created_at", ""),
            "total_credits": progress.get("total_credits", 0.0),
            "completed_capsules": len(progress.get("completed_capsules", [])),
            "total_sessions": len(session_history),
            "total_interactions": len(interactions),
            "last_session": progress.get("last_session", "Never"),
        },
        "session": {
            "duration_seconds": duration,
            "questions": session.question_count,
            "correct": session.correct_count,
            "total_tokens": session.total_tokens,
            "facts_taught": list(kp.get("facts_taught", [])),
            "facts_assessed": list(kp.get("facts_assessed", [])),
            "facts_mastered": list(kp.get("facts_mastered", [])),
            "fact_taught_messages": dict(kp.get("fact_taught_messages", {})),
            "current_step": progress.get("current_position", {}).get("step_name", "UNKNOWN"),
            "capsule_name": session.capsule_name,
            "theme_name": progress.get("current_position", {}).get("theme_name", ""),
            "phase": progress.get("current_position", {}).get("phase", 1),
            "start_step": getattr(session, "start_step", ""),
            "is_active": session.is_active,
        },
        "knowledge": {
            "facts_taught": knowledge["facts_taught"],
            "facts_assessed": knowledge["facts_assessed"],
            "facts_mastered": knowledge["facts_mastered"],
            "total_facts": knowledge["total_facts"],
            "current_fact": knowledge.get("current_fact"),
            "current_fact_index": knowledge.get("current_fact_index", 0),
            "current_step": knowledge.get("current_step", ""),
            "capsule_name": knowledge.get("capsule_name", ""),
            "next_capsule": knowledge.get("next_capsule"),
            "curriculum_complete": knowledge.get("curriculum_complete", False),
        },
        "insights": insights,
        "raw_log": session.execution_log,
        "system_log": session.system_log,
        "progress": progress,
        "student_file": _read_student_file(student_id, session.subject),
    }


@router.get("/api/session-image/{student_id}")
async def get_session_image(student_id: str, request: Request):
    """Poll for pending image URL. Returns {image_url: str|null}."""
    auth = require_auth(request)
    session = _sessions.get(student_id)
    if not session:
        return {"image_url": None}
    url = getattr(session, '_pending_image_url', None)
    if url:
        session._pending_image_url = None  # Consume once
    return {"image_url": url}


@router.get("/api/greeting/{student_id}")
async def get_greeting(student_id: str, request: Request, subject: str = "Biology", tutor_id: str | None = None):
    """Get initial greeting from tutor. Accepts an optional tutor_id query param
    that overrides whatever tutor the theme is assigned to — any tutor can
    teach any subject/theme."""
    auth = require_student_access(request, student_id)
    if not _is_valid_subject(subject):
        try:
            valid_names = database.list_subject_names() or []
        except Exception:
            valid_names = []
        return {"error": f"Unknown subject: {subject}. Valid: {', '.join(valid_names)}"}
    # Always create a fresh session -- greeting means the user is starting over.
    # If there's a stale active session (e.g. user refreshed without clicking Stop),
    # end it first so progress is saved, then create a new one.
    if student_id in _sessions and _sessions[student_id].is_active:
        _sessions[student_id].end_session()
    _sessions[student_id] = _SessionState(student_id, subject, tutor_id=tutor_id)
    session = _sessions[student_id]

    # Build student summary
    progress = session.progress
    interactions = progress.get("interactions", [])
    session_history = progress.get("session_history", [])

    # Determine if student is returning - has prior sessions OR interactions
    is_returning = len(session_history) > 0 or len(interactions) > 0

    # Use get_knowledge_stats() for consistent data with chat endpoint
    student_summary = {
        "student_id": student_id,
        "name": progress.get("name", "Student"),
        "phase": progress["current_position"].get("phase", 1),
        "current_theme": progress["current_position"]["theme_name"],
        "current_capsule": progress["current_position"]["capsule_name"],
        "current_step": progress["current_position"]["step_name"],
        "start_step": session.start_step,
        "total_credits": progress.get("total_credits", 0),
        "completed_capsules": len(progress.get("completed_capsules", [])),
        "total_sessions": len(session_history),
        "total_interactions": len(interactions),
        "last_session": progress.get("last_session", "Never"),
        "is_returning": is_returning,
        "knowledge_points": session.get_knowledge_stats()
    }

    log_start_idx = len(session.execution_log)  # Bookmark for consistent slicing

    session.log_execution("LOAD_STUDENT", {
        "student_id": student_id,
        "is_returning": student_summary["is_returning"],
        "sessions": student_summary["total_sessions"],
        "interactions": student_summary["total_interactions"]
    }, agent="SessionManager")

    # Build context-aware initial user message
    if is_returning:
        last = session_history[-1] if session_history else {}
        last_capsule = last.get("capsule", "biology")
        last_correct = last.get("correct_answers", 0)
        last_questions = last.get("questions_answered", 0)
        last_facts = last.get("facts_taught", 0)
        # Include recent interactions for recall context
        recent = interactions[-3:] if interactions else []
        recent_topics = ", ".join(i.get("topic", "") for i in recent if i.get("topic"))
        greeting_msg = (
            f"Hi {session.tutor_name}! I'm back. Last time we worked on \"{last_capsule}\" "
            f"where I answered {last_correct}/{last_questions} questions and "
            f"learned {last_facts} facts."
        )
        if recent_topics:
            greeting_msg += f" We recently talked about: {recent_topics}."
        greeting_msg += " What are we doing today?"
    else:
        greeting_msg = f"Hi {session.tutor_name}! This is my first time. I'm ready to learn about {session.subject_lower} today!"

    session.messages.append({
        "role": "user",
        "content": greeting_msg
    })
    if session.session_db_id:
        try:
            database.save_learning_session_message(session.session_db_id, "user", greeting_msg)
        except Exception as e:
            logging.warning("DB save greeting user message failed: %s", e)

    # Calculate delta for stateful conversation (greeting is usually first call, so no previous_response_id)
    _prev_id = session.last_response_id
    _delta_msgs = session.messages[session._messages_synced_idx:] if _prev_id else session.messages

    session.log_execution("LLM_REQUEST", {
        "step": "greeting",
        "model": session.xai_model,
        "temperature": 0.5,
        "max_tokens": session.max_tokens,
        "reasoning_level": REASONING_LEVEL,
        "stateful": bool(_prev_id),
        "previous_response_id": _prev_id,
        "message_count": len(session.messages),
        "messages_sent_count": len(_delta_msgs),
        "messages_sent": [{"role": m["role"], "content": m.get("content", "")} for m in _delta_msgs],
    }, agent=session.tutor_name)

    try:
        greeting_start = time.time()
        response = call_xai(_delta_msgs, temperature=0.5, max_tokens=session.max_tokens,
                            reasoning=REASONING_LEVEL, model=session.xai_model,
                            previous_response_id=_prev_id,
                            fallback_messages=session.messages if _prev_id else None)

        greeting = response.content
        tokens = response.usage.total_tokens if response.usage else 0
        session.total_tokens += tokens
        session.log_execution("LLM_RESPONSE", {
            "step": "greeting",
            "response_id": getattr(response, 'id', None),
            "tokens_used": tokens,
            "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
            "completion_tokens": response.usage.completion_tokens if response.usage else 0,
            "latency_ms": int((time.time() - greeting_start) * 1000),
            "response_length": len(greeting),
            "full_response": greeting
        }, agent=session.tutor_name)

        # Run assessment synchronously (fast), defer image generation to background
        greeting_assessment = session.check_student_comprehension(greeting, greeting_msg, compliance_only=True)

        greeting_image_url = None
        greeting_img_result = None

        if greeting_assessment.get("tutor_is_summarizing") or greeting_assessment.get("tutor_is_looping"):
            kp = session.progress.get("knowledge_points", {}).get(session.capsule_name, {})
            next_fact = kp.get("current_fact", "the first concept")

            session.messages.append({"role": "assistant", "content": greeting})
            correction = session._render_compliance_correction(next_fact)
            if correction:
                session.messages.append({"role": "system", "content": correction})

            # Send FULL messages fresh (no previous_response_id) to avoid server context divergence
            retry_response = call_xai(session.messages, temperature=0.5, max_tokens=session.max_tokens,
                                      reasoning=REASONING_LEVEL, model=session.xai_model,
                                      previous_response_id=None)

            greeting = retry_response.content
            retry_tokens = retry_response.usage.total_tokens if retry_response.usage else 0
            session.total_tokens += retry_tokens
            tokens += retry_tokens

            # Replace the bad assistant message and remove stale system correction
            session.messages.pop()   # Remove system correction
            session.messages[-1] = {"role": "assistant", "content": greeting}

            # Reset stateful tracking (messages were cleaned up, server context diverges)
            session.last_response_id = None
            session._messages_synced_idx = 0
        else:
            session.messages.append({"role": "assistant", "content": greeting})

            # Update stateful conversation tracking
            session.last_response_id = getattr(response, 'id', None)
            session._messages_synced_idx = len(session.messages)

        # Save raw greeting for DB storage
        _raw_greeting_for_db = greeting

        # Parse suggestions (ADO #26: the LLM's engagement chips are used, not discarded)
        greeting_parsed = parse_suggestions(greeting)
        greeting = greeting_parsed["text"]
        _greeting_raw_sugs = greeting_parsed["suggestions"]

        # Extract <EDUCATIONAL_IMAGE> prompt from greeting
        greeting_img_parsed = parse_images(greeting)
        greeting = greeting_img_parsed["text"]
        greeting_image_prompt = greeting_img_parsed.get("image_prompt")

        # Retry once if the tutor forgot the <EDUCATIONAL_IMAGE> tag
        if not greeting_image_prompt and XAI_API_KEY:
            session.log_execution("IMAGE_TAG_MISSING", {"action": "retry_with_nudge"}, agent=session.tutor_name)
            nudge = (
                "[SYSTEM] Your previous response was missing the <EDUCATIONAL_IMAGE> block. "
                "You MUST include exactly one <EDUCATIONAL_IMAGE>…</EDUCATIONAL_IMAGE> block "
                "containing a vivid, specific image generation prompt for Grok Imagine. "
                "Rewrite your greeting and include the image block."
            )
            session.messages.append({"role": "system", "content": nudge})
            retry_resp = call_xai(session.messages, temperature=0.5, max_tokens=session.max_tokens,
                                  reasoning=REASONING_LEVEL, model=session.xai_model,
                                  previous_response_id=None)
            retry_greeting = retry_resp.content
            retry_tokens = retry_resp.usage.total_tokens if retry_resp.usage else 0
            session.total_tokens += retry_tokens

            # Remove the nudge and replace the assistant message
            session.messages.pop()  # remove system nudge
            session.messages[-1] = {"role": "assistant", "content": retry_greeting}
            session.last_response_id = None
            session._messages_synced_idx = 0

            # Re-parse
            retry_parsed = parse_suggestions(retry_greeting)
            retry_greeting = retry_parsed["text"]
            _greeting_raw_sugs = retry_parsed["suggestions"]
            retry_img_parsed = parse_images(retry_greeting)
            greeting = retry_img_parsed["text"]
            greeting_image_prompt = retry_img_parsed.get("image_prompt")
            _raw_greeting_for_db = retry_greeting
            session.log_execution("IMAGE_TAG_RETRY_RESULT", {
                "has_image_tag": bool(greeting_image_prompt),
            }, agent=session.tutor_name)

        greeting_suggestions = engagement.texts(
            engagement.resolve_for_session(session, _greeting_raw_sugs))

        # Save greeting to DB
        greeting_msg_id = None
        if session.session_db_id:
            try:
                greeting_msg_id = database.save_learning_session_message(session.session_db_id, "assistant", _raw_greeting_for_db)
                if greeting_msg_id:
                    session._last_assistant_msg_id = greeting_msg_id
            except Exception as e:
                logging.warning("DB save greeting assistant message failed: %s", e)

        # Kick off image generation in background thread
        # Client will poll /api/session-image/{student_id} to get the URL
        def _bg_image_gen():
            try:
                _logs = []
                def _bg_log(step, details):
                    _logs.append({"timestamp": datetime.now().isoformat(), "step": step, "agent": "MediaCurator", "details": details})
                img_url, img_result = _generate_image(greeting, session, "greeting", _bg_log, image_prompt=greeting_image_prompt)
                with session._log_lock:
                    session.execution_log.extend(_logs)
                if img_url:
                    session.image_url = img_url
                    session._pending_image_url = img_url
                    if img_result:
                        session.total_tokens += img_result.get("tokens_used", 0)
                    # Persist to GCS
                    try:
                        _persist_image(img_url, f"greeting_{session.capsule_name}",
                                       learning_session_id=session.session_db_id,
                                       learning_session_message_id=greeting_msg_id,
                                       session=session,
                                       topic=session.capsule_name,
                                       description=img_result.get("description", "") if img_result else "",
                                       style=img_result.get("style", "") if img_result else "",
                                       full_prompt=img_result.get("full_prompt", "") if img_result else "",
                                       capsule_name=session.capsule_name)
                    except Exception as e:
                        logging.warning("Greeting image persistence failed: %s", e)
            except Exception as e:
                logging.error("Background greeting image generation failed: %s", e)

        session._pending_image_url = None  # Will be set by background thread
        threading.Thread(target=_bg_image_gen, daemon=True).start()

        # Greeting counts as TEACH(1) for TEACH-start sessions only (RECALL
        # warms up first; an EVIDENCE-start session has no scaffold to bump)
        if session.start_step == "TEACH" and hasattr(session, '_session_engine') and session._session_engine:
            session._session_engine.state["scaffold_position"] = 1

        return {
            "greeting": greeting,
            "suggestions": greeting_suggestions,
            "tokens": session.total_tokens,
            "execution_log": session.execution_log[log_start_idx:],
            "student_summary": student_summary,
            "image_url": None
        }

    except Exception as e:
        session.log_execution("ERROR", {"error": str(e)}, agent="System")
        return {
            "greeting": f"Hi! I'm {session.tutor_name}, your {session.subject} tutor. Let's learn about {session.capsule_name}! (Error connecting to LLM: {e})",
            "suggestions": [],
            "tokens": 0,
            "execution_log": session.execution_log[log_start_idx:],
            "student_summary": student_summary,
            "image_url": None
        }
