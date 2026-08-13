"""Media generation tool supporting xAI, Google Gemini, and Nano Banana.

The tutor LLM writes the image prompt directly inside <EDUCATIONAL_IMAGE> tags.
We pass the prompt through to the selected provider without additional rewriting.
"""

import base64
import json
import os
from datetime import datetime
from pathlib import Path

import httpx

# xAI SDK for image generation
try:
    from xai_sdk import Client as XAIClient
except Exception:
    XAIClient = None
    print("WARNING: xai_sdk unavailable - image generation will fail")


def _first_env(*names: str) -> str:
    for name in names:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return ""


XAI_API_KEY = _first_env("XAI_IMAGE_API_KEY", "XAI_API_KEY")
GOOGLE_API_KEY = _first_env("GOOGLE_AI_API_KEY", "GOOGLE_API_KEY")
IMAGE_MODEL = "grok-imagine-image-quality"

# Directory to save generated images
MEDIA_DIR = Path(__file__).parent.parent / "generated_media"
MEDIA_DIR.mkdir(exist_ok=True)


def generate_from_prompt(
    image_prompt: str,
    aspect_ratio: str = "16:9",
    provider: str | None = None,
    model: str | None = None,
) -> str:
    """Generate image from prompt using configured provider/model.

    Args:
        image_prompt: The exact prompt to send (written by the tutor LLM).
        aspect_ratio: Image dimensions (16:9, 9:16, 1:1, etc.)

    Returns:
        JSON with image URL or error message.
    """
    # Keep legacy behavior stable: existing callers default to xAI/Grok unless
    # they explicitly pass provider/model (used by image-eval tooling).
    active_provider = (provider or "xai").strip().lower()
    active_model = model or IMAGE_MODEL
    try:
        if active_provider == "xai":
            return _generate_xai(image_prompt=image_prompt, aspect_ratio=aspect_ratio, model=active_model)
        if active_provider in {"google", "gemini", "google_gemini", "google-gemini"}:
            return _generate_google_gemini(image_prompt=image_prompt, aspect_ratio=aspect_ratio, model=active_model)
        if active_provider in {"nano_banana", "nano-banana", "nanobanana"}:
            return _generate_nano_banana(image_prompt=image_prompt, aspect_ratio=aspect_ratio, model=active_model)
        return json.dumps({
            "success": False,
            "error": f"Unsupported image provider: {active_provider}",
        })
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def _generate_xai(image_prompt: str, aspect_ratio: str, model: str) -> str:
    if not XAI_API_KEY:
        return json.dumps({
            "error": "XAI image key not set",
            "suggestion": "Set XAI_IMAGE_API_KEY (or fallback XAI_API_KEY)",
        })

    if not XAIClient:
        return json.dumps({
            "error": "xai_sdk not installed",
            "suggestion": "Run: pip install xai-sdk",
        })

    try:
        client = XAIClient(api_key=XAI_API_KEY)
        use_model = model or IMAGE_MODEL
        response = client.image.sample(
            prompt=image_prompt,
            model=use_model,
            aspect_ratio=aspect_ratio,
        )
        image_url = response.url
        usage = response.usage if hasattr(response, "usage") else None
        total_tokens = usage.total_tokens if usage else 0
        prompt_tokens = usage.prompt_tokens if usage else 0
        completion_tokens = usage.completion_tokens if usage else 0
        client.close()
    except Exception as e:
        return json.dumps({
            "success": False,
            "error": str(e),
        })

    return json.dumps({
        "success": True,
        "image_url": image_url,
        "provider": "xai",
        "model": use_model,
        "aspect_ratio": aspect_ratio,
        "tokens_used": total_tokens,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
    }, indent=2)


def _write_generated_image_bytes(image_bytes: bytes, ext: str = "png") -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"google_{ts}.{ext.lstrip('.')}"
    filepath = MEDIA_DIR / filename
    filepath.write_bytes(image_bytes)
    return filepath.resolve().as_uri()


