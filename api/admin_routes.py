"""Admin CRUD REST API and UI for ZingBee RT Studio.

Provides a /admin UI and /admin/api/* JSON endpoints for managing all DB tables.
Mount this router in the main FastAPI app. Requires session auth (same as main app).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

import admin_db

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Auth dependency - reuses web_ui.py auth_sessions dict
# ---------------------------------------------------------------------------

# Reference set by init_auth() called from web_ui.py after auth_sessions is defined
_auth_sessions = None


def init_auth(auth_sessions_ref: dict):
    """Bind the shared auth_sessions dict. Call from web_ui.py at startup."""
    global _auth_sessions
    _auth_sessions = auth_sessions_ref


def require_auth(request: Request) -> dict:
    """Check session cookie auth. Returns user info dict or None."""
    from datetime import datetime, timezone
    if _auth_sessions is None:
        return None
    token = request.cookies.get("session_token")
    if not token:
        return None
    info = _auth_sessions.get(token)
    if not info:
        return None
    if datetime.now(tz=timezone.utc) > info["expires"]:
        del _auth_sessions[token]
        return None
    return info


# ---------------------------------------------------------------------------
# API endpoints (all require auth)
# ---------------------------------------------------------------------------

@router.get("/api/hierarchy")
async def api_hierarchy(request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    return admin_db.get_hierarchy()


@router.get("/api/stats")
async def api_stats(request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        return admin_db.get_dashboard_stats()
    except Exception as e:
        log.exception("stats failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/tables")
async def api_list_tables(request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        return admin_db.list_tables()
    except Exception as e:
        log.exception("list_tables failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/tables/{table}/schema")
async def api_table_schema(table: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        schema = admin_db.get_table_schema(table)
        fk_options = {}
        for fk in schema.get("fks", []):
            key = fk["col"]
            try:
                fk_options[key] = admin_db.get_fk_options(
                    fk["ref_table"], fk["ref_col"], fk["label_col"]
                )
            except Exception:
                fk_options[key] = []
        schema["fk_options"] = fk_options
        return schema
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        log.exception("table_schema failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/tables/{table}/rows")
async def api_list_rows(
    table: str,
    request: Request,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    order_by: Optional[str] = None,
    order_dir: str = Query("ASC", pattern="^(ASC|DESC)$"),
    search: Optional[str] = None,
    filter_col: Optional[str] = None,
    filter_val: Optional[str] = None,
):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        columns = admin_db.get_table_columns(table)
        search_cols = [c["name"] for c in columns
                       if c["type"] in ("text", "varchar", "name", "bpchar", "uuid")]
        rows = admin_db.list_rows(
            table, limit=limit, offset=offset,
            order_by=order_by, order_dir=order_dir,
            search=search, search_cols=search_cols,
            filter_col=filter_col, filter_val=filter_val,
        )
        total = admin_db.count_rows(
            table, search=search, search_cols=search_cols,
            filter_col=filter_col, filter_val=filter_val,
        )
        fk_labels = admin_db.resolve_fk_labels(table, rows)
        return {"rows": rows, "total": total, "limit": limit, "offset": offset, "fk_labels": fk_labels}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        log.exception("list_rows failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/tables/{table}/rows/{pk:path}")
async def api_get_row(table: str, pk: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        row = admin_db.get_row(table, pk)
        if row is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return row
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        log.exception("get_row failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/api/tables/{table}/rows")
async def api_create_row(table: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        data = await request.json()
        row = admin_db.create_row(table, data)
        return row
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        log.exception("create_row failed")
        detail = getattr(e, "pgerror", str(e))
        return JSONResponse({"error": detail}, status_code=500)


@router.put("/api/tables/{table}/rows/{pk:path}")
async def api_update_row(table: str, pk: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        data = await request.json()
        row = admin_db.update_row(table, pk, data)
        if row is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return row
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        log.exception("update_row failed")
        detail = getattr(e, "pgerror", str(e))
        return JSONResponse({"error": detail}, status_code=500)


@router.delete("/api/tables/{table}/rows/{pk:path}")
async def api_delete_row(table: str, pk: str, request: Request):
    auth = require_auth(request)
    if not auth:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        deleted = admin_db.delete_row(table, pk)
        if not deleted:
            return JSONResponse({"error": "Not found or already deleted"}, status_code=404)
        return {"ok": True}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        log.exception("delete_row failed")
        detail = getattr(e, "pgerror", str(e))
        return JSONResponse({"error": detail}, status_code=500)


# ---------------------------------------------------------------------------
# Admin UI (no auth needed for the HTML shell - JS handles 401 redirects)
# ---------------------------------------------------------------------------

