#!/usr/bin/env python3
"""
Multi-Subject Tutoring Web UI with Execution Visualization.
Shows conversation, tokens, and execution steps.
Supports Biology (Aris), Math (Archi), Chemistry (Mendi), English (Lexi), and Physics (Newton).
"""

import io
import json
import asyncio
import logging
import os
import random
import re
import ssl
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from math import ceil
from pathlib import Path
from typing import Optional

# Add project root to sys.path so tools/, scripts/ etc. are importable
PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from dotenv import load_dotenv
load_dotenv()

# ---------------------------------------------------------------------------
# GCP Cloud Logging — attach a handler to the root Python logger so every
# `logging.*` call across the app is shipped to Cloud Logging. Guarded so
# local dev without credentials still falls back to stdout.
# ---------------------------------------------------------------------------
def _init_cloud_logging():
    """Attach Cloud Logging + TraceFilter so every log record carries
    trace_id and structured json_fields end up in Cloud Logging's
    jsonPayload."""
    from trace_logging import TraceFilter
    trace_filter = TraceFilter()

    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds or not Path(creds).exists():
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        # Filter still attached locally so trace_id shows up in stdout when set.
        for h in logging.getLogger().handlers:
            h.addFilter(trace_filter)
        logging.info("Cloud Logging disabled (no GOOGLE_APPLICATION_CREDENTIALS). Falling back to stdout.")
        return
    try:
        import google.cloud.logging as gcp_logging
        from google.cloud.logging.handlers import CloudLoggingHandler
        client = gcp_logging.Client()
        # name= shows up as the log bucket name in Cloud Logging so we can
        # filter by component (zingbee-ultra-api) across all services.
        handler = CloudLoggingHandler(client, name="zingbee-ultra-api")
        handler.addFilter(trace_filter)
        logging.basicConfig(level=logging.INFO, handlers=[handler], format="%(message)s")
        # Also keep a stdout mirror so container logs stay useful for debugging.
        stdout_handler = logging.StreamHandler()
        stdout_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        stdout_handler.addFilter(trace_filter)
        logging.getLogger().addHandler(stdout_handler)
        logging.info("Cloud Logging initialized (log name: zingbee-ultra-api)")
    except Exception as e:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        for h in logging.getLogger().handlers:
            h.addFilter(trace_filter)
        logging.warning("Cloud Logging init failed: %s — falling back to stdout", e)

_init_cloud_logging()

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
import uvicorn

# Import our tools
from tools.curriculum_tool import get_capsule_by_name
from tools.progress_tool import get_student_progress, update_student_progress, get_next_capsule
from tools.media_tool import generate_from_prompt, XAI_API_KEY
import db as database
import engagement
from admin_routes import router as admin_router, init_auth as _admin_init_auth
from eval_routes import router as eval_router, init_auth as _eval_init_auth
from session_routes import router as session_router, init_auth as _session_init_auth
from image_eval_routes import router as image_eval_router, init_auth as _image_eval_init_auth
from distillation_routes import router as distillation_router, init_auth as _distillation_init_auth, reset_zombie_regenerations as _distillation_reset_zombies
from metaphor_eval_routes import router as metaphor_eval_router, init_auth as _metaphor_eval_init_auth
from reporting_routes import router as reporting_router
from logs_routes import router as logs_router

# Extracted modules
import auth as auth_module
from auth import authenticate_user, authenticate_or_create_google_user, get_auth_user, SESSION_EXPIRY_DAYS
from llm import call_xai, stream_xai, calc_cost, MODEL_RATES, IMAGE_COST, IMAGE_COST_PER_CALL, _DEFAULT_MODEL, _DEFAULT_FAST_MODEL, _DEFAULT_MAX_TOKENS, REASONING_LEVEL
from model_router import call_llm, TaskType
from helpers import parse_suggestions, parse_images, _inject_image_url, _build_enrichment_lines
from report_card_utils import sync_facts_to_report_card
from curriculum_routes import router as curriculum_router, init as _curriculum_init

# Import state-machine contract error class if available so we can
# catch it at session entry points and return a graceful 503 to clients
try:
    from session_engine import StateMachineContractError
except Exception:
    StateMachineContractError = None
from student_routes import router as student_router, init as _student_init
from livekit.voice_routes import router as voice_router, init as _voice_init
from playground_routes import router as playground_router
from assessment_routes import assessment_router
from academy_routes import academy_router
from quest_routes import quest_router
from eq_chat_routes import eq_chat_router
from eq_project_routes import eq_projects_router
from eq_llmchat_routes import eq_llmchat_router
from eq_voice_routes import eq_voice_router

# Google OAuth
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

# Cookie domain for cross-subdomain SSO (.zingbee.ai in prod, None for localhost)
_COOKIE_DOMAIN = os.getenv("COOKIE_DOMAIN", None)  # Set to ".zingbee.ai" in prod .env


def _set_session_cookie(resp: JSONResponse, token: str) -> None:
    """Set the session_token cookie with cross-subdomain SSO support."""
    kwargs = dict(key="session_token", value=token, httponly=True, samesite="lax",
                  max_age=SESSION_EXPIRY_DAYS * 86400)
    if _COOKIE_DOMAIN:
        kwargs["domain"] = _COOKIE_DOMAIN
    resp.set_cookie(**kwargs)


def _delete_session_cookie(resp: JSONResponse) -> None:
    """Delete the session_token cookie across all subdomains."""
    kwargs = dict(key="session_token")
    if _COOKIE_DOMAIN:
        kwargs["domain"] = _COOKIE_DOMAIN
    resp.delete_cookie(**kwargs)


# Subject configuration registry (hardcoded fallback for when DB is unreachable)

# Cache for DB-sourced subject config (subject_name -> config dict)
_subject_config_cache = {}


def _get_subject_config(subject_name):
    """Get subject config from DB via tutors + curriculum chain.

    Returns a dict with keys: tutor_name, age_range, phases, subject_lower.
    Returns None if subject not found in DB.
    """
    if subject_name in _subject_config_cache:
        return _subject_config_cache[subject_name]
    try:
        row = database.get_subject_config(subject_name)
        if row and row.get("tutor_name"):
            phase_rows = database.fetchall(
                "SELECT phase FROM subject_curriculum sc JOIN subjects s ON sc.subject_id = s.id WHERE s.name = %s ORDER BY phase",
                (subject_name,)
            )
            cfg = {
                "tutor_name": row["tutor_name"],
                "age_range": row["default_age_range"],
                "phases": [r["phase"] for r in phase_rows] if phase_rows else [1],
                "subject_lower": subject_name.lower(),
                "fact_cycle": ["TEACH", "TRY"],
            }
            _subject_config_cache[subject_name] = cfg
            return cfg
    except Exception:
        pass
    return None


def _is_valid_subject(subject_name):
    """Check if a subject name is valid (DB only)."""
    if subject_name in _subject_config_cache:
        return True
    try:
        names = database.list_subject_names()
        if names:
            return subject_name in names
    except Exception:
        pass
    return False

# Goodbye detection: whole-word matching to avoid false positives
# e.g. "later" should not match "later" inside "eukaryotes came later with..."
_GOODBYE_PHRASES = ["goodbye", "good bye", "bye", "quit", "exit", "end session",
                     "i'm done", "im done", "gotta go", "see you", "later"]
