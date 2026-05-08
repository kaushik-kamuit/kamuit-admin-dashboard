from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_admin
from app.db import um, ka, pa


router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def list_drivers(
    _: str = Depends(require_admin),
    verification_status: Optional[str] = Query(None, description="approved | pending | rejected"),
    is_verified: Optional[bool] = None,
    search: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    where: list[str] = ["ut.name = 'driver'"]
    args: list = []

    if verification_status:
        args.append(verification_status)
        where.append(f"dp.verification_status::text = ${len(args)}")
    if is_verified is not None:
        args.append(is_verified)
        where.append(f"dp.is_verified = ${len(args)}")
    if search:
        args.append(f"%{search}%")
        i = len(args)
        where.append(f"(u.full_name ILIKE ${i} OR u.email ILIKE ${i} OR u.phone_number ILIKE ${i})")

    where_sql = "WHERE " + " AND ".join(where)

    sql = f"""
        SELECT u.id::text, u.full_name, u.email, u.phone_number,
               u.is_active, u.created_at,
               dp.id::text AS driver_profile_id,
               dp.verification_status::text AS verification_status,
               dp.is_verified, dp.accepted_rides, dp.completed_rides,
               dp.denied_rides, dp.experience_years, dp.license_number,
               v.make, v.model, v.year, v.plate_number
        FROM users u
        JOIN usertype ut ON ut.id = u.usertype_id
        LEFT JOIN driver_profiles dp ON dp.user_id = u.id
        LEFT JOIN LATERAL (
            SELECT make, model, year, plate_number
            FROM vehicles vv WHERE vv.driver_id = dp.id
            ORDER BY vv.created_at DESC LIMIT 1
        ) v ON true
        {where_sql}
        ORDER BY u.created_at DESC
        LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
    """
    count_sql = f"""
        SELECT COUNT(*) FROM users u
        JOIN usertype ut ON ut.id = u.usertype_id
        LEFT JOIN driver_profiles dp ON dp.user_id = u.id
        {where_sql}
    """

    async with um().acquire() as c:
        rows = await c.fetch(sql, *args, limit, offset)
        total = await c.fetchval(count_sql, *args)

    driver_ids = [r["id"] for r in rows]

    wallets: dict[str, dict] = {}
    connects: dict[str, dict] = {}
    if driver_ids:
        async with pa().acquire() as c_pa:
            wb = await c_pa.fetch(
                "SELECT driver_id, earnings_cents, credits_cents FROM wallet_balances WHERE driver_id = ANY($1)",
                driver_ids,
            )
            sc = await c_pa.fetch(
                """
                SELECT driver_id, payouts_enabled, details_submitted, account_status
                FROM stripe_connect WHERE driver_id = ANY($1)
                """,
                driver_ids,
            )
        wallets = {r["driver_id"]: dict(r) for r in wb}
        connects = {r["driver_id"]: dict(r) for r in sc}

    completed_by_driver: dict[str, int] = {}
    if driver_ids:
        async with ka().acquire() as c_ka:
            runs = await c_ka.fetch(
                """
                SELECT dr.driver_id, COUNT(DISTINCT ra.ride_id) FILTER (WHERE r.status::text = 'COMPLETED') AS completed
                FROM driver_runs dr
                LEFT JOIN ride_assignments ra ON ra.driver_run_id = dr.id
                LEFT JOIN rides r ON r.id = ra.ride_id
                WHERE dr.driver_id = ANY($1)
                GROUP BY dr.driver_id
                """,
                driver_ids,
            )
            completed_by_driver = {r["driver_id"]: int(r["completed"] or 0) for r in runs}

    items = []
    for r in rows:
        d = dict(r)
        d["wallet"] = wallets.get(d["id"])
        d["stripe_connect"] = connects.get(d["id"])
        d["rides_completed_actual"] = completed_by_driver.get(d["id"], 0)
        items.append(d)

    return {"total": total, "items": items, "limit": limit, "offset": offset}


@router.get("/{user_id}")
async def driver_detail(user_id: UUID, _: str = Depends(require_admin)) -> dict:
    async with um().acquire() as c:
        base = await c.fetchrow(
            """
            SELECT u.id::text, u.full_name, u.email, u.phone_number, u.is_active,
                   u.created_at, u.gender::text AS gender,
                   dp.id::text AS driver_profile_id, dp.license_number, dp.license_url,
                   dp.verification_status::text AS verification_status,
                   dp.is_verified, dp.experience_years,
                   dp.accepted_rides AS counter_accepted,
                   dp.completed_rides AS counter_completed,
                   dp.denied_rides AS counter_denied
            FROM users u
            JOIN usertype ut ON ut.id = u.usertype_id AND ut.name = 'driver'
            LEFT JOIN driver_profiles dp ON dp.user_id = u.id
            WHERE u.id = $1
            """,
            user_id,
        )
        if not base:
            raise HTTPException(404, "driver not found")

        vehicles = await c.fetch(
            """
            SELECT v.* FROM vehicles v
            JOIN driver_profiles dp ON dp.id = v.driver_id
            WHERE dp.user_id = $1
            """,
            user_id,
        )
        verif = await c.fetchrow(
            "SELECT * FROM driver_verifications WHERE user_id = $1", str(user_id)
        )

    uid_s = str(user_id)
    async with ka().acquire() as c_ka:
        runs = await c_ka.fetch(
            """
            SELECT id::text, origin_address, dest_address, seats_total, seats_left,
                   status::text AS status, created_at
            FROM driver_runs WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 50
            """,
            uid_s,
        )
        recent_rides = await c_ka.fetch(
            """
            SELECT r.id::text, r.status::text AS status, r.pickup_address, r.drop_address,
                   r.seats_requested, r.created_at, r.rider_id
            FROM ride_assignments ra
            JOIN rides r ON r.id = ra.ride_id
            JOIN driver_runs dr ON dr.id = ra.driver_run_id
            WHERE dr.driver_id = $1
            ORDER BY r.created_at DESC LIMIT 50
            """,
            uid_s,
        )
        computed_stats = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) FILTER (WHERE r.status::text = 'COMPLETED') AS completed,
              COUNT(*) FILTER (WHERE r.status::text = 'CANCELLED') AS cancelled,
              COUNT(*)                                              AS assigned_total
            FROM ride_assignments ra
            JOIN rides r ON r.id = ra.ride_id
            JOIN driver_runs dr ON dr.id = ra.driver_run_id
            WHERE dr.driver_id = $1
            """,
            uid_s,
        )

    async with pa().acquire() as c_pa:
        wallet = await c_pa.fetchrow(
            "SELECT * FROM wallet_balances WHERE driver_id = $1", uid_s
        )
        txs = await c_pa.fetch(
            "SELECT * FROM wallet_transactions WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 50",
            uid_s,
        )
        connect = await c_pa.fetchrow(
            "SELECT * FROM stripe_connect WHERE driver_id = $1", uid_s
        )

    return {
        "driver": dict(base),
        "vehicles": [dict(v) for v in vehicles],
        "driver_verification": dict(verif) if verif else None,
        "driver_runs": [dict(r) for r in runs],
        "recent_rides": [dict(r) for r in recent_rides],
        "computed_stats": dict(computed_stats) if computed_stats else {},
        "wallet_balance": dict(wallet) if wallet else None,
        "wallet_transactions": [dict(t) for t in txs],
        "stripe_connect": dict(connect) if connect else None,
    }
