"""Quests voice-exchange persistence route.

ISOLATION CONTRACT
------------------
This module is part of the Quests demo restoration and must NEVER touch the
Tutors learning system. It persists voice-chat exchanges exclusively through
`quest_projects_db` (READ-ONLY reuse), which writes only to the dedicated
`quests` Postgres schema. Nothing here reads or writes any `public.*` tutor
table.

This router is purely additive. It exposes ONE new route, POST
/api/voice/save-exchange, on its own APIRouter (`eq_voice_router`). FastAPI
permits multiple routers sharing the "/api/voice" prefix as long as the paths
differ, so mounting this alongside the existing voice router in
`api/livekit/voice_routes.py` causes no collision. The existing voice router is
left untouched.
"""

import logging
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import quest_projects_db as eqdb

log = logging.getLogger(__name__)

eq_voice_router = APIRouter(prefix="/api/voice", tags=["quests-voice"])

_PREVIEW_MAX_CHARS = 50


class SaveExchangeRequest(BaseModel):
    student_id: str
    user_message: str
    assistant_message: str
    session_id: Optional[str] = None
    quest_id: Optional[str] = None
    project_id: Optional[str] = None
    subject_id: Optional[str] = None
    theme_id: Optional[str] = None


@eq_voice_router.post("/save-exchange")
async def save_exchange(body: SaveExchangeRequest):
    """Persist a single voice exchange (user + assistant messages).

    Creates a new Quests chat session on first exchange, or appends to an
    existing one, then records a short preview for the history sidebar.
    """
    session_id = body.session_id
    is_new_session = False

    if not session_id:
        session = eqdb.create_chat_session(
            body.student_id,
            quest_id=body.quest_id,
            project_id=body.project_id,
            subject_id=body.subject_id,
            theme_id=body.theme_id,
        )
        session_id = session["id"]
        is_new_session = True

    eqdb.add_chat_message(session_id, "user", body.user_message)
    eqdb.add_chat_message(session_id, "assistant", body.assistant_message)

    session_preview = (body.user_message or "").strip()[:_PREVIEW_MAX_CHARS]
    eqdb.set_session_preview(session_id, session_preview)

    return JSONResponse({
        "session_id": session_id,
        "session_preview": session_preview,
        "is_new_session": is_new_session,
    })
