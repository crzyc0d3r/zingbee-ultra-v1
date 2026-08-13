"""Model routing layer for local (vLLM) and frontier (xAI) LLM calls.

Routes requests to local models or frontier APIs based on task type.
Local models are served via vLLM with an OpenAI-compatible endpoint.

Supports a 3-provider local architecture for vLLM multi-model serving:
  - LOCAL_TEXT_GEN  (Qwen3-32B NVFP4)  — explanation generation
  - LOCAL_TEXT_EVAL (Qwen3-14B FP8)    — text judge evaluation
  - LOCAL_VISION   (Gemma 4 26B-A4B)   — image judge evaluation (multimodal)

Legacy LOCAL_NEMO / LOCAL_GEMMA providers are preserved for backward compat
with existing classifier/assessor/tutor routing.

When LOCAL_MODEL_ENABLED=false or local models are unreachable,
all calls fall back to xAI frontier models automatically.
"""

import logging
import os
import socket
import threading
import time
import urllib.parse
from dataclasses import dataclass, field
from enum import Enum

from openai import OpenAI

from llm import call_xai, stream_xai, calc_cost

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Task types — each maps to a default model provider
# ---------------------------------------------------------------------------

class TaskType(str, Enum):
    CLASSIFIER = "classifier"
    ASSESSOR = "assessor"
    TUTOR_SIMPLE = "tutor_simple"
    TUTOR_COMPLEX = "tutor_complex"
    IMAGE_JUDGE = "image_judge"
    EXPLANATION_GEN = "explanation_gen"
    EXPLANATION_EVAL = "explanation_eval"
    PLAYGROUND = "playground"


class Provider(str, Enum):
    XAI = "xai"
    LOCAL_NEMO = "local_nemo"
    LOCAL_GEMMA = "local_gemma"
    # vLLM multi-model providers (DGX Spark)
    LOCAL_TEXT_GEN = "local_text_gen"
    LOCAL_TEXT_EVAL = "local_text_eval"
    LOCAL_VISION = "local_vision"


# ---------------------------------------------------------------------------
# Response normalization — matches xAI SDK response shape
# ---------------------------------------------------------------------------

@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class LLMResponse:
    """Normalized response matching the shape callers expect (response.content, response.usage, response.id)."""
    content: str = ""
    usage: Usage = field(default_factory=Usage)
    model: str = ""
    provider: str = ""
    id: str | None = None


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _is_enabled() -> bool:
    return os.environ.get("LOCAL_MODEL_ENABLED", "false").lower() in ("true", "1", "yes")


def _local_nemo_url() -> str:
    return os.environ.get("LOCAL_NEMO_URL", "")


def _local_gemma_url() -> str:
    # Default to same Ollama instance as Nemo (Ollama serves multiple models on one port)
    return os.environ.get("LOCAL_GEMMA_URL", os.environ.get("LOCAL_NEMO_URL", ""))


def _local_nemo_model() -> str:
    return os.environ.get("LOCAL_NEMO_MODEL", "mistral-nemo")


def _local_gemma_model() -> str:
    return os.environ.get("LOCAL_GEMMA_MODEL", "gemma3:4b")


def _local_gemma_12b_model() -> str:
    return os.environ.get("LOCAL_GEMMA_12B_MODEL", "gemma3:12b")


# ---------------------------------------------------------------------------
# vLLM multi-model configuration (DGX Spark)
# ---------------------------------------------------------------------------

def _vllm_text_gen_url() -> str:
    """URL for the vLLM text generation instance (Qwen3-32B NVFP4)."""
    return os.environ.get("VLLM_TEXT_GEN_URL", "")


def _vllm_text_gen_model() -> str:
    return os.environ.get("VLLM_TEXT_GEN_MODEL", "nvidia/Qwen3-32B-FP4")


def _vllm_text_eval_url() -> str:
    """URL for the vLLM text evaluation instance (Qwen3-14B FP8)."""
    return os.environ.get("VLLM_TEXT_EVAL_URL", "")


