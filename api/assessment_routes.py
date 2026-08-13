"""Placement assessment routes for ZingBee RT Studio.

Provides endpoints for placement question retrieval, assessment lifecycle
(start, resume, progress, submit), placement status checks, and resets.

Mount this router in the main FastAPI app:
    from assessment_routes import assessment_router
    app.include_router(assessment_router)
"""

import json
import logging
import random
import uuid
from datetime import datetime, timezone

from report_card_utils import ensure_json, set_current_position
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from auth import get_auth_user, verify_student_ownership
import db as database

log = logging.getLogger(__name__)

assessment_router = APIRouter(tags=["assessment"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class StartAssessmentRequest(BaseModel):
    student_id: str
    subject_id: str


class ProgressUpdate(BaseModel):
    current_question_index: int
    responses: list


class ResponseItem(BaseModel):
    question_id: str
    question_code: str
    variant_id: str
    student_answer: str
    time_spent_seconds: int = 0


class SubmitAssessmentRequest(BaseModel):
    assessment_id: str
    responses: List[ResponseItem]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_placement_questions(subject_id: str) -> list:
    """Fetch all placement questions for a subject, ordered by display_order."""
    return database.fetchall(
        """SELECT id, subject_id, curriculum_theme_id, phase, question_code,
                  display_order, max_time_seconds, question_data
           FROM placement_questions WHERE subject_id = %s ORDER BY display_order""",
        (subject_id,),
    )


def _get_variants(question_row: dict) -> tuple:
    """Parse question_data and extract variants list. Returns (qdata, variants)."""
    qdata = ensure_json(question_row.get("question_data") or {})
    return qdata, qdata.get("variants", [])


def _find_variant(question_row: dict, variant_id: str):
    """Find a variant by ID within question_data.variants. Returns None if not found."""
    _, variants = _get_variants(question_row)
    return next((v for v in variants if str(v.get("variant_id", v.get("id", ""))) == str(variant_id)), None)


def _safe_variant(variant: dict) -> dict:
    """Return variant dict without correct_answer."""
    return {k: v for k, v in variant.items() if k != "correct_answer"} if variant else {}


def _get_placement_data(student_id: str) -> tuple:
    """Fetch and parse student placement_data. Returns (student_row, placement_dict)."""
    student = database.fetchone("SELECT placement_data FROM students WHERE student_id = %s", (student_id,))
    return (student, ensure_json(student.get("placement_data") or {})) if student else (None, {})


def _pick_random_variant(question_row: dict) -> dict:
    """Pick one random variant from question_data.variants, stripping correct_answer."""
    _, variants = _get_variants(question_row)
    return _safe_variant(random.choice(variants)) if variants else {}


def _get_variant_by_id(question_row: dict, variant_id: str) -> dict:
    """Get a specific variant by its id, stripping correct_answer."""
    v = _find_variant(question_row, variant_id)
    if v:
        return _safe_variant(v)
    _, variants = _get_variants(question_row)
    return _safe_variant(variants[0]) if variants else {}


def _get_correct_answer(question_row: dict, variant_id: str):
    """Get the correct_answer for a specific variant."""
    v = _find_variant(question_row, variant_id)
    return v.get("correct_answer") if v else None


def _calculate_phase(total_score: int) -> int:
    """Determine assigned phase from total score.
    0-6: phase 1, 7-12: phase 2, 13-18: phase 3, 19-24: phase 4
    """
    if total_score <= 6:
        return 1
    elif total_score <= 12:
        return 2
    elif total_score <= 18:
        return 3
    else:
        return 4


def _build_question_list(questions: list, variant_map: dict) -> list:
    """Build the question list with assigned variants for a response."""
    result = []
    for q in questions:
        qid = str(q["id"])
        variant_id = variant_map.get(qid)
        if variant_id:
            variant = _get_variant_by_id(q, variant_id)
        else:
            variant = _pick_random_variant(q)
        qdata, _ = _get_variants(q)
        result.append({
            "id": qid,
            "question_code": q.get("question_code"),
            "display_order": q.get("display_order"),
            "question_type": qdata.get("question_type", "MCQ"),
            "theme_name": qdata.get("theme_name", ""),
            "concept_capsule": qdata.get("concept_capsule", ""),
            "difficulty": qdata.get("difficulty", q.get("phase", 1)),
            "weight": qdata.get("weight", 1),
            "max_time_seconds": q.get("max_time_seconds"),
            "variant_id": variant.get("variant_id", ""),
            "question_text": variant.get("question_text", ""),
            "options": variant.get("options"),
        })
    return result


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@assessment_router.get("/api/placement-questions/subject/{subject_id}")
async def get_placement_questions(subject_id: str, request: Request):
    """Get all placement questions for a subject with one random variant each."""
    questions = _fetch_placement_questions(subject_id)
    if not questions:
        return JSONResponse({"questions": [], "count": 0})

    result = []
    for q in questions:
        variant = _pick_random_variant(q)
        result.append({
            "id": str(q["id"]),
            "question_code": q.get("question_code"),
            "phase": q.get("phase"),
            "curriculum_theme_id": str(q["curriculum_theme_id"]) if q.get("curriculum_theme_id") else None,
            "display_order": q.get("display_order"),
            "max_time_seconds": q.get("max_time_seconds"),
            "variant": variant,
        })

    return {"questions": result, "count": len(result)}


@assessment_router.post("/api/student-assessments/start")
async def start_assessment(body: StartAssessmentRequest, request: Request):
    """Start a new placement assessment or return existing in-progress one."""
    auth = get_auth_user(request)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not verify_student_ownership(auth, body.student_id):
        raise HTTPException(status_code=403, detail="Not authorized for this student")
    # Check for existing in-progress assessment
    existing = database.fetchone(
        """SELECT id, assessment_data, started_at, status
           FROM student_assessments
           WHERE student_id = %s AND subject_id = %s AND status = 'in_progress'
           ORDER BY started_at DESC LIMIT 1""",
        (body.student_id, body.subject_id),
    )

    # Fetch questions for this subject
    questions = _fetch_placement_questions(body.subject_id)
    if not questions:
        raise HTTPException(status_code=404, detail="No placement questions found for this subject")

    if existing:
        # Return existing in-progress assessment
        adata = existing.get("assessment_data") or {}
        adata = ensure_json(adata)
        variant_map = adata.get("assigned_variants", {})
        q_list = _build_question_list(questions, variant_map)
        return {
            "id": str(existing["id"]),
            "student_id": body.student_id,
            "subject_id": body.subject_id,
            "status": "in_progress",
            "resumed": True,
            "started_at": str(existing["started_at"]),
            "assigned_variants": variant_map,
            "questions": q_list,
            "current_question_index": adata.get("current_question_index", 0),
            "responses": adata.get("responses", []),
        }

    # Assign random variants for each question
    assigned_variants = {}
    for q in questions:
        _, variants = _get_variants(q)
        if variants:
            chosen = random.choice(variants)
            assigned_variants[str(q["id"])] = str(chosen.get("variant_id", chosen.get("id", "")))

    assessment_id = str(uuid.uuid4())
    assessment_data = json.dumps({
        "assigned_variants": assigned_variants,
        "current_question_index": 0,
        "responses": [],
    })

    now = datetime.now(timezone.utc)
    database.execute(
        """INSERT INTO student_assessments
               (id, student_id, subject_id, started_at, status, assessment_data, created_at)
           VALUES (%s, %s, %s, %s, 'in_progress', %s, %s)""",
        (assessment_id, body.student_id, body.subject_id, now, assessment_data, now),
    )

    q_list = _build_question_list(questions, assigned_variants)
    return {
        "id": assessment_id,
        "student_id": body.student_id,
        "subject_id": body.subject_id,
        "status": "in_progress",
        "resumed": False,
        "started_at": str(now),
        "assigned_variants": assigned_variants,
        "questions": q_list,
        "current_question_index": 0,
        "responses": [],
    }


@assessment_router.get("/api/student-assessments/{assessment_id}/resume")
async def resume_assessment(assessment_id: str, request: Request):
    """Resume an in-progress assessment with the same assigned variants."""
    auth = get_auth_user(request)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    assessment = database.fetchone(
        """SELECT id, student_id, subject_id, started_at, status, assessment_data
           FROM student_assessments
           WHERE id = %s""",
        (assessment_id,),
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if not verify_student_ownership(auth, assessment["student_id"]):
        raise HTTPException(status_code=403, detail="Not authorized for this student")
    if assessment["status"] != "in_progress":
        raise HTTPException(status_code=400, detail="Assessment is not in progress")

    adata = assessment.get("assessment_data") or {}
    adata = ensure_json(adata)

    variant_map = adata.get("assigned_variants", {})

    questions = _fetch_placement_questions(str(assessment["subject_id"]))

    q_list = _build_question_list(questions, variant_map)
    return {
        "assessment_id": str(assessment["id"]),
        "status": "in_progress",
        "started_at": str(assessment["started_at"]),
        "questions": q_list,
        "current_question_index": adata.get("current_question_index", 0),
        "responses": adata.get("responses", []),
    }


@assessment_router.put("/api/student-assessments/{assessment_id}/progress")
async def update_progress(assessment_id: str, body: ProgressUpdate, request: Request):
    """Save current progress (question index and partial responses)."""
    auth = get_auth_user(request)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    assessment = database.fetchone(
        """SELECT id, student_id, status, assessment_data
           FROM student_assessments WHERE id = %s""",
        (assessment_id,),
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if not verify_student_ownership(auth, assessment["student_id"]):
        raise HTTPException(status_code=403, detail="Not authorized for this student")
    if assessment["status"] != "in_progress":
        raise HTTPException(status_code=400, detail="Assessment is not in progress")

    adata = assessment.get("assessment_data") or {}
    adata = ensure_json(adata)

    adata["current_question_index"] = body.current_question_index
    adata["responses"] = body.responses

    database.execute(
        """UPDATE student_assessments
           SET assessment_data = %s
           WHERE id = %s""",
        (json.dumps(adata), assessment_id),
    )

    return {"status": "ok", "current_question_index": body.current_question_index}


@assessment_router.post("/api/student-assessments/submit")
async def submit_assessment(body: SubmitAssessmentRequest, request: Request):
    """Grade and finalize a placement assessment."""
    auth = get_auth_user(request)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    assessment = database.fetchone(
        """SELECT id, student_id, subject_id, status, assessment_data
           FROM student_assessments WHERE id = %s""",
        (body.assessment_id,),
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if not verify_student_ownership(auth, assessment["student_id"]):
        raise HTTPException(status_code=403, detail="Not authorized for this student")
    if assessment["status"] == "completed":
        raise HTTPException(status_code=400, detail="Assessment already completed")

    subject_id = str(assessment["subject_id"])
    student_id = assessment["student_id"]

    # Fetch all questions for grading
    questions = database.fetchall(
        """SELECT id, question_code, curriculum_theme_id, phase, question_data
           FROM placement_questions
           WHERE subject_id = %s""",
        (subject_id,),
    )
    q_map = {str(q["id"]): q for q in questions}

    # Grade each response
    total_score = 0
    max_score = 0
    graded_responses = []
    theme_scores = {}  # theme_id -> {correct, total}

    for resp in body.responses:
        q = q_map.get(resp.question_id)
        if not q:
            graded_responses.append({
                "question_id": resp.question_id,
                "question_code": resp.question_code,
                "variant_id": resp.variant_id,
                "student_answer": resp.student_answer,
                "correct_answer": None,
                "is_correct": False,
                "time_spent_seconds": resp.time_spent_seconds,
                "error": "question_not_found",
            })
            max_score += 1
            continue

        correct_answer = _get_correct_answer(q, resp.variant_id)
        is_correct = (
            correct_answer is not None
            and str(resp.student_answer).strip().lower() == str(correct_answer).strip().lower()
        )

        if is_correct:
            total_score += 1
        max_score += 1

        # Track per-theme scores
        theme_id = str(q["curriculum_theme_id"]) if q.get("curriculum_theme_id") else "general"
        if theme_id not in theme_scores:
            theme_scores[theme_id] = {"correct": 0, "total": 0}
        theme_scores[theme_id]["total"] += 1
        if is_correct:
            theme_scores[theme_id]["correct"] += 1

        graded_responses.append({
            "question_id": resp.question_id,
            "question_code": resp.question_code,
            "variant_id": resp.variant_id,
            "student_answer": resp.student_answer,
            "correct_answer": correct_answer,
            "is_correct": is_correct,
            "time_spent_seconds": resp.time_spent_seconds,
        })

    assigned_phase = _calculate_phase(total_score)

    # Update assessment_data with grading results
    adata = assessment.get("assessment_data") or {}
    adata = ensure_json(adata)
    adata["graded_responses"] = graded_responses
    adata["theme_scores"] = theme_scores

    now = datetime.now(timezone.utc)

    # Read-only lookups for the response payload. Done BEFORE the UPDATE so
    # any failure here leaves the assessment in its original state and the
    # student can retry. Previously these were after the UPDATE, so a query
    # bug (e.g. a missing uuid cast) would mark the assessment 'completed'
    # but never return the result, locking the student out.
    phase_row = database.fetchone(
        "SELECT age_range FROM subject_curriculum WHERE subject_id = %s AND phase = %s",
        (subject_id, assigned_phase),
    )
    age_range = phase_row["age_range"] if phase_row else ""

    theme_ids = [tid for tid in theme_scores if tid != "general"]
    theme_names = {"general": "General"}
    if theme_ids:
        trows = database.fetchall("SELECT id, name FROM curriculum_themes WHERE id = ANY(%s::uuid[])", (theme_ids,))
        theme_names.update({str(r["id"]): r["name"] for r in trows})

    # Update student_assessments
    database.execute(
        """UPDATE student_assessments
           SET status = 'completed',
               completed_at = %s,
               assigned_phase = %s,
               total_score = %s,
               max_score = %s,
               assessment_data = %s
           WHERE id = %s""",
        (now, assigned_phase, total_score, max_score, json.dumps(adata), body.assessment_id),
    )

    # Update students.placement_data
    _, placement_data = _get_placement_data(student_id)

    placement_data[subject_id] = {
        "assessment_id": body.assessment_id,
        "assigned_phase": assigned_phase,
        "total_score": total_score,
        "max_score": max_score,
        "theme_scores": theme_scores,
        "completed_at": now.isoformat(),
    }

    database.execute(
        """UPDATE students
           SET placement_data = %s
           WHERE student_id = %s""",
        (json.dumps(placement_data), student_id),
    )

    # Write assigned phase into report card current_position
    # so the progress tool knows which phase to start from
    try:
        rc = database.get_report_card(student_id)
        first_capsule = database.fetchone("""
            SELECT cc.id as capsule_id, cc.name as capsule_name,
                   ct.id as theme_id, ct.name as theme_name
            FROM curriculum_capsules cc
            JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
            JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
            WHERE sc.subject_id = %s AND sc.phase = %s
            ORDER BY ct.theme_order, cc.capsule_order
            LIMIT 1
        """, (subject_id, assigned_phase))
        set_current_position(
            rc, subject_id=subject_id, phase=assigned_phase,
            theme_id=first_capsule["theme_id"] if first_capsule else None,
            theme_name=first_capsule["theme_name"] if first_capsule else "",
            capsule_id=first_capsule["capsule_id"] if first_capsule else None,
            capsule_name=first_capsule["capsule_name"] if first_capsule else "",
        )
        database.save_report_card(student_id, rc)
    except Exception as e:
        logging.warning("Failed to write placement to report_card: %s", e)

    # Calculate total time from individual question times
    total_time_seconds = sum(r.get("time_spent_seconds", 0) or 0 for r in graded_responses)

    # Build strengths / areas to develop from theme scores (theme_names was
    # populated above before the UPDATE so this section can't fail.)
    strengths = [theme_names[tid] for tid, s in theme_scores.items() if s["total"] > 0 and s["correct"] / s["total"] >= 0.6]
    areas_to_develop = [theme_names[tid] for tid, s in theme_scores.items() if s["total"] > 0 and s["correct"] / s["total"] < 0.6]

    # Build named theme_scores for client
    named_theme_scores = {theme_names[tid]: {"correct": s["correct"], "total": s["total"], "percentage": round(s["correct"] / s["total"] * 100) if s["total"] else 0} for tid, s in theme_scores.items()}

    score_pct = round(total_score / max_score * 100) if max_score else 0
    message = "Great job!" if score_pct >= 70 else "Good effort!" if score_pct >= 40 else "Keep practicing!"

    return {
        "assessment_id": body.assessment_id,
        "status": "completed",
        "total_score": total_score,
        "max_score": max_score,
        "assigned_phase": assigned_phase,
        "assigned_phase_number": assigned_phase,
        "assigned_phase_name": f"Phase {assigned_phase} (Ages {age_range})" if age_range else f"Phase {assigned_phase}",
        "theme_scores": named_theme_scores,
        "strengths": strengths,
        "areas_to_develop": areas_to_develop,
        "message": message,
        "graded_responses": graded_responses,
        "total_time_seconds": total_time_seconds,
    }


@assessment_router.get("/api/student-assessments/student/{student_id}/placement/{subject_id}")
async def get_placement_status(student_id: str, subject_id: str, request: Request):
    """Check if a student has a placement for a subject."""
    auth = get_auth_user(request)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not verify_student_ownership(auth, student_id):
        raise HTTPException(status_code=403, detail="Not authorized for this student")
    # Check students.placement_data
    _, pd = _get_placement_data(student_id)
    placement = pd.get(subject_id) if pd else None

    # Check for in-progress assessment
    in_progress = database.fetchone(
        """SELECT id FROM student_assessments
           WHERE student_id = %s AND subject_id = %s AND status = 'in_progress'
           ORDER BY started_at DESC LIMIT 1""",
        (student_id, subject_id),
    )

    return {
        "has_placement": placement is not None,
        "has_in_progress": in_progress is not None,
        "in_progress_id": str(in_progress["id"]) if in_progress else None,
        "placement": placement,
    }


@assessment_router.delete("/api/student-assessments/student/{student_id}/reset")
async def reset_assessments(
    student_id: str,
    request: Request,
    subject_id: Optional[str] = Query(None),
):
    """Delete assessments and clear placement data for a student.
    If subject_id is provided, only reset that subject; otherwise reset all.
    """
    auth = get_auth_user(request)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not verify_student_ownership(auth, student_id):
        raise HTTPException(status_code=403, detail="Not authorized for this student")
    if subject_id:
        database.execute(
            "DELETE FROM student_assessments WHERE student_id = %s AND subject_id = %s",
            (student_id, subject_id),
        )
        # Clear just this subject from placement_data
        _, pd = _get_placement_data(student_id)
        if pd:
            pd.pop(subject_id, None)
            database.execute(
                "UPDATE students SET placement_data = %s WHERE student_id = %s",
                (json.dumps(pd), student_id),
            )
    else:
        database.execute(
            "DELETE FROM student_assessments WHERE student_id = %s",
            (student_id,),
        )
        database.execute(
            "UPDATE students SET placement_data = %s WHERE student_id = %s",
            (json.dumps({}), student_id),
        )

    return {"status": "ok", "student_id": student_id, "subject_id": subject_id}
