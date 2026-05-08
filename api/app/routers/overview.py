from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from app.auth import require_admin
from app.db import um, ka, pa


router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def overview(_: str = Depends(require_admin)) -> dict:
    since_7d = datetime.utcnow() - timedelta(days=7)

    async with um().acquire() as c_um:
        user_kpis = await c_um.fetchrow(
            """
            SELECT
              COUNT(*) FILTER (WHERE ut.name = 'driver')    AS drivers,
              COUNT(*) FILTER (WHERE ut.name = 'passenger') AS passengers,
              COUNT(*) FILTER (WHERE ut.name = 'admin')     AS admins,
              COUNT(*) FILTER (WHERE u.is_active)           AS active_users,
              COUNT(*)                                      AS total_users,
              COUNT(*) FILTER (WHERE u.created_at >= $1)    AS new_users_7d
            FROM users u
            LEFT JOIN usertype ut ON ut.id = u.usertype_id
            """,
            since_7d,
        )
        signups_daily = await c_um.fetch(
            """
            SELECT date_trunc('day', created_at)::date AS day,
                   COUNT(*)                            AS signups
            FROM users
            WHERE created_at >= $1
            GROUP BY 1
            ORDER BY 1
            """,
            datetime.utcnow() - timedelta(days=30),
        )
        driver_verif = await c_um.fetchrow(
            """
            SELECT
              COUNT(*) FILTER (WHERE verification_status::text = 'approved') AS approved,
              COUNT(*) FILTER (WHERE verification_status::text = 'pending')  AS pending,
              COUNT(*) FILTER (WHERE verification_status::text = 'rejected') AS rejected,
              COUNT(*)                                                       AS total
            FROM driver_profiles
            """
        )

    async with ka().acquire() as c_ka:
        ride_kpis = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*)                                                           AS total_rides,
              COUNT(*) FILTER (WHERE status::text = 'REQUESTED')                 AS requested,
              COUNT(*) FILTER (WHERE status::text = 'OFFER_SENT')                AS offer_sent,
              COUNT(*) FILTER (WHERE status::text = 'ACCEPTED')                  AS accepted,
              COUNT(*) FILTER (WHERE status::text IN ('PICKUP_ARRIVING','IN_PROGRESS','DROPOFF_ARRIVING')) AS active,
              COUNT(*) FILTER (WHERE status::text = 'COMPLETED')                 AS completed,
              COUNT(*) FILTER (WHERE status::text = 'CANCELLED')                 AS cancelled,
              COUNT(*) FILTER (WHERE created_at >= $1)                           AS rides_7d
            FROM rides
            """,
            since_7d,
        )
        rides_daily = await c_ka.fetch(
            """
            SELECT date_trunc('day', created_at)::date AS day,
                   COUNT(*)                                            AS rides,
                   COUNT(*) FILTER (WHERE status::text = 'COMPLETED')  AS completed,
                   COUNT(*) FILTER (WHERE status::text = 'CANCELLED')  AS cancelled
            FROM rides
            WHERE created_at >= $1
            GROUP BY 1
            ORDER BY 1
            """,
            datetime.utcnow() - timedelta(days=30),
        )
        run_kpis = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*)                                                   AS total_runs,
              COUNT(*) FILTER (WHERE status::text = 'OPEN')              AS open,
              COUNT(*) FILTER (WHERE status::text = 'IN_PROGRESS')       AS in_progress,
              COUNT(*) FILTER (WHERE status::text = 'PARTIALLY_FILLED')  AS partially_filled,
              COUNT(*) FILTER (WHERE status::text = 'COMPLETED')         AS completed,
              COUNT(*) FILTER (WHERE status::text = 'CANCELLED')         AS cancelled
            FROM driver_runs
            """
        )
        pref_funnel = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*)                                             AS total,
              COUNT(*) FILTER (WHERE status = 'PENDING')           AS pending,
              COUNT(*) FILTER (WHERE status = 'OFFERED')           AS offered,
              COUNT(*) FILTER (WHERE status = 'ACCEPTED')          AS accepted,
              COUNT(*) FILTER (WHERE status = 'DECLINED')          AS declined,
              COUNT(*) FILTER (WHERE status = 'EXPIRED')           AS expired,
              COUNT(*) FILTER (WHERE status = 'CANCELLED')         AS cancelled,
              COUNT(*) FILTER (WHERE is_primary AND status = 'ACCEPTED') AS primary_accepted,
              COUNT(*) FILTER (WHERE is_primary)                    AS primary_total
            FROM ride_preferences
            """
        )

    async with pa().acquire() as c_pa:
        pay_kpis = await c_pa.fetchrow(
            """
            SELECT
              COUNT(*)                                                   AS total_intents,
              COUNT(*) FILTER (WHERE status = 'succeeded')               AS succeeded,
              COUNT(*) FILTER (WHERE status = 'requires_capture')        AS requires_capture,
              COUNT(*) FILTER (WHERE status = 'canceled')                AS canceled,
              COUNT(*) FILTER (WHERE status = 'failed')                  AS failed,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0)   AS gmv_cents,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded' AND created_at >= $1), 0) AS gmv_7d_cents
            FROM payment_intents
            """,
            since_7d,
        )
        wallet_totals = await c_pa.fetchrow(
            """
            SELECT
              COUNT(*)                                   AS drivers_with_wallets,
              COALESCE(SUM(earnings_cents), 0)           AS total_earnings_cents,
              COALESCE(SUM(credits_cents), 0)            AS total_credits_cents
            FROM wallet_balances
            """
        )
        connect_totals = await c_pa.fetchrow(
            """
            SELECT
              COUNT(*)                                                    AS total,
              COUNT(*) FILTER (WHERE payouts_enabled)                     AS payouts_enabled,
              COUNT(*) FILTER (WHERE details_submitted)                   AS details_submitted
            FROM stripe_connect
            """
        )

    return {
        "users": dict(user_kpis),
        "driver_verification": dict(driver_verif),
        "signups_daily": [dict(r) for r in signups_daily],
        "rides": dict(ride_kpis),
        "rides_daily": [dict(r) for r in rides_daily],
        "driver_runs": dict(run_kpis),
        "preferences_funnel": dict(pref_funnel),
        "payments": dict(pay_kpis),
        "wallets": dict(wallet_totals),
        "stripe_connect": dict(connect_totals),
    }
