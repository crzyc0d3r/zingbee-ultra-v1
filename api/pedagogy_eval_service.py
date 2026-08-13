"""Offline session-level PEDAGOGY scorer (Track B / B2b, ADO #58).

Scores a finished tutoring session TRANSCRIPT against the eight principle-derived
dimensions in pedagogy_eval_policy. Vendors the metaphor_eval_service machinery
(OpenAI-compatible local calls + retry/jitter, robust JSON extraction, parallel
panel via ThreadPoolExecutor) but DROPS the proposer — we measure existing
tutoring, we do not generate anything.

Topology (the B1 deviation): a panel of N heterogeneous local judges (GB10 Spark
via Ollama) EACH score ALL dimensions; consensus + variance are computed
PER DIMENSION across judge families. Output per session: per-(dimension,judge)
rows (pedagogy_eval_runs) + one multi-objective vector (pedagogy_eval_sessions).

OFFLINE + ADVISORY (D3/D2): no coupling to the student turn, no gating. LOCAL-FIRST
with a hard frontier kill switch (D5): with PEDAGOGY_EVAL_FRONTIER_ENABLED off, a
failed local judge is EXCLUDED from consensus — it never silently falls back to a
paid model.
"""

from __future__ import annotations

import logging
import os
import random
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from openai import OpenAI

import db
import pedagogy_eval_policy as policy
from helpers import extract_json  # shared: strips <think> blocks, prefers largest object

log = logging.getLogger(__name__)

_RETRY_ATTEMPTS = 3
_RETRY_BASE_DELAY = 1.0
_RETRY_MAX_DELAY = 8.0
_TRANSCRIPT_MAX_CHARS = 14000  # keep judges inside local context; head+tail on overflow

_clients: dict[str, OpenAI] = {}
_clients_lock = threading.Lock()  # judges run in parallel; guard the client cache

# Per-run frontier-call counter (reset at the start of each score_fixture_set). Hard cap
# so an enabled kill switch + dead Spark can't fan out to unbounded paid calls.
_frontier_calls = 0
_frontier_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Provider plumbing
# ---------------------------------------------------------------------------

def _ollama_base() -> str:
    """Base URL of the Spark's Ollama OpenAI-compat endpoint (B0).

    Reuses the same env the router uses so there is one source of truth; a
    dedicated PEDAGOGY_OLLAMA_URL can override for the eval pipeline only.
    """
    return (os.environ.get("PEDAGOGY_OLLAMA_URL")
            or os.environ.get("LOCAL_NEMO_URL")
            or os.environ.get("LOCAL_GEMMA_URL")
            or "").strip()


def _frontier_cfg() -> tuple[str, str, str]:
    """(base_url, api_key, model) for the kill-switched frontier fallback (xAI OpenAI-compat)."""
    return (
        os.environ.get("PEDAGOGY_FRONTIER_BASE_URL", "https://api.x.ai/v1").strip(),
        os.environ.get("XAI_API_KEY", "").strip(),
        os.environ.get("PEDAGOGY_FRONTIER_MODEL", "grok-4.3").strip(),
    )


def _client(base_url: str, api_key: str) -> OpenAI:
    key = f"{base_url}::{api_key}"
    client = _clients.get(key)
    if client is None:
        with _clients_lock:
            client = _clients.get(key)
            if client is None:
                client = OpenAI(base_url=base_url, api_key=api_key or "not-needed", timeout=120.0)
                _clients[key] = client
    return client


def _is_transient(exc: Exception) -> bool:
    s = str(exc).lower()
    return any(t in s for t in (
        "timeout", "timed out", "429", "rate limit", "rate_limit",
        "500", "502", "503", "504", "connection", "reset", "temporarily", "unavailable",
    ))


def _call_with_retry(*, base_url, api_key, model, system, user, temperature, max_tokens) -> str:
    client = _client(base_url, api_key)
    last = None
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": system},
                          {"role": "user", "content": user}],
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return resp.choices[0].message.content or ""
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt == _RETRY_ATTEMPTS - 1 or not _is_transient(exc):
                raise
            delay = min(_RETRY_BASE_DELAY * (2 ** attempt), _RETRY_MAX_DELAY)
            delay += random.uniform(0, delay * 0.25)  # jitter: parallel judges don't pile up
            log.info("pedagogy judge transient error from %s (%s); retry in %.1fs", base_url, exc, delay)
            time.sleep(delay)
    raise last or ConnectionError(f"unreachable retry path for {base_url}")


