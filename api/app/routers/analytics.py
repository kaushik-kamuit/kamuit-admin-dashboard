"""
Analytics endpoints powered by the db-extensions:
  - event timelines (rides, driver_runs, preferences)
  - driver location pings / trip replay
  - pickup & drop heatmaps at 500m / 2km / 10km
  - preference funnel
  - derived driver_online_sessions
  - payment reconciliation rollup

All read-only. Every endpoint requires admin auth.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_admin
from app.db import ka, pa, um


router = APIRouter()


# ---------------------------------------------------------------------------
# Timelines
# ---------------------------------------------------------------------------

@router.get("/timeline/ride/{ride_id}")
async def ride_timeline(ride_id: UUID, _: str = Depends(require_admin)) -> dict:
    async with ka().acquire() as c:
        ride = await c.fetchrow(
            """
            SELECT id::text, status::text AS status, rider_id,
                   created_at, updated_at
            FROM rides WHERE id = $1
            """,
            ride_id,
        )
        if not ride:
            raise HTTPException(404, "ride not found")

        status_events = await c.fetch(
            """
            SELECT from_status, to_status, reason_code, occurred_at,
                   otp_attempts, seats_requested
            FROM ride_status_events
            WHERE ride_id = $1
            ORDER BY occurred_at
            """,
            ride_id,
        )
        otp_events = await c.fetch(
            """
            SELECT attempt_number, ride_status_at, generated_at, occurred_at
            FROM otp_attempt_events
            WHERE ride_id = $1
            ORDER BY occurred_at
            """,
            ride_id,
        )
        assign_events = await c.fetch(
            """
            SELECT event_type, driver_run_id::text, schedule_id::text,
                   pickup_fraction, drop_fraction, occurred_at
            FROM assignment_events
            WHERE ride_id = $1
            ORDER BY occurred_at
            """,
            ride_id,
        )
        pref_session_id = await c.fetchval(
            "SELECT preference_session_id FROM rides WHERE id = $1",
            ride_id,
        )
        pref_events: list = []
        if pref_session_id:
            pref_events = await c.fetch(
                """
                SELECT preference_id::text, from_status, to_status, reason_code,
                       occurred_at
                FROM preference_status_events
                WHERE session_id = $1
                ORDER BY occurred_at
                """,
                pref_session_id,
            )

    return {
        "ride": dict(ride),
        "status_events": [dict(r) for r in status_events],
        "otp_events": [dict(r) for r in otp_events],
        "assignment_events": [dict(r) for r in assign_events],
        "preference_events": [dict(r) for r in pref_events],
    }


@router.get("/timeline/driver-run/{run_id}")
async def driver_run_timeline(run_id: UUID, _: str = Depends(require_admin)) -> dict:
    async with ka().acquire() as c:
        run = await c.fetchrow(
            """
            SELECT id::text, driver_id, status::text AS status,
                   origin_address, dest_address, seats_total, seats_left,
                   route_distance_meters, route_duration_seconds,
                   created_at, updated_at
            FROM driver_runs WHERE id = $1
            """,
            run_id,
        )
        if not run:
            raise HTTPException(404, "driver_run not found")

        status_events = await c.fetch(
            """
            SELECT from_status, to_status, reason_code, seats_left, seats_total,
                   occurred_at
            FROM driver_run_status_events
            WHERE driver_run_id = $1
            ORDER BY occurred_at
            """,
            run_id,
        )
        assignments = await c.fetch(
            """
            SELECT ra.id::text, ra.ride_id::text, ra.assigned_at,
                   ra.pickup_fraction, ra.drop_fraction,
                   r.status::text AS ride_status,
                   r.pickup_address, r.drop_address
            FROM ride_assignments ra
            JOIN rides r ON r.id = ra.ride_id
            WHERE ra.driver_run_id = $1
            ORDER BY ra.pickup_fraction NULLS LAST
            """,
            run_id,
        )

    return {
        "driver_run": dict(run),
        "status_events": [dict(r) for r in status_events],
        "assignments": [dict(r) for r in assignments],
    }


# ---------------------------------------------------------------------------
# Trip replay (pings)
# ---------------------------------------------------------------------------

@router.get("/pings/driver-run/{run_id}")
async def pings_for_run(
    run_id: UUID,
    _: str = Depends(require_admin),
    limit: int = Query(2000, ge=1, le=20000),
) -> dict:
    async with ka().acquire() as c:
        run = await c.fetchrow(
            """
            SELECT dr.id::text, dr.driver_id,
                   ST_Y(dr.origin_point::geometry) AS origin_lat,
                   ST_X(dr.origin_point::geometry) AS origin_lng,
                   ST_Y(dr.dest_point::geometry)   AS dest_lat,
                   ST_X(dr.dest_point::geometry)   AS dest_lng,
                   dr.origin_address, dr.dest_address, dr.route_polyline
            FROM driver_runs dr WHERE dr.id = $1
            """,
            run_id,
        )
        if not run:
            raise HTTPException(404, "driver_run not found")

        pings = await c.fetch(
            """
            SELECT id, latitude, longitude, heading, speed_mps,
                   route_fraction, accuracy_meters, source, recorded_at
            FROM driver_location_pings
            WHERE driver_run_id = $1
            ORDER BY recorded_at
            LIMIT $2
            """,
            run_id, limit,
        )

    return {
        "driver_run": dict(run),
        "pings": [dict(p) for p in pings],
        "ping_count": len(pings),
    }


# ---------------------------------------------------------------------------
# Heatmaps
# ---------------------------------------------------------------------------

CELL_SIZE_DEG = {"500m": 0.005, "2km": 0.020, "10km": 0.100}


@router.get("/heatmap/rides")
async def rides_heatmap(
    _: str = Depends(require_admin),
    side: str = Query("pickup", pattern="^(pickup|drop)$"),
    resolution: str = Query("2km", pattern="^(500m|2km|10km)$"),
    status: Optional[str] = Query(None),
    created_from: Optional[datetime] = None,
    created_to: Optional[datetime] = None,
) -> dict:
    col = f"{side}_cell_{resolution}"
    lat_col = f"{side}_lat"
    lng_col = f"{side}_lng"
    grid_deg = CELL_SIZE_DEG[resolution]

    where = [f"c.{col} IS NOT NULL"]
    args: list = []
    if status:
        args.append(status)
        where.append(f"r.status::text = ${len(args)}")
    if created_from:
        args.append(created_from)
        where.append(f"r.created_at >= ${len(args)}")
    if created_to:
        args.append(created_to)
        where.append(f"r.created_at <= ${len(args)}")

    args.append(grid_deg)
    grid_param_idx = len(args)

    sql = f"""
        SELECT c.{col} AS cell_key,
               admin_cell_center_lat(c.{col}, ${grid_param_idx}) AS center_lat,
               admin_cell_center_lng(c.{col}, ${grid_param_idx}) AS center_lng,
               AVG(c.{lat_col}) AS avg_lat,
               AVG(c.{lng_col}) AS avg_lng,
               COUNT(*)         AS n
        FROM ride_geo_cache c
        JOIN rides r ON r.id = c.ride_id
        WHERE {' AND '.join(where)}
        GROUP BY c.{col}
        ORDER BY n DESC
        LIMIT 5000
    """

    async with ka().acquire() as c:
        rows = await c.fetch(sql, *args)
    return {
        "side": side,
        "resolution": resolution,
        "cell_size_degrees": grid_deg,
        "cells": [dict(r) for r in rows],
    }


@router.get("/heatmap/driver-runs")
async def driver_runs_heatmap(
    _: str = Depends(require_admin),
    side: str = Query("origin", pattern="^(origin|dest)$"),
    resolution: str = Query("2km", pattern="^(500m|2km|10km)$"),
) -> dict:
    col = f"{side}_cell_{resolution}"
    lat_col = f"{side}_lat"
    lng_col = f"{side}_lng"
    grid_deg = CELL_SIZE_DEG[resolution]

    sql = f"""
        SELECT c.{col} AS cell_key,
               admin_cell_center_lat(c.{col}, $1) AS center_lat,
               admin_cell_center_lng(c.{col}, $1) AS center_lng,
               AVG(c.{lat_col}) AS avg_lat,
               AVG(c.{lng_col}) AS avg_lng,
               COUNT(*)         AS n
        FROM driver_run_geo_cache c
        WHERE c.{col} IS NOT NULL
        GROUP BY c.{col}
        ORDER BY n DESC
        LIMIT 5000
    """

    async with ka().acquire() as c:
        rows = await c.fetch(sql, grid_deg)
    return {
        "side": side,
        "resolution": resolution,
        "cell_size_degrees": grid_deg,
        "cells": [dict(r) for r in rows],
    }


@router.get("/heatmap/pings")
async def pings_heatmap(
    _: str = Depends(require_admin),
    resolution: str = Query("2km", pattern="^(500m|2km|10km)$"),
    recorded_from: Optional[datetime] = None,
    recorded_to: Optional[datetime] = None,
) -> dict:
    col = f"cell_{resolution}"
    grid_deg = CELL_SIZE_DEG[resolution]

    where = [f"{col} IS NOT NULL"]
    args: list = [grid_deg]
    if recorded_from:
        args.append(recorded_from)
        where.append(f"recorded_at >= ${len(args)}")
    if recorded_to:
        args.append(recorded_to)
        where.append(f"recorded_at <= ${len(args)}")

    sql = f"""
        SELECT {col} AS cell_key,
               admin_cell_center_lat({col}, $1) AS center_lat,
               admin_cell_center_lng({col}, $1) AS center_lng,
               AVG(latitude)  AS avg_lat,
               AVG(longitude) AS avg_lng,
               AVG(speed_mps) AS avg_speed_mps,
               COUNT(*)       AS n
        FROM driver_location_pings
        WHERE {' AND '.join(where)}
        GROUP BY {col}
        ORDER BY n DESC
        LIMIT 10000
    """

    async with ka().acquire() as c:
        rows = await c.fetch(sql, *args)
    return {
        "resolution": resolution,
        "cell_size_degrees": grid_deg,
        "cells": [dict(r) for r in rows],
    }


# ---------------------------------------------------------------------------
# Preference funnel
# ---------------------------------------------------------------------------

@router.get("/funnel/preferences")
async def preference_funnel(
    _: str = Depends(require_admin),
    since_days: int = Query(30, ge=1, le=365),
) -> dict:
    async with ka().acquire() as c:
        rows = await c.fetch(
            """
            SELECT to_status AS status,
                   COUNT(*) AS transitions,
                   COUNT(DISTINCT preference_id) AS distinct_prefs
            FROM preference_status_events
            WHERE occurred_at >= now() - ($1 || ' days')::interval
            GROUP BY to_status
            ORDER BY transitions DESC
            """,
            str(since_days),
        )
        sessions = await c.fetch(
            """
            SELECT
              COUNT(*)                              AS sessions,
              SUM(CASE WHEN converted THEN 1 ELSE 0 END) AS converted,
              AVG(candidates_shown)                 AS avg_candidates,
              AVG(CASE WHEN converted THEN 1 ELSE 0 END)::float AS conversion_rate
            FROM inferred_searches
            """
        )
    return {
        "status_breakdown": [dict(r) for r in rows],
        "session_summary": dict(sessions[0]) if sessions else {},
        "note": "inferred_searches is a proxy — searches that returned zero matches are NOT captured "
                "because the matching service does not persist search telemetry.",
    }


# ---------------------------------------------------------------------------
# Driver online sessions (heartbeat-inferred)
# ---------------------------------------------------------------------------

@router.get("/sessions/drivers")
async def driver_sessions(
    _: str = Depends(require_admin),
    driver_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
) -> dict:
    where = []
    args: list = []
    if driver_id:
        args.append(driver_id)
        where.append(f"driver_id = ${len(args)}")
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    sql = f"""
        SELECT id, driver_id, started_at, ended_at, total_seconds,
               pings_count, start_lat, start_lng, end_lat, end_lng
        FROM driver_online_sessions
        {where_sql}
        ORDER BY started_at DESC
        LIMIT ${len(args) + 1}
    """

    async with ka().acquire() as c:
        rows = await c.fetch(sql, *args, limit)
        agg = await c.fetchrow(
            """
            SELECT COUNT(*) AS sessions,
                   COUNT(DISTINCT driver_id) AS drivers,
                   COALESCE(SUM(total_seconds), 0)::bigint AS total_seconds,
                   COALESCE(AVG(total_seconds), 0)::bigint AS avg_seconds
            FROM driver_online_sessions
            """
        )

    return {
        "summary": dict(agg) if agg else {},
        "sessions": [dict(r) for r in rows],
    }


# ---------------------------------------------------------------------------
# Payment reconciliation (cross-DB)
# ---------------------------------------------------------------------------

@router.get("/recon/drivers")
async def driver_reconciliation(
    _: str = Depends(require_admin),
    limit: int = Query(50, ge=1, le=500),
) -> dict:
    async with pa().acquire() as c_pa:
        settlement = await c_pa.fetch(
            """
            SELECT s.*, wb.earnings_cents AS current_earnings_cents,
                   wb.credits_cents AS current_credits_cents
            FROM v_driver_settlement s
            LEFT JOIN wallet_balances wb ON wb.driver_id = s.driver_id
            ORDER BY earnings_in_cents DESC NULLS LAST
            LIMIT $1
            """,
            limit,
        )
        daily = await c_pa.fetch(
            "SELECT day, status, intents, total_cents FROM v_payment_intent_daily ORDER BY day DESC LIMIT 200"
        )

    driver_ids = [s["driver_id"] for s in settlement if s["driver_id"]]
    names: dict[str, dict] = {}
    if driver_ids:
        async with um().acquire() as c_um:
            users = await c_um.fetch(
                "SELECT id::text, full_name, email FROM users WHERE id::text = ANY($1)",
                driver_ids,
            )
            names = {u["id"]: dict(u) for u in users}

    return {
        "settlement": [
            {**dict(s), "user": names.get(s["driver_id"])} for s in settlement
        ],
        "payment_intents_daily": [dict(r) for r in daily],
    }
