"""Academy curriculum browsing routes for the academy client.

Provides endpoints for subjects, phases, themes, capsules, student progress,
and student authentication under the /api/academy prefix.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from report_card_utils import traverse_report_card_capsules, get_capsule_status, set_current_position

import db as database
from auth import get_auth_user, require_auth, format_display_name

log = logging.getLogger(__name__)

academy_router = APIRouter(prefix="/api/academy", tags=["academy"])

# Routes that bypass GlobalAuthMiddleware. web_ui.py imports this set to build
# the global allowlist, so renaming a route here won't silently lock it out.
PUBLIC_PATHS: set[str] = {"/api/academy/student-login"}

# Icon mapping kept client-side; slug derived from tutor name
_SUBJECT_ICON_FALLBACK = {
    "Biology": "dna", "Chemistry": "flask", "English": "book",
    "Math": "compass", "Physics": "atom",
}
_SUBJECT_COLOR_FALLBACK = {
    "Biology": "#22c55e", "Chemistry": "#f59e0b", "English": "#3b82f6",
    "Math": "#ef4444", "Physics": "#8b5cf6",
}


# ---------------------------------------------------------------------------
# 1. GET /api/academy/subjects
# ---------------------------------------------------------------------------

@academy_router.get("/subjects")
async def list_subjects():
    """Return all subjects with tutor info and available phases from the database."""
    rows = database.fetchall("""
        SELECT s.id, s.name,
               array_agg(DISTINCT sc.phase ORDER BY sc.phase) AS phases
        FROM subjects s
        LEFT JOIN subject_curriculum sc ON sc.subject_id = s.id
        GROUP BY s.id, s.name
        ORDER BY s.name
    """)
    # Get default tutor per subject from curriculum_themes
    tutor_rows = database.fetchall("""
        SELECT DISTINCT s.name AS subject,
               t.persona->>'tutor_name' AS tutor_name
        FROM subjects s
        JOIN subject_curriculum sc ON sc.subject_id = s.id
        JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
        JOIN tutors t ON t.id = ct.tutor_id
    """)
    tutor_map = {r["subject"]: r["tutor_name"] for r in tutor_rows}
    result = []
    for r in rows:
        name = r["name"]
        tutor_name = tutor_map.get(name, name)
        result.append({
            "id": str(r["id"]),
            "name": name,
            "tutor_name": tutor_name,
            "tutor_slug": tutor_name.lower(),
            "icon": _SUBJECT_ICON_FALLBACK.get(name, "circle"),
            "color": _SUBJECT_COLOR_FALLBACK.get(name, "#6b7280"),
            "phases": r["phases"] or [],
        })
    return result


# ---------------------------------------------------------------------------
# 2. GET /api/academy/subjects/{subject_id}/phases
# ---------------------------------------------------------------------------

@academy_router.get("/subjects/{subject_id}/phases")
async def list_phases(subject_id: str):
    """Return phases available for a subject, sorted by phase number."""
    rows = database.fetchall("""
        SELECT id, phase, age_range
        FROM subject_curriculum
        WHERE subject_id = %s
        ORDER BY phase
    """, (subject_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="Subject not found or has no phases")
    return [{"id": str(r["id"]), "phase": r["phase"], "age_range": r["age_range"]} for r in rows]


# ---------------------------------------------------------------------------
# 3. GET /api/academy/themes?subject_id=...&phase=...
# ---------------------------------------------------------------------------

@academy_router.get("/themes")
async def list_themes(subject_id: str = Query(...), phase: Optional[int] = Query(None)):
    """Return themes for a subject, optionally filtered by phase, with capsule counts."""
    sql = """SELECT ct.id, ct.name, ct.description, ct.theme_order, ct.tutor_id,
                    sc.phase, COUNT(cc.id) AS capsule_count
             FROM curriculum_themes ct
             JOIN subject_curriculum sc ON sc.id = ct.subject_curriculum_id
             LEFT JOIN curriculum_capsules cc ON cc.curriculum_theme_id = ct.id
             WHERE sc.subject_id = %s"""
    params = [subject_id]
    if phase is not None:
        sql += " AND sc.phase = %s"
        params.append(phase)
    sql += " GROUP BY ct.id, ct.name, ct.description, ct.theme_order, ct.tutor_id, sc.phase"
    sql += " ORDER BY " + ("ct.theme_order" if phase is not None else "sc.phase, ct.theme_order")
    rows = database.fetchall(sql, tuple(params))
    return [{
        "id": str(r["id"]),
        "title": r["name"],
        "name": r["name"],
        "description": r["description"] or "",
        "theme_order": r["theme_order"],
        "phase": r["phase"],
        "tutor_id": str(r["tutor_id"]) if r["tutor_id"] else None,
        "capsule_count": r["capsule_count"],
    } for r in rows]


# ---------------------------------------------------------------------------
# 3b. POST /api/academy/select-theme -- write theme + first capsule to report card
# ---------------------------------------------------------------------------

class SelectThemeRequest(BaseModel):
    student_id: str
    theme_id: str

@academy_router.post("/select-theme")
async def select_theme(body: SelectThemeRequest):
    """Write the selected theme and its first capsule into the student's report card."""
    theme_row = database.fetchone("""
        SELECT ct.id, ct.name, sc.phase, sc.subject_id
        FROM curriculum_themes ct
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        WHERE ct.id = %s
    """, (body.theme_id,))
    if not theme_row:
        raise HTTPException(status_code=404, detail="Theme not found")

    first_cap = database.fetchone("""
        SELECT id, name FROM curriculum_capsules
        WHERE curriculum_theme_id = %s
        ORDER BY capsule_order LIMIT 1
    """, (body.theme_id,))

    rc = database.get_report_card(body.student_id)
    set_current_position(rc, subject_id=theme_row["subject_id"], phase=theme_row["phase"],
                         theme_id=theme_row["id"], theme_name=theme_row["name"],
                         capsule_id=first_cap["id"] if first_cap else None,
                         capsule_name=first_cap["name"] if first_cap else "")
    database.save_report_card(body.student_id, rc)
    return {"ok": True, "theme": theme_row["name"], "capsule": first_cap["name"] if first_cap else None, "phase": theme_row["phase"]}