def _vllm_text_eval_model() -> str:
    return os.environ.get("VLLM_TEXT_EVAL_MODEL", "nvidia/Qwen3-14B-FP8")


def _vllm_vision_url() -> str:
    """URL for the vLLM vision instance (Gemma 4 26B-A4B)."""
    return os.environ.get("VLLM_VISION_URL", "")


def _vllm_vision_model() -> str:
    return os.environ.get("VLLM_VISION_MODEL", "google/gemma-4-26B-A4B-it")


# Map judge names to the appropriate local model size
# Complex reasoning judges get the 12B model; simple detection judges get 4B
_JUDGE_MODEL_MAP = {
    "fact_checker": "12b",
    "misinterpretation_hunter": "12b",
    "pedagogical_effectiveness": "12b",
    # All others default to 4B (visual_clarity, text_accuracy, cultural_representation)
}


def _model_for_judge(judge_name: str | None) -> str:
    """Return the model name for a given image eval judge.

    When vLLM vision provider is configured, all judges use the same model
    (Gemma 4 handles all complexity levels). Falls back to Ollama 4B/12B split.
    """
    if _vllm_vision_url():
        return _vllm_vision_model()
    if judge_name and _JUDGE_MODEL_MAP.get(judge_name) == "12b":
        return _local_gemma_12b_model()
    return _local_gemma_model()


# Default routing table: task -> provider
# vLLM providers take priority when configured; legacy Ollama providers as fallback
_DEFAULT_ROUTES: dict[TaskType, Provider] = {
    TaskType.CLASSIFIER: Provider.LOCAL_NEMO,
    TaskType.ASSESSOR: Provider.LOCAL_NEMO,
    TaskType.TUTOR_SIMPLE: Provider.LOCAL_GEMMA,
    TaskType.TUTOR_COMPLEX: Provider.XAI,
    TaskType.IMAGE_JUDGE: Provider.LOCAL_VISION,
    TaskType.EXPLANATION_GEN: Provider.LOCAL_TEXT_GEN,
    # H-17: Route to LOCAL_VISION (Gemma 4, cross-family) to avoid in-family judge bias
    TaskType.EXPLANATION_EVAL: Provider.LOCAL_VISION,
    TaskType.PLAYGROUND: Provider.XAI,
}

# Override routes via env: ROUTING_CLASSIFIER=xai, ROUTING_ASSESSOR=local_nemo, etc.
def _get_route(task_type: TaskType) -> Provider:
    env_key = f"ROUTING_{task_type.value.upper()}"
    override = os.environ.get(env_key, "").strip().lower()
    if override:
        try:
            return Provider(override)
        except ValueError:
            log.warning("Invalid ROUTING override %s=%s, using default", env_key, override)
    return _DEFAULT_ROUTES.get(task_type, Provider.XAI)


_ALL_LOCAL_PROVIDERS = (
    Provider.LOCAL_NEMO, Provider.LOCAL_GEMMA,
    Provider.LOCAL_TEXT_GEN, Provider.LOCAL_TEXT_EVAL, Provider.LOCAL_VISION,
)

# Fallback chain: if a vLLM provider has no URL, try legacy Ollama, then xAI
_VLLM_FALLBACK: dict[Provider, Provider] = {
    Provider.LOCAL_TEXT_GEN: Provider.LOCAL_NEMO,
    Provider.LOCAL_TEXT_EVAL: Provider.LOCAL_NEMO,
    Provider.LOCAL_VISION: Provider.LOCAL_GEMMA,
}


def _resolve_provider(task_type: TaskType) -> Provider:
    """Resolve which provider to use, with fallback chain: vLLM -> Ollama -> xAI."""
    route = _get_route(task_type)

    if route not in _ALL_LOCAL_PROVIDERS:
        return route

    if not _is_enabled():
        return Provider.XAI

    # For vLLM providers: check if configured, fall back to legacy if not
    if route in (Provider.LOCAL_TEXT_GEN, Provider.LOCAL_TEXT_EVAL, Provider.LOCAL_VISION):
        url = _local_config_url(route)
        if url:
            return route
        # Fall back to legacy Ollama provider
        fallback = _VLLM_FALLBACK.get(route, Provider.XAI)
        legacy_url, _ = _local_config(fallback)
        if legacy_url:
            log.info("vLLM %s not configured, falling back to %s", route.value, fallback.value)
            return fallback
        return Provider.XAI

    return route


