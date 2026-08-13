"""Quests streaming LLM chat backend.

Restores the streaming chat endpoint that was never ported from the legacy
Quests service. Mounted under /api/llm-chat.

ISOLATION CONTRACT
------------------
This module is PURELY ADDITIVE and Quests-only. It touches the tutor
learning system in NO way:
  * All persistence goes through `quest_projects_db` (import as `eqdb`), whose
    every write targets the dedicated `quests` Postgres schema.
  * Quests are READ ONLY from `public.quests` (via eqdb.get_quest).
  * The LLM plumbing is reused as-is from `api/llm.py` (`stream_xai`); no new
    LLM client is created here.
It never imports, alters, or writes any public tutor table.
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import quest_projects_db as eqdb
from llm import stream_xai

log = logging.getLogger(__name__)

eq_llmchat_router = APIRouter(prefix="/api/llm-chat", tags=["quests-chat"])


_GENERIC_TUTOR_PROMPT = (
    "You are a friendly, encouraging tutor helping a student explore a topic. "
    "Explain clearly, ask guiding questions, and keep the student engaged."
)

_GENERIC_ASSISTANT_PROMPT = (
    "You are a helpful, friendly assistant. Answer the student's questions "
    "clearly and concisely."
)

_PROJECT_PROMPT_PREFIX = (
    "You are helping the student with their project. Use the following "
    "documents as context:\n\n"
)


class ChatCompletionRequest(BaseModel):
    user_message_content: str
    student_id: str
    quest_id: Optional[str] = None
    project_id: Optional[str] = None
    session_id: Optional[str] = None
    assistant_id: Optional[str] = None
    thread_id: Optional[str] = None
    stream: Optional[bool] = True


def _build_system_prompt(req: ChatCompletionRequest) -> str:
    """Resolve the system prompt / mode from the request."""
    # Quest mode
    if req.quest_id:
        quest = eqdb.get_quest(req.quest_id)
        voice_prompt = (quest or {}).get("voice_prompt")
        if voice_prompt and str(voice_prompt).strip():
            return voice_prompt
        return _GENERIC_TUTOR_PROMPT

    # Project mode (document-grounded)
    if req.project_id:
        context = eqdb.get_project_context_text(req.project_id)
        if context and context.strip():
            return _PROJECT_PROMPT_PREFIX + context
        # No usable documents — still answer generally in a project framing.
        return (
            "You are helping the student with their project. No project "
            "documents are available yet, so answer generally and helpfully."
        )

    # Neither — generic assistant
    return _GENERIC_ASSISTANT_PROMPT


@eq_llmchat_router.post("/chat/completions/")
def chat_completions(req: ChatCompletionRequest):
    """Stream an SSE chat completion, persisting the turn to quest_projects.*.

    Emits `data: {json}\\n\\n` lines the frontend SSE parser understands:
      {"session_id": ...}  -> flushed first for a newly created session
      {"thread_id": ...}   -> flushed for a new session that carries a thread
      {"content": token}   -> appended to the assistant message
      {"done": true, "session_id": ..., "session_preview": ...} -> finalize
    """
    system_prompt = _build_system_prompt(req)

    # Resolve / create the session.
    is_new = False
    session_id = req.session_id
    if not session_id:
        session = eqdb.create_chat_session(
            req.student_id,
            quest_id=req.quest_id,
            project_id=req.project_id,
            thread_id=req.thread_id,
        )
        session_id = session["id"]
        is_new = True

    # Persist the user turn BEFORE building history so it is included.
    eqdb.add_chat_message(session_id, "user", req.user_message_content)

    # Build the messages list: system first, then full history (incl. user turn).
    history = eqdb.list_chat_messages(session_id)
    messages = [{"role": "system", "content": system_prompt}]
    messages += [{"role": m["role"], "content": m["content"]} for m in history]

    def generator():
        # Announce a freshly created session before any content chunk so the
        # frontend can store the id (and thread id) up front.
        if is_new:
            yield f"data: {json.dumps({'session_id': session_id})}\n\n"
            if req.thread_id:
                yield f"data: {json.dumps({'thread_id': req.thread_id})}\n\n"

        full_reply = ""
        try:
            for kind, text, _final in stream_xai(messages):
                if kind == "content" and text:
                    full_reply += text
                    yield f"data: {json.dumps({'content': text})}\n\n"
                # "reasoning" chunks and the final (None, None, response) yield
                # are intentionally ignored.
        except Exception as e:  # noqa: BLE001 - surface to client, still finalize
            log.exception("Quests chat stream failed for session %s", session_id)
            note = "\n\n[The tutor ran into a problem generating a response.]"
            full_reply += note
            yield f"data: {json.dumps({'content': note})}\n\n"
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

        # Persist the assistant turn and a short history-sidebar preview.
        preview = (req.user_message_content or "").strip()[:50]
        try:
            eqdb.add_chat_message(session_id, "assistant", full_reply)
            eqdb.set_session_preview(session_id, preview)
        except Exception:  # noqa: BLE001 - persistence failure must not break SSE
            log.exception("Failed to persist Quests chat turn for %s", session_id)

        yield (
            "data: "
            + json.dumps(
                {"done": True, "session_id": session_id, "session_preview": preview}
            )
            + "\n\n"
        )

    return StreamingResponse(generator(), media_type="text/event-stream")
