"""Voice session routes for ZingBee RT Studio.

Provides /api/voice/* endpoints for XAI realtime voice tutoring:
- POST /api/voice/session         - Get ephemeral token for direct XAI realtime connection
- POST /api/voice/livekit-token   - Get LiveKit room token (preferred, handles noise/reliability)
- POST /api/voice/process-turn    - Process student turn (assessment + state machine)
- POST /api/voice/generate-image  - Generate educational image from voice tool call

Mount this router in the main FastAPI app.
"""

import json
import logging
import os
import re as _re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from auth import get_auth_user, get_auth_user_or_agent, verify_student_ownership
import db as database
import engagement

log = logging.getLogger(__name__)

router = APIRouter(tags=["voice"])

# ---------------------------------------------------------------------------
# Shared state — populated by init() from web_ui.py
# ---------------------------------------------------------------------------

_sessions = None
_SessionState = None
_generate_image = None
_persist_image = None
_is_valid_subject = None
_GOODBYE_PATTERN = None
_get_subject_config = None

def init(sessions_ref, session_state_cls, generate_image_fn, persist_image_fn,
         is_valid_subject_fn, goodbye_pattern, get_subject_config_fn=None):
    global _sessions, _SessionState, _generate_image, _persist_image
    global _is_valid_subject, _GOODBYE_PATTERN, _get_subject_config
    _sessions = sessions_ref
    _SessionState = session_state_cls
    _generate_image = generate_image_fn
    _persist_image = persist_image_fn
    _is_valid_subject = is_valid_subject_fn
    _GOODBYE_PATTERN = goodbye_pattern
    _get_subject_config = get_subject_config_fn


def _get_session(student_id: str):
    """Get or create a session for the student (mirrors web_ui.get_session)."""
    if student_id not in _sessions or not _sessions[student_id].is_active:
        _sessions[student_id] = _SessionState(student_id)  # default: Biology
    return _sessions[student_id]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class VoiceSessionRequest(BaseModel):
    student_id: Optional[str] = None
    subject: Optional[str] = None
    # Quests voice context (sent by academy use-xai-voice hook).
    # When quest_id is present the session speaks as the quest's persona
    # (quests.voice_prompt), NOT as a subject tutor.
    quest_id: Optional[str] = None
    project_id: Optional[str] = None
    subject_id: Optional[str] = None
    theme_id: Optional[str] = None
    language: Optional[str] = None
    voice: Optional[str] = None

class VoiceProcessTurnRequest(BaseModel):
    student_said: str                     # current student transcript
    tutor_said: str = ""                  # previous tutor transcript (from realtime)
    student_id: str = "student_001"

class VoiceTtsRequest(BaseModel):
    text: str
    voice_id: str = "Sal"
    language: str = "en"

class VoiceImageRequest(BaseModel):
    topic: str
    description: str
    student_id: str = "student_001"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/api/voice/session")
