"""LLM client helpers for xAI/Grok API calls.

Provides create_client(), call_xai(), and stream_xai() used across
chat, voice, greeting, and playground endpoints.
"""

import logging

from tools.media_tool import XAI_API_KEY

try:
    from xai_sdk import Client as XAIClient
    from xai_sdk.chat import system as xai_system, user as xai_user, assistant as xai_assistant
except Exception:
    XAIClient = None
    xai_system = xai_user = xai_assistant = None

# Default model fallbacks
_DEFAULT_MODEL = "grok-4.3"
_DEFAULT_FAST_MODEL = "grok-4.3"
_DEFAULT_MAX_TOKENS = 40960

# grok-4.3 exposes reasoning_effort: none/low/medium/high (default "low").
REASONING_LEVEL = "high"

# Live pricing from xAI SDK (cached at module load)
# SDK prices are in nano-dollars per token (divide by 1e9 for USD per token)
# We store as USD per 1M tokens for readability
MODEL_RATES = {}
IMAGE_COST = {
    "grok-imagine-image": 0.02,          # $0.02 per output image
    "grok-imagine-image-pro": 0.07,      # $0.07 per output image
    "grok-imagine-image-quality": 0.07,  # $0.07 per output image (placeholder until SDK reports)
}
IMAGE_COST_PER_CALL = 0.02  # default fallback

def _load_pricing():
    """Fetch live model pricing from xAI SDK. Called once at import."""
    global MODEL_RATES, IMAGE_COST_PER_CALL
    try:
        if not XAIClient or not XAI_API_KEY:
            raise RuntimeError("xAI SDK not available")
        client = XAIClient(api_key=XAI_API_KEY)
        for m in client.models.list_language_models():
            # SDK price unit: per-1M-tokens in milli-dollars (divide by 10000 for $/1M)
            MODEL_RATES[m.name] = {
                "input": m.prompt_text_token_price / 10_000,
                "output": m.completion_text_token_price / 10_000,
            }
            for alias in m.aliases:
                MODEL_RATES[alias] = MODEL_RATES[m.name]
        for m in client.models.list_image_generation_models():
            if m.name == "grok-imagine-image":
                IMAGE_COST_PER_CALL = m.image_price / 10_000_000_000
        client.close()
        logging.info("Loaded pricing for %d models, image=$%.2f", len(MODEL_RATES), IMAGE_COST_PER_CALL)
    except Exception as e:
        logging.warning("Failed to load live pricing, using fallbacks: %s", e)
        MODEL_RATES.update({
            "grok-4-1-fast-reasoning":     {"input": 0.20, "output": 0.50},
            "grok-4-1-fast-non-reasoning": {"input": 0.20, "output": 0.50},
            "grok-3-mini":                 {"input": 0.30, "output": 0.50},
            "grok-3":                      {"input": 3.00, "output": 15.00},
        })

_load_pricing()


# Local models cost nothing (self-hosted on DGX Spark via Ollama)
LOCAL_MODEL_RATES = {
    "gemma3:4b": {"input": 0.00, "output": 0.00},
    "gemma3:12b": {"input": 0.00, "output": 0.00},
    "mistral-nemo": {"input": 0.00, "output": 0.00},
}