def _local_config_url(provider: Provider) -> str:
    """Return the base URL for a provider (no model). Used for availability checks."""
    if provider == Provider.LOCAL_TEXT_GEN:
        return _vllm_text_gen_url()
    if provider == Provider.LOCAL_TEXT_EVAL:
        return _vllm_text_eval_url()
    if provider == Provider.LOCAL_VISION:
        return _vllm_vision_url()
    if provider == Provider.LOCAL_NEMO:
        return _local_nemo_url()
    if provider == Provider.LOCAL_GEMMA:
        return _local_gemma_url()
    return ""


# ---------------------------------------------------------------------------
# Local model client (OpenAI SDK -> vLLM)
# ---------------------------------------------------------------------------

# Cache clients per base_url to avoid recreating on every call
_local_clients: dict[str, OpenAI] = {}
_local_clients_lock = threading.Lock()


def _get_local_client(base_url: str) -> OpenAI:
    # H-16: Use VLLM_API_KEY if configured; vLLM requires --api-key to enforce this
    api_key = os.environ.get("VLLM_API_KEY", "not-needed")
    cache_key = f"{base_url}:{api_key}"
    if cache_key not in _local_clients:
        with _local_clients_lock:
            if cache_key not in _local_clients:
                _local_clients[cache_key] = OpenAI(
                    base_url=base_url,
                    api_key=api_key,
                    timeout=120.0,
                )
    return _local_clients[cache_key]


def _local_config(provider: Provider) -> tuple[str, str]:
    """Return (base_url, model_name) for a local provider."""
    if provider == Provider.LOCAL_NEMO:
        return _local_nemo_url(), _local_nemo_model()
    if provider == Provider.LOCAL_GEMMA:
        return _local_gemma_url(), _local_gemma_model()
    if provider == Provider.LOCAL_TEXT_GEN:
        return _vllm_text_gen_url(), _vllm_text_gen_model()
    if provider == Provider.LOCAL_TEXT_EVAL:
        return _vllm_text_eval_url(), _vllm_text_eval_model()
    if provider == Provider.LOCAL_VISION:
        return _vllm_vision_url(), _vllm_vision_model()
    raise ValueError(f"Not a local provider: {provider}")


def _call_local(
    provider: Provider,
    messages: list,
    temperature: float = 0.5,
    max_tokens: int = 4096,
    **kwargs,
) -> LLMResponse:
    """Call a local vLLM model via OpenAI-compatible API."""
    base_url, model = _local_config(provider)
    if not base_url:
        raise ConnectionError(f"No URL configured for {provider.value}")
    client = _get_local_client(base_url)
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    choice = response.choices[0]
    usage = response.usage
    return LLMResponse(
        content=choice.message.content or "",
        usage=Usage(
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0,
        ),
        model=response.model,
        provider=provider.value,
        id=response.id,
    )


def _stream_local(
    provider: Provider,
    messages: list,
    temperature: float = 0.5,
    max_tokens: int = 4096,
    **kwargs,
):
    """Stream from a local vLLM model. Yields (type, text, final_response) tuples matching stream_xai."""
    base_url, model = _local_config(provider)
    if not base_url:
        raise ConnectionError(f"No URL configured for {provider.value}")
    client = _get_local_client(base_url)
    stream = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
        stream_options={"include_usage": True},
    )
    full_content = ""
    usage_data = Usage()
    resp_id = None
    for chunk in stream:
        resp_id = chunk.id
        if chunk.choices:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                full_content += delta.content
                yield "content", delta.content, None
        if chunk.usage:
            usage_data = Usage(
                prompt_tokens=chunk.usage.prompt_tokens,
                completion_tokens=chunk.usage.completion_tokens,
                total_tokens=chunk.usage.total_tokens,
            )
    # Final yield with complete response object
    final = LLMResponse(
        content=full_content,
        usage=usage_data,
        model=model,
        provider=provider.value,
        id=resp_id,
    )
    yield None, None, final