# ---------------------------------------------------------------------------
# 3c. POST /api/academy/start-capsule -- write specific capsule to report card before session
# ---------------------------------------------------------------------------

class StartCapsuleRequest(BaseModel):
    student_id: str
    capsule_id: str
    fact_id: Optional[str] = None  # explicit fact selection from start-session

@academy_router.post("/start-capsule")
async def start_capsule(body: StartCapsuleRequest):
    """Write the specific capsule into the student's report card current_position before starting a session."""
    cap_row = database.fetchone("""
        SELECT cc.id, cc.name, ct.id as theme_id, ct.name as theme_name, sc.phase, sc.subject_id
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        WHERE cc.id = %s
    """, (body.capsule_id,))
    if not cap_row:
        raise HTTPException(status_code=404, detail="Capsule not found")

    rc = database.get_report_card(body.student_id)
    set_current_position(rc, subject_id=cap_row["subject_id"], phase=cap_row["phase"],
                         theme_id=cap_row["theme_id"], theme_name=cap_row["theme_name"],
                         capsule_id=cap_row["id"], capsule_name=cap_row["name"],
                         fact_id=body.fact_id)
    database.save_report_card(body.student_id, rc)
    return {"ok": True, "capsule": cap_row["name"], "phase": cap_row["phase"]}


# ---------------------------------------------------------------------------
# 4. GET /api/academy/themes/{theme_id}/capsules?student_id=...
# ---------------------------------------------------------------------------

@academy_router.get("/themes/{theme_id}/capsules")
async def list_capsules(theme_id: str, student_id: Optional[str] = Query(None)):
    """Return capsules for a theme, optionally with student progress from report_card."""
    rows = database.fetchall("""
        SELECT cc.id, cc.name, cc.capsule_order
        FROM curriculum_capsules cc
        WHERE cc.curriculum_theme_id = %s
        ORDER BY cc.capsule_order
    """, (theme_id,))

    # Read completion status from report_card (source of truth)
    rc_capsule_status = {}
    if student_id:
        rc = database.get_report_card(student_id)
        for _sid, _phase, _tid, cid, cdata in traverse_report_card_capsules(rc):
            rc_capsule_status[cid] = get_capsule_status(cdata)

    result = []
    for r in rows:
        cid = str(r["id"])
        status = rc_capsule_status.get(cid, "not_started")
        item = {
            "id": cid,
            "name": r["name"],
            "title": r["name"],
            "capsule_order": r["capsule_order"],
            "display_order": r["capsule_order"],
            "status": status,
            "has_completed": status in ("completed", "mastered"),
        }
        result.append(item)
    return result


# ---------------------------------------------------------------------------
# 5. GET /api/academy/student/{student_id}/progress
# ---------------------------------------------------------------------------

