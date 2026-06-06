"""Cancellation analytics — rates, stage breakdown, repeat cancellers."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from app.auth import TokenPayload, require_role
from app.db import ka

router = APIRouter()


@router.get("/rate-hourly")
async def cancel_rate_hourly(
    hours: int = Query(168, ge=1, le=720),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT hour::text, total_created, total_cancelled, cancel_pct
        FROM v_cancel_rate_hourly
        WHERE hour >= now() - ($1 || ' hours')::interval
        ORDER BY hour
        """,
        str(hours),
    )
    return [dict(r) for r in rows]


@router.get("/rate-daily")
async def cancel_rate_daily(
    days: int = Query(30, ge=1, le=90),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT day::text, total_created, total_cancelled, cancel_pct
        FROM v_cancel_rate_daily
        WHERE day >= (now() - ($1 || ' days')::interval)::date
        ORDER BY day
        """,
        str(days),
    )
    return [dict(r) for r in rows]


@router.get("/by-stage")
async def cancel_by_stage(
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch("SELECT * FROM v_cancel_by_stage")
    return [dict(r) for r in rows]


@router.get("/repeat-cancellers")
async def repeat_cancellers(
    min_count: int = Query(3, ge=2),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT rider_id, cancel_count, late_cancel_count,
               first_cancel::text, last_cancel::text
        FROM v_repeat_cancellers
        WHERE cancel_count >= $1
        ORDER BY cancel_count DESC
        LIMIT 100
        """,
        min_count,
    )
    return [dict(r) for r in rows]


@router.get("/recent")
async def recent_cancellations(
    limit: int = Query(50, ge=1, le=200),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT ride_id::text, cancelled_at::text, cancelled_from,
               actor_hint, rider_id, pickup_address, drop_address,
               seats_requested, seconds_to_cancel,
               ride_created_at::text
        FROM v_ride_cancellations
        ORDER BY cancelled_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/driver-run-cancellations")
async def driver_run_cancellations(
    limit: int = Query(50, ge=1, le=200),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT driver_run_id::text, cancelled_at::text, cancelled_from,
               driver_id, origin_address, dest_address,
               seats_total, seats_left_at_cancel, seconds_to_cancel,
               run_created_at::text
        FROM v_driver_run_cancellations
        ORDER BY cancelled_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/summary")
async def cancellation_summary(
    _user: TokenPayload = Depends(require_role("viewer")),
):
    row = await ka().fetchrow(
        """
        SELECT
            COUNT(*) AS total_cancellations_30d,
            COUNT(*) FILTER (WHERE cancelled_from IN ('ACCEPTED','PICKUP_ARRIVING','IN_PROGRESS'))
                AS late_cancellations_30d,
            ROUND(AVG(seconds_to_cancel)::numeric, 1) AS avg_seconds_to_cancel,
            COUNT(DISTINCT rider_id) AS unique_cancellers
        FROM v_ride_cancellations
        WHERE cancelled_at >= now() - INTERVAL '30 days'
        """
    )
    return dict(row) if row else {}
