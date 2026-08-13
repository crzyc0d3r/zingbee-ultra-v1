"""Data-access layer for the Quests demo restoration.

ISOLATION CONTRACT
------------------
Every Quests table lives in the dedicated `quests` Postgres schema
(created by db/migrations/003_quest_projects_schema.sql). Every query below is
FULLY schema-qualified — `quest_projects.<table>` for Quests tables and
`public.<table>` for the pre-existing quest tables — so this module can never
touch, alter, or constrain the Tutors learning system in `public`.

This module is purely additive: it reuses `db.py` (READ-ONLY reuse) as the
connection/query layer and adds no shared state.

psycopg2 returns UUID and datetime objects; the private serializers here
convert every UUID to str() and every datetime to .isoformat() so callers get
JSON-ready dicts whose keys match the frontend TypeScript interfaces.
"""

import logging

import db as database

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def _s(value):
    """UUID/datetime -> str; everything else passes through unchanged."""
    if value is None:
        return None
    # datetime / date carry isoformat(); UUID does not.
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _serialize_chat_session(row):
    """Raw quest_projects.chat_sessions row -> ChatSession dict."""
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "student_id": row["student_id"],
        "quest_id": str(row["quest_id"]) if row.get("quest_id") is not None else None,
        "project_id": str(row["project_id"]) if row.get("project_id") is not None else None,
        "subject_id": row.get("subject_id"),
        "theme_id": row.get("theme_id"),
        "thread_id": row.get("thread_id"),
        "started_at": _s(row.get("started_at")),
        "ended_at": _s(row.get("ended_at")),
        "duration_minutes": row.get("duration_minutes"),
        "session_preview": row.get("session_preview"),
        "is_active": row.get("is_active"),
    }


def _serialize_chat_message(row):
    """Raw quest_projects.chat_messages row -> ChatMessage dict."""
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "session_id": str(row["session_id"]),
        "role": row["role"],
        "content": row.get("content"),
        "message_type": row.get("message_type"),
        "media_url": row.get("media_url"),
        "created_at": _s(row.get("created_at")),
    }


def _serialize_project(row):
    """Raw quest_projects.projects row (+ file_count) -> Project dict."""
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "student_id": row["student_id"],
        "name": row["name"],
        "description": row.get("description"),
        "created_at": _s(row.get("created_at")),
        "updated_at": _s(row.get("updated_at")),
        "file_count": int(row.get("file_count") or 0),
    }


def _serialize_project_file(row):
    """Raw quest_projects.project_files row -> ProjectFile dict.

    Note: `extracted_text` is intentionally NOT surfaced — the frontend
    ProjectFile interface does not carry it (it is used server-side only for
    building chat context via get_project_context_text).
    """
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "project_id": str(row["project_id"]),
        "name": row["name"],
        "description": row.get("description"),
        "original_filename": row.get("original_filename"),
        "file_path": row.get("file_path"),
        "file_size": row.get("file_size"),
        "mime_type": row.get("mime_type"),
        "is_embedded": row.get("is_embedded"),
        "embedding_error": row.get("embedding_error"),
        "created_at": _s(row.get("created_at")),
    }


# ---------------------------------------------------------------------------
# Chat sessions  (quest_projects.chat_sessions)
# ---------------------------------------------------------------------------

