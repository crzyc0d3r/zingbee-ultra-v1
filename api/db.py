"""Central database access layer for ZingBee RT Studio.

All SQL queries live here. Uses psycopg2 with RealDictCursor for dict rows.
Connection-per-query pattern (simple, sync, matches existing codebase).
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from string import Template

import psycopg2
import psycopg2.extras
import psycopg2.pool

log = logging.getLogger(__name__)

# One-time warning latch: set when save_learning_session_message has to fall back to the
# pre-A3 insert because migration db/011 hasn't been applied (silent attribution loss).
_ATTRIBUTION_FALLBACK_WARNED = False

DB_CONFIG = dict(
    host=os.environ.get("DB_HOST", "localhost"),
    port=int(os.environ.get("DB_PORT", "5432")),
    dbname=os.environ.get("DB_NAME", "zingbee-ultra"),
    user=os.environ.get("DB_USER", "postgres"),
)

# Only include password in config if explicitly set (trust auth needs no password)
_db_password = os.environ.get("DB_PASSWORD")
if _db_password is not None:
    DB_CONFIG["password"] = _db_password

# Connection pool: reuses TCP connections instead of opening a new one per query.
# minconn=2 keeps idle connections warm, maxconn=20 caps concurrent usage.
_pool = psycopg2.pool.ThreadedConnectionPool(
    minconn=2,
    maxconn=20,
    cursor_factory=psycopg2.extras.RealDictCursor,
    **DB_CONFIG,
)


class _PooledConn:
    """Wrapper that returns the connection to the pool on close() instead of destroying it."""

    __slots__ = ("_conn", "_pool_ref")

    def __init__(self, conn, pool):
        self._conn = conn
        self._pool_ref = pool

    def cursor(self, *a, **kw):
        return self._conn.cursor(*a, **kw)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        if self._conn is not None:
            try:
                self._pool_ref.putconn(self._conn)
            except Exception:
                try:
                    self._conn.close()
                except Exception:
                    pass
            self._conn = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def get_conn():
    """Get a pooled connection. Call conn.close() to return it to the pool."""
    return _PooledConn(_pool.getconn(), _pool)


# Trace helpers — wrap every query helper so jsonPayload in Cloud Logging
# carries op, latency, sql preview, and row count for every DB hit.
#
# INSTRUMENTATION INVARIANT: this helper must never raise. A trace failure
# must not surface as a query failure. The query helpers below call this
# AFTER the work that returns rows has succeeded, and treat any exception
# here as a no-op.
def _trace_query(op: str, sql: str, params, start_ts, rows: int = None, error: str = None):
    try:
        from trace_logging import event as _ev
        import time as _t, logging as _lg
        duration_ms = int((_t.time() - start_ts) * 1000)
        # Compact the SQL for the log — strip leading whitespace, collapse runs.
        compact_sql = " ".join((sql or "").split())[:500]
        _ev("db.query" if not error else "db.query_error",
            level=(_lg.ERROR if error else _lg.INFO),
            op=op, duration_ms=duration_ms,
            sql=compact_sql,
            param_count=(len(params) if params else 0),
            rows=rows, error=error)
    except Exception:
        pass  # best-effort — instrumentation must never break the query path


def fetchone(sql, params=()):
    import time as _t
    _start = _t.time()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
        _trace_query("fetchone", sql, params, _start, rows=(1 if row else 0))
        return row
    except Exception as e:
        _trace_query("fetchone", sql, params, _start, error=str(e))
        raise
    finally:
        conn.close()


def fetchall(sql, params=()):
    import time as _t
    _start = _t.time()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        _trace_query("fetchall", sql, params, _start, rows=len(rows) if rows else 0)
        return rows
    except Exception as e:
        _trace_query("fetchall", sql, params, _start, error=str(e))
        raise
    finally:
        conn.close()


def execute(sql, params=()):
    import time as _t
    _start = _t.time()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            affected = cur.rowcount
        conn.commit()
        _trace_query("execute", sql, params, _start, rows=affected)
    except Exception as e:
        conn.rollback()
        _trace_query("execute", sql, params, _start, error=str(e))
        raise
    finally:
        conn.close()


def execute_returning(sql, params=()):
    import time as _t
    _start = _t.time()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
        conn.commit()
        _trace_query("execute_returning", sql, params, _start, rows=(1 if row else 0))
        return row
    except Exception as e:
        conn.rollback()
        _trace_query("execute_returning", sql, params, _start, error=str(e))
        raise
    finally:
        conn.close()


def execute_count(sql, params=()):
    """Execute a write query and return the affected-row count (cur.rowcount)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            n = cur.rowcount
        conn.commit()
        return n
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Curriculum queries
# ---------------------------------------------------------------------------

def get_capsule_by_name(name):
    """Get capsule row by name, joining theme and subject_curriculum for phase + age_range."""
    return fetchone("""
        SELECT cc.*, ct.name AS theme_name, ct.theme_order, ct.id AS theme_db_id,
               sc.phase, sc.age_range
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        WHERE cc.name = %s
    """, (name,))


def get_capsule_by_id(curriculum_capsule_id):
    """Get capsule row by PK (UUID)."""
    return fetchone("""
        SELECT cc.*, ct.name AS theme_name, ct.theme_order, ct.id AS theme_db_id,
               sc.phase, sc.age_range
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        WHERE cc.id = %s
    """, (curriculum_capsule_id,))



def get_core_facts(curriculum_capsule_id):
    """Get all facts for a capsule, ordered by fact order."""
    return fetchall("""
        SELECT id, "order" AS fact_order, meta_data->>'core_fact' AS fact_text,
               meta_data AS fact,
               COALESCE((meta_data->>'difficulty_weight')::float, 0.5) AS difficulty_weighting,
               meta_data->'scaffold' AS fact_cycle
        FROM curriculum_facts
        WHERE curriculum_capsule_id = %s
        ORDER BY "order"
    """, (curriculum_capsule_id,))


def get_next_capsule(current_capsule_id):
    """Get the next capsule in order, scoped to the same subject.

    Uses (phase, theme_order, capsule_order) for sequencing instead of integer IDs.
    """
    return fetchone("""
        WITH cur AS (
            SELECT sc.subject_id, sc.phase, ct.theme_order, cc.capsule_order
            FROM curriculum_capsules cc
            JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
            JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
            WHERE cc.id = %s
        )
        SELECT cc.*, ct.name AS theme_name, ct.theme_order, ct.id AS theme_db_id,
               sc.phase, sc.age_range
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        CROSS JOIN cur
        WHERE sc.subject_id = cur.subject_id
          AND (sc.phase, ct.theme_order, cc.capsule_order)
              > (cur.phase, cur.theme_order, cur.capsule_order)
        ORDER BY sc.phase, ct.theme_order, cc.capsule_order
        LIMIT 1
    """, (current_capsule_id,))


def get_curriculum_overview(phase, subject_name=None):
    """Get subject_curriculum row for a phase, optionally filtered by subject."""
    if subject_name:
        return fetchone("""
            SELECT sc.*, s.name AS subject_name
            FROM subject_curriculum sc
            JOIN subjects s ON sc.subject_id = s.id
            WHERE sc.phase = %s AND s.name = %s
        """, (phase, subject_name))
    return fetchone("""
        SELECT sc.*, s.name AS subject_name
        FROM subject_curriculum sc
        JOIN subjects s ON sc.subject_id = s.id
        WHERE sc.phase = %s
    """, (phase,))


def list_all_capsules(phase=None, subject_name=None):
    """List capsules with theme info, optionally filtered by phase and/or subject."""
    conditions = []
    params = []
    if phase is not None:
        conditions.append("sc.phase = %s")
        params.append(phase)
    if subject_name:
        conditions.append("s.name = %s")
        params.append(subject_name)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return fetchall(f"""
        SELECT cc.id, cc.capsule_order, cc.name,
               ct.id AS theme_db_id, ct.name AS theme_name, ct.theme_order, sc.phase
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        {where}
        ORDER BY sc.phase, ct.theme_order, cc.capsule_order
    """, tuple(params))


def get_mastery_levels(phase, subject_name=None):
    """Get mastery_levels for a phase. Column removed from schema; returns None."""
    return None


def get_learning_steps(phase, subject_name=None):
    """Get learning_steps for a phase. Column removed from schema; returns None."""
    return None



def get_themes_for_phase(phase):
    """Get all themes for a phase."""
    return fetchall("""
        SELECT ct.id, ct.theme_order, ct.name, ct.guiding_question
        FROM curriculum_themes ct
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        WHERE sc.phase = %s
        ORDER BY ct.theme_order
    """, (phase,))


def get_subject_by_name(name):
    """Get subject row by name."""
    return fetchone("SELECT * FROM subjects WHERE name = %s", (name,))


def get_first_capsule_for_subject(subject_name):
    """Get the first capsule for a given subject (by phase, theme_order, capsule_order)."""
    return fetchone("""
        SELECT cc.*, ct.name AS theme_name, ct.theme_order, ct.id AS theme_db_id, sc.phase
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        WHERE s.name = %s
        ORDER BY sc.phase, ct.theme_order, cc.capsule_order
        LIMIT 1
    """, (subject_name,))


def get_themes_for_phase_and_subject(phase, subject_name=None):
    """Get all themes for a phase, optionally filtered by subject."""
    if subject_name:
        return fetchall("""
            SELECT ct.id, ct.theme_order, ct.name, ct.guiding_question
            FROM curriculum_themes ct
            JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
            JOIN subjects s ON sc.subject_id = s.id
            WHERE sc.phase = %s AND s.name = %s
            ORDER BY ct.theme_order
        """, (phase, subject_name))
    return fetchall("""
        SELECT ct.id, ct.theme_order, ct.name, ct.guiding_question
        FROM curriculum_themes ct
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        WHERE sc.phase = %s
        ORDER BY ct.theme_order
    """, (phase,))


# ---------------------------------------------------------------------------
# Student queries
# ---------------------------------------------------------------------------

def get_student(student_id):
    """Get student row by ID, with first_name/last_name from users."""
    return fetchone("""
        SELECT st.*, u.first_name, u.last_name
        FROM students st
        LEFT JOIN users u ON st.user_id = u.id
        WHERE st.student_id = %s
    """, (student_id,))


def create_student(user_id):
    """Create a new student with auto-generated UUID student_id."""
    return execute_returning("""
        INSERT INTO students (user_id)
        VALUES (%s)
        RETURNING *
    """, (user_id,))


def update_student_position(student_id, **fields):
    """Dynamic SET for non-None fields on students table."""
    allowed = {
        "last_session", "total_credits",
    }
    sets = []
    vals = []
    for k, v in fields.items():
        if k in allowed and v is not None:
            sets.append(f"{k} = %s")
            vals.append(v)
    if not sets:
        return
    vals.append(student_id)
    execute(f"UPDATE students SET {', '.join(sets)} WHERE student_id = %s", tuple(vals))


# ---------------------------------------------------------------------------
# Report card helpers (hierarchical JSONB on students table)
# ---------------------------------------------------------------------------

def get_report_card(student_id):
    """Read the full report_card JSONB for a student."""
    row = fetchone("SELECT report_card FROM students WHERE student_id = %s", (student_id,))
    return (row.get("report_card") or {}) if row else {}


def save_report_card(student_id, report_card):
    """Atomic write of the entire report_card JSONB."""
    execute(
        "UPDATE students SET report_card = %s WHERE student_id = %s",
        (json.dumps(report_card), student_id),
    )


def get_completed_capsules_from_report_card(report_card):
    """Extract flat list of completed capsules from a report_card dict.

    Returns list of dicts: [{capsule_id, completed_at, mastery_level, credits}, ...]
    """
    result = []
    for subj in report_card.values():
        for ph in subj.get("phases", {}).values():
            for th in ph.get("themes", {}).values():
                for cap_id, cap in th.get("capsules", {}).items():
                    if cap.get("status") == "completed":
                        result.append({
                            "capsule_id": cap_id,
                            "completed_at": cap.get("completed_at"),
                            "mastery_level": cap.get("mastery_level"),
                            "credits": cap.get("credits", 0),
                        })
    return result


def get_fact_progress_from_report_card(report_card, curriculum_capsule_id):
    """Extract fact progress for a specific capsule from report_card.

    Returns list of dicts with per-fact progress data:
    [{fact_id, is_taught, is_assessed, is_mastered, exposure_count, correct_count, incorrect_count}, ...]
    """
    capsule_id = str(curriculum_capsule_id)
    for subj in report_card.values():
        for ph in subj.get("phases", {}).values():
            for th in ph.get("themes", {}).values():
                cap = th.get("capsules", {}).get(capsule_id)
                if cap:
                    return [
                        {
                            "fact_id": fid,
                            "is_introduced": f.get("is_introduced", False),
                            "is_taught": f.get("is_taught", False),
                            "is_assessed": f.get("is_assessed", False),
                            "is_mastered": f.get("is_mastered", False),
                            "exposure_count": f.get("exposure_count", 0),
                            "correct_count": f.get("correct_count", 0),
                            "incorrect_count": f.get("incorrect_count", 0),
                        }
                        for fid, f in cap.get("facts", {}).items()
                    ]
    return []