async def create_voice_session(request: Request, body: Optional[VoiceSessionRequest] = None):
    """Get ephemeral token for direct XAI realtime voice API connection.

    The client uses the returned token to connect directly to XAI's
    WebSocket API at wss://api.x.ai/v1/realtime
    """
    auth = get_auth_user(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    # Resolve student_id and verify ownership
    student_id = body.student_id if body else auth.get("student_id")
    if student_id and not verify_student_ownership(auth, student_id):
        return JSONResponse({"error": "Access denied"}, status_code=403)

    xai_key = os.environ.get("XAI_API_KEY")
    if not xai_key:
        return JSONResponse({"error": "XAI voice service not configured"}, status_code=503)

    try:
        import httpx

        # Get ephemeral token from XAI
        async with httpx.AsyncClient() as http_client:
            resp = await http_client.post(
                "https://api.x.ai/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {xai_key}",
                    "Content-Type": "application/json",
                },
                json={"expires_after": {"seconds": 600}},
            )

        if resp.status_code != 200:
            logging.error(f"XAI realtime API error: {resp.status_code} {resp.text}")
            return JSONResponse(
                {"error": "Voice service temporarily unavailable"},
                status_code=502
            )

        data = resp.json()
        logging.info("XAI ephemeral voice token created")

        # Build voice context instructions.
        # Quests sessions (quest_id present) speak as the quest persona
        # from quests.voice_prompt — they must NOT load a subject tutor
        # (previously the missing quest_id field made every quest voice
        # session default to subject="Biology", i.e. Aris).
        quest_id = body.quest_id if body else None
        quest = None
        if quest_id:
            import quest_projects_db as eqdb
            quest = eqdb.get_quest(quest_id)
            instructions = _build_quest_voice_instructions(
                quest, body.language if body else None
            )
        else:
            subject = (body.subject if body else None) or "Biology"
            instructions = _build_voice_instructions(student_id, subject)

        # Voice: explicit request > per-quest voice (quests.voice) > env default
        # (XAI voices: Ara, Rex, Sal, Eve, Leo — API expects capitalized)
        voice = (
            (body.voice if body else None)
            or (quest or {}).get("voice")
            or os.environ.get("VOICE", "Sal")
        )
        voice = voice.capitalize() if voice else "Sal"

        # Quest sessions get no tutor tools: process_student_turn drives the
        # Tutors state machine and must never run for a quest.
        tutor_tools = [] if quest_id else [
                {
                    "type": "function",
                    "name": "process_student_turn",
                    "description": "MUST be called after EVERY student response. Analyzes understanding and returns curriculum instructions for what to teach/ask next. NEVER respond without calling this first.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "student_said": {"type": "string", "description": "What the student just said (their exact words)"},
                            "tutor_said": {"type": "string", "description": "What you (the tutor) last said to the student"}
                        },
                        "required": ["student_said", "tutor_said"]
                    }
                },
                {
                    "type": "function",
                    "name": "generate_image",
                    "description": "Generate an educational image or diagram to show the student. Call when a visual would help explain a concept.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "topic": {"type": "string", "description": "Subject of the image (e.g. 'photosynthesis cycle')"},
                            "description": {"type": "string", "description": "What the image should show"}
                        },
                        "required": ["topic", "description"]
                    }
                }
            ]

        return {
            "client_secret": {
                "value": data["value"],
                "expires_at": data["expires_at"],
            },
            "voice": voice,
            "instructions": instructions,
            "tools": tutor_tools,
        }

    except Exception as e:
        logging.error(f"Voice session error: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to create voice session"},
            status_code=500
        )


