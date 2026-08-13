"""Conversational engagement prompts (ADO #26).

Shared home for everything suggestion-chip related: the intent vocabulary,
`intent: text` prefix parsing for LLM-emitted <SUGGESTIONS> lines, the curated
fallback pool, and deterministic matching of clicked chips.

Replaces the binary "Got it / I don't understand yet" pair per the
bot-enhancement spec (Instruction Set D): chips offer genuine choice and every
choice routes somewhere different in the session engine. Intent tags live
server-side only — the client receives plain strings.

Imported by web_ui, student_routes, and livekit/voice_routes; imports nothing
from them.
"""

import os
import random
import re


def _flag(name: str, default: bool = False) -> bool:
    """Read a boolean feature flag from the environment at call time (ADO #26
    quality follow-up). Lazy read so flags can flip without a redeploy and tests
    can toggle per-case."""
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


# Intent vocabulary. Keep in sync with the <SUGGESTED_RESPONSES> section of the
# system_prompt template and SessionEngine routing.
INTENTS = ("example", "ready", "explore", "confused", "continue",
           "recap", "end", "recall_more", "hint")

# How a deterministically-matched chip click enters the state machine.
# Pseudo-types (student_wants_*) are handled in SessionEngine._process_teach;
# closure_* / recall_more in _process_closure / _process_recall; hint in
# _process_try (ADO #26 D).
INTENT_TO_INTERACTION = {
    "example": "student_wants_example",
    "explore": "student_wants_explore",
    "ready": "student_understands",
    "continue": "student_understands",
    "confused": "student_confused",
    "recap": "closure_recap",
    "end": "closure_end",
    "recall_more": "recall_more",
    "hint": "student_wants_hint",
}


def intent_interaction(intent, phase=None):
    """Interaction type a routed chip click enters the state machine as.

    `ready` during TEACH routes as student_move_on: a chip that says "let me
    try" must actually deliver a TRY, so it jumps the remaining TEACH scaffold
    steps (move_on_teach_to_try) instead of advancing one step at a time —
    multi-TEACH facts previously answered it with more teaching. Scoped to
    TEACH because at capsule closure student_move_on would END the session
    where student_understands offers the recap. Everywhere else the static
    map applies.
    """
    if not intent:
        return None
    if intent == "ready" and phase == "TEACH":
        return "student_move_on"
    return INTENT_TO_INTERACTION.get(intent)

# Interaction types that exist only for engagement routing — they carry no
# understanding signal and must not be recorded as report-card interactions.
PSEUDO_INTERACTION_TYPES = frozenset({
    "student_wants_example", "student_wants_explore",
    "closure_recap", "closure_end", "recall_more",
    "student_wants_hint",
})

_INTENT_PREFIX = re.compile(
    r'^\s*(' + '|'.join(INTENTS) + r')\s*:\s*(.+?)\s*$', re.IGNORECASE)

# Sort weight for semantic position stability: help options first, the
# advance/"ready" option always last, everything else in between.
_ORDER = {"confused": 0, "ready": 2}


def tag_suggestions(lines):
    """Convert raw <SUGGESTIONS> lines to [{"text", "intent"}].

    Lines with a known `intent:` prefix are stripped and tagged; anything else
    (including unknown prefixes) passes through whole with intent None — those
    chips degrade gracefully to the classifier path when clicked.
    """
    tagged = []
    for line in lines or []:
        if not isinstance(line, str):
            continue  # malformed pre-gen/LLM data must never 500 a chat turn
        m = _INTENT_PREFIX.match(line)
        if m:
            tagged.append({"text": m.group(2), "intent": m.group(1).lower()})
        else:
            text = line.strip()
            if text:
                tagged.append({"text": text, "intent": None})
    return tagged


def texts(tagged):
    """Client-facing shape: plain list of chip strings (intents stay server-side)."""
    return [item["text"] for item in tagged]


def _ordered(chips):
    return sorted(chips, key=lambda c: _ORDER.get(c["intent"], 1))


def _c(intent, text):
    return {"text": text, "intent": intent}