def get_capsule_from_report_card(report_card, curriculum_capsule_id):
    """Find and return the capsule dict from report_card by capsule ID.

    Returns the capsule dict reference, or None if not found.
    """
    if not curriculum_capsule_id:
        return None
    capsule_id = str(curriculum_capsule_id)
    for subj in report_card.values():
        if not isinstance(subj, dict):
            continue
        for ph in subj.get("phases", {}).values():
            for th in ph.get("themes", {}).values():
                cap = th.get("capsules", {}).get(capsule_id)
                if cap:
                    return cap
    return None


def ensure_report_card_path(report_card, subject_id, phase, theme_id, capsule_id):
    """Ensure the full hierarchy path exists in report_card, creating empty nodes as needed.

    Returns the capsule dict reference.
    """
    subject_id, phase, theme_id, capsule_id = str(subject_id), str(phase), str(theme_id), str(capsule_id)
    if subject_id not in report_card:
        report_card[subject_id] = {
            "total_capsules": 0, "completed_capsules": 0,
            "total_facts": 0, "mastered_facts": 0,
            "total_exposures": 0, "total_credits": 0,
            "phases": {},
        }
    subj = report_card[subject_id]
    subj.setdefault("phases", {})
    if phase not in subj["phases"]:
        subj["phases"][phase] = {
            "total_capsules": 0, "completed_capsules": 0,
            "total_facts": 0, "mastered_facts": 0,
            "themes": {},
        }
    ph = subj["phases"][phase]
    if theme_id not in ph["themes"]:
        ph["themes"][theme_id] = {
            "total_capsules": 0, "completed_capsules": 0,
            "total_facts": 0, "mastered_facts": 0,
            "capsules": {},
        }
    th = ph["themes"][theme_id]
    if capsule_id not in th["capsules"]:
        th["capsules"][capsule_id] = {
            "status": "not_started",
            "completed_at": None,
            "mastery_level": None,
            "credits": 0,
            "total_facts": 0,
            "taught_count": 0, "assessed_count": 0, "mastered_count": 0,
            "total_exposures": 0, "total_correct": 0, "total_incorrect": 0,
            "facts": {},
            "passed_facts": {},     # fact_id -> {step, at, question} (one per fact, latest pass)
            "failed_attempts": [],  # [{fact_id, step, at, question, student_answer}, ...] (many per fact)
        }
    return th["capsules"][capsule_id]


def recompute_report_card_rollups(report_card):
    """Recompute all rollup stats in report_card from leaf (capsule) data upward."""
    for subject_id, subj in report_card.items():
        if subject_id == "current_position":
            continue  # Skip top-level position metadata
        s_caps = s_comp = s_facts = s_taught = s_assessed = s_mast = s_exp = 0
        s_credits = 0.0
        for phase_key, ph in subj.get("phases", {}).items():
            p_caps = p_comp = p_facts = p_taught = p_assessed = p_mast = 0
            for theme_id, th in ph.get("themes", {}).items():
                t_caps = t_comp = t_facts = t_taught = t_assessed = t_mast = 0
                for cap_id, cap in th.get("capsules", {}).items():
                    facts = cap.get("facts", {})
                    t_caps += 1
                    cap["total_facts"] = len(facts)
                    cap["taught_count"] = sum(1 for f in facts.values() if f.get("is_taught"))
                    cap["assessed_count"] = sum(1 for f in facts.values() if f.get("is_assessed"))
                    cap["mastered_count"] = sum(1 for f in facts.values() if f.get("is_mastered"))
                    cap["total_exposures"] = sum(f.get("exposure_count", 0) for f in facts.values())
                    cap["total_correct"] = sum(f.get("correct_count", 0) for f in facts.values())
                    cap["total_incorrect"] = sum(f.get("incorrect_count", 0) for f in facts.values())
                    if cap.get("status") == "completed":
                        t_comp += 1
                    elif cap["taught_count"] > 0:
                        cap["status"] = "in_progress"
                    t_facts += cap["total_facts"]
                    t_taught += cap["taught_count"]
                    t_assessed += cap["assessed_count"]
                    t_mast += cap["mastered_count"]
                    s_exp += cap["total_exposures"]
                    s_credits += cap.get("credits", 0)
                th["total_capsules"] = t_caps
                th["completed_capsules"] = t_comp
                th["total_facts"] = t_facts
                th["taught_facts"] = t_taught
                th["assessed_facts"] = t_assessed
                th["mastered_facts"] = t_mast
                p_caps += t_caps; p_comp += t_comp; p_facts += t_facts
                p_taught += t_taught; p_assessed += t_assessed; p_mast += t_mast
            ph["total_capsules"] = p_caps
            ph["completed_capsules"] = p_comp
            ph["total_facts"] = p_facts
            ph["taught_facts"] = p_taught
            ph["assessed_facts"] = p_assessed
            ph["mastered_facts"] = p_mast
            s_caps += p_caps; s_comp += p_comp; s_facts += p_facts
            s_taught += p_taught; s_assessed += p_assessed; s_mast += p_mast
        subj["total_capsules"] = s_caps
        subj["completed_capsules"] = s_comp
        subj["total_facts"] = s_facts
        subj["taught_facts"] = s_taught
        subj["assessed_facts"] = s_assessed
        subj["mastered_facts"] = s_mast
        subj["total_exposures"] = s_exp
        subj["total_credits"] = round(s_credits, 2)


def reset_student(student_id):
    """Reset student progress and learning sessions."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM learning_session_feedback WHERE learning_session_id IN (SELECT id FROM learning_sessions WHERE student_id = %s)", (student_id,))
            cur.execute("DELETE FROM learning_session_messages WHERE learning_session_id IN (SELECT id FROM learning_sessions WHERE student_id = %s)", (student_id,))
            cur.execute("DELETE FROM learning_sessions WHERE student_id = %s", (student_id,))
            cur.execute("""
                UPDATE students SET
                    last_session = NULL, total_credits = 0,
                    report_card = '{}'
                WHERE student_id = %s
            """, (student_id,))
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Session queries
# ---------------------------------------------------------------------------

def create_session(user_id, student_id, curriculum_capsule_id, tutor_id=None):
    """Create a new session row, returns the row with id."""
    return execute_returning("""
        INSERT INTO learning_sessions (user_id, student_id, curriculum_capsule_id, start_time, tutor_id)
        VALUES (%s, %s, %s, NOW(), %s)
        RETURNING *
    """, (user_id, student_id, curriculum_capsule_id, tutor_id))


def flush_session_progress(learning_session_id, execution_log=None, system_log=None,
                           tokens=None, questions=None, correct=None, facts_taught=None,
                           duration=None, accuracy=None, fact_interactions=None):
    """Flush in-progress session data to the DB so session viewers can see live data."""
    execute("""
        UPDATE learning_sessions SET
            execution_log = %s,
            system_log = %s,
            total_tokens = %s,
            questions_asked = %s,
            correct_answers = %s,
            facts_taught_count = %s,
            duration_seconds = %s,
            accuracy = %s,
            fact_interactions = %s
        WHERE id = %s
    """, (json.dumps(execution_log) if execution_log else "[]",
          json.dumps(system_log) if system_log else "[]",
          tokens, questions, correct, facts_taught,
          duration, accuracy,
          json.dumps(fact_interactions) if fact_interactions else "[]",
          learning_session_id))


def end_session_db(learning_session_id, duration=None, questions=None, correct=None,
                   tokens=None, facts_taught=None, accuracy=None, execution_log=None,
                   fact_interactions=None, system_log=None):
    """Finalize a session row."""
    execute("""
        UPDATE learning_sessions SET
            end_time = NOW(),
            duration_seconds = %s,
            questions_asked = %s,
            correct_answers = %s,
            total_tokens = %s,
            facts_taught_count = %s,
            accuracy = %s,
            execution_log = %s,
            fact_interactions = %s,
            system_log = %s
        WHERE id = %s
    """, (duration, questions, correct, tokens, facts_taught, accuracy,
          json.dumps(execution_log) if execution_log else "[]",
          json.dumps(fact_interactions) if fact_interactions else "[]",
          json.dumps(system_log) if system_log else "[]",
          learning_session_id))


def save_learning_session_message(learning_session_id, role, content,
                                  prompt_id=None, template_hash=None, model=None):
    """Save a chat message to the DB and return the new message ID.

    prompt_id / template_hash / model are per-turn attribution (A3): template_hash joins
    to prompt_versions.content_hash. Falls back to the base insert if the attribution columns
    aren't present yet, so a forgotten migration never breaks the message-save hot path.
    """
    try:
        row = execute_returning("""
            INSERT INTO learning_session_messages
                (learning_session_id, role, content, prompt_id, template_hash, model)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (learning_session_id, role, content, prompt_id, template_hash, model))
    except psycopg2.errors.UndefinedColumn:
        global _ATTRIBUTION_FALLBACK_WARNED
        if not _ATTRIBUTION_FALLBACK_WARNED:
            _ATTRIBUTION_FALLBACK_WARNED = True
            log.warning("learning_session_messages missing A3 attribution columns "
                        "(prompt_id/template_hash/model) — migration db/011 not applied. "
                        "Saving messages WITHOUT attribution until it runs.")
        row = execute_returning("""
            INSERT INTO learning_session_messages (learning_session_id, role, content)
            VALUES (%s, %s, %s)
            RETURNING id
        """, (learning_session_id, role, content))
    return str(row["id"]) if row else None