def _clean(s, limit: int = 500) -> str:
    """Stringify, drop NUL bytes (psycopg2 rejects them), and cap length."""
    return str(s if s is not None else "").replace("\x00", "")[:limit]


# ---------------------------------------------------------------------------
# One judge -> scores for ALL dimensions
# ---------------------------------------------------------------------------

def _normalize_dim_key(k: str) -> str:
    """Reduce a model's dimension key to the bare dimension name.

    Models vary: some echo the altitude annotation into the key
    (e.g. 'retrieval_before_new [multi_turn]' or 'retrieval_before_new (session)').
    Strip anything from the first bracket/paren and lowercase/trim so it matches.
    """
    s = str(k).strip().lower()
    for sep in (" [", "[", " (", "("):
        i = s.find(sep)
        if i != -1:
            s = s[:i]
    return s.strip()


def _parse_judge(raw: str, *, provider: str, model: str, fell_back: bool) -> dict:
    """Coerce a judge reply into {dim: {score, score_norm, flags, reason}} for known dims.

    Tolerant of (a) a missing 'dimensions' wrapper (keys at top level), (b) altitude
    annotations echoed into the key, and (c) a bare numeric value instead of an object.
    Returns usable=count of dimensions that yielded a real score, so the consensus
    layer can tell a genuinely-scored judge from one that returned an unusable shape.
    """
    obj = extract_json(raw) or {}
    dims_in = obj.get("dimensions")
    if not isinstance(dims_in, dict) or not dims_in:
        dims_in = obj  # tolerate models that drop the wrapper
    by_norm = {_normalize_dim_key(k): v for k, v in dims_in.items()} if isinstance(dims_in, dict) else {}

    out: dict[str, dict] = {}
    usable = 0
    for d in policy.DIMENSIONS:
        payload = by_norm.get(d.name)
        # bool is an int subclass — must reject before the (int, float) branch so
        # {"score": true} doesn't silently become a real score of 1.
        if isinstance(payload, bool):
            payload = {}
        elif isinstance(payload, (int, float)):
            payload = {"score": payload}
        elif not isinstance(payload, dict):
            payload = {}
        raw_score = payload.get("score")
        if isinstance(raw_score, bool):
            raw_score = None
        try:
            score = int(round(float(raw_score)))
            score = max(policy.SCORE_MIN, min(policy.SCORE_MAX, score))
        except (TypeError, ValueError):
            score = None
        if score is not None:
            usable += 1
        flags = payload.get("flags") or []
        if not isinstance(flags, list):
            flags = [str(flags)]
        out[d.name] = {
            "score": score,
            "score_norm": (policy.normalize(score) if score is not None else None),
            "flags": [_clean(f, 80) for f in flags if str(f).strip()],
            "reason": _clean(payload.get("reason")),
        }
    return {"dims": out, "provider": provider, "model": model, "fell_back": fell_back,
            "usable": usable, "overall_note": _clean(obj.get("overall_note"))}


def _run_one_judge(judge_name: str, system: str, user: str) -> dict:
    """Score all dimensions with one panel member. Raises on unrecoverable failure
    (caller excludes that judge). Honors the frontier kill switch."""
    provider = policy.resolve_judge_provider(judge_name)
    model = policy.resolve_judge_model(judge_name)
    g = policy.DEFAULT_GUARDRAILS

    if provider == "local_ollama":
        base = _ollama_base()
        if not base:
            raise RuntimeError("no Ollama base URL (set LOCAL_NEMO_URL to the Spark /v1 endpoint)")
        try:
            raw = _call_with_retry(base_url=base, api_key="ollama", model=model,
                                   system=system, user=user,
                                   temperature=g["judge_temperature"], max_tokens=g["judge_max_tokens"])
            return _parse_judge(raw, provider=provider, model=model, fell_back=False)
        except Exception as exc:  # noqa: BLE001
            if not policy.frontier_enabled():
                raise  # D5: no silent paid fallback
            log.warning("pedagogy judge %s local failed (%s); frontier fallback (kill switch on)", judge_name, exc)
            return _frontier_judge(judge_name, system, user, fell_back=True)

    # provider explicitly set to a frontier family
    if not policy.frontier_enabled():
        raise RuntimeError(f"frontier judge '{judge_name}' disabled (PEDAGOGY_EVAL_FRONTIER_ENABLED off)")
    return _frontier_judge(judge_name, system, user, fell_back=False)


