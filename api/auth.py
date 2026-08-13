"""Shared authentication utilities for ZingBee RT Studio.

Provides get_auth_user(), verify_student_ownership(), and authenticate_user()
used by all route modules. The auth_sessions store is set at startup via init().
"""

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import HTTPException, Request

import db as database

SESSION_EXPIRY_DAYS = 30

# Service-to-service key for LiveKit agent → API calls.
# The agent runs server-side and uses this instead of user session cookies.
AGENT_API_KEY = os.environ.get("AGENT_API_KEY", "")


def format_display_name(record: dict, fallback_key: str = "student_id") -> str:
    """Build 'First Last' display name, falling back to record[fallback_key]."""
    name = ((record.get("first_name") or "") + " " + (record.get("last_name") or "")).strip()
    return name or (record.get(fallback_key, "") if fallback_key else "")

# Shared session store reference, set by init()
_auth_sessions = None


def init(auth_sessions_ref):
    """Bind the shared auth_sessions store. Called once from web_ui.py at startup."""
    global _auth_sessions
    _auth_sessions = auth_sessions_ref


def get_auth_user(request: Request) -> Optional[dict]:
    """Extract authenticated user from session cookie. Returns None if not authenticated."""
    if _auth_sessions is None:
        return None
    token = request.cookies.get("session_token")
    if not token or token not in _auth_sessions:
        return None
    info = _auth_sessions[token]
    if datetime.now(tz=timezone.utc) > info["expires"]:
        del _auth_sessions[token]
        return None
    # Surface user / student into trace context so every downstream log
    # record (DB, LLM, message) carries the same identifiers in Cloud Logging.
    try:
        from trace_logging import set_user_context
        set_user_context(user_id=str(info.get("user_id")) if info.get("user_id") else None,
                         student_id=info.get("student_id"))
    except Exception:
        pass
    return info


def get_auth_user_or_agent(request: Request) -> Optional[dict]:
    """Authenticate via session cookie OR agent service key.

    The LiveKit agent runs server-side and authenticates with X-Agent-Key header
    instead of a user session cookie. Returns a synthetic auth dict for agent calls.
    """
    # Try normal user auth first
    user = get_auth_user(request)
    if user:
        return user
    # Fall back to agent service key
    agent_key = request.headers.get("x-agent-key", "")
    if AGENT_API_KEY and agent_key and secrets.compare_digest(agent_key, AGENT_API_KEY):
        return {"role": "agent", "email": "livekit-agent@internal", "display_name": "LiveKit Agent"}
    return None


def authenticate_user(identifier: str, password: str) -> tuple[Optional[dict], Optional[str], Optional[dict]]:
    """Authenticate a user by email/display_name and password.

    Returns (user_dict, session_token, session_data) on success.
    Returns (None, None, None) on failure.
    """
    if _auth_sessions is None:
        return None, None, None
    user = database.get_user_by_identifier(identifier)
    if not user:
        return None, None, None
    if not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        return None, None, None

    students = database.get_students_for_user(user["id"])
    student_list = [
        {"student_id": s["student_id"], "name": format_display_name(s)}
        for s in students
    ]
    default_student_id = students[0]["student_id"] if students else None

    token = secrets.token_urlsafe(32)
    session_data = {
        "user_id": user["id"],
        "student_id": default_student_id,
        "students": student_list,
        "display_name": user["display_name"],
        "email": user["email"],
        "role": user.get("role"),
        "expires": datetime.now(tz=timezone.utc) + timedelta(days=SESSION_EXPIRY_DAYS),
    }
    _auth_sessions[token] = session_data
    database.update_last_login(user["id"])
    return user, token, session_data