def replace_image_url_in_session(learning_session_id, old_url, new_url):
    """Replace an expired image URL with a local URL in execution_log and learning_session_messages."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # Replace in execution_log JSONB (text-level replace across the whole JSON)
            cur.execute("""
                UPDATE learning_sessions
                SET execution_log = REPLACE(execution_log::text, %s, %s)::jsonb
                WHERE id = %s AND execution_log IS NOT NULL
            """, (old_url, new_url, learning_session_id))
            # Replace in learning_session_messages content (REPLACE is a no-op on non-matching rows)
            cur.execute("""
                UPDATE learning_session_messages
                SET content = REPLACE(content, %s, %s)
                WHERE learning_session_id = %s
            """, (old_url, new_url, learning_session_id))
        conn.commit()
    except Exception as e:
        conn.rollback()
        log.warning("Failed to replace image URL in session %s: %s", learning_session_id, e)
    finally:
        conn.close()


def get_recent_sessions(student_id, limit=5):
    """Get recent session rows for a student."""
    return fetchall("""
        SELECT s.*, cc.name AS capsule_name
        FROM learning_sessions s
        LEFT JOIN curriculum_capsules cc ON s.curriculum_capsule_id = cc.id
        WHERE s.student_id = %s
        ORDER BY s.start_time DESC
        LIMIT %s
    """, (student_id, limit))


def get_latest_session_for_student(student_id):
    """Return the most recent learning_sessions row for a student (any state),
    joined to curriculum_capsules for capsule_name. None if no rows.

    Used by SessionState rehydration: when the in-memory session cache is
    empty (e.g. after a server restart) we look up the most recent session
    row and rebuild a SessionState from DB."""
    return fetchone("""
        SELECT s.*, cc.name AS capsule_name
        FROM learning_sessions s
        LEFT JOIN curriculum_capsules cc ON s.curriculum_capsule_id = cc.id
        WHERE s.student_id = %s
        ORDER BY s.start_time DESC
        LIMIT 1
    """, (student_id,))


def get_session_messages_by_session_id(learning_session_id):
    """Return all messages for a learning session in chronological order."""
    return fetchall("""
        SELECT id, role, content, created_date
        FROM learning_session_messages
        WHERE learning_session_id = %s
        ORDER BY created_date, id
    """, (learning_session_id,))


def get_idle_active_sessions(idle_minutes=10):
    """Return active learning sessions whose latest activity is older than
    ``idle_minutes``. Activity is the max(message.created_date) for the
    session, falling back to the session's start_time when no messages exist
    yet (e.g. a session opened but the student never typed).

    Used by the AFK sweeper to auto-end sessions where the student walked
    away. Returns rows with id, student_id, last_activity, start_time."""
    return fetchall("""
        SELECT s.id, s.student_id, s.start_time,
               COALESCE(MAX(m.created_date), s.start_time) AS last_activity
        FROM learning_sessions s
        LEFT JOIN learning_session_messages m
            ON m.learning_session_id = s.id
        WHERE s.end_time IS NULL
        GROUP BY s.id, s.student_id, s.start_time
        HAVING COALESCE(MAX(m.created_date), s.start_time)
               < NOW() - (%s || ' minutes')::interval
    """, (idle_minutes,))


def end_session_idle(learning_session_id):
    """Mark a session as ended due to inactivity. Sets end_time = NOW() and
    fills duration_seconds based on start_time. Only touches sessions that
    are still active (end_time IS NULL) so this is safe against races with
    a concurrent end_session_db call."""
    execute("""
        UPDATE learning_sessions
        SET end_time = NOW(),
            duration_seconds = COALESCE(
                duration_seconds,
                EXTRACT(EPOCH FROM (NOW() - start_time))::int
            )
        WHERE id = %s AND end_time IS NULL
    """, (learning_session_id,))


# ---------------------------------------------------------------------------
# Tutor / Learning System queries (v6 architecture)
# ---------------------------------------------------------------------------

def get_session_context(capsule_id):
    """Load the full session context for a capsule in a single query.

    Joins capsule -> theme -> curriculum -> subject -> tutor -> schema.
    Returns dict with all curriculum vars, persona, and decision_tree.
    """
    row = fetchone("""
        SELECT s.name AS subject_name, s.id AS subject_id,
               sc.age_range, sc.phase,
               ct.name AS theme_name, ct.tutor_id, ct.learning_system_id,
               cc.name AS capsule_name, cc.id AS capsule_id,
               t.persona,
               ls.descision_tree AS decision_tree
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        LEFT JOIN tutors t ON ct.tutor_id = t.id
        LEFT JOIN learning_system_schemas ls ON ct.learning_system_id = ls.id
        WHERE cc.id = %s
    """, (capsule_id,))
    if not row:
        return None
    result = dict(row)
    result["persona"] = result.get("persona") or {}
    result["decision_tree"] = result.get("decision_tree") or {}
    return result


def get_capsule_facts(capsule_id):
    """Load all facts for a capsule, ordered. Each row has id, order, meta_data."""
    return fetchall("""
        SELECT id, "order", meta_data
        FROM curriculum_facts
        WHERE curriculum_capsule_id = %s
        ORDER BY "order"
    """, (capsule_id,))


def get_subject_config(subject_name):
    """Get subject config via the v6 query chain (tutors + curriculum)."""
    return fetchone("""
        SELECT DISTINCT ON (s.name)
               s.id, s.name,
               t.persona->>'tutor_name' AS tutor_name,
               sc.age_range AS default_age_range,
               t.id AS tutor_id
        FROM subjects s
        JOIN subject_curriculum sc ON sc.subject_id = s.id
        JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
        JOIN tutors t ON ct.tutor_id = t.id
        WHERE s.name = %s
        ORDER BY s.name, sc.phase
    """, (subject_name,))


def list_subject_names():
    """Return list of subject names that have curriculum data."""
    rows = fetchall(
        "SELECT DISTINCT s.name FROM subjects s "
        "JOIN subject_curriculum sc ON sc.subject_id = s.id "
        "ORDER BY s.name")
    return [r["name"] for r in rows]


def get_tutor_persona(tutor_id):
    """Get tutor persona JSONB by tutor ID. Returns None if tutor not found."""
    row = fetchone("SELECT persona FROM tutors WHERE id = %s", (tutor_id,))
    if not row:
        return None
    return row.get("persona") or {}


def get_decision_tree(learning_system_id):
    """Get decision tree JSONB by learning system ID."""
    row = fetchone("SELECT descision_tree FROM learning_system_schemas WHERE id = %s",
                   (learning_system_id,))
    return row["descision_tree"] if row and row.get("descision_tree") else {}


def render_prompt(template_text, variables):
    """Render a $variable-style template with safe_substitute (unmatched vars left as-is)."""
    return Template(template_text).safe_substitute(variables)


def get_default_user():
    """Get the first admin/tester user."""
    return fetchone("SELECT * FROM users ORDER BY created_at LIMIT 1")


# ---------------------------------------------------------------------------
# Auth queries
# ---------------------------------------------------------------------------

def get_user(user_id):
    """Fetch a user by ID."""
    return fetchone("SELECT * FROM users WHERE id = %s", (user_id,))


def get_user_by_email(email):
    """Fetch an active user by email for login."""
    return fetchone(
        "SELECT * FROM users WHERE email = %s AND is_active = true",
        (email,),
    )


def get_user_by_identifier(identifier):
    """Fetch an active user by email or display_name for login.
    Prioritises exact email match, then display_name."""
    return fetchone(
        """SELECT * FROM users
           WHERE (email = %s OR display_name = %s) AND is_active = true
           ORDER BY (email = %s)::int DESC
           LIMIT 1""",
        (identifier, identifier, identifier),
    )


def get_students_for_user(user_id):
    """Fetch all students linked to a user, with first_name/last_name from users."""
    return fetchall(
        """SELECT st.*, u.first_name, u.last_name
           FROM students st
           LEFT JOIN users u ON st.user_id = u.id
           WHERE st.user_id = %s ORDER BY st.created_date""",
        (user_id,),
    )


def update_last_login(user_id):
    """Set last_login to NOW() for a user."""
    execute("UPDATE users SET last_login = NOW() WHERE id = %s", (user_id,))


# ---------------------------------------------------------------------------
# Auth session persistence (DB-backed)
# ---------------------------------------------------------------------------

def save_auth_session(token, user_id, student_id, students, display_name, email, expires):
    """Insert or update an auth session in the database."""
    execute("""
        INSERT INTO auth_sessions (token, user_id, students, display_name, email, expires_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (token) DO UPDATE SET
            students = EXCLUDED.students,
            display_name = EXCLUDED.display_name,
            email = EXCLUDED.email,
            expires_at = EXCLUDED.expires_at
    """, (token, user_id, json.dumps(students), display_name, email, expires))


def load_auth_session(token):
    """Load an auth session by token. Returns dict or None."""
    row = fetchone(
        "SELECT * FROM auth_sessions WHERE token = %s AND expires_at > NOW()",
        (token,),
    )
    if not row:
        return None
    students = row["students"] if isinstance(row["students"], list) else json.loads(row["students"])
    return {
        "user_id": str(row["user_id"]),
        "student_id": students[0]["student_id"] if students else None,
        "students": students,
        "display_name": row["display_name"],
        "email": row["email"],
        "expires": row["expires_at"],
    }


def delete_auth_session(token):
    """Remove an auth session by token."""
    execute("DELETE FROM auth_sessions WHERE token = %s", (token,))


def update_auth_session_field(token, field, value):
    """Update a single field on an auth session (e.g. student_id)."""
    allowed = {"students", "display_name", "email", "expires_at"}
    if field not in allowed:
        raise ValueError(f"Cannot update field: {field}")
    db_field = "expires_at" if field == "expires" else field
    execute(f"UPDATE auth_sessions SET {db_field} = %s WHERE token = %s", (value, token))


def cleanup_expired_sessions():
    """Delete expired auth sessions."""
    execute("DELETE FROM auth_sessions WHERE expires_at < NOW()")


# ---------------------------------------------------------------------------
# Feedback queries
# ---------------------------------------------------------------------------

def save_learning_session_feedback(learning_session_id, user_id, student_id, sentiment, comment,
                  message_index, message_text, context_messages,
                  execution_snapshot, session_stats):
    """Insert a feedback row and return it."""
    return execute_returning("""
        INSERT INTO learning_session_feedback
            (learning_session_id, user_id, student_id, sentiment, comment,
             message_index, message_text, context_messages,
             execution_snapshot, session_stats)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
    """, (learning_session_id, user_id, student_id, sentiment, comment,
          message_index, message_text,
          json.dumps(context_messages) if context_messages else None,
          json.dumps(execution_snapshot) if execution_snapshot else None,
          json.dumps(session_stats) if session_stats else None))


def get_learning_session_feedback(learning_session_id):
    """Fetch all feedback entries for a session, ordered by creation time."""
    return fetchall("""
        SELECT * FROM learning_session_feedback
        WHERE learning_session_id = %s
        ORDER BY created_date
    """, (learning_session_id,))


# ---------------------------------------------------------------------------
# Eval run queries
# ---------------------------------------------------------------------------


def get_capsule_scope(phase: int, theme_name: str, capsule_name: str, subject_name: str | None = None):
    """Resolve a capsule by phase/theme/capsule names (+ optional subject)."""
    conditions = [
        "sc.phase = %s",
        "ct.name = %s",
        "cc.name = %s",
    ]
    params: list = [phase, theme_name, capsule_name]
    if subject_name:
        conditions.append("s.name = %s")
        params.append(subject_name)

    where = " AND ".join(conditions)
    return fetchone(
        f"""
        SELECT
            cc.id AS capsule_id,
            cc.name AS capsule_name,
            ct.name AS theme_name,
            sc.phase,
            sc.age_range,
            s.name AS subject_name
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        WHERE {where}
        LIMIT 1
        """,
        tuple(params),
    )


def list_facts_for_capsule_scope(
    phase: int,
    theme_name: str,
    capsule_name: str,
    subject_name: str | None = None,
    fact_ids: list[str] | None = None,
):
    """Return all facts for one phase/theme/capsule scope (+ optional subject)."""
    conditions = [
        "sc.phase = %s",
        "ct.name = %s",
        "cc.name = %s",
    ]
    params: list = [phase, theme_name, capsule_name]
    if subject_name:
        conditions.append("s.name = %s")
        params.append(subject_name)
    if fact_ids:
        conditions.append("cf.id = ANY(%s::uuid[])")
        params.append(fact_ids)

    where = " AND ".join(conditions)
    return fetchall(
        f"""
        SELECT
            cf.id AS fact_id,
            cf.curriculum_capsule_id,
            cf."order" AS fact_order,
            cf.meta_data AS fact_meta,
            cf.meta_data->>'core_fact' AS fact_text,
            cc.name AS capsule_name,
            ct.name AS theme_name,
            sc.phase,
            sc.age_range,
            s.name AS subject_name
        FROM curriculum_facts cf
        JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        WHERE {where}
        ORDER BY cf."order"
        """,
        tuple(params),
    )


def get_curriculum_fact_images_row(fact_id: str):
    """Get curriculum_fact_images row by curriculum_fact_id."""
    return fetchone(
        "SELECT id, curriculum_fact_id, meta_data FROM curriculum_fact_images WHERE curriculum_fact_id = %s",
        (fact_id,),
    )


def ensure_curriculum_fact_images_row(fact_id: str):
    """Ensure a curriculum_fact_images row exists for the fact and return it."""
    return execute_returning(
        """
        INSERT INTO curriculum_fact_images (id, curriculum_fact_id, meta_data)
        VALUES (gen_random_uuid(), %s, ARRAY[]::jsonb[])
        ON CONFLICT (curriculum_fact_id) DO UPDATE
           SET curriculum_fact_id = EXCLUDED.curriculum_fact_id
        RETURNING id, curriculum_fact_id, meta_data
        """,
        (fact_id,),
    )


def set_curriculum_fact_images_meta(fact_id: str, variants: list[dict]):
    """Replace the meta_data jsonb[] payload from a Python list[dict]."""
    payload = json.dumps(variants)
    return execute_returning(
        """
        UPDATE curriculum_fact_images
           SET meta_data = (
               SELECT COALESCE(array_agg(elem), ARRAY[]::jsonb[])
               FROM jsonb_array_elements(%s::jsonb) elem
           )
         WHERE curriculum_fact_id = %s
         RETURNING id, curriculum_fact_id, meta_data
        """,
        (payload, fact_id),
    )


def append_curriculum_fact_image_variant(fact_id: str, variant: dict, *, dedup_key: str | None = None):
    """Append one image variant object to curriculum_fact_images.meta_data safely.

    If dedup_key is provided, skip append when an existing variant has the same
    combination_id. Returns None if deduplicated (no write).
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO curriculum_fact_images (id, curriculum_fact_id, meta_data)
                VALUES (gen_random_uuid(), %s, ARRAY[]::jsonb[])
                ON CONFLICT (curriculum_fact_id) DO NOTHING
                """,
                (fact_id,),
            )
            cur.execute(
                """
                SELECT id, curriculum_fact_id, meta_data
                FROM curriculum_fact_images
                WHERE curriculum_fact_id = %s
                FOR UPDATE
                """,
                (fact_id,),
            )
            row = cur.fetchone()
            variants = list((row or {}).get("meta_data") or [])
            # Dedup check: skip if a variant with the same combination_id exists
            if dedup_key:
                for existing in variants:
                    if existing.get("combination_id") == dedup_key:
                        conn.commit()
                        return None
            variants.append(variant)
            payload = json.dumps(variants)
            cur.execute(
                """
                UPDATE curriculum_fact_images
                   SET meta_data = (
                       SELECT COALESCE(array_agg(elem), ARRAY[]::jsonb[])
                       FROM jsonb_array_elements(%s::jsonb) elem
                   )
                 WHERE curriculum_fact_id = %s
                 RETURNING id, curriculum_fact_id, meta_data
                """,
                (payload, fact_id),
            )
            updated = cur.fetchone()
        conn.commit()
        return updated
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def list_curriculum_image_variants(
    *,
    subject_name: str | None = None,
    phase: int | None = None,
    theme_name: str | None = None,
    capsule_name: str | None = None,
    prompt_version: str | None = None,
    model: str | None = None,
    prompt_strategy: str | None = None,
    fact_id: str | None = None,
    variant_id: str | None = None,
    distillation_variant_id: str | None = None,
):
    """Flatten curriculum_fact_images.meta_data array into row-level variant records.

    Variant-level filters are applied in SQL via CROSS JOIN LATERAL unnest().
    """
    conditions = []
    params: list = []
    if phase is not None:
        conditions.append("sc.phase = %s")
        params.append(phase)
    if subject_name:
        conditions.append("s.name = %s")
        params.append(subject_name)
    if theme_name:
        conditions.append("ct.name = %s")
        params.append(theme_name)
    if capsule_name:
        conditions.append("cc.name = %s")
        params.append(capsule_name)
    if fact_id:
        conditions.append("cf.id = %s")
        params.append(fact_id)

    # Variant-level filters applied in SQL
    variant_conditions = []
    if variant_id:
        variant_conditions.append("v->>'id' = %s")
        params.append(str(variant_id))
    if prompt_version:
        variant_conditions.append("v->>'prompt_version' = %s")
        params.append(prompt_version)
    if model:
        variant_conditions.append("v->'generation'->>'model' = %s")
        params.append(model)
    if prompt_strategy:
        variant_conditions.append("v->>'prompt_strategy' = %s")
        params.append(prompt_strategy)
    if distillation_variant_id:
        variant_conditions.append("v->>'distillation_variant_id' = %s")
        params.append(distillation_variant_id)

    where_parts = conditions + variant_conditions
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    rows = fetchall(
        f"""
        SELECT
            cfi.curriculum_fact_id AS fact_id,
            cf."order" AS fact_order,
            cf.meta_data->>'core_fact' AS fact_text,
            cc.id AS capsule_id,
            cc.name AS capsule_name,
            ct.name AS theme_name,
            sc.phase,
            sc.age_range,
            s.name AS subject_name,
            v AS variant
        FROM curriculum_fact_images cfi
        JOIN curriculum_facts cf ON cfi.curriculum_fact_id = cf.id
        JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        CROSS JOIN LATERAL unnest(cfi.meta_data) AS v
        {where}
        ORDER BY sc.phase, ct.theme_order, cc.capsule_order, cf."order"
        """,
        tuple(params),
    )

    return [
        {
            "fact_id": str(row["fact_id"]),
            "fact_order": row["fact_order"],
            "fact_text": row["fact_text"] or "",
            "capsule_id": str(row["capsule_id"]),
            "capsule_name": row["capsule_name"],
            "theme_name": row["theme_name"],
            "phase": row["phase"],
            "age_range": row["age_range"],
            "subject_name": row["subject_name"],
            "variant": row["variant"],
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Capsule meta_data (sustained-metaphor home; future building_text_* fields)
# ---------------------------------------------------------------------------

def get_capsule_meta_data(capsule_id: str) -> dict:
    """Read curriculum_capsules.meta_data jsonb. Empty {} when unset."""
    row = fetchone(
        "SELECT meta_data FROM curriculum_capsules WHERE id = %s",
        (capsule_id,),
    )
    return (row.get("meta_data") or {}) if row else {}


def update_capsule_meta_data(capsule_id: str, mutator):
    """Atomic read-modify-write for curriculum_capsules.meta_data jsonb.

    `mutator` receives a fresh dict and must return the dict to persist.
    Uses SELECT ... FOR UPDATE to serialize concurrent metaphor-eval runs
    against the same capsule (proposer + reviewer can race otherwise).

    Defensive: explicitly forces autocommit=False on the pooled connection so
    the FOR UPDATE row lock is held until commit(). The pool returns
    autocommit=False by default, but a future code path that mutates a
    pooled conn into autocommit=True would silently break the invariant.
    """
    conn = get_conn()
    try:
        # Belt-and-suspenders: enforce the txn invariant the row lock depends on.
        if getattr(conn._conn, "autocommit", False):
            conn._conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(
                "SELECT meta_data FROM curriculum_capsules WHERE id = %s FOR UPDATE",
                (capsule_id,),
            )
            row = cur.fetchone()
            if row is None:
                conn.rollback()
                raise ValueError(f"Capsule {capsule_id} not found")
            current = dict(row.get("meta_data") or {})
            updated = mutator(current)
            if updated is None:
                updated = current
            cur.execute(
                "UPDATE curriculum_capsules SET meta_data = %s::jsonb WHERE id = %s",
                (json.dumps(updated), capsule_id),
            )
        conn.commit()
        return updated
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def list_capsules_with_metaphor_summary(subject_name: str | None = None, phase: int | None = None):
    """Light projection of capsules + just the metaphor + review-status fields.

    Used by /api/capsules and /api/coverage to avoid shipping the full
    meta_data JSONB (judge breakdowns + reasoning + sustained-examples) over
    the wire — the list endpoint hits all 500 capsules, so the payload
    difference is large (~70 KB/capsule with judge breakdowns vs ~200 bytes
    with just the projection).
    """
    conditions = []
    params: list = []
    if subject_name:
        conditions.append("s.name = %s")
        params.append(subject_name)
    if phase is not None:
        conditions.append("sc.phase = %s")
        params.append(phase)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return fetchall(
        f"""
        SELECT
            cc.id AS capsule_id,
            cc.name AS capsule_name,
            ct.name AS theme_name,
            sc.phase,
            sc.age_range,
            s.name AS subject_name,
            cc.meta_data->>'metaphor' AS metaphor,
            cc.meta_data->'metaphor_review'->>'status' AS review_status,
            cc.meta_data->'metaphor_review'->>'winner_run_id' AS winner_run_id,
            jsonb_array_length(COALESCE(cc.meta_data->'metaphor_proposals', '[]'::jsonb)) AS proposal_runs
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        {where}
        ORDER BY sc.phase, ct.theme_order, cc.capsule_order
        """,
        tuple(params),
    )


def reset_metaphor_eval_zombies(stale_after_minutes: int = 30) -> int:
    """Mark `metaphor_eval` eval_runs rows that have been 'running' for more
    than `stale_after_minutes` as 'failed'. Called once at API startup to
    clean up after process restarts; without this the UI shows phantom active
    jobs. Returns the number of rows reaped.

    Default lowered to 30 min (was 120) per pre-ship review pass-2 G5: metaphor jobs
    should finish well under that, and a tighter window means rolling-deploy
    double-runs get cleaned up faster.
    """
    return execute_count(
        """
        UPDATE eval_runs
           SET status = 'failed',
               completed_at = NOW(),
               error = 'zombie_reaped: process restart while job in flight'
         WHERE config LIKE 'metaphor_eval:%%'
           AND status = 'running'
           AND started_at < NOW() - (%s || ' minutes')::interval
        """,
        (str(stale_after_minutes),),
    )


# Cross-worker scope dedup via a dedicated eval_runs_locks table.
#
# Per-process in-memory dedup (`_running_scopes` set in metaphor_eval_routes)
# only works under a single uvicorn worker; production runs multiple workers,
# so two operators on different workers can both pass the in-process check
# and each kick off a 200-capsule batch — exactly the spend the dedup is
# trying to prevent.
#
# The eval_runs_locks table (db/009) gives us atomic INSERT ... ON CONFLICT
# semantics that survive across workers AND a process restart. We chose this
# over pg_advisory_lock because metaphor-eval jobs run for 30+ minutes and we
# don't want to hold a Postgres connection (and a pool slot) for that long.
# Crashed workers leave stale rows; reap_stale_scope_dedup() cleans them at
# startup with the same 30-min threshold as the eval_runs zombie reaper.
def acquire_scope_dedup(scope_key: str, job_id: str) -> bool:
    """Atomic in-flight dedup using INSERT ... ON CONFLICT.

    Inserts a row into the eval_runs_locks table; returns True on success,
    False if the scope is already held. Survives across uvicorn workers AND
    process restarts (cleanup is the zombie reaper's job).
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO eval_runs_locks (scope_key, job_id, created_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (scope_key) DO NOTHING
                RETURNING scope_key
                """,
                (scope_key, job_id),
            )
            row = cur.fetchone()
        conn.commit()
        return row is not None
    except psycopg2.errors.UndefinedTable:
        # Table not yet migrated — fall back to allowing the run (no dedup).
        # The cross-worker hardening lands when migration 009 is applied.
        conn.rollback()
        log.warning("eval_runs_locks table missing; cross-worker scope dedup is OFF")
        return True
    finally:
        conn.close()


def release_scope_dedup(scope_key: str) -> None:
    """Remove the in-flight marker for `scope_key`. Idempotent."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM eval_runs_locks WHERE scope_key = %s", (scope_key,))
        conn.commit()
    except psycopg2.errors.UndefinedTable:
        conn.rollback()
    except Exception:
        conn.rollback()
    finally:
        conn.close()


def reap_stale_scope_dedup(stale_after_minutes: int = 30) -> int:
    """Drop eval_runs_locks rows older than the threshold. Run at startup so
    a crashed worker doesn't permanently block its scope."""
    try:
        return execute_count(
            "DELETE FROM eval_runs_locks WHERE created_at < NOW() - (%s || ' minutes')::interval",
            (str(stale_after_minutes),),
        )
    except psycopg2.errors.UndefinedTable:
        return 0


def get_capsule_with_scope(capsule_id: str):
    """Resolve a capsule + theme + subject + phase + age_range by capsule UUID.

    Returns the same shape as get_capsule_scope (capsule_name/theme_name/phase/age_range/
    subject_name) so service code can take either lookup path uniformly.
    """
    return fetchone(
        """
        SELECT
            cc.id AS capsule_id,
            cc.name AS capsule_name,
            ct.name AS theme_name,
            sc.phase,
            sc.age_range,
            s.name AS subject_name
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        WHERE cc.id = %s
        LIMIT 1
        """,
        (capsule_id,),
    )


def list_capsules_with_scope(subject_name: str | None = None, phase: int | None = None):
    """List capsules joined with theme/subject scope, optionally filtered."""
    conditions = []
    params: list = []
    if subject_name:
        conditions.append("s.name = %s")
        params.append(subject_name)
    if phase is not None:
        conditions.append("sc.phase = %s")
        params.append(phase)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return fetchall(
        f"""
        SELECT
            cc.id AS capsule_id,
            cc.name AS capsule_name,
            ct.name AS theme_name,
            sc.phase,
            sc.age_range,
            s.name AS subject_name
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        {where}
        ORDER BY sc.phase, ct.theme_order, cc.capsule_order
        """,
        tuple(params),
    )


def list_capsules_with_metaphor_state(subject_name: str | None = None, phase: int | None = None):
    """List capsules with meta_data attached — used by the metaphor review queue."""
    conditions = []
    params: list = []
    if subject_name:
        conditions.append("s.name = %s")
        params.append(subject_name)
    if phase is not None:
        conditions.append("sc.phase = %s")
        params.append(phase)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return fetchall(
        f"""
        SELECT
            cc.id AS capsule_id,
            cc.name AS capsule_name,
            cc.meta_data,
            ct.name AS theme_name,
            sc.phase,
            sc.age_range,
            s.name AS subject_name
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        {where}
        ORDER BY sc.phase, ct.theme_order, cc.capsule_order
        """,
        tuple(params),
    )


def update_curriculum_fact_variant(fact_id: str, variant_id: str, mutator):
    """Load one fact's variants, mutate matching variant via callback, and persist."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO curriculum_fact_images (id, curriculum_fact_id, meta_data)
                VALUES (gen_random_uuid(), %s, ARRAY[]::jsonb[])
                ON CONFLICT (curriculum_fact_id) DO NOTHING
                """,
                (fact_id,),
            )
            cur.execute(
                """
                SELECT id, curriculum_fact_id, meta_data
                FROM curriculum_fact_images
                WHERE curriculum_fact_id = %s
                FOR UPDATE
                """,
                (fact_id,),
            )
            row = cur.fetchone()
            variants = list((row or {}).get("meta_data") or [])
            changed = False
            for idx, variant in enumerate(variants):
                if str(variant.get("id")) != str(variant_id):
                    continue
                variants[idx] = mutator(dict(variant))
                changed = True
                break
            if not changed:
                conn.commit()
                return None
            payload = json.dumps(variants)
            cur.execute(
                """
                UPDATE curriculum_fact_images
                   SET meta_data = (
                       SELECT COALESCE(array_agg(elem), ARRAY[]::jsonb[])
                       FROM jsonb_array_elements(%s::jsonb) elem
                   )
                 WHERE curriculum_fact_id = %s
                 RETURNING id, curriculum_fact_id, meta_data
                """,
                (payload, fact_id),
            )
            updated = cur.fetchone()
        conn.commit()
        return updated
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def create_eval_run(job_id, targets, config, persona, enable_grading, max_turns, pid):
    """Insert a new eval run row and return it."""
    return execute_returning("""
        INSERT INTO eval_runs (job_id, targets, config, persona, enable_grading, max_turns, pid)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING *
    """, (job_id, targets, config, persona, enable_grading, max_turns, pid))


def get_eval_run(job_id):
    """Get an eval run by job_id."""
    return fetchone("SELECT * FROM eval_runs WHERE job_id = %s", (job_id,))


def list_eval_runs(limit=100):
    """List recent eval runs, most recent first."""
    return fetchall(
        "SELECT * FROM eval_runs ORDER BY started_at DESC LIMIT %s", (limit,)
    )


def append_eval_log(job_id, chunk):
    """Append a text chunk to the eval run's log_text column (capped at 1MB)."""
    execute(
        "UPDATE eval_runs SET log_text = RIGHT(log_text || %s, 1000000) WHERE job_id = %s",
        (chunk, job_id),
    )


def get_eval_log_tail(job_id, tail_chars=50000):
    """Get the last N characters of the log for an eval run."""
    row = fetchone(
        "SELECT RIGHT(log_text, %s) AS tail FROM eval_runs WHERE job_id = %s",
        (tail_chars, job_id),
    )
    return row["tail"] if row else ""


def delete_eval_run(job_id):
    """Delete an eval run by job_id."""
    execute("DELETE FROM eval_runs WHERE job_id = %s", (job_id,))


def delete_session(learning_session_id):
    """Delete a session and all related data."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM learning_session_feedback WHERE learning_session_id = %s", (learning_session_id,))
            cur.execute("DELETE FROM learning_session_messages WHERE learning_session_id = %s", (learning_session_id,))
            cur.execute("DELETE FROM learning_sessions WHERE id = %s", (learning_session_id,))
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Generated Images queries
# ---------------------------------------------------------------------------

def insert_generated_image(gcs_url, gcs_blob_name, topic=None, description=None,
                           style=None, full_prompt=None, capsule_name=None,
                           learning_session_message_id=None, **_kwargs):
    """Insert a generated_images row and return it."""
    return execute_returning("""
        INSERT INTO generated_images
            (gcs_url, gcs_blob_name, topic, description, style, full_prompt,
             capsule_name, learning_session_message_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
    """, (gcs_url, gcs_blob_name, topic, description, style, full_prompt,
          capsule_name, learning_session_message_id))


def complete_eval_run(job_id, status, exit_code=None, error=None, result=None):
    """Mark an eval run as completed/failed/cancelled, optionally storing the result JSONB."""
    execute("""
        UPDATE eval_runs
        SET status = %s, exit_code = %s, error = %s, completed_at = NOW(),
            result = COALESCE(%s::jsonb, result)
        WHERE job_id = %s
    """, (status, exit_code, error, json.dumps(result) if result else None, job_id))


def save_eval_result(job_id, result):
    """Store or overwrite the result JSONB for an eval run."""
    execute(
        "UPDATE eval_runs SET result = %s::jsonb WHERE job_id = %s",
        (json.dumps(result), job_id),
    )


def append_eval_capsule_result(job_id, capsule_dict):
    """Append a single capsule result to the eval_runs.result JSONB column.

    Initializes the result structure if it doesn't exist yet, then appends
    the capsule to the capsules array and recomputes aggregates.
    """
    capsule_json = json.dumps(capsule_dict)
    execute("""
        UPDATE eval_runs
        SET result = jsonb_set(
            COALESCE(result, '{"capsules":[],"subjects":[],"capsuleCount":0,"avgScores":{},"totalTokens":0,"totalDuration":0}'::jsonb),
            '{capsules}',
            COALESCE(result->'capsules', '[]'::jsonb) || %s::jsonb
        )
        WHERE job_id = %s
    """, (capsule_json, job_id))


def finalize_eval_result(job_id):
    """Recompute aggregate fields (subjects, counts, avg scores, totals) from capsules array."""
    row = fetchone("SELECT result FROM eval_runs WHERE job_id = %s", (job_id,))
    if not row or not row.get("result"):
        return
    result = row["result"]
    capsules = result.get("capsules", [])
    if not capsules:
        return

    subjects = sorted(set(c.get("subject", "Unknown") for c in capsules))
    total_tokens = sum(c.get("totalTokens", 0) for c in capsules)
    total_duration = sum(c.get("totalDuration", 0) for c in capsules)

    scores_sum = {}
    scores_count = 0
    for c in capsules:
        scores = c.get("scores", {})
        for k, v in scores.items():
            if v is not None:
                scores_sum[k] = scores_sum.get(k, 0) + v
        if scores:
            scores_count += 1

    avg_scores = {}
    if scores_count > 0:
        avg_scores = {k: round(v / scores_count, 3) for k, v in scores_sum.items()}

    result["subjects"] = subjects
    result["capsuleCount"] = len(capsules)
    result["avgScores"] = avg_scores
    result["totalTokens"] = total_tokens
    result["totalDuration"] = round(total_duration, 1)

    save_eval_result(job_id, result)


# ---------------------------------------------------------------------------
# Curriculum Audit queries
# ---------------------------------------------------------------------------

def list_audits():
    """List all curriculum audits (without HTML content), newest first."""
    return fetchall("""
        SELECT id, title, description, audit_date, subjects_count,
               capsules_count, facts_count, issues_count, health_score, created_date
        FROM curriculum_audit
        ORDER BY audit_date DESC
    """)



def create_audit(title, content=None, audit_date=None, description=None,
                 subjects_count=None, capsules_count=None, facts_count=None,
                 issues_count=None, health_score=None, data=None):
    """Insert a new curriculum audit and return the row."""
    return execute_returning("""
        INSERT INTO curriculum_audit
            (title, content, data, audit_date, description,
             subjects_count, capsules_count, facts_count, issues_count, health_score)
        VALUES (%s, %s, %s::jsonb, COALESCE(%s, NOW()), %s, %s, %s, %s, %s, %s)
        RETURNING id, title, audit_date, created_date
    """, (title, content, json.dumps(data) if data else None, audit_date, description,
          subjects_count, capsules_count, facts_count, issues_count, health_score))


def get_audit_data(audit_id):
    """Get audit metadata + JSON data."""
    return fetchone("""
        SELECT id, title, description, audit_date,
               subjects_count, capsules_count, facts_count,
               issues_count, health_score, created_date,
               data
        FROM curriculum_audit WHERE id = %s
    """, (audit_id,))


def update_audit_data(audit_id, patch: dict):
    """Merge *patch* into the audit's data JSONB column using || operator."""
    return execute_returning("""
        UPDATE curriculum_audit
           SET data = COALESCE(data, '{}'::jsonb) || %s::jsonb
         WHERE id = %s
        RETURNING id
    """, (json.dumps(patch), audit_id))


def delete_audit(audit_id):
    """Delete a curriculum audit by ID. Returns the deleted row's id or None."""
    return execute_returning(
        "DELETE FROM curriculum_audit WHERE id = %s RETURNING id", (audit_id,)
    )


def get_curriculum_summary():
    """Get current curriculum stats from DB tables for audit generation."""
    summary = {}
    summary["subjects"] = fetchall(
        "SELECT id, name FROM subjects ORDER BY name"
    )
    summary["phases"] = fetchall("""
        SELECT s.name AS subject, sc.phase, sc.age_range,
               COUNT(DISTINCT ct.id) AS themes,
               COUNT(DISTINCT cc.id) AS capsules
        FROM subjects s
        JOIN subject_curriculum sc ON sc.subject_id = s.id
        LEFT JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
        LEFT JOIN curriculum_capsules cc ON cc.curriculum_theme_id = ct.id
        GROUP BY s.name, sc.phase, sc.age_range
        ORDER BY s.name, sc.phase
    """)
    summary["totals"] = fetchone("""
        SELECT COUNT(DISTINCT s.id) AS subjects,
               COUNT(DISTINCT cc.id) AS capsules,
               COUNT(cf.id) AS facts
        FROM subjects s
        JOIN subject_curriculum sc ON sc.subject_id = s.id
        JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
        JOIN curriculum_capsules cc ON cc.curriculum_theme_id = ct.id
        LEFT JOIN curriculum_facts cf ON cf.curriculum_capsule_id = cc.id
    """)
    summary["facts_per_subject"] = fetchall("""
        SELECT s.name AS subject, COUNT(cf.id) AS facts,
               COUNT(DISTINCT cc.id) AS capsules,
               ROUND(COUNT(cf.id)::numeric / NULLIF(COUNT(DISTINCT cc.id), 0), 1) AS avg_facts
        FROM subjects s
        JOIN subject_curriculum sc ON sc.subject_id = s.id
        JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
        JOIN curriculum_capsules cc ON cc.curriculum_theme_id = ct.id
        LEFT JOIN curriculum_facts cf ON cf.curriculum_capsule_id = cc.id
        GROUP BY s.name ORDER BY s.name
    """)
    summary["empty_fields"] = fetchall("""
        SELECT s.name AS subject,
               COUNT(*) FILTER (WHERE cf.meta_data->>'process' IS NULL OR cf.meta_data->>'process' = '') AS empty_processes,
               COUNT(*) FILTER (WHERE cf.meta_data->>'application' IS NULL OR cf.meta_data->>'application' = '') AS empty_applications,
               COUNT(*) FILTER (WHERE cf.meta_data->>'misconception' IS NULL OR cf.meta_data->>'misconception' = '') AS empty_misconceptions,
               COUNT(*) FILTER (WHERE cf.meta_data->>'vocabulary' IS NULL OR cf.meta_data->>'vocabulary' = '') AS empty_vocabulary,
               COUNT(*) AS total_facts
        FROM subjects s
        JOIN subject_curriculum sc ON sc.subject_id = s.id
        JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
        JOIN curriculum_capsules cc ON cc.curriculum_theme_id = ct.id
        JOIN curriculum_facts cf ON cf.curriculum_capsule_id = cc.id
        GROUP BY s.name ORDER BY s.name
    """)
    summary["zero_fact_capsules"] = fetchall("""
        SELECT s.name AS subject, cc.name AS capsule, ct.name AS theme, sc.phase
        FROM subjects s
        JOIN subject_curriculum sc ON sc.subject_id = s.id
        JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
        JOIN curriculum_capsules cc ON cc.curriculum_theme_id = ct.id
        LEFT JOIN curriculum_facts cf ON cf.curriculum_capsule_id = cc.id
        GROUP BY s.name, cc.name, ct.name, sc.phase
        HAVING COUNT(cf.id) = 0
        ORDER BY s.name, sc.phase
    """)
    return summary


def get_curriculum_export_facts():
    """Return one row per fact for the Facts sheet of the Excel export.

    Includes fact-level enrichments only (vocabulary, processes, applications,
    micro_checks, misconceptions). Capsule-level fields live on a separate sheet.
    """
    return fetchall("""
        SELECT
            s.name                                  AS subject,
            sc.phase                                AS phase,
            sc.age_range                            AS age_range,
            ct.name                                 AS theme,
            ct.theme_order                          AS theme_order,
            ct.guiding_question                     AS guiding_question,
            cc.name                                 AS capsule,
            cc.capsule_order                        AS capsule_order,
            cf."order"                              AS fact_order,
            cf.meta_data->>'core_fact'              AS fact_text,
            (cf.meta_data->>'difficulty_weight')::float AS difficulty,
            cf.meta_data->>'vocabulary'             AS vocabulary,
            cf.meta_data->>'process'                AS processes,
            cf.meta_data->>'application'            AS applications,
            cf.meta_data->>'micro_check'            AS micro_checks,
            cf.meta_data->>'misconception'          AS misconceptions
        FROM curriculum_facts cf
        JOIN curriculum_capsules cc ON cc.id = cf.curriculum_capsule_id
        JOIN curriculum_themes ct  ON ct.id = cc.curriculum_theme_id
        JOIN subject_curriculum sc ON sc.id = ct.subject_curriculum_id
        JOIN subjects s            ON s.id  = sc.subject_id
        ORDER BY s.name, sc.phase, ct.theme_order, cc.capsule_order, cf."order"
    """)


def get_curriculum_export_capsules():
    """Return one row per capsule for the Capsules sheet of the Excel export."""
    return fetchall("""
        SELECT
            s.name                          AS subject,
            sc.phase                        AS phase,
            sc.age_range                    AS age_range,
            ct.name                         AS theme,
            ct.theme_order                  AS theme_order,
            cc.name                         AS capsule,
            cc.capsule_order                AS capsule_order,
            COUNT(cf.id)                    AS fact_count
        FROM curriculum_capsules cc
        JOIN curriculum_themes ct  ON ct.id = cc.curriculum_theme_id
        JOIN subject_curriculum sc ON sc.id = ct.subject_curriculum_id
        JOIN subjects s            ON s.id  = sc.subject_id
        LEFT JOIN curriculum_facts cf ON cf.curriculum_capsule_id = cc.id
        GROUP BY s.name, sc.phase, sc.age_range, ct.name, ct.theme_order,
                 cc.name, cc.capsule_order
        ORDER BY s.name, sc.phase, ct.theme_order, cc.capsule_order
    """)


# ---------------------------------------------------------------------------
# Distillation variant management (curriculum_fact_distillations)
# ---------------------------------------------------------------------------

def get_distillation_row(fact_id: str):
    """Get curriculum_fact_distillations row by curriculum_fact_id."""
    return fetchone(
        "SELECT id, curriculum_fact_id, meta_data FROM curriculum_fact_distillations WHERE curriculum_fact_id = %s",
        (fact_id,),
    )


def ensure_distillation_row(fact_id: str):
    """Ensure a curriculum_fact_distillations row exists for the fact and return it."""
    return execute_returning(
        """
        INSERT INTO curriculum_fact_distillations (id, curriculum_fact_id, meta_data)
        VALUES (gen_random_uuid(), %s, ARRAY[]::jsonb[])
        ON CONFLICT (curriculum_fact_id) DO UPDATE
           SET curriculum_fact_id = EXCLUDED.curriculum_fact_id
        RETURNING id, curriculum_fact_id, meta_data
        """,
        (fact_id,),
    )


def append_distillation_variant(fact_id: str, variant: dict):
    """Append one distillation variant object to curriculum_fact_distillations.meta_data."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO curriculum_fact_distillations (id, curriculum_fact_id, meta_data)
                VALUES (gen_random_uuid(), %s, ARRAY[]::jsonb[])
                ON CONFLICT (curriculum_fact_id) DO NOTHING
                """,
                (fact_id,),
            )
            cur.execute(
                """
                SELECT id, curriculum_fact_id, meta_data
                FROM curriculum_fact_distillations
                WHERE curriculum_fact_id = %s
                FOR UPDATE
                """,
                (fact_id,),
            )
            row = cur.fetchone()
            variants = list((row or {}).get("meta_data") or [])
            # Dedup: skip if variant with same ID already exists (H-2, H-3)
            existing_ids = {v.get("id") for v in variants if v.get("id")}
            if variant.get("id") in existing_ids:
                import logging as _log
                _log.getLogger(__name__).warning(
                    "Duplicate variant id %s for fact %s, skipping append", variant.get("id"), fact_id
                )
                return row
            variants.append(variant)
            payload = json.dumps(variants)
            cur.execute(
                """
                UPDATE curriculum_fact_distillations
                   SET meta_data = (
                       SELECT COALESCE(array_agg(elem), ARRAY[]::jsonb[])
                       FROM jsonb_array_elements(%s::jsonb) elem
                   )
                 WHERE curriculum_fact_id = %s
                 RETURNING id, curriculum_fact_id, meta_data
                """,
                (payload, fact_id),
            )
            updated = cur.fetchone()
        conn.commit()
        return updated
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_distillation_variant(fact_id: str, variant_id: str, mutator):
    """Load one fact's distillation variants, mutate matching variant via callback, and persist."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO curriculum_fact_distillations (id, curriculum_fact_id, meta_data)
                VALUES (gen_random_uuid(), %s, ARRAY[]::jsonb[])
                ON CONFLICT (curriculum_fact_id) DO NOTHING
                """,
                (fact_id,),
            )
            cur.execute(
                """
                SELECT id, curriculum_fact_id, meta_data
                FROM curriculum_fact_distillations
                WHERE curriculum_fact_id = %s
                FOR UPDATE
                """,
                (fact_id,),
            )
            row = cur.fetchone()
            variants = list((row or {}).get("meta_data") or [])
            changed = False
            for idx, variant in enumerate(variants):
                if str(variant.get("id")) != str(variant_id):
                    continue
                variants[idx] = mutator(dict(variant))
                changed = True
                break
            if not changed:
                conn.commit()
                return None
            payload = json.dumps(variants)
            cur.execute(
                """
                UPDATE curriculum_fact_distillations
                   SET meta_data = (
                       SELECT COALESCE(array_agg(elem), ARRAY[]::jsonb[])
                       FROM jsonb_array_elements(%s::jsonb) elem
                   )
                 WHERE curriculum_fact_id = %s
                 RETURNING id, curriculum_fact_id, meta_data
                """,
                (payload, fact_id),
            )
            updated = cur.fetchone()
        conn.commit()
        return updated
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def bulk_update_distillation_variants(updates: list[tuple[str, str, callable]]) -> int:
    """Update multiple distillation variants in a single transaction.

    updates: list of (fact_id, variant_id, mutator) tuples.
    Returns the count of successfully mutated variants.
    """
    if not updates:
        return 0
    conn = get_conn()
    affected = 0
    try:
        with conn.cursor() as cur:
            for fact_id, variant_id, mutator in updates:
                cur.execute(
                    """
                    INSERT INTO curriculum_fact_distillations (id, curriculum_fact_id, meta_data)
                    VALUES (gen_random_uuid(), %s, ARRAY[]::jsonb[])
                    ON CONFLICT (curriculum_fact_id) DO NOTHING
                    """,
                    (fact_id,),
                )
                cur.execute(
                    """
                    SELECT id, curriculum_fact_id, meta_data
                    FROM curriculum_fact_distillations
                    WHERE curriculum_fact_id = %s
                    FOR UPDATE
                    """,
                    (fact_id,),
                )
                row = cur.fetchone()
                variants = list((row or {}).get("meta_data") or [])
                changed = False
                for idx, variant in enumerate(variants):
                    if str(variant.get("id")) != str(variant_id):
                        continue
                    variants[idx] = mutator(dict(variant))
                    changed = True
                    break
                if not changed:
                    continue
                payload = json.dumps(variants)
                cur.execute(
                    """
                    UPDATE curriculum_fact_distillations
                       SET meta_data = (
                           SELECT COALESCE(array_agg(elem), ARRAY[]::jsonb[])
                           FROM jsonb_array_elements(%s::jsonb) elem
                       )
                     WHERE curriculum_fact_id = %s
                    """,
                    (payload, fact_id),
                )
                affected += 1
        conn.commit()
        return affected
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def bulk_update_image_variants(updates: list[tuple[str, str, callable]]) -> int:
    """Update multiple image variants in a single transaction.

    updates: list of (fact_id, variant_id, mutator) tuples.
    Returns the count of successfully mutated variants.
    """
    if not updates:
        return 0
    conn = get_conn()
    affected = 0
    try:
        with conn.cursor() as cur:
            for fact_id, variant_id, mutator in updates:
                cur.execute(
                    """
                    SELECT id, curriculum_fact_id, meta_data
                    FROM curriculum_fact_images
                    WHERE curriculum_fact_id = %s
                    FOR UPDATE
                    """,
                    (fact_id,),
                )
                row = cur.fetchone()
                if not row:
                    continue
                variants = list((row or {}).get("meta_data") or [])
                changed = False
                for idx, variant in enumerate(variants):
                    if str(variant.get("id")) != str(variant_id):
                        continue
                    variants[idx] = mutator(dict(variant))
                    changed = True
                    break
                if not changed:
                    continue
                payload = json.dumps(variants)
                cur.execute(
                    """
                    UPDATE curriculum_fact_images
                       SET meta_data = (
                           SELECT COALESCE(array_agg(elem), ARRAY[]::jsonb[])
                           FROM jsonb_array_elements(%s::jsonb) elem
                       )
                     WHERE curriculum_fact_id = %s
                    """,
                    (payload, fact_id),
                )
                affected += 1
        conn.commit()
        return affected
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_approved_distillations(fact_id: str) -> list[dict]:
    """Get only approved distillation variants for runtime use."""
    row = fetchone(
        "SELECT meta_data FROM curriculum_fact_distillations WHERE curriculum_fact_id = %s",
        (fact_id,),
    )
    if not row or not row.get("meta_data"):
        return []
    return [v for v in row["meta_data"] if v.get("status") == "approved"]