@academy_router.get("/student/{student_id}/progress")
async def student_progress(student_id: str):
    """Return overall progress summary for a student across all subjects."""
    student = database.get_student(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Per-subject progress
    subject_rows = database.fetchall("""
        SELECT s.id AS subject_id, s.name AS subject_name,
               COUNT(DISTINCT cc.id) AS total_capsules,
               COUNT(DISTINCT CASE WHEN ls.end_time IS NOT NULL THEN cc.id END) AS completed_capsules
        FROM subjects s
        JOIN subject_curriculum sc ON sc.subject_id = s.id
        JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
        JOIN curriculum_capsules cc ON cc.curriculum_theme_id = ct.id
        LEFT JOIN learning_sessions ls
            ON ls.curriculum_capsule_id = cc.id AND ls.student_id = %s
        GROUP BY s.id, s.name
        ORDER BY s.name
    """, (student_id,))

    subjects = []
    for r in subject_rows:
        total = r["total_capsules"]
        completed = r["completed_capsules"]
        subjects.append({
            "subject_id": str(r["subject_id"]),
            "subject_name": r["subject_name"],
            "capsules_completed": completed,
            "total_capsules": total,
            "completion_pct": round(completed / total * 100, 1) if total > 0 else 0,
        })

    # Totals
    totals = database.fetchone("""
        SELECT COUNT(*) AS total_sessions,
               COALESCE(SUM(duration_seconds), 0) AS total_time_seconds
        FROM learning_sessions
        WHERE student_id = %s
    """, (student_id,))

    return {
        "student_id": student_id,
        "name": format_display_name(student, fallback_key=None) or "",
        "placement_data": student.get("placement_data"),
        "subjects": subjects,
        "total_sessions": totals["total_sessions"],
        "total_time_seconds": totals["total_time_seconds"],
    }


# ---------------------------------------------------------------------------
# 5b. GET /api/academy/capsules/{capsule_id}/facts
# ---------------------------------------------------------------------------

@academy_router.get("/capsules/{capsule_id}/facts")
async def get_capsule_facts(capsule_id: str, request: Request,
                            student_id: Optional[str] = None):
    """Return all facts for a capsule with scaffold steps.

    With ?student_id= (must be owned by the caller), each fact also carries
    that student's report-card progress flags so clients can show which facts
    are already completed (is_taught = TEACH->TRY done; is_mastered = passed
    the final EVIDENCE check)."""
    facts = database.get_capsule_facts(capsule_id)
    if not facts:
        return []

    fact_progress = {}
    if student_id:
        from auth import verify_student_ownership
        auth = require_auth(request)
        if not verify_student_ownership(auth, student_id):
            return JSONResponse({"error": "Access denied"}, status_code=403)
        rc = database.get_report_card(student_id)
        for fp in database.get_fact_progress_from_report_card(rc, capsule_id):
            fact_progress[str(fp["fact_id"])] = fp

    result = []
    for f in facts:
        fid = str(f["id"])
        p = fact_progress.get(fid, {})
        result.append({
            "id": fid,
            "order": f["order"],
            "core_fact": f["meta_data"].get("core_fact", ""),
            "scaffold": f["meta_data"].get("scaffold", []),
            "vocabulary": f["meta_data"].get("vocabulary", ""),
            "micro_check": f["meta_data"].get("micro_check", ""),
            "difficulty_weight": f["meta_data"].get("difficulty_weight", 0),
            "is_taught": bool(p.get("is_taught")),
            "is_assessed": bool(p.get("is_assessed")),
            "is_mastered": bool(p.get("is_mastered")),
        })
    return result


# ---------------------------------------------------------------------------
# 6. POST /api/academy/student-login
# ---------------------------------------------------------------------------

class StudentLoginRequest(BaseModel):
    email: str
    password: str
    turnstile_token: str | None = None


@academy_router.post("/student-login")
async def student_login(req: StudentLoginRequest, request: Request):
    """Authenticate a student user and create a session."""
    from auth import authenticate_user, SESSION_EXPIRY_DAYS
    from helpers import verify_turnstile
    client_ip = request.client.host if request.client else None
    if not verify_turnstile(req.turnstile_token or "", client_ip):
        return JSONResponse({"error": "Human verification failed"}, status_code=400)
    user, token, session_data = authenticate_user(req.email, req.password)
    if not user:
        return JSONResponse({"error": "Invalid credentials"}, status_code=401)
    resp = JSONResponse({
        "student": {
            "id": session_data["student_id"] or str(user["id"]),
            "username": user.get("email", ""),
            "email": user.get("email", ""),
            "first_name": user.get("first_name") or "",
            "last_name": user.get("last_name") or "",
        },
        "organization": {
            "id": "zingbee-rt",
            "name": "ZingBee Academy",
            "slug": "zingbee-academy",
        },
    })
    from web_ui import _set_session_cookie
    _set_session_cookie(resp, token)
    return resp


# ---------------------------------------------------------------------------
# 7. GET /api/academy/me
# ---------------------------------------------------------------------------

@academy_router.get("/me")
async def me(request: Request):
    """Return current authenticated user and student profiles."""
    user = require_auth(request)

    # Refresh student list from DB
    students = database.get_students_for_user(user["user_id"])
    first_student = students[0] if students else {}

    # Get user record for first_name/last_name
    db_user = database.get_user(user["user_id"]) if user.get("user_id") else None

    return {
        "user_id": str(user["user_id"]),
        "student_id": user["student_id"],
        "student": {
            "id": user["student_id"],
            "first_name": db_user.get("first_name", "") if db_user else "",
            "last_name": db_user.get("last_name", "") if db_user else "",
            "email": user.get("email", ""),
        },
        "display_name": user["display_name"],
        "email": user.get("email"),
    }
