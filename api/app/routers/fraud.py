"""Fraud signal detection: GPS spoofing, duplicate rides, ghost trips, short trips."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from app.auth import TokenPayload, require_role
from app.db import ka

router = APIRouter()


@router.get("/gps-spoofing")
async def gps_spoofing_signals(
    limit: int = Query(50, ge=1, le=200),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT driver_run_id::text, recorded_at::text, prev_recorded_at::text,
               latitude AS lat, longitude AS lng, prev_lat, prev_lng,
               ROUND(distance_m::numeric, 1) AS distance_m,
               ROUND(dt_seconds::numeric, 1) AS dt_seconds,
               implied_kmh
        FROM v_gps_spoofing_signals
        ORDER BY implied_kmh DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/duplicate-rides")
async def duplicate_rides(
    limit: int = Query(50, ge=1, le=200),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT ride_a::text, ride_b::text, rider_id,
               status_a, status_b,
               created_a::text, created_b::text,
               pickup_a, pickup_b
        FROM v_duplicate_rides
        ORDER BY created_a DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/ghost-trips")
async def ghost_trips(
    limit: int = Query(50, ge=1, le=200),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT ride_id::text, rider_id, pickup_address, drop_address,
               driver_run_id::text, driver_id,
               created_at::text, completed_at::text
        FROM v_ghost_trips
        ORDER BY completed_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/short-trips")
async def suspicious_short_trips(
    limit: int = Query(50, ge=1, le=200),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT ride_id::text, rider_id, pickup_address, drop_address,
               started_at::text, completed_at::text,
               ROUND(duration_seconds::numeric, 1) AS duration_seconds
        FROM v_suspicious_short_trips
        ORDER BY duration_seconds ASC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/summary")
async def fraud_summary(
    _user: TokenPayload = Depends(require_role("viewer")),
):
    gps = await ka().fetchval("SELECT COUNT(*) FROM v_gps_spoofing_signals")
    dupes = await ka().fetchval("SELECT COUNT(*) FROM v_duplicate_rides")
    ghosts = await ka().fetchval("SELECT COUNT(*) FROM v_ghost_trips")
    short = await ka().fetchval("SELECT COUNT(*) FROM v_suspicious_short_trips")
    return {
        "gps_spoofing_signals": gps or 0,
        "duplicate_rides": dupes or 0,
        "ghost_trips": ghosts or 0,
        "suspicious_short_trips": short or 0,
        "total_signals": (gps or 0) + (dupes or 0) + (ghosts or 0) + (short or 0),
    }