# ---------------------------------------------------------------------------
# Public API — call_llm / stream_llm
# ---------------------------------------------------------------------------

def call_llm(
    task_type: TaskType,
    messages: list,
    temperature: float = 0.5,
    max_tokens: int = 4096,
    *,
    model: str = None,
    store: bool = True,
    previous_response_id: str = None,
    fallback_messages: list = None,
    reasoning: str = None,
    **kwargs,
) -> LLMResponse:
    """Route an LLM call based on task type. Falls back to xAI on local model failure."""
    provider = _resolve_provider(task_type)

    # Local model path (both legacy Ollama and vLLM providers)
    if provider in _ALL_LOCAL_PROVIDERS:
        try:
            return _call_local(provider, messages, temperature, max_tokens)
        except Exception as e:
            log.warning("Local model %s failed for %s: %s — falling back to xAI", provider.value, task_type.value, e)
            provider = Provider.XAI

    # xAI frontier path
    response = call_xai(
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
        model=model,
        store=store,
        previous_response_id=previous_response_id,
        fallback_messages=fallback_messages,
        reasoning=reasoning,
    )
    # Wrap xAI response in LLMResponse for consistent shape
    return LLMResponse(
        content=response.content or "",
        usage=Usage(
            prompt_tokens=response.usage.prompt_tokens if response.usage else 0,
            completion_tokens=response.usage.completion_tokens if response.usage else 0,
            total_tokens=response.usage.total_tokens if response.usage else 0,
        ),
        model=getattr(response, 'model', model or ''),
        provider="xai",
        id=getattr(response, 'id', None),
    )


def stream_llm(
    task_type: TaskType,
    messages: list,
    temperature: float = 0.5,
    max_tokens: int = 4096,
    *,
    model: str = None,
    previous_response_id: str = None,
    fallback_messages: list = None,
    reasoning: str = None,
    **kwargs,
):
    """Stream an LLM response based on task type. Yields (type, text, final_response) tuples.

    Falls back to xAI streaming on local model failure.
    """
    provider = _resolve_provider(task_type)

    # Local model path — test connectivity before committing to the stream
    if provider in _ALL_LOCAL_PROVIDERS:
        try:
            stream = _stream_local(provider, messages, temperature, max_tokens)
            first = next(stream)  # fail fast on connection errors before yielding anything
        except Exception as e:
            log.warning("Local stream %s failed for %s: %s — falling back to xAI", provider.value, task_type.value, e)
            provider = Provider.XAI
        else:
            yield first
            yield from stream
            return

    # xAI frontier path — pass through directly
    yield from stream_xai(
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
        model=model,
        previous_response_id=previous_response_id,
        fallback_messages=fallback_messages,
        reasoning=reasoning,
    )


# ---------------------------------------------------------------------------
# Image eval helper — for image_eval_service.py's multi-provider dispatch
# ---------------------------------------------------------------------------

