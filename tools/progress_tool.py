"""Student progress tracking tool for AutoGen agents. Reads/writes PostgreSQL."""

import json
import sys
from pathlib import Path
from datetime import datetime

_project_root = str(Path(__file__).parent.parent)
sys.path.insert(0, _project_root)
sys.path.insert(0, str(Path(_project_root) / "api"))
import db as database


def get_student_progress(student_id: str, subject: str = "Biology") -> str:
    """Read student progress from DB, building the same dict shape as the old JSON files."""
    student = database.get_student(student_id)

    def _init_for_subject(subj):
        """Look up the first capsule, curriculum, and fact for a subject."""
        cap = database.get_first_capsule_for_subject(subj)
        if not cap:
            return None
        sc_row = database.fetchone(
            "SELECT sc.id FROM subject_curriculum sc "
            "JOIN subjects s ON sc.subject_id = s.id "
            "WHERE s.name = %s ORDER BY sc.phase LIMIT 1",
            (subj,)
        )
        if not sc_row:
            return None
        facts = database.get_core_facts(cap["id"])
        first_fact_id = facts[0]["id"] if facts else None
        return cap, sc_row, first_fact_id

    if not student:
        # Auto-create at the first capsule for the given subject
        result = _init_for_subject(subject)
        if not result:
            return json.dumps({"error": f"Curriculum not loaded for {subject}"})
        cap, sc_row, first_fact_id = result
        user = database.get_default_user()
        user_id = user["id"] if user else 1
        row = database.create_student(user_id)
        student_id = row["student_id"]  # Use the auto-generated UUID
        student = database.get_student(student_id)

    # Read report_card and resolve current position
    report_card = database.get_report_card(student_id)

    # Prefer current_position from report_card (persisted by _save_progress)
    # Fall back to students table columns for legacy students
    rc_pos = _get_position_from_report_card(report_card, subject)
    if rc_pos:
        capsule_db_id = rc_pos["capsule_id"]
        cap_row = database.get_capsule_by_id(capsule_db_id) if capsule_db_id else None
        pos = {
            "phase": cap_row.get("phase", 1) if cap_row else student.get("phase", 1),
            "curriculum_theme_id": str(rc_pos["theme_id"]) if rc_pos.get("theme_id") else None,
            "theme_name": cap_row.get("theme_name", "") if cap_row else "",
            "curriculum_capsule_id": str(capsule_db_id) if capsule_db_id else None,
            "capsule_name": cap_row["name"] if cap_row else "",
            "step": rc_pos.get("step", 2),
            "step_name": rc_pos.get("step_name", "TEACH"),
            "_capsule_db_id": capsule_db_id,
            "_theme_db_id": rc_pos.get("theme_id"),
            "_curriculum_db_id": rc_pos.get("curriculum_id"),
        }
    else:
        # No position in report_card — start at first capsule for this subject
        cap = database.get_first_capsule_for_subject(subject)
        capsule_db_id = cap["id"] if cap else None
        pos = {
            "phase": cap.get("phase", 1) if cap else 1,
            "curriculum_theme_id": str(cap["theme_db_id"]) if cap and cap.get("theme_db_id") else None,
            "theme_name": cap.get("theme_name", "") if cap else "",
            "curriculum_capsule_id": str(capsule_db_id) if capsule_db_id else None,
            "capsule_name": cap["name"] if cap else "",
            "step": 2,
            "step_name": "TEACH",
            "_capsule_db_id": capsule_db_id,
            "_theme_db_id": cap.get("theme_db_id") if cap else None,
            "_curriculum_db_id": None,
        }

    # Build knowledge_points from report_card JSONB
    all_facts = database.get_core_facts(capsule_db_id) if capsule_db_id else []
    kp = _build_knowledge_points_from_report_card(report_card, capsule_db_id, all_facts)

    # Build completed capsules list from report_card
    completed_entries = database.get_completed_capsules_from_report_card(report_card)
    completed_list = []
    for c in completed_entries:
        cap_row = database.get_capsule_by_id(c["capsule_id"]) if c.get("capsule_id") else None
        completed_list.append({
            "curriculum_capsule_id": c.get("capsule_id", ""),
            "capsule_name": cap_row["name"] if cap_row else "",
            "completed_at": c.get("completed_at"),
            "mastery_level": c.get("mastery_level", "Secure"),
        })

    # Build session history from recent sessions
    recent = database.get_recent_sessions(student_id, limit=20)
    session_history = [{
        "date": s["start_time"].isoformat() if s.get("start_time") else None,
        "capsule": s.get("capsule_name", ""),
        "duration_seconds": s.get("duration_seconds", 0),
        "questions_answered": s.get("questions_asked", 0),
        "correct_answers": s.get("correct_answers", 0),
        "accuracy": float(s["accuracy"]) if s.get("accuracy") else 0,
        "facts_taught": s.get("facts_taught_count", 0),
        "tokens_used": s.get("total_tokens", 0),
    } for s in recent]

    # Student name comes from users table (joined in get_student) — students has no name column.
    _first = (student.get("first_name") or "").strip()
    _last = (student.get("last_name") or "").strip()
    _full_name = (_first + (" " + _last if _last else "")).strip() or "Student"

    progress = {
        "student_id": student["student_id"],
        "name": _full_name,
        "created_at": student["created_date"].isoformat() if student.get("created_date") else None,
        "last_session": student["last_session"].isoformat() if student.get("last_session") else None,
        "current_position": pos,
        "mastery_levels": {},
        "completed_capsules": completed_list,
        "session_history": session_history,
        "total_credits": float(student.get("total_credits", 0)),
        "knowledge_points": {
            pos.get("capsule_name", ""): kp,
        } if pos.get("capsule_name") else {},
        "interactions": [],
        "recall_assessment": {
            "needed": False,
            "last_recall": None,
            "days_since_last_session": 0,
        },
    }
    return json.dumps(progress, indent=2)


