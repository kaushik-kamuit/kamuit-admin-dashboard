from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth import TokenPayload, require_admin, require_role
from app.audit import log_action
from app.db import ka, pa, um
from app.security import get_client_ip, get_user_agent, validate_readonly_sql


router = APIRouter()


class QueryRequest(BaseModel):
    database: str = Field(pattern="^(user_mgmt|kamuit|payment)$")
    sql: str = Field(min_length=1, max_length=12000)
    limit: int = Field(default=100, ge=1, le=500)


class DriverStatusPatch(BaseModel):
    verification_status: str | None = Field(default=None, pattern="^(pending|approved|rejected)$")


class VehicleStatusPatch(BaseModel):
    verification_status: str | None = Field(default=None, pattern="^(pending|approved|rejected)$")
    doc_verified: bool | None = None
    insurance_verified: bool | None = None
    history_verified: bool | None = None
    vin_verified: bool | None = None


class RideStatusPatch(BaseModel):
    status: str = Field(
        pattern="^(REQUESTED|OFFER_SENT|ACCEPTED|PICKUP_ARRIVING|IN_PROGRESS|COMPLETED|CANCELLED)$"
    )


class DriverRunStatusPatch(BaseModel):
    status: str = Field(pattern="^(OPEN|PARTIALLY_FILLED|IN_PROGRESS|COMPLETED|CANCELLED)$")


def _jsonable(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (UUID, Decimal)):
        return str(value)
    return value


def _row(row) -> dict:
    return {k: _jsonable(v) for k, v in dict(row).items()}


def _pct(numerator: int | float | None, denominator: int | float | None) -> float:
    if not denominator:
        return 0.0
    return round((float(numerator or 0) / float(denominator)) * 100, 1)


async def _resolve_users(user_ids: list[str]) -> dict[str, dict]:
    uniq = list({u for u in user_ids if u})
    if not uniq:
        return {}
    async with um().acquire() as c:
        rows = await c.fetch(
            """
            SELECT id::text, full_name, email, phone_number
            FROM users
            WHERE id::text = ANY($1)
            """,
            uniq,
        )
    return {r["id"]: dict(r) for r in rows}


