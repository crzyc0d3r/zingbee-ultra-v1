"""Quick Classifier for the v6 tutor state machine.

Pre-tutor message classification. Runs BEFORE the tutor LLM call.
Skippable for known short patterns. Temperature 0.0, max 100 tokens.
"""

import re
import json
import logging
from typing import Optional

log = logging.getLogger(__name__)

# Compiled skip rule patterns (no LLM call needed)
_CONFIRMATION = re.compile(
    r'^(yes|yeah|yep|yup|ok|okay|sure|got it|i get it|makes sense|cool|alright)\.?!?$', re.I)
_CONFUSION = re.compile(
    r'^(no|nope|not really|i don\'t understand|i don\'t get it|i\'m confused|huh|what)\??$', re.I)
_MOVE_ON = re.compile(
    r'^(i know|i already know|skip|next|move on|can we move on|i want to move on)\.?$', re.I)
_CONFUSION_IDK = re.compile(
    r'^(idk|i don\'t know|i have no idea|no idea|not sure|dunno|beats me)\.?$', re.I)
_PUNCTUATION_ONLY = re.compile(r'^[.!?,;:\-]+$')
_EMOJI_ONLY = re.compile(r'^[\U0001F000-\U0001FFFF\U00002600-\U000027BF\U0000FE00-\U0000FEFF]+$')

# ADO #28 evidence guard: the spec's explicit non-evidence acks that
# _CONFIRMATION doesn't cover ("I understand" forms). Anchored full-message.
_NON_EVIDENCE = re.compile(
    r"^(i understand( it)?( better)?|understood|i know( it| this)?|"
    r"i get it( now)?|(that |it )?makes sense|i see)$", re.I)

# Tokens that carry no evidence content; stripped before lexicon matching so
# padded acks ("yeah I totally get it") still match the anchored patterns.
_FILLER_TOKENS = {"um", "uh", "hmm", "like", "so", "well", "totally",
                  "really", "just", "now", "oh", "definitely"}
# Leading agreement tokens stripped once from the front ("yes i understand").
_ACK_PREFIX_TOKENS = {"yes", "yeah", "yep", "yup", "ok", "okay", "sure"}

_WORD_KEEP = re.compile(r"[^\w\s']+", re.UNICODE)


def _normalize_tokens(text: str) -> list:
    """Lowercase, drop punctuation (keep apostrophes), split to tokens."""
    return _WORD_KEEP.sub(" ", text.strip().lower()).split()


def is_substantive_response(text: str, chip_texts=()) -> bool:
    """ADO #28: does this message count as produced evidence?

    DENY-LIST, not a quality bar — the assessor LLM already judged content
    correctness; this only catches the spec's enumerated non-evidence:
    acks ("yes"), "I understand" forms, suggestion-chip text, and
    empty/emoji/too-short messages. Everything else passes (fail-open),
    including any non-English answer — the lexicons are English-only and
    must never lock out other languages.
    """
    raw = (text or "").strip()
    if not raw or _PUNCTUATION_ONLY.match(raw) or _EMOJI_ONLY.match(raw):
        return False

    tokens = _normalize_tokens(raw)
    if chip_texts:
        normalized_chips = {" ".join(_normalize_tokens(c)) for c in chip_texts}
        if " ".join(tokens) in normalized_chips:
            return False  # typed/stale chip text is a button click, not evidence

    # Strip fillers, dedupe consecutive repeats ("yes yes yes" -> "yes")
    tokens = [t for t in tokens if t not in _FILLER_TOKENS]
    deduped = [t for i, t in enumerate(tokens) if i == 0 or t != tokens[i - 1]]
    # Strip leading agreement tokens ("yes i understand" -> "i understand")
    while deduped and deduped[0] in _ACK_PREFIX_TOKENS:
        deduped.pop(0)
    normalized = " ".join(deduped)

    if len(normalized) < 3:
        return False  # all-ack/filler, bare "no"/"42" — one gentle probe is fine
    for pattern in (_CONFIRMATION, _CONFUSION_IDK, _MOVE_ON, _NON_EVIDENCE):
        if pattern.match(normalized):
            return False
    return True