def list_distillation_variants(
    *,
    subject_name: str | None = None,
    phase: int | None = None,
    theme_name: str | None = None,
    capsule_name: str | None = None,
    status: str | None = None,
    strategy: str | None = None,
    fact_id: str | None = None,
    variant_id: str | None = None,
):
    """Flatten curriculum_fact_distillations.meta_data array into row-level variant records.

    Variant-level filters (status, strategy, variant_id) are applied in SQL via
    CROSS JOIN LATERAL unnest() to avoid loading all variants into Python.
    """
    conditions = []
    params: list = []
    if phase is not None:
        conditions.append("sc.phase = %s")
        params.append(phase)
    if subject_name:
        conditions.append("s.name = %s")
        params.append(subject_name)
    if theme_name:
        conditions.append("ct.name = %s")
        params.append(theme_name)
    if capsule_name:
        conditions.append("cc.name = %s")
        params.append(capsule_name)
    if fact_id:
        conditions.append("cf.id = %s")
        params.append(fact_id)

    # Variant-level filters applied in SQL
    variant_conditions = []
    if status:
        variant_conditions.append("v->>'status' = %s")
        params.append(status)
    if strategy:
        variant_conditions.append("v->>'strategy' = %s")
        params.append(strategy)
    if variant_id:
        variant_conditions.append("v->>'id' = %s")
        params.append(str(variant_id))

    where_parts = conditions + variant_conditions
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    rows = fetchall(
        f"""
        SELECT
            cfd.curriculum_fact_id AS fact_id,
            cf."order" AS fact_order,
            cf.meta_data->>'core_fact' AS fact_text,
            cc.id AS capsule_id,
            cc.name AS capsule_name,
            ct.name AS theme_name,
            sc.phase,
            sc.age_range,
            s.name AS subject_name,
            v AS variant
        FROM curriculum_fact_distillations cfd
        JOIN curriculum_facts cf ON cfd.curriculum_fact_id = cf.id
        JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        CROSS JOIN LATERAL unnest(cfd.meta_data) AS v
        {where}
        ORDER BY sc.phase, ct.theme_order, cc.capsule_order, cf."order"
        """,
        tuple(params),
    )

    return [
        {
            "fact_id": str(row["fact_id"]),
            "fact_order": row["fact_order"],
            "fact_text": row["fact_text"] or "",
            "capsule_id": str(row["capsule_id"]),
            "capsule_name": row["capsule_name"],
            "theme_name": row["theme_name"],
            "phase": row["phase"],
            "age_range": row["age_range"],
            "subject_name": row["subject_name"],
            "variant": row["variant"],
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Pipeline health analytics (aggregate stats, no full payloads)
# ---------------------------------------------------------------------------

_health_cache: dict[str, tuple[float, dict]] = {}
_HEALTH_CACHE_TTL = 60  # seconds


def get_pipeline_health(
    *,
    subject_name: str | None = None,
    phase: int | None = None,
):
    """Aggregate distillation + image pipeline stats using SQL-level counts.

    Returns lightweight summary data — never pulls full variant text/images.
    All params optional: no filters = global health across all subjects.
    Results are cached for 60 seconds per unique filter combination.
    Uses a single shared connection for all queries.
    """
    import time

    cache_key = f"{subject_name or ''}:{phase or ''}"
    now = time.monotonic()
    cached = _health_cache.get(cache_key)
    if cached and (now - cached[0]) < _HEALTH_CACHE_TTL:
        return cached[1]

    conditions = []
    params: list = []
    if subject_name:
        conditions.append("s.name = %s")
        params.append(subject_name)
    if phase is not None:
        conditions.append("sc.phase = %s")
        params.append(phase)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    tparams = tuple(params)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # --- Total facts per subject/phase ---
            cur.execute(f"""
                SELECT s.name AS subject, sc.phase, COUNT(cf.id) AS total_facts
                FROM subjects s
                JOIN subject_curriculum sc ON sc.subject_id = s.id
                JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
                JOIN curriculum_capsules cc ON cc.curriculum_theme_id = ct.id
                JOIN curriculum_facts cf ON cf.curriculum_capsule_id = cc.id
                {where}
                GROUP BY s.name, sc.phase
                ORDER BY s.name, sc.phase
            """, tparams)
            fact_counts = cur.fetchall()

            # --- Distillation variant stats per subject/phase/strategy ---
            cur.execute(f"""
                SELECT
                    s.name AS subject, sc.phase,
                    v->>'strategy' AS strategy,
                    v->>'status' AS status,
                    (v->'evaluation'->>'composite')::float AS composite
                FROM curriculum_fact_distillations cfd
                JOIN curriculum_facts cf ON cfd.curriculum_fact_id = cf.id
                JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
                JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
                JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
                JOIN subjects s ON sc.subject_id = s.id
                CROSS JOIN LATERAL unnest(cfd.meta_data) AS v
                {where}
            """, tparams)
            dist_stats = cur.fetchall()

            # --- Image variant stats per subject/phase ---
            cur.execute(f"""
                SELECT
                    s.name AS subject, sc.phase,
                    (v->'evaluation'->>'decision') AS decision,
                    (v->'pair_evaluation'->>'decision') AS pair_decision,
                    (v->'evaluation'->>'composite')::float AS composite
                FROM curriculum_fact_images cfi
                JOIN curriculum_facts cf ON cfi.curriculum_fact_id = cf.id
                JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
                JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
                JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
                JOIN subjects s ON sc.subject_id = s.id
                CROSS JOIN LATERAL unnest(cfi.meta_data) AS v
                {where}
            """, tparams)
            img_stats = cur.fetchall()

            # --- Facts with at least one approved distillation ---
            cur.execute(f"""
                SELECT s.name AS subject, sc.phase, COUNT(DISTINCT cfd.curriculum_fact_id) AS cnt
                FROM curriculum_fact_distillations cfd
                JOIN curriculum_facts cf ON cfd.curriculum_fact_id = cf.id
                JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
                JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
                JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
                JOIN subjects s ON sc.subject_id = s.id
                CROSS JOIN LATERAL unnest(cfd.meta_data) AS v
                {where} {"AND" if where else "WHERE"} v->>'status' = 'approved'
                GROUP BY s.name, sc.phase
            """, tparams)
            facts_with_approved = cur.fetchall()

            # --- Facts with at least one SHIP image ---
            cur.execute(f"""
                SELECT s.name AS subject, sc.phase, COUNT(DISTINCT cfi.curriculum_fact_id) AS cnt
                FROM curriculum_fact_images cfi
                JOIN curriculum_facts cf ON cfi.curriculum_fact_id = cf.id
                JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
                JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
                JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
                JOIN subjects s ON sc.subject_id = s.id
                CROSS JOIN LATERAL unnest(cfi.meta_data) AS v
                {where} {"AND" if where else "WHERE"} UPPER(v->'evaluation'->>'decision') = 'SHIP'
                GROUP BY s.name, sc.phase
            """, tparams)
            facts_with_ship = cur.fetchall()

            # --- Facts with any distillation variant ---
            cur.execute(f"""
                SELECT s.name AS subject, sc.phase, COUNT(DISTINCT cfd.curriculum_fact_id) AS cnt
                FROM curriculum_fact_distillations cfd
                JOIN curriculum_facts cf ON cfd.curriculum_fact_id = cf.id
                JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
                JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
                JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
                JOIN subjects s ON sc.subject_id = s.id
                {where}
                GROUP BY s.name, sc.phase
            """, tparams)
            facts_with_dist = cur.fetchall()

            # --- Facts with any image variant ---
            cur.execute(f"""
                SELECT s.name AS subject, sc.phase, COUNT(DISTINCT cfi.curriculum_fact_id) AS cnt
                FROM curriculum_fact_images cfi
                JOIN curriculum_facts cf ON cfi.curriculum_fact_id = cf.id
                JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
                JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
                JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
                JOIN subjects s ON sc.subject_id = s.id
                {where}
                GROUP BY s.name, sc.phase
            """, tparams)
            facts_with_img = cur.fetchall()

            # --- Recent job activity ---
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '24 hours') AS jobs_last_24h
                FROM eval_runs
            """)
            recent_jobs = cur.fetchone()

        result = {
            "fact_counts": fact_counts,
            "dist_stats": dist_stats,
            "img_stats": img_stats,
            "facts_with_approved": facts_with_approved,
            "facts_with_ship": facts_with_ship,
            "facts_with_dist": facts_with_dist,
            "facts_with_img": facts_with_img,
            "recent_jobs": recent_jobs,
        }
        _health_cache[cache_key] = (now, result)
        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Prompt overrides
# ---------------------------------------------------------------------------

# Specificity order for scope_type (higher = more specific, wins)
_SCOPE_SPECIFICITY = {"global": 0, "subject": 1, "phase": 2, "theme": 3, "capsule": 4}



def get_prompt_overrides(scope_keys: dict, prompt_id: str, strategy: str | None = None) -> list[dict]:
    """Return active overrides matching a scope hierarchy, sorted by specificity.

    Args:
        scope_keys: dict with keys matching scope_type values, e.g.
            {"global": "all", "subject": "Biology", "phase": "Biology:2",
             "theme": "<theme_uuid>", "capsule": "<capsule_uuid>"}
        prompt_id: which prompt template to match
        strategy: optional strategy filter (None = also match overrides with strategy IS NULL)

    Returns list of override dicts sorted by specificity (global first, capsule last).
    """
    if not scope_keys:
        return []

    conditions = []
    params: list = []
    for scope_type, scope_key in scope_keys.items():
        conditions.append("(scope_type = %s AND scope_key = %s)")
        params.extend([scope_type, scope_key])

    where_scope = " OR ".join(conditions)
    strategy_clause = "AND (strategy IS NULL OR strategy = %s)" if strategy else "AND strategy IS NULL"
    if strategy:
        params.append(strategy)

    params.append(prompt_id)

    rows = fetchall(f"""
        SELECT * FROM prompt_overrides
        WHERE active = TRUE
          AND ({where_scope})
          {strategy_clause}
          AND prompt_id = %s
        ORDER BY created_at
    """, tuple(params))

    # Sort by specificity: global < subject < phase < theme < capsule
    return sorted(rows, key=lambda r: _SCOPE_SPECIFICITY.get(r["scope_type"], 0))


def upsert_prompt_override(
    *,
    scope_type: str,
    scope_key: str,
    prompt_id: str,
    strategy: str | None,
    override_type: str,
    content: str,
    created_by: str | None = None,
    source: str = "manual",
    performance_data: dict | None = None,
    active: bool = True,
) -> dict:
    """Create or update a prompt override. Returns the upserted row.

    Uses INSERT ... ON CONFLICT DO UPDATE to avoid race conditions (H-7).
    Supports active=False for pending/ab-test overrides (C-1, C-4).
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            pd_json = json.dumps(performance_data) if performance_data else None
            if strategy is not None:
                cur.execute("""
                    INSERT INTO prompt_overrides
                        (scope_type, scope_key, prompt_id, strategy, override_type,
                         content, created_by, source, performance_data, active)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (scope_type, scope_key, prompt_id, strategy)
                        WHERE strategy IS NOT NULL AND active = TRUE
                    DO UPDATE SET
                        override_type = EXCLUDED.override_type,
                        content = EXCLUDED.content,
                        updated_at = NOW(),
                        created_by = COALESCE(EXCLUDED.created_by, prompt_overrides.created_by),
                        source = EXCLUDED.source,
                        performance_data = COALESCE(EXCLUDED.performance_data, prompt_overrides.performance_data),
                        active = EXCLUDED.active
                    RETURNING *
                """, (scope_type, scope_key, prompt_id, strategy, override_type,
                      content, created_by, source, pd_json, active))
            else:
                cur.execute("""
                    INSERT INTO prompt_overrides
                        (scope_type, scope_key, prompt_id, strategy, override_type,
                         content, created_by, source, performance_data, active)
                    VALUES (%s, %s, %s, NULL, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (scope_type, scope_key, prompt_id)
                        WHERE strategy IS NULL AND active = TRUE
                    DO UPDATE SET
                        override_type = EXCLUDED.override_type,
                        content = EXCLUDED.content,
                        updated_at = NOW(),
                        created_by = COALESCE(EXCLUDED.created_by, prompt_overrides.created_by),
                        source = EXCLUDED.source,
                        performance_data = COALESCE(EXCLUDED.performance_data, prompt_overrides.performance_data),
                        active = EXCLUDED.active
                    RETURNING *
                """, (scope_type, scope_key, prompt_id, override_type,
                      content, created_by, source, pd_json, active))
            row = cur.fetchone()
            if not row:
                # Conflict target didn't match (e.g. active=False insert with no existing) — fetch
                cur.execute("""
                    SELECT * FROM prompt_overrides
                    WHERE scope_type = %s AND scope_key = %s AND prompt_id = %s
                      AND (strategy IS NOT DISTINCT FROM %s)
                    ORDER BY created_at DESC LIMIT 1
                """, (scope_type, scope_key, prompt_id, strategy))
                row = cur.fetchone()
        conn.commit()
        return dict(row) if row else {}
    finally:
        conn.close()


def activate_prompt_override(override_id: str) -> bool:
    """Activate a previously-inactive prompt override. Returns True if found."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE prompt_overrides SET active = TRUE, updated_at = NOW()
                WHERE id = %s
                RETURNING id
            """, (override_id,))
            row = cur.fetchone()
        conn.commit()
        return row is not None
    finally:
        conn.close()


