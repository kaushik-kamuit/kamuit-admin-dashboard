from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.auth import require_admin
from app.db import um, pa


router = APIRouter()


async def _resolve_users(user_ids: list[str]) -> dict[str, dict]:
    if not user_ids:
        return {}
    uniq = list({u for u in user_ids if u})
    async with um().acquire() as c:
        rows = await c.fetch(
            "SELECT id::text, full_name, email, phone_number FROM users WHERE id::text = ANY($1)",
            uniq,
        )
    return {r["id"]: dict(r) for r in rows}


@router.get("/intents")
async def list_intents(
    _: str = Depends(require_admin),
    status: Optional[str] = Query(None, description="succeeded | requires_capture | canceled | failed"),
    passenger_id: Optional[str] = None,
    created_from: Optional[datetime] = None,
    created_to: Optional[datetime] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    where: list[str] = []
    args: list = []

    def add(clause: str, value) -> None:
        args.append(value)
        where.append(clause.replace("?", f"${len(args)}"))

    if status:
        add("status = ?", status)
    if passenger_id:
        add("passenger_id = ?", passenger_id)
    if created_from:
        add("created_at >= ?", created_from)
    if created_to:
        add("created_at <= ?", created_to)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with pa().acquire() as c:
        rows = await c.fetch(
            f"""
            SELECT id::text, stripe_pi_id, passenger_id, preference_id, amount_cents,
                   currency, status, created_at, updated_at
            FROM payment_intents
            {where_sql}
            ORDER BY created_at DESC
            LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
            """,
            *args, limit, offset,
        )
        total = await c.fetchval(
            f"SELECT COUNT(*) FROM payment_intents {where_sql}", *args
        )

    users = await _resolve_users([r["passenger_id"] for r in rows])

    items = [{**dict(r), "passenger": users.get(r["passenger_id"])} for r in rows]
    return {"total": total, "items": items, "limit": limit, "offset": offset}


@router.get("/summary")
async def payment_summary(_: str = Depends(require_admin)) -> dict:
    async with pa().acquire() as c:
        by_status = await c.fetch(
            """
            SELECT status,
                   COUNT(*)                     AS count,
                   COALESCE(SUM(amount_cents),0) AS amount_cents
            FROM payment_intents
            GROUP BY status
            ORDER BY status
            """
        )
        daily = await c.fetch(
            """
            SELECT date_trunc('day', created_at)::date AS day,
                   COUNT(*)                                                        AS total_intents,
                   COUNT(*) FILTER (WHERE status = 'succeeded')                    AS succeeded,
                   COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0) AS gmv_cents
            FROM payment_intents
            WHERE created_at >= now() - INTERVAL '30 days'
            GROUP BY 1
            ORDER BY 1
            """
        )
        wallets = await c.fetch(
            """
            SELECT driver_id, earnings_cents, credits_cents, updated_at
            FROM wallet_balances
            ORDER BY earnings_cents DESC
            LIMIT 25
            """
        )
        connect = await c.fetchrow(
            """
            SELECT COUNT(*)                                  AS total,
                   COUNT(*) FILTER (WHERE payouts_enabled)   AS payouts_enabled,
                   COUNT(*) FILTER (WHERE details_submitted) AS details_submitted
            FROM stripe_connect
            """
        )

    users = await _resolve_users([w["driver_id"] for w in wallets])
    top_wallets = [{**dict(w), "driver": users.get(w["driver_id"])} for w in wallets]

    return {
        "by_status": [dict(r) for r in by_status],
        "daily": [dict(r) for r in daily],
        "top_wallets": top_wallets,
        "stripe_connect": dict(connect) if connect else {},
    }


@router.get("/wallet/{driver_id}")
async def wallet_detail(driver_id: str, _: str = Depends(require_admin)) -> dict:
    async with pa().acquire() as c:
        balance = await c.fetchrow(
            "SELECT * FROM wallet_balances WHERE driver_id = $1", driver_id
        )
        txs = await c.fetch(
            "SELECT * FROM wallet_transactions WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 200",
            driver_id,
        )
        connect = await c.fetchrow(
            "SELECT * FROM stripe_connect WHERE driver_id = $1", driver_id
        )
    users = await _resolve_users([driver_id])
    return {
        "driver": users.get(driver_id),
        "balance": dict(balance) if balance else None,
        "transactions": [dict(t) for t in txs],
        "stripe_connect": dict(connect) if connect else None,
    }