def _get_position_from_report_card(report_card, subject_name):
    """Look up current_position from report_card for a given subject.

    The root-level ``current_position`` is the most recently picked / saved
    position across all subjects, so we only honor it when its ``subject_id``
    matches the subject the caller asked for. Otherwise a stale write (e.g.
    from the previous Chemistry session) would pin the student to that
    capsule whenever they navigate to a different subject — see the
    ``e0513c72-…`` bug.

    Returns the position dict or None if not found for this subject.
    """
    subject_row = database.get_subject_by_name(subject_name)
    subject_key = str(subject_row["id"]) if subject_row else None

    top_pos = report_card.get("current_position")
    if (
        top_pos
        and isinstance(top_pos, dict)
        and top_pos.get("capsule_id")
        and subject_key
        and str(top_pos.get("subject_id") or "") == subject_key
    ):
        return top_pos

    # Per-subject current_position (also written by _save_progress).
    if not subject_key:
        return None
    subj_data = report_card.get(subject_key, {})
    if not isinstance(subj_data, dict):
        return None
    return subj_data.get("current_position")


def _build_knowledge_points_from_report_card(report_card, capsule_db_id, all_facts):
    """Build the knowledge_points dict for a single capsule from report_card JSONB.

    If the capsule has a persisted session_state (from crash recovery), restore
    the exact state machine snapshot. Otherwise, reconstruct from fact flags.
    """
    # Check for persisted session_state first (exact restore from cold storage)
    rc_cap = database.get_capsule_from_report_card(report_card, capsule_db_id)
    ss = rc_cap.get("session_state") if rc_cap else None

    if ss:
        # Exact restore — all state machine fields preserved
        result = {
            "facts_taught": ss.get("facts_taught", []),
            "facts_assessed": ss.get("facts_assessed", []),
            "facts_mastered": ss.get("facts_mastered", []),
            "fact_exposures": ss.get("fact_exposures", {}),
            "fact_steps": ss.get("fact_steps", {}),
            "current_fact": ss.get("current_fact"),
            "current_fact_index": ss.get("current_fact_index", 0),
            "total_facts": len(all_facts),
            # Batch state
            "batch_index": ss.get("batch_index", 0),
            "batch_step": ss.get("batch_step", "TEACH_TRY"),
            "batches": ss.get("batches", []),
            "check_queue": ss.get("check_queue", []),
            "check_failures": ss.get("check_failures", []),
            # Evidence state — None means "not initialized yet" (key must be absent)
            "evidence_passed": ss.get("evidence_passed", []),
            "evidence_failures": ss.get("evidence_failures", []),
            "evidence_fail_count": ss.get("evidence_fail_count", 0),
        }
        # Only include evidence_queue if it was actually set (not None).
        # The state machine uses "evidence_queue" not in kp as a sentinel
        # to trigger _init_evidence_queue() on re-entry.
        eq = ss.get("evidence_queue")
        if eq is not None:
            result["evidence_queue"] = eq
        return result

    # Legacy fallback: reconstruct from fact flags (lossy)
    facts_taught = []
    facts_assessed = []
    facts_mastered = []
    fact_exposures = {}
    current_fact = None
    current_fact_index = 0

    # Build a map of fact_id -> fact_text from all_facts
    id_to_text = {str(f["id"]): f["fact_text"] for f in all_facts}

    # Find the capsule in report_card
    rc_facts = database.get_fact_progress_from_report_card(report_card, capsule_db_id)
    mastered_set = set()
    for fp in rc_facts:
        text = id_to_text.get(fp["fact_id"])
        if not text:
            continue
        if fp.get("is_taught"):
            facts_taught.append(text)
        if fp.get("is_assessed"):
            facts_assessed.append(text)
        if fp.get("is_mastered"):
            facts_mastered.append(text)
            mastered_set.add(text)
        fact_exposures[text] = fp.get("exposure_count", 0)

    # Find current (next unmastered) fact
    for i, f in enumerate(all_facts):
        if f["fact_text"] not in mastered_set:
            current_fact = f["fact_text"]
            current_fact_index = i
            break
    else:
        if all_facts:
            current_fact = all_facts[-1]["fact_text"]
            current_fact_index = len(all_facts) - 1

    # Reconstruct fact_steps from report_card so batch state survives
    # across sessions.  Without this, taught-but-not-assessed facts lose
    # their BATCH_READY status and the batch scanner re-starts them.
    fact_steps = {}
    mastered_set_rc = set(facts_mastered)
    taught_set_rc = set(facts_taught)
    for f in all_facts:
        text = f["fact_text"]
        fc = f.get("fact_cycle") or ["TEACH", "TRY"]
        if text in mastered_set_rc:
            fact_steps[text] = {"sub_step": "ASSESSED", "cycle_index": len(fc), "resets": 0}
        elif text in taught_set_rc:
            # Taught (and maybe assessed) but not mastered -> completed
            # cycle, waiting for CHECK or already passed CHECK.
            fact_steps[text] = {"sub_step": "BATCH_READY", "cycle_index": len(fc), "resets": 0}

    return {
        "facts_taught": facts_taught,
        "facts_assessed": facts_assessed,
        "facts_mastered": facts_mastered,
        "fact_exposures": fact_exposures,
        "fact_steps": fact_steps,
        "current_fact": current_fact,
        "current_fact_index": current_fact_index,
        "total_facts": len(all_facts),
    }


