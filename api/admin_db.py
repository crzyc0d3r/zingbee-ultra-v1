"""Generic CRUD database layer for ZingBee RT Studio admin.

Provides table-agnostic CRUD operations with SQL injection protection
via strict table/column whitelisting against information_schema.
"""

import json
import logging
from decimal import Decimal
from datetime import datetime, date

import psycopg2
import psycopg2.extras

from db import get_conn

log = logging.getLogger(__name__)

# Allowed tables for CRUD operations (whitelist prevents SQL injection)
ALLOWED_TABLES = {
    "subjects", "subject_curriculum", "curriculum_themes",
    "curriculum_capsules", "curriculum_facts", "users", "students",
    "learning_sessions", "learning_session_messages",
    "tutors", "learning_system_schemas", "learning_session_feedback",
    "eval_runs",
}

# Primary key column per table (non-standard PKs need explicit mapping)
PK_MAP = {
    "students": "student_id",
}

# Foreign key metadata for the UI (table -> [{col, ref_table, ref_col, label_col}])
FK_MAP = {
    "subject_curriculum": [
        {"col": "subject_id", "ref_table": "subjects", "ref_col": "id", "label_col": "name"},
    ],
    "curriculum_themes": [
        {"col": "subject_curriculum_id", "ref_table": "subject_curriculum", "ref_col": "id", "label_col": "phase"},
        {"col": "tutor_id", "ref_table": "tutors", "ref_col": "id", "label_col": "persona->>'tutor_name'"},
        {"col": "learning_system_id", "ref_table": "learning_system_schemas", "ref_col": "id", "label_col": "name"},
    ],
    "curriculum_capsules": [
        {"col": "curriculum_theme_id", "ref_table": "curriculum_themes", "ref_col": "id", "label_col": "name"},
    ],
    "curriculum_facts": [
        {"col": "curriculum_capsule_id", "ref_table": "curriculum_capsules", "ref_col": "id", "label_col": "name"},
    ],
    "students": [
        {"col": "user_id", "ref_table": "users", "ref_col": "id", "label_col": "display_name"},
    ],
    "learning_sessions": [
        {"col": "user_id", "ref_table": "users", "ref_col": "id", "label_col": "display_name"},
        {"col": "student_id", "ref_table": "students", "ref_col": "student_id", "label_col": "name"},
        {"col": "curriculum_capsule_id", "ref_table": "curriculum_capsules", "ref_col": "id", "label_col": "name"},
    ],
    "learning_session_messages": [
        {"col": "learning_session_id", "ref_table": "learning_sessions", "ref_col": "id", "label_col": "id"},
    ],
    "learning_session_feedback": [
        {"col": "learning_session_id", "ref_table": "learning_sessions", "ref_col": "id", "label_col": "id"},
        {"col": "user_id", "ref_table": "users", "ref_col": "id", "label_col": "display_name"},
        {"col": "student_id", "ref_table": "students", "ref_col": "student_id", "label_col": "name"},
    ],
}


# ---------------------------------------------------------------------------
# Hierarchy: parent-child relationships for drill-down navigation
# ---------------------------------------------------------------------------

# Children of each table: [{table, fk, label}]
CHILD_TABLES = {
    "subjects": [
        {"table": "subject_curriculum", "fk": "subject_id", "label": "Subject Curriculums"},
    ],
    "subject_curriculum": [
        {"table": "curriculum_themes", "fk": "subject_curriculum_id", "label": "Curriculum Themes"},
    ],
    "curriculum_themes": [
        {"table": "curriculum_capsules", "fk": "curriculum_theme_id", "label": "Curriculum Capsules"},
    ],
    "curriculum_capsules": [
        {"table": "curriculum_facts", "fk": "curriculum_capsule_id", "label": "Curriculum Facts"},
    ],
    "users": [
        {"table": "students", "fk": "user_id", "label": "Students"},
    ],
    "students": [],
    "learning_sessions": [
        {"table": "learning_session_messages", "fk": "learning_session_id", "label": "Session Messages"},
        {"table": "learning_session_feedback", "fk": "learning_session_id", "label": "Session Feedback"},
    ],
}