def _generate_google_gemini(image_prompt: str, aspect_ratio: str, model: str) -> str:
    api_key = GOOGLE_API_KEY
    if not api_key:
        return json.dumps({
            "success": False,
            "error": "Missing Google API key. Set GOOGLE_AI_API_KEY (or fallback GOOGLE_API_KEY).",
        })

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    prompt_with_ratio = (
        f"{image_prompt}\n\n"
        f"Render as a single educational illustration in {aspect_ratio} aspect ratio."
    )
    body = {
        "contents": [{"parts": [{"text": prompt_with_ratio}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
        },
    }

    with httpx.Client(timeout=120) as client:
        resp = client.post(
            endpoint,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()

    b64_data = ""
    mime = "image/png"
    for candidate in data.get("candidates") or []:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data") or {}
            if inline.get("data"):
                b64_data = inline.get("data")
                mime = str(inline.get("mimeType") or inline.get("mime_type") or mime).lower()
                break
        if b64_data:
            break

    if not b64_data:
        return json.dumps({
            "success": False,
            "error": "Gemini response did not contain inline image data",
            "raw_response": data,
        })

    try:
        image_bytes = base64.b64decode(b64_data)
    except Exception:
        return json.dumps({
            "success": False,
            "error": "Gemini response image payload was not valid base64",
        })

    ext = "jpg" if ("jpeg" in mime or "jpg" in mime) else "png"
    image_url = _write_generated_image_bytes(image_bytes, ext=ext)
    usage = data.get("usageMetadata") or {}
    return json.dumps({
        "success": True,
        "image_url": image_url,
        "provider": "google",
        "model": model,
        "aspect_ratio": aspect_ratio,
        "tokens_used": usage.get("totalTokenCount", 0),
        "prompt_tokens": usage.get("promptTokenCount", 0),
        "completion_tokens": usage.get("candidatesTokenCount", 0),
    }, indent=2)


def _generate_nano_banana(image_prompt: str, aspect_ratio: str, model: str) -> str:
    """Generate via an OpenAI-compatible image endpoint for Nano Banana.

    Required env vars:
      - NANO_BANANA_API_KEY
      - NANO_BANANA_BASE_URL (e.g. https://.../v1)
    """
    api_key = os.environ.get("NANO_BANANA_API_KEY", "").strip()
    base_url = os.environ.get("NANO_BANANA_BASE_URL", "").strip()
    if not api_key or not base_url:
        return json.dumps({
            "success": False,
            "error": "NANO_BANANA_API_KEY and NANO_BANANA_BASE_URL are required for nano_banana provider",
        })

    url = f"{base_url.rstrip('/')}/images/generations"
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "prompt": image_prompt,
                "size": aspect_ratio,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    image_url = None
    payload = data.get("data", [])
    if payload and isinstance(payload, list):
        image_url = payload[0].get("url")

    if not image_url:
        return json.dumps({
            "success": False,
            "error": "Nano Banana response did not contain image URL",
            "raw_response": data,
        })

    usage = data.get("usage") or {}
    return json.dumps({
        "success": True,
        "image_url": image_url,
        "provider": "nano_banana",
        "model": model,
        "aspect_ratio": aspect_ratio,
        "tokens_used": usage.get("total_tokens", 0),
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
    }, indent=2)


# Keep legacy function name as alias for callers that haven't been updated
def generate_educational_image(
    tutor_message: str,
    student_age: str = "10-12",
    aspect_ratio: str = "16:9",
    **kwargs,
) -> str:
    """Legacy wrapper — generates using the tutor message as the prompt."""
    return generate_from_prompt(tutor_message, aspect_ratio)


if __name__ == "__main__":
    print("=== Testing Media Tool ===")
    if not XAI_API_KEY:
        print("XAI_IMAGE_API_KEY (or XAI_API_KEY) not set - skipping actual generation")
    else:
        print("Generating test image...")
        result = generate_from_prompt(
            "A bright Pixar-style cartoon of a human heart pumping blood. "
            "Red arteries carry blood away, blue veins bring it back. "
            "Clean arrows show flow direction. One small label per vessel. "
            "No text boxes, no speech bubbles. Single unified scene."
        )
        print(result)
