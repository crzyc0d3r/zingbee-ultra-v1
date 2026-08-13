"""Quests project routes (demo restoration).

Mounted under /api/projects. Exposes CRUD for student "projects" and the files
attached to them, backed entirely by the isolated `quests` Postgres schema
via `quest_projects_db`.

ISOLATION CONTRACT
------------------
This module is PURELY ADDITIVE. It touches ONLY the Quests world:
  * All persistence goes through `quest_projects_db` (eqdb), whose every query is
    schema-qualified to `quest_projects.*` (and READ-ONLY `public.quests`).
  * It never reads, writes, or ALTERs any Tutors table
    (public.students, public.learning_sessions, public.curriculum_*, etc.).
  * Uploaded file bytes are written under a dedicated, Quests-only uploads
    directory — never into any shared media path used by the tutor system.

File upload handling is demo-grade: text is extracted best-effort for a simple
"embedded" badge in the UI; there is NO vector store / real embedding.
"""

import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

import quest_projects_db as eqdb

log = logging.getLogger(__name__)

eq_projects_router = APIRouter(prefix="/api/projects", tags=["quests-projects"])

# Dedicated, Quests-only uploads directory (api/uploads/quests/...).
# Kept separate from any tutor/generated-media path to preserve isolation.
_UPLOADS_ROOT = os.path.join(os.path.dirname(__file__), "uploads", "quests")

# Extensions we treat as plain UTF-8 text regardless of the reported mime type.
_TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".rtf"}


class ProjectCreate(BaseModel):
    student_id: str
    name: str
    description: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


# ---------------------------------------------------------------------------
# Text extraction (demo-grade, best-effort — never raises)
# ---------------------------------------------------------------------------

def _extract_text(filename: str, content: bytes, mime_type: Optional[str]):
    """Best-effort text extraction from uploaded bytes.

    Returns (extracted_text, is_embedded, embedding_error). Never raises;
    parser problems are reported via embedding_error with is_embedded=False.
    """
    ext = os.path.splitext(filename or "")[1].lower()
    mime = (mime_type or "").lower()

    # Plain text: text/* mime types and common text extensions.
    if ext in _TEXT_EXTS or mime.startswith("text/"):
        return content.decode("utf-8", errors="ignore"), True, None

    # PDF: pypdf, falling back to PyPDF2.
    if ext == ".pdf" or mime == "application/pdf":
        try:
            import io
            try:
                from pypdf import PdfReader
            except ImportError:
                from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(content))
            parts = []
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    parts.append(page_text)
            return "\n\n".join(parts), True, None
        except ImportError:
            return None, False, "pdf parser unavailable"
        except Exception as exc:  # noqa: BLE001 - demo-grade, report and move on
            log.warning("PDF text extraction failed for %s: %s", filename, exc)
            return None, False, f"pdf parse failed: {exc}"

    # DOCX: python-docx (imported as `docx`).
    if ext == ".docx" or mime == (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        try:
            import io
            import docx
            document = docx.Document(io.BytesIO(content))
            text = "\n\n".join(p.text for p in document.paragraphs if p.text.strip())
            return text, True, None
        except ImportError:
            return None, False, "docx parser unavailable"
        except Exception as exc:  # noqa: BLE001 - demo-grade, report and move on
            log.warning("DOCX text extraction failed for %s: %s", filename, exc)
            return None, False, f"docx parse failed: {exc}"

    # Unknown / binary.
    return None, False, "unsupported file type for text extraction"


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@eq_projects_router.get("")
async def list_projects(student_id: str = Query(...)):
    """List a student's projects (newest first, each with file_count)."""
    return eqdb.list_projects(student_id)


@eq_projects_router.post("")
async def create_project(data: ProjectCreate):
    """Create a new project for a student."""
    return eqdb.create_project(data.student_id, data.name, data.description)


@eq_projects_router.get("/{project_id}")
async def get_project(project_id: str):
    """Get a single project (with file_count)."""
    project = eqdb.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@eq_projects_router.put("/{project_id}")
async def update_project(project_id: str, data: ProjectUpdate):
    """Update a project's name and/or description (bumps updated_at)."""
    if eqdb.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return eqdb.update_project(project_id, name=data.name, description=data.description)


@eq_projects_router.delete("/{project_id}")
async def delete_project(project_id: str):
    """Delete a project (its files and project-scoped sessions cascade)."""
    if eqdb.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    eqdb.delete_project(project_id)
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Project files
# ---------------------------------------------------------------------------

@eq_projects_router.get("/{project_id}/files")
async def list_project_files(project_id: str):
    """List a project's files (newest first)."""
    if eqdb.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return eqdb.list_project_files(project_id)


@eq_projects_router.post("/{project_id}/files")
async def upload_project_file(
    project_id: str,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
):
    """Upload a file to a project.

    Persists the raw bytes to the Quests uploads dir and best-effort
    extracts text for the "Embedded" UI badge. No vector store is involved.
    """
    if eqdb.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")

    content = await file.read()
    original_filename = file.filename or "upload"
    mime_type = file.content_type

    extracted_text, is_embedded, embedding_error = _extract_text(
        original_filename, content, mime_type
    )

    # Persist raw bytes: api/uploads/quests/{project_id}/{uuid}_{filename}
    project_dir = os.path.join(_UPLOADS_ROOT, str(project_id))
    os.makedirs(project_dir, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}_{original_filename}"
    file_path = os.path.join(project_dir, stored_name)
    try:
        with open(file_path, "wb") as fh:
            fh.write(content)
    except OSError as exc:
        log.error("Failed to persist upload for project %s: %s", project_id, exc)
        raise HTTPException(status_code=500, detail="Failed to store uploaded file")

    return eqdb.add_project_file(
        project_id,
        name=name or original_filename,
        original_filename=original_filename,
        file_path=file_path,
        file_size=len(content),
        mime_type=mime_type,
        extracted_text=extracted_text,
        is_embedded=is_embedded,
        embedding_error=embedding_error,
    )


@eq_projects_router.delete("/{project_id}/files/{file_id}")
async def delete_project_file(project_id: str, file_id: str):
    """Delete a single file from a project."""
    if eqdb.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    eqdb.delete_project_file(file_id)
    return {"message": "deleted"}