# Human-readable label for each table
TABLE_LABELS = {
    "subjects": "Subjects",
    "subject_curriculum": "Subject Curriculums",
    "curriculum_themes": "Curriculum Themes",
    "curriculum_capsules": "Curriculum Capsules",
    "curriculum_facts": "Curriculum Facts",
    "users": "Users",
    "students": "Students",
    "learning_sessions": "Learning Sessions",
    "learning_session_messages": "Learning Session Messages",
    "learning_session_feedback": "Learning Session Feedback",
    "tutors": "Tutors",
    "learning_system_schemas": "Learning System Schemas",
    "eval_runs": "Eval Runs",
}

# Column to use as display label for breadcrumbs
LABEL_COL = {
    "subjects": "name",
    "subject_curriculum": "phase",
    "curriculum_themes": "name",
    "curriculum_capsules": "name",
    "curriculum_facts": "meta_data->>'core_fact'",
    "users": "display_name",
    "students": "name",
    "learning_sessions": "id",
    "learning_session_messages": "id",
    "learning_session_feedback": "id",
    "tutors": "id",
    "learning_system_schemas": "name",
    "eval_runs": "job_id",
}

# Sidebar groups (only root tables shown)
ROOT_GROUPS = [
    {"label": "Curriculum", "icon": "&#128218;", "tables": ["subjects"]},
    {"label": "Users", "icon": "&#128100;", "tables": ["users"]},
    {"label": "Sessions", "icon": "&#128172;", "tables": ["learning_sessions"]},
    {"label": "AI", "icon": "&#129302;", "tables": ["tutors", "learning_system_schemas"]},
    {"label": "Evals", "icon": "&#128200;", "tables": ["eval_runs"]},
]


def get_hierarchy() -> dict:
    """Return full hierarchy metadata for the frontend."""
    return {
        "root_groups": ROOT_GROUPS,
        "children": CHILD_TABLES,
        "labels": TABLE_LABELS,
        "label_col": LABEL_COL,
        "pk_map": PK_MAP,
    }


def _validate_table(table: str):
    if table not in ALLOWED_TABLES:
        raise ValueError(f"Table '{table}' is not allowed")


def _get_pk(table: str) -> str:
    return PK_MAP.get(table, "id")


def _serialize_value(val):
    """Convert Python types to JSON-safe values."""
    if val is None:
        return None
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, dict) or isinstance(val, list):
        return val
    return val


def _serialize_row(row):
    """Serialize a RealDictRow to JSON-safe dict."""
    if row is None:
        return None
    return {k: _serialize_value(v) for k, v in row.items()}


def _serialize_rows(rows):
    return [_serialize_row(r) for r in rows]


def _prepare_value(val, col_type: str):
    """Prepare a value for insertion based on column type."""
    if val is None or val == "":
        return None
    if col_type in ("jsonb", "json"):
        if isinstance(val, str):
            return val  # psycopg2 handles JSON strings
        return json.dumps(val)
    return val


# ---------------------------------------------------------------------------
# Schema introspection
# ---------------------------------------------------------------------------

