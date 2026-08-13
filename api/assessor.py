"""Full Assessor for the v6 tutor state machine.

Post-tutor exchange classification + compliance check.
Temperature 0.1, max 200 tokens, stateless.
AUTHORITATIVE over the Quick Classifier.
"""

import re
import json
import logging
from typing import Optional
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# Redirect phrases for mismatch detection
_REDIRECT_PHRASES = [
    "that's a cool question, but",
    "right now we're focused on",
    "let's come back to that",
    "we can explore that another time",
    "my job is to help you with",
    "let's keep going with",
    "interesting thought! we can",
    "that's a great question, but",
    "we'll get to that",
]

# Valid interaction types per step
VALID_TYPES = {
    # ADO #26 A*: student_correct / student_partially_correct are now valid TEACH
    # signals — a substantive correct answer advances the scaffold instead of
    # being coerced to "teaching" (which camped the session in TEACH).
    "TEACH": {"teaching", "student_understands", "confirmation", "student_question",
              "student_move_on", "student_confused", "student_incorrect",
              "student_correct", "student_partially_correct"},
    "TRY": {"student_correct", "student_partially_correct", "student_incorrect",
            "student_confused", "student_question", "student_move_on", "confirmation", "teaching"},
    "EVIDENCE": {"student_correct", "student_partially_correct", "student_incorrect",
                 "student_confused", "student_move_on"},
    "RECALL": {"student_correct", "student_incorrect", "student_confused", "teaching"},
}


def run_assessor(tutor_response: str, student_message: str,
                 previous_tutor_message: str, fact_meta: dict,
                 current_step: str, recent_taught: list,
                 mastered_count: int, total_facts: int,
                 call_xai_fn, prompt_engine) -> dict:
    """Run the Full Assessor LLM on a complete tutor-student exchange.

    Returns the assessor JSON result with interaction_type, compliance flags, etc.
    """
    config = prompt_engine.get_llm_config("full_assessor")

    recent_str = "\n".join(f"- {f}" for f in recent_taught[-2:]) if recent_taught else "none yet"

    # Truncate previous tutor message
    prev_msg = previous_tutor_message
    if len(prev_msg) > 500:
        prev_msg = "..." + prev_msg[-500:]

    sys_msg, user_msg = prompt_engine.build_assessor_prompt(
        fact_meta=fact_meta,
        current_step=current_step,
        recent_taught_str=recent_str,
        mastered_count=mastered_count,
        total_facts=total_facts,
        tutor_response=tutor_response,
        student_message=student_message,
        previous_tutor_message=prev_msg,
    )

    default_result = {
        "fact_discussed": fact_meta.get("core_fact", ""),
        "interaction_type": "teaching",
        "student_is_confused": False,
        "fell_into_misconception": False,
        "used_vocabulary": "not_applicable",
        "tutor_compliance": {
            "tutor_is_looping": False,
            "tutor_is_summarizing": False,
            "tutor_asked_question_during_teach": False,
            "tutor_missing_image": False,
            "tutor_missing_suggestions": False,
            "tutor_missing_acknowledgment": False,
            "tutor_parroting": False,  # ADO #26 B: opener restates the student verbatim
            "tutor_incorrect_redirect": False,
        },
        "reason": "",
    }

    try:
        messages = [
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": user_msg},
        ]
        response = call_xai_fn(
            messages,
            temperature=config.get("temperature", 0.1),
            max_tokens=config.get("max_tokens", 200),
            store=False,
        )
        raw = (response.content or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r'^```\w*\n?', '', raw).rstrip('`').strip()
        result = json.loads(raw)

        # Ensure all required keys exist
        for key in default_result:
            if key not in result:
                result[key] = default_result[key]
        if "tutor_compliance" not in result or not isinstance(result["tutor_compliance"], dict):
            result["tutor_compliance"] = default_result["tutor_compliance"]
        else:
            for k, v in default_result["tutor_compliance"].items():
                result["tutor_compliance"].setdefault(k, v)

        return result

    except Exception as e:
        log.warning("Full Assessor failed: %s", e)
        return default_result


