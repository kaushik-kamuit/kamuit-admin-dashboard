"""Driver-run listing + snapshot (geography + route polyline + assignments)."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_admin
from app.db import um, ka


# redirect_slashes at app level would emit 307s that strip Authorization
# headers on some HTTP clients. Register both "" and "/" explicitly so
# callers can hit either /api/driver-runs or /api/driver-runs/.
router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def list_driver_runs(
    _: str = Depends(require_admin),
    status: Optional[str] = Query(None),
    driver_id: Optional[str] = None,
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
        add("dr.status::text = ?", status)
    if driver_id:
        add("dr.driver_id = ?", driver_id)
    if created_from:
        add("dr.created_at >= ?", created_from)
    if created_to:
        add("dr.created_at <= ?", created_to)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    sql = f"""
        SELECT dr.id::text, dr.driver_id, dr.status::text AS status,
               dr.origin_address, dr.dest_address,
               dr.seats_total, dr.seats_left, dr.max_detour_minutes,
               dr.route_distance_meters, dr.route_duration_seconds,
               dr.created_at, dr.updated_at,
               gc.origin_lat, gc.origin_lng, gc.dest_lat, gc.dest_lng,
               (SELECT COUNT(*) FROM ride_assignments ra WHERE ra.driver_run_id = dr.id) AS assignments_count,
               (SELECT COUNT(*) FROM driver_location_pings p WHERE p.driver_run_id = dr.id) AS pings_count
        FROM driver_runs dr
        LEFT JOIN driver_run_geo_cache gc ON gc.driver_run_id = dr.id
        {where_sql}
        ORDER BY dr.created_at DESC
        LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
    """
    count_sql = f"SELECT COUNT(*) FROM driver_runs dr {where_sql}"

    async with ka().acquire() as c:
        rows = await c.fetch(sql, *args, limit, offset)
        total = await c.fetchval(count_sql, *args)

    driver_ids = list({r["driver_id"] for r in rows if r["driver_id"]})
    names: dict[str, dict] = {}
    if driver_ids:
        async with um().acquire() as c_um:
            urs = await c_um.fetch(
                "SELECT id::text, full_name, email FROM users WHERE id::text = ANY($1)",
                driver_ids,
            )
            names = {u["id"]: dict(u) for u in urs}

    items = [{**dict(r), "driver": names.get(r["driver_id"])} for r in rows]
    return {"total": total, "items": items, "limit": limit, "offset": offset}


@router.get("/{run_id}")
async def driver_run_detail(run_id: UUID, _: str = Depends(require_admin)) -> dict:
    async with ka().acquire() as c:
        run = await c.fetchrow(
            """
            SELECT dr.id::text, dr.driver_id, dr.status::text AS status,
                   dr.origin_address, dr.dest_address,
                   dr.seats_total, dr.seats_left, dr.max_detour_minutes,
                   dr.notes, dr.route_polyline,
                   dr.route_distance_meters, dr.route_duration_seconds,
                   dr.created_at, dr.updated_at,
                   ST_Y(dr.origin_point::geometry) AS origin_lat,
                   ST_X(dr.origin_point::geometry) AS origin_lng,
                   ST_Y(dr.dest_point::geometry)   AS dest_lat,
                   ST_X(dr.dest_point::geometry)   AS dest_lng
            FROM driver_runs dr WHERE dr.id = $1
            """,
            run_id,
        )
        if not run:
            raise HTTPException(404, "driver_run not found")

        schedules = await c.fetch(
            """
            SELECT id::text, date, start_time, end_time, is_completed
            FROM driver_run_schedules WHERE driver_run_id = $1
            ORDER BY date, start_time
            """,
            run_id,
        )
        assignments = await c.fetch(
            """
            SELECT ra.id::text, ra.ride_id::text, ra.assigned_at,
                   ra.pickup_fraction, ra.drop_fraction,
                   r.status::text AS ride_status,
                   r.rider_id, r.pickup_address, r.drop_address,
                   r.seats_requested,
                   ST_Y(r.pickup_point::geometry) AS pickup_lat,
                   ST_X(r.pickup_point::geometry) AS pickup_lng,
                   ST_Y(r.drop_point::geometry)   AS drop_lat,
                   ST_X(r.drop_point::geometry)   AS drop_lng
            FROM ride_assignments ra
            JOIN rides r ON r.id = ra.ride_id
            WHERE ra.driver_run_id = $1
            ORDER BY ra.pickup_fraction NULLS LAST
            """,
            run_id,
        )
        pings_summary = await c.fetchrow(
            """
            SELECT COUNT(*) AS n,
                   MIN(recorded_at) AS first_at,
                   MAX(recorded_at) AS last_at,
                   AVG(speed_mps)  AS avg_speed_mps
            FROM driver_location_pings WHERE driver_run_id = $1
            """,
            run_id,
        )

    user_ids = [run["driver_id"]] + [a["rider_id"] for a in assignments if a["rider_id"]]
    user_ids = list({u for u in user_ids if u})
    users: dict[str, dict] = {}
    if user_ids:
        async with um().acquire() as c_um:
            rows = await c_um.fetch(
                "SELECT id::text, full_name, email FROM users WHERE id::text = ANY($1)",
                user_ids,
            )
            users = {r["id"]: dict(r) for r in rows}

    return {
        "driver_run": {**dict(run), "driver": users.get(run["driver_id"])},
        "schedules": [dict(s) for s in schedules],
        "assignments": [
            {**dict(a), "rider": users.get(a["rider_id"])}
            for a in assignments
        ],
        "pings_summary": dict(pings_summary) if pings_summary else {},
    }