def classify_skip(message: str) -> Optional[dict]:
    """Try to classify the message using pattern matching (no LLM call).

    Returns {"type": str, "reason": str} if matched, None if LLM call needed.
    """
    text = message.strip()

    # Blank or whitespace only
    if not text:
        return {"type": "uninterpretable", "reason": "empty message"}

    # Punctuation only
    if _PUNCTUATION_ONLY.match(text):
        return {"type": "uninterpretable", "reason": "punctuation only"}

    # Emoji only
    if _EMOJI_ONLY.match(text):
        return {"type": "confirmation", "reason": "emoji only"}

    # Confirmation (check BEFORE length guard so "ok" matches)
    if _CONFIRMATION.match(text):
        return {"type": "confirmation", "reason": "short confirmation"}

    # Confusion
    if _CONFUSION.match(text):
        return {"type": "confusion", "reason": "confusion expression"}

    # Very short (< 3 chars) and not matching patterns above
    if len(text) < 3:
        return {"type": "uninterpretable", "reason": "too short"}

    # IDK / don't know
    if _CONFUSION_IDK.match(text):
        return {"type": "confusion", "reason": "doesn't know"}

    # Move on
    if _MOVE_ON.match(text):
        return {"type": "move_on", "reason": "wants to skip/advance"}

    # Check for move_on keywords in longer messages
    lower = text.lower()
    if any(kw in lower for kw in ("skip", "move on", "already know", "next fact")):
        return {"type": "move_on", "reason": "move_on keyword detected"}

    return None  # Need LLM call


def classify_with_llm(message: str, core_fact: str, current_step: str,
                      tutor_last_summary: str, call_xai_fn, prompt_engine) -> dict:
    """Classify student message using the Quick Classifier LLM.

    Args:
        message: Student's message
        core_fact: Current fact being taught
        current_step: Current step (TEACH, TRY, CHECK, EVIDENCE, RECALL)
        tutor_last_summary: Last tutor message (truncated)
        call_xai_fn: Function to call xAI LLM
        prompt_engine: PromptEngine instance for building prompts

    Returns:
        {"type": str, "reason": str, "model": str, "prompt_tokens": int, "completion_tokens": int}
    """
    config = prompt_engine.get_llm_config("quick_classifier")
    model = config.get("model")

    sys_msg, user_msg = prompt_engine.build_classifier_prompt(
        core_fact=core_fact,
        current_step=current_step,
        tutor_last_summary=tutor_last_summary,
        student_message=message,
    )

    try:
        messages = [
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": user_msg},
        ]
        response = call_xai_fn(
            messages,
            temperature=config.get("temperature", 0.0),
            max_tokens=config.get("max_tokens", 100),
            store=False,
            model=model,
            reasoning="low",
        )
        raw = (response.content or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r'^```\w*\n?', '', raw).rstrip('`').strip()
        result = json.loads(raw)
        usage = getattr(response, "usage", None)
        return {
            "type": result.get("type", "other"),
            "reason": result.get("reason", ""),
            "model": model or "",
            "prompt_tokens": getattr(usage, "prompt_tokens", 0) if usage else 0,
            "completion_tokens": getattr(usage, "completion_tokens", 0) if usage else 0,
        }
    except Exception as e:
        log.warning("Quick Classifier failed: %s — defaulting to 'other'", e)
        return {"type": "other", "reason": f"classifier_error: {e}",
                "model": model or "", "prompt_tokens": 0, "completion_tokens": 0}


def classify(message: str, core_fact: str, current_step: str,
             tutor_last_summary: str, call_xai_fn, prompt_engine) -> dict:
    """Full classification pipeline: skip rules first, then LLM fallback.

    Returns: {"type": str, "reason": str, "source": "skip_rule" | "llm"}
    """
    # Step 1: Try skip rules
    skip_result = classify_skip(message)
    if skip_result:
        skip_result["source"] = "skip_rule"
        return skip_result

    # Step 2: LLM call
    llm_result = classify_with_llm(
        message, core_fact, current_step,
        tutor_last_summary, call_xai_fn, prompt_engine
    )
    llm_result["source"] = "llm"
    return llm_result