def calc_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Calculate cost in USD for an LLM call based on model and token counts."""
    rate = LOCAL_MODEL_RATES.get(model) or MODEL_RATES.get(model, {"input": 3.00, "output": 15.00})
    return (prompt_tokens * rate["input"] + completion_tokens * rate["output"]) / 1_000_000


# ---------------------------------------------------------------------------
# TTS / STT cost tracking
# ---------------------------------------------------------------------------
# xAI TTS is billed per character. We don't fetch this from the SDK yet, so
# it's a constant — override via env var XAI_TTS_COST_PER_1K_CHARS if xAI
# publishes a different rate.
import os
TTS_COST_PER_1K_CHARS = float(os.environ.get("XAI_TTS_COST_PER_1K_CHARS", "0.015"))
# STT is currently handled by the browser's Web Speech API (free, no
# server-side cost). If we move to a paid service, set this env var.
STT_COST_PER_1K_CHARS = float(os.environ.get("XAI_STT_COST_PER_1K_CHARS", "0.0"))


def calc_tts_cost(char_count: int) -> float:
    """Cost in USD for a TTS call with the given character count."""
    return (char_count / 1000.0) * TTS_COST_PER_1K_CHARS


def calc_stt_cost(char_count: int) -> float:
    """Cost in USD for an STT call producing the given transcript length."""
    return (char_count / 1000.0) * STT_COST_PER_1K_CHARS


def create_client():
    if not XAIClient or not XAI_API_KEY:
        raise RuntimeError("xAI SDK not available - set XAI_API_KEY environment variable")
    return XAIClient(api_key=XAI_API_KEY)


def _reasoning_effort_unsupported(err) -> bool:
    """True when xAI rejects the reasoning_effort parameter (model drift).

    Lets us retry once WITHOUT reasoning_effort instead of failing every turn — this is
    the exact failure that broke grok-4.20-0309-reasoning ("Model ... does not support
    parameter reasoningEffort"). Defends against the next model drifting the same way.
    """
    m = str(err).lower().replace("_", "")
    return "reasoningeffort" in m and any(
        s in m for s in ("does not support", "unsupported", "invalid argument", "not support"))


def call_xai(messages: list, temperature: float = 0.5, max_tokens: int = _DEFAULT_MAX_TOKENS,
             reasoning: str = None, model: str = None, store: bool = True,
             previous_response_id: str = None, fallback_messages: list = None):
    """Call XAI Responses API. Returns response object with .content attribute.

    When previous_response_id is set, only the messages in the list are sent (delta);
    the server reconstructs prior context from the stored conversation.
    If the stateful call fails, falls back to sending fallback_messages (full history).
    """
    import time as _time
    try:
        from trace_logging import event as _trace_event
    except Exception:
        _trace_event = None
    _start = _time.time()
    _resolved_model = model or _DEFAULT_MODEL
    if _trace_event:
        _trace_event("llm.request", api="xai_chat",
                     model=_resolved_model, temperature=temperature, max_tokens=max_tokens,
                     reasoning_effort=reasoning, stateful=bool(previous_response_id),
                     messages_sent_count=len(messages),
                     messages_sent=messages,
                     previous_response_id=previous_response_id)
    client = create_client()
    kwargs = dict(model=_resolved_model, temperature=temperature, max_tokens=max_tokens, store_messages=True)
    if reasoning:
        kwargs["reasoning_effort"] = reasoning
    if previous_response_id:
        kwargs["previous_response_id"] = previous_response_id
    try:
        chat = client.chat.create(**kwargs)
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                chat.append(xai_system(content))
            elif role == "user":
                chat.append(xai_user(content))
            elif role == "assistant":
                chat.append(xai_assistant(content))
        response = chat.sample()
        client.close()
        if _trace_event:
            usage = getattr(response, 'usage', None)
            content_str = getattr(response, 'content', '') or ''
            _trace_event("llm.response", api="xai_chat",
                         model=_resolved_model,
                         response_id=getattr(response, 'id', None),
                         duration_ms=int((_time.time() - _start) * 1000),
                         prompt_tokens=getattr(usage, 'prompt_tokens', None) if usage else None,
                         completion_tokens=getattr(usage, 'completion_tokens', None) if usage else None,
                         response_length=len(content_str),
                         response_preview=content_str[:500])
        return response
    except Exception as e:
        client.close()
        if _trace_event:
            _trace_event("llm.error", level=logging.ERROR, api="xai_chat",
                         model=_resolved_model, error=str(e),
                         will_fallback=bool(previous_response_id and fallback_messages))
        if reasoning and _reasoning_effort_unsupported(e):
            logging.warning("Model %s rejected reasoning_effort=%s; retrying without it (%s)",
                            _resolved_model, reasoning, e)
            return call_xai(messages, temperature=temperature, max_tokens=max_tokens,
                            reasoning=None, model=model, store=store,
                            previous_response_id=previous_response_id, fallback_messages=fallback_messages)
        if previous_response_id and fallback_messages:
            logging.warning("Stateful call failed (%s), falling back to full messages", e)
            return call_xai(fallback_messages, temperature=temperature, max_tokens=max_tokens,
                            reasoning=reasoning, model=model, store=store,
                            previous_response_id=None, fallback_messages=None)
        raise


def stream_xai(messages: list, temperature: float = 0.5, max_tokens: int = _DEFAULT_MAX_TOKENS,
               reasoning: str = None, model: str = None,
               previous_response_id: str = None, fallback_messages: list = None):
    """Stream XAI response, yielding (type, text, final_response) tuples.

    type is 'reasoning' for thinking tokens, 'content' for response tokens.
    The final yield has type=None, text=None, and the complete Response object.

    When previous_response_id is set, only the messages in the list are sent (delta).
    If the stateful call fails, falls back to streaming fallback_messages (full history).
    """
    import time as _time
    try:
        from trace_logging import event as _trace_event
    except Exception:
        _trace_event = None
    _start = _time.time()
    _resolved_model = model or _DEFAULT_MODEL
    if _trace_event:
        _trace_event("llm.request", api="xai_stream",
                     model=_resolved_model, temperature=temperature, max_tokens=max_tokens,
                     reasoning_effort=reasoning, stateful=bool(previous_response_id),
                     streaming=True, messages_sent_count=len(messages),
                     messages_sent=messages,
                     previous_response_id=previous_response_id)
    client = create_client()
    _closed = False
    _full_content = ""
    _reasoning_chars = 0
    try:
        kwargs = dict(model=_resolved_model, temperature=temperature, max_tokens=max_tokens, store_messages=True)
        if reasoning:
            kwargs["reasoning_effort"] = reasoning
        if previous_response_id:
            kwargs["previous_response_id"] = previous_response_id
        chat = client.chat.create(**kwargs)
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                chat.append(xai_system(content))
            elif role == "user":
                chat.append(xai_user(content))
            elif role == "assistant":
                chat.append(xai_assistant(content))
        for response, chunk in chat.stream():
            if chunk.reasoning_content:
                _reasoning_chars += len(chunk.reasoning_content)
                yield "reasoning", chunk.reasoning_content, None
            if chunk.content:
                _full_content += chunk.content
                yield "content", chunk.content, None
        # Final yield with complete response
        if _trace_event:
            usage = getattr(response, 'usage', None)
            _trace_event("llm.response", api="xai_stream",
                         model=_resolved_model,
                         response_id=getattr(response, 'id', None),
                         duration_ms=int((_time.time() - _start) * 1000),
                         prompt_tokens=getattr(usage, 'prompt_tokens', None) if usage else None,
                         completion_tokens=getattr(usage, 'completion_tokens', None) if usage else None,
                         response_length=len(_full_content),
                         reasoning_chars=_reasoning_chars,
                         response_preview=_full_content[:500])
        yield None, None, response
    except Exception as e:
        if _trace_event:
            _trace_event("llm.error", level=logging.ERROR, api="xai_stream",
                         model=_resolved_model, error=str(e),
                         will_fallback=bool(previous_response_id and fallback_messages))
        # reasoning_effort rejection fires at chat.create, before any chunk is yielded
        # (_full_content == ""), so a clean retry without it can't double-emit.
        if reasoning and not _full_content and _reasoning_effort_unsupported(e):
            logging.warning("Model %s rejected reasoning_effort=%s (stream); retrying without it (%s)",
                            _resolved_model, reasoning, e)
            client.close()
            _closed = True
            yield from stream_xai(messages, temperature=temperature, max_tokens=max_tokens,
                                  reasoning=None, model=model,
                                  previous_response_id=previous_response_id, fallback_messages=fallback_messages)
            return
        if previous_response_id and fallback_messages:
            logging.warning("Stateful stream failed (%s), falling back to full messages", e)
            client.close()
            _closed = True
            yield from stream_xai(fallback_messages, temperature=temperature, max_tokens=max_tokens,
                                  reasoning=reasoning, model=model,
                                  previous_response_id=None, fallback_messages=None)
            return
        raise
    finally:
        if not _closed:
            client.close()
