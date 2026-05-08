from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_admin
from app.db import um, ka, pa


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


@router.get("", include_in_schema=False)
@router.get("/")
async def list_rides(
    _: str = Depends(require_admin),
    status: Optional[str] = Query(None),
    rider_id: Optional[str] = None,
    driver_id: Optional[str] = Query(None, description="Filter by driver UUID"),
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
        add("r.status::text = ?", status)
    if rider_id:
        add("r.rider_id = ?", rider_id)
    if driver_id:
        add("dr.driver_id = ?", driver_id)
    if created_from:
        add("r.created_at >= ?", created_from)
    if created_to:
        add("r.created_at <= ?", created_to)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    sql = f"""
        SELECT r.id::text, r.rider_id, r.status::text AS status,
               r.pickup_address, r.drop_address, r.seats_requested,
               r.pickup_otp, r.otp_attempts,
               r.preference_session_id::text AS preference_session_id,
               r.accepted_preference_id::text AS accepted_preference_id,
               r.created_at, r.updated_at,
               ST_Y(r.pickup_point::geometry) AS pickup_lat,
               ST_X(r.pickup_point::geometry) AS pickup_lng,
               ST_Y(r.drop_point::geometry)   AS drop_lat,
               ST_X(r.drop_point::geometry)   AS drop_lng,
               ra.driver_run_id::text AS driver_run_id,
               dr.driver_id AS driver_id
        FROM rides r
        LEFT JOIN ride_assignments ra ON ra.ride_id = r.id
        LEFT JOIN driver_runs dr ON dr.id = ra.driver_run_id
        {where_sql}
        ORDER BY r.created_at DESC
        LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
    """
    count_sql = f"""
        SELECT COUNT(DISTINCT r.id) FROM rides r
        LEFT JOIN ride_assignments ra ON ra.ride_id = r.id
        LEFT JOIN driver_runs dr ON dr.id = ra.driver_run_id
        {where_sql}
    """

    async with ka().acquire() as c:
        rows = await c.fetch(sql, *args, limit, offset)
        total = await c.fetchval(count_sql, *args)

    user_ids = [r["rider_id"] for r in rows] + [r["driver_id"] for r in rows if r["driver_id"]]
    users = await _resolve_users(user_ids)

    items = []
    for r in rows:
        d = dict(r)
        d["rider"] = users.get(d["rider_id"])
        d["driver"] = users.get(d["driver_id"]) if d["driver_id"] else None
        items.append(d)

    return {"total": total, "items": items, "limit": limit, "offset": offset}


@router.get("/{ride_id}")
async def ride_detail(ride_id: UUID, _: str = Depends(require_admin)) -> dict:
    async with ka().acquire() as c:
        ride = await c.fetchrow(
            """
            SELECT r.id::text, r.rider_id, r.status::text AS status,
                   r.pickup_address, r.drop_address, r.seats_requested,
                   r.pickup_otp, r.otp_generated_at, r.otp_attempts,
                   r.payment_method_id, r.notes,
                   r.preference_session_id::text AS preference_session_id,
                   r.accepted_preference_id::text AS accepted_preference_id,
                   r.created_at, r.updated_at,
                   ST_Y(r.pickup_point::geometry) AS pickup_lat,
                   ST_X(r.pickup_point::geometry) AS pickup_lng,
                   ST_Y(r.drop_point::geometry)   AS drop_lat,
                   ST_X(r.drop_point::geometry)   AS drop_lng
            FROM rides r WHERE r.id = $1
            """,
            ride_id,
        )
        if not ride:
            raise HTTPException(404, "ride not found")

        prefs = await c.fetch(
            """
            SELECT rp.id::text, rp.preference_order, rp.is_primary, rp.status,
                   rp.seats_needed, rp.estimated_price, rp.pickup_time, rp.drop_time,
                   rp.payment_intent_id, rp.selected_at, rp.offered_at, rp.responded_at,
                   rp.driver_run_id::text AS driver_run_id,
                   rp.schedule_id::text AS schedule_id,
                   dr.driver_id AS driver_id,
                   dr.origin_address, dr.dest_address, dr.seats_total, dr.seats_left,
                   dr.status::text AS driver_run_status
            FROM ride_preferences rp
            LEFT JOIN driver_runs dr ON dr.id = rp.driver_run_id
            WHERE rp.preference_session_id = $1
            ORDER BY rp.preference_order
            """,
            ride["preference_session_id"],
        )
        assignment = await c.fetchrow(
            """
            SELECT ra.id::text, ra.driver_run_id::text AS driver_run_id,
                   ra.assigned_at, ra.pickup_fraction, ra.drop_fraction,
                   ra.schedule_id::text AS schedule_id,
                   dr.driver_id, dr.origin_address, dr.dest_address
            FROM ride_assignments ra
            JOIN driver_runs dr ON dr.id = ra.driver_run_id
            WHERE ra.ride_id = $1
            """,
            ride_id,
        )

    user_ids = [ride["rider_id"]]
    if assignment and assignment["driver_id"]:
        user_ids.append(assignment["driver_id"])
    for p in prefs:
        if p["driver_id"]:
            user_ids.append(p["driver_id"])
    users = await _resolve_users(user_ids)

    pi_ids = [p["payment_intent_id"] for p in prefs if p["payment_intent_id"]]
    payment_intents: list[dict] = []
    if pi_ids:
        async with pa().acquire() as c_pa:
            pis = await c_pa.fetch(
                """
                SELECT id::text, stripe_pi_id, passenger_id, preference_id,
                       amount_cents, currency, status, created_at, updated_at
                FROM payment_intents WHERE stripe_pi_id = ANY($1)
                """,
                pi_ids,
            )
            payment_intents = [dict(p) for p in pis]

    return {
        "ride": {**dict(ride), "rider": users.get(ride["rider_id"])},
        "preferences": [
            {**dict(p), "driver": users.get(p["driver_id"]) if p["driver_id"] else None}
            for p in prefs
        ],
        "assignment": (
            {**dict(assignment), "driver": users.get(assignment["driver_id"])}
            if assignment else None
        ),
        "payment_intents": payment_intents,
    }
