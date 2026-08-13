"""Quest routes for the academy client.

Provides CRUD for quests and quest prompts with i18n support.
Endpoints are mounted under /api/quests.
"""

import json
import logging
import uuid
from typing import Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import db as database

log = logging.getLogger(__name__)

quest_router = APIRouter(prefix="/api/quests", tags=["quests"])


class QuestCreate(BaseModel):
    title: Dict[str, str]
    description: Dict[str, str]
    icon: str
    color: str
    bg_color: str
    border_color: str
    href: str
    assistant_id: Optional[str] = None
    voice_prompt: Optional[str] = None


class QuestUpdate(BaseModel):
    title: Optional[Dict[str, str]] = None
    description: Optional[Dict[str, str]] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    bg_color: Optional[str] = None
    border_color: Optional[str] = None
    href: Optional[str] = None
    assistant_id: Optional[str] = None
    voice_prompt: Optional[str] = None


class QuestPromptCreate(BaseModel):
    prompt_text: Dict[str, str]


class QuestPromptUpdate(BaseModel):
    prompt_text: Dict[str, str]


def _translate(field, lang: str) -> str:
    """Get translated text from a JSONB field, falling back to English."""
    if isinstance(field, dict):
        return field.get(lang) or field.get("en") or next(iter(field.values()), "")
    return str(field) if field else ""


# ---------------------------------------------------------------------------
# Quests
# ---------------------------------------------------------------------------

@quest_router.get("/")
async def list_quests(skip: int = 0, limit: int = 100, lang: str = "en"):
    """Retrieve quests with translated title/description."""
    rows = database.fetchall(
        "SELECT * FROM quests ORDER BY created_at OFFSET %s LIMIT %s",
        (skip, limit),
    )
    return [
        {
            "id": str(r["id"]),
            "title": _translate(r["title"], lang),
            "description": _translate(r["description"], lang),
            "icon": r["icon"],
            "color": r["color"],
            "bg_color": r["bg_color"],
            "border_color": r["border_color"],
            "href": r["href"],
            "assistant_id": r.get("assistant_id"),
            "voice_prompt": r.get("voice_prompt"),
            "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
        }
        for r in rows
    ]


@quest_router.get("/{quest_id}")
async def get_quest(quest_id: str, lang: str = "en"):
    """Get a single quest by ID."""
    r = database.fetchone("SELECT * FROM quests WHERE id = %s", (quest_id,))
    if not r:
        raise HTTPException(status_code=404, detail="Quest not found")
    return {
        "id": str(r["id"]),
        "title": _translate(r["title"], lang),
        "description": _translate(r["description"], lang),
        "icon": r["icon"],
        "color": r["color"],
        "bg_color": r["bg_color"],
        "border_color": r["border_color"],
        "href": r["href"],
        "assistant_id": r.get("assistant_id"),
        "voice_prompt": r.get("voice_prompt"),
        "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
    }


@quest_router.get("/{quest_id}/prompts")
async def get_quest_prompts(quest_id: str, limit: int = 4, lang: str = "en"):
    """Retrieve random starter prompts for a quest, translated."""
    r = database.fetchone("SELECT id FROM quests WHERE id = %s", (quest_id,))
    if not r:
        raise HTTPException(status_code=404, detail="Quest not found")

    rows = database.fetchall(
        "SELECT * FROM quest_prompts WHERE quest_id = %s ORDER BY random() LIMIT %s",
        (quest_id, limit),
    )
    return [
        {
            "id": str(row["id"]),
            "quest_id": str(row["quest_id"]),
            "prompt_text": _translate(row["prompt_text"], lang),
            "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Quest CRUD (admin)
# ---------------------------------------------------------------------------

@quest_router.post("/")
async def create_quest(data: QuestCreate):
    """Create a new quest with translations."""
    quest_id = str(uuid.uuid4())
    r = database.fetchone(
        """INSERT INTO quests (id, title, description, icon, color, bg_color, border_color, href, assistant_id, voice_prompt)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           RETURNING *""",
        (quest_id, json.dumps(data.title), json.dumps(data.description),
         data.icon, data.color, data.bg_color, data.border_color,
         data.href, data.assistant_id, data.voice_prompt),
    )
    return {**r, "id": str(r["id"])}


@quest_router.put("/{quest_id}")
async def update_quest(quest_id: str, data: QuestUpdate):
    """Update a quest."""
    existing = database.fetchone("SELECT id FROM quests WHERE id = %s", (quest_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="Quest not found")

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clauses = []
    values = []
    for field, value in updates.items():
        set_clauses.append(f"{field} = %s")
        values.append(json.dumps(value) if isinstance(value, dict) else value)
    values.append(quest_id)

    r = database.fetchone(
        f"UPDATE quests SET {', '.join(set_clauses)} WHERE id = %s RETURNING *",
        tuple(values),
    )
    return {**r, "id": str(r["id"])}


@quest_router.delete("/{quest_id}")
async def delete_quest(quest_id: str):
    """Delete a quest."""
    existing = database.fetchone("SELECT id FROM quests WHERE id = %s", (quest_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="Quest not found")
    database.execute("DELETE FROM quests WHERE id = %s", (quest_id,))
    return {"message": "Quest deleted successfully"}


# ---------------------------------------------------------------------------
# Quest Prompt CRUD (admin)
# ---------------------------------------------------------------------------

@quest_router.post("/{quest_id}/prompts")
async def create_quest_prompt(quest_id: str, data: QuestPromptCreate):
    """Create a new prompt for a quest."""
    existing = database.fetchone("SELECT id FROM quests WHERE id = %s", (quest_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="Quest not found")

    prompt_id = str(uuid.uuid4())
    r = database.fetchone(
        """INSERT INTO quest_prompts (id, quest_id, prompt_text)
           VALUES (%s, %s, %s) RETURNING *""",
        (prompt_id, quest_id, json.dumps(data.prompt_text)),
    )
    return {**r, "id": str(r["id"]), "quest_id": str(r["quest_id"])}


@quest_router.put("/{quest_id}/prompts/{prompt_id}")
async def update_quest_prompt(quest_id: str, prompt_id: str, data: QuestPromptUpdate):
    """Update a quest prompt."""
    existing = database.fetchone(
        "SELECT id FROM quest_prompts WHERE id = %s AND quest_id = %s",
        (prompt_id, quest_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Prompt not found")

    r = database.fetchone(
        "UPDATE quest_prompts SET prompt_text = %s WHERE id = %s AND quest_id = %s RETURNING *",
        (json.dumps(data.prompt_text), prompt_id, quest_id),
    )
    return {**r, "id": str(r["id"]), "quest_id": str(r["quest_id"])}


@quest_router.delete("/{quest_id}/prompts/{prompt_id}")
async def delete_quest_prompt(quest_id: str, prompt_id: str):
    """Delete a quest prompt."""
    existing = database.fetchone(
        "SELECT id FROM quest_prompts WHERE id = %s AND quest_id = %s",
        (prompt_id, quest_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Prompt not found")
    database.execute("DELETE FROM quest_prompts WHERE id = %s", (prompt_id,))
    return {"message": "Prompt deleted successfully"}
