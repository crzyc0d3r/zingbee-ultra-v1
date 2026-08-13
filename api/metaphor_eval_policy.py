"""Policy/constants for the capsule metaphor authoring pipeline.

Used by metaphor_eval_service.py, metaphor_eval_routes.py, and metaphor_eval_cli.py
so all three see the same judge roster, weights, and decision thresholds.

Architecture mirrors image_eval_policy.py: a fixed set of judges, weighted
consensus scoring, and a decision tier (AUTO_ACCEPT / NEEDS_REVIEW / AUTO_REJECT).

The plan for this pipeline (now-for-the-actual-magical-sparkle.md, Phase A0b) calls
for FIVE judges, each running a DIFFERENT local model so prior diversity surfaces
real disagreement as signal, not statistical noise. The judge slot definitions
below capture the *role* + *rubric* per judge; the preferred model per slot is
configurable via env (METAPHOR_JUDGE_<NAME>_MODEL / _PROVIDER) so an operator can swap
in DeepSeek, Phi-4, etc. as those local models come online without touching code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from statistics import mean
from typing import Any


# ---------------------------------------------------------------------------
# Judge roster
# ---------------------------------------------------------------------------

# Each judge slot has a fixed name (used as a JSON key in stored proposals)
# and a fixed weight. The PROVIDER + MODEL per slot are env-overridable so the
# heterogeneous-prior story can evolve as more local models come online.
@dataclass(frozen=True)
class JudgeSlot:
    name: str
    weight: float
    rubric: str
    default_provider: str  # "local_text_eval" | "local_nemo" | "local_gemma" | "local_text_gen" | "xai"
    default_model: str | None = None  # None = use provider's configured default


# Suggested initial roster. Until local open-weight models are wired up, the
# practical V1 of the heterogeneous panel uses FIVE distinct
# training-distribution lineages across three live API endpoints (xAI direct,
# Google Gemini, Cerebras inference for open-weight Qwen / GPT-OSS / Llama).
# If OpenAI or Anthropic keys are present in the .env, the policy can swap
# slots 1-2 to use them directly without code changes — `default_provider`
# overrides flow through the METAPHOR_JUDGE_<NAME>_PROVIDER env vars.
#
# Lineage assignment per slot picks the model family whose pretraining
# distribution is most likely to give a meaningfully different read on the
# slot's rubric, not just whichever vendor is cheapest. Cerebras-hosted
# models are distinct families even though they share an inference endpoint —
# Qwen (Alibaba), GPT-OSS (OpenAI open-weight), Llama (Meta) all carry
# different priors.
JUDGE_SLOTS: list[JudgeSlot] = [
    JudgeSlot(
        name="pedagogical_fit",
        weight=0.25,
        rubric=(
            "How well does the metaphor land on the pedagogy of the capsule? "
            "Does it map cleanly onto the facts being taught, or does it warp "
            "the underlying concept? Penalize metaphors that require explaining "
            "the metaphor itself before it can teach the concept."
        ),
        # Qwen-3 235B — large reasoning model, Chinese-origin training prior
        # gives a different read on whether a metaphor maps cleanly onto a
        # concept than a Western-trained model would.
        default_provider="cerebras_qwen",
    ),
    JudgeSlot(
        name="sustainability",
        weight=0.25,
        rubric=(
            "Can this metaphor SUSTAIN across multiple reteach rounds, deepening "
            "the same example, or does it feel one-shot? Walk the facts in order "
            "and check that the metaphor can be EXTENDED for each one without "
            "switching analogies. The Baccalauréat tester's diagnosis was that "
            "today's bot jumps to a new analogy on round 2 — that failure mode "
            "is exactly what this judge catches."
        ),
        # GPT-OSS 120B (OpenAI open-weight lineage) — narrative-coherence
        # prior strong enough to catch "the metaphor restates, doesn't deepen".
        default_provider="cerebras",
    ),
    JudgeSlot(
        name="age_fit",
        weight=0.20,
        rubric=(
            "Is this metaphor age-appropriate for the target age range of the "
            "capsule? A 'mortgage' metaphor for a 9-year-old fails this. A "
            "'crayon box' metaphor for a 17-year-old also fails this. Penalize "
            "metaphors that require knowledge or life experience the student "
            "is unlikely to have."
        ),
        # Google Gemini — broad demographic + safety-tuning prior; well-calibrated
        # on child-facing content judgement.
        default_provider="google",
    ),
    JudgeSlot(
        name="cultural_neutrality",
        weight=0.15,
        rubric=(
            "Does this metaphor assume Western-suburban defaults (e.g. baseball, "
            "American football, sliced bread, Thanksgiving)? Could it land flat "
            "or confuse a student outside that context? Score higher for "
            "metaphors that draw on universal-human experience (rivers, family, "
            "shelter, food, music) over culturally-bounded ones."
        ),
        # xAI Grok — its training corpus (X/Twitter heavy) gives a different
        # cultural prior from the more-curated frontier corpora; useful as a
        # tie-breaker on what reads as "default culture" to whom.
        default_provider="xai",
    ),
    JudgeSlot(
        name="working_memory_load",
        weight=0.15,
        rubric=(
            "Following Cowan's working-memory limits: is this metaphor ONE "
            "imageable chunk, or does it secretly contain three ideas the "
            "student has to hold simultaneously? Penalize metaphors that "
            "require multi-part bookkeeping ('imagine it like a kitchen, but "
            "also a library, but also a factory'). Score for single-chunk "
            "imageability."
        ),
        # Llama-3.1 8B on Cerebras — small model is fine for this slot since
        # the rubric is structural ("is this one chunk?"), not reasoning-heavy.
        # The Meta lineage rounds out the panel to five distinct families.
        default_provider="cerebras_llama",
    ),
]

# Quick-lookup map by judge name
JUDGE_BY_NAME: dict[str, JudgeSlot] = {j.name: j for j in JUDGE_SLOTS}
JUDGE_NAMES: list[str] = [j.name for j in JUDGE_SLOTS]


def resolve_judge_provider(judge_name: str) -> str:
    """Return the provider id for a judge slot, honoring METAPHOR_JUDGE_<NAME>_PROVIDER overrides."""
    slot = JUDGE_BY_NAME.get(judge_name)
    if slot is None:
        return "xai"
    override = os.environ.get(f"METAPHOR_JUDGE_{judge_name.upper()}_PROVIDER", "").strip().lower()
    return override or slot.default_provider


def resolve_judge_model(judge_name: str) -> str | None:
    """Return the model name override for a judge slot, or None to use provider default."""
    slot = JUDGE_BY_NAME.get(judge_name)
    if slot is None:
        return None
    override = os.environ.get(f"METAPHOR_JUDGE_{judge_name.upper()}_MODEL", "").strip()
    return override or slot.default_model


# ---------------------------------------------------------------------------
# Decision thresholds
# ---------------------------------------------------------------------------

DEFAULT_THRESHOLDS = {
    "auto_accept": 0.85,    # weighted mean >= → AUTO_ACCEPT (still gated by variance)
    "auto_reject": 0.50,    # weighted mean <= → AUTO_REJECT (queue for regenerate)
    "variance_review": 0.40,  # max - min across judges > → force NEEDS_REVIEW even if mean is high
}


# Critical flags any single judge can raise that block AUTO_ACCEPT regardless of mean
CRITICAL_FLAGS: set[str] = {
    "stereotype_risk",
    "age_inappropriate",
    "factually_warps_concept",
    "doesnt_actually_sustain",  # the "salad dressing bottle" failure mode
}


# ---------------------------------------------------------------------------
# Guardrails
# ---------------------------------------------------------------------------

DEFAULT_GUARDRAILS = {
    "max_proposals_per_capsule": 3,
    "max_capsules_per_command": 200,
    # 2h ceiling sized for a full-subject batch (Biology ~95 capsules at
    # ~70-80s/capsule lands around 110 minutes; doubling that gives margin
    # for transient retries). 1800s was too tight for the first Biology run
    # and trip-canceled at 25/95 processed.
    "max_runtime_seconds_per_command": 7200,
    # 26-fact Biology capsules at 3 candidates × ~120 chars-per-fact sustained
    # example + rationale + scaffolding can run ~3500-4000 output tokens.
    # 4096 was the failure boundary — 8192 keeps the largest capsules safe.
    "proposer_max_tokens": 8192,
    "judge_max_tokens": 1024,
    "proposer_temperature": 0.8,   # higher → more diverse proposals
    "judge_temperature": 0.1,      # lower → consistent scoring
}


# Identity stamp for skip/re-eval decisions when rubric or roster changes.
# Bump RUBRIC_VERSION when the system prompts or weights change in a way that
# would invalidate prior judge results.
RUBRIC_VERSION = 1


def make_eval_identity() -> dict[str, Any]:
    return {
        "rubric_version": RUBRIC_VERSION,
        "judge_names": sorted(JUDGE_NAMES),
        "weights": {j.name: j.weight for j in JUDGE_SLOTS},
    }


# ---------------------------------------------------------------------------
# Consensus + decision computation
# ---------------------------------------------------------------------------

@dataclass
class ConsensusResult:
    composite: float
    variance: float
    decision: str            # "AUTO_ACCEPT" | "NEEDS_REVIEW" | "AUTO_REJECT"
    reasons: list[str] = field(default_factory=list)


_MIN_SUCCESSFUL_JUDGES = 3  # below this, force NEEDS_REVIEW with `insufficient_judges` reason


def compute_consensus_and_decision(
    judge_results: dict[str, dict[str, Any]],
    *,
    thresholds: dict[str, float] | None = None,
) -> ConsensusResult:
    """Compute weighted consensus across judges and return tier decision.

    judge_results: {judge_name: {"score": float|None, "flags": list[str], ...}}.

    Slots with `score=None` or with `evaluation_error` in flags are EXCLUDED
    from both the weighted mean and variance, and surviving slot weights are
    renormalized. Without this, a single broken judge dragged a 0.95 metaphor
    down by up to 0.25 (its weight × 0) AND inflated variance via max-min,
    forcing NEEDS_REVIEW or worse AUTO_REJECT — false negatives on the
    happy path. If fewer than _MIN_SUCCESSFUL_JUDGES survive, force
    NEEDS_REVIEW with reason `insufficient_judges`.
    """
    th = thresholds or DEFAULT_THRESHOLDS

    successful_slots: list[tuple[Any, float]] = []  # (slot, score)
    excluded: list[str] = []
    fallback_count = 0
    for slot in JUDGE_SLOTS:
        payload = judge_results.get(slot.name) or {}
        flags = payload.get("flags") or []
        if payload.get("fell_back"):
            fallback_count += 1
        if "evaluation_error" in flags:
            excluded.append(slot.name)
            continue
        raw_score = payload.get("score")
        if raw_score is None:
            excluded.append(slot.name)
            continue
        try:
            s = max(0.0, min(1.0, float(raw_score)))
        except (TypeError, ValueError):
            excluded.append(slot.name)
            continue
        successful_slots.append((slot, s))

    successful_count = len(successful_slots)
    weight_total = sum(slot.weight for slot, _ in successful_slots)

    if successful_count == 0 or weight_total == 0:
        reasons = [
            "composite:0.000",
            "variance:0.000",
            f"successful_judges:0/{len(JUDGE_SLOTS)}",
            "insufficient_judges",
        ]
        if excluded:
            reasons.append(f"excluded:{','.join(sorted(excluded))}")
        return ConsensusResult(
            composite=0.0, variance=0.0, decision="NEEDS_REVIEW", reasons=reasons,
        )

    composite = sum(score * (slot.weight / weight_total) for slot, score in successful_slots)
    scores_only = [s for _, s in successful_slots]
    variance = max(scores_only) - min(scores_only)

    all_flags: set[str] = set()
    for payload in judge_results.values():
        flags = payload.get("flags") or []
        if isinstance(flags, list):
            all_flags.update(str(f).strip() for f in flags if str(f).strip())

    reasons: list[str] = [
        f"composite:{composite:.3f}",
        f"variance:{variance:.3f}",
        f"successful_judges:{successful_count}/{len(JUDGE_SLOTS)}",
    ]
    if excluded:
        reasons.append(f"excluded:{','.join(sorted(excluded))}")

    if successful_count < _MIN_SUCCESSFUL_JUDGES:
        reasons.append("insufficient_judges")
        return ConsensusResult(
            composite=composite, variance=variance, decision="NEEDS_REVIEW", reasons=reasons,
        )

    # Heterogeneous-prior degeneracy guard: if the majority of surviving judges
    # fell back from their preferred local model to xAI, the panel is no longer
    # 5 distinct priors voting — it's mostly the same model voting twice or
    # more. Force NEEDS_REVIEW so a human eyeballs the result. The panel's
    # fell_back flag is set per-judge by the service dispatcher.
    if fallback_count > successful_count // 2:
        reasons.append(f"degenerate_panel:{fallback_count}_of_{len(JUDGE_SLOTS)}_fell_back")
        return ConsensusResult(
            composite=composite, variance=variance, decision="NEEDS_REVIEW", reasons=reasons,
        )

    triggered_critical = all_flags & CRITICAL_FLAGS
    if triggered_critical:
        reasons.append(f"critical_flag:{','.join(sorted(triggered_critical))}")
        decision = "AUTO_REJECT" if composite < float(th["auto_accept"]) else "NEEDS_REVIEW"
        return ConsensusResult(composite=composite, variance=variance, decision=decision, reasons=reasons)

    if variance > float(th["variance_review"]):
        reasons.append("high_variance")
        return ConsensusResult(
            composite=composite, variance=variance, decision="NEEDS_REVIEW", reasons=reasons,
        )

    if composite >= float(th["auto_accept"]):
        return ConsensusResult(composite=composite, variance=variance, decision="AUTO_ACCEPT", reasons=reasons)
    if composite <= float(th["auto_reject"]):
        return ConsensusResult(composite=composite, variance=variance, decision="AUTO_REJECT", reasons=reasons)
    return ConsensusResult(composite=composite, variance=variance, decision="NEEDS_REVIEW", reasons=reasons)


# ---------------------------------------------------------------------------
# Proposer + judge prompt scaffolding (text-only — no image_b64 hassle)
# ---------------------------------------------------------------------------

PROPOSER_SYSTEM_PROMPT = (
    "You are an expert curriculum designer specializing in sustained metaphors "
    "for adolescent learning. Given a learning capsule's name, age range, and "
    "the facts taught within it, propose three (3) candidate sustained metaphors "
    "the tutor can use to anchor instruction across all reteach rounds.\n\n"
    "Hard requirements for every proposal:\n"
    "  - One concrete, imageable, single-chunk anchor (e.g. 'a house', 'a river', "
    "'a recipe', 'a band warming up'). NOT abstract ('order', 'balance').\n"
    "  - Must SUSTAIN across every fact in the capsule. Walk each fact and write "
    "ONE sentence describing how the metaphor extends to that fact.\n"
    "  - Must be age-appropriate for the stated age range.\n"
    "  - Must avoid Western-suburban defaults (no baseball, no Thanksgiving, no "
    "American sliced bread). Prefer universal-human anchors.\n"
    "  - Must NOT require explaining the metaphor itself before it can teach.\n\n"
    "Return STRICT JSON of the form:\n"
    "{\n"
    '  "proposals": [\n'
    '    {\n'
    '      "metaphor": "the house",\n'
    '      "rationale": "one-paragraph why this works",\n'
    '      "sustained_examples_per_fact": {"<fact_id>": "one sentence...", ...}\n'
    '    },\n'
    "    ...\n"
    "  ]\n"
    "}\n"
    "The sustained_examples_per_fact dict MUST have an entry for EVERY fact id provided."
)


def build_proposer_user_prompt(
    *,
    capsule_name: str,
    subject: str,
    age_range: str,
    theme_name: str,
    facts: list[dict[str, Any]],
) -> str:
    """Compose the per-capsule proposer user prompt from capsule + facts.

    facts: list of {fact_id, fact_text, fact_meta (jsonb dict)}.
    """
    fact_block_lines: list[str] = []
    for f in facts:
        meta = f.get("fact_meta") or {}
        vocab_terms = []
        for v in (meta.get("vocabulary") or []):
            if isinstance(v, dict) and v.get("term"):
                vocab_terms.append(v["term"])
        misc_lines = []
        for m in (meta.get("misconceptions") or []):
            if isinstance(m, dict):
                w = m.get("misconception") or m.get("wrong") or ""
                c = m.get("correct_understanding") or m.get("correct") or ""
                if w and c:
                    misc_lines.append(f"      misconception: {w} -> {c}")
        block = [
            f"  - fact_id: {f['fact_id']}",
            f"    text: {f['fact_text']}",
        ]
        if vocab_terms:
            block.append(f"    vocabulary: {', '.join(vocab_terms)}")
        if misc_lines:
            block.append("    misconceptions:")
            block.extend(misc_lines)
        fact_block_lines.append("\n".join(block))

    facts_yaml = "\n".join(fact_block_lines)
    return (
        f"Capsule: {capsule_name}\n"
        f"Subject: {subject}\n"
        f"Theme: {theme_name}\n"
        f"Target age range: {age_range}\n\n"
        f"Facts taught in this capsule (in order):\n{facts_yaml}\n\n"
        f"Propose three sustained metaphors per the system instructions."
    )


def build_judge_user_prompt(
    *,
    judge_name: str,
    capsule_name: str,
    subject: str,
    age_range: str,
    theme_name: str,
    proposal: dict[str, Any],
    facts: list[dict[str, Any]],
) -> str:
    """Per-judge prompt: scoring rubric for ONE proposal against ONE capsule."""
    slot = JUDGE_BY_NAME[judge_name]
    sustained = proposal.get("sustained_examples_per_fact") or {}
    sustained_lines = []
    for f in facts:
        ex = sustained.get(str(f["fact_id"])) or sustained.get(f["fact_id"]) or "(missing)"
        sustained_lines.append(f"  - [{f['fact_text']}] -> {ex}")

    return (
        f"You are JUDGE: {slot.name}\n"
        f"Your rubric: {slot.rubric}\n\n"
        f"Capsule: {capsule_name} (subject={subject}, theme={theme_name}, age={age_range})\n\n"
        f"Proposed metaphor: {proposal.get('metaphor', '')}\n"
        f"Rationale: {proposal.get('rationale', '')}\n\n"
        f"How the proposer says the metaphor sustains across facts:\n"
        + "\n".join(sustained_lines)
        + "\n\nReturn STRICT JSON: "
          '{"score": <0..1 float>, "reasoning": "<1-2 sentences>", '
          '"flags": ["<zero or more of: stereotype_risk, age_inappropriate, '
          'factually_warps_concept, doesnt_actually_sustain, requires_explaining_metaphor, '
          'multi_chunk_load>"]}'
    )