def create_chat_session(student_id, quest_id=None, project_id=None,
                        subject_id=None, theme_id=None, thread_id=None):
    """Create a chat session and return the ChatSession dict."""
    row = database.execute_returning(
        """
        INSERT INTO quest_projects.chat_sessions
            (student_id, quest_id, project_id, subject_id, theme_id, thread_id)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (student_id, quest_id, project_id, subject_id, theme_id, thread_id),
    )
    return _serialize_chat_session(row)


def list_chat_sessions(student_id, quest_id=None, project_id=None,
                       subject_id=None, theme_id=None):
    """List a student's chat sessions, newest first, with optional filters."""
    clauses = ["student_id = %s"]
    params = [student_id]
    if quest_id is not None:
        clauses.append("quest_id = %s")
        params.append(quest_id)
    if project_id is not None:
        clauses.append("project_id = %s")
        params.append(project_id)
    if subject_id is not None:
        clauses.append("subject_id = %s")
        params.append(subject_id)
    if theme_id is not None:
        clauses.append("theme_id = %s")
        params.append(theme_id)

    rows = database.fetchall(
        f"""
        SELECT *
        FROM quest_projects.chat_sessions
        WHERE {' AND '.join(clauses)}
        ORDER BY started_at DESC
        """,
        tuple(params),
    )
    return [_serialize_chat_session(r) for r in rows]


def get_chat_session(session_id):
    """Get a single chat session by id, or None."""
    row = database.fetchone(
        "SELECT * FROM quest_projects.chat_sessions WHERE id = %s",
        (session_id,),
    )
    return _serialize_chat_session(row)


def get_chat_session_with_messages(session_id):
    """Get a chat session plus its messages (oldest first), or None."""
    session = get_chat_session(session_id)
    if session is None:
        return None
    session["messages"] = list_chat_messages(session_id)
    return session


def delete_chat_session(session_id):
    """Delete a chat session (messages cascade via FK)."""
    database.execute(
        "DELETE FROM quest_projects.chat_sessions WHERE id = %s",
        (session_id,),
    )


def set_session_preview(session_id, preview):
    """Set the short history-sidebar preview text for a session."""
    database.execute(
        "UPDATE quest_projects.chat_sessions SET session_preview = %s WHERE id = %s",
        (preview, session_id),
    )


def get_chat_stats(student_id):
    """Dashboard stat tiles for a student, computed from quest_projects.* only.

    topics_covered  -> distinct quests the student has chatted about
    day_streak      -> distinct calendar days with a session (demo proxy)
    minutes_learning-> summed session duration (0 when unrecorded)
    """
    row = database.fetchone(
        """
        SELECT
            COUNT(DISTINCT quest_id)                          AS topics_covered,
            COUNT(DISTINCT started_at::date)                  AS day_streak,
            COALESCE(SUM(duration_minutes), 0)::int           AS minutes_learning
        FROM quest_projects.chat_sessions
        WHERE student_id = %s
        """,
        (student_id,),
    )
    return {
        "topics_covered": (row or {}).get("topics_covered", 0) or 0,
        "day_streak": (row or {}).get("day_streak", 0) or 0,
        "minutes_learning": (row or {}).get("minutes_learning", 0) or 0,
    }


# ---------------------------------------------------------------------------
# Chat messages  (quest_projects.chat_messages)
# ---------------------------------------------------------------------------

def add_chat_message(session_id, role, content, message_type=None, media_url=None):
    """Append a message to a session and return the ChatMessage dict."""
    row = database.execute_returning(
        """
        INSERT INTO quest_projects.chat_messages
            (session_id, role, content, message_type, media_url)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING *
        """,
        (session_id, role, content, message_type, media_url),
    )
    return _serialize_chat_message(row)


def list_chat_messages(session_id):
    """List a session's messages, oldest first."""
    rows = database.fetchall(
        """
        SELECT *
        FROM quest_projects.chat_messages
        WHERE session_id = %s
        ORDER BY created_at ASC
        """,
        (session_id,),
    )
    return [_serialize_chat_message(r) for r in rows]


# ---------------------------------------------------------------------------
# Projects  (quest_projects.projects)
# ---------------------------------------------------------------------------

def create_project(student_id, name, description=None):
    """Create a project and return the Project dict (file_count = 0)."""
    row = database.execute_returning(
        """
        INSERT INTO quest_projects.projects (student_id, name, description)
        VALUES (%s, %s, %s)
        RETURNING *
        """,
        (student_id, name, description),
    )
    result = _serialize_project(row)
    result["file_count"] = 0
    return result


def list_projects(student_id):
    """List a student's projects, newest first, each with its file_count."""
    rows = database.fetchall(
        """
        SELECT p.*, COUNT(f.id) AS file_count
        FROM quest_projects.projects p
        LEFT JOIN quest_projects.project_files f ON f.project_id = p.id
        WHERE p.student_id = %s
        GROUP BY p.id
        ORDER BY p.created_at DESC
        """,
        (student_id,),
    )
    return [_serialize_project(r) for r in rows]


def get_project(project_id):
    """Get a single project (with file_count), or None."""
    row = database.fetchone(
        """
        SELECT p.*, COUNT(f.id) AS file_count
        FROM quest_projects.projects p
        LEFT JOIN quest_projects.project_files f ON f.project_id = p.id
        WHERE p.id = %s
        GROUP BY p.id
        """,
        (project_id,),
    )
    return _serialize_project(row)


def update_project(project_id, name=None, description=None):
    """Update the provided fields on a project, bump updated_at, return it."""
    set_clauses = ["updated_at = NOW()"]
    params = []
    if name is not None:
        set_clauses.append("name = %s")
        params.append(name)
    if description is not None:
        set_clauses.append("description = %s")
        params.append(description)
    params.append(project_id)

    database.execute(
        f"UPDATE quest_projects.projects SET {', '.join(set_clauses)} WHERE id = %s",
        tuple(params),
    )
    return get_project(project_id)


def delete_project(project_id):
    """Delete a project (files and project-scoped sessions cascade via FK)."""
    database.execute(
        "DELETE FROM quest_projects.projects WHERE id = %s",
        (project_id,),
    )


# ---------------------------------------------------------------------------
# Project files  (quest_projects.project_files)
# ---------------------------------------------------------------------------

def add_project_file(project_id, name, original_filename, file_path=None,
                     file_size=None, mime_type=None, extracted_text=None,
                     is_embedded=False, embedding_error=None):
    """Attach an uploaded file to a project and return the ProjectFile dict."""
    row = database.execute_returning(
        """
        INSERT INTO quest_projects.project_files
            (project_id, name, original_filename, file_path, file_size,
             mime_type, extracted_text, is_embedded, embedding_error)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (project_id, name, original_filename, file_path, file_size,
         mime_type, extracted_text, is_embedded, embedding_error),
    )
    return _serialize_project_file(row)


def list_project_files(project_id):
    """List a project's files, newest first."""
    rows = database.fetchall(
        """
        SELECT *
        FROM quest_projects.project_files
        WHERE project_id = %s
        ORDER BY created_at DESC
        """,
        (project_id,),
    )
    return [_serialize_project_file(r) for r in rows]


def delete_project_file(file_id):
    """Delete a single project file."""
    database.execute(
        "DELETE FROM quest_projects.project_files WHERE id = %s",
        (file_id,),
    )


def get_project_context_text(project_id, max_chars=12000):
    """Concatenate a project's files' extracted_text (NULLs skipped), each
    prefixed with the file name, truncated to max_chars characters.
    """
    rows = database.fetchall(
        """
        SELECT name, extracted_text
        FROM quest_projects.project_files
        WHERE project_id = %s AND extracted_text IS NOT NULL
        ORDER BY created_at ASC
        """,
        (project_id,),
    )

    parts = []
    for r in rows:
        text = r.get("extracted_text")
        if not text:
            continue
        parts.append(f"# {r['name']}\n{text}")

    combined = "\n\n".join(parts)
    if max_chars is not None and len(combined) > max_chars:
        combined = combined[:max_chars]
    return combined


# ---------------------------------------------------------------------------
# Quests  (public.quests — READ ONLY)
# ---------------------------------------------------------------------------

def get_quest(quest_id):
    """Read a quest from public.quests (READ ONLY). Returns dict or None.

    Includes voice_prompt, voice (per-quest xAI voice), title (jsonb, passed
    through), assistant_id, and bg_color. This module never writes to
    public.quests.
    """
    row = database.fetchone(
        """
        SELECT id, title, voice_prompt, voice, assistant_id, bg_color
        FROM public.quests
        WHERE id = %s
        """,
        (quest_id,),
    )
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "title": row.get("title"),
        "voice_prompt": row.get("voice_prompt"),
        "voice": row.get("voice"),
        "assistant_id": row.get("assistant_id"),
        "bg_color": row.get("bg_color"),
    }