def get_table_columns(table: str) -> list:
    """Get column metadata from information_schema."""
    _validate_table(table)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT column_name, data_type, udt_name,
                       is_nullable, column_default,
                       character_maximum_length
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s
                ORDER BY ordinal_position
            """, (table,))
            cols = []
            for row in cur.fetchall():
                cols.append({
                    "name": row["column_name"],
                    "type": row["udt_name"],
                    "data_type": row["data_type"],
                    "nullable": row["is_nullable"] == "YES",
                    "has_default": row["column_default"] is not None,
                    "max_length": row["character_maximum_length"],
                })
            return cols
    finally:
        conn.close()


def get_table_schema(table: str) -> dict:
    """Full table schema including PK, FK, and column info."""
    _validate_table(table)
    columns = get_table_columns(table)
    col_names = {c["name"] for c in columns}
    pk = _get_pk(table)
    fks = FK_MAP.get(table, [])
    return {
        "table": table,
        "pk": pk,
        "columns": columns,
        "column_names": sorted(col_names),
        "fks": fks,
    }


def list_tables() -> list:
    """Return metadata for all allowed tables."""
    result = []
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for table in sorted(ALLOWED_TABLES):
                cur.execute(f'SELECT COUNT(*) AS cnt FROM "{table}"')
                row = cur.fetchone()
                result.append({
                    "name": table,
                    "pk": _get_pk(table),
                    "row_count": row["cnt"] if row else 0,
                })
        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------

def count_rows(table: str, search: str = None, search_cols: list = None,
               filter_col: str = None, filter_val: str = None) -> int:
    """Count rows, optionally filtered by parent FK and/or search."""
    _validate_table(table)
    valid_cols = {c["name"] for c in get_table_columns(table)}
    conditions = []
    params = []

    # Parent FK filter
    if filter_col and filter_val and filter_col in valid_cols:
        conditions.append(f'"{filter_col}" = %s')
        params.append(filter_val)

    # Search filter
    if search and search_cols:
        safe_cols = [c for c in search_cols if c in valid_cols]
        if safe_cols:
            search_conds = [f'CAST("{c}" AS TEXT) ILIKE %s' for c in safe_cols]
            conditions.append("(" + " OR ".join(search_conds) + ")")
            params.extend([f"%{search}%" for _ in safe_cols])

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f'SELECT COUNT(*) AS cnt FROM "{table}" {where}', tuple(params))
            return cur.fetchone()["cnt"]
    finally:
        conn.close()


def list_rows(table: str, limit: int = 50, offset: int = 0,
              order_by: str = None, order_dir: str = "ASC",
              search: str = None, search_cols: list = None,
              filter_col: str = None, filter_val: str = None) -> list:
    """Paginated row listing with optional sort, search, and parent FK filter."""
    _validate_table(table)
    columns = get_table_columns(table)
    col_names = {c["name"] for c in columns}

    # Validate order_by column
    if order_by and order_by in col_names:
        order_clause = f'ORDER BY "{order_by}" {("DESC" if order_dir.upper() == "DESC" else "ASC")}'
    else:
        pk = _get_pk(table)
        order_clause = f'ORDER BY "{pk}" ASC'

    # Build WHERE clause
    conditions = []
    params = []

    # Parent FK filter
    if filter_col and filter_val and filter_col in col_names:
        conditions.append(f'"{filter_col}" = %s')
        params.append(filter_val)

    # Search filter
    if search and search_cols:
        valid_cols = [c for c in search_cols if c in col_names]
        if valid_cols:
            search_conds = [f'CAST("{c}" AS TEXT) ILIKE %s' for c in valid_cols]
            conditions.append("(" + " OR ".join(search_conds) + ")")
            params.extend([f"%{search}%" for _ in valid_cols])

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.extend([limit, offset])

    # Special select for tables with JSONB fields that need extraction
    if table == "curriculum_facts":
        select = "SELECT *, meta_data->>'core_fact' AS fact_name FROM \"curriculum_facts\""
    elif table == "tutors":
        select = "SELECT *, persona->>'tutor_name' AS tutor_name FROM \"tutors\""
    elif table == "curriculum_themes":
        select = """SELECT ct.*, t.persona->>'tutor_name' AS tutor_name,
                           ls.name AS learning_system_name
                    FROM "curriculum_themes" ct
                    LEFT JOIN tutors t ON ct.tutor_id = t.id
                    LEFT JOIN learning_system_schemas ls ON ct.learning_system_id = ls.id"""
    else:
        select = f'SELECT * FROM "{table}"'

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f'{select} {where} {order_clause} LIMIT %s OFFSET %s',
                tuple(params)
            )
            return _serialize_rows(cur.fetchall())
    finally:
        conn.close()


def get_row(table: str, pk_val: str) -> dict:
    """Get a single row by primary key."""
    _validate_table(table)
    pk = _get_pk(table)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f'SELECT * FROM "{table}" WHERE "{pk}" = %s', (pk_val,))
            row = cur.fetchone()
            return _serialize_row(row)
    finally:
        conn.close()


def create_row(table: str, data: dict) -> dict:
    """Insert a new row. Returns the created row."""
    _validate_table(table)
    columns = get_table_columns(table)
    col_type_map = {c["name"]: c["type"] for c in columns}
    col_names_set = set(col_type_map.keys())

    # Filter to valid columns only, skip columns with defaults if not provided
    insert_cols = []
    insert_vals = []
    for k, v in data.items():
        if k in col_names_set:
            insert_cols.append(k)
            insert_vals.append(_prepare_value(v, col_type_map[k]))

    if not insert_cols:
        raise ValueError("No valid columns provided")

    col_list = ", ".join(f'"{c}"' for c in insert_cols)
    placeholder_list = ", ".join(["%s"] * len(insert_cols))

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholder_list}) RETURNING *',
                tuple(insert_vals)
            )
            row = cur.fetchone()
        conn.commit()
        return _serialize_row(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_row(table: str, pk_val: str, data: dict) -> dict:
    """Update a row by primary key. Returns the updated row."""
    _validate_table(table)
    pk = _get_pk(table)
    columns = get_table_columns(table)
    col_type_map = {c["name"]: c["type"] for c in columns}
    col_names_set = set(col_type_map.keys())

    # Build SET clause - only update provided columns (skip PK)
    set_parts = []
    vals = []
    for k, v in data.items():
        if k in col_names_set and k != pk:
            set_parts.append(f'"{k}" = %s')
            vals.append(_prepare_value(v, col_type_map[k]))

    if not set_parts:
        raise ValueError("No valid columns to update")

    vals.append(pk_val)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f'UPDATE "{table}" SET {", ".join(set_parts)} WHERE "{pk}" = %s RETURNING *',
                tuple(vals)
            )
            row = cur.fetchone()
        conn.commit()
        return _serialize_row(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


_PROTECTED_TABLES = {"learning_sessions", "learning_session_messages", "learning_session_feedback", "eval_runs"}


def delete_row(table: str, pk_val: str) -> bool:
    """Delete a row by primary key. Returns True if deleted."""
    _validate_table(table)
    if table in _PROTECTED_TABLES:
        raise ValueError(f"Deleting from '{table}' is not allowed. Sessions and feedback must be preserved.")
    pk = _get_pk(table)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f'DELETE FROM "{table}" WHERE "{pk}" = %s', (pk_val,))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def resolve_fk_labels(table: str, rows: list) -> dict:
    """For each FK column in a table, build a map: {fk_col: {pk_val: label}}.

    Used by the grid to display human-readable labels instead of UUIDs.
    """
    fks = FK_MAP.get(table, [])
    if not fks or not rows:
        return {}
    result = {}
    for fk in fks:
        col = fk["col"]
        ref_table_name = fk["ref_table"]
        ref_col = fk["ref_col"]
        label_col = fk["label_col"]
        # Collect unique FK values from the rows
        vals = set()
        for r in rows:
            v = r.get(col)
            if v is not None:
                vals.add(v)
        if not vals:
            continue
        # Look up labels
        _validate_table(ref_table_name)
        ref_columns = get_table_columns(ref_table_name)
        ref_col_names = {c["name"] for c in ref_columns}
        # For JSONB path expressions (e.g. "fact->>'text'"), check the base column
        is_jsonb_expr = "->" in label_col
        base_label_col = label_col.split("->")[0].strip("\"'") if is_jsonb_expr else label_col
        if ref_col not in ref_col_names or base_label_col not in ref_col_names:
            continue
        # JSONB expressions must not be double-quoted
        label_sql = label_col if is_jsonb_expr else f'"{label_col}"'
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                placeholders = ",".join(["%s"] * len(vals))
                cur.execute(
                    f'SELECT "{ref_col}" AS val, {label_sql} AS lbl FROM "{ref_table_name}" WHERE "{ref_col}" IN ({placeholders})',
                    tuple(vals)
                )
                label_map = {}
                for row in cur.fetchall():
                    lbl = _serialize_value(row["lbl"])
                    label_map[str(_serialize_value(row["val"]))] = str(lbl) if lbl is not None else None
                result[col] = label_map
        finally:
            conn.close()
    return result


# ---------------------------------------------------------------------------
# Stats / analytics for D3 dashboard
# ---------------------------------------------------------------------------

def get_dashboard_stats() -> dict:
    """Aggregate data for the admin D3 dashboard."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # --- Summary counts ---
            counts = {}
            for t in ["subjects", "students", "learning_sessions", "curriculum_facts"]:
                cur.execute(f'SELECT COUNT(*) AS cnt FROM "{t}"')
                counts[t] = cur.fetchone()["cnt"]
            # Alias for frontend compatibility
            counts["sessions"] = counts["learning_sessions"]

            # Completed capsules + mastered facts from report_card JSONB
            cur.execute("""
                SELECT COALESCE(SUM((val->>'completed_capsules')::int), 0) AS completed,
                       COALESCE(SUM((val->>'mastered_facts')::int), 0) AS mastered
                FROM students s, jsonb_each(s.report_card) AS x(key, val)
                WHERE s.report_card IS NOT NULL AND s.report_card != '{}'
            """)
            rc_row = cur.fetchone()
            counts["completed_capsules"] = rc_row["completed"]
            counts["facts_mastered"] = rc_row["mastered"]

            # Students with any mastered facts in report_card
            cur.execute("""
                SELECT COUNT(*) AS cnt FROM students
                WHERE report_card IS NOT NULL AND report_card != '{}'
                  AND EXISTS (
                    SELECT 1 FROM jsonb_each(report_card) AS x(key, val)
                    WHERE (val->>'mastered_facts')::int > 0
                  )
            """)
            counts["students_with_mastery"] = cur.fetchone()["cnt"]

            # --- Curriculum tree (for sunburst) ---
            cur.execute("""
                SELECT s.id AS sid, s.name AS subject,
                       sc.id AS scid, sc.phase,
                       ct.id AS tid, ct.name AS theme,
                       COUNT(DISTINCT cc.id) AS capsule_count,
                       COUNT(DISTINCT cf.id) AS fact_count
                FROM subjects s
                JOIN subject_curriculum sc ON sc.subject_id = s.id
                LEFT JOIN curriculum_themes ct ON ct.subject_curriculum_id = sc.id
                LEFT JOIN curriculum_capsules cc ON cc.curriculum_theme_id = ct.id
                LEFT JOIN curriculum_facts cf ON cf.curriculum_capsule_id = cc.id
                GROUP BY s.id, s.name, sc.id, sc.phase, ct.id, ct.name
                ORDER BY s.name, sc.phase, ct.name
            """)
            tree_rows = cur.fetchall()

            # Build nested tree: subject -> phase -> theme -> {capsules, facts}
            subjects_map = {}
            for r in tree_rows:
                subj = r["subject"]
                if subj not in subjects_map:
                    subjects_map[subj] = {"name": subj, "id": str(r["sid"]), "children": {}}
                phase_key = f"Phase {r['phase']}"
                phases = subjects_map[subj]["children"]
                if phase_key not in phases:
                    phases[phase_key] = {"name": phase_key, "id": str(r["scid"]), "children": []}
                if r["theme"]:
                    phases[phase_key]["children"].append({
                        "name": r["theme"],
                        "id": str(r["tid"]),
                        "capsules": r["capsule_count"],
                        "value": max(r["fact_count"], 1),
                    })

            # Convert to D3-compatible tree
            curriculum_tree = {"name": "Curriculum", "children": []}
            for subj_data in subjects_map.values():
                subj_node = {"name": subj_data["name"], "id": subj_data["id"], "children": []}
                for phase_data in subj_data["children"].values():
                    subj_node["children"].append(phase_data)
                curriculum_tree["children"].append(subj_node)

            # --- Student progress (from report_card) ---
            cur.execute("""
                SELECT st.student_id, COALESCE(u.first_name || ' ' || u.last_name, st.student_id) AS name,
                    COALESCE(SUM((val->>'total_facts')::int), 0) AS total,
                    COALESCE(SUM((val->>'taught_facts')::int), 0) AS taught,
                    COALESCE(SUM((val->>'assessed_facts')::int), 0) AS assessed,
                    COALESCE(SUM((val->>'mastered_facts')::int), 0) AS mastered,
                    COALESCE(SUM((val->>'total_exposures')::int), 0) AS exposures
                FROM students st
                LEFT JOIN users u ON st.user_id = u.id, jsonb_each(st.report_card) AS x(key, val)
                WHERE st.report_card IS NOT NULL AND st.report_card != '{}'
                GROUP BY st.student_id, u.first_name, u.last_name
                ORDER BY SUM((val->>'mastered_facts')::int) DESC
            """)
            student_progress = []
            for r in cur.fetchall():
                student_progress.append({
                    "student_id": r["student_id"],
                    "name": r["name"] or r["student_id"][:12],
                    "total": r["total"],
                    "taught": r["taught"],
                    "assessed": r["assessed"],
                    "mastered": r["mastered"],
                    "correct": r["exposures"],
                    "incorrect": 0,
                })

            # --- Completed capsules per student with subject (from report_card JSONB) ---
            cur.execute("""
                SELECT st.student_id, COALESCE(u.first_name || ' ' || u.last_name, st.student_id) AS student, s.name AS subject,
                    COALESCE((val->>'completed_capsules')::int, 0) AS completed,
                    ROUND(COALESCE((val->>'total_credits')::numeric, 0) /
                          NULLIF((val->>'completed_capsules')::int, 0), 1) AS avg_credits
                FROM students st
                LEFT JOIN users u ON st.user_id = u.id,
                     jsonb_each(st.report_card) AS x(key, val)
                JOIN subjects s ON x.key ~ '^[0-9a-f]{8}-' AND s.id = x.key::uuid
                WHERE st.report_card IS NOT NULL AND st.report_card != '{}'
                  AND (val->>'completed_capsules')::int > 0
                ORDER BY st.student_id, s.name
            """)
            capsule_completion = []
            for r in cur.fetchall():
                capsule_completion.append({
                    "student_id": r["student_id"],
                    "student": r["student"],
                    "subject": r["subject"],
                    "completed": r["completed"],
                    "avg_credits": float(r["avg_credits"]) if r["avg_credits"] else 0,
                })

            # --- Session feedback sentiments ---
            cur.execute("""
                SELECT sentiment, COUNT(*) AS cnt
                FROM learning_session_feedback
                WHERE sentiment IS NOT NULL
                GROUP BY sentiment
            """)
            feedback = [{"label": r["sentiment"], "value": r["cnt"]} for r in cur.fetchall()]

            # --- Session stats ---
            cur.execute("""
                SELECT COALESCE(u.first_name || ' ' || u.last_name, st.student_id) AS student,
                    s.duration_seconds,
                    s.questions_asked,
                    s.correct_answers,
                    s.accuracy,
                    s.facts_taught_count,
                    s.start_time
                FROM learning_sessions s
                JOIN students st ON st.student_id = s.student_id
                LEFT JOIN users u ON st.user_id = u.id
                ORDER BY s.start_time DESC
                LIMIT 20
            """)
            session_stats = []
            for r in cur.fetchall():
                session_stats.append({
                    "student": r["student"],
                    "duration": r["duration_seconds"],
                    "questions": r["questions_asked"],
                    "correct": r["correct_answers"],
                    "accuracy": float(r["accuracy"]) if r["accuracy"] else None,
                    "facts_taught": r["facts_taught_count"],
                    "start_time": r["start_time"].isoformat() if r["start_time"] else None,
                })

            return {
                "counts": counts,
                "curriculum_tree": curriculum_tree,
                "student_progress": student_progress,
                "capsule_completion": capsule_completion,
                "feedback": feedback,
                "session_stats": session_stats,
            }
    finally:
        conn.close()


def get_fk_options(ref_table: str, ref_col: str, label_col: str,
                   limit: int = 200) -> list:
    """Get FK dropdown options: [{value, label}]."""
    _validate_table(ref_table)
    columns = get_table_columns(ref_table)
    col_names = {c["name"] for c in columns}
    is_jsonb_expr = "->" in label_col
    base_label_col = label_col.split("->")[0].strip("\"'") if is_jsonb_expr else label_col
    if ref_col not in col_names or base_label_col not in col_names:
        return []
    label_sql = label_col if is_jsonb_expr else f'"{label_col}"'
    order_sql = label_col if is_jsonb_expr else f'"{label_col}"'

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f'SELECT "{ref_col}" AS value, {label_sql} AS label FROM "{ref_table}" ORDER BY {order_sql} LIMIT %s',
                (limit,)
            )
            return [{"value": _serialize_value(r["value"]),
                      "label": str(_serialize_value(r["label"]))} for r in cur.fetchall()]
    finally:
        conn.close()