def list_prompt_overrides(scope_type: str | None = None, scope_key: str | None = None) -> list[dict]:
    """List prompt overrides, optionally filtered by scope."""
    conditions = ["active = TRUE"]
    params: list = []
    if scope_type:
        conditions.append("scope_type = %s")
        params.append(scope_type)
    if scope_key:
        conditions.append("scope_key = %s")
        params.append(scope_key)

    where = " AND ".join(conditions)
    return fetchall(f"""
        SELECT * FROM prompt_overrides
        WHERE {where}
        ORDER BY scope_type, scope_key, prompt_id
    """, tuple(params))


def deactivate_prompt_override(override_id: str) -> bool:
    """Soft-delete a prompt override. Returns True if found."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE prompt_overrides SET active = FALSE, updated_at = NOW()
                WHERE id = %s AND active = TRUE
                RETURNING id
            """, (override_id,))
            row = cur.fetchone()
        conn.commit()
        return row is not None
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Prompt version history (Track A — track / diff / rollback)
# ---------------------------------------------------------------------------
#
# Append-only snapshots of base tutor prompt templates. NOT read at runtime —
# learning_system_schemas.descision_tree.prompt_registry stays the single live
# source the tutor renders. content_hash is the same identity hash written into
# per-turn telemetry (A3), so a logged turn joins straight to the version that
# produced it.


