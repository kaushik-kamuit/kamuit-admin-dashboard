"""Audit log viewer. Admin-only."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.auth import TokenPayload, require_role
from app.db import um

router = APIRouter()


@router.get("")
async def list_entries(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    username: str | None = None,
    action: str | None = None,
    _user: TokenPayload = Depends(require_role("admin")),
):
    conditions = []
    params: list = []
    idx = 1
    if username:
        conditions.append(f"username = ${idx}")
        params.append(username)
        idx += 1
    if action:
        conditions.append(f"action ILIKE ${idx}")
        params.append(f"%{action}%")
        idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([limit, offset])
    rows = await um().fetch(f"""
        SELECT id, ts, username, role, action, resource, resource_id, detail, ip_address
        FROM admin_audit_log {where}
        ORDER BY ts DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """, *params)
    total = await um().fetchval(f"SELECT COUNT(*) FROM admin_audit_log {where}", *params[:-2])
    return {"items": [dict(r) for r in rows], "total": total}