# Curated fallback sets, keyed by (phase, teach_context). Used whenever the
# tutor LLM emits fewer than 2 parseable chips. Wording rules (enforced by
# api/tests/test_engagement.py):
#   - request-shaped student voice ("Can we…?"), coherent under ANY teach block
#   - <= 12 words; never the old binary pair
#   - must not contain skip / move on / already know / next fact (classifier
#     substring rules would mis-route an untagged copy as move_on)
_POOLS = {
    ("TEACH", None): [
        [_c("confused", "I'm not sure I follow yet"),
         _c("example", "Can we go through an example together?"),
         _c("ready", "I'm ready to try it myself")],
        [_c("confused", "Could you explain that a different way?"),
         _c("explore", "What's a tricky question about this?"),
         _c("ready", "Let me give it a go")],
        [_c("example", "Show me how this works first"),
         _c("ready", "I'd like to try one now")],
        [_c("confused", "I'm a bit lost on that"),
         _c("example", "Can you walk me through one?"),
         _c("ready", "I think I've got it — let me try")],
        [_c("explore", "Can we dig a little deeper into this?"),
         _c("ready", "I'm ready for a challenge")],
    ],
    ("TEACH", "confused"): [
        [_c("confused", "Still fuzzy — can you try another way?"),
         _c("example", "Walk me through one more example"),
         _c("ready", "That helped — let me try")],
        [_c("confused", "Can you break it into smaller steps?"),
         _c("ready", "I think it clicked — let me try")],
        [_c("example", "One more example would help"),
         _c("ready", "Clearer now — I'll give it a try")],
    ],
    ("TEACH", "example"): [
        [_c("confused", "I'm still not sure how that worked"),
         _c("example", "Can we do one more together?"),
         _c("ready", "Now let me try one")],
        [_c("confused", "Wait — why did that step happen?"),
         _c("ready", "Okay, my turn to try")],
    ],
    ("TEACH", "explore"): [
        [_c("confused", "Hmm, that twisted my brain a little"),
         _c("explore", "That's interesting — tell me more"),
         _c("ready", "Back to practicing — I'm ready")],
        [_c("explore", "What's another surprising thing about this?"),
         _c("ready", "I'm ready to try it now")],
    ],
    ("RECALL", None): [
        [_c("recall_more", "Quiz me on what we did last time"),
         _c("continue", "Let's get into something new")],
        [_c("recall_more", "Can we review for a minute first?"),
         _c("continue", "I remember it — let's keep going")],
    ],
    ("CAPSULE_COMPLETE", None): [
        [_c("recap", "Recap what I learned today"),
         _c("end", "I'm done for today")],
        [_c("recap", "What did we cover today?"),
         _c("end", "That's a wrap for me")],
    ],
}
# reteach feels like confused from the student's side — same sets
_POOLS[("TEACH", "reteach")] = _POOLS[("TEACH", "confused")]

# Voice fast-follow guard: no deterministic routing in voice yet, so only offer
# intents the unrouted classifier/assessor path already honors well.
_VOICE_ROUTABLE = ("ready", "confused", "continue")
_VOICE_POOLS = {
    "TEACH": [
        [_c("confused", "I don't get it yet"),
         _c("ready", "I've got it — let me try")],
        [_c("confused", "Can you explain that again?"),
         _c("ready", "That makes sense — I'm ready")],
    ],
    "RECALL": [
        [_c("confused", "Remind me what we did last time"),
         _c("continue", "I remember — let's keep going")],
    ],
    "CAPSULE_COMPLETE": [
        # Voice has no chip routing yet — only offer what the unrouted path
        # can honor. A "recap" chip here would silently END the session, and
        # this text deliberately matches the goodbye pattern ("i'm done" at
        # message end) so the existing voice end path handles it.
        [_c("end", "I'm done")],
    ],
}


def fallback_suggestions(phase, teach_context=None, rng=random, voice=False):
    """Pick one curated chip set for (phase, teach_context).

    Unknown keys fall back to the default TEACH pool. `rng` is injectable for
    deterministic tests. voice=True restricts to classifier-routable intents
    (no example/explore agency until voice routing lands).
    """
    if voice:
        sets = _VOICE_POOLS.get(phase) or _VOICE_POOLS["TEACH"]
    else:
        sets = (_POOLS.get((phase, teach_context))
                or _POOLS.get((phase, None))
                or _POOLS[("TEACH", None)])
    return _ordered(list(rng.choice(sets)))


