"""Stripe webhook event relay — receives and stores raw Stripe events."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Query, Request

from app.auth import require_role
from app.db import um

router = APIRouter()


@router.post("/webhook")
async def receive_webhook(request: Request):
    """Unauthenticated endpoint — Stripe hits this directly.
    Stores the raw event for admin inspection. Does NOT process payments."""
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "error": "invalid json"}

    event_id = body.get("id")
    event_type = body.get("type", "unknown")
    api_version = body.get("api_version")
    livemode = body.get("livemode", False)

    try:
        await um().execute("""
            INSERT INTO admin_stripe_events (stripe_event_id, event_type, api_version, livemode, payload)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            ON CONFLICT (stripe_event_id) DO NOTHING
        """, event_id, event_type, api_version, livemode, json.dumps(body))
    except Exception:
        pass

    return {"ok": True}


@router.get("")
async def list_events(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    event_type: str | None = None,
    _user=Depends(require_role("viewer")),
):
    conditions = []
    params: list = []
    idx = 1
    if event_type:
        conditions.append(f"event_type ILIKE ${idx}")
        params.append(f"%{event_type}%")
        idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([limit, offset])
    rows = await um().fetch(f"""
        SELECT id, received_at, stripe_event_id, event_type, api_version, livemode, processed
        FROM admin_stripe_events {where}
        ORDER BY received_at DESC LIMIT ${idx} OFFSET ${idx + 1}
    """, *params)
    total = await um().fetchval(f"SELECT COUNT(*) FROM admin_stripe_events {where}", *params[:-2])
    return {"items": [dict(r) for r in rows], "total": total}


@router.get("/{event_id}")
async def get_event(event_id: int, _user=Depends(require_role("viewer"))):
    row = await um().fetchrow("SELECT * FROM admin_stripe_events WHERE id = $1", event_id)
    if not row:
        return {"error": "not found"}
    return dict(row)
