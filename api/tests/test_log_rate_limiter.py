import time
import importlib
import sys
from pathlib import Path

import pytest

# Ensure api/ modules are importable like other tests in this suite
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import log_rate_limiter as lrl


def setup_function(function):
    # Ensure a clean cache before each test
    lrl._cache.clear()


def test_should_log_basic():
    assert lrl.should_log_for_session("s1", "k1", ttl_seconds=60) is True
    # Immediate repeat should be suppressed
    assert lrl.should_log_for_session("s1", "k1", ttl_seconds=60) is False
    # Different key should allow logging
    assert lrl.should_log_for_session("s1", "k2", ttl_seconds=60) is True
    # Different session should allow logging for same key
    assert lrl.should_log_for_session("s2", "k1", ttl_seconds=60) is True


def test_should_log_ttl_expiry():
    ttl = 60
    session_id = "sess-x"
    key = "contract-fail"
    cache_key = f"{session_id}:{key}"
    now = time.time()

    # Simulate a recent log within TTL -> suppressed
    lrl._cache[cache_key] = now - (ttl - 1)
    assert lrl.should_log_for_session(session_id, key, ttl_seconds=ttl) is False

    # Simulate an older log outside TTL -> allowed
    lrl._cache[cache_key] = now - (ttl + 1)
    assert lrl.should_log_for_session(session_id, key, ttl_seconds=ttl) is True


def test_cache_trimming_happens_and_preserves_recent_entries():
    # Fill cache above trimming threshold with old entries
    now = time.time()
    ttl = 30
    # Create many old entries (older than cutoff = now - ttl*2)
    for i in range(10005):
        lrl._cache[f"old{i}"] = now - (ttl * 10)
    prev_len = len(lrl._cache)
    assert prev_len > 10000

    # Trigger should_log which will perform trimming if threshold exceeded
    assert lrl.should_log_for_session("new-s", "new-k", ttl_seconds=ttl) is True

    # After trimming, cache length should have decreased (stale entries removed)
    assert len(lrl._cache) < prev_len
    # Our new entry should exist
    assert any(k.startswith("new-s:new-k") or k == "new-s:new-k" for k in lrl._cache.keys())
