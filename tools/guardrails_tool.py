"""
Guardrails for Biology Tutoring Sessions.
Uses a single LLM call to evaluate both student input and tutor response,
replacing regex patterns that caused false positives on valid biology content.
"""

import json
import logging
import os
import sys
from pathlib import Path
from xai_sdk import Client as XAIClient
from xai_sdk.chat import system as xai_system, user as xai_user

_project_root = str(Path(__file__).parent.parent)
sys.path.insert(0, _project_root)
sys.path.insert(0, str(Path(_project_root) / "api"))
import db as database

log = logging.getLogger(__name__)

XAI_API_KEY = os.environ.get("XAI_API_KEY")
try:
    _guardrails_agent = database.get_agent("guardrails")
except Exception:
    _guardrails_agent = None
GUARDRAILS_MODEL = _guardrails_agent["model"] if _guardrails_agent else "grok-3-mini-fast"

if not XAI_API_KEY:
    log.warning("XAI_API_KEY not set - guardrails will fail open on every request")

# Identity information (imported by web_ui.py and test_session.py)
ARIS_IDENTITY = {
    "name": "Aris",
    "creator": "ZingBee and Academy",
    "description": "a friendly Biology tutor who loves helping students ages 10-12 discover the wonders of living things",
    "subject": "Biology"
}

# System prompt for the guardrails evaluator — no user content interpolated here
GUARDRAILS_SYSTEM_PROMPT = f"""You are a guardrails evaluator for a children's Biology tutoring app.

The tutor is named {ARIS_IDENTITY['name']}, created by {ARIS_IDENTITY['creator']}. {ARIS_IDENTITY['name']} is {ARIS_IDENTITY['description']}.

You will receive a student message and the tutor's response. Evaluate them and return a JSON object with this exact structure:
{{
  "student_input": {{
    "is_off_topic": false,
    "is_identity_probe": false,
    "explanation": "Brief reason",
    "redirect": null
  }},
  "tutor_response": {{
    "broke_character": false,
    "explanation": "Brief reason",
    "corrected_response": null
  }}
}}

Rules for student_input evaluation:
- is_identity_probe = true ONLY if the student is asking what AI model, LLM, or technology powers the tutor (e.g. "are you ChatGPT?", "what AI are you?", "who made you?"). Normal biology questions are NEVER identity probes.
- is_off_topic = true ONLY if the message has NO connection to biology, life sciences, or the current lesson (e.g. pure video game talk, sports scores, dating advice). Questions that MENTION non-biology topics but relate them to biology are ON-topic.
- When is_identity_probe is true, set redirect to a warm response where {ARIS_IDENTITY['name']} says who they are and redirects to biology.
- When is_off_topic is true, set redirect to a warm response that acknowledges the student's interest and connects it back to biology.

Rules for tutor_response evaluation:
- broke_character = true ONLY if {ARIS_IDENTITY['name']} explicitly reveals being an AI, ChatGPT, GPT, Claude, a language model, or mentions OpenAI/Anthropic/Google as its creator. Phrases like "as an animal" or "as an organism" are NOT character breaks.
- When broke_character is true, set corrected_response to a rewrite that removes the AI identity reveal but PRESERVES all educational content. Do not strip the lesson — only fix the identity leak.

CRITICAL RULES — READ CAREFULLY:
- DEFAULT to all false. Only flag something if you are EXTREMELY confident it violates the rules above.
- Do not flag biology content as problematic. Phrases containing "as an a..." (like "as an animal", "as an adaptation") are normal biology language, NOT AI identity reveals.
- Normal tutoring interactions (greetings, teaching, questions, encouragement) should NEVER be flagged.
- When in doubt, do NOT flag. False positives are WORSE than false negatives because they destroy the student's learning experience.

Return ONLY the JSON object, no other text."""

def _get_client():
    """Create a new XAI client (xai_sdk clients are not reusable after close)."""
    return XAIClient(api_key=XAI_API_KEY)


def strip_json_markers(text: str) -> str:
    """Strip ```json``` markers from LLM response."""
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def evaluate_with_llm(student_input: str, llm_response: str) -> dict:
    """Single LLM call to evaluate both student input and tutor response.

    Uses separate system/user messages to keep user content out of the
    instruction prompt, reducing prompt injection surface.
    """
    client = _get_client()
    try:
        # Build user message with clear delimiters — no str.format() on user content
        user_content = (
            "Evaluate the following:\n\n"
            "=== STUDENT MESSAGE ===\n"
            f"{student_input}\n"
            "=== END STUDENT MESSAGE ===\n\n"
            "=== TUTOR RESPONSE ===\n"
            f"{llm_response}\n"
            "=== END TUTOR RESPONSE ==="
        )

        chat = client.chat.create(model=GUARDRAILS_MODEL, temperature=0.2, max_tokens=4000)
        chat.append(xai_system(GUARDRAILS_SYSTEM_PROMPT))
        chat.append(xai_user(user_content))
        response = chat.sample()

        raw = response.content
        cleaned = strip_json_markers(raw)
        return json.loads(cleaned)
    finally:
        client.close()


def run_guardrails(student_input: str, llm_response: str) -> dict:
    """
    Run full guardrails check on both student input and LLM response.
    Returns final response to show student (original or corrected).
    """
    result = {
        "student_input_eval": None,
        "llm_response_eval": {"original_response": llm_response},
        "final_response": llm_response,
        "was_corrected": False,
        "guardrails_triggered": []
    }

    try:
        evaluation = evaluate_with_llm(student_input, llm_response)
    except Exception as exc:
        log.warning("Guardrails LLM call failed (failing open): %s", exc)
        return result

    si = evaluation.get("student_input", {})
    tr = evaluation.get("tutor_response", {})

    result["student_input_eval"] = si
    result["llm_response_eval"]["tutor_eval"] = tr

    # Priority 1: identity probe
    if si.get("is_identity_probe") and si.get("redirect"):
        result["final_response"] = si["redirect"]
        result["was_corrected"] = True
        result["guardrails_triggered"].append("identity_probe")

    # Priority 2: off-topic
    elif si.get("is_off_topic") and si.get("redirect"):
        result["final_response"] = si["redirect"]
        result["was_corrected"] = True
        result["guardrails_triggered"].append("off_topic")

    # Priority 3: character break
    elif tr.get("broke_character") and tr.get("corrected_response"):
        result["final_response"] = tr["corrected_response"]
        result["was_corrected"] = True
        result["guardrails_triggered"].append("character_break")

    return result


# Export for use in web_ui.py and test_session.py
__all__ = [
    "run_guardrails",
    "ARIS_IDENTITY"
]