@router.post("/api/voice/livekit-token")
async def create_livekit_session(request: Request, body: Optional[VoiceSessionRequest] = None):
    """Create a LiveKit room and return a participant token.

    The client connects to LiveKit Cloud, which handles audio transport,
    noise suppression, and reliability. A server-side LiveKit agent bridges
    the audio to xAI's Realtime API.
    """
    auth = get_auth_user(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    student_id = body.student_id if body else auth.get("student_id")
    if student_id and not verify_student_ownership(auth, student_id):
        return JSONResponse({"error": "Access denied"}, status_code=403)

    lk_url = os.environ.get("LIVEKIT_URL", "wss://livekit.zingbee.ai")
    lk_key = os.environ.get("LIVEKIT_API_KEY")
    lk_secret = os.environ.get("LIVEKIT_API_SECRET")
    if not lk_key or not lk_secret:
        return JSONResponse({"error": "LiveKit not configured"}, status_code=503)

    try:
        from livekit.api import AccessToken, VideoGrants
        import time

        subject = (body.subject if body else None) or "Biology"

        # Build voice instructions (same branching as direct mode): quest
        # sessions speak as the quest persona, never as a subject tutor.
        quest_id = body.quest_id if body else None
        quest = None
        if quest_id:
            import quest_projects_db as eqdb
            quest = eqdb.get_quest(quest_id)
            instructions = _build_quest_voice_instructions(
                quest, body.language if body else None
            )
        else:
            instructions = _build_voice_instructions(student_id, subject)

        # Get voice: explicit request > per-quest voice > tutor persona > env/default
        voice = "Sal"
        if body and body.voice:
            voice = body.voice
        elif quest is not None and quest.get("voice"):
            voice = quest["voice"]
        elif not quest_id and student_id and student_id in _sessions:
            session = _sessions[student_id]
            persona = getattr(session, '_persona', {})
            voice = persona.get("voice", os.environ.get("VOICE", "Sal"))
        else:
            voice = os.environ.get("VOICE", "Sal")
        # Capitalize for xAI API (expects "Leo" not "leo")
        voice = voice.capitalize() if voice else "Sal"

        # Create a unique room name per session
        room_name = f"zb-voice-{student_id}-{int(time.time())}"

        # Get the greeting text from the session (already generated by
        # fetchGreeting). Tutor sessions only — a quest room must not pick up
        # a stale tutor greeting.
        greeting_text = ""
        if not quest_id and student_id and student_id in _sessions:
            session = _sessions[student_id]
            for m in session.messages:
                if m["role"] == "assistant":
                    greeting_text = m.get("content", "")
                    break

        # Room metadata — the agent reads this to configure the session
        # NOTE: Do NOT include session_cookie here — room metadata is readable
        # by all participants. The agent authenticates via service-to-service secret.
        room_metadata = json.dumps({
            "student_id": student_id,
            "subject": subject,
            "voice": voice,
            "instructions": instructions,
            "greeting": greeting_text,
        })

        # Generate participant token
        token = AccessToken(lk_key, lk_secret) \
            .with_identity(f"student-{student_id}") \
            .with_name(student_id) \
            .with_grants(VideoGrants(
                room_join=True,
                room=room_name,
            ))

        # Create the room with metadata and dispatch agent
        from livekit.api import LiveKitAPI, CreateRoomRequest, RoomAgentDispatch
        lk_api = LiveKitAPI(lk_url.replace("wss://", "https://"), lk_key, lk_secret)
        await lk_api.room.create_room(CreateRoomRequest(
            name=room_name,
            metadata=room_metadata,
            empty_timeout=300,
            agents=[RoomAgentDispatch(agent_name="", metadata=room_metadata)],
        ))
        await lk_api.aclose()

        jwt_token = token.to_jwt()
        logging.info("LiveKit token created for room=%s student=%s", room_name, student_id)

        return {
            "token": jwt_token,
            "url": lk_url,
            "room": room_name,
            "voice": voice,
        }

    except Exception as e:
        logging.error("LiveKit token creation failed: %s", e, exc_info=True)
        return JSONResponse({"error": f"Failed to create voice session: {str(e)}"}, status_code=500)


@router.post("/api/voice/process-turn")
async def voice_process_turn(body: VoiceProcessTurnRequest, req: Request):
    """Process a student turn in voice mode -- runs assessment + state machine without calling tutor LLM.

    The xAI Realtime model handles speech generation; this endpoint provides curriculum
    instructions that the model follows when speaking.
    Accepts both user session cookies and agent service key (X-Agent-Key header).
    """
    auth = get_auth_user_or_agent(req)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    student_id = body.student_id
    # Agent calls are trusted (student_id comes from server-side room metadata)
    if auth.get("role") != "agent" and not verify_student_ownership(auth, student_id):
        return JSONResponse({"error": "Access denied"}, status_code=403)

    session = _get_session(student_id)
    log_start_idx = len(session.execution_log)
    user_message = body.student_said
    tutor_said = body.tutor_said

    # Log user input
    session.log_execution("USER_INPUT", {
        "message": user_message,
        "length": len(user_message),
        "mode": "voice"
    }, agent="Student")

    # === Append tutor_said (from realtime transcript) to session.messages ===
    # This maintains conversation history for the assessor
    if tutor_said:
        session.messages.append({"role": "assistant", "content": tutor_said})
        if session.session_db_id:
            try:
                database.save_learning_session_message(session.session_db_id, "assistant", tutor_said)
            except Exception as e:
                logging.warning("DB save voice tutor message failed: %s", e)

    # === Run assessment (same as /api/chat Phase 1) ===
    prev_tutor_msg = tutor_said or ""
    if not prev_tutor_msg:
        for m in reversed(session.messages):
            if m["role"] == "assistant":
                prev_tutor_msg = m["content"]
                break

    assessment = {}
    compliance_correction = None
    try:
        assessment = session.check_student_comprehension(prev_tutor_msg, user_message)

        session.system_log.append({
            "event": "ASSESSMENT",
            "ts": datetime.now().isoformat(),
            "student_message": user_message,
            "interaction_type": assessment.get("interaction_type"),
            "fact_discussed": assessment.get("fact_discussed"),
            "understood": assessment.get("student_demonstrated_understanding"),
            "confused": assessment.get("student_is_confused"),
            "step_transitioned": assessment.get("step_transitioned", False),
            "step_from": assessment.get("step_transition_from"),
            "step_to": assessment.get("step_transition_to"),
            "mode": "voice",
        })
        logging.info("[Voice] ASSESSMENT type=%s | fact=%s | understood=%s | confused=%s",
                     assessment.get("interaction_type"), assessment.get("fact_discussed", ""),
                     assessment.get("student_demonstrated_understanding"),
                     assessment.get("student_is_confused"))

        # Compliance correction (same as /api/chat)
        student_confused = assessment.get("student_is_confused", False)
        _mid_cycle = assessment.get("_pre_cycle_index", 0) > 0
        # ADO #28: an evidence probe intentionally re-asks the same fact; don't
        # let a looping/summarizing correction shadow the probe instruction (in
        # voice only the most recent system message reaches the realtime model).
        # Check the durable pending-probe state too, so a turn where the engine
        # didn't run (garbled transcript, no fact_discussed) stays covered.
        _v_eng = getattr(session, '_session_engine', None)
        _is_probe = (getattr(session, '_last_engine_action', None)
                     in ("evidence_probe", "evidence_probe_clarify")
                     or (_v_eng is not None and _v_eng.has_pending_evidence_probe()))
        if not student_confused and not _mid_cycle and not _is_probe and (assessment.get("tutor_is_summarizing") or assessment.get("tutor_is_looping")):
            _kp_c = session.progress.get("knowledge_points", {}).get(session.capsule_name, {})
            session.log_execution("COMPLIANCE_CORRECTION", {
                "reason": "summarizing" if assessment.get("tutor_is_summarizing") else "looping",
            }, agent="Assessor")
            next_fact = _kp_c.get("current_fact", "the next concept")
            compliance_correction = session._render_compliance_correction(next_fact)
            if compliance_correction:
                session.messages.append({"role": "system", "content": compliance_correction})

        # Log answer outcomes
        itype = assessment.get("interaction_type", "teaching")
        if assessment.get("fact_discussed") and itype in ("student_correct", "student_incorrect"):
            session.question_count += 1
            if itype == "student_correct":
                session.correct_count += 1
                session.log_execution("ANSWER_CORRECT", {
                    "fact": assessment["fact_discussed"],
                    "student_said": user_message,
                    "reason": assessment.get("reason", ""),
                    "score": f"{session.correct_count}/{session.question_count}"
                }, agent="Assessor")
            else:
                session.log_execution("ANSWER_INCORRECT", {
                    "fact": assessment["fact_discussed"],
                    "student_said": user_message,
                    "reason": assessment.get("reason", ""),
                    "score": f"{session.correct_count}/{session.question_count}"
                }, agent="Assessor")
    except Exception as e:
        logging.warning("[Voice] Assessment failed: %s", e)
        session.log_execution("ASSESSMENT_ERROR", {"error": str(e)}, agent="Assessor")

    # === Append user message AFTER assessment (same ordering as /api/chat) ===
    session.messages.append({"role": "user", "content": user_message})
    session._last_user_msg_id = None
    session._last_interaction_id = None
    if session.session_db_id:
        try:
            session._last_user_msg_id = database.save_learning_session_message(session.session_db_id, "user", user_message)
        except Exception as e:
            logging.warning("DB save voice user message failed: %s", e)

    # === Build instructions for the realtime model ===
    # Gather the latest system message (step transition instruction) if one was injected
    instructions_parts = []
    current_step = session.progress.get("current_position", {}).get("step_name", "TEACH")

    # Find the most recent system message (transition instruction)
    for m in reversed(session.messages):
        if m["role"] == "system":
            instructions_parts.append(m["content"])
            break

    # Current fact context
    _kp = session.progress.get("knowledge_points", {}).get(session.capsule_name, {})
    current_fact = _kp.get("current_fact", "")
    if current_fact:
        instructions_parts.append(f"Current fact to teach: {current_fact}")

    instructions_parts.insert(0, f"Current step: {current_step}")
    instructions = "\n\n".join(instructions_parts)

    # === Engagement chips (ADO #26), voice pool. Suppressed during TRY/CHECK/EVIDENCE.
    # Voice has no deterministic chip routing yet, so the pool only offers
    # intents the classifier path honors (ready/confused/continue).
    if current_step in ("TRY", "CHECK", "EVIDENCE"):
        suggestions = []
    else:
        suggestions = engagement.texts(
            engagement.fallback_suggestions(current_step, None, voice=True))

    # === Image generation (skip during CHECK/EVIDENCE, same as text mode) ===
    image_url = None
    image_context = None
    if current_step not in ("CHECK", "EVIDENCE"):
        # Use session context for image prompt, not the raw instruction text
        image_url, img_result = _generate_image(
            current_fact or instructions, session, trigger="voice")
        if image_url:
            image_context = "An educational image is being shown to the student illustrating what you just explained."
            # Persist image to GCS
            try:
                _persist_image(image_url, f"voice_{session.capsule_name}",
                               learning_session_id=session.session_db_id,
                               session=session,
                               topic=session.capsule_name,
                               description=img_result.get("description", "") if img_result else "",
                               style=img_result.get("style", "") if img_result else "",
                               full_prompt=img_result.get("full_prompt", "") if img_result else "",
                               capsule_name=session.capsule_name)
            except Exception as e:
                logging.warning("Voice image persistence failed: %s", e)

    # === Check for session end ===
    should_end = bool(_GOODBYE_PATTERN.search(user_message))
    if should_end:
        session.log_execution("SESSION_END_REQUESTED", {
            "trigger": "user_goodbye",
            "message": user_message,
            "mode": "voice"
        }, agent="SessionManager")

    # The engine can end the session itself (v006.10 practice-complete end,
    # or the answered closure choice) — honor it here exactly like the text
    # paths (web_ui chat + chat_stream) do, otherwise a voice session says
    # "we're wrapping up" and then keeps going into EVIDENCE anyway.
    if not should_end and hasattr(session, '_session_engine') and session._session_engine:
        should_end = session._session_engine.should_end_session()
        if should_end:
            session.log_execution("SESSION_END_REQUESTED", {
                "trigger": "engine_should_end",
                "mode": "voice"
            }, agent="SessionManager")

    # === Save progress (flush to DB — same as text mode) ===
    knowledge = session.get_knowledge_stats()
    try:
        session._save_progress()
    except Exception as e:
        logging.warning("Voice _save_progress failed: %s", e)

    return {
        "status": "ok",
        "current_step": current_step,
        "current_fact": current_fact,
        "instructions": instructions,
        "compliance_correction": compliance_correction,
        "image_url": image_url,
        "image_context": image_context,
        "facts_state": {
            "introduced": knowledge.get("facts_introduced", 0),
            "taught": knowledge.get("facts_taught", 0),
            "assessed": knowledge.get("facts_assessed", 0),
            "mastered": knowledge.get("facts_mastered", 0),
            "total": knowledge.get("total_facts", 0),
        },
        "execution_log": session.execution_log[log_start_idx:],
        "should_end_session": should_end,
        "suggestions": suggestions,
        "stats": {
            "questions": session.question_count,
            "correct": session.correct_count
        }
    }


@router.post("/api/voice/generate-image")
async def voice_generate_image(body: VoiceImageRequest, req: Request):
    """Generate an educational image triggered by the realtime model's generate_image function call."""
    auth = get_auth_user_or_agent(req)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    if auth.get("role") != "agent" and not verify_student_ownership(auth, body.student_id):
        return JSONResponse({"error": "Access denied"}, status_code=403)

    session = _get_session(body.student_id)

    tutor_text = body.description or f"Let's learn about {body.topic}!"
    image_url, _ = _generate_image(tutor_text, session, trigger="voice_tool_call")
    if image_url:
        return {"image_url": image_url, "success": True, "description": f"Educational image about {body.topic}"}
    return {"image_url": None, "success": False, "description": "Image generation failed"}


# ---------------------------------------------------------------------------
# TTS — xAI Text-to-Speech proxy
# ---------------------------------------------------------------------------

# Map subject names to xAI voice IDs
SUBJECT_VOICES = {
    "Physics": "Sal", "Biology": "Ara", "Chemistry": "Eve",
    "Math": "Rex", "English": "Leo",
}


@router.post("/api/voice/tts")
async def voice_tts(body: VoiceTtsRequest, req: Request):
    """Proxy text to xAI TTS API and stream audio back to the client.

    Also logs a TTS_REQUEST execution entry to the student's active session so
    TTS cost shows up in the session cost breakdown alongside LLM and images.
    """
    auth = get_auth_user(req)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    xai_key = os.environ.get("XAI_API_KEY")
    if not xai_key:
        return JSONResponse({"error": "TTS service not configured"}, status_code=503)

    if not body.text.strip():
        return JSONResponse({"error": "No text provided"}, status_code=400)

    # Compute cost up-front; we only log it if the upstream call succeeds.
    from llm import calc_tts_cost
    char_count = len(body.text)
    tts_cost_usd = calc_tts_cost(char_count)
    student_id = auth.get("student_id")

    import httpx

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.x.ai/v1/tts",
            headers={
                "Authorization": f"Bearer {xai_key}",
                "Content-Type": "application/json",
            },
            json={
                "text": body.text,
                "voice_id": body.voice_id,
                "output_format": {
                    "codec": "mp3",
                    "sample_rate": 44100,
                    "bit_rate": 128000,
                },
                "language": body.language,
            },
            timeout=30.0,
        )
        if resp.status_code != 200:
            logging.error("xAI TTS error: %s %s", resp.status_code, resp.text[:200])
            return JSONResponse({"error": "TTS failed"}, status_code=502)

        # Log cost to the active session so it shows up in the session
        # cost breakdown (DashboardTab in red-team reads execution_log).
        try:
            if student_id and _sessions and student_id in _sessions:
                session = _sessions[student_id]
                if session.is_active:
                    session.log_execution("TTS_REQUEST", {
                        "chars": char_count,
                        "voice_id": body.voice_id,
                        "language": body.language,
                        "cost_usd": tts_cost_usd,
                    }, agent="TTS")
        except Exception as e:
            logging.warning("TTS cost logging failed: %s", e)

        return StreamingResponse(
            iter([resp.content]),
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache"},
        )


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _strip_text_mode_blocks(prompt: str) -> str:
    """Remove <IMAGE>, <SUGGESTIONS>, and related text-mode formatting instructions from a prompt.

    These blocks are for text chat only -- the realtime voice model should never see them.
    """
    # Remove <IMAGE>...</IMAGE> block examples and instructions
    prompt = _re.sub(r'<IMAGE>.*?</IMAGE>', '', prompt, flags=_re.DOTALL)
    # Remove <SUGGESTIONS>...</SUGGESTIONS> block examples and instructions
    prompt = _re.sub(r'<SUGGESTIONS>.*?</SUGGESTIONS>', '', prompt, flags=_re.DOTALL)

    # Remove paragraphs that reference <IMAGE> or <SUGGESTIONS> tags
    for tag in ('IMAGE', '/IMAGE', 'SUGGESTIONS', '/SUGGESTIONS'):
        prompt = _re.sub(rf'(?:^|\n)[^\n]*<{tag}>[^\n]*(?:\n|$)', '\n', prompt)

    # Remove "Topics already shown:" lines
    prompt = _re.sub(r'(?:^|\n)Topics already shown:[^\n]*(?:\n|$)', '\n', prompt)

    # Collapse multiple blank lines
    prompt = _re.sub(r'\n{3,}', '\n\n', prompt)

    return prompt.strip()