def hash_prompt_template(text: str) -> str:
    """Stable identity hash of a prompt template's text.

    Shared by version history and per-turn attribution so a turn's template_hash
    joins directly to its prompt_versions row. 64-bit hex prefix — compact for
    per-turn logs, collision-safe as an identity tag.
    """
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]


def record_prompt_version(schema_id, schema_name, prompt_id, old_content, new_content,
                          author="", source="manual", note=None):
    """Append a version snapshot when a prompt template changes.

    No-op (returns None) when the text is unchanged. The first time a prompt is
    versioned, the pre-existing template is captured as an 'import' baseline so
    history is complete. Returns the new live version row.
    """
    if old_content == new_content:
        return None
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id FROM prompt_versions
                WHERE schema_id = %s AND prompt_id = %s
                ORDER BY created_at DESC LIMIT 1
            """, (schema_id, prompt_id))
            last = cur.fetchone()
            parent_id = last["id"] if last else None
            # Capture the pre-existing template the first time we touch this prompt.
            if last is None and old_content:
                cur.execute("""
                    INSERT INTO prompt_versions
                        (schema_id, schema_name, prompt_id, content, content_hash, author, source, is_live)
                    VALUES (%s, %s, %s, %s, %s, %s, 'import', FALSE)
                    RETURNING id
                """, (schema_id, schema_name, prompt_id, old_content,
                      hash_prompt_template(old_content), author))
                parent_id = cur.fetchone()["id"]
            # At most one live row per (schema_id, prompt_id) — demote the current one first.
            cur.execute("""
                UPDATE prompt_versions SET is_live = FALSE
                WHERE schema_id = %s AND prompt_id = %s AND is_live = TRUE
            """, (schema_id, prompt_id))
            cur.execute("""
                INSERT INTO prompt_versions
                    (schema_id, schema_name, prompt_id, content, content_hash,
                     author, source, note, parent_version_id, is_live)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                RETURNING *
            """, (schema_id, schema_name, prompt_id, new_content,
                  hash_prompt_template(new_content), author, source, note, parent_id))
            row = cur.fetchone()
        conn.commit()
        return dict(row) if row else None
    finally:
        conn.close()


def _write_version_rows(cur, schema_id, schema_name, prompt_id, old_content, new_content,
                        author, source, note):
    """Demote the current live version and insert the new live row, on a CALLER-OWNED cursor.

    Does NOT commit — the caller controls the transaction so the live-registry write and the
    version write are atomic. Captures an 'import' baseline the first time a prompt is touched.
    Returns the new live version row (dict).
    """
    cur.execute("""SELECT id FROM prompt_versions WHERE schema_id=%s AND prompt_id=%s
                   ORDER BY created_at DESC LIMIT 1""", (str(schema_id), prompt_id))
    last = cur.fetchone()
    parent_id = last["id"] if last else None
    if last is None and old_content:
        cur.execute("""INSERT INTO prompt_versions
                           (schema_id, schema_name, prompt_id, content, content_hash, author, source, is_live)
                       VALUES (%s, %s, %s, %s, %s, %s, 'import', FALSE) RETURNING id""",
                    (str(schema_id), schema_name, prompt_id, old_content,
                     hash_prompt_template(old_content), author))
        parent_id = cur.fetchone()["id"]
    cur.execute("""UPDATE prompt_versions SET is_live=FALSE
                   WHERE schema_id=%s AND prompt_id=%s AND is_live=TRUE""", (str(schema_id), prompt_id))
    cur.execute("""INSERT INTO prompt_versions
                       (schema_id, schema_name, prompt_id, content, content_hash,
                        author, source, note, parent_version_id, is_live)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE) RETURNING *""",
                (str(schema_id), schema_name, prompt_id, new_content,
                 hash_prompt_template(new_content), author, source, note, parent_id))
    r = cur.fetchone()
    return dict(r) if r else None


def apply_prompt_template(schema_id, prompt_id, new_content, author="", source="manual", note=None,
                          allow_create=False):
    """Atomically set a prompt's LIVE template AND record a version, serialized per schema.

    Single transaction: a per-schema advisory lock (pg_advisory_xact_lock) serializes all
    writers on the same schema's prompt_registry JSONB — this closes both the same-prompt
    is_live race and the cross-prompt lost-update on the shared JSONB column. The live
    descision_tree write and the prompt_versions write commit together (no split-brain).

    allow_create=True inserts a brand-new prompt_id into the registry instead of
    rejecting it (ADO #26: new engagement step templates) — same locking and
    versioning semantics; the version row's parent is the empty import baseline.

    Returns {"status": "ok"|"unchanged"|"schema_not_found"|"prompt_not_found", "version": row|None}.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # Serialize concurrent writers on this schema (lock held until commit/rollback).
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (str(schema_id),))
            cur.execute("SELECT name, descision_tree FROM learning_system_schemas WHERE id = %s",
                        (schema_id,))
            row = cur.fetchone()
            if not row:
                conn.rollback()
                return {"status": "schema_not_found", "version": None}
            schema_name = row["name"]
            dt = row["descision_tree"] or {}
            registry = dt.get("prompt_registry", {})
            if prompt_id not in registry:
                if not allow_create:
                    conn.rollback()
                    return {"status": "prompt_not_found", "version": None}
                registry[prompt_id] = {"id": prompt_id, "template": ""}
                dt["prompt_registry"] = registry
            old_content = (registry[prompt_id] or {}).get("template", "")
            if old_content == new_content:
                conn.rollback()
                return {"status": "unchanged", "version": None}
            registry[prompt_id]["template"] = new_content
            cur.execute("UPDATE learning_system_schemas SET descision_tree = %s WHERE id = %s",
                        (json.dumps(dt), schema_id))
            version = _write_version_rows(cur, schema_id, schema_name, prompt_id,
                                          old_content, new_content, author, source, note)
        conn.commit()
        return {"status": "ok", "version": version}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Pedagogy eval (Track B / ADO #58) — fixtures + offline result storage
# ---------------------------------------------------------------------------
# The scorer is OFFLINE and ADVISORY: these helpers read finished sessions and
# write pedagogy_eval_runs / pedagogy_eval_sessions (db/013). Nothing here is on
# the tutoring hot path. template_hash is read-through (joins prompt_versions once
# Track A merges); it is NOT populated on this branch — left NULL by callers.

def list_pedagogy_fixtures(subject=None, phase=None, limit=100, min_turns=4):
    """Return finished tutoring sessions to score, newest first, with curriculum context.

    Only sessions with at least `min_turns` assistant turns are returned — trajectory
    principles can't be judged from a 1-2 turn session. Default mirrors
    pedagogy_eval_policy.DEFAULT_GUARDRAILS["min_session_turns"] so a direct caller
    doesn't accidentally feed un-judgeable 1-2 turn sessions to the rubric. Each row: session_id,
    capsule_id, capsule_name, subject, phase, age_range, total_tokens, duration_seconds.
    """
    clauses = [
        "(SELECT count(*) FROM learning_session_messages m "
        "WHERE m.learning_session_id = ls.id AND m.role = 'assistant') >= %s"
    ]
    params = [int(min_turns)]
    if subject:
        clauses.append("s.name = %s")
        params.append(subject)
    if phase is not None:
        clauses.append("sc.phase = %s")
        params.append(phase)
    where = " AND ".join(clauses)
    params.append(int(limit))
    return fetchall(f"""
        SELECT ls.id                       AS session_id,
               ls.curriculum_capsule_id    AS capsule_id,
               cc.name                      AS capsule_name,
               s.name                       AS subject,
               sc.phase                     AS phase,
               sc.age_range                 AS age_range,
               ls.total_tokens              AS total_tokens,
               ls.duration_seconds          AS duration_seconds
        FROM learning_sessions ls
        JOIN curriculum_capsules cc ON ls.curriculum_capsule_id = cc.id
        JOIN curriculum_themes ct   ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc  ON ct.subject_curriculum_id = sc.id
        JOIN subjects s             ON sc.subject_id = s.id
        WHERE {where}
        ORDER BY ls.start_time DESC NULLS LAST
        LIMIT %s
    """, tuple(params))


def get_session_transcript(session_id):
    """Ordered (role, content) turns for a session. Oldest first."""
    return fetchall("""
        SELECT role, content, created_date
        FROM learning_session_messages
        WHERE learning_session_id = %s
        ORDER BY created_date ASC, id ASC
    """, (session_id,))


def get_session_eval_telemetry(session_id):
    """Per-session multi-objective inputs from execution_log (computed in-DB).

    execution_log entries are {timestamp, step, agent, details}; LLM_RESPONSE
    details carry model/latency_ms/completion_tokens. Returns one row with
    p50/p95 latency, avg completion tokens (tokens/turn), turn count, and the
    modal tutor model. Returns zeros/None when a session has no LLM_RESPONSE rows.
    """
    # Defensive casts: this runs over RESTORED/legacy sessions whose execution_log may
    # carry non-numeric latency_ms/completion_tokens. A bare ::numeric cast would throw
    # and discard the whole (already-judged) session — so strip non-numerics first and
    # NULLIF empties to NULL (percentile/avg ignore NULLs).
    return fetchone(r"""
        SELECT
            COUNT(*) AS total_turns,
            PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY NULLIF(regexp_replace(e->'details'->>'latency_ms','[^0-9.]','','g'),'')::numeric
            ) AS p50_latency_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (
                ORDER BY NULLIF(regexp_replace(e->'details'->>'latency_ms','[^0-9.]','','g'),'')::numeric
            ) AS p95_latency_ms,
            AVG(NULLIF(regexp_replace(e->'details'->>'completion_tokens','[^0-9.]','','g'),'')::numeric)
                AS tokens_per_turn,
            MODE() WITHIN GROUP (ORDER BY e->'details'->>'model') AS model_version
        FROM learning_sessions ls,
             LATERAL jsonb_array_elements(ls.execution_log) e
        WHERE ls.id = %s AND e->>'step' = 'LLM_RESPONSE'
    """, (session_id,))


def insert_pedagogy_eval_rows(rows):
    """Bulk-insert unaggregated per-(session,dimension,judge) rows. rows: list[dict]."""
    if not rows:
        return 0
    from psycopg2.extras import execute_values, Json
    cols = ("run_id", "session_id", "capsule_id", "fixture_set", "rubric_version",
            "dimension", "judge_name", "judge_family", "judge_provider", "judge_model",
            "score", "score_norm", "flags", "fell_back", "reasoning",
            "template_hash", "model_version")
    values = [
        tuple(Json(r[c]) if c == "flags" else r.get(c) for c in cols)
        for r in rows
    ]
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                f"INSERT INTO pedagogy_eval_runs ({', '.join(cols)}) VALUES %s",
                values,
            )
            n = cur.rowcount
        conn.commit()
        return n
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# Constant advisory-lock key so only one worker seeds baselines at a time (no duplicate
# is_live rows racing the partial unique index across multiple uvicorn workers).
_BACKFILL_LOCK_KEY = 478221143