def _frontier_judge(judge_name: str, system: str, user: str, *, fell_back: bool) -> dict:
    base, key, model = _frontier_cfg()
    if not key:
        raise RuntimeError("frontier enabled but XAI_API_KEY unset")
    g = policy.DEFAULT_GUARDRAILS
    # Enforce the per-run frontier cap BEFORE spending. Reserve the slot atomically so
    # parallel judges can't race past the cap.
    cap = g.get("max_frontier_calls_per_run", 0)
    global _frontier_calls
    with _frontier_lock:
        if _frontier_calls >= cap:
            raise RuntimeError(f"frontier per-run call cap reached ({cap})")
        _frontier_calls += 1
    raw = _call_with_retry(base_url=base, api_key=key, model=model, system=system, user=user,
                           temperature=g["judge_temperature"], max_tokens=g["judge_max_tokens"])
    return _parse_judge(raw, provider="frontier", model=model, fell_back=fell_back)


# ---------------------------------------------------------------------------
# Transcript rendering + consensus
# ---------------------------------------------------------------------------

def _render_transcript(turns: list[dict], max_chars: int = _TRANSCRIPT_MAX_CHARS) -> str:
    lines = []
    for t in turns:
        role = (t.get("role") or "?").upper()
        content = (t.get("content") or "").strip()
        if content:
            lines.append(f"[{role}] {content}")
    full = "\n".join(lines)
    if len(full) <= max_chars:
        return full
    # Keep BOTH ends: objectives live at the open, metacognitive close at the end.
    head = full[: max_chars // 2]
    tail = full[-max_chars // 2:]
    return f"{head}\n\n...[transcript truncated for length]...\n\n{tail}"


def _consensus(judge_results: list[dict]) -> dict:
    """Per-dimension consensus + variance across successful judges, then composite."""
    g = policy.DEFAULT_GUARDRAILS
    th = policy.DEFAULT_THRESHOLDS
    # A judge counts only if it produced at least one usable dimension score —
    # a valid-but-wrong-shape reply (usable=0) must not inflate the panel size.
    successful = [j for j in judge_results if j is not None and j.get("usable", 0) > 0]
    fell_back_n = sum(1 for j in successful if j.get("fell_back"))

    per_dim: dict[str, dict] = {}
    all_flags: set[str] = set()
    for d in policy.DIMENSIONS:
        norms = []
        for j in successful:
            cell = j["dims"].get(d.name) or {}
            if cell.get("score_norm") is not None:
                norms.append(cell["score_norm"])
            all_flags.update(cell.get("flags") or [])
        if norms:
            consensus = sum(norms) / len(norms)
            variance = max(norms) - min(norms)
        else:
            consensus, variance = None, None
        per_dim[d.name] = {"consensus_norm": consensus, "variance": variance, "n": len(norms)}

    # Composite: weighted mean over dimensions that have data, renormalized.
    wsum = 0.0
    acc = 0.0
    for d in policy.DIMENSIONS:
        c = per_dim[d.name]["consensus_norm"]
        if c is not None:
            acc += c * d.weight
            wsum += d.weight
    composite = (acc / wsum) if wsum > 0 else None
    variances = [per_dim[d.name]["variance"] for d in policy.DIMENSIONS
                 if per_dim[d.name]["variance"] is not None]
    consensus_variance = (sum(variances) / len(variances)) if variances else None

    reasons: list[str] = [
        f"composite:{composite:.3f}" if composite is not None else "composite:none",
        f"successful_judges:{len(successful)}/{len(policy.JUDGE_SLOTS)}",
    ]
    critical = all_flags & policy.CRITICAL_FLAGS

    # Advisory decision tiers (never gates the hot path)
    if len(successful) < g["min_successful_judges"] or composite is None:
        decision = "REVIEW"; reasons.append("insufficient_judges")
    elif critical:
        decision = "REVIEW"; reasons.append("critical_flag:" + ",".join(sorted(critical)))
    elif fell_back_n > len(successful) // 2:
        decision = "REVIEW"; reasons.append(f"degenerate_panel:{fell_back_n}_fell_back")
    elif consensus_variance is not None and consensus_variance > th["variance_review"]:
        decision = "REVIEW"; reasons.append(f"high_variance:{consensus_variance:.3f}")
    elif composite >= th["strong"]:
        decision = "STRONG"
    elif composite <= th["weak"]:
        decision = "WEAK"
    else:
        decision = "REVIEW"

    return {"per_dim": per_dim, "composite": composite,
            "consensus_variance": consensus_variance, "decision": decision,
            "reasons": reasons, "fell_back_n": fell_back_n,
            "successful_judges": len(successful)}


# ---------------------------------------------------------------------------
# Public: score one session, score a fixture set
# ---------------------------------------------------------------------------

def score_session(fixture: dict, *, run_id: str, fixture_set: str | None = None) -> dict:
    """Score one session; persist rows + the multi-objective vector. Returns a summary."""
    session_id = fixture["session_id"]
    turns = db.get_session_transcript(session_id)
    transcript_text = _render_transcript([dict(t) for t in turns])

    system = policy.JUDGE_SYSTEM_PROMPT
    user = policy.build_judge_session_prompt(
        subject=fixture.get("subject") or "?",
        age_range=fixture.get("age_range") or "?",
        capsule_name=fixture.get("capsule_name") or "?",
        transcript_text=transcript_text,
    )

    # Run the panel in parallel; an excluded judge becomes None.
    judge_payloads: dict[str, dict | None] = {}
    workers = min(policy.DEFAULT_GUARDRAILS["max_concurrent_judges"], len(policy.JUDGE_SLOTS))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_run_one_judge, j.name, system, user): j.name for j in policy.JUDGE_SLOTS}
        for fut in as_completed(futs):
            jname = futs[fut]
            try:
                judge_payloads[jname] = fut.result()
            except Exception as exc:  # noqa: BLE001
                log.warning("pedagogy judge %s excluded: %s", jname, exc)
                judge_payloads[jname] = None

    results = [p for p in judge_payloads.values() if p is not None]
    con = _consensus(results)

    # Telemetry is advisory metadata — never let a malformed execution_log void a
    # completed (and expensive) judge panel. Degrade to None on any failure.
    try:
        tel = db.get_session_eval_telemetry(session_id) or {}
    except Exception as exc:  # noqa: BLE001
        log.warning("pedagogy: telemetry failed for session %s (%s); proceeding without it", session_id, exc)
        tel = {}
    model_version = tel.get("model_version")
    p50_latency = int(tel["p50_latency_ms"]) if tel.get("p50_latency_ms") is not None else None
    tokens_per_turn = float(tel["tokens_per_turn"]) if tel.get("tokens_per_turn") is not None else None
    total_turns = int(tel["total_turns"]) if tel.get("total_turns") is not None else None

    # Build unaggregated rows: one per (dimension, successful judge).
    rows: list[dict] = []
    for jname, payload in judge_payloads.items():
        if payload is None:
            continue
        slot = policy.JUDGE_BY_NAME[jname]
        for d in policy.DIMENSIONS:
            cell = payload["dims"].get(d.name) or {}
            rows.append({
                "run_id": run_id,
                "session_id": session_id,
                "capsule_id": fixture.get("capsule_id"),
                "fixture_set": fixture_set,
                "rubric_version": policy.RUBRIC_VERSION,
                "dimension": d.name,
                "judge_name": jname,
                "judge_family": jname,            # each slot is a distinct family
                "judge_provider": payload.get("provider"),
                "judge_model": payload.get("model") or slot.default_model,
                "score": cell.get("score"),
                "score_norm": cell.get("score_norm"),
                "flags": cell.get("flags") or [],
                "fell_back": bool(payload.get("fell_back")),
                "reasoning": cell.get("reason"),
                "template_hash": None,            # Track A unmerged -> NULL on this branch
                "model_version": model_version,
            })
    vector = {
        "run_id": run_id,
        "session_id": session_id,
        "capsule_id": fixture.get("capsule_id"),
        "fixture_set": fixture_set,
        "rubric_version": policy.RUBRIC_VERSION,
        "pedagogy_quality": con["composite"],
        "consensus_variance": con["consensus_variance"],
        "p50_latency_ms": p50_latency,
        "tokens_per_turn": tokens_per_turn,
        "total_turns": total_turns,
        "session_completion": None,   # B3/ADO#29: populate when retention signal lands
        "forfeit_rate": None,
        "decision": con["decision"],
        "reasons": con["reasons"],
        "template_hash": None,
        "model_version": model_version,
    }

    # Persist rows + vector atomically (one transaction — no orphans). Skip persistence
    # for a dead panel (no usable judges, composite=None) so NULL-quality vectors and
    # NULL-score rows don't pollute the read-time aggregates.
    persisted = con["composite"] is not None
    if persisted:
        db.insert_pedagogy_eval_result(rows, vector)
    else:
        log.warning("pedagogy: session %s produced no usable judges; not persisted (%s)",
                    session_id, ",".join(con["reasons"]))

    return {
        "session_id": session_id,
        "decision": con["decision"],
        "pedagogy_quality": con["composite"],
        "consensus_variance": con["consensus_variance"],
        "successful_judges": con["successful_judges"],
        "fell_back": con["fell_back_n"],
        "rows_written": len(rows) if persisted else 0,
        "persisted": persisted,
        "reasons": con["reasons"],
    }


