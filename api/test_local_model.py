"""Quick smoke test for local model routing via Ollama.

Prerequisites:
  1. SSH tunnel running: ssh -i <your-key> -L 11434:localhost:11434 <user>@<ollama-host> -N
  2. Ollama running on DGX Spark with gemma3:4b pulled

Usage:
  LOCAL_MODEL_ENABLED=true LOCAL_GEMMA_URL=http://localhost:11434/v1 python3 test_local_model.py
"""

import os
import sys

# Add project root to path so tools/ is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Set env before imports
os.environ["LOCAL_MODEL_ENABLED"] = "true"
os.environ["LOCAL_GEMMA_URL"] = "http://localhost:11434/v1"

from model_router import call_llm, stream_llm, TaskType

def test_call():
    print("=== Testing call_llm (non-streaming) ===")
    response = call_llm(
        TaskType.IMAGE_JUDGE,
        messages=[
            {"role": "system", "content": "Return valid JSON only."},
            {"role": "user", "content": "Rate this image description for educational value. Description: A diagram showing plant cells with labeled chloroplasts. Return JSON: {\"score\": 0.0-1.0, \"reasoning\": \"...\"}"},
        ],
        temperature=0.1,
        max_tokens=200,
    )
    print(f"Provider: {response.provider}")
    print(f"Model: {response.model}")
    print(f"Content: {response.content}")
    print(f"Tokens: {response.usage.total_tokens}")
    print(f"Cost: ${response.usage.total_tokens * 0}")  # local = free
    print()

def test_stream():
    print("=== Testing stream_llm (streaming) ===")
    full = ""
    for typ, text, final in stream_llm(
        TaskType.TUTOR_SIMPLE,
        messages=[
            {"role": "system", "content": "You are a friendly biology tutor for a 12 year old."},
            {"role": "user", "content": "What are cells?"},
        ],
        temperature=0.5,
        max_tokens=100,
    ):
        if typ == "content":
            print(text, end="", flush=True)
            full += text
        if final:
            print(f"\n\nProvider: {final.provider}")
            print(f"Model: {final.model}")
            print(f"Tokens: {final.usage.total_tokens}")
    print()

if __name__ == "__main__":
    try:
        test_call()
        test_stream()
        print("ALL TESTS PASSED")
    except Exception as e:
        print(f"FAILED: {e}", file=sys.stderr)
        sys.exit(1)