def _build_quest_voice_instructions(quest: Optional[dict], language: Optional[str]) -> str:
    """Build voice instructions for an Quests session.

    Takes the already-fetched quest row (READ ONLY, from quest_projects_db.get_quest);
    the persona comes from its voice_prompt. Deliberately does NOT touch the
    tutor pipeline: no _SessionState, no curriculum system prompt, no
    process_student_turn tool.
    """
    voice_prompt = (quest or {}).get("voice_prompt")
    if not voice_prompt or not str(voice_prompt).strip():
        voice_prompt = (
            "You are a friendly, encouraging quest guide helping a student "
            "explore their quest topic through conversation."
        )

    parts = [
        "VOICE MODE -- MANDATORY RULES:\n"
        "This is a real-time spoken voice conversation with a child.\n"
        "- Speak ONLY natural conversational sentences\n"
        "- Keep responses to 2-4 spoken sentences\n"
        "- No markdown, no bullet points, no XML-style tags, no URLs\n",
        str(voice_prompt).strip(),
    ]
    if language and language != "en":
        parts.append(
            f"IMPORTANT: Speak with the student in the language with code '{language}'."
        )
    return "\n\n".join(parts)


def _build_voice_instructions(student_id: Optional[str], subject: str) -> str:
    """Build voice session instructions for the XAI realtime model.

    Reuses the text-mode system prompt for curriculum/fact context, but strips
    all text-mode formatting (<IMAGE>, <SUGGESTIONS> blocks) and prepends
    voice-specific delivery and function call rules.
    """
    try:
        # Reuse the exact same session + system prompt that text chat uses
        if student_id in _sessions and _sessions[student_id].is_active:
            # Active session exists -- reuse its prompt (voice mid-session switch)
            session = _sessions[student_id]
        else:
            # Create a new session (same as greeting endpoint does)
            if student_id in _sessions and _sessions[student_id].is_active:
                _sessions[student_id].end_session()
            _sessions[student_id] = _SessionState(student_id, subject)
            session = _sessions[student_id]

        # Strip text-mode formatting blocks from the system prompt
        base_prompt = _strip_text_mode_blocks(session.system_prompt)

        # Voice-specific rules PREPENDED (high priority positioning)
        voice_preamble = (
            "VOICE MODE -- MANDATORY RULES:\n"
            "This is a real-time spoken voice conversation with a child.\n"
            "\n"
            "OUTPUT FORMAT RULES (absolute):\n"
            "- NEVER output <IMAGE>, </IMAGE>, <SUGGESTIONS>, </SUGGESTIONS>, or any XML-style tags\n"
            "- NEVER output 'topic:', 'description:', or any key-value metadata -- that is NOT speech\n"
            "- NEVER read out URLs, file paths, or technical metadata\n"
            "- Speak ONLY natural conversational sentences a child would hear from a friendly tutor\n"
            "- Keep responses to 2-4 spoken sentences\n"
            "- No markdown, no bullet points, no numbered lists\n"
            "\n"
            "FUNCTION CALL RULES (CRITICAL):\n"
            "- You MUST call process_student_turn BEFORE every response to a student\n"
            "- NEVER speak to the student without calling this function first\n"
            "- After receiving the function result, follow the 'instructions' field to know what to teach or ask\n"
            "- If the result includes a compliance_correction, follow that guidance\n"
            "- If the result includes image_context, mention the image verbally\n"
            "- The ONLY exception: your very first greeting -- speak that directly\n"
            "\n"
            "DELIVERY STYLE:\n"
            "- Warm, encouraging, age-appropriate spoken tone\n"
            "- Ask questions to check understanding\n"
            "- Celebrate correct answers, gently correct wrong ones\n"
            "- Do NOT ask the student their name -- you already know it\n"
            "- Do NOT repeat the student's name in every sentence\n"
            "\n"
            "--- CURRICULUM CONTEXT BELOW ---\n\n"
        )

        return voice_preamble + base_prompt

    except Exception as e:
        logging.warning(f"Failed to build voice instructions from session: {e}")
        # Fallback to minimal instructions if session creation fails
        cfg = (_get_subject_config(subject) if _get_subject_config else None) or {"tutor_name": "Tutor", "age_range": "10-12"}
        return (
            f"You are {cfg.get('tutor_name', 'Tutor')}, a friendly AI {subject} tutor for children ages {cfg.get('age_range', '10-12')}. "
            f"Keep responses educational, encouraging, and age-appropriate. "
            f"This is a real-time voice conversation - keep responses concise and conversational."
        )
