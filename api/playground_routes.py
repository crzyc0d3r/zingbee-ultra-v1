"""Playground and Learning System routes."""

import json
import logging
import time
import uuid as _uuid

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from auth import get_auth_user, require_role
import db as database
from llm import call_xai, stream_xai, _DEFAULT_MODEL, _DEFAULT_FAST_MODEL, _DEFAULT_MAX_TOKENS, REASONING_LEVEL
from tools.media_tool import generate_from_prompt, XAI_API_KEY

router = APIRouter(tags=["playground"])

# Prompt versioning/restore mutate (and expose) the LIVE tutor prompt platform-wide, so
# they require an operator/admin role — NOT just any authenticated session (students/teachers
# authenticate against the same API). Matches metaphor_eval_routes._ALLOWED_ROLES.
_PROMPT_ADMIN_ROLES = {"admin", "operator"}


def _require_operator(request: Request):
    """Return the auth dict, or a JSONResponse 401/403 to return directly from the handler."""
    try:
        return require_role(request, _PROMPT_ADMIN_ROLES)
    except HTTPException as exc:
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


def _bad_uuid(value: str) -> bool:
    try:
        _uuid.UUID(str(value))
        return False
    except (ValueError, AttributeError, TypeError):
        return True


def _author(auth) -> str:
    """Best-effort author label for prompt-version attribution."""
    if isinstance(auth, dict):
        return auth.get("email") or auth.get("display_name") or "unknown"
    return "unknown"


class PlaygroundRequest(BaseModel):
    system_prompt: str = ""
    messages: list = []
    temperature: float = 0.5
    top_p: float = 1.0
    max_tokens: int = 4096
    model: str = _DEFAULT_MODEL