def backfill_prompt_version_baselines(schema_id=None):
    """Seed an 'import' baseline version for every prompt_registry template that has
    no version row yet, so per-turn template_hash attribution (A3) joins to a known
    version (A1) even for prompts never edited via the UI. Idempotent; returns count seeded.

    Race-safe: a single advisory lock serializes concurrent workers, and existence is checked
    with ONE query (not per-prompt), so a second worker simply finds everything seeded and
    inserts nothing. Safe to run on startup / first deploy.
    """
    if schema_id:
        schemas = fetchall("SELECT id, name, descision_tree FROM learning_system_schemas WHERE id=%s", (schema_id,))
    else:
        schemas = fetchall("SELECT id, name, descision_tree FROM learning_system_schemas")
    seeded = 0
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_BACKFILL_LOCK_KEY,))
            cur.execute("SELECT schema_id, prompt_id FROM prompt_versions")
            existing = {(str(r["schema_id"]), r["prompt_id"]) for r in cur.fetchall()}
            for sch in schemas:
                registry = (sch["descision_tree"] or {}).get("prompt_registry", {})
                for pid, entry in registry.items():
                    if not isinstance(entry, dict):
                        continue
                    content = entry.get("template", "")
                    if not content or (str(sch["id"]), pid) in existing:
                        continue
                    cur.execute("""
                        INSERT INTO prompt_versions
                            (schema_id, schema_name, prompt_id, content, content_hash, author, source, is_live)
                        VALUES (%s, %s, %s, %s, %s, 'system-backfill', 'import', TRUE)
                    """, (str(sch["id"]), sch["name"], pid, content, hash_prompt_template(content)))
                    seeded += 1
        conn.commit()
        return seeded
    finally:
        conn.close()


