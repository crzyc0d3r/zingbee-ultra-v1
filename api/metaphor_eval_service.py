"""Capsule metaphor authoring service.

Orchestrates: propose 3 candidate sustained metaphors per capsule -> judge each
proposal with a heterogeneous local-model panel -> compute weighted consensus ->
store all proposals on the capsule's meta_data JSONB, lifting the accepted one
to meta_data.metaphor.

Architecture mirrors image_eval_service.py: a SERVICE singleton with a
run_command dispatcher, per-judge provider dispatch with frontier fallback,
and a deterministic decision rule (auto-accept / needs-review / auto-reject).

Per the now-for-the-actual-magical-sparkle.md plan (Phase A0b):
  - Heterogeneous local models per judge slot (prior diversity = signal).
  - Auto-accept when weighted mean >= 0.85 AND judge variance <= 0.40.
  - Otherwise human-review queue.

This module reads/writes only curriculum_capsules.meta_data — it does NOT
touch the session engine, assessor, or prompt registry. Engine wiring is
PR-A1, gated behind METAPHOR_PIN_ENABLED.
"""

from __future__ import annotations

import copy
import json
import logging
import os
import random
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable

import httpx
from openai import OpenAI

import db
from helpers import extract_json
from metaphor_eval_policy import (
    DEFAULT_GUARDRAILS,
    DEFAULT_THRESHOLDS,
    JUDGE_NAMES,
    JUDGE_SLOTS,
    PROPOSER_SYSTEM_PROMPT,
    build_judge_user_prompt,
    build_proposer_user_prompt,
    compute_consensus_and_decision,
    make_eval_identity,
    resolve_judge_model,
    resolve_judge_provider,
)

log = logging.getLogger(__name__)

# Cap on proposal-run history kept per capsule. JSONB updates rewrite the whole
# column; without a bound, heavily-regenerated capsules grow ~70 KB per run.
# The winner is lifted to top-level meta_data.metaphor so recent history is
# enough for audit; we drop the oldest runs at write time.
_MAX_PROPOSAL_RUNS_HISTORY = 10

# Throttle progress callbacks so a 200-capsule batch doesn't write 16k
# eval_runs JSONB updates. Report at most every Nth capsule.
_PROGRESS_TICK_EVERY_N_CAPSULES = 5

# Per-judge retry policy on transient errors (429 / 5xx / connection / read timeout).
_RETRY_ATTEMPTS = 3
_RETRY_BASE_DELAY = 1.0
_RETRY_MAX_DELAY = 8.0


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_proposal_run_id() -> str:
    return "mp-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]


# ---------------------------------------------------------------------------
# Provider dispatch (text-only — no images)
# ---------------------------------------------------------------------------

# Provider id strings used in metaphor_eval_policy.JudgeSlot.default_provider.
# We do NOT route through model_router.call_llm because the pipeline needs
# DIFFERENT models per judge in the same evaluation pass — call_llm is a
# single-task-type API.
#
# Two kinds of providers:
#   - "local_*" — OpenAI-compatible endpoints (vLLM, Ollama). Resolved via
#     (url_env, model_env, default_model). Active only when LOCAL_MODEL_ENABLED=true.
#   - "openai" / "anthropic" / "google" / "xai" — frontier vendors. Resolved
#     via (api_key_env, model_env, default_model). Used directly (no
#     LOCAL_MODEL_ENABLED gate); each vendor's call function handles its own
#     HTTP wire format. These give the metaphor-eval pipeline genuine
#     heterogeneous priors when local model hardware isn't available.
_PROVIDER_REGISTRY: dict[str, dict[str, str]] = {
    # Local OpenAI-compatible endpoints
    "local_text_eval": {
        "kind": "local",
        "url_env": "VLLM_TEXT_EVAL_URL",
        "model_env": "VLLM_TEXT_EVAL_MODEL",
        "default_model": "nvidia/Qwen3-14B-FP8",
    },
    "local_text_gen": {
        "kind": "local",
        "url_env": "VLLM_TEXT_GEN_URL",
        "model_env": "VLLM_TEXT_GEN_MODEL",
        "default_model": "nvidia/Qwen3-32B-FP4",
    },
    "local_nemo": {
        "kind": "local",
        "url_env": "LOCAL_NEMO_URL",
        "model_env": "LOCAL_NEMO_MODEL",
        "default_model": "mistral-nemo",
    },
    "local_gemma": {
        "kind": "local",
        "url_env": "LOCAL_GEMMA_URL",
        "model_env": "LOCAL_GEMMA_MODEL",
        "default_model": "gemma3:4b",
    },
    "local_gemma_12b": {
        "kind": "local",
        "url_env": "LOCAL_GEMMA_URL",
        "model_env": "LOCAL_GEMMA_12B_MODEL",
        "default_model": "gemma3:12b",
    },
    # Frontier providers — each is a distinct training-distribution prior.
    "openai": {
        "kind": "frontier",
        "api_key_env": "OPENAI_API_KEY",
        "model_env": "METAPHOR_OPENAI_MODEL",
        "default_model": "gpt-4o",
    },
    "openai_mini": {
        "kind": "frontier",
        "api_key_env": "OPENAI_API_KEY",
        "model_env": "METAPHOR_OPENAI_MINI_MODEL",
        "default_model": "gpt-4o-mini",
    },
    "anthropic": {
        "kind": "frontier",
        "api_key_env": "ANTHROPIC_API_KEY",
        "model_env": "METAPHOR_ANTHROPIC_MODEL",
        "default_model": "claude-haiku-4-5-20251001",
    },
    "google": {
        "kind": "frontier",
        "api_key_env": "GOOGLE_AI_API_KEY",
        "model_env": "METAPHOR_GOOGLE_MODEL",
        "default_model": "gemini-2.5-flash",
    },
    "xai": {
        "kind": "frontier",
        "api_key_env": "XAI_API_KEY",
        "model_env": "METAPHOR_XAI_MODEL",
        "default_model": "grok-4",
    },
    # Cerebras hosts multiple open-weight model lineages. Each gets its own
    # provider id so the consensus layer treats them as distinct priors
    # (which they are — Alibaba/Qwen, OpenAI/GPT-OSS, Meta/Llama are different
    # training distributions even when served by the same inference platform).
    "cerebras": {
        "kind": "frontier",
        "api_key_env": "CEREBRAS_API_KEY",
        "model_env": "METAPHOR_CEREBRAS_MODEL",
        "default_model": "gpt-oss-120b",
    },
    "cerebras_qwen": {
        "kind": "frontier",
        "api_key_env": "CEREBRAS_API_KEY",
        "model_env": "METAPHOR_CEREBRAS_QWEN_MODEL",
        "default_model": "qwen-3-235b-a22b-instruct-2507",
    },
    "cerebras_llama": {
        "kind": "frontier",
        "api_key_env": "CEREBRAS_API_KEY",
        "model_env": "METAPHOR_CEREBRAS_LLAMA_MODEL",
        "default_model": "llama3.1-8b",
    },
}