def detect_mismatch(assessor_result: dict, classifier_result: dict,
                    tutor_response: str) -> dict:
    """Detect mismatches between classifier, assessor, and tutor behavior.

    Returns mismatch info dict with flags and corrections to queue.
    """
    mismatch = {
        "incorrect_redirect": False,
        "classifier_assessor_disagree": False,
        "pending_correction": None,
        "log_events": [],
    }

    assessor_type = assessor_result.get("interaction_type", "")
    classifier_type = classifier_result.get("type", "")

    # Check 1: Assessor says student_question but tutor used redirect phrases
    if assessor_type == "student_question":
        tutor_lower = tutor_response.lower()
        for phrase in _REDIRECT_PHRASES:
            if phrase in tutor_lower:
                mismatch["incorrect_redirect"] = True
                mismatch["pending_correction"] = "question_correction"
                mismatch["log_events"].append({
                    "type": "compliance_violation",
                    "subtype": "incorrect_redirect",
                    "redirect_phrase": phrase,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                break

    # Also check the assessor's own compliance flag
    compliance = assessor_result.get("tutor_compliance", {})
    if compliance.get("tutor_incorrect_redirect") and not mismatch["incorrect_redirect"]:
        mismatch["incorrect_redirect"] = True
        mismatch["pending_correction"] = "question_correction"

    # Check 2: Classifier and assessor disagree
    # Map classifier types to assessor equivalents for comparison
    type_mapping = {
        "clarifying_question": "student_question",
        "off_topic": None,  # No direct equivalent
        "confusion": "student_confused",
        "understanding": "student_understands",
        "confirmation": "confirmation",
        "move_on": "student_move_on",
        "answer_attempt": None,
    }
    expected_assessor = type_mapping.get(classifier_type)
    if expected_assessor and assessor_type != expected_assessor:
        mismatch["classifier_assessor_disagree"] = True
        mismatch["log_events"].append({
            "type": "classifier_assessor_mismatch",
            "classifier": classifier_type,
            "assessor": assessor_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    return mismatch


def check_compliance(assessor_result: dict, current_step: str) -> dict:
    """Process assessor compliance flags and determine corrections to queue.

    Returns dict with pending_correction and log_events.
    """
    compliance = assessor_result.get("tutor_compliance", {})
    result = {
        "pending_correction": None,
        "log_events": [],
    }

    now = datetime.now(timezone.utc).isoformat()

    if compliance.get("tutor_is_looping"):
        result["pending_correction"] = "compliance_correction"
        result["log_events"].append({
            "type": "compliance_violation", "subtype": "looping", "timestamp": now,
        })

    if compliance.get("tutor_is_summarizing"):
        result["pending_correction"] = "compliance_correction"
        result["log_events"].append({
            "type": "compliance_violation", "subtype": "summarizing", "timestamp": now,
        })

    if compliance.get("tutor_asked_question_during_teach") and current_step == "TEACH":
        result["log_events"].append({
            "type": "compliance_violation", "subtype": "question_during_teach", "timestamp": now,
        })

    if compliance.get("tutor_missing_image") and current_step in ("TEACH", "TRY"):
        result["log_events"].append({
            "type": "compliance_violation", "subtype": "missing_image", "timestamp": now,
        })

    if compliance.get("tutor_missing_suggestions") and current_step in ("TEACH", "TRY"):
        result["log_events"].append({
            "type": "compliance_violation", "subtype": "missing_suggestions", "timestamp": now,
        })

    # ADO #26: "always acknowledge the previous response before moving on" —
    # applies in every step. Observational only (no correction turn).
    if compliance.get("tutor_missing_acknowledgment"):
        result["log_events"].append({
            "type": "compliance_violation", "subtype": "missing_acknowledgment", "timestamp": now,
        })

    # ADO #26 B: parroting — the opener restates the student's words verbatim
    # instead of reacting and adding something new. Observational: lets us
    # measure whether the de-parrot prompt actually reduces it (parroting is
    # partly an emergent token-budget behavior, so prompt-only efficacy is not
    # guaranteed).
    if compliance.get("tutor_parroting"):
        result["log_events"].append({
            "type": "compliance_violation", "subtype": "parroting", "timestamp": now,
        })

    return result