_GOODBYE_PATTERN = re.compile(
    r'(?:^|\s)(' + '|'.join(re.escape(p) for p in _GOODBYE_PHRASES) + r')[.!?,;:\s]*$',
    re.IGNORECASE
)
app = FastAPI(
    title="ZingBee API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.exception_handler(HTTPException)
async def _http_exception_handler(request, exc):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

from starlette.middleware.base import BaseHTTPMiddleware

# ---------------------------------------------------------------------------
# Global auth middleware — gates EVERYTHING except an explicit allowlist
# ---------------------------------------------------------------------------
# Build allowlist from per-router PUBLIC_PATHS + the auth/session endpoints
# defined directly on `app`. This avoids cross-file string coupling — if a
# route is renamed in its source module, update PUBLIC_PATHS there.
from academy_routes import PUBLIC_PATHS as _ACADEMY_PUBLIC_PATHS

_AUTH_PUBLIC_PATHS: frozenset[str] = frozenset({
    "/api/login",
    "/api/logout",
    "/api/google-login",
    "/api/google-sso",
    "/api/health",
    "/api/image-proxy",
    *_ACADEMY_PUBLIC_PATHS,
})


class GlobalAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        # OPTIONS preflights are terminated by CORSMiddleware (which is
        # outermost) and never reach this layer. The branch below is a
        # defensive no-op for non-preflight OPTIONS only.
        if request.method == "OPTIONS":
            return await call_next(request)
        if request.url.path in _AUTH_PUBLIC_PATHS:
            return await call_next(request)
        if get_auth_user(request) is None:
            return JSONResponse({"error": "Not authenticated"}, status_code=401)
        return await call_next(request)


# Middleware registration order matters: Starlette runs middleware in REVERSE
# of registration (last registered = outermost = runs first).
# Desired execution order on a request: CORS → Auth → route.
# CORS must be OUTERMOST so its headers are added even when Auth short-circuits
# with 401 responses (otherwise browsers see CORS errors).
app.add_middleware(GlobalAuthMiddleware)

# TraceMiddleware: per-request trace_id + http.request_start/end events. Added
# AFTER auth so it runs OUTSIDE auth (last registered = outermost) and any
# auth failure still gets traced.
from trace_logging import TraceMiddleware
app.add_middleware(TraceMiddleware)

from fastapi.middleware.cors import CORSMiddleware

# In production we ONLY accept the explicit zingbee.ai origins. In dev we
# also accept any localhost / RFC1918 origin so engineers can hit prod from
# their machine. The `_COOKIE_DOMAIN` env var is set to ".zingbee.ai" only
# in the GCP deploy script — its presence is the production signal.
_IS_PRODUCTION = _COOKIE_DOMAIN is not None
_CORS_ORIGINS = [
    "https://zingbee.ai",
    "https://www.zingbee.ai",
    "https://api.zingbee.ai",
    "https://admin.zingbee.ai",
    "https://academy.zingbee.ai",
    "https://redteam.zingbee.ai",
    "https://livekit.zingbee.ai",
    # Non-production tiers set COOKIE_DOMAIN too, so _IS_PRODUCTION is True and
    # the localhost block below is skipped — add each non-prod frontend origin
    # here or its requests are CORS-blocked by the browser (the server returns
    # 200, but the browser discards the cross-origin response).
]
if not _IS_PRODUCTION:
    _CORS_ORIGINS += [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://localhost:6100",
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_origin_regex=(
        None if _IS_PRODUCTION
        else r"https?://(?:10\.0\.0\.\d+|192\.168\.\d+\.\d+|localhost|127\.0\.0\.1):\d+"
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

app.include_router(admin_router)
app.include_router(eval_router)
app.include_router(session_router)
app.include_router(curriculum_router)
app.include_router(student_router)
app.include_router(voice_router)
app.include_router(playground_router)
app.include_router(assessment_router)
app.include_router(academy_router)
app.include_router(quest_router)
app.include_router(eq_chat_router)
app.include_router(eq_projects_router)
app.include_router(eq_llmchat_router)
app.include_router(eq_voice_router)
app.include_router(image_eval_router)
app.include_router(distillation_router)
app.include_router(metaphor_eval_router)
app.include_router(reporting_router)
app.include_router(logs_router)


# Healthcheck for GCP load balancer / Caddy / Docker liveness probes.
# Must be in _AUTH_PUBLIC_PATHS or it gets 401'd by GlobalAuthMiddleware.
@app.get("/api/health")
async def health_check():
    return {"ok": True}


# ---------------------------------------------------------------------------
# AFK auto-end sweeper
# ---------------------------------------------------------------------------
# Background task that ends learning sessions where the student has been
# inactive (no new messages) for AFK_IDLE_MINUTES. Runs every
# AFK_SWEEP_INTERVAL_SECONDS. Activity is derived from the latest
# learning_session_messages.created_date so no schema column is needed.
AFK_IDLE_MINUTES = 10
AFK_SWEEP_INTERVAL_SECONDS = 60


async def _afk_sweep_once():
    try:
        idle = await asyncio.to_thread(database.get_idle_active_sessions, AFK_IDLE_MINUTES)
    except Exception as exc:
        logging.warning("AFK sweeper query failed: %s", exc)
        return
    for row in idle or []:
        session_id = str(row["id"])
        student_id = str(row["student_id"])
        # Prefer ending via in-memory cache so _save_progress / report-card
        # rollups run normally. Touch the underlying _cache directly —
        # sessions[student_id] would trigger a rehydrate, which is the wrong
        # thing here.
        cached = sessions._cache.get(student_id) if hasattr(sessions, "_cache") else None
        if cached is not None and getattr(cached, "is_active", False) and \
                str(getattr(cached, "session_db_id", "")) == session_id:
            try:
                await asyncio.to_thread(cached.end_session)
                sessions._cache.pop(student_id, None)
                logging.info("AFK sweeper ended cached session %s for student %s",
                             session_id, student_id)
                continue
            except Exception as exc:
                logging.warning("AFK sweeper cached end failed for %s: %s",
                                session_id, exc)
        try:
            await asyncio.to_thread(database.end_session_idle, session_id)
            logging.info("AFK sweeper ended DB-only session %s for student %s",
                         session_id, student_id)
        except Exception as exc:
            logging.warning("AFK sweeper DB end failed for %s: %s", session_id, exc)


async def _afk_sweeper_loop():
    while True:
        await asyncio.sleep(AFK_SWEEP_INTERVAL_SECONDS)
        await _afk_sweep_once()


@app.on_event("startup")
async def _start_afk_sweeper():
    asyncio.create_task(_afk_sweeper_loop())
    logging.info("AFK sweeper started (idle=%dm, interval=%ds)",
                 AFK_IDLE_MINUTES, AFK_SWEEP_INTERVAL_SECONDS)
    # A3: seed prompt_versions baselines so every per-turn template_hash joins to a known
    # version (idempotent). Run OFF the event loop — it's blocking psycopg2 and must not
    # stall request handling / readiness probes during startup.
    async def _seed_baselines():
        try:
            seeded = await asyncio.get_event_loop().run_in_executor(
                None, database.backfill_prompt_version_baselines)
            if seeded:
                logging.info("Prompt-version baselines seeded for %d new prompt(s)", seeded)
        except Exception:
            logging.getLogger(__name__).exception("prompt-version baseline backfill failed")
    asyncio.create_task(_seed_baselines())


# Image proxy used by the feedback-modal screenshot path. html2canvas / -pro
# can't draw cross-origin images into the canvas without CORS, and our GCS
# image bucket isn't CORS-tagged. The frontend rewrites each <img src> to
# `/api/image-proxy?url=…` for the duration of the capture so the bytes flow
# through this same-origin endpoint and tainting is avoided. SSRF is bounded
# by an allowlist of hosts we actually serve images from.
_IMAGE_PROXY_ALLOWED_HOSTS: frozenset[str] = frozenset({
    "storage.googleapis.com",
    "imgen.x.ai",
})


@app.get("/api/image-proxy")
async def image_proxy(url: str):
    from urllib.parse import urlparse
    from fastapi.responses import Response
    import httpx

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or (parsed.hostname or "") not in _IMAGE_PROXY_ALLOWED_HOSTS:
        return JSONResponse({"error": "host not allowed"}, status_code=400)
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url)
        if resp.status_code >= 400:
            return JSONResponse({"error": f"upstream {resp.status_code}"}, status_code=502)
        content_type = resp.headers.get("content-type", "image/jpeg")
        if not content_type.startswith("image/"):
            return JSONResponse({"error": "non-image upstream"}, status_code=415)
        return Response(content=resp.content, media_type=content_type, headers={"Cache-Control": "public, max-age=300"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/api/health/local-models")
async def health_local_models():
    """Check connectivity to local Ollama models on the DGX Spark."""
    import httpx
    from model_router import _is_enabled, _local_nemo_url, _local_gemma_url
    if not _is_enabled():
        return {"enabled": False, "models": {}}
    results = {}
    async with httpx.AsyncClient(timeout=5) as client:
        for name, url_fn in [("nemo", _local_nemo_url), ("gemma", _local_gemma_url)]:
            url = url_fn()
            if not url:
                results[name] = {"status": "not_configured"}
                continue
            try:
                resp = await client.get(f"{url}/models")
                data = resp.json()
                results[name] = {"status": "ok", "url": url, "models": data.get("data", [])}
            except Exception as e:
                results[name] = {"status": "unreachable", "url": url, "error": str(e)}
    return {"enabled": True, "models": results}


@app.get("/api/tutors")
async def list_tutors():
    """Return all tutors with persona details."""
    rows = database.fetchall("SELECT id, persona FROM tutors ORDER BY create_date")
    return [
        {
            "id": str(r["id"]),
            "name": r["persona"].get("tutor_name", "Tutor"),
            "description": r["persona"].get("persona_description", ""),
            "traits": r["persona"].get("persona_traits", []),
            "creator": r["persona"].get("creator_name", ""),
            "voice": r["persona"].get("voice", ""),
        }
        for r in rows
    ]



# Curriculum audit/builder/structure routes -> curriculum_routes.py


# Tutoring sessions: defined further down (TutoringSessionStore needs DB
# helpers loaded first). Initialized after the class definition.
sessions = None  # type: ignore[assignment]  # set to TutoringSessionStore() below

# Auth sessions: DB-backed dict-like store
# Supports dict operations (__contains__, __getitem__, __setitem__, __delitem__, .get)
# so existing code in route files works unchanged.
class DBSessionStore:
    """Dict-like wrapper around the auth_sessions DB table with in-memory cache."""
    def __init__(self):
        self._cache = {}

    def _load(self, token):
        if token in self._cache:
            info = self._cache[token]
            if datetime.now(tz=timezone.utc) > info["expires"]:
                self._cache.pop(token, None)
                database.delete_auth_session(token)
                return None
            return info
        info = database.load_auth_session(token)
        if info:
            self._cache[token] = info
        return info

    def __contains__(self, token):
        return self._load(token) is not None

    def __getitem__(self, token):
        info = self._load(token)
        if info is None:
            raise KeyError(token)
        return info

    def get(self, token, default=None):
        info = self._load(token)
        return info if info is not None else default

    def __setitem__(self, token, info):
        self._cache[token] = info
        database.save_auth_session(
            token, info["user_id"], info.get("student_id"),
            info.get("students", []), info.get("display_name"),
            info.get("email"), info["expires"],
        )

    def __delitem__(self, token):
        self._cache.pop(token, None)
        database.delete_auth_session(token)

class TutoringSessionStore:
    """Dict-like store of in-memory tutoring SessionState objects with a
    DB-backed rehydration path on cache miss.

    Reads (``__getitem__`` / ``__contains__`` / ``get``) lazily rebuild a
    SessionState from the most recent learning_sessions row for a given
    student when the in-memory cache is empty. This keeps long-lived chat
    tabs working across api container restarts and any other process churn.

    Writes (``__setitem__``) cache the active SessionState. Deletes
    (``__delitem__`` / ``clear``) only evict the cache — the underlying
    learning_sessions rows persist as the source of truth.
    """

    def __init__(self):
        self._cache: dict[str, "SessionState"] = {}

    def _rehydrate(self, student_id: str):
        # Imported lazily because SessionState is defined later in this file.
        sess = SessionState.try_restore_for_student(student_id)
        if sess is not None:
            self._cache[student_id] = sess
        return sess

    def __contains__(self, student_id: str) -> bool:
        if student_id in self._cache:
            return True
        return self._rehydrate(student_id) is not None

    def __getitem__(self, student_id: str) -> "SessionState":
        sess = self._cache.get(student_id)
        if sess is None:
            sess = self._rehydrate(student_id)
        if sess is None:
            raise KeyError(student_id)
        return sess

    def get(self, student_id: str, default=None):
        try:
            return self[student_id]
        except KeyError:
            return default

    def __setitem__(self, student_id: str, sess: "SessionState") -> None:
        self._cache[student_id] = sess

    def __delitem__(self, student_id: str) -> None:
        # Cache eviction only — the DB row remains the source of truth.
        self._cache.pop(student_id, None)

    def clear(self) -> None:
        self._cache.clear()


# Now that the class is defined, instantiate the module-level singleton.
sessions = TutoringSessionStore()

auth_sessions = DBSessionStore()
_admin_init_auth(auth_sessions)
_eval_init_auth(auth_sessions)
_session_init_auth(auth_sessions)
_image_eval_init_auth(auth_sessions)
_distillation_init_auth(auth_sessions)
_metaphor_eval_init_auth(auth_sessions)
_distillation_reset_zombies()
try:
    _reaped = database.reset_metaphor_eval_zombies()
    _reaped_locks = database.reap_stale_scope_dedup()
    if _reaped or _reaped_locks:
        logging.getLogger(__name__).info(
            "metaphor-eval startup: reaped %d zombie eval_runs row(s), %d stale dedup lock(s)",
            _reaped, _reaped_locks,
        )
except Exception:
    logging.getLogger(__name__).exception("metaphor-eval startup: failed to reap zombie runs / locks")
auth_module.init(auth_sessions)

# Auth helpers (canonical implementations in auth.py, local aliases for convenience)
get_auth_user = auth_module.get_auth_user
verify_student_ownership = auth_module.verify_student_ownership
require_auth = auth_module.require_auth
require_student_access = auth_module.require_student_access

# --- Background image downloader ---
IMAGE_SAVE_DIR = Path(PROJECT_ROOT) / "generated_media"
IMAGE_SAVE_DIR.mkdir(exist_ok=True)


def _persist_image(url: str, label: str = "image",
                   learning_session_message_id=None, session=None,
                   topic: str = "", description: str = "", style: str = "",
                   full_prompt: str = "", capsule_name: str = "", **_kwargs):
    """Persist an ephemeral image URL to GCS in a background thread.

    Replaces the remote URL with the permanent URL in the session's execution_log
    and messages. If session is provided, tracks the download so end_session can wait."""
    from tools.image_store import persist_image
    result = {"local_url": None}
    session_db_id = getattr(session, 'session_db_id', None) if session else None

    def _do_persist():
        try:
            permanent_url = persist_image(
                image_url=url, topic=topic, description=description,
                style=style, full_prompt=full_prompt, capsule_name=capsule_name,
                learning_session_message_id=learning_session_message_id,
            )
            result["local_url"] = permanent_url
            if session_db_id and permanent_url != url:
                try:
                    database.replace_image_url_in_session(session_db_id, url, permanent_url)
                    # Patch the in-memory execution_log so subsequent flushes don't
                    # overwrite the DB-level REPLACE with the now-stale xAI URL.
                    if session is not None and hasattr(session, '_log_lock'):
                        with session._log_lock:
                            log_json = json.dumps(session.execution_log)
                            if url in log_json:
                                session.execution_log = json.loads(log_json.replace(url, permanent_url))
                    print(f"[ImagePersist] DB+memory updated: session {session_db_id}, {url} -> {permanent_url}")
                except Exception as db_err:
                    print(f"[ImagePersist] DB update failed for session {session_db_id}: {db_err}")
        except Exception as e:
            print(f"[ImagePersist] Failed to persist {label}: {e}")

    thread = threading.Thread(target=_do_persist, daemon=True)
    thread.start()
    if session is not None:
        session._pending_downloads.append((thread, url, result))


def _generate_image(tutor_message: str, session, trigger: str = "tutor_response", log_fn=None, image_prompt: str = None):
    """Single entry point for all image generation.

    If image_prompt is provided (extracted from <EDUCATIONAL_IMAGE> tags),
    it is sent directly to Grok Imagine. Otherwise, falls back to using
    the tutor message as the prompt.

    Args:
        tutor_message: The tutor text (used as fallback prompt if no image_prompt).
        session: The SessionState.
        trigger: Label for the log ("greeting", "tutor_response", "voice").
        log_fn: Optional logging function(step, details).
        image_prompt: The exact Grok Imagine prompt from <EDUCATIONAL_IMAGE> tags.

    Returns:
        (image_url, image_result_dict) or (None, None).
    """
    def _log(step, details):
        if log_fn:
            log_fn(step, details)
        else:
            session.log_execution(step, details, agent="MediaCurator")

    if not XAI_API_KEY:
        _log("IMAGE_SKIP", {"reason": "No XAI_API_KEY configured"})
        return None, None

    # Use the LLM-written prompt if available; build a topic-based fallback
    # instead of sending the entire tutor message (conversational text makes bad image prompts)
    if image_prompt:
        prompt = image_prompt
    else:
        ctx = session.get_image_context() if hasattr(session, 'get_image_context') else {}
        capsule = ctx.get("capsule") or getattr(session, 'capsule_name', '') or ""
        age = ctx.get("age_range") or getattr(session, 'phase_age_range', '') or "6-12"
        theme = ctx.get("theme") or ""
        topic_parts = [p for p in [capsule, theme] if p]
        topic = " - ".join(topic_parts) if topic_parts else "science"
        prompt = (
            f"A detailed, engaging educational illustration about {topic}, "
            f"designed for students aged {age}. "
            "Modern digital illustration style with realistic lighting and naturalistic proportions. "
            "Rich detail, warm color palette. No speech bubbles, no text boxes. Single unified scene."
        )

    # Read image model from session's decision tree config, fallback to default
    img_model_cfg = getattr(session, '_decision_tree', {}).get("config", {}).get("llm_roles", {}).get("image_generator", {}).get("model", None)

    _log("IMAGE_REQUEST", {
        "trigger": trigger,
        "imagine_prompt": prompt,
        "has_educational_image_tag": bool(image_prompt),
        "model": img_model_cfg or "grok-imagine-image-quality",
        "aspect_ratio": "16:9",
    })
    try:
        result = json.loads(generate_from_prompt(image_prompt=prompt, model=img_model_cfg))
        img_model = result.get("model", "grok-imagine-image-quality")
        result["cost_usd"] = IMAGE_COST.get(img_model, IMAGE_COST_PER_CALL) if result.get("success") else 0
        _log("IMAGE_GENERATE_RESULT", result)
        if result.get("success"):
            return result.get("image_url"), result
    except Exception as e:
        _log("IMAGE_GENERATION_ERROR", {"error": str(e)})
    return None, None



# Helper functions -> helpers.py



class ChatRequest(BaseModel):
    message: str
    student_id: str = "student_001"
    subject: str = "Biology"
    greeting: bool = False
    tutor_id: str | None = None


class SessionState:
    def __init__(
        self,
        student_id: str,
        subject: str = "Biology",
        tutor_id: str | None = None,
        *,
        _restore_session_id: str | None = None,
    ):
        # When _restore_session_id is set, we rebuild a SessionState that
        # resumes an existing learning_sessions row instead of creating a new
        # one. The constructor still loads progress / capsule / decision tree
        # / persona / prompt engine fresh from the DB (those are stateless),
        # then near the end overrides messages, execution_log, system_log,
        # stats, start_time, and is_active from the row + its messages so the
        # session is functionally identical to before the API process was
        # restarted. xAI Responses-API server-side state cannot be restored,
        # so last_response_id is reset and the next turn falls back to the
        # full-message-list path.
        self._restore_session_id = _restore_session_id
        # Initialized here so _save_progress() (called transitively from
        # _build_system_prompt below) doesn't AttributeError before the
        # restore/create branch later in __init__ assigns the real value.
        self.session_db_id = None
        self.student_id = student_id
        self.subject = subject
        self.subject_config = _get_subject_config(subject)
        self.tutor_name = self.subject_config["tutor_name"]
        self.subject_lower = self.subject_config["subject_lower"]
        self.fact_cycle = self.subject_config.get("fact_cycle") or ["TEACH", "TRY"]
        self.messages = []
        self.execution_log = []
        self._log_lock = threading.Lock()
        self.question_count = 0
        self.correct_count = 0
        self.total_tokens = 0
        self.start_time = datetime.now()
        self.end_time = None
        self.is_active = True
        self.image_url = None
        self.image_topics = []  # Track image topics shown this session
        self._pending_downloads = []  # [(thread, old_url, result_dict), ...]
        self.session_taught_facts = set()  # Track facts taught this session
        self.next_capsule_name = None
        self.curriculum_complete = False
        self.capsule_advanced = False
        self._capsule_just_switched = False
        self._switched_from_capsule = None
        self._start_prompt_id = None  # session-start prompt for A3 attribution of the opening turn
        self._capsules_covered = []  # Track all capsules taught this session
        self._pending_interactions = []  # Accumulated interactions flushed on save
        self.system_log = []  # Full system-level log (transitions, LLM requests, messages sent)
        self._last_interaction_idx = -1  # Index of last interaction for message_id appending
        self._step_transitioned_this_turn = False
        self._step_transition_from = None
        self._step_transition_to = None

        # xAI stateful conversation tracking (Responses API)
        self.last_response_id = None      # ID of last xAI response for server-side context
        self._messages_synced_idx = 0     # How many messages the xAI server already knows

        # Tutor override: if caller selected a specific tutor, use it;
        # otherwise the curriculum_theme default is used (resolved later).
        self._tutor_id_override = tutor_id
        self._tutor_id = None

        # v6: Load tutor persona + state machine from DB via query chain
        # The old agents table is gone. Persona comes from tutors.persona,
        # instructions from learning_system_schemas.descision_tree.
        # v6 context loaded after capsule is determined (see post-capsule block below)
        self._decision_tree = {}
        self._persona = {}
        self._prompt_engine = None

        # LLM config: prefer v6 decision_tree config, fall back to defaults
        _llm_cfg = self._decision_tree.get("config", {}).get("llm_roles", {})
        _tutor_cfg = _llm_cfg.get("tutor", {})
        _assessor_cfg = _llm_cfg.get("full_assessor", {})
        self.xai_model = _tutor_cfg.get("model") or _DEFAULT_MODEL
        self.xai_fast_model = _DEFAULT_FAST_MODEL
        self.xai_assessment_model = _assessor_cfg.get("model") or _DEFAULT_MODEL
        self.max_tokens = _tutor_cfg.get("max_tokens") or _DEFAULT_MAX_TOKENS

        # Prompt templates: prefer v6 prompt_engine, fall back to legacy
        self._tutor_templates = {}
        self._assessor_templates = {}
        self._load_prompt_templates()

        # Log session initialization first
        self.log_execution("SESSION_START", {
            "student_id": student_id,
            "subject": subject,
            "tutor": self.tutor_name,
            "phase": "initialization"
        }, agent="SessionManager")

        self.log_execution("PRICING_SNAPSHOT", {
            "model_rates": MODEL_RATES,
            "image_cost": IMAGE_COST_PER_CALL,
        }, agent="System")

        # Load student progress
        self.log_execution("LOAD_PROGRESS", {
            "student_id": student_id
        }, agent="SessionManager")

        self.progress = json.loads(get_student_progress(student_id, subject))
        self.capsule_name = self.progress['current_position']['capsule_name']

        self.log_execution("PROGRESS_LOADED", {
            "capsule": self.capsule_name,
            "step": self.progress['current_position']['step_name']
        }, agent="SessionManager")

        # Load curriculum
        self.log_execution("LOAD_CURRICULUM", {
            "capsule": self.capsule_name,
            "lookup_function": "get_capsule_by_name (searches all phase files)"
        }, agent="SessionManager")

        self.capsule = json.loads(get_capsule_by_name(self.capsule_name))
        capsule_phase = self.capsule.get("phase", self.progress["current_position"].get("phase", 1))

        # Phase-specific age range from curriculum (e.g., Math Phase 3 = "15-17")
        self.phase_age_range = self.capsule.get("age_range") or self.subject_config["age_range"]
        self.phase = capsule_phase

        # Store fact ID map and capsule DB id for DB writes
        self._fact_id_map = self.capsule.get("_fact_id_map", {})
        self._capsule_db_id = self.capsule.get("db_id")

        self.log_execution("CURRICULUM_LOADED", {
            "phase": capsule_phase,
            "age_range": self.phase_age_range,
            "source": "database",
            "theme": self.capsule.get("theme_name", ""),
            "capsule": self.capsule_name,
            "facts_count": len(self.capsule.get("core_facts", [])),
            "vocab_count": len(self.capsule.get("vocabulary", [])),
            "core_facts": self.capsule.get("core_facts", [])
        }, agent="SessionManager")

        # v6: NOW load the context (capsule_db_id is set)
        if self._capsule_db_id and not self._prompt_engine:
            try:
                from prompt_engine import PromptEngine
                ctx = database.get_session_context(self._capsule_db_id)
                if ctx:
                    # Resolve tutor: use override if provided, else theme default
                    if self._tutor_id_override:
                        override_persona = database.get_tutor_persona(self._tutor_id_override)
                        if override_persona is not None:
                            ctx["persona"] = override_persona
                            ctx["tutor_id"] = self._tutor_id_override
                        else:
                            logging.warning("tutor_id override %s not found, using theme default",
                                            self._tutor_id_override)
                    self._tutor_id = ctx.get("tutor_id")
                    self._decision_tree = ctx.get("decision_tree", {})
                    self._persona = ctx.get("persona", {})
                    curriculum = {
                        "subject": ctx.get("subject_name", self.subject),
                        "subject_lower": ctx.get("subject_name", self.subject).lower(),
                        "age_range": ctx.get("age_range", self.phase_age_range),
                        "phase": ctx.get("phase", self.phase),
                        "capsule_name": ctx.get("capsule_name", self.capsule_name),
                    }
                    self._prompt_engine = PromptEngine(self._decision_tree, self._persona, curriculum)
                    self._load_prompt_templates()
                    # Update LLM config from decision tree
                    _llm_cfg = self._decision_tree.get("config", {}).get("llm_roles", {})
                    if _llm_cfg.get("tutor", {}).get("model"):
                        self.xai_model = _llm_cfg["tutor"]["model"]
                    if _llm_cfg.get("tutor", {}).get("max_tokens"):
                        self.max_tokens = _llm_cfg["tutor"]["max_tokens"]
                    if _llm_cfg.get("full_assessor", {}).get("model"):
                        self.xai_assessment_model = _llm_cfg["full_assessor"]["model"]
                    # Update tutor_name from persona
                    if self._persona.get("tutor_name"):
                        self.tutor_name = self._persona["tutor_name"]
                    self.log_execution("V6_CONTEXT_LOADED", {
                        "prompts_loaded": len(_prompts),
                        "persona_tutor": self._persona.get("tutor_name", "unknown"),
                        "decision_tree_version": self._decision_tree.get("version", "unknown"),
                    }, agent="Orchestrator")
            except Exception as e:
                logging.warning("v6 context load (post-capsule) failed: %s", e)

        # v6: Initialize SessionEngine (clean rewrite of state machine)
        self._session_engine = None
        if self._prompt_engine and self._capsule_db_id:
            try:
                from session_engine import SessionEngine, StateMachineContractError
                facts = database.get_capsule_facts(self._capsule_db_id)
                if facts:
                    curriculum = {
                        "subject": self.subject,
                        "subject_lower": self.subject_lower,
                        "age_range": self.phase_age_range,
                        "phase": self.phase,
                        "capsule_name": self.capsule_name,
                    }
                    self._session_engine = SessionEngine(
                        self._decision_tree, self._persona, curriculum)
                    self._session_engine.init_session(
                        facts, student_id=student_id,
                        capsule_id=str(self._capsule_db_id))
                    self.log_execution("V6_SESSION_ENGINE_INIT", {
                        "facts": len(facts),
                        "batches": len(self._session_engine._batches),
                    }, agent="Orchestrator")
                    logging.info("[v6] SessionEngine: %d facts, %d batches",
                                len(facts), len(self._session_engine._batches))
            except StateMachineContractError:
                # Load-bearing guardrail (ADO-87): a drifted state-machine contract
                # must NOT silently degrade to the legacy path. Fail closed —
                # refuse to start the session so a mismatch can't reach a student.
                logging.error("[v6] state-machine contract drift — refusing to "
                              "start session")
                raise
            except Exception as e:
                logging.warning("[v6] SessionEngine init failed: %s", e)

        # v6: Try to resume from saved engine state before resetting
        self._v6_resumed = False
        if self._session_engine and self._capsule_db_id:
            try:
                rc = database.get_report_card(student_id)
                cap = database.get_capsule_from_report_card(rc, self._capsule_db_id)
                if cap and cap.get("v6_engine_state") and cap.get("status") != "completed":
                    self._session_engine.restore(cap["v6_engine_state"])
                    self._v6_resumed = True
                    self.log_execution("V6_SESSION_RESUMED", {
                        "phase": self._session_engine.current_phase,
                        "fact": self._session_engine.current_fact_text,
                        "batch": self._session_engine.state.get("current_batch_index", 0),
                        "message_count": self._session_engine.state.get("message_count", 0),
                    }, agent="Orchestrator")
            except Exception as e:
                logging.warning("v6 session resume failed: %s", e)

        # Only reset if capsule was previously completed (all facts mastered).
        # In-progress capsules keep their progress across sessions.
        if not self._v6_resumed:
            kp = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
            total = kp.get("total_facts", 0)
            mastered = len(kp.get("facts_mastered", []))
            if total > 0 and mastered >= total:
                self._reset_current_capsule_in_report_card()

        # v006.11: honor an explicit fact selection from the start-session
        # screen (report_card.current_position.fact_id, written by
        # /api/academy/start-capsule). The engine refuses completed/unknown
        # facts, so a stale selection falls back to the healed position.
        if self._session_engine and self._session_engine.state:
            try:
                _rc_pos = (database.get_report_card(student_id) or {}).get(
                    "current_position", {}) or {}
                if (_rc_pos.get("fact_id")
                        and str(_rc_pos.get("capsule_id")) == str(self._capsule_db_id)):
                    if self._session_engine.start_at_fact(str(_rc_pos["fact_id"])):
                        self.log_execution("V6_START_AT_SELECTED_FACT", {
                            "fact_id": str(_rc_pos["fact_id"]),
                            "fact": self._session_engine.current_fact_text,
                        }, agent="Orchestrator")
            except Exception as e:
                logging.warning("start-at-selected-fact failed: %s", e)

        # Create or restore DB session record (with resolved tutor_id)
        user = database.get_default_user()
        self._user_id = user["id"] if user else 1
        resolved_tutor_id = self._tutor_id or self._tutor_id_override

        # Build system prompt and seed self.messages with it. Done before the
        # restore branch so both paths start with the system prompt as msg[0].
        self.system_prompt = self._build_system_prompt()
        self.messages.append({"role": "system", "content": self.system_prompt})

        if self._restore_session_id:
            # Restoration: pull the existing row and its messages, override
            # the in-memory state to match. The system prompt above is kept
            # as msg[0] (it's regenerated each session anyway based on
            # current student/capsule state), then we append the persisted
            # user/assistant turns.
            self.session_db_id = self._restore_session_id
            row = database.get_latest_session_for_student(student_id) or {}
            if str(row.get("id", "")) != str(self._restore_session_id):
                # Defensive: fall through to a fresh session if the latest
                # row drifted (e.g. another process created a newer one).
                row = {}

            if row:
                self.execution_log = list(row.get("execution_log") or [])
                self.system_log = list(row.get("system_log") or [])
                self.question_count = row.get("questions_asked") or 0
                self.correct_count = row.get("correct_answers") or 0
                self.total_tokens = row.get("total_tokens") or 0
                # Postgres TIMESTAMPTZ columns return tz-aware datetimes,
                # but the rest of this class uses naive datetime.now() for
                # start/end_time. Normalize to naive UTC so duration math
                # in get_session_duration() doesn't raise.
                _row_start = row.get("start_time")
                if _row_start is not None:
                    if _row_start.tzinfo is not None:
                        _row_start = _row_start.astimezone(timezone.utc).replace(tzinfo=None)
                    self.start_time = _row_start
                _row_end = row.get("end_time")
                if _row_end is not None and _row_end.tzinfo is not None:
                    _row_end = _row_end.astimezone(timezone.utc).replace(tzinfo=None)
                self.end_time = _row_end
                self.is_active = self.end_time is None
                # xAI Responses API server-side state is gone — force the
                # next turn to send the full message list.
                self.last_response_id = None
                self._messages_synced_idx = 0

                msg_rows = database.get_session_messages_by_session_id(self._restore_session_id) or []
                for r in msg_rows:
                    role = r.get("role")
                    if role in ("user", "assistant"):
                        self.messages.append({"role": role, "content": r.get("content") or ""})
                self._messages_synced_idx = len(self.messages)

                self.log_execution("SESSION_RESTORED", {
                    "session_id": str(self.session_db_id),
                    "messages_loaded": len(msg_rows),
                    "is_active": self.is_active,
                }, agent="SessionManager")
            else:
                # Couldn't find the row — degrade to a fresh session record.
                session_row = database.create_session(self._user_id, student_id, self._capsule_db_id,
                                                      tutor_id=resolved_tutor_id)
                self.session_db_id = session_row["id"] if session_row else None
                self._restore_session_id = None
        else:
            session_row = database.create_session(self._user_id, student_id, self._capsule_db_id,
                                                  tutor_id=resolved_tutor_id)
            self.session_db_id = session_row["id"] if session_row else None

    @classmethod
    def try_restore_for_student(cls, student_id: str) -> "SessionState | None":
        """Rebuild a SessionState from the latest learning_sessions row for a
        student, or None if there are no rows yet. The returned object's
        ``is_active`` reflects whether the original session ended."""
        row = database.get_latest_session_for_student(student_id)
        if not row:
            return None
        # Resolve subject from the capsule's curriculum chain. If we can't
        # determine it, bail — silently defaulting would dump a student into
        # the wrong subject mid-session, which is worse than no rehydration.
        capsule_id = row.get("curriculum_capsule_id")
        if not capsule_id:
            logging.warning(
                "SessionState rehydrate skipped: session %s has no curriculum_capsule_id",
                row.get("id"))
            return None
        ctx = database.get_session_context(capsule_id)
        subject_name = (ctx or {}).get("subject_name")
        if not subject_name:
            logging.warning(
                "SessionState rehydrate skipped: capsule %s has no resolvable subject",
                capsule_id)
            return None
        try:
            return cls(
                student_id=student_id,
                subject=subject_name,
                tutor_id=row.get("tutor_id"),
                _restore_session_id=str(row["id"]),
            )
        except Exception as exc:
            logging.warning("SessionState.try_restore_for_student failed: %s", exc)
            return None

    def _build_system_prompt(self):
        core_facts = self.capsule.get("core_facts", [])

        # Check if returning student - has prior sessions, interactions, or taught facts
        interactions = self.progress.get("interactions", [])
        session_history = self.progress.get("session_history", [])
        kp_check = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
        has_taught_facts = len(kp_check.get("facts_taught", [])) > 0
        step_says_recall = self.progress.get("current_position", {}).get("step_name") == "RECALL"
        is_returning = len(session_history) > 0 or len(interactions) > 0 or has_taught_facts or step_says_recall

        # Get student name
        student_name = self.progress.get("name", "friend")

        # Determine which facts are already taught vs what comes next
        kp = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
        facts_taught = kp.get("facts_taught", [])
        facts_mastered = kp.get("facts_mastered", [])

        # Split facts into: already covered vs upcoming
        taught_set = set(facts_taught)
        already_covered = [f for f in core_facts if f in taught_set]
        not_yet_taught = [f for f in core_facts if f not in taught_set]

        # v006.11: when the v6 engine is live in teaching mode, IT is the
        # source of truth for what remains. kp facts_taught misses skipped
        # facts and can diverge from the engine's position — that split brain
        # had the greeting teach a different fact than the engine was grading
        # (out-of-order teaching).
        _sm = getattr(self, "_session_engine", None)
        if (_sm and _sm.state and getattr(_sm, "_facts", None)
                and _sm.current_phase in ("TEACH", "TRY")
                and not _sm.state.get("evidence_phase")):
            _remaining = set(_sm.remaining_fact_texts())
            not_yet_taught = [f for f in core_facts if f in _remaining]
            already_covered = [f for f in core_facts if f not in _remaining]

        # One fact per session (v006.11): the session teaches the first
        # remaining fact and the engine ends the session after its practice.
        next_facts = not_yet_taught
        remaining_after = []

        # Build fact sections for the prompt
        if already_covered:
            covered_text = "\n".join([f"- {fact}" for fact in already_covered])
            covered_section = f"""FACTS ALREADY TAUGHT (do NOT re-teach these, only reference briefly during recall):
{covered_text}"""
        else:
            covered_section = "FACTS ALREADY TAUGHT: None yet - this is the first session on this capsule."

        if next_facts:
            fact_enrichment = self.capsule.get("_fact_enrichment", {})
            current_fact = next_facts[0]
            next_lines = [f">>> TEACH THIS FACT NOW: {current_fact}"]
            enrich_lines = _build_enrichment_lines(self.capsule, current_fact)
            next_lines.extend(enrich_lines)
            next_text = "\n".join(next_lines)
            remaining = len(next_facts) - 1
            remaining_note = (
                f"\n(This session covers ONLY this fact — the system wraps up the "
                f"session after its practice. {remaining} more facts remain for "
                f"future sessions.)" if remaining > 0 else "")
            next_section = f"""CURRENT FACT TO TEACH:
{next_text}{remaining_note}"""
        else:
            next_section = """ALL FACTS ASSESSED - proceed to EVIDENCE assessment.
The system will present one fact at a time with its evidence question.
Ask the student to demonstrate understanding of the current fact.
Wait for their response. The system manages fact progression automatically."""

        remaining_section = ""

        # Returning students: RECALL first, then TEACH
        # New students: straight to TEACH
        # v006.10: a capsule whose practice is complete ends its session with
        # the engine primed at EVIDENCE; the follow-up session (this one) must
        # open IN the final check, not in RECALL — otherwise the greeting asks
        # recap questions while the engine grades the reply as evidence.
        _render = database.render_prompt
        _engine = getattr(self, "_session_engine", None)
        if (getattr(self, "_v6_resumed", False) and _engine
                and _engine.current_phase == "EVIDENCE"
                and _engine.state.get("evidence_phase") == "COLLECT"):
            start_step = "EVIDENCE"
            self._start_prompt_id = "start_evidence_session"
            start_instruction = _render(
                self._tutor_templates.get("start_evidence_session", ""),
                {"student_name": student_name})
            if not start_instruction:
                start_instruction = (
                    f"{student_name} is back to finish this capsule! All the learning and "
                    "practice is already done. Warmly welcome them back and tell them today "
                    "they get to show what they've learned in one final check — keep it brief "
                    "and encouraging, then ask the first check question as instructed below.")
            # The engine's own evidence step prompt targets the fact at the head
            # of the restored evidence queue, so question and grading line up.
            _evidence_prompt = _engine.render_prompt("step_evidence")
            if _evidence_prompt:
                start_instruction = start_instruction + "\n\n" + _evidence_prompt

        elif is_returning and already_covered and next_facts:
            start_step = "RECALL"
            first_new_fact = next_facts[0]
            recall_facts = already_covered[-3:]
            recall_list = "\n".join([f'- "{fact}"' for fact in recall_facts])
            self._start_prompt_id = "start_returning_recall_teach"
            start_instruction = _render(
                self._tutor_templates.get("start_returning_recall_teach", ""),
                {"student_name": student_name, "recall_list": recall_list, "first_new_fact": first_new_fact})

        elif is_returning and already_covered and not next_facts:
            start_step = "RECALL"
            recall_facts = already_covered[-3:]
            recall_list = "\n".join([f'- "{fact}"' for fact in recall_facts])
            self._start_prompt_id = "start_returning_all_done"
            start_instruction = _render(
                self._tutor_templates.get("start_returning_all_done", ""),
                {"student_name": student_name, "recall_list": recall_list})

        elif is_returning and not already_covered and next_facts:
            start_step = "TEACH"
            # v6: include fact enrichment fields for first fact
            first_fact_vars = {"student_name": student_name, "first_fact": next_facts[0]}
            fact_enrichment = self.capsule.get("_fact_enrichment", {})
            first_meta = fact_enrichment.get(next_facts[0], {})
            for field in ("process", "vocabulary", "misconception"):
                if field in first_meta:
                    first_fact_vars[f"first_{field}"] = first_meta[field]
            self._start_prompt_id = "start_returning_no_taught"
            start_instruction = _render(
                self._tutor_templates.get("start_returning_no_taught", ""),
                first_fact_vars)

        elif next_facts:
            start_step = "TEACH"
            # v6: include fact enrichment fields for first fact
            first_fact_vars = {"student_name": student_name, "tutor_name": self.tutor_name,
                               "subject": self.subject, "first_fact": next_facts[0]}
            fact_enrichment = self.capsule.get("_fact_enrichment", {})
            first_meta = fact_enrichment.get(next_facts[0], {})
            for field in ("process", "vocabulary", "misconception"):
                if field in first_meta:
                    first_fact_vars[f"first_{field}"] = first_meta[field]
            self._start_prompt_id = "start_new_student"
            start_instruction = _render(
                self._tutor_templates.get("start_new_student", ""),
                first_fact_vars)

        else:
            start_step = "RECALL"
            self._start_prompt_id = "start_all_complete"
            start_instruction = _render(
                self._tutor_templates.get("start_all_complete", ""), {})

        self.start_step = start_step

        # Update current step and fact in progress
        if start_step == "RECALL":
            self.progress["current_position"]["step"] = 1
            self.progress["current_position"]["step_name"] = "RECALL"
            # Keep the ENGINE in step with the recall greeting: the first
            # student reply must route through _process_recall (-> TEACH),
            # not be graded as a TEACH/TRY turn for a question the greeting
            # never asked. Only in teaching mode — the all-facts-done RECALL
            # greetings sit on an EVIDENCE-primed engine and stay untouched.
            _eng = getattr(self, "_session_engine", None)
            if (_eng and _eng.state
                    and _eng.current_phase in ("TEACH", "TRY")
                    and not _eng.state.get("evidence_phase")):
                _eng.state["current_phase"] = "RECALL"
                _eng.state["recall_turns"] = 0
        elif start_step == "EVIDENCE":
            self.progress["current_position"]["step"] = 5
            self.progress["current_position"]["step_name"] = "EVIDENCE"
        else:
            self.progress["current_position"]["step"] = 2
            self.progress["current_position"]["step_name"] = "TEACH"
        if self.capsule_name not in self.progress.get("knowledge_points", {}):
            self.progress["knowledge_points"] = self.progress.get("knowledge_points", {})
            batches = self._compute_batches(core_facts)
            self.progress["knowledge_points"][self.capsule_name] = self._make_knowledge_points(core_facts, batches)
        capsule_kp = self.progress["knowledge_points"][self.capsule_name]
        # Backward compat: rename batch_phase → batch_step for old session data
        if "batch_phase" in capsule_kp and "batch_step" not in capsule_kp:
            capsule_kp["batch_step"] = capsule_kp.pop("batch_phase")
        # Ensure batch fields exist
        if "batches" not in capsule_kp:
            capsule_kp["batches"] = self._compute_batches(core_facts)
            capsule_kp.setdefault("batch_index", 0)
            capsule_kp.setdefault("batch_step", "TEACH_TRY")
            capsule_kp.setdefault("check_queue", [])
            capsule_kp.setdefault("check_failures", [])
        # Set current_fact: respect batch_step — if CHECK, use the check_queue head
        if capsule_kp.get("batch_step") == "CHECK" and capsule_kp.get("check_queue"):
            capsule_kp["current_fact"] = capsule_kp["check_queue"][0]
            capsule_kp["current_fact_index"] = core_facts.index(capsule_kp["check_queue"][0]) + 1
        else:
            capsule_kp["current_fact"] = next_facts[0] if next_facts else None
            capsule_kp["current_fact_index"] = (core_facts.index(next_facts[0]) + 1) if next_facts else len(core_facts)
        self._save_progress()

        age_range = self.phase_age_range

        system_tmpl = self._tutor_templates.get("system_prompt")
        if not system_tmpl:
            logging.error("system_prompt template missing for %s — using minimal fallback", self.subject)
            system_tmpl = "You are $tutor_name, a $subject tutor. Teach the student about $capsule_name."

        # v6: include persona variables from tutors.persona
        persona = getattr(self, '_persona', {})
        traits = persona.get("persona_traits", "")
        if isinstance(traits, list):
            traits = "\n".join(f"- {t}" for t in traits)

        base_prompt = _render(system_tmpl, {
            "tutor_name": self.tutor_name,
            "creator_name": persona.get("creator_name", "ZingBee and Academy"),
            "persona_description": persona.get("persona_description", "a helpful"),
            "persona_traits": traits,
            "subject": self.subject,
            "age_range": age_range,
            "phase": str(self.phase),
            "subject_lower": self.subject_lower,
            "capsule_name": self.capsule_name,
            "covered_section": covered_section,
            "next_section": next_section,
            "remaining_section": remaining_section,
            "start_step": start_step,
            "start_instruction": start_instruction,
        })

        # Per-fact vocabulary and enrichment is injected via transition messages,
        # not the system prompt.  Capsule-level vocab/misconceptions removed to
        # keep the system prompt focused on the current fact only.
        enrichment_sections = ""

        # Image generation uses the <EDUCATIONAL_IMAGE> prompt from the tutor's response.
        # The LLM writes the Grok Imagine prompt directly inside these tags.

        return base_prompt + enrichment_sections

    def _get_last_assistant_message(self) -> str:
        """Return content of most recent assistant message, or empty string."""
        return next((m["content"] for m in reversed(self.messages) if m["role"] == "assistant"), "")

    def _append_user_message(self, text: str) -> None:
        """Append user message to conversation and persist to DB."""
        try:
            from trace_logging import event as _ev, set_user_context
            set_user_context(student_id=self.student_id, session_db_id=str(self.session_db_id) if self.session_db_id else None)
            _ev("session.message.user",
                length=len(text or ""), preview=(text or "")[:300],
                phase=self.progress.get("current_position", {}).get("step_name") if hasattr(self, "progress") else None,
                capsule_name=getattr(self, "capsule_name", None))
        except Exception:
            pass
        self.messages.append({"role": "user", "content": text})
        self._last_user_msg_id = None
        self._last_interaction_id = None
        if self.session_db_id:
            try:
                self._last_user_msg_id = database.save_learning_session_message(self.session_db_id, "user", text)
            except Exception as e:
                logging.warning("DB save user message failed: %s", e)

    def _current_prompt_attribution(self):
        """(prompt_id, template_hash) of the step prompt governing this turn — A3 attribution.

        template_hash matches prompt_versions.content_hash, so the message/turn joins to the
        exact prompt version that produced it. Returns (None, None) when there's no engine or
        no step prompt has rendered yet.
        """
        eng = getattr(self, "_session_engine", None)
        last_step = getattr(eng, "last_rendered_prompt_id", None) if eng else None
        start_pid = getattr(self, "_start_prompt_id", None)
        # The OPENING turn (no assistant message saved yet) is driven by the start_*
        # template that built the system prompt — prefer it even though the engine may
        # have pre-rendered the next step prompt for the following turn.
        if not getattr(self, "_last_assistant_msg_id", None) and start_pid:
            pid = start_pid
        elif getattr(self, "_step_transitioned_this_turn", False) and last_step:
            # A fresh step prompt rendered THIS turn — attribute the turn to it.
            pid = last_step
        else:
            # Stay-in-phase turn: no fresh step template drove this output (the LLM continued
            # from the existing system prompt + history). Don't inflate the last step prompt's
            # monitoring stats — bucket as a sentinel with no version join.
            return "(stay_in_phase)", None
        if not pid:
            return None, None
        # Source the template from the engine's prompt_registry (canonical, matches
        # prompt_versions), falling back to _tutor_templates if the engine isn't built yet.
        tmpl = (eng.prompts.get(pid, {}) or {}).get("template", "") if eng else ""
        if not tmpl:
            tmpl = self._tutor_templates.get(pid, "") if isinstance(getattr(self, "_tutor_templates", None), dict) else ""
        return pid, database.hash_prompt_template(tmpl)

    def _save_assistant_message(self, raw_text: str) -> Optional[str]:
        """Save assistant message to DB and link to pending interaction. Returns message ID or None."""
        try:
            from trace_logging import event as _ev
            _ev("session.message.assistant",
                length=len(raw_text or ""), is_empty=(len(raw_text or "") == 0),
                preview=(raw_text or "")[:300],
                phase=self.progress.get("current_position", {}).get("step_name") if hasattr(self, "progress") else None,
                capsule_name=getattr(self, "capsule_name", None),
                session_db_id=str(self.session_db_id) if self.session_db_id else None)
        except Exception:
            pass
        if not self.session_db_id:
            return None
        try:
            _pid, _thash = self._current_prompt_attribution()
            msg_id = database.save_learning_session_message(
                self.session_db_id, "assistant", raw_text,
                prompt_id=_pid, template_hash=_thash, model=getattr(self, "xai_model", None))
            if msg_id:
                self._last_assistant_msg_id = msg_id
                if hasattr(self, '_last_interaction_idx') and self._last_interaction_idx is not None:
                    pending = getattr(self, '_pending_interactions', [])
                    if self._last_interaction_idx < len(pending):
                        pending[self._last_interaction_idx]["message_ids"].append(msg_id)
            return msg_id
        except Exception as e:
            logging.warning("DB save assistant message failed: %s", e)
            return None

    def _run_assessment(self, prev_tutor_msg: str, user_message: str,
                        forced_interaction_type: str = None) -> dict:
        """Run comprehension assessment, log results, apply compliance corrections, update counters.

        forced_interaction_type (ADO #26): set when the student clicked an
        engagement chip — the interaction type is known deterministically, but
        the assessor LLM still runs for compliance flags on the previous turn.
        """
        assessment = {}
        try:
            assessment = self.check_student_comprehension(
                prev_tutor_msg, user_message,
                forced_interaction_type=forced_interaction_type)
            self.system_log.append({
                "event": "ASSESSMENT", "ts": datetime.now().isoformat(),
                "student_message": user_message,
                "interaction_type": assessment.get("interaction_type"),
                "fact_discussed": assessment.get("fact_discussed"),
                "understood": assessment.get("student_demonstrated_understanding"),
                "confused": assessment.get("student_is_confused"),
                "reason": assessment.get("reason"),
                "step_transitioned": assessment.get("step_transitioned", False),
                "step_from": assessment.get("step_transition_from"),
                "step_to": assessment.get("step_transition_to"),
            })
            logging.info("=== ASSESSMENT ===  type=%s | fact=%s | understood=%s | reason=%s",
                         assessment.get("interaction_type"), assessment.get("fact_discussed") or "",
                         assessment.get("student_demonstrated_understanding"),
                         assessment.get("reason") or "")
            student_confused = assessment.get("student_is_confused", False)
            _in_reteach = (hasattr(self, '_session_engine') and self._session_engine
                           and self._session_engine.current_phase == "TEACH"
                           and self._session_engine.state.get("teach_context") in ("confirm", "confused", "reteach", "continue"))
            # ADO #28: an evidence probe deliberately re-asks the same fact —
            # that is not the tutor "looping". Suppress the correction so it
            # can't shadow the probe instruction (critical in voice, where only
            # the most recent system message reaches the realtime model). Check
            # BOTH this turn's action AND the durable pending-probe state, so a
            # turn where the engine didn't run (no fact_discussed) is still
            # covered while a probe is outstanding.
            _eng = getattr(self, '_session_engine', None)
            _is_probe = (getattr(self, '_last_engine_action', None)
                         in ("evidence_probe", "evidence_probe_clarify")
                         or (_eng is not None and _eng.has_pending_evidence_probe()))
            if not student_confused and not _in_reteach and not _is_probe and (assessment.get("tutor_is_summarizing") or assessment.get("tutor_is_looping")):
                _kp_c = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
                next_fact = _kp_c.get("current_fact", "the next concept")
                correction = self._render_compliance_correction(next_fact)
                if correction:
                    self.messages.append({"role": "system", "content": correction})
            itype = assessment.get("interaction_type", "teaching")
            if assessment.get("fact_discussed") and itype in ("student_correct", "student_incorrect"):
                self.question_count += 1
                if itype == "student_correct":
                    self.correct_count += 1
        except Exception as e:
            logging.warning("Assessment failed (proceeding without transitions): %s", e)
            self.log_execution("ASSESSMENT_ERROR", {"error": str(e)}, agent="Assessor")
        return assessment

    def _load_prompt_templates(self) -> None:
        """Load tutor and assessor templates from the decision tree prompt_registry."""
        for k, v in self._decision_tree.get("prompt_registry", {}).items():
            if isinstance(v, dict) and v.get("template"):
                target = self._assessor_templates if k.startswith("assessment") else self._tutor_templates
                target[k] = v["template"]

    @staticmethod
    def _make_knowledge_points(core_facts: list, batches: list, include_current_fact: bool = False) -> dict:
        """Build the initial knowledge_points dict for a capsule."""
        kp = {
            "facts_taught": [], "facts_assessed": [], "facts_mastered": [],
            "fact_exposures": {}, "fact_taught_messages": {}, "fact_steps": {},
            "total_facts": len(core_facts),
            "batches": batches, "batch_index": 0, "batch_step": "TEACH_TRY",
            "check_queue": [], "check_failures": [],
        }
        if include_current_fact:
            kp["current_fact"] = core_facts[0] if core_facts else None
            kp["current_fact_index"] = 0
            kp["mastery_levels"] = {}
        return kp

    def log_execution(self, step: str, details: dict, agent: str = None):
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "step": step,
            "agent": agent or self._get_agent_for_step(step),
            "details": details
        }
        with self._log_lock:
            self.execution_log.append(entry)

    def _render_compliance_correction(self, next_fact: str) -> Optional[str]:
        """Render compliance_correction template. Returns None if template missing."""
        # v6: use prompt engine if available, with full fact field injection
        if self._prompt_engine:
            fact_meta = self._get_current_fact_meta()
            if fact_meta:
                return self._prompt_engine.build_compliance_correction(fact_meta)

        # Legacy fallback
        tmpl = self._tutor_templates.get("compliance_correction")
        if not tmpl:
            logging.warning("compliance_correction template missing for %s", self.subject)
            return None
        return database.render_prompt(tmpl, {"next_fact": next_fact})

    def _get_current_fact_meta(self) -> dict:
        """Get enrichment meta_data for the current fact from the capsule.
        Always includes core_fact (the fact text itself)."""
        kp = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
        current_fact = kp.get("current_fact", "")
        if not current_fact:
            # Try v6 state machine for current fact
            if self._session_engine:
                meta = self._session_engine.current_fact_meta
                if meta:
                    result = dict(meta)
                    result["core_fact"] = meta.get("core_fact", "")
                    return result
            return {}
        enrichment = self.capsule.get("_fact_enrichment", {})
        result = dict(enrichment.get(current_fact, {}))
        result["core_fact"] = current_fact  # Always set core_fact to the fact text
        return result

    def _get_agent_for_step(self, step: str) -> str:
        """Determine which agent handles this step."""
        if "USER" in step:
            return "Student"
        elif "LLM" in step or "GREETING" in step:
            return self.tutor_name
        elif "SESSION" in step or "PROGRESS" in step:
            return "SessionManager"
        elif "ANSWER" in step:
            return "Assessor"
        return "System"

    def check_student_comprehension(self, tutor_response: str, student_message: str,
                                    compliance_only: bool = False,
                                    forced_interaction_type: str = None) -> dict:
        """Use LLM to assess what happened in this tutor-student exchange.

        Returns structured assessment of which fact was discussed,
        whether the student demonstrated understanding, and whether
        the tutor is summarizing/looping instead of teaching.

        If compliance_only=True, only checks for summarizing/looping
        without tracking fact progression (used for greeting checks).
        """
        self._step_transitioned_this_turn = False
        self._step_transition_from = None
        self._step_transition_to = None
        self._step_transition_new_fact = False
        self._cycle_advanced = False
        self._last_engine_action = None  # ADO #28: this turn's engine action
        core_facts = self.capsule.get("core_facts", [])
        kp = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
        # v6: prefer SessionEngine's current fact over old kp
        if hasattr(self, '_session_engine') and self._session_engine and self._session_engine.current_fact_text:
            current_fact = self._session_engine.current_fact_text
        else:
            current_fact = kp.get("current_fact", core_facts[0] if core_facts else "unknown")
        mastered = kp.get("facts_mastered", [])
        facts_taught = kp.get("facts_taught", [])

        default_result = {
            "fact_discussed": None,
            "student_demonstrated_understanding": False,
            "student_is_confused": False,
            "tutor_is_summarizing": False,
            "tutor_is_looping": False,
            "interaction_type": "teaching"
        }

        # --- Build trimmed prompt (current fact + recent context only) ---
        recent_taught = facts_taught[-2:] if len(facts_taught) > 2 else facts_taught
        recent_str = "\n".join(f"- {f}" for f in recent_taught) if recent_taught else "none yet"

        # Extract the previous tutor message — this is the message that asked
        # the question the student was answering. At this point in the flow,
        # the current tutor response has NOT yet been appended to self.messages,
        # so the last assistant message IS the previous one.
        prev_tutor_msg = ""
        for msg in reversed(self.messages):
            if msg["role"] == "assistant":
                content = msg["content"]
                if len(content) > 500:
                    truncated = content[-500:]
                    first_space = truncated.find(" ")
                    prev_tutor_msg = "..." + (truncated[first_space:] if first_space != -1 else truncated)
                else:
                    prev_tutor_msg = content
                break
        if not prev_tutor_msg:
            prev_tutor_msg = "(No previous tutor message - this is the first exchange in the session.)"

        # The student message that the tutor's LATEST response was replying to.
        # The acknowledgment check must compare TUTOR_LATEST_RESPONSE against
        # THIS (the message it actually answered), not against the current
        # incoming message — which the latest response predates and so cannot
        # acknowledge. The current message is not yet in self.messages (appended
        # after assessment), so the last user message here is the prior one.
        tutor_replied_to = ""
        for msg in reversed(self.messages):
            if msg["role"] == "user":
                c = msg["content"]
                tutor_replied_to = c[-500:] if len(c) > 500 else c
                break

        # Look up current fact's sub-step for the assessor
        # v6: prefer SessionEngine's phase over old fact_steps
        if hasattr(self, '_session_engine') and self._session_engine:
            fact_sub_step = self._session_engine.current_phase
        else:
            fact_steps = kp.get("fact_steps", {})
            current_fs = fact_steps.get(current_fact, {})
            fact_sub_step = current_fs.get("sub_step", "TEACH")

        # v6: get fact enrichment fields for the assessor
        fact_enrichment = self.capsule.get("_fact_enrichment", {})
        fact_meta = fact_enrichment.get(current_fact, {})

        assessment_prompt = database.render_prompt(
            self._assessor_templates.get("assessment_user_prompt", ""),
            {"current_fact": current_fact, "core_fact": current_fact,
             "recent_taught_str": recent_str,
             "fact_sub_step": fact_sub_step,
             "mastered_count": str(len(mastered)), "total_facts": str(len(core_facts)),
             "tutor_response": tutor_response, "student_message": student_message,
             "previous_tutor_message": prev_tutor_msg,
             "tutor_replied_to": tutor_replied_to,
             "vocabulary": fact_meta.get("vocabulary", ""),
             "misconception": fact_meta.get("misconception", ""),
             "age_range": self.phase_age_range, "phase": str(self.phase)})

        assessment_sys = self._assessor_templates.get(
            "assessment_system_message",
            "You return only valid JSON. No markdown, no explanation.")

        try:
            assessment_messages = [
                {"role": "system", "content": assessment_sys},
                {"role": "user", "content": assessment_prompt}
            ]
            self.log_execution("ASSESSMENT_LLM_REQUEST", {
                "model": self.xai_assessment_model,
                "temperature": 0.1,
                "max_tokens": 250,
                "purpose": "comprehension_check",
                "compliance_only": compliance_only,
                "current_fact": current_fact,
                "messages": assessment_messages
            }, agent="Assessor")

            assessment_start = time.time()
            # 250 (was 200): room for the tutor_missing_acknowledgment flag (ADO #26)
            resp = call_llm(TaskType.ASSESSOR, assessment_messages, temperature=0.1, max_tokens=250, model=self.xai_assessment_model, store=False, reasoning="low")

            assessment_tokens = resp.usage.total_tokens if resp.usage else 0
            self.total_tokens += assessment_tokens
            _apt = resp.usage.prompt_tokens if resp.usage else 0
            _act = resp.usage.completion_tokens if resp.usage else 0
            _actual_model = resp.model or self.xai_assessment_model
            _actual_provider = resp.provider or "xai"
            self.log_execution("ASSESSMENT_LLM_RESPONSE", {
                "tokens_used": assessment_tokens,
                "model": _actual_model,
                "provider": _actual_provider,
                "prompt_tokens": _apt,
                "completion_tokens": _act,
                "cost_usd": calc_cost(_actual_model, _apt, _act),
                "latency_ms": int((time.time() - assessment_start) * 1000),
                "full_response": resp.content or ""
            }, agent="Assessor")

            raw = (resp.content or "").strip()
            if not raw:
                # Raised into the except below (not an early return) so a
                # clicked chip's forced routing still applies on this turn.
                raise ValueError("Empty LLM response")
            if raw.startswith("```json"):
                raw = raw[7:]
            elif raw.startswith("```"):
                raw = raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            result = json.loads(raw.strip())

            # Ensure all keys exist
            for key in default_result:
                if key not in result:
                    result[key] = default_result[key]

        except Exception as e:
            self.log_execution("COMPREHENSION_LLM_ERROR", {"error": str(e)}, agent="Assessor")
            result = dict(default_result)

        # ADO #26: a clicked engagement chip determines the interaction type
        # deterministically — override the assessor's guess (compliance flags
        # in `result` are kept). fact_discussed is forced so the engine gate
        # below processes the routing even for closure/recall pseudo-types.
        if forced_interaction_type and not compliance_only:
            result["interaction_type"] = forced_interaction_type
            result["forced_by_chip"] = True
            if not result.get("fact_discussed"):
                result["fact_discussed"] = current_fact

        # At capsule closure the current fact is often "" and the assessor
        # returns fact_discussed=null for typed replies ("yes recap please"),
        # which would block the engine gate below and leave the closure
        # choice — and the session — open forever. Force the gate open.
        if (not compliance_only and not result.get("fact_discussed")
                and hasattr(self, '_session_engine') and self._session_engine
                and self._session_engine.current_phase == "CAPSULE_COMPLETE"):
            result["fact_discussed"] = current_fact or self.capsule_name or "capsule"

        # Process the assessment (skip fact tracking if compliance_only)
        if not compliance_only:
            fact_discussed = result.get("fact_discussed")
            understood = result.get("student_demonstrated_understanding", False)
            interaction_type = result.get("interaction_type", "teaching")

            # Capture cycle_index BEFORE _process_fact_interaction runs,
            # because it may advance to a new fact (resetting cycle_index
            # to 0) which would defeat the mid-cycle compliance suppression.
            _pre_ckp = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
            _pre_cf = _pre_ckp.get("current_fact", "")
            _pre_cycle_index = _pre_ckp.get("fact_steps", {}).get(_pre_cf, {}).get("cycle_index", 0) if _pre_cf else 0

            if fact_discussed:
                # Routing pseudo-types (recall_more, closure_*) carry a forced
                # fact for the engine gate — they must not count as "taught"
                # (a recall click would inflate facts_taught_count with a fact
                # the student never saw).
                if interaction_type not in engagement.PSEUDO_INTERACTION_TYPES:
                    self.session_taught_facts.add(fact_discussed)

                # Determine understood value based on interaction type
                if interaction_type in ("student_correct", "student_understands"):
                    understood_val = True
                elif interaction_type in ("student_incorrect", "student_confused"):
                    understood_val = False
                elif interaction_type in ("teaching", "off_topic", "student_move_on", "student_question"):
                    understood_val = None  # no real understanding signal
                else:
                    understood_val = True if understood else None

                # v6: Use SessionEngine if available, otherwise fall back to old code
                if hasattr(self, '_session_engine') and self._session_engine:
                    try:
                        # Build assessor block to embed inside any transition prompt
                        _asr_reason = result.get("reason", "")
                        self._pending_assessor_block = (
                            f"<ASSESSOR_RESULT>\n"
                            f"  <INTERACTION_TYPE>{interaction_type}</INTERACTION_TYPE>\n"
                            f"  <REASON>{_asr_reason}</REASON>\n"
                            f"</ASSESSOR_RESULT>") if interaction_type and _asr_reason else None
                        transition = self._session_engine.process_assessor_result(
                            interaction_type, student_message=student_message)
                        # ADO #28: expose this turn's engine action so the
                        # compliance-correction gate can skip looping/summarizing
                        # corrections on an intentional evidence probe (a second
                        # probe on the same fact otherwise trips the looping flag).
                        self._last_engine_action = transition.get("action")
                        logging.info("[v6] %s -> %s (%s) fact=%s",
                                     interaction_type, transition.get('new_phase'),
                                     transition.get('action'), self._session_engine.current_fact_text)
                        if transition.get("state_changed"):
                            # Inject the step transition prompt with assessor result embedded
                            if transition.get("prompt_text"):
                                prompt = transition['prompt_text']
                                # Embed assessor result inside the transition so the LLM
                                # sees one coherent instruction instead of two competing ones
                                if hasattr(self, '_pending_assessor_block') and self._pending_assessor_block:
                                    prompt = self._pending_assessor_block + "\n" + prompt
                                    self._pending_assessor_block = None
                                self.messages.append({"role": "system", "content": prompt})
                            # Update progress tracking
                            new_phase = transition.get("new_phase", "TEACH")
                            old_phase = self.progress["current_position"].get("step_name", "TEACH")
                            step_map = {"TEACH": 2, "TRY": 3, "CHECK": 4, "EVIDENCE": 5, "RECALL": 1, "CAPSULE_COMPLETE": 6}
                            self.progress["current_position"]["step"] = step_map.get(new_phase, 2)
                            self.progress["current_position"]["step_name"] = new_phase
                            self._step_transitioned_this_turn = True
                            self._step_transition_from = old_phase
                            self._step_transition_to = new_phase
                            self.log_execution("V6_TRANSITION", {
                                "action": transition.get("action"),
                                "from_phase": old_phase,
                                "to_phase": new_phase,
                                "fact": self._session_engine.current_fact_text,
                                # ADO #74: graded fact on an evidence-guard strike-out
                                # (the engine already advanced past it); None otherwise.
                                "strikeout_fact": transition.get("strikeout_fact"),
                                "step_position": transition.get("step_display_position", 1),
                                "step_total": transition.get("step_display_total", 0),
                                "reason": transition.get("reason", ""),
                            }, agent="Orchestrator")

                        # If no transition consumed the assessor block, append it standalone
                        if hasattr(self, '_pending_assessor_block') and self._pending_assessor_block:
                            self.messages.append({"role": "system", "content": self._pending_assessor_block})
                            self._pending_assessor_block = None

                        # Sync engine state back to legacy knowledge_points
                        kp_name = self.capsule_name
                        if kp_name in self.progress.get("knowledge_points", {}):
                            engine_kp = self._session_engine.to_knowledge_points()
                            old_kp = self.progress["knowledge_points"][kp_name]
                            old_kp["facts_taught"] = engine_kp["facts_taught"]
                            old_kp["facts_assessed"] = engine_kp["facts_assessed"]
                            old_kp["facts_mastered"] = engine_kp["facts_mastered"]
                            old_kp["current_fact"] = engine_kp["current_fact"]
                            old_kp["current_fact_index"] = engine_kp["current_fact_index"]
                            old_kp["batch_index"] = engine_kp["batch_index"]
                            old_kp["batch_step"] = engine_kp["batch_step"]

                        # Record interaction for report card (replaces old _pending_interactions logic).
                        # Engagement pseudo-types (chip routing) carry no understanding
                        # signal and stay out of the report card (ADO #26).
                        fact_db_id = self._fact_id_map.get(fact_discussed)
                        if fact_db_id and interaction_type not in engagement.PSEUDO_INTERACTION_TYPES:
                            interaction = {
                                "fact_db_id": str(fact_db_id),
                                "session_id": self.session_db_id or "",
                                "type": interaction_type,
                                "understood": interaction_type in ("student_correct", "student_understands"),
                                "step": self.progress.get("current_position", {}).get("step", 2),
                                "exposure": 1,
                                "message_ids": [],
                                "at": datetime.now().isoformat(),
                            }
                            self._pending_interactions.append(interaction)
                            self._last_interaction_idx = len(self._pending_interactions) - 1

                    except Exception as e:
                        logging.error("[v6] SessionEngine error: %s", e, exc_info=True)


        # Only log compliance issues when at the start of a cycle (index 0).
        # Mid-cycle, the tutor IS supposed to revisit the same fact.
        # Use PRE-transition cycle_index to avoid false positives when a fact
        # just completed and advanced to a new fact (which starts at index 0).
        _ci_for_compliance = 0
        if not compliance_only:
            _ci_for_compliance = _pre_cycle_index
        if _ci_for_compliance == 0 and (result.get("tutor_is_summarizing") or result.get("tutor_is_looping")):
            self.log_execution("COMPLIANCE_ISSUE", {
                "summarizing": result.get("tutor_is_summarizing"),
                "looping": result.get("tutor_is_looping")
            }, agent="Assessor")

        result["step_transitioned"] = getattr(self, '_step_transitioned_this_turn', False)
        result["step_transition_from"] = getattr(self, '_step_transition_from', None)
        result["step_transition_to"] = getattr(self, '_step_transition_to', None)
        result["step_transition_new_fact"] = getattr(self, '_step_transition_new_fact', False)
        # Pass pre-transition cycle_index so chat endpoints can use it for
        # compliance suppression (post-transition index may be 0 for new fact).
        result["_pre_cycle_index"] = _pre_cycle_index if not compliance_only else 0
        return result

    @staticmethod
    def _compute_batches(core_facts, max_batch=5):
        """Split facts into balanced batches of 3-5."""
        n = len(core_facts)
        if n == 0:
            return []
        if n <= max_batch:
            return [core_facts[:]]
        num_batches = ceil(n / max_batch)
        base, extra = divmod(n, num_batches)
        batches, start = [], 0
        for i in range(num_batches):
            size = base + (1 if i < extra else 0)
            batches.append(core_facts[start:start + size])
            start += size
        return batches

    def _advance_to_next_capsule(self):
        """Complete current capsule and advance to the next one in the curriculum."""
        current_capsule_id = self.progress["current_position"]["curriculum_capsule_id"]
        current_capsule_name = self.capsule_name

        # Mark as advanced to prevent re-entrance
        self.capsule_advanced = True

        # Add to completed capsules (matching progress_tool.py dict format)
        if "completed_capsules" not in self.progress:
            self.progress["completed_capsules"] = []
        already_completed = any(
            (c.get("capsule_name") if isinstance(c, dict) else c) == current_capsule_name
            for c in self.progress["completed_capsules"]
        )
        if not already_completed:
            self.progress["completed_capsules"].append({
                "curriculum_capsule_id": current_capsule_id,
                "capsule_name": current_capsule_name,
                "completed_at": datetime.now().isoformat(),
                "mastery_level": "Secure"
            })

        # Award credit
        credit = self.capsule.get("credit_value", 0.25)
        self.progress["total_credits"] = self.progress.get("total_credits", 0.0) + credit

        # Flush ALL fact progress + pending interactions into report_card,
        # then mark capsule completed.
        try:
            rc = database.get_report_card(self.student_id)
            subject_row = database.get_subject_by_name(self.subject)
            if subject_row and self._capsule_db_id:
                cap = database.ensure_report_card_path(
                    rc, subject_row["id"], self.phase,
                    self.capsule.get("theme_db_id"), self._capsule_db_id)

                now_iso = datetime.now().isoformat()
                kp = self.progress.get("knowledge_points", {}).get(current_capsule_name, {})
                sync_facts_to_report_card(cap, kp, self._fact_id_map,
                                          self._pending_interactions, now_iso)
                self._pending_interactions = []

                # Mark capsule completed and clear session_state (no resume needed)
                cap["status"] = "completed"
                cap["completed_at"] = now_iso
                cap["mastery_level"] = "Secure"
                cap["credits"] = float(credit)
                cap.pop("session_state", None)

                database.recompute_report_card_rollups(rc)
                database.save_report_card(self.student_id, rc)
        except Exception as e:
            logging.warning("report_card capsule completion failed: %s", e)

        # Look up next capsule name for display but do NOT hot-swap.
        # Session ends after EVIDENCE — user must start a new session for the next capsule.
        try:
            next_info = json.loads(get_next_capsule(current_capsule_id))
            next_capsule_id = next_info.get("next_capsule_id")
        except (json.JSONDecodeError, Exception):
            next_capsule_id = None

        if next_capsule_id:
            next_name = self._capsule_name_from_id(next_capsule_id)
            self.next_capsule_name = next_name
            # Update current_position to the next capsule so the student
            # sees it as the starting point in their next session
            next_cap_row = database.get_capsule_by_id(next_capsule_id) if next_capsule_id else None
            if next_cap_row:
                self.progress["current_position"]["capsule_name"] = next_cap_row["name"]
                self.progress["current_position"]["curriculum_capsule_id"] = str(next_capsule_id)
                self.progress["current_position"]["step"] = 2
                self.progress["current_position"]["step_name"] = "TEACH"
                if next_cap_row.get("theme_db_id"):
                    self.progress["current_position"]["curriculum_theme_id"] = str(next_cap_row["theme_db_id"])
                    self.progress["current_position"]["theme_name"] = next_cap_row.get("theme_name", "")
            self.log_execution("CAPSULE_COMPLETE", {
                "completed": current_capsule_name,
                "next": next_name,
                "credits_earned": credit,
                "total_credits": self.progress["total_credits"]
            }, agent="SessionManager")
        else:
            self.next_capsule_name = None
            self.curriculum_complete = True
            self.log_execution("CURRICULUM_COMPLETE", {
                "completed": current_capsule_name,
                "total_credits": self.progress["total_credits"]
            }, agent="SessionManager")

        self._save_progress()

    @staticmethod
    def _capsule_name_from_id(capsule_id: str) -> str:
        """Look up capsule name from UUID using the DB."""
        row = database.get_capsule_by_id(capsule_id)
        return row["name"] if row else capsule_id

    def get_image_context(self) -> dict:
        """Return age/theme/capsule context for image generation."""
        return {
            "age_range": self.phase_age_range,
            "theme": self.progress.get("current_position", {}).get("theme_name", ""),
            "capsule": self.capsule_name,
        }

    def _save_progress(self):
        """Sync in-memory progress to DB via report_card JSONB."""
        try:
            pos = self.progress.get("current_position", {})
            fields = {
                "total_credits": self.progress.get("total_credits", 0),
                "last_session": datetime.now(),
            }
            database.update_student_position(self.student_id, **fields)

            # Sync fact progress + pending interactions to report_card
            kp = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
            if not kp or not self._fact_id_map or not self._capsule_db_id:
                logging.warning("_save_progress SKIPPED: kp=%s, fact_id_map=%s, capsule_db_id=%s",
                                bool(kp), bool(self._fact_id_map), self._capsule_db_id)
            if kp and self._fact_id_map and self._capsule_db_id:
                rc = database.get_report_card(self.student_id)
                subject_row = database.get_subject_by_name(self.subject)
                if subject_row:
                    cap = database.ensure_report_card_path(
                        rc, subject_row["id"], self.phase,
                        self.capsule.get("theme_db_id"), self._capsule_db_id)

                    now_iso = datetime.now().isoformat()
                    sync_facts_to_report_card(cap, kp, self._fact_id_map,
                                              getattr(self, '_pending_interactions', []), now_iso)
                    self._pending_interactions = []

                    # Persist full state machine snapshot for crash recovery
                    cap["session_state"] = {
                        "batch_index": kp.get("batch_index", 0),
                        "batch_step": kp.get("batch_step", "TEACH_TRY"),
                        "batches": kp.get("batches", []),
                        "check_queue": kp.get("check_queue", []),
                        "check_failures": kp.get("check_failures", []),
                        "evidence_queue": kp.get("evidence_queue", []) if "evidence_queue" in kp else None,
                        "evidence_passed": kp.get("evidence_passed", []),
                        "evidence_failures": kp.get("evidence_failures", []),
                        "evidence_fail_count": kp.get("evidence_fail_count", 0),
                        "current_fact": kp.get("current_fact"),
                        "current_fact_index": kp.get("current_fact_index", 0),
                        "fact_steps": kp.get("fact_steps", {}),
                        "facts_taught": kp.get("facts_taught", []),
                        "facts_assessed": kp.get("facts_assessed", []),
                        "facts_mastered": kp.get("facts_mastered", []),
                        "fact_exposures": kp.get("fact_exposures", {}),
                    }

                    # v6: persist SessionEngine state for crash recovery
                    if hasattr(self, '_session_engine') and self._session_engine:
                        cap["v6_engine_state"] = self._session_engine.serialize()

                    # Full session copy embedded in report card (survives session deletion)
                    cap["session_transcript"] = [
                        {"role": m["role"], "content": m.get("content", "")}
                        for m in self.messages if m["role"] != "system"
                    ]
                    cap["session_execution_log"] = list(self.execution_log)
                    cap["session_system_log"] = list(self.system_log)
                    cap["session_db_id"] = str(self.session_db_id) if self.session_db_id else None

                    # Persist current position in report_card (both per-subject and top-level)
                    subject_key = str(subject_row["id"])
                    rc.setdefault(subject_key, {})
                    position_data = {
                        "subject_id": subject_key,
                        "phase": self.phase,
                        "curriculum_id": pos.get("_curriculum_db_id"),
                        "curriculum_theme_id": str(self.capsule.get("theme_db_id")) if self.capsule.get("theme_db_id") else pos.get("_theme_db_id"),
                        "theme_id": pos.get("_theme_db_id"),
                        "theme_name": self.capsule.get("theme_name", ""),
                        "capsule_id": self._capsule_db_id,
                        "capsule_name": self.capsule_name,
                        "fact_id": self._fact_id_map.get(kp.get("current_fact")) if kp.get("current_fact") else None,
                        "step": pos.get("step", 2),
                        "step_name": pos.get("step_name", "TEACH"),
                    }
                    rc[subject_key]["current_position"] = position_data
                    rc["current_position"] = position_data

                    # Update capsule status
                    if cap["status"] == "not_started" and any(
                        f.get("is_taught") for f in cap["facts"].values()
                    ):
                        cap["status"] = "in_progress"

                    database.recompute_report_card_rollups(rc)
                    database.save_report_card(self.student_id, rc)

            self.log_execution("PROGRESS_SAVED", {
                "target": "report_card",
                "knowledge_points": len(kp.get("facts_assessed", []))
            }, agent="SessionManager")

            # Flush execution_log + stats to learning_sessions so session viewers see live data
            if self.session_db_id:
                try:
                    duration = int((datetime.now() - self.start_time).total_seconds()) if hasattr(self, 'start_time') and self.start_time else None
                    accuracy = round((self.correct_count / self.question_count * 100), 1) if self.question_count > 0 else 0
                    # Snapshot logs under the lock so concurrent persist-image patches
                    # aren't clobbered by this flush (and aren't observed mid-mutation).
                    with self._log_lock:
                        execution_log_snapshot = list(self.execution_log)
                        system_log_snapshot = list(self.system_log)
                    database.flush_session_progress(
                        self.session_db_id,
                        execution_log=execution_log_snapshot,
                        system_log=system_log_snapshot,
                        tokens=self.total_tokens,
                        questions=self.question_count,
                        correct=self.correct_count,
                        facts_taught=len(kp.get("facts_taught", [])),
                        duration=duration,
                        accuracy=accuracy,
                        fact_interactions=getattr(self, '_pending_interactions', []),
                    )
                except Exception as e:
                    logging.warning("flush_session_progress failed: %s", e)
        except Exception as e:
            logging.error("_save_progress FAILED: %s", e, exc_info=True)
            self.log_execution("PROGRESS_SAVE_ERROR", {
                "error": str(e)
            }, agent="SessionManager")

    def _reset_current_capsule_in_report_card(self):
        """Reset fact progress and session_state for the current capsule only.

        Called at the start of every new session. Completed capsules and other
        subjects are preserved — only the in-progress capsule being started is
        wiped so the student begins fresh.
        """
        if not self._capsule_db_id:
            return
        try:
            rc = database.get_report_card(self.student_id)
            cap = database.get_capsule_from_report_card(rc, self._capsule_db_id)
            if not cap:
                return
            # Don't reset completed capsules — student already mastered them
            if cap.get("status") == "completed":
                return

            # Reset all fact flags to initial state
            for fid, fd in cap.get("facts", {}).items():
                fd["is_taught"] = False
                fd["taught_at"] = None
                fd["is_assessed"] = False
                fd["assessed_at"] = None
                fd["is_mastered"] = False
                fd["mastered_at"] = None
                fd["exposure_count"] = 0
                fd["correct_count"] = 0
                fd["incorrect_count"] = 0
                # Keep interactions as historical record
            # Clear session_state machine snapshot
            cap.pop("session_state", None)
            cap["status"] = "not_started"

            # Also clear in-memory knowledge_points so they rebuild fresh
            kp = self.progress.get("knowledge_points", {})
            kp.pop(self.capsule_name, None)

            database.recompute_report_card_rollups(rc)
            database.save_report_card(self.student_id, rc)

            self.log_execution("CAPSULE_RESET", {
                "capsule_id": str(self._capsule_db_id),
                "capsule_name": self.capsule_name,
                "reason": "new session start",
            }, agent="SessionManager")
        except Exception as e:
            self.log_execution("CAPSULE_RESET_ERROR", {
                "error": str(e),
            }, agent="SessionManager")

    def _switch_to_capsule(self, new_capsule_name: str, capsule_data: dict):
        """Hot-swap the session to serve a new capsule without restarting."""
        old_capsule = self.capsule_name

        # 1. Update capsule references
        self.capsule_name = new_capsule_name
        self.capsule = capsule_data
        self._fact_id_map = capsule_data.get("_fact_id_map", {})
        self._capsule_db_id = capsule_data.get("db_id")
        # Update phase-specific age range for the new capsule
        self.phase_age_range = capsule_data.get("age_range") or self.phase_age_range
        self.phase = capsule_data.get("phase", self.phase)

        # 2. Initialize knowledge_points for new capsule if absent
        if "knowledge_points" not in self.progress:
            self.progress["knowledge_points"] = {}
        if new_capsule_name not in self.progress["knowledge_points"]:
            new_core_facts = capsule_data.get("core_facts", [])
            new_batches = self._compute_batches(new_core_facts)
            self.progress["knowledge_points"][new_capsule_name] = self._make_knowledge_points(
                new_core_facts, new_batches, include_current_fact=True)

        # 3. Reset session counters for the new capsule
        self.session_taught_facts = set()
        self.question_count = 0
        self.correct_count = 0
        self.image_topics = []

        # 4. Rebuild system prompt for the new capsule
        self.system_prompt = self._build_system_prompt()

        # 5. Replace messages[0] with new system prompt
        if self.messages and self.messages[0].get("role") == "system":
            self.messages[0] = {"role": "system", "content": self.system_prompt}

        # 6. Strip stale transition system messages (keep messages[0] = system prompt)
        system_prompt_msg = self.messages[0] if self.messages else None
        self.messages = [
            m for m in self.messages
            if m is system_prompt_msg
            or not (m.get("role") == "system" and m.get("content", "").startswith(("STEP TRANSITION:", "PHASE TRANSITION:", "CAPSULE TRANSITION:")))
        ]

        # 7. Inject CAPSULE TRANSITION system message
        transition_msg = database.render_prompt(
            self._tutor_templates.get("capsule_transition", ""),
            {"old_capsule": old_capsule, "new_capsule_name": new_capsule_name,
             "first_fact": capsule_data.get("core_facts", [""])[0]})
        self.messages.append({"role": "system", "content": transition_msg})

        # 7b. Reset stateful conversation tracking (new system prompt = must resend everything)
        self.last_response_id = None
        self._messages_synced_idx = 0

        # 8. Clear capsule_advanced so fact tracking resumes
        self.capsule_advanced = False

        # 9. Set frontend signal flags
        self._capsule_just_switched = True
        self._switched_from_capsule = old_capsule

        # Track capsules covered this session
        if old_capsule not in self._capsules_covered:
            self._capsules_covered.append(old_capsule)
        if new_capsule_name not in self._capsules_covered:
            self._capsules_covered.append(new_capsule_name)

        # 10. Save progress and log
        self._save_progress()
        self.log_execution("CAPSULE_SWITCH", {
            "from": old_capsule,
            "to": new_capsule_name,
            "new_facts_count": len(capsule_data.get("core_facts", []))
        }, agent="SessionManager")

    def get_knowledge_stats(self) -> dict:
        """Get current knowledge point statistics."""
        capsule_name = self.capsule_name
        kp = self.progress.get("knowledge_points", {}).get(capsule_name, {})
        total = len(self.capsule.get("core_facts", []))

        # Consume one-shot capsule switch flags
        capsule_switched = self._capsule_just_switched
        switched_from = self._switched_from_capsule
        if capsule_switched:
            self._capsule_just_switched = False
            self._switched_from_capsule = None

        # ADO #25: Vocabulary Bank — derived server-side, no LLM involved.
        # Guarded so a derivation bug degrades to an absent panel, never a
        # failed turn.
        vocab_bank = []
        definitions_hidden = False
        engine = getattr(self, "_session_engine", None)
        if engine and engine.state:
            try:
                vocab_bank = engine.vocab_bank()
                definitions_hidden = engine.definitions_masked()
            except Exception as vb_err:
                # Degrade to an absent panel, but make the failure observable —
                # a systemic break (e.g. malformed state after a bad restore)
                # would otherwise silently drop the panel on every turn.
                logging.error("vocab_bank derivation failed (student=%s): %s",
                              getattr(self, "student_id", "?"), vb_err,
                              exc_info=True)

        return {
            "vocab_bank": vocab_bank,
            "definitions_hidden": definitions_hidden,
            "age_range": getattr(self, "phase_age_range", "") or "",
            "facts_taught": len(kp.get("facts_taught", [])),
            "facts_assessed": len(kp.get("facts_assessed", [])),
            "facts_mastered": len(kp.get("facts_mastered", [])),
            "facts_taught_texts": list(kp.get("facts_taught", [])),
            "facts_assessed_texts": list(kp.get("facts_assessed", [])),
            "facts_mastered_texts": list(kp.get("facts_mastered", [])),
            "all_facts": self.capsule.get("core_facts", []),
            "total_facts": total,
            "current_fact": kp.get("current_fact"),
            "current_fact_index": kp.get("current_fact_index", 0),
            "current_step": self.progress["current_position"]["step_name"],
            "completed_capsules": self.progress.get("completed_capsules", []),
            "total_credits": self.progress.get("total_credits", 0.0),
            "next_capsule": self.next_capsule_name,
            "curriculum_complete": self.curriculum_complete,
            "capsule_name": capsule_name,
            "capsule_switched": capsule_switched,
            "switched_from": switched_from
        }

    def get_session_duration(self) -> int:
        """Get session duration in seconds."""
        end = self.end_time or datetime.now()
        return int((end - self.start_time).total_seconds())

    def end_session(self) -> dict:
        """End the session and save final progress."""
        self.end_time = datetime.now()
        self.is_active = False
        duration = self.get_session_duration()

        # Add session to history
        if "session_history" not in self.progress:
            self.progress["session_history"] = []

        # Ensure current capsule is tracked
        if self.capsule_name not in self._capsules_covered:
            self._capsules_covered.append(self.capsule_name)

        session_record = {
            "date": self.start_time.isoformat(),
            "capsule": self.capsule_name,
            "capsules_covered": self._capsules_covered,
            "duration_seconds": duration,
            "questions_answered": self.question_count,
            "correct_answers": self.correct_count,
            "accuracy": round((self.correct_count / self.question_count * 100), 1) if self.question_count > 0 else 0,
            "facts_taught": len(self.session_taught_facts),
            "tokens_used": self.total_tokens
        }

        self.progress["session_history"].append(session_record)
        self.progress["last_session"] = self.start_time.isoformat()

        # Add session end interaction
        if "interactions" not in self.progress:
            self.progress["interactions"] = []

        self.progress["interactions"].append({
            "type": "session_end",
            "capsule": self.capsule_name,
            "duration_seconds": duration,
            "questions_answered": self.question_count,
            "correct_answers": self.correct_count,
            "timestamp": self.end_time.isoformat()
        })

        # Build fact_interactions summary BEFORE _save_progress flushes _pending_interactions
        fact_interactions_summary = self._build_fact_interactions_summary()

        # Save progress (flushes _pending_interactions to report_card)
        self._save_progress()

        # Check if capsule is complete and advance if so. The v6 engine's
        # completion (incl. COMPLETED_WITH_GAPS) counts: without it, a
        # gaps-capsule session restored at CAPSULE_COMPLETE could loop
        # one-message sessions forever because mastered < total.
        if not self.capsule_advanced:
            kp = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
            total = kp.get("total_facts", 0)
            mastered = len(kp.get("facts_mastered", []))
            _v6_complete = (hasattr(self, '_session_engine') and self._session_engine
                            and self._session_engine.is_capsule_complete())
            if (total > 0 and mastered >= total) or _v6_complete:
                self._advance_to_next_capsule()

        # Log SESSION_END before DB save so it's included in execution_log
        self.log_execution("SESSION_END", {
            "duration_seconds": duration,
            "questions": self.question_count,
            "correct": self.correct_count,
            "facts_taught": len(self.session_taught_facts)
        }, agent="SessionManager")

        # Wait for pending image downloads so execution_log has permanent URLs.
        # Must hold _log_lock while mutating execution_log because the persist-image
        # background threads also patch it under the same lock.
        if self._pending_downloads:
            for thread, old_url, result in self._pending_downloads:
                thread.join(timeout=15)
                if result["local_url"]:
                    with self._log_lock:
                        log_json = json.dumps(self.execution_log)
                        if old_url in log_json:
                            self.execution_log = json.loads(log_json.replace(old_url, result["local_url"]))
            self._pending_downloads.clear()

        # DB: Finalize session record (after SESSION_END is logged)
        if hasattr(self, 'session_db_id') and self.session_db_id:
            try:
                with self._log_lock:
                    execution_log_snapshot = list(self.execution_log)
                    system_log_snapshot = list(self.system_log)
                database.end_session_db(
                    self.session_db_id,
                    duration=duration,
                    questions=self.question_count,
                    correct=self.correct_count,
                    tokens=self.total_tokens,
                    facts_taught=len(self.session_taught_facts),
                    accuracy=session_record["accuracy"],
                    execution_log=execution_log_snapshot,
                    fact_interactions=fact_interactions_summary,
                    system_log=system_log_snapshot,
                )
            except Exception as e:
                logging.warning("DB end_session_db failed: %s", e)

        return session_record

    def _build_fact_interactions_summary(self):
        """Build a clean per-fact interaction list for session-level storage."""
        kp = self.progress.get("knowledge_points", {}).get(self.capsule_name, {})
        core_facts = self.capsule.get("core_facts", [])
        exposures = kp.get("fact_exposures", {})
        fact_steps = kp.get("fact_steps", {})
        fact_id_map = getattr(self, '_fact_id_map', {})

        per_fact_cycles = self.capsule.get("_fact_cycle", {})
        summary = []
        for fact_text in core_facts:
            if fact_text not in self.session_taught_facts:
                continue
            fs = fact_steps.get(fact_text, {})
            fc = per_fact_cycles.get(fact_text) or self.fact_cycle
            fact_db_id = str(fact_id_map.get(fact_text, "")) if fact_id_map else ""
            # Collect this fact's interactions from pending list
            interactions = [
                {"type": ix["type"], "understood": ix["understood"],
                 "step": ix["step"], "exposure": ix["exposure"], "at": ix["at"]}
                for ix in getattr(self, '_pending_interactions', [])
                if ix.get("fact_db_id") == fact_db_id
            ]
            summary.append({
                "fact_id": fact_db_id,
                "fact_text": fact_text,
                "exposures": exposures.get(fact_text, 0),
                "sub_step": fs.get("sub_step", "TEACH"),
                "cycle_index": fs.get("cycle_index", 0),
                "cycle_total": len(fc),
                "resets": fs.get("resets", 0),
                "is_mastered": fact_text in kp.get("facts_mastered", []),
                "interactions": interactions,
            })
        return summary



# LLM client helpers -> llm.py


def get_session(student_id: str) -> SessionState:
    if student_id not in sessions:
        sessions[student_id] = SessionState(student_id)  # no history at all
    elif not sessions[student_id].is_active:
        # Rebuild continuation sessions with the ENDED session's subject and
        # tutor. The old default-Biology rebuild silently teleported students
        # into Biology's current capsule whenever a message arrived after
        # their session ended (AFK sweep, another tab, summary navigation).
        prev = sessions[student_id]
        sessions[student_id] = SessionState(
            student_id, prev.subject,
            tutor_id=getattr(prev, "_tutor_id", None)
            or getattr(prev, "_tutor_id_override", None))
    return sessions[student_id]


# Wire up extracted route modules with shared state
_curriculum_init(sessions)
_student_init(sessions, SessionState, _generate_image, _persist_image, _is_valid_subject)
_voice_init(sessions, SessionState, _generate_image, _persist_image, _is_valid_subject, _GOODBYE_PATTERN, _get_subject_config)


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: str  # accepts email or display_name
    password: str
    turnstile_token: str | None = None


@app.post("/api/login")
async def login(req: LoginRequest, request: Request):
    from helpers import verify_turnstile
    client_ip = request.client.host if request.client else None
    if not verify_turnstile(req.turnstile_token or "", client_ip):
        return JSONResponse({"error": "Human verification failed"}, status_code=400)
    user, token, session_data = authenticate_user(req.email, req.password)
    if not user:
        return JSONResponse({"error": "Invalid credentials"}, status_code=401)
    resp = JSONResponse({
        "student_id": session_data["student_id"],
        "students": session_data["students"],
        "display_name": session_data["display_name"],
    })
    _set_session_cookie(resp, token)
    return resp


@app.post("/api/logout")
async def logout(request: Request):
    token = request.cookies.get("session_token")
    if token and token in auth_sessions:
        del auth_sessions[token]
    resp = JSONResponse({"ok": True})
    _delete_session_cookie(resp)
    return resp


class GoogleLoginRequest(BaseModel):
    credential: str


@app.post("/api/google-login")
async def google_login(req: GoogleLoginRequest):
    """Authenticate via Google OAuth ID token."""
    if not GOOGLE_CLIENT_ID:
        return JSONResponse({"error": "Google login not configured"}, status_code=500)
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        idinfo = google_id_token.verify_oauth2_token(
            req.credential, google_requests.Request(), GOOGLE_CLIENT_ID,
        )
    except ValueError:
        return JSONResponse({"error": "Invalid Google token"}, status_code=401)

    email = idinfo.get("email")
    if not email:
        return JSONResponse({"error": "No email in Google token"}, status_code=400)

    user, token, session_data = authenticate_or_create_google_user(
        email=email,
        first_name=idinfo.get("given_name", ""),
        last_name=idinfo.get("family_name", ""),
        allow_create=False,
    )
    if not user:
        return JSONResponse({"error": "Account not found. Contact your administrator."}, status_code=403)

    resp = JSONResponse(_google_login_response(user, session_data))
    _set_session_cookie(resp, token)
    return resp


@app.post("/api/google-sso")
async def google_sso(req: GoogleLoginRequest):
    """SSO entry point for trusted external sites. Auto-creates users."""
    if not GOOGLE_CLIENT_ID:
        return JSONResponse({"error": "Google login not configured"}, status_code=500)
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        idinfo = google_id_token.verify_oauth2_token(
            req.credential, google_requests.Request(), GOOGLE_CLIENT_ID,
        )
    except ValueError:
        return JSONResponse({"error": "Invalid Google token"}, status_code=401)

    email = idinfo.get("email")
    if not email:
        return JSONResponse({"error": "No email in Google token"}, status_code=400)

    user, token, session_data = authenticate_or_create_google_user(
        email=email,
        first_name=idinfo.get("given_name", ""),
        last_name=idinfo.get("family_name", ""),
        allow_create=True,
    )
    if not user:
        return JSONResponse({"error": "Failed to create session"}, status_code=500)

    resp = JSONResponse(_google_login_response(user, session_data))
    _set_session_cookie(resp, token)
    return resp


def _google_login_response(user: dict, session_data: dict) -> dict:
    """Build a unified response for Google login endpoints.

    Returns both the flat fields (for red-team/admin) and the nested
    student/organization fields (for academy).
    """
    return {
        "student_id": session_data["student_id"],
        "students": session_data["students"],
        "display_name": session_data["display_name"],
        "email": session_data["email"],
        "student": {
            "id": session_data["student_id"] or str(user["id"]),
            "username": user.get("email", ""),
            "email": user.get("email", ""),
            "first_name": user.get("first_name") or "",
            "last_name": user.get("last_name") or "",
        },
        "organization": {
            "id": "zingbee-rt",
            "name": "ZingBee Academy",
            "slug": "zingbee-academy",
        },
    }


@app.get("/api/me")
async def me(request: Request):
    user = require_auth(request)
    return {
        "student_id": user["student_id"],
        "students": user.get("students", []),
        "display_name": user["display_name"],
        "email": user["email"],
    }


class SwitchStudentRequest(BaseModel):
    student_id: str


class CreateStudentRequest(BaseModel):
    name: str


@app.post("/api/create-student")
async def create_student_endpoint(body: CreateStudentRequest, request: Request):
    """Create a new student for the authenticated user."""
    auth = get_auth_user(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    name = body.name.strip()
    if not name:
        return JSONResponse({"error": "Name is required"}, status_code=400)

    # Update user's first_name/last_name from the provided name
    parts = name.split(" ", 1)
    first_name = parts[0]
    last_name = parts[1] if len(parts) > 1 else ""
    database.execute(
        "UPDATE users SET first_name = %s, last_name = %s WHERE id = %s",
        (first_name, last_name, auth["user_id"]),
    )

    row = database.create_student(auth["user_id"])

    # Update auth session's students list
    token = request.cookies.get("session_token")
    new_entry = {"student_id": row["student_id"], "name": name}
    if token and token in auth_sessions:
        auth_sessions[token]["students"].append(new_entry)
        # Switch to the new student automatically
        auth_sessions[token]["student_id"] = row["student_id"]

    return {"status": "ok", "student": new_entry}


@app.post("/api/switch-student")
async def switch_student(body: SwitchStudentRequest, request: Request):
    """Switch the active student in the auth session. Validates ownership."""
    auth = require_student_access(request, body.student_id)
    # Update the auth session's active student (cache + DB)
    token = request.cookies.get("session_token")
    if token and token in auth_sessions:
        auth_sessions[token]["student_id"] = body.student_id
    return {"status": "ok", "student_id": body.student_id}


@app.get("/api/session/{student_id}")
async def get_session_info(student_id: str, request: Request):
    auth = require_student_access(request, student_id)
    session = get_session(student_id)
    return {
        "student_id": student_id,
        "capsule": session.capsule_name,
        "progress": session.progress['current_position'],
        "question_count": session.question_count,
        "correct_count": session.correct_count,
        "total_tokens": session.total_tokens,
        "execution_log": session.execution_log[-20:]  # Last 20 steps
    }


def _log_llm_request(session, delta_msgs, prev_id, streaming=False):
    """Log LLM request to system_log, console, and execution_log."""
    _log_msgs = [{"role": m["role"], "content": m.get("content", "")} for m in delta_msgs[-3:]]
    _attr_pid, _attr_hash = session._current_prompt_attribution()
    session.system_log.append({
        "event": "LLM_REQUEST", "ts": datetime.now().isoformat(),
        "model": session.xai_model, "stateful": bool(prev_id),
        "prompt_id": _attr_pid, "template_hash": _attr_hash,
        "total_messages": len(session.messages),
        "delta_count": len(delta_msgs), "recent_messages": _log_msgs,
    })
    logging.info("=== LLM REQUEST ===  Model: %s | Stateful: %s | Sending %d of %d messages",
                 session.xai_model, bool(prev_id), len(delta_msgs), len(session.messages))
    exec_details = {
        "model": session.xai_model, "temperature": 0.5,
        "prompt_id": _attr_pid, "template_hash": _attr_hash,
        "max_tokens": session.max_tokens, "reasoning_level": REASONING_LEVEL,
        "stateful": bool(prev_id), "previous_response_id": prev_id,
        "message_count": len(session.messages),
        "messages_sent_count": len(delta_msgs),
        "messages_sent": [{"role": m["role"], "content": m.get("content", "")} for m in delta_msgs],
    }
    if streaming:
        exec_details["streaming"] = True
    session.log_execution("LLM_REQUEST", exec_details, agent=session.tutor_name)


def _log_llm_response(session, response, tokens_used, tutor_message, start_time):
    """Log LLM response to execution_log, system_log, and console."""
    _pt = response.usage.prompt_tokens if response and response.usage else 0
    _ct = response.usage.completion_tokens if response and response.usage else 0
    _resp_pid, _resp_hash = session._current_prompt_attribution()
    session.log_execution("LLM_RESPONSE", {
        "response_id": getattr(response, 'id', None),
        "tokens_used": tokens_used, "model": session.xai_model,
        # served_fingerprint = xAI's build hash for the model that actually served this
        # turn. The xai_sdk response exposes NO .model attr, so the prior served_model was
        # always NULL. system_fingerprint is the superior drift signal anyway: it changes
        # when xAI re-trains/re-deploys a build even while the model NAME stays "grok-4.3".
        "served_fingerprint": getattr(response, 'system_fingerprint', None),
        "prompt_id": _resp_pid, "template_hash": _resp_hash,
        "prompt_tokens": _pt, "completion_tokens": _ct,
        "cost_usd": calc_cost(session.xai_model, _pt, _ct),
        "latency_ms": int((time.time() - start_time) * 1000),
        "response_length": len(tutor_message), "full_response": tutor_message,
    }, agent=session.tutor_name)
    session.system_log.append({
        "event": "LLM_RESPONSE", "ts": datetime.now().isoformat(),
        "tokens": tokens_used,
        "latency_ms": int((time.time() - start_time) * 1000),
        "response": tutor_message,
    })
    logging.info("=== LLM RESPONSE ===  %d tokens | %s", tokens_used, tutor_message)


def _parse_tutor_output(tutor_message, session):
    """Parse structured blocks and determine suggestions. Returns (clean_text, image_prompt, suggestions)."""
    parsed = parse_suggestions(tutor_message)
    text = parsed["text"]
    img_parsed = parse_images(text)
    text = img_parsed["text"]
    image_prompt = img_parsed.get("image_prompt")
    tagged = _resolve_session_suggestions(session, parsed["suggestions"])
    return text, image_prompt, engagement.texts(tagged)


# ADO #26: chip matching + suggestion resolution live in engagement.py
# (shared with student_routes and voice_routes)
_match_engagement_chip = engagement.match_for_session
_resolve_session_suggestions = engagement.resolve_for_session


def _generate_and_persist_image(session, tutor_message, image_prompt, assistant_msg_id=None, log_fn=None):
    """Generate companion image and persist to GCS. Returns (image_url, img_result)."""
    step = session.progress.get("current_position", {}).get("step_name", "")
    if step in ("CHECK", "EVIDENCE"):
        return None, None
    image_url, img_result = _generate_image(tutor_message, session, "tutor_response", log_fn, image_prompt=image_prompt)
    if image_url and img_result:
        session.total_tokens += img_result.get("tokens_used", 0)
        _persist_image(image_url, f"tutor_{session.capsule_name}",
                       learning_session_id=session.session_db_id,
                       learning_session_message_id=assistant_msg_id,
                       session=session, topic=session.capsule_name,
                       description=img_result.get("description", ""),
                       style=img_result.get("style", ""),
                       full_prompt=img_result.get("full_prompt", ""),
                       capsule_name=session.capsule_name)
    return image_url, img_result


@app.post("/api/chat")
async def chat(request: ChatRequest, req: Request):
    auth = require_auth(req)
    student_id = auth["student_id"]
    if not student_id:
        return JSONResponse({"error": "No active student selected"}, status_code=400)
    if not verify_student_ownership(auth, student_id):
        return JSONResponse({"error": "Access denied"}, status_code=403)
    try:
        session = get_session(student_id)
    except Exception as e:
        # If the v6 SessionEngine contract has drifted we raise a specific
        # StateMachineContractError from SessionState.__init__ — catch it and
        # return a friendly 503 so the frontend can retry later.
        # Use isinstance only when the exception class was successfully imported
        # at module import time; otherwise re-raise to avoid brittle name checks.
        if StateMachineContractError is not None and isinstance(e, StateMachineContractError):
            logging.exception("StateMachineContractError during session init for student %s: %s", student_id, e)
            return JSONResponse({"error": "Tutor temporarily unavailable due to state-machine mismatch. Please try again shortly."}, status_code=503)
        raise
    user_message = request.message
    log_start_idx = len(session.execution_log)

    start_time = time.time()

    # Log user input
    session.log_execution("USER_INPUT", {
        "message": user_message,
        "length": len(user_message)
    }, agent="Student")

    # === PHASE 1: Assess PREVIOUS exchange ===
    # Run assessment BEFORE the tutor LLM call.  This evaluates the previous
    # tutor response + current student message to determine step transitions,
    # fact progression, and compliance issues.  Any transition instruction is
    # injected into session.messages so it's included in the delta sent to the
    # tutor on THIS turn — eliminating the "one turn behind" problem.
    prev_tutor_msg = session._get_last_assistant_message()

    # ADO #26: clicked engagement chips route deterministically
    chip_intent = _match_engagement_chip(session, user_message)
    _chip_phase = (session._session_engine.current_phase
                   if getattr(session, '_session_engine', None) and session._session_engine.state
                   else None)
    forced_type = engagement.intent_interaction(chip_intent, _chip_phase)
    assessment = session._run_assessment(prev_tutor_msg, user_message,
                                         forced_interaction_type=forced_type)

    # === PHASE 2: Add user message AFTER assessment ===
    session._append_user_message(user_message)

    # === PRE-GEN SHORTCUT: Serve pre-generated content for TEACH steps ===
    _used_pregen = False
    _pregen_image_url = None
    if (hasattr(session, '_session_engine') and session._session_engine
        and session._session_engine.current_phase == "TEACH"
        and session._session_engine.state.get("teach_context") is None):
        _fact_entry = session._session_engine.current_fact_entry
        _pregen_text = _fact_entry.get("pre_gen_explanation")
        _pregen_img = _fact_entry.get("pre_gen_image_url")
        _pregen_sug = _fact_entry.get("pre_gen_suggestions")
        if _pregen_text:
            tutor_message = _pregen_text
            extracted_image_prompt = None
            _tagged = _resolve_session_suggestions(session, _pregen_sug or [])
            suggestions = engagement.texts(_tagged)
            _pregen_image_url = _pregen_img
            _raw_msg_for_db = tutor_message
            session.messages.append({"role": "assistant", "content": tutor_message})
            session.last_response_id = None
            session._messages_synced_idx = len(session.messages)
            session.log_execution("PRE_GEN_SERVED", {
                "explanation_id": _fact_entry.get("pre_gen_explanation_id"),
                "image_id": _fact_entry.get("pre_gen_image_id"),
                "fact_id": _fact_entry.get("id"),
            }, agent="PreGen")
            _used_pregen = True

    if not _used_pregen:
        # === PHASE 3: Call tutor LLM ===
        # Delta includes transition messages + user message.  Stateful mode is
        # preserved — we never break previous_response_id.
        _prev_id = session.last_response_id
        _delta_msgs = session.messages[session._messages_synced_idx:] if _prev_id else session.messages

        _log_llm_request(session, _delta_msgs, _prev_id)

        tokens_used = 0
        try:
            response = call_xai(_delta_msgs, temperature=0.5, max_tokens=session.max_tokens,
                                reasoning=REASONING_LEVEL, model=session.xai_model,
                                previous_response_id=_prev_id,
                                fallback_messages=session.messages if _prev_id else None)

            tutor_message = response.content
            tokens_used = response.usage.total_tokens if response.usage else 0
            session.total_tokens += tokens_used
            _log_llm_response(session, response, tokens_used, tutor_message, start_time)

        except Exception as e:
            session.log_execution("LLM_ERROR", {"error": str(e)}, agent=session.tutor_name)
            return {
                "response": f"Sorry, I had trouble thinking. Error: {str(e)}",
                "execution_log": session.execution_log[-10:],
                "tokens": 0
            }

        # === PHASE 4: Post-processing ===
        # Save raw message (before parsing strips <SUGGESTIONS> blocks)
        _raw_msg_for_db = tutor_message

        # Add response to conversation
        session.messages.append({"role": "assistant", "content": tutor_message})

        # Update stateful conversation tracking
        session.last_response_id = getattr(response, 'id', None)
        session._messages_synced_idx = len(session.messages)

        # Parse structured blocks from response
        tutor_message, extracted_image_prompt, suggestions = _parse_tutor_output(tutor_message, session)

        # Retry once if the tutor forgot the <EDUCATIONAL_IMAGE> tag (skip during CHECK/EVIDENCE)
        current_step_name = session.progress.get("current_position", {}).get("step_name", "")
        if not extracted_image_prompt and XAI_API_KEY and current_step_name not in ("CHECK", "EVIDENCE"):
            session.log_execution("IMAGE_TAG_MISSING", {"action": "retry_with_nudge", "step": current_step_name}, agent=session.tutor_name)
            nudge = (
                "[SYSTEM] Your previous response was missing the <EDUCATIONAL_IMAGE> block. "
                "You MUST include exactly one <EDUCATIONAL_IMAGE>...</EDUCATIONAL_IMAGE> block "
                "containing a vivid, specific image generation prompt for Grok Imagine. "
                "Rewrite your response and include the image block."
            )
            session.messages.append({"role": "system", "content": nudge})
            retry_resp = call_xai(session.messages, temperature=0.5, max_tokens=session.max_tokens,
                                  reasoning=REASONING_LEVEL, model=session.xai_model,
                                  previous_response_id=None)
            retry_msg = retry_resp.content
            session.total_tokens += retry_resp.usage.total_tokens if retry_resp.usage else 0
            session.messages.pop()  # system nudge
            session.messages[-1] = {"role": "assistant", "content": retry_msg}
            session.last_response_id = None
            session._messages_synced_idx = 0
            tutor_message, extracted_image_prompt, suggestions = _parse_tutor_output(retry_msg, session)
            _raw_msg_for_db = retry_msg
            session.log_execution("IMAGE_TAG_RETRY_RESULT", {"has_image_tag": bool(extracted_image_prompt), "step": current_step_name}, agent=session.tutor_name)

    # Save assistant message + generate/persist image
    assistant_msg_id = session._save_assistant_message(_raw_msg_for_db)
    if _used_pregen and _pregen_image_url:
        # Skip runtime image generation — use pre-generated image
        image_url = _pregen_image_url
        img_result = None
    else:
        image_url, img_result = _generate_and_persist_image(session, tutor_message, extracted_image_prompt, assistant_msg_id)

    # Check if user wants to end session (word-boundary match to avoid false positives)
    should_end = bool(_GOODBYE_PATTERN.search(user_message))

    # v6 deferred closure: mirror the stream path — the engine knows when the
    # closure choice has been answered (otherwise clicking "I'm done for today"
    # here would end the engine but never tell the client).
    if not should_end and hasattr(session, '_session_engine') and session._session_engine:
        should_end = session._session_engine.should_end_session()

    if should_end:
        session.log_execution("SESSION_END_REQUESTED", {
            "trigger": "user_goodbye",
            "message": user_message
        }, agent="SessionManager")

    knowledge = session.get_knowledge_stats()

    try:
        session._save_progress()
    except Exception as e:
        logging.warning("_save_progress failed: %s", e)

    return {
        "response": tutor_message,
        "suggestions": suggestions,
        "image_url": image_url,
        "execution_log": session.execution_log[log_start_idx:],
        "tokens": tokens_used,
        "total_tokens": session.total_tokens,
        "stats": {
            "questions": session.question_count,
            "correct": session.correct_count
        },
        "knowledge": knowledge,
        "should_end_session": should_end
    }


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest, req: Request):
    """Unified streaming endpoint for greeting + chat.
    Streams tutor text via SSE tokens, sends done with metadata,
    then generates image and sends it as a separate event."""
    auth = require_auth(req)
    student_id = auth["student_id"]
    if not student_id:
        return JSONResponse({"error": "No active student selected"}, status_code=400)
    if not verify_student_ownership(auth, student_id):
        return JSONResponse({"error": "Access denied"}, status_code=403)

    is_greeting = request.greeting
    user_message = request.message

    # --- Greeting mode: initialize session first ---
    if is_greeting:
        subject = request.subject
        if not _is_valid_subject(subject):
            return JSONResponse({"error": f"Unknown subject: {subject}"}, status_code=400)
        if student_id in sessions and sessions[student_id].is_active:
            sessions[student_id].end_session()
        try:
            sessions[student_id] = SessionState(student_id, subject, tutor_id=request.tutor_id)
        except Exception as e:
            if (StateMachineContractError is not None and isinstance(e, StateMachineContractError)) or e.__class__.__name__ == "StateMachineContractError":
                logging.exception("StateMachineContractError during session init (greeting) for student %s: %s", student_id, e)
                return JSONResponse({"error": "Tutor temporarily unavailable due to state-machine mismatch. Please try again shortly."}, status_code=503)
            raise

    # A chat message for an ended session must NOT silently spawn a new one
    # (it used to — with a default subject — dropping students into Biology
    # mid-thought). Tell the client the session is over; it informs the
    # student and routes to the session-summary screen.
    if not is_greeting and (student_id not in sessions
                            or not sessions[student_id].is_active):
        def expired_sse():
            yield f"data: {json.dumps({'type': 'session_expired', 'message': 'This session has ended.'})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(expired_sse(), media_type="text/event-stream")

    try:
        session = get_session(student_id)
    except Exception as e:
        if (StateMachineContractError is not None and isinstance(e, StateMachineContractError)) or e.__class__.__name__ == "StateMachineContractError":
            logging.exception("StateMachineContractError during session init for student %s: %s", student_id, e)
            return JSONResponse({"error": "Tutor temporarily unavailable due to state-machine mismatch. Please try again shortly."}, status_code=503)
        raise

    def generate_sse():
        start_time = time.time()
        log_start_idx = len(session.execution_log)

        # --- Greeting mode: build student summary and greeting message ---
        student_summary = None
        if is_greeting:
            progress = session.progress
            interactions = progress.get("interactions", [])
            session_history = progress.get("session_history", [])
            is_returning = len(session_history) > 0 or len(interactions) > 0

            student_summary = {
                "student_id": student_id,
                "name": progress.get("name", "Student"),
                "phase": progress["current_position"].get("phase", 1),
                "current_theme": progress["current_position"]["theme_name"],
                "current_capsule": progress["current_position"]["capsule_name"],
                "current_step": progress["current_position"]["step_name"],
                "start_step": session.start_step,
                "total_credits": progress.get("total_credits", 0),
                "completed_capsules": len(progress.get("completed_capsules", [])),
                "total_sessions": len(session_history),
                "total_interactions": len(interactions),
                "last_session": progress.get("last_session", "Never"),
                "is_returning": is_returning,
                "knowledge_points": session.get_knowledge_stats()
            }

            session.log_execution("LOAD_STUDENT", {
                "student_id": student_id,
                "is_returning": is_returning,
                "sessions": student_summary["total_sessions"],
                "interactions": student_summary["total_interactions"]
            }, agent="SessionManager")

            # Build context-aware greeting user message
            if is_returning:
                last = session_history[-1] if session_history else {}
                last_capsule = last.get("capsule", "biology")
                last_correct = last.get("correct_answers", 0)
                last_questions = last.get("questions_answered", 0)
                last_facts = last.get("facts_taught", 0)
                recent = interactions[-3:] if interactions else []
                recent_topics = ", ".join(i.get("topic", "") for i in recent if i.get("topic"))
                nonlocal user_message
                user_message = (
                    f"Hi {session.tutor_name}! I'm back. Last time we worked on \"{last_capsule}\" "
                    f"where I answered {last_correct}/{last_questions} questions and "
                    f"learned {last_facts} facts."
                )
                if recent_topics:
                    user_message += f" We recently talked about: {recent_topics}."
                user_message += " What are we doing today?"
            else:
                user_message = f"Hi {session.tutor_name}! This is my first time. I'm ready to learn about {session.subject_lower} today!"

            session.messages.append({"role": "user", "content": user_message})
            if session.session_db_id:
                try:
                    database.save_learning_session_message(session.session_db_id, "user", user_message)
                except Exception as e:
                    logging.warning("DB save greeting user message failed: %s", e)
        else:
            # Normal chat: log user input and add to messages
            session.log_execution("USER_INPUT", {
                "message": user_message,
                "length": len(user_message)
            }, agent="Student")

        # Immediately tell client we're working
        yield f"data: {json.dumps({'type': 'status', 'content': f'{session.tutor_name} is thinking...'})}\n\n"

        # === PHASE 1 & 2: Skip for greeting (already set up above) ===
        if not is_greeting:
            prev_tutor_msg = session._get_last_assistant_message()

            # === v6 PHASE 0: Quick Classifier (pre-tutor) ===
            # ADO #26: a clicked engagement chip is matched first — deterministic
            # routing, no classifier LLM call needed.
            chip_intent = _match_engagement_chip(session, user_message)
            classifier_result = {"type": "other", "reason": "", "source": "skipped"}
            student_context_injection = None
            try:
                from classifier import classify
                kp = session.progress.get("knowledge_points", {}).get(session.capsule_name, {})
                current_fact = kp.get("current_fact", "")
                current_step = session.progress.get("current_position", {}).get("step_name", "TEACH")
                _classifier_meta = {}
                def _classifier_llm(messages, **kwargs):
                    resp = call_llm(TaskType.CLASSIFIER, messages, **kwargs)
                    _classifier_meta["model"] = resp.model or ""
                    _classifier_meta["provider"] = resp.provider or ""
                    return resp
                if chip_intent:
                    # Keep classifier-vocabulary types so downstream consumers
                    # (student-context injections, CLASSIFIER_ACCURACY logs)
                    # see a known vocabulary; unmapped intents pass through.
                    _chip_to_classifier = {"confused": "confusion",
                                           "ready": "confirmation",
                                           "continue": "confirmation"}
                    classifier_result = {"type": _chip_to_classifier.get(chip_intent, chip_intent),
                                         "reason": "clicked engagement chip",
                                         "source": "chip"}
                else:
                    classifier_result = classify(
                        user_message, current_fact, current_step,
                        prev_tutor_msg, _classifier_llm,
                        session._prompt_engine if hasattr(session, '_prompt_engine') and session._prompt_engine else None
                    )
                _cpt = classifier_result.get("prompt_tokens", 0) or 0
                _cct = classifier_result.get("completion_tokens", 0) or 0
                _cmodel = _classifier_meta.get("model") or classifier_result.get("model", "") or session.xai_model
                _ccost = calc_cost(_cmodel, _cpt, _cct) if (_cpt or _cct) else 0
                session.total_tokens += _cpt + _cct
                session.log_execution("CLASSIFIER", {
                    "type": classifier_result.get("type"),
                    "reason": classifier_result.get("reason"),
                    "source": classifier_result.get("source"),
                    "model": _cmodel,
                    "provider": _classifier_meta.get("provider", ""),
                    "prompt_tokens": _cpt,
                    "completion_tokens": _cct,
                    "cost_usd": _ccost,
                }, agent="Classifier")
                logging.info("═══ CLASSIFIER ═══  type=%s | source=%s | reason=%s",
                             classifier_result.get("type"), classifier_result.get("source"),
                             classifier_result.get("reason") or "")

                # Build student context injection from classifier result
                if session._prompt_engine:
                    student_context_injection = session._prompt_engine.get_student_context_injection(
                        classifier_result.get("type", "other"))
            except Exception as e:
                logging.warning("Quick Classifier failed: %s", e)

            # v6 edge case: uninterpretable message
            if classifier_result.get("type") == "uninterpretable":
                student_context_injection = "Student sent a blank or uninterpretable message. Say: 'I didn't quite catch that! Let's keep going.' Then re-present the current step."

            # v6 edge case: move_on handled before tutor call
            if classifier_result.get("type") == "move_on" and hasattr(session, '_session_engine') and session._session_engine:
                phase = session._session_engine.current_phase
                if phase in ("CHECK", "EVIDENCE"):
                    student_context_injection = "Student wants to move on during " + phase + ". Ask for confirmation: 'Are you sure you want to skip this one? If you move on, we won't count it as mastered. That's totally fine, we can come back next time! Just let me know.'"
                elif phase == "TEACH":
                    student_context_injection = "Student wants to skip ahead. Acknowledge briefly and move to practice."
                elif phase == "TRY":
                    student_context_injection = "Student wants to skip this question. Acknowledge and move on."

            # === PHASE 1: Assess PREVIOUS exchange ===
            _chip_phase = (session._session_engine.current_phase
                           if hasattr(session, '_session_engine') and session._session_engine
                           and session._session_engine.state else None)
            _forced_type = engagement.intent_interaction(chip_intent, _chip_phase)
            assessment = session._run_assessment(prev_tutor_msg, user_message,
                                                 forced_interaction_type=_forced_type)

            # === v6 Position 5: Inject student context from classifier ===
            if student_context_injection:
                session.messages.append({"role": "system", "content": f"<STUDENT_CONTEXT>{student_context_injection}</STUDENT_CONTEXT>"})
                session.log_execution("STUDENT_CONTEXT_INJECTED", {
                    "classifier_type": classifier_result.get("type"),
                    "injection": student_context_injection,
                }, agent="Orchestrator")

            # === PHASE 2: Add user message AFTER assessment ===
            session._append_user_message(user_message)

        # === PHASE 3: Stream tutor LLM ===
        # Calculate delta for stateful conversation
        _prev_id = session.last_response_id
        _delta_msgs = session.messages[session._messages_synced_idx:] if _prev_id else session.messages

        _log_llm_request(session, _delta_msgs, _prev_id, streaming=True)

        # Stream the tutor response (reasoning + content tokens)
        tutor_message = ""
        final_response = None
        try:
            for chunk_type, chunk_text, response in stream_xai(
                _delta_msgs, temperature=0.5, max_tokens=session.max_tokens,
                reasoning=REASONING_LEVEL, model=session.xai_model,
                previous_response_id=_prev_id,
                fallback_messages=session.messages if _prev_id else None
            ):
                if chunk_type == "reasoning" and chunk_text:
                    yield f"data: {json.dumps({'type': 'thinking', 'content': chunk_text})}\n\n"
                elif chunk_type == "content" and chunk_text:
                    tutor_message += chunk_text
                    yield f"data: {json.dumps({'type': 'token', 'content': chunk_text})}\n\n"
                if response is not None:
                    final_response = response
        except Exception as e:
            session.log_execution("LLM_STREAM_ERROR", {"error": str(e)}, agent=session.tutor_name)
            yield f"data: {json.dumps({'type': 'error', 'content': 'Sorry, I had trouble responding. Please try again!'})}\n\n"
            return

        tokens_used = final_response.usage.total_tokens if final_response and final_response.usage else 0
        session.total_tokens += tokens_used
        _log_llm_response(session, final_response, tokens_used, tutor_message, start_time)

        # === Post-LLM: process text, send done IMMEDIATELY, then generate image ===
        suggestions = []
        should_end = False

        raw_tutor_message = tutor_message

        try:
            tutor_message, extracted_image_prompt, suggestions = _parse_tutor_output(tutor_message, session)

            # Add to conversation history
            session.messages.append({"role": "assistant", "content": raw_tutor_message})

            # Update stateful conversation tracking
            session.last_response_id = getattr(final_response, 'id', None)
            session._messages_synced_idx = len(session.messages)

            # Check goodbye (word-boundary match to avoid false positives)
            should_end = bool(_GOODBYE_PATTERN.search(user_message))

            # v6: capsule completion detection. ADO #26: the end is deferred
            # until the student answers the closure choice (recap / done) —
            # should_end_session() handles the closure state machine.
            if hasattr(session, '_session_engine') and session._session_engine:
                if session._session_engine.should_end_session():
                    should_end = True

        except Exception as post_err:
            logging.error("Post-LLM text processing failed: %s", post_err, exc_info=True)

        # --- Send done event IMMEDIATELY with text (no image yet) ---
        try:
            knowledge = session.get_knowledge_stats()
            done_data = {
                'response': tutor_message,
                'suggestions': suggestions,
                'image_url': None,
                'execution_log': session.execution_log[log_start_idx:],
                'tokens': tokens_used,
                'total_tokens': session.total_tokens,
                'stats': {
                    'questions': session.question_count,
                    'correct': session.correct_count
                },
                'knowledge': knowledge,
                'should_end_session': should_end
            }
            if student_summary:
                done_data['student_summary'] = student_summary
            done_payload = {'type': 'done', 'data': done_data}
            yield f"data: {json.dumps(done_payload, default=str)}\n\n"
        except Exception as done_err:
            logging.error("Failed to serialize done event: %s", done_err, exc_info=True)
            fallback = {
                'type': 'done',
                'data': {
                    'response': tutor_message if isinstance(tutor_message, str) else '',
                    'suggestions': [],
                    'image_url': None,
                    'execution_log': [],
                    'tokens': 0,
                    'total_tokens': 0,
                    'stats': {'questions': 0, 'correct': 0},
                    'knowledge': {},
                    'should_end_session': False
                }
            }
            yield f"data: {json.dumps(fallback)}\n\n"

        # --- Generate image AFTER done event (client already has the text) ---
        try:
            _image_logs = []
            def _thread_log(step, details):
                _image_logs.append({"timestamp": datetime.now().isoformat(), "step": step, "agent": "MediaCurator", "details": details})

            assistant_msg_id = session._save_assistant_message(raw_tutor_message)
            image_url, img_result = _generate_and_persist_image(
                session, tutor_message, extracted_image_prompt, assistant_msg_id, _thread_log)

            with session._log_lock:
                session.execution_log.extend(_image_logs)

            yield f"data: {json.dumps({'type': 'image', 'image_url': image_url, 'execution_log': _image_logs})}\n\n"

        except Exception as img_err:
            logging.error("Image generation failed (text already sent): %s", img_err, exc_info=True)
            yield f"data: {json.dumps({'type': 'image', 'image_url': None})}\n\n"

        # === v6 Steps 7-8: Mismatch Detection + Compliance Check (post-tutor) ===
        if not is_greeting:
            try:
                from assessor import detect_mismatch, check_compliance
                # Mismatch detection: classifier vs assessor, redirect phrase scanning
                mismatch = detect_mismatch(assessment, classifier_result, tutor_message)
                if mismatch.get("incorrect_redirect"):
                    session.log_execution("MISMATCH_DETECTED", {
                        "type": "incorrect_redirect",
                        "correction_queued": "question_correction",
                    }, agent="Orchestrator")

                # Compliance check: process assessor compliance flags
                current_step = session.progress.get("current_position", {}).get("step_name", "TEACH")
                compliance = check_compliance(assessment, current_step)
                if compliance.get("pending_correction"):
                    session.log_execution("COMPLIANCE_CORRECTION_QUEUED", {
                        "correction_type": compliance["pending_correction"],
                    }, agent="Orchestrator")
                # Persist observational violation events (missing suggestions /
                # acknowledgment / image …) — previously silently dropped
                for _ev in compliance.get("log_events", []):
                    session.log_execution("COMPLIANCE_VIOLATION", _ev, agent="Assessor")

                # Log classifier accuracy stats
                if classifier_result.get("source") == "llm":
                    assessor_type = assessment.get("interaction_type", "")
                    classifier_type = classifier_result.get("type", "")
                    session.log_execution("CLASSIFIER_ACCURACY", {
                        "classifier": classifier_type,
                        "assessor": assessor_type,
                        "match": not mismatch.get("classifier_assessor_disagree", False),
                    }, agent="Orchestrator")
            except Exception as e:
                logging.warning("v6 post-tutor pipeline failed: %s", e)

        try:
            session._save_progress()
        except Exception as e:
            logging.warning("_save_progress failed: %s", e)

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )



# -----------------------------------------------------------------------
# Extracted routes:
#   Student/session: student_routes.py (reset, end-session, feedback,
#       session-status, student-details, report-card, session-image, greeting)
#   Curriculum: curriculum_routes.py (audits, export, builder, structure,
#       capsule-facts, simulate)
#   Voice: voice_routes.py (voice/session, voice/process-turn, voice/generate-image)
#   Playground: playground_routes.py (playground/*, learning-system/*)
# -----------------------------------------------------------------------


if __name__ == "__main__":
    import socket
    import sys
    import argparse

    parser = argparse.ArgumentParser(description='ZingBee RT Studio - Aris')
    parser.add_argument('--port', type=int, help='Port to run on (default: auto-find)')
    parser.add_argument('--host', default='0.0.0.0', help='Host to bind to')
    parser.add_argument('--ssl-keyfile', default=None, help='SSL key file path')
    parser.add_argument('--ssl-certfile', default=None, help='SSL cert file path')
    args = parser.parse_args()

    # Find an available port
    port = args.port if args.port else 9000
    protocol = "https" if args.ssl_certfile else "http"

    print("")
    print("\033[91m" + "=" * 60 + "\033[0m")
    print("\033[91m  ZingBee RT Studio - Aris\033[0m")
    print("\033[91m" + "=" * 60 + "\033[0m")
    print(f"\033[93m  URL: {protocol}://localhost:{port}\033[0m")
    print("\033[91m" + "=" * 60 + "\033[0m")
    print("")

    uvicorn.run(app, host=args.host, port=port,
                ssl_keyfile=args.ssl_keyfile, ssl_certfile=args.ssl_certfile)