def resolve_suggestions(raw_suggestions, phase, teach_context=None,
                        closure_offered=False, closure_ended=False,
                        voice=False, rng=random, exclude_intents=None):
    """Single decision point for what chips a turn shows.

    Gating: chips appear in TEACH and RECALL, and at capsule closure only while
    the closure choice is open. Assessment phases (TRY/CHECK/EVIDENCE/
    CHECK_REMEDIATION) stay chip-free so clicks can never substitute for
    produced evidence.

    exclude_intents: intents whose routes can't currently be honored (missing
    template, recall cap reached) — chips must never promise what the engine
    can't deliver.

    Returns (tagged_chips, used_fallback). LLM-emitted chips win when at least
    2 carry intents (untagged-only sets can't route and may be stale-format
    pre-gen data); otherwise the curated pool fills in (used_fallback=True —
    logged by callers for the i18n/coherence watch).
    """
    allowed = (phase in ("TEACH", "RECALL")
               or (phase == "CAPSULE_COMPLETE" and closure_offered
                   and not closure_ended))
    if not allowed:
        return [], False
    exclude = exclude_intents or set()
    tagged = [c for c in tag_suggestions(raw_suggestions)
              if c["intent"] not in exclude or c["intent"] is None]
    if sum(1 for c in tagged if c["intent"]) >= 2 and not voice:
        return tagged, False
    pool = [c for c in fallback_suggestions(phase, teach_context, rng=rng, voice=voice)
            if c["intent"] not in exclude]
    return pool, True


def match_chip(user_message, last_suggestions):
    """Deterministic chip-click routing: exact (trim+casefold) match against
    the suggestions emitted last turn. Returns the intent, or None to fall
    through to the normal classifier/assessor pipeline. Untagged chips also
    return None."""
    if not user_message or not last_suggestions:
        return None
    needle = user_message.strip().casefold()
    for chip in last_suggestions:
        if chip.get("intent") and chip.get("text", "").strip().casefold() == needle:
            return chip["intent"]
    return None


# ---------------------------------------------------------------------------
# Session-level glue (duck-typed on SessionState; shared by web_ui,
# student_routes, and voice_routes so the logic exists exactly once)
# ---------------------------------------------------------------------------

# Routed intents and the prompt template each one's route renders. If the
# template is missing from the registry (e.g. code deployed before the prompt
# script ran), the chip must not be offered — never promise an empty route.
_INTENT_TEMPLATES = {
    "example": "step_teach_example",
    "explore": "step_teach_explore",
    "recall_more": "step_recall_engage",
    "recap": "step_capsule_closure_recap",
}


def _unroutable_intents(engine):
    exclude = set()
    prompts = getattr(engine, "prompts", {}) or {}
    for intent, pid in _INTENT_TEMPLATES.items():
        if not (prompts.get(pid) or {}).get("template"):
            exclude.add(intent)
    if engine.state.get("recall_turns", 0) >= 2:
        exclude.add("recall_more")  # cap reached — the click would not route
    return exclude


# ---------------------------------------------------------------------------
# ADO #26 C*: deterministic, fact-content-anchored chips.
# The tutor LLM reliably ignored "vary your chips / never repeat" and collapsed
# to example+ready every turn, so the server now AUTHORS chips from the fact's
# own content and rotates them. Guarantees: every chip routes, every chip is
# anchored to THIS fact, zero extra tokens, no model variance.
# ---------------------------------------------------------------------------

# Intent-set rotation per (phase, teach_context). _ordered() applies help-first
# ordering later; these only control which intents appear and how they rotate.
_INTENT_ROTATIONS = {
    ("TEACH", None): [
        ("confused", "example", "ready"),
        ("example", "ready"),
        ("confused", "explore", "ready"),
        ("explore", "ready"),
        ("example", "confused", "ready"),
    ],
    ("TEACH", "confused"): [
        ("confused", "example", "ready"),
        ("example", "ready"),
        ("confused", "ready"),
    ],
    ("TEACH", "example"): [
        ("confused", "example", "ready"),
        ("explore", "ready"),
        ("confused", "ready"),
    ],
    ("TEACH", "explore"): [
        ("confused", "explore", "ready"),
        ("explore", "ready"),
        ("confused", "ready"),
    ],
    ("RECALL", None): [
        ("recall_more", "continue"),
        ("continue", "recall_more"),
    ],
    ("CAPSULE_COMPLETE", None): [
        ("recap", "end"),
    ],
}
_INTENT_ROTATIONS[("TEACH", "reteach")] = _INTENT_ROTATIONS[("TEACH", "confused")]
_INTENT_ROTATIONS[("TEACH", "confirm")] = _INTENT_ROTATIONS[("TEACH", None)]
_INTENT_ROTATIONS[("TEACH", "continue")] = _INTENT_ROTATIONS[("TEACH", None)]