# Cluster of provider ids that all hit the same vendor backend — used to
# decide whether `fell_back` should fire. A judge configured for "openai" that
# falls through to "openai_mini" is still on OpenAI's training distribution,
# so the panel's heterogeneous-prior intent isn't actually degraded.
_PROVIDER_FAMILY: dict[str, str] = {
    "openai": "openai", "openai_mini": "openai",
    "anthropic": "anthropic",
    "google": "google",
    "xai": "xai",
    "local_text_eval": "qwen", "local_text_gen": "qwen",
    "local_nemo": "mistral",
    "local_gemma": "google", "local_gemma_12b": "google",  # Gemma is Google's family
    # Cerebras-hosted models inherit the LINEAGE of the underlying weights,
    # not the inference platform. Three distinct training-distribution priors.
    "cerebras": "gpt_oss",          # OpenAI open-weight
    "cerebras_qwen": "qwen",        # Alibaba
    "cerebras_llama": "llama",      # Meta
}

# Cache OpenAI clients per base_url so repeated judge calls don't reopen TCP.
# Lock-protected because the service parallelizes judges (one thread per slot)
# and the dict is shared module-global.
_local_clients: dict[str, OpenAI] = {}
_local_clients_lock = threading.Lock()


def _local_client(base_url: str) -> OpenAI:
    api_key = os.environ.get("VLLM_API_KEY", "not-needed")
    cache_key = f"{base_url}:{api_key}"
    client = _local_clients.get(cache_key)
    if client is not None:
        return client
    with _local_clients_lock:
        client = _local_clients.get(cache_key)
        if client is None:
            client = OpenAI(base_url=base_url, api_key=api_key, timeout=120.0)
            _local_clients[cache_key] = client
    return client


def _is_transient_error(exc: BaseException) -> bool:
    """Best-effort classifier for retryable provider errors. Errs on the side
    of retrying — duplicate calls are wasteful but the alternative is a
    permanently-failed judge that will tank the consensus mean."""
    msg = str(exc).lower()
    if any(token in msg for token in ("timeout", "timed out", "connection", "reset by peer",
                                       "429", "rate limit", "rate_limit", "503", "502", "504",
                                       "service unavailable", "gateway")):
        return True
    return False


def _local_model_enabled() -> bool:
    return os.environ.get("LOCAL_MODEL_ENABLED", "false").lower() in ("true", "1", "yes")


def _resolve_provider_endpoint(provider_id: str, model_override: str | None) -> tuple[str, str] | None:
    """Resolve (base_url, model_name) for a LOCAL provider id, or None if unconfigured."""
    cfg = _PROVIDER_REGISTRY.get(provider_id)
    if not cfg or cfg.get("kind") != "local":
        return None
    base_url = (os.environ.get(cfg["url_env"]) or "").strip()
    if not base_url:
        return None
    model = model_override or (os.environ.get(cfg["model_env"]) or cfg["default_model"]).strip()
    return base_url, model


def _resolve_frontier_provider(provider_id: str, model_override: str | None) -> tuple[str, str, str] | None:
    """Resolve (api_key, model_name, vendor_id) for a FRONTIER provider id, or None if no API key."""
    cfg = _PROVIDER_REGISTRY.get(provider_id)
    if not cfg or cfg.get("kind") != "frontier":
        return None
    api_key = (os.environ.get(cfg["api_key_env"]) or "").strip()
    if not api_key:
        return None
    model = model_override or (os.environ.get(cfg["model_env"]) or cfg["default_model"]).strip()
    return api_key, model, provider_id


def _call_local_with_retry(
    *,
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
) -> str:
    """Call a local OpenAI-compatible endpoint with exponential-backoff retries
    on transient failures (timeouts, 429, 5xx). Permanent errors still raise."""
    client = _local_client(base_url)
    last_exc: BaseException | None = None
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return resp.choices[0].message.content or ""
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt == _RETRY_ATTEMPTS - 1 or not _is_transient_error(exc):
                raise
            delay = min(_RETRY_BASE_DELAY * (2 ** attempt), _RETRY_MAX_DELAY)
            delay += random.uniform(0, delay * 0.25)  # jitter so retries from N parallel judges don't pile up
            log.info("metaphor judge: transient error from %s (%s); retrying in %.1fs (attempt %d/%d)",
                     base_url, exc, delay, attempt + 2, _RETRY_ATTEMPTS)
            time.sleep(delay)
    if last_exc:
        raise last_exc
    raise ConnectionError(f"unreachable retry path for {base_url}")