@router.get("/api/playground/agents")
async def playground_agents(request: Request):
    """List tutors with their persona for the playground."""
    auth = get_auth_user(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    # v6: tutors table replaces agents
    rows = database.fetchall("SELECT id, persona FROM tutors ORDER BY create_date")
    result = []
    for r in rows:
        persona = r.get("persona", {}) or {}
        name = persona.get("tutor_name", "Tutor")
        # Load prompts from learning_system_schemas
        schema = database.fetchone("SELECT descision_tree FROM learning_system_schemas LIMIT 1")
        prompts = {}
        if schema and schema.get("descision_tree"):
            pr = schema["descision_tree"].get("prompt_registry", {})
            for k, v in pr.items():
                if isinstance(v, dict) and v.get("template"):
                    prompts[k] = v["template"]
        result.append({
            "id": str(r["id"]), "name": name, "model": _DEFAULT_MODEL,
            "temperature": 0.5, "max_tokens": _DEFAULT_MAX_TOKENS,
            "prompts": prompts, "role": "tutor",
        })
    return result


@router.get("/api/playground/models")
async def playground_models(request: Request):
    """List available models."""
    auth = get_auth_user(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    return [
        {"id": "grok-4.3", "name": "Grok 4.3 (Reasoning)"},
        {"id": "grok-4.20-0309-reasoning", "name": "Grok 4.20 (Reasoning)"},
        {"id": "grok-4-1-fast-reasoning", "name": "Grok 4.1 Fast (Reasoning)"},
        {"id": "grok-4-1-fast-non-reasoning", "name": "Grok 4.1 Fast"},
        {"id": "grok-3-mini", "name": "Grok 3 Mini"},
        {"id": "grok-3", "name": "Grok 3"},
    ]


@router.post("/api/playground/stream")
async def playground_stream(request: PlaygroundRequest, req: Request):
    """Stream an LLM response for the prompt playground."""
    auth = get_auth_user(req)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    # Build messages list with system prompt first
    messages = []
    if request.system_prompt.strip():
        messages.append({"role": "system", "content": request.system_prompt})
    messages.extend(request.messages)

    def generate_sse():
        try:
            for chunk_type, chunk_text, response in stream_xai(
                messages, temperature=request.temperature,
                max_tokens=request.max_tokens, model=request.model
            ):
                if chunk_type == "reasoning" and chunk_text:
                    yield f"data: {json.dumps({'type': 'thinking', 'content': chunk_text})}\n\n"
                elif chunk_type == "content" and chunk_text:
                    yield f"data: {json.dumps({'type': 'token', 'content': chunk_text})}\n\n"
                if response is not None:
                    tokens = response.usage.total_tokens if response.usage else 0
                    yield f"data: {json.dumps({'type': 'done', 'tokens': tokens})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


class ImagineRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "16:9"


@router.post("/api/playground/imagine")
async def playground_imagine(request: ImagineRequest, req: Request):
    """Generate an image using Grok Imagine for the playground."""
    auth = get_auth_user(req)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    if not request.prompt.strip():
        return JSONResponse({"error": "Prompt is required"}, status_code=400)
    try:
        result = json.loads(generate_from_prompt(image_prompt=request.prompt, aspect_ratio=request.aspect_ratio))
        return result
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ----------------------------------------------------------------
# Learning System Schema Editor API
# ----------------------------------------------------------------

@router.get("/api/learning-system/{schema_id}")
async def get_learning_system(schema_id: str, request: Request):
    """Get a learning system schema by ID."""
    auth = get_auth_user(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    row = database.fetchone(
        "SELECT id, name, descision_tree, create_date FROM learning_system_schemas WHERE id = %s",
        (schema_id,))
    if not row:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return {"id": str(row["id"]), "name": row["name"],
            "decision_tree": row["descision_tree"],
            "create_date": row["create_date"].isoformat() if row["create_date"] else None}


@router.get("/api/learning-systems")
async def list_learning_systems(request: Request):
    """List all learning system schemas."""
    auth = get_auth_user(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    rows = database.fetchall("SELECT id, name, create_date FROM learning_system_schemas ORDER BY name")
    return [{"id": str(r["id"]), "name": r["name"],
             "create_date": r["create_date"].isoformat() if r["create_date"] else None} for r in rows]


@router.put("/api/learning-system/{schema_id}")
async def update_learning_system(schema_id: str, request: Request):
    """Update a learning system schema's decision tree."""
    auth = get_auth_user(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    body = await request.json()
    decision_tree = body.get("decision_tree")
    name = body.get("name")
    if decision_tree is not None:
        database.execute(
            "UPDATE learning_system_schemas SET descision_tree = %s WHERE id = %s",
            (json.dumps(decision_tree), schema_id))
    if name is not None:
        database.execute(
            "UPDATE learning_system_schemas SET name = %s WHERE id = %s",
            (name, schema_id))
    return {"status": "ok"}


@router.put("/api/learning-system/{schema_id}/prompt/{prompt_id}")
async def update_prompt(schema_id: str, prompt_id: str, request: Request):
    """Update a single prompt template. Non-destructive: appends a version snapshot.

    The save stays a single fast write to the live prompt_registry; the version
    history is recorded alongside it for diff/rollback (Track A).
    """
    auth = _require_operator(request)
    if isinstance(auth, JSONResponse):
        return auth
    if _bad_uuid(schema_id):
        return JSONResponse({"error": "Invalid schema_id"}, status_code=400)
    body = await request.json()
    template = body.get("template", "")
    # Atomic: live registry write + version snapshot in one transaction, serialized per schema.
    try:
        result = database.apply_prompt_template(
            schema_id, prompt_id, template, author=_author(auth), source="manual")
    except Exception as e:
        logging.exception("update_prompt failed")
        return JSONResponse({"error": "Save failed, please retry"}, status_code=409)
    status = result["status"]
    if status == "schema_not_found":
        return JSONResponse({"error": "Not found"}, status_code=404)
    if status == "prompt_not_found":
        return JSONResponse({"error": f"Prompt '{prompt_id}' not found"}, status_code=404)
    version = result["version"]
    return {"status": "ok", "unchanged": status == "unchanged",
            "version_id": str(version["id"]) if version else None}


@router.get("/api/learning-system/{schema_id}/prompt/{prompt_id}/versions")
async def list_prompt_version_history(schema_id: str, prompt_id: str, request: Request):
    """List version history (metadata, newest first) for one prompt template."""
    auth = _require_operator(request)
    if isinstance(auth, JSONResponse):
        return auth
    if _bad_uuid(schema_id):
        return JSONResponse({"error": "Invalid schema_id"}, status_code=400)
    rows = database.list_prompt_versions(schema_id, prompt_id)
    return [{
        "id": str(r["id"]),
        "content_hash": r["content_hash"],
        "author": r["author"],
        "source": r["source"],
        "note": r["note"],
        "is_live": r["is_live"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    } for r in rows]


@router.get("/api/learning-system/prompt-version/{version_id}")
async def get_prompt_version_detail(version_id: str, request: Request):
    """Full content of a single prompt version (for diff / preview)."""
    auth = _require_operator(request)
    if isinstance(auth, JSONResponse):
        return auth
    if _bad_uuid(version_id):
        return JSONResponse({"error": "Invalid version_id"}, status_code=400)
    r = database.get_prompt_version(version_id)
    if not r:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return {
        "id": str(r["id"]),
        "schema_id": str(r["schema_id"]),
        "prompt_id": r["prompt_id"],
        "content": r["content"],
        "content_hash": r["content_hash"],
        "author": r["author"],
        "source": r["source"],
        "note": r["note"],
        "is_live": r["is_live"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    }


@router.post("/api/learning-system/prompt-version/{version_id}/restore")
async def restore_prompt_version(version_id: str, request: Request):
    """Restore a historical version's content into the live prompt (atomic, instant, no eval)."""
    auth = _require_operator(request)
    if isinstance(auth, JSONResponse):
        return auth
    if _bad_uuid(version_id):
        return JSONResponse({"error": "Invalid version_id"}, status_code=400)
    try:
        result = database.promote_prompt_version(version_id, author=_author(auth))
    except Exception:
        logging.exception("restore_prompt_version failed")
        return JSONResponse({"error": "Restore failed, please retry"}, status_code=409)
    status = result["status"]
    if status in ("version_not_found", "schema_not_found"):
        return JSONResponse({"error": "Version not found"}, status_code=404)
    if status == "prompt_not_found":
        return JSONResponse({"error": "Prompt no longer exists in the live schema"}, status_code=409)
    if status == "unchanged":
        return JSONResponse({"error": "That version is already live"}, status_code=409)
    version = result["version"]
    return {"status": "ok", "version_id": str(version["id"]) if version else None}