# Per-intent phrasing banks. {topic} is filled with a short, fact-derived noun
# phrase so chips reference what's actually being taught. Rotated by index.
_PHRASES = {
    "confused": ["I'm not sure I follow yet",
                 "Could you explain that another way?",
                 "Can you break it into smaller steps?"],
    "ready": ["I'm ready to try it myself",
              "Let me give it a go",
              "I think I've got it, let me try"],
    "example": ["Can we work through an example of {topic}?",
                "Show me {topic} in action",
                "Walk me through one together"],
    "explore": ["What's something surprising about {topic}?",
                "Can we dig deeper into {topic}?",
                "What's a tricky question about {topic}?"],
    "continue": ["I remember it — let's keep going",
                 "Let's get into something new"],
    "recall_more": ["Quiz me on what we did last time",
                    "Can we review for a minute first?"],
    "recap": ["Recap what I learned today", "What did we cover today?"],
    "end": ["I'm done for today", "That's a wrap for me"],
}

_HINT_PHRASES = ["I'm stuck, give me a hint",
                 "Can I get a hint?",
                 "I could use a little nudge"]


def _topic(fact_meta):
    """Short noun phrase naming what's being taught, for chip text. Prefers a
    vocabulary term; falls back to a trimmed core_fact. Never raises on odd
    JSONB."""
    if isinstance(fact_meta, dict):
        vocab = fact_meta.get("vocabulary")
        term = None
        if isinstance(vocab, str) and vocab.strip():
            term = vocab.split(";")[0].strip()
        elif isinstance(vocab, list):
            for v in vocab:
                if isinstance(v, dict) and str(v.get("term") or "").strip():
                    term = str(v["term"]).strip()
                    break
                if isinstance(v, str) and v.strip():
                    term = v.strip()
                    break
        if term:
            return term
        core = str(fact_meta.get("core_fact") or "").strip()
        if core:
            words = core.rstrip(".").split()
            return " ".join(words[:6]) + ("…" if len(words) > 6 else "")
    return "this"


def _phrase(intent, idx, topic):
    bank = _PHRASES.get(intent)
    if not bank:
        return None
    return bank[idx % len(bank)].replace("{topic}", topic)


def build_fact_chips(phase, teach_context, fact_meta, rotation_index,
                     exclude=None, last_offered=None):
    """Deterministic, fact-anchored chip set for a turn (ADO #26 C*).

    rotation_index advances each turn so the intent set and wording vary and
    avoid repeating the previous turn's intent set. exclude drops unroutable
    intents. Returns ordered [{"text","intent"}]."""
    exclude = exclude or set()
    options = (_INTENT_ROTATIONS.get((phase, teach_context))
               or _INTENT_ROTATIONS.get((phase, None))
               or _INTENT_ROTATIONS[("TEACH", None)])
    n = len(options)
    last = tuple(last_offered or ())
    chosen = None
    # Prefer a rotation that is routable AND differs from last turn's intents.
    for step in range(n):
        cand = tuple(i for i in options[(rotation_index + step) % n] if i not in exclude)
        if len(cand) >= 2 and cand != last:
            chosen = cand
            break
    if chosen is None:  # all collided — accept a repeat rather than show nothing
        for step in range(n):
            cand = tuple(i for i in options[(rotation_index + step) % n] if i not in exclude)
            if len(cand) >= 2:
                chosen = cand
                break
    if not chosen:
        return []
    topic = _topic(fact_meta)
    chips = [_c(intent, _phrase(intent, rotation_index + j, topic))
             for j, intent in enumerate(chosen)
             if _phrase(intent, rotation_index + j, topic)]
    return _ordered(chips)