@router.get("/command-center")
async def command_center(_: str = Depends(require_admin)) -> dict:
    """
    New dashboard landing aggregate for current Kamuit operations.

    This intentionally groups data by workstream instead of by database:
    onboarding, live trips, matching, payments, wallets, and Stripe Connect.
    """
    now = datetime.utcnow()
    stale_cutoff = now - timedelta(minutes=10)

    async with um().acquire() as c_um:
        onboarding = await c_um.fetchrow(
            """
            SELECT
              COUNT(*) AS total_drivers,
              COUNT(*) FILTER (WHERE lower(dp.verification_status::text) = 'approved') AS approved,
              COUNT(*) FILTER (WHERE lower(dp.verification_status::text) = 'pending') AS pending,
              COUNT(*) FILTER (WHERE lower(dp.verification_status::text) = 'rejected') AS rejected,
              0::int AS suspended,
              0::int AS provisional_active,
              0::int AS provisional_expired,
              0::int AS more_info_requested,
              COUNT(*) FILTER (WHERE NOT COALESCE(dp.is_verified, false)) AS verification_pending
            FROM driver_profiles dp
            """
        )
        identity = await c_um.fetchrow(
            """
            SELECT
              COUNT(*) AS total_sessions,
              COUNT(*) FILTER (WHERE is_verified) AS verified,
              COUNT(*) FILTER (WHERE NOT is_verified) AS not_verified,
              COUNT(*) FILTER (WHERE last_error IS NOT NULL) AS errored
            FROM driver_verifications
            """
        )
        vehicles = await c_um.fetchrow(
            """
            SELECT
              COUNT(*) AS total_vehicles,
              COUNT(*) FILTER (WHERE lower(verification_status::text) = 'approved') AS approved,
              COUNT(*) FILTER (WHERE lower(verification_status::text) = 'pending') AS pending,
              COUNT(*) FILTER (WHERE lower(verification_status::text) = 'rejected') AS rejected,
              COUNT(*) FILTER (WHERE NOT COALESCE(doc_verified, false)) AS registration_not_verified,
              COUNT(*) FILTER (WHERE NOT COALESCE(insurance_verified, false)) AS insurance_not_verified
            FROM vehicles
            """
        )
        review_queue = await c_um.fetch(
            """
            SELECT
              u.id::text AS user_id,
              u.full_name,
              u.email,
              u.phone_number,
              lower(dp.verification_status::text) AS driver_status,
              NULL::text AS provisional_status,
              NULL::timestamp AS provisional_expires_at,
              NULL::text AS suspended_reason,
              COUNT(v.id) AS vehicle_count,
              COUNT(v.id) FILTER (WHERE lower(v.verification_status::text) = 'pending') AS pending_vehicles,
              COUNT(v.id) FILTER (WHERE lower(v.verification_status::text) = 'rejected') AS rejected_vehicles,
              COUNT(v.id) FILTER (WHERE NOT COALESCE(v.insurance_verified, false)) AS insurance_gaps
            FROM driver_profiles dp
            JOIN users u ON u.id = dp.user_id
            LEFT JOIN vehicles v ON v.driver_id = dp.id
            WHERE lower(dp.verification_status::text) IN ('pending', 'rejected', 'suspended')
               OR lower(v.verification_status::text) IN ('pending', 'rejected')
               OR NOT COALESCE(v.insurance_verified, false)
            GROUP BY u.id, u.full_name, u.email, u.phone_number,
                     dp.verification_status
            ORDER BY
              CASE
                WHEN lower(dp.verification_status::text) = 'suspended' THEN 0
                WHEN lower(dp.verification_status::text) = 'rejected' THEN 1
                ELSE 3
              END,
              u.full_name
            LIMIT 12
            """
        )

    async with ka().acquire() as c_ka:
        trips = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS total_runs,
              COUNT(*) FILTER (WHERE status::text = 'OPEN') AS open,
              COUNT(*) FILTER (WHERE status::text = 'PARTIALLY_FILLED') AS partially_filled,
              COUNT(*) FILTER (WHERE status::text = 'IN_PROGRESS') AS in_progress,
              0::int AS provisional_runs
            FROM driver_runs
            """
        )
        rides = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS total_rides,
              COUNT(*) FILTER (WHERE status::text = 'REQUESTED') AS requested,
              COUNT(*) FILTER (WHERE status::text = 'OFFER_SENT') AS offer_sent,
              COUNT(*) FILTER (WHERE status::text = 'ACCEPTED') AS accepted,
              COUNT(*) FILTER (WHERE status::text IN ('PICKUP_ARRIVING','IN_PROGRESS')) AS active,
              COUNT(*) FILTER (WHERE status::text = 'COMPLETED') AS completed,
              COUNT(*) FILTER (WHERE status::text = 'CANCELLED') AS cancelled
            FROM rides
            """
        )
        matching = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS total_preferences,
              COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
              COUNT(*) FILTER (WHERE status = 'OFFERED') AS offered,
              COUNT(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
              COUNT(*) FILTER (WHERE status IN ('DECLINED','EXPIRED','CANCELLED')) AS failed_or_closed,
              COUNT(DISTINCT preference_session_id) AS sessions
            FROM ride_preferences
            """
        )
        live_runs = await c_ka.fetch(
            """
            SELECT
              dr.id::text,
              dr.driver_id,
              dr.status::text AS status,
              dr.origin_address,
              dr.dest_address,
              dr.seats_total,
              dr.seats_left,
              false AS is_provisional_driver,
              dr.created_at,
              COUNT(DISTINCT ra.ride_id) AS assigned_rides,
              MAX(p.recorded_at) AS last_ping_at,
              COUNT(p.id) AS ping_count
            FROM driver_runs dr
            LEFT JOIN ride_assignments ra ON ra.driver_run_id = dr.id
            LEFT JOIN driver_location_pings p ON p.driver_run_id = dr.id
            WHERE dr.status::text IN ('OPEN', 'PARTIALLY_FILLED', 'IN_PROGRESS')
            GROUP BY dr.id
            ORDER BY
              CASE dr.status::text
                WHEN 'IN_PROGRESS' THEN 0
                WHEN 'PARTIALLY_FILLED' THEN 1
                ELSE 2
              END,
              MAX(p.recorded_at) DESC NULLS LAST,
              dr.created_at DESC
            LIMIT 12
            """
        )
        stale_active_runs = await c_ka.fetchval(
            """
            SELECT COUNT(*)
            FROM driver_runs dr
            WHERE dr.status::text = 'IN_PROGRESS'
              AND NOT EXISTS (
                SELECT 1
                FROM driver_location_pings p
                WHERE p.driver_run_id = dr.id
                  AND p.recorded_at >= $1
              )
            """,
            stale_cutoff,
        )

    async with pa().acquire() as c_pa:
        payment = await c_pa.fetchrow(
            """
            SELECT
              COUNT(*) AS total_intents,
              COUNT(*) FILTER (WHERE status = 'requires_capture') AS requires_capture,
              COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
              COUNT(*) FILTER (WHERE status = 'canceled') AS canceled,
              COUNT(*) FILTER (WHERE status = 'failed') AS failed,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0) AS captured_cents,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'requires_capture'), 0) AS held_cents
            FROM payment_intents
            """
        )
        wallet = await c_pa.fetchrow(
            """
            SELECT
              COUNT(*) AS wallets,
              COALESCE(SUM(earnings_cents), 0) AS earnings_cents,
              COALESCE(SUM(credits_cents), 0) AS credits_cents
            FROM wallet_balances
            """
        )
        connect = await c_pa.fetchrow(
            """
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE payouts_enabled) AS payouts_enabled,
              COUNT(*) FILTER (WHERE details_submitted) AS details_submitted,
              COUNT(*) FILTER (WHERE stripe_account_id IS NULL) AS missing_account
            FROM stripe_connect
            """
        )
        payment_risks = await c_pa.fetch(
            """
            SELECT
              id::text,
              stripe_pi_id,
              passenger_id,
              preference_id,
              amount_cents,
              currency,
              status,
              created_at,
              updated_at
            FROM payment_intents
            WHERE status IN ('requires_capture', 'failed')
            ORDER BY
              CASE status WHEN 'failed' THEN 0 ELSE 1 END,
              created_at DESC
            LIMIT 12
            """
        )

    users = await _resolve_users(
        [r["driver_id"] for r in live_runs if r["driver_id"]]
        + [p["passenger_id"] for p in payment_risks if p["passenger_id"]]
    )

    return {
        "generated_at": now.isoformat(),
        "onboarding": dict(onboarding) if onboarding else {},
        "identity": dict(identity) if identity else {},
        "vehicles": dict(vehicles) if vehicles else {},
        "review_queue": [dict(r) for r in review_queue],
        "trips": dict(trips) if trips else {},
        "rides": dict(rides) if rides else {},
        "matching": dict(matching) if matching else {},
        "stale_active_runs": stale_active_runs,
        "live_runs": [
            {**dict(r), "driver": users.get(r["driver_id"])}
            for r in live_runs
        ],
        "payment": dict(payment) if payment else {},
        "wallet": dict(wallet) if wallet else {},
        "connect": dict(connect) if connect else {},
        "webhooks": {"total": 0, "unprocessed": 0, "errored": 0},
        "payment_risks": [
            {**dict(p), "passenger": users.get(p["passenger_id"])}
            for p in payment_risks
        ],
    }


@router.get("/insights")
async def operation_insights(_: str = Depends(require_admin)) -> dict:
    now = datetime.utcnow()
    stale_cutoff = now - timedelta(minutes=10)

    async with um().acquire() as c_um:
        admin_users = await c_um.fetchrow(
            """
            SELECT
              COUNT(*) AS total_users,
              COUNT(*) FILTER (
                WHERE created_at >= (SELECT COALESCE(MAX(created_at), now()) FROM users) - interval '30 days'
              ) AS new_users_30d
            FROM users
            """
        )
        admin_drivers = await c_um.fetchrow(
            """
            SELECT
              COUNT(*) AS total_drivers,
              COUNT(*) FILTER (WHERE lower(verification_status::text) = 'approved') AS approved,
              COUNT(*) FILTER (WHERE lower(verification_status::text) = 'pending') AS pending,
              COUNT(*) FILTER (WHERE lower(verification_status::text) = 'rejected') AS rejected,
              COUNT(*) FILTER (WHERE NOT COALESCE(is_verified, false)) AS unverified
            FROM driver_profiles
            """
        )
        admin_vehicles = await c_um.fetchrow(
            """
            SELECT
              COUNT(*) AS total_vehicles,
              COUNT(*) FILTER (WHERE lower(verification_status::text) = 'approved') AS approved,
              COUNT(*) FILTER (WHERE lower(verification_status::text) = 'pending') AS pending,
              COUNT(*) FILTER (WHERE lower(verification_status::text) = 'rejected') AS rejected,
              COUNT(*) FILTER (WHERE NOT COALESCE(doc_verified, false)) AS registration_gaps,
              COUNT(*) FILTER (WHERE NOT COALESCE(insurance_verified, false)) AS insurance_gaps
            FROM vehicles
            """
        )
        identity = await c_um.fetchrow(
            """
            SELECT
              COUNT(*) AS sessions,
              COUNT(*) FILTER (WHERE is_verified) AS verified,
              COUNT(*) FILTER (WHERE last_error IS NOT NULL) AS errors
            FROM driver_verifications
            """
        )
        users_daily = await c_um.fetch(
            """
            SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS new_users
            FROM users
            WHERE created_at >= (SELECT COALESCE(MAX(created_at), now()) FROM users) - interval '30 days'
            GROUP BY 1
            ORDER BY 1
            """
        )

    async with ka().acquire() as c_ka:
        ride_rollup = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS total_rides,
              COUNT(*) FILTER (WHERE status::text = 'REQUESTED') AS requested,
              COUNT(*) FILTER (WHERE status::text IN ('ACCEPTED','PICKUP_ARRIVING','IN_PROGRESS')) AS committed_or_active,
              COUNT(*) FILTER (WHERE status::text = 'COMPLETED') AS completed,
              COUNT(*) FILTER (WHERE status::text = 'CANCELLED') AS cancelled,
              COALESCE(SUM(seats_requested) FILTER (WHERE status::text IN ('REQUESTED','OFFER_SENT','ACCEPTED')), 0) AS demand_seats
            FROM rides
            """
        )
        run_rollup = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS total_runs,
              COUNT(*) FILTER (WHERE status::text IN ('OPEN','PARTIALLY_FILLED','IN_PROGRESS')) AS available_runs,
              COUNT(*) FILTER (WHERE status::text = 'IN_PROGRESS') AS in_progress,
              COALESCE(SUM(seats_left) FILTER (WHERE status::text IN ('OPEN','PARTIALLY_FILLED','IN_PROGRESS')), 0) AS open_seats,
              COALESCE(SUM(seats_total - seats_left) FILTER (WHERE status::text IN ('OPEN','PARTIALLY_FILLED','IN_PROGRESS')), 0) AS occupied_seats,
              COALESCE(SUM(seats_total) FILTER (WHERE status::text IN ('OPEN','PARTIALLY_FILLED','IN_PROGRESS')), 0) AS offered_seats
            FROM driver_runs
            """
        )
        assignment_rollup = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS assignments,
              COUNT(DISTINCT ride_id) AS assigned_rides,
              COUNT(DISTINCT driver_run_id) AS assigned_runs
            FROM ride_assignments
            """
        )
        matching_rollup = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS preferences,
              COUNT(DISTINCT preference_session_id) AS sessions,
              COUNT(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
              COUNT(*) FILTER (WHERE status IN ('DECLINED','EXPIRED','CANCELLED')) AS failed_or_closed
            FROM ride_preferences
            """
        )
        search_rollup = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS searches,
              SUM(CASE WHEN converted THEN 1 ELSE 0 END) AS converted,
              AVG(candidates_shown) AS avg_candidates,
              AVG(CASE WHEN converted THEN 1 ELSE 0 END)::float AS conversion_rate
            FROM inferred_searches
            WHERE searched_at >= (SELECT COALESCE(MAX(searched_at), now()) FROM inferred_searches) - interval '30 days'
            """
        )
        freshness = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS active_runs,
              COUNT(*) FILTER (
                WHERE EXISTS (
                  SELECT 1
                  FROM driver_location_pings p
                  WHERE p.driver_run_id = dr.id
                    AND p.recorded_at >= $1
                )
              ) AS fresh_runs
            FROM driver_runs dr
            WHERE dr.status::text = 'IN_PROGRESS'
            """,
            stale_cutoff,
        )
        otp_rollup = await c_ka.fetchrow(
            """
            SELECT
              COUNT(*) AS attempts,
              COUNT(DISTINCT ride_id) AS rides_with_attempts,
              MAX(occurred_at) AS last_attempt_at
            FROM otp_attempt_events
            WHERE occurred_at >= (SELECT COALESCE(MAX(occurred_at), now()) FROM otp_attempt_events) - interval '30 days'
            """
        )
        rides_daily = await c_ka.fetch(
            """
            SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS rides
            FROM rides
            WHERE created_at >= (SELECT COALESCE(MAX(created_at), now()) FROM rides) - interval '30 days'
            GROUP BY 1
            ORDER BY 1
            """
        )
        runs_daily = await c_ka.fetch(
            """
            SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS driver_runs
            FROM driver_runs
            WHERE created_at >= (SELECT COALESCE(MAX(created_at), now()) FROM driver_runs) - interval '30 days'
            GROUP BY 1
            ORDER BY 1
            """
        )
        searches_daily = await c_ka.fetch(
            """
            SELECT
              date_trunc('day', searched_at)::date AS day,
              COUNT(*) AS searches,
              SUM(CASE WHEN converted THEN 1 ELSE 0 END) AS converted_searches
            FROM inferred_searches
            WHERE searched_at >= (SELECT COALESCE(MAX(searched_at), now()) FROM inferred_searches) - interval '30 days'
            GROUP BY 1
            ORDER BY 1
            """
        )

    async with pa().acquire() as c_pa:
        payment_rollup = await c_pa.fetchrow(
            """
            SELECT
              COUNT(*) AS intents,
              COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
              COUNT(*) FILTER (WHERE status = 'requires_capture') AS requires_capture,
              COUNT(*) FILTER (WHERE status = 'failed') AS failed,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0) AS captured_cents,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'requires_capture'), 0) AS held_cents
            FROM payment_intents
            """
        )
        connect_rollup = await c_pa.fetchrow(
            """
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE payouts_enabled) AS payouts_enabled,
              COUNT(*) FILTER (WHERE stripe_account_id IS NULL) AS missing_account
            FROM stripe_connect
            """
        )
        payment_daily = await c_pa.fetch(
            """
            SELECT
              day::date AS day,
              SUM(intents) AS payment_intents,
              COALESCE(SUM(total_cents) FILTER (WHERE status = 'succeeded'), 0) AS captured_cents,
              COALESCE(SUM(total_cents) FILTER (WHERE status = 'requires_capture'), 0) AS held_cents,
              COALESCE(SUM(total_cents) FILTER (WHERE status = 'failed'), 0) AS failed_cents
            FROM v_payment_intent_daily
            WHERE day >= (SELECT COALESCE(MAX(day), now()) FROM v_payment_intent_daily) - interval '30 days'
            GROUP BY 1
            ORDER BY 1
            """
        )
        settlement_gaps = await c_pa.fetchval(
            """
            SELECT COUNT(*)
            FROM v_driver_settlement s
            LEFT JOIN wallet_balances wb ON wb.driver_id = s.driver_id
            WHERE ABS(COALESCE(s.earnings_in_cents, 0) - COALESCE(wb.earnings_cents, 0)) > 0
            """
        )

    admin_drivers_d = _row(admin_drivers) if admin_drivers else {}
    admin_vehicles_d = _row(admin_vehicles) if admin_vehicles else {}
    identity_d = _row(identity) if identity else {}
    ride_rollup_d = _row(ride_rollup) if ride_rollup else {}
    run_rollup_d = _row(run_rollup) if run_rollup else {}
    assignment_rollup_d = _row(assignment_rollup) if assignment_rollup else {}
    matching_rollup_d = _row(matching_rollup) if matching_rollup else {}
    search_rollup_d = _row(search_rollup) if search_rollup else {}
    freshness_d = _row(freshness) if freshness else {}
    otp_rollup_d = _row(otp_rollup) if otp_rollup else {}
    payment_rollup_d = _row(payment_rollup) if payment_rollup else {}
    connect_rollup_d = _row(connect_rollup) if connect_rollup else {}

    days: dict[str, dict] = {}
    for source_rows in (users_daily, rides_daily, runs_daily, searches_daily, payment_daily):
        for row in source_rows:
            day = row["day"].isoformat()
            days.setdefault(day, {"day": day})
            for key, value in dict(row).items():
                if key != "day":
                    days[day][key] = _jsonable(value)

    risk_register = [
        {
            "label": "Driver and vehicle review queue",
            "value": int(admin_drivers_d.get("pending") or 0) + int(admin_vehicles_d.get("pending") or 0),
            "severity": "warning",
            "href": "/explorer",
            "detail": "Pending driver or vehicle decisions slow marketplace supply.",
        },
        {
            "label": "Insurance gaps",
            "value": int(admin_vehicles_d.get("insurance_gaps") or 0),
            "severity": "critical",
            "href": "/explorer",
            "detail": "Vehicles without verified insurance need operator attention before approval.",
        },
        {
            "label": "Identity verification errors",
            "value": int(identity_d.get("errors") or 0),
            "severity": "warning",
            "href": "/drivers",
            "detail": "Stripe Identity sessions with errors may require manual outreach.",
        },
        {
            "label": "Stale GPS on active trips",
            "value": max(0, int(freshness_d.get("active_runs") or 0) - int(freshness_d.get("fresh_runs") or 0)),
            "severity": "critical",
            "href": "/sessions",
            "detail": "In-progress driver runs without a recent ping reduce support confidence.",
        },
        {
            "label": "Failed payment intents",
            "value": int(payment_rollup_d.get("failed") or 0),
            "severity": "critical",
            "href": "/payments",
            "detail": "Failed intents are passenger-facing payment risk.",
        },
        {
            "label": "Held authorization amount",
            "value": int(payment_rollup_d.get("held_cents") or 0),
            "severity": "watch",
            "href": "/payments",
            "detail": "Requires-capture holds should be reconciled before they age out.",
            "format": "money",
        },
        {
            "label": "Connect accounts missing",
            "value": int(connect_rollup_d.get("missing_account") or 0),
            "severity": "warning",
            "href": "/payments",
            "detail": "Drivers without Connect accounts cannot receive payouts.",
        },
        {
            "label": "Settlement rows out of balance",
            "value": int(settlement_gaps or 0),
            "severity": "watch",
            "href": "/recon",
            "detail": "Ledger and wallet-balance deltas should be reviewed.",
        },
    ]

    health_scores = [
        {
            "label": "Driver clearance",
            "score": _pct(admin_drivers_d.get("approved"), admin_drivers_d.get("total_drivers")),
            "detail": "Approved drivers out of total driver profiles.",
        },
        {
            "label": "Vehicle clearance",
            "score": _pct(admin_vehicles_d.get("approved"), admin_vehicles_d.get("total_vehicles")),
            "detail": "Approved vehicles out of all submitted vehicles.",
        },
        {
            "label": "Search conversion",
            "score": round(float(search_rollup_d.get("conversion_rate") or 0) * 100, 1),
            "detail": "Inferred preference sessions that converted in the last 30 days.",
        },
        {
            "label": "Seat utilization",
            "score": _pct(run_rollup_d.get("occupied_seats"), run_rollup_d.get("offered_seats")),
            "detail": "Occupied seats on currently available or active runs.",
        },
        {
            "label": "Payment capture",
            "score": _pct(payment_rollup_d.get("succeeded"), payment_rollup_d.get("intents")),
            "detail": "Succeeded payment intents out of all intents.",
        },
        {
            "label": "GPS freshness",
            "score": _pct(freshness_d.get("fresh_runs"), freshness_d.get("active_runs")),
            "detail": "In-progress runs with a ping in the last 10 minutes.",
        },
    ]

    return {
        "generated_at": now.isoformat(),
        "health_scores": health_scores,
        "risk_register": risk_register,
        "marketplace": {
            **ride_rollup_d,
            **{f"run_{k}": v for k, v in run_rollup_d.items()},
            **{f"assignment_{k}": v for k, v in assignment_rollup_d.items()},
            **{f"matching_{k}": v for k, v in matching_rollup_d.items()},
            "demand_to_open_seat_ratio": round(
                float(ride_rollup_d.get("demand_seats") or 0)
                / max(1, float(run_rollup_d.get("open_seats") or 0)),
                2,
            ),
        },
        "payment": payment_rollup_d,
        "connect": connect_rollup_d,
        "search": search_rollup_d,
        "support": otp_rollup_d,
        "timeline": [days[k] for k in sorted(days)],
    }


@router.get("/explorer/{entity}")
async def explorer(
    entity: str,
    _: str = Depends(require_admin),
    search: str | None = Query(None, max_length=200),
    status: str | None = Query(None, max_length=80),
    limit: int = Query(50, ge=1, le=250),
    offset: int = Query(0, ge=0),
) -> dict:
    search_like = f"%{search}%" if search else None

    if entity == "drivers":
        where = []
        args: list = []
        if status:
            args.append(status.lower())
            where.append(f"lower(dp.verification_status::text) = ${len(args)}")
        if search_like:
            args.append(search_like)
            where.append(
                f"(u.full_name ILIKE ${len(args)} OR u.email ILIKE ${len(args)} OR u.phone_number ILIKE ${len(args)} OR u.id::text ILIKE ${len(args)})"
            )
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        async with um().acquire() as c:
            rows = await c.fetch(
                f"""
                SELECT
                  u.id::text AS id,
                  u.full_name,
                  u.email,
                  u.phone_number,
                  lower(dp.verification_status::text) AS verification_status,
                  NULL::text AS provisional_status,
                  NULL::timestamp AS provisional_expires_at,
                  NULL::text AS suspended_reason,
                  true AS terms_accepted,
                  COUNT(v.id) AS vehicle_count,
                  COUNT(v.id) FILTER (WHERE lower(v.verification_status::text) = 'pending') AS pending_vehicles,
                  COUNT(v.id) FILTER (WHERE NOT COALESCE(v.insurance_verified, false)) AS insurance_gaps,
                  u.created_at
                FROM driver_profiles dp
                JOIN users u ON u.id = dp.user_id
                LEFT JOIN vehicles v ON v.driver_id = dp.id
                {where_sql}
                GROUP BY u.id, u.full_name, u.email, u.phone_number,
                         dp.verification_status, u.created_at
                ORDER BY u.created_at DESC
                LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
                """,
                *args,
                limit,
                offset,
            )
            total = await c.fetchval(
                f"""
                SELECT COUNT(*)
                FROM driver_profiles dp
                JOIN users u ON u.id = dp.user_id
                {where_sql}
                """,
                *args,
            )
        return {"entity": entity, "total": total, "items": [_row(r) for r in rows], "limit": limit, "offset": offset}

    if entity == "vehicles":
        where = []
        args = []
        if status:
            args.append(status.lower())
            where.append(f"lower(v.verification_status::text) = ${len(args)}")
        if search_like:
            args.append(search_like)
            where.append(
                f"(v.vin ILIKE ${len(args)} OR v.plate_number ILIKE ${len(args)} OR v.make ILIKE ${len(args)} OR v.model ILIKE ${len(args)} OR u.full_name ILIKE ${len(args)})"
            )
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        async with um().acquire() as c:
            rows = await c.fetch(
                f"""
                SELECT
                  v.id::text AS id,
                  dp.user_id::text AS driver_user_id,
                  u.full_name AS driver_name,
                  v.vin,
                  v.plate_number,
                  v.plate_state,
                  v.year,
                  v.make,
                  v.model,
                  v.color,
                  lower(v.verification_status::text) AS verification_status,
                  COALESCE(v.doc_verified, false) AS doc_verified,
                  COALESCE(v.insurance_verified, false) AS insurance_verified,
                  COALESCE(v.history_verified, false) AS history_verified,
                  COALESCE(v.vin_verified, false) AS vin_verified,
                  NULL::date AS registration_expiry_date,
                  v.created_at
                FROM vehicles v
                JOIN driver_profiles dp ON dp.id = v.driver_id
                JOIN users u ON u.id = dp.user_id
                {where_sql}
                ORDER BY v.created_at DESC
                LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
                """,
                *args,
                limit,
                offset,
            )
            total = await c.fetchval(
                f"""
                SELECT COUNT(*)
                FROM vehicles v
                JOIN driver_profiles dp ON dp.id = v.driver_id
                JOIN users u ON u.id = dp.user_id
                {where_sql}
                """,
                *args,
            )
        return {"entity": entity, "total": total, "items": [_row(r) for r in rows], "limit": limit, "offset": offset}

    if entity == "rides":
        where = []
        args = []
        if status:
            args.append(status.upper())
            where.append(f"r.status::text = ${len(args)}")
        if search_like:
            args.append(search_like)
            where.append(
                f"(r.id::text ILIKE ${len(args)} OR r.rider_id ILIKE ${len(args)} OR r.pickup_address ILIKE ${len(args)} OR r.drop_address ILIKE ${len(args)})"
            )
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        async with ka().acquire() as c:
            rows = await c.fetch(
                f"""
                SELECT
                  r.id::text AS id,
                  r.rider_id,
                  r.status::text AS status,
                  r.pickup_address,
                  r.drop_address,
                  r.seats_requested,
                  r.payment_method_id,
                  r.preference_session_id::text,
                  r.accepted_preference_id::text,
                  r.created_at,
                  r.updated_at,
                  ra.driver_run_id::text,
                  dr.driver_id
                FROM rides r
                LEFT JOIN ride_assignments ra ON ra.ride_id = r.id
                LEFT JOIN driver_runs dr ON dr.id = ra.driver_run_id
                {where_sql}
                ORDER BY r.created_at DESC
                LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
                """,
                *args,
                limit,
                offset,
            )
            total = await c.fetchval(f"SELECT COUNT(*) FROM rides r {where_sql}", *args)
        return {"entity": entity, "total": total, "items": [_row(r) for r in rows], "limit": limit, "offset": offset}

    if entity == "driver_runs":
        where = []
        args = []
        if status:
            args.append(status.upper())
            where.append(f"dr.status::text = ${len(args)}")
        if search_like:
            args.append(search_like)
            where.append(
                f"(dr.id::text ILIKE ${len(args)} OR dr.driver_id ILIKE ${len(args)} OR dr.origin_address ILIKE ${len(args)} OR dr.dest_address ILIKE ${len(args)})"
            )
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        async with ka().acquire() as c:
            rows = await c.fetch(
                f"""
                SELECT
                  dr.id::text AS id,
                  dr.driver_id,
                  dr.status::text AS status,
                  dr.origin_address,
                  dr.dest_address,
                  dr.seats_total,
                  dr.seats_left,
                  dr.max_detour_minutes,
                  dr.route_distance_meters,
                  dr.route_duration_seconds,
                  COUNT(ra.id) AS assignments,
                  MAX(p.recorded_at) AS last_ping_at,
                  dr.created_at,
                  dr.updated_at
                FROM driver_runs dr
                LEFT JOIN ride_assignments ra ON ra.driver_run_id = dr.id
                LEFT JOIN driver_location_pings p ON p.driver_run_id = dr.id
                {where_sql}
                GROUP BY dr.id
                ORDER BY dr.created_at DESC
                LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
                """,
                *args,
                limit,
                offset,
            )
            total = await c.fetchval(f"SELECT COUNT(*) FROM driver_runs dr {where_sql}", *args)
        return {"entity": entity, "total": total, "items": [_row(r) for r in rows], "limit": limit, "offset": offset}

    if entity == "payments":
        where = []
        args = []
        if status:
            args.append(status)
            where.append(f"status = ${len(args)}")
        if search_like:
            args.append(search_like)
            where.append(
                f"(stripe_pi_id ILIKE ${len(args)} OR passenger_id ILIKE ${len(args)} OR preference_id ILIKE ${len(args)})"
            )
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        async with pa().acquire() as c:
            rows = await c.fetch(
                f"""
                SELECT
                  id::text,
                  stripe_pi_id,
                  passenger_id,
                  preference_id,
                  amount_cents,
                  currency,
                  status,
                  created_at,
                  updated_at
                FROM payment_intents
                {where_sql}
                ORDER BY created_at DESC
                LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
                """,
                *args,
                limit,
                offset,
            )
            total = await c.fetchval(f"SELECT COUNT(*) FROM payment_intents {where_sql}", *args)
        return {"entity": entity, "total": total, "items": [_row(r) for r in rows], "limit": limit, "offset": offset}

    if entity == "wallets":
        args = []
        where_sql = ""
        if search_like:
            args.append(search_like)
            where_sql = f"WHERE driver_id ILIKE ${len(args)}"
        async with pa().acquire() as c:
            rows = await c.fetch(
                f"""
                SELECT
                  driver_id AS id,
                  driver_id,
                  earnings_cents,
                  credits_cents,
                  currency,
                  updated_at
                FROM wallet_balances
                {where_sql}
                ORDER BY earnings_cents DESC
                LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
                """,
                *args,
                limit,
                offset,
            )
            total = await c.fetchval(f"SELECT COUNT(*) FROM wallet_balances {where_sql}", *args)
        return {"entity": entity, "total": total, "items": [_row(r) for r in rows], "limit": limit, "offset": offset}

    raise HTTPException(404, f"Unknown explorer entity: {entity}")


@router.get("/search")
async def global_search(
    q: str = Query("", max_length=120),
    _: str = Depends(require_admin),
    limit: int = Query(8, ge=1, le=25),
) -> dict:
    term = q.strip()
    if not term:
        return {"query": q, "results": []}
    like = f"%{term}%"
    results: list[dict] = []

    async with um().acquire() as c:
        users = await c.fetch(
            """
            SELECT 'user' AS type, id::text AS id, full_name AS title,
                   COALESCE(email, phone_number, '') AS subtitle
            FROM users
            WHERE id::text ILIKE $1 OR full_name ILIKE $1 OR email ILIKE $1 OR phone_number ILIKE $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            like,
            limit,
        )
        results.extend(_row(r) for r in users)

    async with ka().acquire() as c:
        rides = await c.fetch(
            """
            SELECT 'ride' AS type, id::text AS id, status::text AS title,
                   pickup_address || ' to ' || drop_address AS subtitle
            FROM rides
            WHERE id::text ILIKE $1 OR rider_id ILIKE $1 OR pickup_address ILIKE $1 OR drop_address ILIKE $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            like,
            limit,
        )
        runs = await c.fetch(
            """
            SELECT 'driver_run' AS type, id::text AS id, status::text AS title,
                   origin_address || ' to ' || dest_address AS subtitle
            FROM driver_runs
            WHERE id::text ILIKE $1 OR driver_id ILIKE $1 OR origin_address ILIKE $1 OR dest_address ILIKE $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            like,
            limit,
        )
        results.extend(_row(r) for r in rides)
        results.extend(_row(r) for r in runs)

    async with pa().acquire() as c:
        payments = await c.fetch(
            """
            SELECT 'payment' AS type, id::text AS id, status AS title,
                   stripe_pi_id AS subtitle
            FROM payment_intents
            WHERE stripe_pi_id ILIKE $1 OR passenger_id ILIKE $1 OR preference_id ILIKE $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            like,
            limit,
        )
        results.extend(_row(r) for r in payments)

    return {"query": q, "results": results[: limit * 4]}


@router.post("/query")
async def query_workbench(
    request: Request,
    body: QueryRequest,
    user: TokenPayload = Depends(require_role("admin")),
) -> dict:
    raw_sql = body.sql.strip().rstrip(";")

    validation_error = validate_readonly_sql(raw_sql)
    if validation_error:
        raise HTTPException(400, f"Query Studio: {validation_error}")

    pool = {"user_mgmt": um, "kamuit": ka, "payment": pa}[body.database]()
    try:
        async with pool.acquire() as c:
            await c.execute("SET statement_timeout = '10s'")
            rows = await c.fetch(f"SELECT * FROM ({raw_sql}) AS q LIMIT {body.limit}")
    except Exception:
        raise HTTPException(400, "Query execution failed. Check syntax and permissions.")

    ip = get_client_ip(request)
    ua = get_user_agent(request)
    await log_action(user.sub, "query_studio", role=user.role,
                     resource="database", resource_id=body.database,
                     detail={"sql": raw_sql[:500], "row_count": len(rows)},
                     ip_address=ip, user_agent=ua)

    columns = list(rows[0].keys()) if rows else []
    return {
        "database": body.database,
        "columns": columns,
        "rows": [_row(r) for r in rows],
        "row_count": len(rows),
        "limit": body.limit,
    }


@router.patch("/drivers/{user_id}/status")
async def update_driver_status(
    request: Request,
    user_id: UUID,
    body: DriverStatusPatch,
    user: TokenPayload = Depends(require_role("operator")),
) -> dict:
    updates = []
    args: list = []
    if body.verification_status is not None:
        args.append(body.verification_status)
        updates.append(f"verification_status = ${len(args)}::verificationstatus")
        args.append(body.verification_status == "approved")
        updates.append(f"is_verified = ${len(args)}")
    if not updates:
        raise HTTPException(400, "No driver fields supplied.")

    args.append(user_id)
    async with um().acquire() as c:
        row = await c.fetchrow(
            f"""
            UPDATE driver_profiles
            SET {", ".join(updates)}, updated_at = now()
            WHERE user_id = ${len(args)}
            RETURNING user_id::text, lower(verification_status::text) AS verification_status,
                      is_verified
            """,
            *args,
        )
    if not row:
        raise HTTPException(404, "Driver not found.")
    await log_action(user.sub, "update_driver_status", role=user.role,
                     resource="driver", resource_id=str(user_id),
                     detail={"verification_status": body.verification_status},
                     ip_address=get_client_ip(request), user_agent=get_user_agent(request))
    return {"updated": _row(row)}


@router.patch("/vehicles/{vehicle_id}/status")
async def update_vehicle_status(
    vehicle_id: UUID,
    body: VehicleStatusPatch,
    user: TokenPayload = Depends(require_role("operator")),
) -> dict:
    updates = []
    args: list = []
    for field in ("verification_status", "doc_verified", "insurance_verified", "history_verified", "vin_verified"):
        value = getattr(body, field)
        if value is not None:
            args.append(value)
            if field == "verification_status":
                updates.append(f"{field} = ${len(args)}::vehicleverificationstatus")
            else:
                updates.append(f"{field} = ${len(args)}")
    if not updates:
        raise HTTPException(400, "No vehicle fields supplied.")

    args.append(vehicle_id)
    async with um().acquire() as c:
        row = await c.fetchrow(
            f"""
            UPDATE vehicles
            SET {", ".join(updates)}, updated_at = now()
            WHERE id = ${len(args)}
            RETURNING id::text, lower(verification_status::text) AS verification_status,
                      doc_verified, insurance_verified, history_verified, vin_verified
            """,
            *args,
        )
    if not row:
        raise HTTPException(404, "Vehicle not found.")
    return {"updated": _row(row)}


@router.patch("/rides/{ride_id}/status")
async def update_ride_status(
    ride_id: UUID,
    body: RideStatusPatch,
    _: str = Depends(require_admin),
) -> dict:
    async with ka().acquire() as c:
        row = await c.fetchrow(
            """
            UPDATE rides
            SET status = $1::ridestatus, updated_at = now()
            WHERE id = $2
            RETURNING id::text, status::text AS status, updated_at
            """,
            body.status,
            ride_id,
        )
    if not row:
        raise HTTPException(404, "Ride not found.")
    return {"updated": _row(row)}


@router.patch("/driver-runs/{run_id}/status")
async def update_driver_run_status(
    run_id: UUID,
    body: DriverRunStatusPatch,
    _: str = Depends(require_admin),
) -> dict:
    async with ka().acquire() as c:
        row = await c.fetchrow(
            """
            UPDATE driver_runs
            SET status = $1::driverstatus, updated_at = now()
            WHERE id = $2
            RETURNING id::text, status::text AS status, updated_at
            """,
            body.status,
            run_id,
        )
    if not row:
        raise HTTPException(404, "Driver run not found.")
    return {"updated": _row(row)}