# -------------------- frontier vendors (text-only) --------------------------
#
# Each vendor has a thin HTTP wrapper that takes (api_key, model, system_prompt,
# user_prompt, temperature, max_tokens) and returns the response content string.
# Wire formats are stable enough that direct httpx is fine — no need to pull in
# every vendor SDK. The dispatchers below request JSON-mode where each vendor
# supports it so extract_json() has a high success rate.

def _call_openai_raw(*, api_key: str, model: str, system_prompt: str, user_prompt: str,
                     temperature: float, max_tokens: int) -> str:
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def _call_anthropic_raw(*, api_key: str, model: str, system_prompt: str, user_prompt: str,
                        temperature: float, max_tokens: int) -> str:
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        # Anthropic returns content as a list of blocks; the first text block is the JSON
        blocks = resp.json().get("content") or []
        for block in blocks:
            if block.get("type") == "text":
                return block.get("text", "")
        return ""


def _call_google_raw(*, api_key: str, model: str, system_prompt: str, user_prompt: str,
                     temperature: float, max_tokens: int) -> str:
    # systemInstruction silently breaks JSON-mode on some gemini-*-flash
    # variants (returns empty body with status 200). Prepend the system text
    # to the user message instead — both reach the model the same way.
    combined = f"{system_prompt}\n\n{user_prompt}" if system_prompt else user_prompt
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            json={
                "contents": [{"role": "user", "parts": [{"text": combined}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": temperature,
                    "maxOutputTokens": max_tokens,
                },
            },
        )
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates") or []
        if not candidates:
            return ""
        parts = (candidates[0].get("content") or {}).get("parts") or []
        for part in parts:
            if "text" in part:
                return part["text"]
        return ""


def _call_xai_raw(*, api_key: str, model: str, system_prompt: str, user_prompt: str,
                  temperature: float, max_tokens: int) -> str:
    # Direct httpx call to xAI's OpenAI-compatible /v1/chat/completions
    # endpoint. We bypass the xai_sdk Python package because (a) it may not
    # be installed in every environment and (b) the SDK does extra work
    # (cost-tracking, response IDs) that the metaphor pipeline doesn't need.
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def _call_cerebras_raw(*, api_key: str, model: str, system_prompt: str, user_prompt: str,
                       temperature: float, max_tokens: int) -> str:
    # OpenAI-compatible API. Cerebras hosts open-weight models (Qwen, GPT-OSS,
    # Llama) via this endpoint — same wire format as OpenAI's, response_format
    # supported on most models.
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            "https://api.cerebras.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


# Maps frontier provider id → raw HTTP call function. All vendors go through
# httpx; we deliberately don't import vendor SDKs for the metaphor pipeline
# because (a) some SDKs are optional installs in this project's environment,
# and (b) the wire formats are stable enough that direct HTTP works fine and
# keeps the metaphor pipeline self-contained.
_FRONTIER_DISPATCH: dict[str, Callable[..., str]] = {
    "openai": _call_openai_raw,
    "openai_mini": _call_openai_raw,
    "anthropic": _call_anthropic_raw,
    "google": _call_google_raw,
    "xai": _call_xai_raw,
    "cerebras": _call_cerebras_raw,
    "cerebras_qwen": _call_cerebras_raw,
    "cerebras_llama": _call_cerebras_raw,
}


def _call_frontier_with_retry(
    *,
    provider_id: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
) -> str:
    """Generic retry wrapper around the per-vendor frontier dispatchers."""
    dispatcher = _FRONTIER_DISPATCH.get(provider_id)
    if dispatcher is None:
        raise ValueError(f"No dispatcher for frontier provider {provider_id}")
    last_exc: BaseException | None = None
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            return dispatcher(
                api_key=api_key, model=model,
                system_prompt=system_prompt, user_prompt=user_prompt,
                temperature=temperature, max_tokens=max_tokens,
            )
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt == _RETRY_ATTEMPTS - 1 or not _is_transient_error(exc):
                raise
            delay = min(_RETRY_BASE_DELAY * (2 ** attempt), _RETRY_MAX_DELAY)
            delay += random.uniform(0, delay * 0.25)
            log.info("metaphor judge: %s transient error (%s); retrying in %.1fs (attempt %d/%d)",
                     provider_id, exc, delay, attempt + 2, _RETRY_ATTEMPTS)
            time.sleep(delay)
    if last_exc:
        raise last_exc
    raise ConnectionError(f"unreachable retry path for {provider_id}")


def _call_judge_provider(
    *,
    provider_id: str,
    model_override: str | None,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
) -> tuple[str, str, str, bool]:
    """Call the configured provider for a judge.

    Returns (raw_text, provider_used, model_used, fell_back).

    Resolution order:
      1. If the configured provider is LOCAL and LOCAL_MODEL_ENABLED + URL: use it.
      2. If the configured provider is a FRONTIER vendor and its API key is set: use it.
      3. Otherwise fall through to the FRONTIER_FALLBACK_ORDER (xAI > Anthropic >
         OpenAI > Google), whichever has an API key. fell_back=True iff this
         lands on a vendor in a different family from the configured preference.

    The boolean fallback flag lets the consensus layer surface "this run's
    heterogeneous-prior story is degraded" without operators reading logs.

    Raises ConnectionError when no provider is available.
    """
    preferred_family = _PROVIDER_FAMILY.get(provider_id, "unknown")

    def _do_frontier(pid: str) -> tuple[str, str, str, bool] | None:
        resolved = _resolve_frontier_provider(pid, model_override if pid == provider_id else None)
        if not resolved:
            return None
        api_key, model, vendor = resolved
        # All frontier vendors (including xAI) go through the same httpx path
        # via _FRONTIER_DISPATCH. We deliberately don't use the xai_sdk
        # Python package here because (a) it may not be installed in every
        # environment and (b) cost-tracking/response-ID features it adds
        # aren't needed for the eval pipeline.
        content = _call_frontier_with_retry(
            provider_id=pid, api_key=api_key, model=model,
            system_prompt=system_prompt, user_prompt=user_prompt,
            temperature=temperature, max_tokens=max_tokens,
        )
        fell_back = _PROVIDER_FAMILY.get(pid, "unknown") != preferred_family
        return content, vendor, model, fell_back

    # 1) Local first (if configured)
    cfg = _PROVIDER_REGISTRY.get(provider_id) or {}
    if cfg.get("kind") == "local" and _local_model_enabled():
        endpoint = _resolve_provider_endpoint(provider_id, model_override)
        if endpoint:
            base_url, model = endpoint
            try:
                content = _call_local_with_retry(
                    base_url=base_url, model=model,
                    system_prompt=system_prompt, user_prompt=user_prompt,
                    temperature=temperature, max_tokens=max_tokens,
                )
                return content, provider_id, model, False
            except Exception as exc:
                log.warning("metaphor judge: local provider %s failed after retries (%s) — falling back to frontier",
                            provider_id, exc)

    # 2) Preferred frontier vendor (if the slot was configured for one)
    if cfg.get("kind") == "frontier":
        result = _do_frontier(provider_id)
        if result is not None:
            return result
        log.warning("metaphor judge: preferred frontier vendor %s has no API key — falling back",
                    provider_id)

    # 3) Cascading frontier fallback. Order: Cerebras first (cheap/fast and
    # gives us 3 distinct families on its own), then xAI, then Google, then
    # OpenAI/Anthropic at the back. fell_back fires because the family
    # changed from the slot's preference.
    for fallback_id in (
        "cerebras", "cerebras_qwen", "cerebras_llama",
        "xai", "google",
        "anthropic", "openai", "openai_mini",
    ):
        if fallback_id == provider_id:
            continue
        result = _do_frontier(fallback_id)
        if result is not None:
            return result

    raise ConnectionError(
        f"No provider available for judge slot (preferred={provider_id}). "
        f"Set at least one of XAI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_AI_API_KEY."
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class MetaphorEvalService:
    def __init__(self) -> None:
        self.thresholds = copy.deepcopy(DEFAULT_THRESHOLDS)
        self.guardrails = copy.deepcopy(DEFAULT_GUARDRAILS)

    # ---- public command entrypoint -------------------------------------

    def run_command(
        self,
        *,
        job_id: str,
        command: str,
        scope: dict[str, Any],
        options: dict[str, Any],
        actor: str,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> dict[str, Any]:
        """Dispatcher matching image_eval_service.run_command shape.

        scope: {"capsule_id": str} for single-capsule, or {"subject": str, "phase": int|None}
               for batched runs. CLI uses the latter; UI uses the former.
        command: "evaluate" (propose+judge+store) | "regenerate" (re-propose for one capsule).
        """
        start = time.time()
        max_runtime_sec = int(options.get("max_runtime_sec") or self.guardrails["max_runtime_seconds_per_command"])
        deadline = start + max_runtime_sec

        summary: dict[str, Any] = {
            "runType": "metaphor_eval",
            "jobId": job_id,
            "command": command,
            "scope": scope,
            "actor": actor,
            "startedAt": _utc_now_iso(),
            "status": "running",
            "items": [],
            "errors": [],
            "currentStage": "queued",
            "itemsProcessed": 0,
            "totalCandidates": 0,
        }

        def _report(*, stage: str, processed: int | None = None, total: int | None = None, note: str | None = None) -> None:
            summary["currentStage"] = stage
            if processed is not None:
                summary["itemsProcessed"] = max(0, int(processed))
            if total is not None:
                summary["totalCandidates"] = max(0, int(total))
            if note:
                summary["lastNote"] = note
            if progress_callback:
                progress_callback(copy.deepcopy(summary))

        def _check_cancelled() -> None:
            if is_cancelled and is_cancelled():
                raise RuntimeError("cancel_requested:user")
            if time.time() >= deadline:
                raise RuntimeError("cancel_requested:timeout")

        try:
            _report(stage=f"{command}:starting")
            if command == "evaluate":
                summary["items"] = self.command_evaluate(
                    scope=scope,
                    options=options,
                    actor=actor,
                    report_progress=_report,
                    check_cancelled=_check_cancelled,
                )
            elif command == "regenerate":
                summary["items"] = [self.command_regenerate(
                    capsule_id=str(scope["capsule_id"]),
                    options=options,
                    actor=actor,
                )]
            else:
                raise ValueError(f"Unsupported command: {command}")

            summary["status"] = "completed"
            summary["completedAt"] = _utc_now_iso()
            summary["durationSec"] = round(time.time() - start, 2)
            summary["count"] = len(summary["items"])
            summary["currentStage"] = f"{command}:completed"
            _report(stage=summary["currentStage"], processed=summary["itemsProcessed"], total=summary["totalCandidates"])
            return summary
        except RuntimeError as exc:
            reason = str(exc)
            if not reason.startswith("cancel_requested"):
                raise
            summary["status"] = "cancelled"
            summary["completedAt"] = _utc_now_iso()
            summary["durationSec"] = round(time.time() - start, 2)
            cancel_reason = reason.split(":", 1)[1] if ":" in reason else "user"
            summary["cancelReason"] = cancel_reason
            summary["errors"].append(f"cancelled:{cancel_reason}")
            _report(stage=f"{command}:cancelled")
            return summary
        except Exception as exc:
            log.exception("metaphor-eval command %s failed: %s", command, exc)
            summary["status"] = "failed"
            summary["completedAt"] = _utc_now_iso()
            summary["durationSec"] = round(time.time() - start, 2)
            summary["errors"].append(str(exc))
            _report(stage=f"{command}:failed", note=str(exc))
            return summary

    # ---- commands ------------------------------------------------------

    def command_evaluate(
        self,
        *,
        scope: dict[str, Any],
        options: dict[str, Any],
        actor: str,
        report_progress: Callable[..., None] | None = None,
        check_cancelled: Callable[[], None] | None = None,
    ) -> list[dict[str, Any]]:
        """Run propose+judge+store across one or many capsules in scope.

        scope shape:
          {"capsule_id": "<uuid>"}                 — single capsule
          {"subject": "Biology", "phase": int|None} — batched by subject (and optionally phase)
        """
        capsules = self._resolve_scope_capsules(scope)
        # Cap user-supplied max_capsules at the guardrail so an operator can't
        # pass max_capsules=99999 and burn the entire xAI quota in one click.
        try:
            requested_caps = int(options.get("max_capsules") or self.guardrails["max_capsules_per_command"])
        except (TypeError, ValueError):
            requested_caps = int(self.guardrails["max_capsules_per_command"])
        max_caps = max(1, min(requested_caps, int(self.guardrails["max_capsules_per_command"])))
        capsules = capsules[:max_caps]
        skip_existing = bool(options.get("skip_existing", True))
        n_proposals = int(options.get("n_proposals") or self.guardrails["max_proposals_per_capsule"])
        n_proposals = max(1, min(n_proposals, self.guardrails["max_proposals_per_capsule"]))

        if report_progress:
            report_progress(stage="evaluate:running", processed=0, total=len(capsules))

        results: list[dict[str, Any]] = []
        for idx, capsule in enumerate(capsules, start=1):
            if check_cancelled:
                check_cancelled()
            cid = str(capsule["capsule_id"])

            existing_meta = db.get_capsule_meta_data(cid) or {}
            if skip_existing and existing_meta.get("metaphor"):
                review_status = (existing_meta.get("metaphor_review") or {}).get("status", "")
                if review_status in {"auto_accepted", "human_approved"}:
                    if report_progress:
                        report_progress(
                            stage="evaluate:running",
                            processed=idx,
                            total=len(capsules),
                            note=f"skip {capsule['capsule_name']} (already accepted)",
                        )
                    continue

            try:
                outcome = self._evaluate_one_capsule(
                    capsule=capsule,
                    actor=actor,
                    n_proposals=n_proposals,
                    is_cancelled=check_cancelled,
                )
                results.append(outcome)
            except Exception as exc:
                log.exception("metaphor evaluate capsule %s failed: %s", cid, exc)
                results.append({
                    "capsule_id": cid,
                    "capsule_name": capsule.get("capsule_name", ""),
                    "status": "failed",
                    "error": str(exc),
                })

            # Throttle progress writes — every Nth capsule plus the final one.
            # Without this a 200-capsule batch fires 16k+ eval_runs UPDATE
            # writes (one per stage transition), each rewriting a growing
            # `result` JSONB blob. The UI's 4s poll picks up the throttled
            # ticks fine.
            if report_progress and (idx == len(capsules) or idx % _PROGRESS_TICK_EVERY_N_CAPSULES == 0):
                report_progress(
                    stage="evaluate:running",
                    processed=idx,
                    total=len(capsules),
                    note=f"{idx}/{len(capsules)} processed",
                )
        return results

    def command_regenerate(
        self,
        *,
        capsule_id: str,
        options: dict[str, Any],
        actor: str,
    ) -> dict[str, Any]:
        """Force a fresh proposer + judge cycle on one capsule, ignoring existing acceptance."""
        capsule = db.get_capsule_with_scope(capsule_id)
        if not capsule:
            raise ValueError(f"Capsule {capsule_id} not found")
        n_proposals = int(options.get("n_proposals") or self.guardrails["max_proposals_per_capsule"])
        n_proposals = max(1, min(n_proposals, self.guardrails["max_proposals_per_capsule"]))
        return self._evaluate_one_capsule(
            capsule=capsule,
            actor=actor,
            n_proposals=n_proposals,
        )

    # ---- core per-capsule pipeline -------------------------------------

    def _evaluate_one_capsule(
        self,
        *,
        capsule: dict[str, Any],
        actor: str,
        n_proposals: int,
        is_cancelled: Callable[[], None] | None = None,
    ) -> dict[str, Any]:
        """Run the full propose -> judge -> consensus -> store cycle for a single capsule.

        is_cancelled (optional): callable that raises RuntimeError when the
        operator has requested cancel. Threaded through to _judge_proposal so
        cancel takes effect within seconds rather than waiting for the full
        per-capsule LLM cycle. Per pre-ship review pass-2 N-C1.
        """
        cid = str(capsule["capsule_id"])
        facts = db.list_facts_for_capsule_scope(
            phase=int(capsule["phase"]),
            theme_name=capsule["theme_name"],
            capsule_name=capsule["capsule_name"],
            subject_name=capsule.get("subject_name"),
        )
        if not facts:
            raise ValueError(f"Capsule {capsule['capsule_name']} has no facts")

        run_id = _new_proposal_run_id()
        proposer_payload = self._propose(
            capsule=capsule,
            facts=facts,
            n_proposals=n_proposals,
        )
        candidates = proposer_payload["proposals"][:n_proposals]
        if not candidates:
            raise ValueError("Proposer returned zero candidates")

        scored: list[dict[str, Any]] = []
        for candidate in candidates:
            if is_cancelled:
                is_cancelled()
            judge_results = self._judge_proposal(
                capsule=capsule,
                facts=facts,
                proposal=candidate,
                is_cancelled=is_cancelled,
            )
            consensus = compute_consensus_and_decision(judge_results, thresholds=self.thresholds)
            scored.append({
                "id": uuid.uuid4().hex,
                "metaphor": str(candidate.get("metaphor", "")).strip(),
                "rationale": str(candidate.get("rationale", "")).strip(),
                "sustained_examples_per_fact": candidate.get("sustained_examples_per_fact") or {},
                "judge_breakdown": judge_results,
                "composite": round(consensus.composite, 4),
                "variance": round(consensus.variance, 4),
                "decision": consensus.decision,
                "reasons": consensus.reasons,
                "proposer_provider": proposer_payload["provider"],
                "proposer_model": proposer_payload["model"],
                "proposed_at": _utc_now_iso(),
                "proposed_by": actor,
                "run_id": run_id,
            })

        # Pick the winner by (decision_priority, composite, -variance)
        winner = self._select_winner(scored)
        review_status = self._review_status_for(winner)

        identity = make_eval_identity()
        # Atomically merge into capsule.meta_data preserving any prior fields
        def _mutate(meta: dict[str, Any]) -> dict[str, Any]:
            history = list(meta.get("metaphor_proposals") or [])
            history.append({
                "run_id": run_id,
                "proposed_at": _utc_now_iso(),
                "proposed_by": actor,
                "eval_identity": identity,
                "candidates": scored,
                "winner_id": winner["id"] if winner else None,
            })
            # Cap proposal-runs history. JSONB rewrites the whole column on
            # every update; without a bound, repeated regenerates accumulate
            # unbounded judge breakdowns and reasoning text.
            # IMPORTANT: keep entry[0] (the FIRST run, the one a reviewer most
            # likely wants to compare against) plus the newest N-1 — per
            # pre-ship review pass-2 N1/N2. A pure `[-N:]` cap silently destroys
            # the original audit anchor.
            if len(history) > _MAX_PROPOSAL_RUNS_HISTORY:
                history = [history[0]] + history[-(_MAX_PROPOSAL_RUNS_HISTORY - 1):]
            meta["metaphor_proposals"] = history

            # Race guard: NEVER auto-overwrite a human-approved or human-rejected
            # metaphor with a freshly-scored AUTO_ACCEPT. The reviewer's call
            # is durable until they explicitly approve or regenerate from the UI.
            existing_review = meta.get("metaphor_review") or {}
            existing_status = existing_review.get("status")
            human_locked = existing_status in ("human_approved",) or existing_review.get("rejected") is True

            def _archive_prior_review(reason: str) -> None:
                """Symmetric audit archive on every overwrite path.
                Per pre-ship review pass-2 N-H4/N-H5: previously only the route's
                review action archived; service-side AUTO_ACCEPT overwrites
                clobbered the prior review without trail. Now both paths archive.
                Cap at 50, preserving the FIRST entry."""
                prior = meta.get("metaphor_review")
                if not prior:
                    return
                arch = list(meta.get("metaphor_review_history") or [])
                arch.append({**prior, "archived_at": _utc_now_iso(), "archive_reason": reason})
                if len(arch) > 50:
                    arch = [arch[0]] + arch[-49:]
                meta["metaphor_review_history"] = arch

            if winner and winner["decision"] == "AUTO_ACCEPT" and not human_locked:
                _archive_prior_review("auto_accept_overwrite")
                meta["metaphor"] = winner["metaphor"]
                meta["metaphor_sustained_examples"] = winner["sustained_examples_per_fact"]
                meta["metaphor_review"] = {
                    "status": "auto_accepted",
                    "reviewer": None,
                    "reviewed_at": None,
                    "winner_run_id": run_id,
                    "winner_id": winner["id"],
                }
            elif not human_locked and not meta.get("metaphor"):
                # No prior accepted metaphor and no human lock — mark for review
                _archive_prior_review("transition_to_review_status")
                meta["metaphor_review"] = {
                    "status": review_status,
                    "reviewer": None,
                    "reviewed_at": None,
                    "winner_run_id": run_id,
                    "winner_id": winner["id"] if winner else None,
                }
            elif human_locked:
                # Preserve the human's call; surface a `latest_run_*` pointer so
                # operators can see new proposals were scored without disturbing
                # the durable review state. No archive needed because the
                # canonical review record is unchanged.
                meta["metaphor_review"] = {
                    **existing_review,
                    "latest_run_id": run_id,
                    "latest_run_at": _utc_now_iso(),
                }
            return meta

        db.update_capsule_meta_data(cid, _mutate)

        # Roll up degraded-judges + fallback signals across all candidates so
        # operators can see at a glance whether the heterogeneous-prior story
        # actually held for this run.
        degraded_judges = 0
        fallback_judges = 0
        for c in scored:
            for jpayload in (c.get("judge_breakdown") or {}).values():
                if jpayload.get("score") is None or "evaluation_error" in (jpayload.get("flags") or []):
                    degraded_judges += 1
                if jpayload.get("fell_back"):
                    fallback_judges += 1

        return {
            "capsule_id": cid,
            "capsule_name": capsule["capsule_name"],
            "subject_name": capsule.get("subject_name"),
            "run_id": run_id,
            "candidates": [
                {
                    "id": c["id"],
                    "metaphor": c["metaphor"],
                    "composite": c["composite"],
                    "variance": c["variance"],
                    "decision": c["decision"],
                }
                for c in scored
            ],
            "winner_id": winner["id"] if winner else None,
            "winner_decision": winner["decision"] if winner else None,
            "winner_metaphor": winner["metaphor"] if winner else None,
            "review_status": review_status,
            "degraded_judges": degraded_judges,
            "fallback_judges": fallback_judges,
            "proposer_fell_back": bool(proposer_payload.get("fell_back")),
            "status": "ok",
        }

    # ---- proposer ------------------------------------------------------

    def _propose(
        self,
        *,
        capsule: dict[str, Any],
        facts: list[dict[str, Any]],
        n_proposals: int,
    ) -> dict[str, Any]:
        """Call the proposer LLM and return parsed candidates with provider metadata.

        Validates that each candidate's `sustained_examples_per_fact` keyset is a
        subset of the actual fact_ids in this capsule. The proposer's system
        prompt instructs it to use real fact_ids, but local models sometimes
        echo the literal placeholder string `<fact_id>` from the example —
        in which case the UI's per-fact preview shows "(no sustained example)"
        for every fact and the metaphor's "sustains across facts" claim is
        unverifiable. Drop any candidate whose keyset doesn't match.
        """
        # Default proposer = GPT-OSS 120B on Cerebras (fast + cheap, good
        # JSON-mode following). Operator can override via the
        # METAPHOR_PROPOSER_PROVIDER / METAPHOR_PROPOSER_MODEL env vars to
        # use a frontier vendor when those keys come back online.
        proposer_provider = (os.environ.get("METAPHOR_PROPOSER_PROVIDER", "cerebras") or "cerebras").strip().lower()
        proposer_model = (os.environ.get("METAPHOR_PROPOSER_MODEL") or "").strip() or None
        valid_fact_ids = {str(f["fact_id"]) for f in facts}

        user_prompt = build_proposer_user_prompt(
            capsule_name=capsule["capsule_name"],
            subject=capsule.get("subject_name", ""),
            age_range=capsule.get("age_range", ""),
            theme_name=capsule.get("theme_name", ""),
            facts=facts,
        )

        # Up to 3 proposer attempts: the configured temperature on the first
        # try gives diverse candidates; retries drop temperature so the model
        # leans toward strict JSON-shape compliance. Without this, ~25% of
        # capsules trip "Proposer returned zero candidates" on a single
        # high-temp call to a 120B-class open-weight model whose JSON-mode
        # adherence isn't quite as tight as GPT-4o's.
        attempts: list[dict[str, Any]] = []
        base_temp = float(self.guardrails["proposer_temperature"])
        for attempt_idx, temp in enumerate([base_temp, max(0.2, base_temp / 2), 0.1]):
            raw, provider_used, model_used, proposer_fell_back = _call_judge_provider(
                provider_id=proposer_provider,
                model_override=proposer_model,
                system_prompt=PROPOSER_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                temperature=temp,
                max_tokens=int(self.guardrails["proposer_max_tokens"]),
            )
            parsed = extract_json(raw, default={})
            candidates = parsed.get("proposals") or []
            if not isinstance(candidates, list):
                candidates = []

            cleaned: list[dict[str, Any]] = []
            rejected_reasons: list[str] = []
            for c in candidates:
                if not isinstance(c, dict):
                    continue
                metaphor_text = str(c.get("metaphor", "")).strip()
                if not metaphor_text:
                    rejected_reasons.append("empty_metaphor")
                    continue
                sustained = c.get("sustained_examples_per_fact") or {}
                if not isinstance(sustained, dict):
                    sustained = {}
                sustained_keys = {str(k) for k in sustained.keys()}
                # Tolerate a candidate that's missing one or two facts (the
                # proposer may have honestly skipped a fact it can't extend);
                # reject only when the candidate is clearly broken (zero
                # overlap or contains the literal `<fact_id>` placeholder).
                if "<fact_id>" in sustained_keys or not sustained_keys & valid_fact_ids:
                    rejected_reasons.append("sustained_examples_keyset_mismatch")
                    continue
                cleaned.append({
                    "metaphor": metaphor_text,
                    "rationale": str(c.get("rationale", "")).strip(),
                    "sustained_examples_per_fact": {
                        k: str(v) for k, v in sustained.items() if k in valid_fact_ids
                    },
                })
                if len(cleaned) >= n_proposals:
                    break

            attempts.append({
                "attempt": attempt_idx + 1, "temperature": temp,
                "candidate_count": len(cleaned), "rejected": rejected_reasons,
            })
            if cleaned:
                # Got at least one valid candidate; we're done.
                return {
                    "proposals": cleaned,
                    "provider": provider_used,
                    "model": model_used,
                    "fell_back": proposer_fell_back,
                    "rejected_count": sum(len(a["rejected"]) for a in attempts),
                    "rejected_reasons": [r for a in attempts for r in a["rejected"]],
                    "attempts": attempts,
                    "raw": raw,
                }
            log.warning("metaphor proposer attempt %d/3 returned 0 valid candidates "
                        "(rejected=%s); retrying at lower temperature",
                        attempt_idx + 1, rejected_reasons)

        # All 3 attempts failed. Return empty so _evaluate_one_capsule can
        # raise a clear error and the batch records this capsule as failed
        # rather than continuing with a broken proposal set.
        return {
            "proposals": [],
            "provider": provider_used,
            "model": model_used,
            "fell_back": proposer_fell_back,
            "rejected_count": sum(len(a["rejected"]) for a in attempts),
            "rejected_reasons": [r for a in attempts for r in a["rejected"]],
            "attempts": attempts,
            "raw": raw,
        }

    # ---- judges --------------------------------------------------------

    def _judge_proposal(
        self,
        *,
        capsule: dict[str, Any],
        facts: list[dict[str, Any]],
        proposal: dict[str, Any],
        is_cancelled: Callable[[], None] | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Run all 5 judges in parallel against one proposal. Returns judge_name -> payload.

        Each judge slot is independent (different system prompt, different
        rubric, different model) and an LLM call is dominated by network/inference
        wait, so we issue them concurrently. Cuts per-candidate latency from ~5*T
        to ~T. Cap at 5 workers to match the slot count and avoid hammering
        a single local model server with surprise concurrency.

        On parse failure or unrecoverable provider error, the slot is marked
        with `evaluation_error` in `flags` and `score=None`. The consensus rule
        excludes these slots from mean and variance — preventing a single
        broken judge from dragging an otherwise-strong metaphor to AUTO_REJECT.

        Cancel propagation (per pre-ship review pass-2 N-C1): we use as_completed
        + a periodic cancel poll while waiting for futures so cancel takes
        effect within seconds of being requested, rather than blocking for
        the full per-candidate duration on the slowest judge.
        """
        judge_results: dict[str, dict[str, Any]] = {}

        def _run_one(slot) -> tuple[str, dict[str, Any]]:
            provider_id = resolve_judge_provider(slot.name)
            model_override = resolve_judge_model(slot.name)
            user_prompt = build_judge_user_prompt(
                judge_name=slot.name,
                capsule_name=capsule["capsule_name"],
                subject=capsule.get("subject_name", ""),
                age_range=capsule.get("age_range", ""),
                theme_name=capsule.get("theme_name", ""),
                proposal=proposal,
                facts=facts,
            )
            try:
                raw, provider_used, model_used, fell_back = _call_judge_provider(
                    provider_id=provider_id,
                    model_override=model_override,
                    system_prompt="You are an evaluation judge. Return STRICT JSON only.",
                    user_prompt=user_prompt,
                    temperature=float(self.guardrails["judge_temperature"]),
                    max_tokens=int(self.guardrails["judge_max_tokens"]),
                )
                parsed = extract_json(raw, default=None)
                if not isinstance(parsed, dict) or "score" not in parsed:
                    return slot.name, {
                        "score": None,  # sentinel: excluded from consensus
                        "reasoning": "unparseable judge response",
                        "flags": ["evaluation_error"],
                        "provider": provider_used,
                        "model": model_used,
                        "fell_back": fell_back,
                    }
                try:
                    score = max(0.0, min(1.0, float(parsed.get("score", 0.0))))
                except (TypeError, ValueError):
                    return slot.name, {
                        "score": None,
                        "reasoning": "judge returned non-numeric score",
                        "flags": ["evaluation_error"],
                        "provider": provider_used,
                        "model": model_used,
                        "fell_back": fell_back,
                    }
                return slot.name, {
                    "score": score,
                    "reasoning": str(parsed.get("reasoning", ""))[:1000],
                    "flags": [str(f) for f in (parsed.get("flags") or []) if f][:10],
                    "provider": provider_used,
                    "model": model_used,
                    "fell_back": fell_back,
                }
            except Exception as exc:
                log.warning("metaphor judge %s failed: %s", slot.name, exc)
                return slot.name, {
                    "score": None,  # sentinel
                    "reasoning": f"judge error: {exc}",
                    "flags": ["evaluation_error"],
                    "provider": provider_id,
                    "model": model_override or "",
                    "fell_back": False,
                }

        # Use submit() + as_completed() so we can poll the cancel flag while
        # waiting and surface a sensible result for slots that haven't returned
        # yet when cancel fires. pool.map() blocks for the slowest judge with
        # no opportunity to short-circuit.
        with ThreadPoolExecutor(max_workers=len(JUDGE_SLOTS)) as pool:
            from concurrent.futures import as_completed, wait, FIRST_COMPLETED
            future_to_slot = {pool.submit(_run_one, slot): slot for slot in JUDGE_SLOTS}
            pending = set(future_to_slot.keys())
            cancelled_mid_flight = False
            # Poll cancel every 2s while we wait for judges. Cap at 30 polls
            # (~60s) so a hung pool doesn't loop forever; the per-judge retry
            # logic will eventually time out and resolve.
            for _ in range(60):
                if not pending:
                    break
                if is_cancelled:
                    try:
                        is_cancelled()
                    except RuntimeError:
                        cancelled_mid_flight = True
                        break
                done, pending = wait(pending, timeout=2.0, return_when=FIRST_COMPLETED)
                for fut in done:
                    name, payload = fut.result()
                    judge_results[name] = payload
            if cancelled_mid_flight:
                # Mark unresolved slots so consensus excludes them; cancel
                # raises out of the outer loop after this returns.
                for fut in pending:
                    slot = future_to_slot[fut]
                    judge_results[slot.name] = {
                        "score": None,
                        "reasoning": "judge cancelled before completion",
                        "flags": ["evaluation_error", "cancelled"],
                        "provider": resolve_judge_provider(slot.name),
                        "model": resolve_judge_model(slot.name) or "",
                        "fell_back": False,
                    }
                # Re-raise the cancel so command_evaluate stops the batch.
                if is_cancelled:
                    is_cancelled()
            else:
                # Drain anything still pending after the poll budget — uncommon
                # but possible when judges are very slow and cancel hasn't fired.
                for fut in as_completed(pending):
                    name, payload = fut.result()
                    judge_results[name] = payload
        return judge_results

    # ---- ranking + review status --------------------------------------

    def _select_winner(self, scored: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Pick the winning candidate. AUTO_ACCEPT > NEEDS_REVIEW > AUTO_REJECT, then composite, then -variance."""
        if not scored:
            return None
        priority = {"AUTO_ACCEPT": 0, "NEEDS_REVIEW": 1, "AUTO_REJECT": 2}
        return sorted(
            scored,
            key=lambda c: (priority.get(c["decision"], 3), -c["composite"], c["variance"]),
        )[0]

    def _review_status_for(self, winner: dict[str, Any] | None) -> str:
        if winner is None:
            return "needs_review"
        if winner["decision"] == "AUTO_ACCEPT":
            return "auto_accepted"
        if winner["decision"] == "AUTO_REJECT":
            return "auto_rejected"
        return "needs_review"

    # ---- scope helpers -------------------------------------------------

    def _resolve_scope_capsules(self, scope: dict[str, Any]) -> list[dict[str, Any]]:
        cid = scope.get("capsule_id")
        if cid:
            row = db.get_capsule_with_scope(str(cid))
            if not row:
                raise ValueError(f"Capsule {cid} not found")
            return [row]
        subject = scope.get("subject")
        phase = scope.get("phase")
        return db.list_capsules_with_scope(subject_name=subject, phase=phase)


SERVICE = MetaphorEvalService()
