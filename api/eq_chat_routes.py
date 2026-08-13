"""Quests chat/session routes for the academy client.

Provides chat sessions, messages, projects browsing for the Quests demo
restoration. Endpoints are mounted under /api/chat.

ISOLATION CONTRACT
------------------
This module is PURELY ADDITIVE. It never touches the Tutors learning
system. All persistence goes through the `quest_projects_db` data layer (imported
as `eqdb`), which is fully schema-qualified to the dedicated `quests`
Postgres schema. This file writes no SQL of its own and edits no shared code —
it only calls the READ-ONLY-reused data layer.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import quest_projects_db as eqdb

log = logging.getLogger(__name__)

eq_chat_router = APIRouter(prefix="/api/chat", tags=["quests-chat"])


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class ChatSessionCreate(BaseModel):
    student_id: str
    quest_id: Optional[str] = None
    project_id: Optional[str] = None
    subject_id: Optional[str] = None
    theme_id: Optional[str] = None
    thread_id: Optional[str] = None


class ChatMessageCreate(BaseModel):
    session_id: str
    role: str
    content: str
    message_type: Optional[str] = None
    media_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Chat sessions
# ---------------------------------------------------------------------------

@eq_chat_router.get("/stats")
async def chat_stats(student_id: str = Query(...)):
    """Dashboard stat tiles for a student (topics/streak/minutes)."""
    return eqdb.get_chat_stats(student_id)


@eq_chat_router.get("/sessions")
async def list_sessions(
    student_id: str = Query(...),
    quest_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    subject_id: Optional[str] = Query(None),
    theme_id: Optional[str] = Query(None),
    lang: str = Query("en"),
):
    """List a student's chat sessions (newest first), with optional filters."""
    return eqdb.list_chat_sessions(
        student_id,
        quest_id=quest_id,
        project_id=project_id,
        subject_id=subject_id,
        theme_id=theme_id,
    )


@eq_chat_router.post("/sessions")
async def create_session(data: ChatSessionCreate):
    """Create a new chat session and return it."""
    return eqdb.create_chat_session(
        data.student_id,
        quest_id=data.quest_id,
        project_id=data.project_id,
        subject_id=data.subject_id,
        theme_id=data.theme_id,
        thread_id=data.thread_id,
    )


@eq_chat_router.get("/sessions/{session_id}")
async def get_session(session_id: str, lang: str = Query("en")):
    """Get a single chat session with its messages array; 404 if missing."""
    session = eqdb.get_chat_session_with_messages(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return session


@eq_chat_router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a chat session (messages cascade)."""
    eqdb.delete_chat_session(session_id)
    return {"message": "deleted"}


@eq_chat_router.post("/sessions/{session_id}/summarize")
async def summarize_session(session_id: str):
    """Build a short preview from the session's messages and persist it.

    For the demo this uses the first user message, truncated to ~50 chars.
    Returns the updated ChatSession.
    """
    session = eqdb.get_chat_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")

    messages = eqdb.list_chat_messages(session_id)
    preview = ""
    for message in messages:
        if message.get("role") == "user" and message.get("content"):
            preview = message["content"]
            break

    preview = preview.strip()
    if len(preview) > 50:
        preview = preview[:50].rstrip() + "..."

    eqdb.set_session_preview(session_id, preview)
    return eqdb.get_chat_session(session_id)


@eq_chat_router.get("/sessions/{session_id}/messages")
async def list_messages(session_id: str):
    """List a session's messages, oldest first."""
    return eqdb.list_chat_messages(session_id)


# ---------------------------------------------------------------------------
# Chat messages
# ---------------------------------------------------------------------------

@eq_chat_router.post("/messages")
async def create_message(data: ChatMessageCreate):
    """Append a message to a session and return it."""
    return eqdb.add_chat_message(
        data.session_id,
        data.role,
        data.content,
        message_type=data.message_type,
        media_url=data.media_url,
    )
