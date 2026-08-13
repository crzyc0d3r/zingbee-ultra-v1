"""LiveKit voice agent for ZingBee RT Studio.

Bridges LiveKit rooms to xAI's Realtime API for voice tutoring sessions.
Audio flows: Student (browser) <-> LiveKit Cloud <-> This agent <-> xAI Realtime.

Uses the dedicated livekit-plugins-xai package.

Usage:
    python livekit_agent.py dev
"""

import asyncio
import json
import logging
import os

from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
)
from livekit.plugins import xai

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("zingbee-voice-agent")

# Environment
# All of these must be supplied via the environment (see api/.env.example).
# There are deliberately no baked-in credential defaults.
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "ws://localhost:7880")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")
XAI_API_KEY = os.environ.get("XAI_API_KEY", "")
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:9000")


AGENT_API_KEY = os.environ.get("AGENT_API_KEY", "")


async def _call_api(endpoint: str, data: dict) -> dict:
    """Call the ZingBee API with agent service key auth."""
    import httpx
    headers = {"Content-Type": "application/json"}
    if AGENT_API_KEY:
        headers["X-Agent-Key"] = AGENT_API_KEY
    async with httpx.AsyncClient(verify=False, timeout=30) as client:
        resp = await client.post(f"{API_BASE_URL}{endpoint}", json=data, headers=headers)
        return resp.json()


class ZingBeeVoiceAgent(Agent):
    """LiveKit Agent that bridges xAI Realtime with ZingBee curriculum."""

    def __init__(self, instructions: str = "", student_id: str = "student_001",
                 voice: str = "Sal") -> None:
        super().__init__(
            instructions=instructions,
            llm=xai.realtime.RealtimeModel(
                voice=voice,
                api_key=XAI_API_KEY,
            ),
        )
        self._student_id = student_id

    @function_tool()
    async def process_student_turn(
        self,
        context: RunContext,
        student_said: str,
        tutor_said: str,
    ) -> str:
        """MUST be called after EVERY student response. Analyzes understanding and returns curriculum instructions. NEVER respond without calling this first."""
        log.info("process_student_turn: student=%s", student_said)
        try:
            result = await _call_api("/api/voice/process-turn", {
                "student_said": student_said,
                "tutor_said": tutor_said,
                "student_id": self._student_id,
            })

            room = context.session.room
            if room and room.local_participant:
                await room.local_participant.publish_data(
                    json.dumps({
                        "type": "process_turn_result",
                        "data": result,
                    }).encode(),
                    reliable=True,
                )

            return json.dumps({
                "instructions": result.get("instructions", "Continue teaching."),
                "current_step": result.get("current_step", "TEACH"),
                "current_fact": result.get("current_fact", ""),
                "compliance_correction": result.get("compliance_correction"),
                "should_end_session": result.get("should_end_session", False),
                "image_context": result.get("image_context"),
            })
        except Exception as e:
            log.error("process_student_turn failed: %s", e)
            return json.dumps({"instructions": "Continue teaching.", "error": str(e)})

    @function_tool()
    async def generate_image(
        self,
        context: RunContext,
        topic: str,
        description: str,
    ) -> str:
        """Generate an educational image to show the student."""
        log.info("generate_image: topic=%s", topic)
        try:
            result = await _call_api("/api/voice/generate-image", {
                "topic": topic,
                "description": description,
                "student_id": self._student_id,
            })

            if result.get("image_url"):
                room = context.session.room
                if room and room.local_participant:
                    await room.local_participant.publish_data(
                        json.dumps({
                            "type": "image_generated",
                            "image_url": result["image_url"],
                            "topic": topic,
                        }).encode(),
                        reliable=True,
                    )
                return f"Image generated about {topic}. Mention it to the student."
            return "Image generation failed. Continue without the image."
        except Exception as e:
            log.error("generate_image failed: %s", e)
            return "Image generation failed. Continue without the image."


async def entrypoint(ctx: JobContext):
    """Called when a participant joins a LiveKit room."""
    log.info("Agent entrypoint: room=%s", ctx.room.name)

    room_meta = json.loads(ctx.room.metadata or "{}")
    student_id = room_meta.get("student_id", "student_001")
    subject = room_meta.get("subject", "Biology")
    voice = room_meta.get("voice", "Sal")
    instructions = room_meta.get("instructions", f"You are a friendly {subject} tutor.")
    greeting = room_meta.get("greeting", "")

    await ctx.connect()
    log.info("Connected to room, waiting for participant...")

    participant = await ctx.wait_for_participant()
    log.info("Participant joined: %s", participant.identity)

    agent = ZingBeeVoiceAgent(
        instructions=instructions,
        student_id=student_id,
        voice=voice,
    )

    session = AgentSession(
        tts=xai.TTS(voice=voice, api_key=XAI_API_KEY),
    )

    @session.on("user_input_transcribed")
    def on_user_transcript(ev):
        if ev.is_final and ev.transcript:
            asyncio.create_task(ctx.room.local_participant.publish_data(
                json.dumps({"type": "user_transcript", "text": ev.transcript}).encode(),
                reliable=True,
            ))

    await session.start(agent=agent, room=ctx.room)
    log.info("Voice agent started for student=%s subject=%s", student_id, subject)

    # Speak the same greeting that was displayed in the chat
    if greeting:
        log.info("Speaking greeting via TTS")
        await session.say(greeting)


def prewarm(proc: JobProcess):
    proc.userdata["ready"] = True


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            api_key=LIVEKIT_API_KEY,
            api_secret=LIVEKIT_API_SECRET,
            ws_url=LIVEKIT_URL,
        ),
    )
