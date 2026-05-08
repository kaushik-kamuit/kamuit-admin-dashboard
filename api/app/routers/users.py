from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_admin
from app.db import um


router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def list_users(
    _: str = Depends(require_admin),
    role: Optional[str] = Query(None, description="driver | passenger | admin"),
    verified_email: Optional[bool] = None,
    verified_phone: Optional[bool] = None,
    auth_provider: Optional[str] = None,
    search: Optional[str] = Query(None, description="full_name / email / phone"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    where_clauses: list[str] = []
    args: list = []

    def add(clause: str, value) -> None:
        args.append(value)
        where_clauses.append(clause.replace("?", f"${len(args)}"))

    if role:
        add("ut.name = ?", role)
    if verified_email is not None:
        add("u.is_email_verified = ?", verified_email)
    if verified_phone is not None:
        add("u.is_phone_verified = ?", verified_phone)
    if auth_provider:
        add("u.auth_provider = ?", auth_provider)
    if search:
        args.append(f"%{search}%")
        i = len(args)
        where_clauses.append(f"(u.full_name ILIKE ${i} OR u.email ILIKE ${i} OR u.phone_number ILIKE ${i})")

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    sql = f"""
        SELECT u.id::text, u.full_name, u.email, u.phone_number,
               u.is_active, u.is_email_verified, u.is_phone_verified,
               u.auth_provider, u.gender::text AS gender,
               u.created_at, ut.name AS role
        FROM users u
        LEFT JOIN usertype ut ON ut.id = u.usertype_id
        {where_sql}
        ORDER BY u.created_at DESC
        LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
    """
    count_sql = f"SELECT COUNT(*) FROM users u LEFT JOIN usertype ut ON ut.id = u.usertype_id {where_sql}"

    async with um().acquire() as c:
        rows = await c.fetch(sql, *args, limit, offset)
        total = await c.fetchval(count_sql, *args)

    return {
        "total": total,
        "items": [dict(r) for r in rows],
        "limit": limit,
        "offset": offset,
    }


@router.get("/{user_id}")
async def get_user(user_id: UUID, _: str = Depends(require_admin)) -> dict:
    async with um().acquire() as c:
        user = await c.fetchrow(
            """
            SELECT u.id::text, u.full_name, u.email, u.phone_number,
                   u.is_active, u.is_email_verified, u.is_phone_verified,
                   u.auth_provider, u.gender::text AS gender, u.date_of_birth,
                   u.created_at, u.updated_at, ut.name AS role
            FROM users u
            LEFT JOIN usertype ut ON ut.id = u.usertype_id
            WHERE u.id = $1
            """,
            user_id,
        )
        if not user:
            raise HTTPException(404, "user not found")

        driver_profile = await c.fetchrow(
            """
            SELECT id::text, license_number, license_url, accepted_rides, completed_rides,
                   denied_rides, verification_status::text AS verification_status,
                   is_verified, experience_years, created_at
            FROM driver_profiles WHERE user_id = $1
            """,
            user_id,
        )
        passenger_profile = await c.fetchrow(
            "SELECT id::text, created_at FROM passenger_profiles WHERE user_id = $1", user_id,
        )
        verif = await c.fetchrow(
            """
            SELECT is_verified, verified_at, last_error, stripe_session_id, created_at, updated_at
            FROM driver_verifications WHERE user_id = $1
            """,
            str(user_id),
        )
        vehicles = await c.fetch(
            """
            SELECT v.id::text, v.vin, v.year, v.make, v.model, v.color, v.plate_number,
                   v.plate_state, v.verification_status::text AS verification_status,
                   v.vin_verified, v.insurance_verified, v.doc_verified, v.history_verified
            FROM vehicles v
            JOIN driver_profiles dp ON dp.id = v.driver_id
            WHERE dp.user_id = $1
            """,
            user_id,
        )
        socials = await c.fetch(
            "SELECT provider, provider_user_id, email, created_at FROM social_accounts WHERE user_id = $1",
            user_id,
        )
        prefs = await c.fetch(
            """
            SELECT label, custom_name, address, lat, lng, building_type, created_at
            FROM preferred_locations WHERE user_id = $1
            ORDER BY display_order NULLS LAST, created_at
            """,
            user_id,
        )

    return {
        "user": dict(user),
        "driver_profile": dict(driver_profile) if driver_profile else None,
        "passenger_profile": dict(passenger_profile) if passenger_profile else None,
        "driver_verification": dict(verif) if verif else None,
        "vehicles": [dict(v) for v in vehicles],
        "social_accounts": [dict(s) for s in socials],
        "preferred_locations": [dict(p) for p in prefs],
    }