def score_fixture_set(*, subject: str | None = None, phase: int | None = None,
                      limit: int = 100, fixture_set: str | None = None,
                      min_turns: int | None = None, progress=None) -> dict:
    """Pull fixtures and score each. LOCAL-only unless PEDAGOGY_EVAL_FRONTIER_ENABLED.

    Returns {run_id, fixture_set, scored, errors, items}. Respects the per-run
    fixture cap and the min-session-turns floor (D5/fixture quality).
    `progress(i, n, summary)` is called after each session if given.
    """
    cap = policy.DEFAULT_GUARDRAILS["max_fixtures_per_run"]
    requested = int(limit)
    limit = min(requested, cap)
    if limit < requested:
        log.info("pedagogy: requested %d fixtures, capped to %d by max_fixtures_per_run (D5)", requested, limit)
    if min_turns is None:
        min_turns = policy.DEFAULT_GUARDRAILS["min_session_turns"]

    # Preflight: fail fast rather than churn hundreds of NULL-score sessions if the local
    # panel isn't reachable and there's no frontier fallback enabled.
    if not _ollama_base() and not policy.frontier_enabled():
        raise RuntimeError(
            "no local judge endpoint configured (set PEDAGOGY_OLLAMA_URL or LOCAL_NEMO_URL "
            "to the Spark /v1 endpoint) and frontier is disabled — nothing to score with")

    global _frontier_calls
    with _frontier_lock:
        _frontier_calls = 0  # reset the per-run frontier cap

    run_id = "ped-" + uuid.uuid4().hex[:12]
    fixture_set = fixture_set or f"{(subject or 'all').lower()}-{run_id}"
    fixtures = db.list_pedagogy_fixtures(subject=subject, phase=phase, limit=limit, min_turns=min_turns)

    items, errors = [], []
    if policy.frontier_enabled():
        log.warning("pedagogy: PEDAGOGY_EVAL_FRONTIER_ENABLED is ON — frontier judging permitted")
    for i, fx in enumerate(fixtures):
        fxd = dict(fx)
        current = None
        try:
            current = score_session(fxd, run_id=run_id, fixture_set=fixture_set)
            items.append(current)
        except Exception as exc:  # noqa: BLE001
            log.exception("pedagogy: failed scoring session %s", fxd.get("session_id"))
            errors.append({"session_id": str(fxd.get("session_id")), "error": str(exc)})
        if progress:
            try:
                progress(i + 1, len(fixtures), current)  # this iteration's summary (None on error)
            except Exception:  # noqa: BLE001
                pass

    return {
        "run_id": run_id,
        "fixture_set": fixture_set,
        "rubric_version": policy.RUBRIC_VERSION,
        "frontier_enabled": policy.frontier_enabled(),
        "min_turns": min_turns,
        "fixtures_matched": len(fixtures),
        "scored": len(items),
        "errors": errors,
        "items": items,
    }