def call_local_image_judge(
    prompt: str,
    image_b64: str,
    mime: str,
    *,
    temperature: float = 0.1,
    max_tokens: int = 1024,
    provider: Provider | None = None,
    model: str | None = None,
    judge_name: str | None = None,
) -> str:
    """Call a local model for image evaluation. Returns raw text content.

    Uses OpenAI vision-compatible format. Requires a multimodal model.
    Defaults to LOCAL_VISION (Gemma 4 via vLLM) when configured, falls back to LOCAL_GEMMA (Ollama).
    If judge_name is provided, automatically selects the right model.
    If model is provided, it overrides the automatic selection.
    """
    if provider is None:
        provider = Provider.LOCAL_VISION if _vllm_vision_url() else Provider.LOCAL_GEMMA
    base_url, default_model = _local_config(provider)
    if not base_url:
        raise ConnectionError(f"No URL configured for {provider.value}")
    # Model selection: explicit override > judge-based selection > provider default
    if model:
        resolved_model = model
    elif judge_name:
        resolved_model = _model_for_judge(judge_name)
    else:
        resolved_model = default_model
    client = _get_local_client(base_url)

    # Try multimodal (vision) format first
    messages = [
        {"role": "system", "content": "Return valid JSON only."},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                {"type": "text", "text": prompt},
            ],
        },
    ]

    response = client.chat.completions.create(
        model=resolved_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content or ""


def call_local_text_judge(
    prompt: str,
    *,
    temperature: float = 0.1,
    max_tokens: int = 1024,
    provider: Provider | None = None,
) -> str:
    """Call a local model for text-only evaluation (no image). Returns raw text content.

    Defaults to LOCAL_TEXT_EVAL (Qwen3-14B via vLLM) when configured, falls back to LOCAL_NEMO (Ollama).
    """
    if provider is None:
        provider = Provider.LOCAL_TEXT_EVAL if _vllm_text_eval_url() else Provider.LOCAL_NEMO
    base_url, model = _local_config(provider)
    if not base_url:
        raise ConnectionError(f"No URL configured for {provider.value}")
    client = _get_local_client(base_url)

    messages = [
        {"role": "system", "content": "Return valid JSON only."},
        {"role": "user", "content": prompt},
    ]

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# Provider status — used by /distillations/api/providers endpoint
# ---------------------------------------------------------------------------

# TCP probe cache: url -> (reachable, checked_at)
_probe_cache: dict[str, tuple[bool, float]] = {}
_PROBE_TTL = 30.0


def _tcp_probe(url: str) -> bool:
    """Check if a URL's host:port is reachable. Results cached for 30s. (H-18)"""
    if not url:
        return False
    now = time.monotonic()
    cached = _probe_cache.get(url)
    if cached and now - cached[1] < _PROBE_TTL:
        return cached[0]
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname or "localhost"
        port = parsed.port or 80
        with socket.create_connection((host, port), timeout=2.0):
            result = True
    except Exception:
        result = False
    _probe_cache[url] = (result, now)
    return result


def get_provider_status() -> dict:
    """Return availability info shaped for ProviderSelector frontend component. (H-4, H-18)"""
    text_gen_url = _vllm_text_gen_url()
    text_eval_url = _vllm_text_eval_url()
    nemo_url = _local_nemo_url()
    gemma_url = _local_gemma_url()

    vllm_text_gen_ok = _tcp_probe(text_gen_url)
    vllm_text_eval_ok = _tcp_probe(text_eval_url)

    text_gen_models = []
    if text_gen_url:
        m = _vllm_text_gen_model() or "vllm-text-gen"
        text_gen_models.append({"id": m, "name": m, "available": vllm_text_gen_ok})

    text_eval_models = []
    if text_eval_url:
        m = _vllm_text_eval_model() or "vllm-text-eval"
        text_eval_models.append({"id": m, "name": m, "available": vllm_text_eval_ok})

    ollama_models = []
    if nemo_url:
        m = _local_nemo_model() or "nemo"
        ollama_models.append({"id": m, "name": m, "available": _tcp_probe(nemo_url)})
    if gemma_url:
        m = _local_gemma_model() or "gemma"
        ollama_models.append({"id": m, "name": m, "available": _tcp_probe(gemma_url)})

    return {
        "vllm": {
            "online": vllm_text_gen_ok,
            "text_gen": text_gen_models,
            "text_eval": text_eval_models,
        },
        "ollama": {
            "online": any(m["available"] for m in ollama_models) if ollama_models else False,
            "models": ollama_models,
        },
        "xai": {
            "online": bool(os.environ.get("XAI_API_KEY")),
            "image": True,
        },
        "google": {
            "online": bool(os.environ.get("GOOGLE_AI_API_KEY")),
            "vertex": bool(os.environ.get("VERTEX_IMAGE_PROJECT")),
        },
    }