def insert_pedagogy_eval_session(vector):
    """Insert one per-session multi-objective vector row. Returns new id."""
    from psycopg2.extras import Json
    row = execute_returning("""
        INSERT INTO pedagogy_eval_sessions
            (run_id, session_id, capsule_id, fixture_set, rubric_version,
             pedagogy_quality, consensus_variance, p50_latency_ms, tokens_per_turn,
             total_turns, session_completion, forfeit_rate, decision, reasons,
             template_hash, model_version)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id
    """, (
        vector.get("run_id"), vector.get("session_id"), vector.get("capsule_id"),
        vector.get("fixture_set"), vector.get("rubric_version"),
        vector.get("pedagogy_quality"), vector.get("consensus_variance"),
        vector.get("p50_latency_ms"), vector.get("tokens_per_turn"),
        vector.get("total_turns"), vector.get("session_completion"),
        vector.get("forfeit_rate"), vector.get("decision"),
        Json(vector.get("reasons") or []),
        vector.get("template_hash"), vector.get("model_version"),
    ))
    return row["id"] if row else None


def insert_pedagogy_eval_result(rows, vector):
    """Atomically write a session's per-(dimension,judge) rows AND its multi-objective
    vector in ONE transaction. Prevents orphan rows (raw rows with no vector, or vice
    versa) if the process dies mid-write. Returns the new vector id."""
    from psycopg2.extras import execute_values, Json
    run_cols = ("run_id", "session_id", "capsule_id", "fixture_set", "rubric_version",
                "dimension", "judge_name", "judge_family", "judge_provider", "judge_model",
                "score", "score_norm", "flags", "fell_back", "reasoning",
                "template_hash", "model_version")
    run_values = [
        tuple(Json(r[c]) if c == "flags" else r.get(c) for c in run_cols)
        for r in rows
    ]
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if run_values:
                execute_values(
                    cur,
                    f"INSERT INTO pedagogy_eval_runs ({', '.join(run_cols)}) VALUES %s",
                    run_values,
                )
            cur.execute("""
                INSERT INTO pedagogy_eval_sessions
                    (run_id, session_id, capsule_id, fixture_set, rubric_version,
                     pedagogy_quality, consensus_variance, p50_latency_ms, tokens_per_turn,
                     total_turns, session_completion, forfeit_rate, decision, reasons,
                     template_hash, model_version)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, (
                vector.get("run_id"), vector.get("session_id"), vector.get("capsule_id"),
                vector.get("fixture_set"), vector.get("rubric_version"),
                vector.get("pedagogy_quality"), vector.get("consensus_variance"),
                vector.get("p50_latency_ms"), vector.get("tokens_per_turn"),
                vector.get("total_turns"), vector.get("session_completion"),
                vector.get("forfeit_rate"), vector.get("decision"),
                Json(vector.get("reasons") or []),
                vector.get("template_hash"), vector.get("model_version"),
            ))
            new_id = cur.fetchone()["id"]
        conn.commit()
        return new_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def list_prompt_versions(schema_id, prompt_id):
    """Version history (metadata only, newest first) for one prompt template."""
    return fetchall("""
        SELECT id, prompt_id, content_hash, author, source, note, is_live, created_at
        FROM prompt_versions
        WHERE schema_id = %s AND prompt_id = %s
        ORDER BY created_at DESC
    """, (schema_id, prompt_id))


def get_prompt_version(version_id):
    """Full row (incl. content) of a single version — for diff / preview / restore."""
    return fetchone("SELECT * FROM prompt_versions WHERE id = %s", (version_id,))


def promote_prompt_version(version_id, author=""):
    """Restore a historical version's content into the live prompt_registry (atomic).

    Delegates to apply_prompt_template so the live descision_tree write and the new
    'rollback' version row commit in one transaction under the per-schema advisory lock.
    Returns the same {"status": ..., "version": ...} dict as apply_prompt_template, with an
    extra "version_not_found" status when the version_id doesn't exist.
    """
    ver = get_prompt_version(version_id)
    if not ver:
        return {"status": "version_not_found", "version": None}
    return apply_prompt_template(
        ver["schema_id"], ver["prompt_id"], ver["content"],
        author=author, source="rollback", note=f"restored version {version_id}")


def aggregate_pedagogy_scores(rubric_version, *, fixture_set=None, template_hash=None,
                              model_version=None, run_id=None):
    """Read-time aggregation for the reporting endpoint.

    Returns {dimensions: [...per-dimension p50/p95...], multi_objective: {...}}.
    Slices by optional fixture_set / template_hash / model_version. p50/p95 are
    computed here (not stored), mirroring reporting_routes' prompt-version endpoint.

    RUN ISOLATION: a fixture_set can be scored multiple times (each run a fresh run_id).
    Pooling all of them would double-count and make the numbers depend on how many times
    the scorer ran. So when an explicit run_id isn't given but a fixture_set is, default
    to that fixture_set's LATEST run.
    """
    if run_id is None and fixture_set is not None:
        latest = fetchone(
            "SELECT run_id FROM pedagogy_eval_sessions WHERE fixture_set = %s "
            "ORDER BY created_at DESC LIMIT 1", (fixture_set,))
        run_id = latest["run_id"] if latest else None

    dim_clauses = ["rubric_version = %s", "score_norm IS NOT NULL"]
    dim_params = [int(rubric_version)]
    sess_clauses = ["rubric_version = %s"]
    sess_params = [int(rubric_version)]
    for col, val in (("run_id", run_id),
                     ("fixture_set", fixture_set),
                     ("template_hash", template_hash),
                     ("model_version", model_version)):
        if val is not None:
            dim_clauses.append(f"{col} = %s")
            dim_params.append(val)
            sess_clauses.append(f"{col} = %s")
            sess_params.append(val)
    dim_where = " AND ".join(dim_clauses)
    sess_where = " AND ".join(sess_clauses)

    dimensions = fetchall(f"""
        SELECT dimension,
               COUNT(*)                                                          AS n,
               AVG(score_norm)::float8                                           AS mean_norm,
               (PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY score_norm))::float8 AS p50_norm,
               (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY score_norm))::float8 AS p95_norm,
               AVG(score::numeric)::float8                                       AS mean_score_1_5,
               AVG(CASE WHEN fell_back THEN 1.0 ELSE 0.0 END)::float8            AS fell_back_rate
        FROM pedagogy_eval_runs
        WHERE {dim_where}
        GROUP BY dimension
        ORDER BY dimension
    """, tuple(dim_params))

    multi = fetchone(f"""
        SELECT COUNT(*)                                                              AS sessions,
               AVG(pedagogy_quality)::float8                                         AS avg_quality,
               (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pedagogy_quality))::float8 AS p50_quality,
               AVG(p50_latency_ms)::float8                                           AS avg_p50_latency_ms,
               AVG(tokens_per_turn)::float8                                          AS avg_tokens_per_turn,
               AVG(consensus_variance)::float8                                       AS avg_consensus_variance
        FROM pedagogy_eval_sessions
        WHERE {sess_where}
    """, tuple(sess_params))

    return {"run_id": run_id,
            "dimensions": dimensions or [],
            "multi_objective": dict(multi) if multi else {}}