def authenticate_or_create_google_user(email: str, first_name: str, last_name: str, *, allow_create: bool = False) -> tuple[Optional[dict], Optional[str], Optional[dict]]:
    """Authenticate an existing user by email via Google OAuth.

    If allow_create=True (SSO from trusted external site), auto-creates the user.
    If allow_create=False (direct login on zingbee.ai), rejects unknown emails.

    Returns (user_dict, session_token, session_data) on success.
    Returns (None, None, None) on failure.
    """
    if _auth_sessions is None:
        return None, None, None

    user = database.get_user_by_email(email)
    if not user:
        if not allow_create:
            return None, None, None
        # Create new user with a sentinel password hash that bcrypt will never match
        display_name = f"{first_name} {last_name}".strip() or email
        user = database.execute_returning("""
            INSERT INTO users (email, password_hash, display_name, role, is_active, first_name, last_name)
            VALUES (%s, 'GOOGLE_OAUTH', %s, 'student', true, %s, %s)
            RETURNING *
        """, (email, display_name, first_name, last_name))
        # Create a student record for the new user
        database.create_student(user["id"])

    students = database.get_students_for_user(user["id"])
    student_list = [
        {"student_id": s["student_id"], "name": format_display_name(s)}
        for s in students
    ]
    default_student_id = students[0]["student_id"] if students else None

    token = secrets.token_urlsafe(32)
    session_data = {
        "user_id": user["id"],
        "student_id": default_student_id,
        "students": student_list,
        "display_name": user.get("display_name") or email,
        "email": user["email"],
        "role": user.get("role"),
        "expires": datetime.now(tz=timezone.utc) + timedelta(days=SESSION_EXPIRY_DAYS),
    }
    _auth_sessions[token] = session_data
    database.update_last_login(user["id"])
    return user, token, session_data


def verify_student_ownership(auth: dict, student_id: str) -> bool:
    """Check that student_id belongs to the authenticated user."""
    students = auth.get("students", [])
    if any(s["student_id"] == student_id for s in students):
        return True
    user_id = auth.get("user_id")
    if user_id:
        row = database.fetchone(
            "SELECT 1 FROM students WHERE student_id = %s AND user_id = %s",
            (student_id, user_id))
        return row is not None
    return False


def require_auth(request: Request) -> dict:
    """Return auth dict or raise 401. Use as inline guard or FastAPI Depends()."""
    auth = get_auth_user(request)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return auth


def require_student_access(request: Request, student_id: str) -> dict:
    """Return auth dict or raise 401/403. Checks both auth and student ownership."""
    auth = require_auth(request)
    if not verify_student_ownership(auth, student_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return auth


# Session-cached role TTL. Sessions live for 30 days; a role demotion in the
# DB would otherwise persist in cache that whole window. 60 seconds is short
# enough that a demoted admin loses access promptly without round-tripping the
# DB on every request. Per pre-ship review pass-2 NEW-5.
_ROLE_CACHE_TTL_SECONDS = 60


def _resolve_role(auth: dict) -> str | None:
    """Return the user's role, populating it from the DB on legacy sessions that
    were issued before the session payload included `role`, and re-checking
    every _ROLE_CACHE_TTL_SECONDS so a DB-side role change reflects promptly.
    """
    now = datetime.now(tz=timezone.utc)
    role = auth.get("role")
    role_at = auth.get("role_resolved_at")
    if role and role_at and (now - role_at).total_seconds() < _ROLE_CACHE_TTL_SECONDS:
        return role
    user_id = auth.get("user_id")
    if not user_id:
        return role
    row = database.fetchone("SELECT role FROM users WHERE id = %s", (user_id,))
    fresh_role = (row or {}).get("role") if row else None
    if fresh_role:
        auth["role"] = fresh_role
        auth["role_resolved_at"] = now
        return fresh_role
    # DB lookup failed (deleted user, transient DB error). Keep whatever the
    # session had but don't refresh the timestamp — re-check next call.
    return role


def require_role(request: Request, allowed_roles: set[str]) -> dict:
    """Return auth dict or raise 401/403 unless the user's role is in allowed_roles.
    Used by admin-only / operator-only routes. Backfills `role` from the DB for
    legacy session payloads that don't have it. Agent service-key sessions use
    role="agent" and need to be in allowed_roles to pass."""
    auth = require_auth(request)
    role = _resolve_role(auth)
    if not role or role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Insufficient role")
    return auth