def _build_session_chips(engine, phase, ctx, exclude):
    """Deterministic chip resolution against live engine state (C* + D)."""
    state = engine.state
    fs = engine.fact_status() or {}
    # TRY: a single hint chip (ADO #26 D), only after >=1 attempt and under cap.
    # Assessment phases otherwise stay chip-free so a click can't stand in for
    # produced evidence.
    if phase == "TRY":
        # Mirror _unroutable_intents: never offer a chip whose route template is
        # missing (code deployed before the prompt seed) — the click would land
        # on an empty render and silently burn a hint.
        hint_routable = bool((getattr(engine, "prompts", {}) or {})
                             .get("step_try_hint", {}).get("template"))
        if (_flag("TRY_HINT") and hint_routable
                and fs.get("try_attempts", 0) >= 1
                and fs.get("hints_given", 0) < 2):
            idx = state.get("chip_rotation_index", 0)
            state["chip_rotation_index"] = idx + 1
            state["last_offered_intents"] = ["hint"]
            return [_c("hint", _HINT_PHRASES[idx % len(_HINT_PHRASES)])]
        state["last_offered_intents"] = []
        return []
    if phase == "CAPSULE_COMPLETE":
        if not (state.get("closure_state") == "offered"
                and not state.get("closure_ended")):
            state["last_offered_intents"] = []
            return []
    elif phase not in ("TEACH", "RECALL"):
        state["last_offered_intents"] = []
        return []
    fact_meta = engine.current_fact_meta if phase == "TEACH" else {}
    rot = state.get("chip_rotation_index", 0)
    chips = build_fact_chips(phase, ctx, fact_meta, rot, exclude=exclude,
                             last_offered=state.get("last_offered_intents"))
    state["chip_rotation_index"] = rot + 1
    state["last_offered_intents"] = [c["intent"] for c in chips]
    return chips


def resolve_for_session(session, raw_suggestions):
    """Resolve a turn's chips against the session's v6 engine state and store
    the tagged copies in engine state for deterministic click routing.
    Returns the tagged list (use texts() for the client shape)."""
    engine = getattr(session, "_session_engine", None)
    deterministic = _flag("ENGAGEMENT_DETERMINISTIC_CHIPS")
    used_fallback = False
    ctx = None
    if engine is not None and engine.state:
        phase = engine.current_phase
        ctx = engine.state.get("teach_context")
        exclude = _unroutable_intents(engine)
        if deterministic:
            tagged = _build_session_chips(engine, phase, ctx, exclude)
        else:
            tagged, used_fallback = resolve_suggestions(
                raw_suggestions, phase, teach_context=ctx,
                closure_offered=engine.state.get("closure_state") == "offered",
                closure_ended=bool(engine.state.get("closure_ended")),
                exclude_intents=exclude)
        engine.state["last_suggestions"] = tagged
    else:
        # Legacy sessions without the v6 engine: gate by progress step_name
        step = session.progress.get("current_position", {}).get("step_name", "") or "TEACH"
        phase = step
        tagged, used_fallback = resolve_suggestions(raw_suggestions, phase)
    if used_fallback:
        # Watch this rate: fallback chips are English-only and not authored by
        # the message they sit under
        try:
            session.log_execution("SUGGESTIONS_FALLBACK", {
                "phase": phase, "teach_context": ctx,
                "parsed_count": len(raw_suggestions or []),
            }, agent="Orchestrator")
        except Exception:
            pass
    return tagged


def match_for_session(session, user_message):
    """Match the student's message against the chips emitted last turn.
    Hit → deterministic routing (no classifier LLM call). Logs CHIP_MATCH
    telemetry so exact-match fragility is observable.

    Phase-gated: chips only exist in TEACH/RECALL/closure, so a match in any
    other phase means stale state (voice turns, failed tutor streams, second
    tabs) — honoring it could mark unanswered CHECK/EVIDENCE facts FAILED.
    Hits CONSUME the stored chips so a duplicate/retried send can't double-fire
    a detour."""
    engine = getattr(session, "_session_engine", None)
    if engine is None or not engine.state:
        return None
    # TRY is included for the ADO #26 D hint chip only; all other assessment
    # phases stay unmatched so a stale click can't substitute for evidence.
    if engine.current_phase not in ("TEACH", "RECALL", "CAPSULE_COMPLETE", "TRY"):
        return None
    last = engine.state.get("last_suggestions") or []
    # Capture fact/phase BEFORE routing consumes/advances anything — this is
    # the context the chips were offered in, used by engagement monitoring to
    # attribute a click to a fact (e.g. hollow-ready correlation).
    chip_fact = engine.current_fact_text
    chip_phase = engine.current_phase
    intent = match_chip(user_message, last)
    # In TRY only the hint intent may route; any other (stale) chip is ignored.
    if chip_phase == "TRY" and intent != "hint":
        intent = None
    if intent:
        engine.state["last_suggestions"] = []
    if last:
        try:
            session.log_execution("CHIP_MATCH", {
                "hit": bool(intent),
                "intent": intent,
                "offered": [c.get("intent") for c in last],
                "fact": chip_fact,
                "phase": chip_phase,
            }, agent="Orchestrator")
        except Exception:
            pass
    return intent
