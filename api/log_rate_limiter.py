"""Simple in-memory per-session log rate limiter.

This module provides a tiny TTL-backed suppression cache keyed by
(session_id, key) so noisy, repeated errors (for example: missing
or unreadable state-machine contract files) are only emitted at most
once per session window by default.

It's intentionally lightweight and in-memory. For multi-instance
deployments you can replace this with a Redis-backed implementation
that performs an atomic SET NX with an expiry.
"""

import time
import threading

_lock = threading.Lock()
_cache = {}  # cache_key -> last_logged_ts (seconds since epoch)


def should_log_for_session(session_id: str, key: str, ttl_seconds: int = 60) -> bool:
    """Return True if the message SHOULD be logged for the (session_id, key).

    - session_id: session identifier (may be None/empty; normalized to 'unknown')
    - key: logical message key (e.g. 'state-machine-contract-load-fail')
    - ttl_seconds: suppression window in seconds

    The function stores the last logged timestamp and returns False if the
    same (session_id,key) was logged within ttl_seconds.
    """
    if not session_id:
        session_id = "unknown"
    cache_key = f"{session_id}:{key}"
    now = time.time()
    with _lock:
        last = _cache.get(cache_key)
        if last is not None and (now - last) < ttl_seconds:
            return False
        _cache[cache_key] = now
        # Trim stale entries occasionally to avoid unbounded growth.
        if len(_cache) > 10000:
            cutoff = now - (ttl_seconds * 2)
            for k, v in list(_cache.items()):
                if v < cutoff:
                    _cache.pop(k, None)
        return True