def update_student_progress(
    student_id: str,
    curriculum_capsule_id: str = None,
    mastery_level: str = None,
    step: int = None,
    credits_earned: float = None,
) -> str:
    """Update student progress in DB."""
    student = database.get_student(student_id)
    if not student:
        return json.dumps({"error": f"Student {student_id} not found"})

    fields = {}

    if credits_earned:
        fields["total_credits"] = float(student.get("total_credits", 0)) + credits_earned

    fields["last_session"] = datetime.utcnow()

    if fields:
        database.update_student_position(student_id, **fields)

    return get_student_progress(student_id)


def record_session(
    student_id: str,
    capsule_name: str,
    duration_minutes: int,
    questions_answered: int,
    correct_answers: int,
) -> str:
    """Record a session summary. (Sessions are now tracked in sessions table.)"""
    accuracy = round(correct_answers / questions_answered * 100, 1) if questions_answered > 0 else 0
    return json.dumps({
        "date": datetime.utcnow().isoformat(),
        "capsule": capsule_name,
        "duration_minutes": duration_minutes,
        "questions_answered": questions_answered,
        "correct_answers": correct_answers,
        "accuracy": accuracy,
    }, indent=2)


def check_recall_needed(student_id: str) -> str:
    """Check if recall assessment is needed based on time since last session."""
    student = database.get_student(student_id)
    if not student:
        return json.dumps({"recall_needed": False, "reason": "New student"})

    if not student.get("last_session"):
        return json.dumps({"recall_needed": False, "reason": "First session"})

    last_session = student["last_session"]
    days_since = (datetime.utcnow() - last_session.replace(tzinfo=None)).days
    recall_needed = days_since >= 3

    return json.dumps({
        "recall_needed": recall_needed,
        "days_since_last_session": days_since,
        "last_capsule": student.get("capsule_name", ""),
        "reason": f"{'Recall needed - ' if recall_needed else ''}{days_since} days since last session",
    }, indent=2)


def get_next_capsule(current_capsule_id: str) -> str:
    """Get the next capsule in sequence. Accepts UUID string."""
    next_row = database.get_next_capsule(current_capsule_id)
    if next_row:
        return json.dumps({
            "next_capsule_id": str(next_row["id"]),
            "next_capsule_name": next_row["name"],
        })
    return json.dumps({
        "next_capsule_id": None,
        "message": "Curriculum completed!",
    })


if __name__ == "__main__":
    print("=== Get Student Progress (student_001) ===")
    progress = get_student_progress("student_001")
    print(progress)
    print("\n=== Check Recall ===")
    print(check_recall_needed("student_001"))
    # To test get_next_capsule, extract the UUID from progress
    p = json.loads(progress)
    cap_id = p.get("current_position", {}).get("curriculum_capsule_id")
    if cap_id:
        print(f"\n=== Next Capsule from {cap_id} ===")
        print(get_next_capsule(cap_id))
