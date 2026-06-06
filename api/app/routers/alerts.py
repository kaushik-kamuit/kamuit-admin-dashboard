"""Alerts API — view and resolve operational alerts."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import TokenPayload, require_role
from app.audit import log_action
from app.db import um

router = APIRouter()


@router.get("")
async def list_alerts(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    severity: str | None = None,
    category: str | None = None,
    open_only: bool = True,
    _user: TokenPayload = Depends(require_role("viewer")),
):
    conditions = []
    params: list = []
    idx = 1
    if open_only:
        conditions.append("resolved_at IS NULL")
    if severity:
        conditions.append(f"severity = ${idx}")
        params.append(severity)
        idx += 1
    if category:
        conditions.append(f"category = ${idx}")
        params.append(category)
        idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([limit, offset])
    rows = await um().fetch(f"""
        SELECT id, ts, severity, category, title, detail, entity_type, entity_id, resolved_at, resolved_by, meta
        FROM admin_alerts {where}
        ORDER BY ts DESC LIMIT ${idx} OFFSET ${idx + 1}
    """, *params)
    total = await um().fetchval(f"SELECT COUNT(*) FROM admin_alerts {where}", *params[:-2])

    counts = await um().fetch("""
        SELECT severity, COUNT(*) AS cnt
        FROM admin_alerts WHERE resolved_at IS NULL
        GROUP BY severity
    """)
    summary = {r["severity"]: r["cnt"] for r in counts}

    return {"items": [dict(r) for r in rows], "total": total, "summary": summary}


@router.post("/{alert_id}/resolve")
async def resolve_alert(alert_id: int, user: TokenPayload = Depends(require_role("operator"))):
    row = await um().fetchrow("SELECT * FROM admin_alerts WHERE id = $1", alert_id)
    if not row:
        raise HTTPException(404, "Alert not found")
    if row["resolved_at"]:
        raise HTTPException(400, "Already resolved")
    await um().execute("""
        UPDATE admin_alerts SET resolved_at = $1, resolved_by = $2 WHERE id = $3
    """, datetime.now(timezone.utc), user.sub, alert_id)
    await log_action(user.sub, "resolve_alert", role=user.role,
                     resource="alert", resource_id=str(alert_id),
                     detail={"category": row["category"], "title": row["title"]})
    return {"ok": True}
