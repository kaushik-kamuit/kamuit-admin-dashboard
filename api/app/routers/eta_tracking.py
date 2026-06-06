"""ETA accuracy tracking — predicted vs actual arrival times."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from app.auth import TokenPayload, require_role
from app.db import ka

router = APIRouter()


@router.get("/accuracy")
async def eta_accuracy(
    days: int = Query(7, ge=1, le=30),
    limit: int = Query(100, ge=1, le=500),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    """
    Compare estimated trip duration (from route_duration_seconds * pickup/drop fractions)
    against actual elapsed time (from ride_status_events IN_PROGRESS -> COMPLETED).
    """
    rows = await ka().fetch(
        """
        WITH completed_rides AS (
            SELECT
                rse_start.ride_id,
                rse_start.occurred_at AS started_at,
                rse_end.occurred_at   AS completed_at,
                EXTRACT(EPOCH FROM rse_end.occurred_at - rse_start.occurred_at) AS actual_seconds
            FROM ride_status_events rse_start
            JOIN ride_status_events rse_end
                ON rse_end.ride_id = rse_start.ride_id
               AND rse_end.to_status = 'COMPLETED'
            WHERE rse_start.to_status = 'IN_PROGRESS'
              AND rse_start.occurred_at >= now() - ($1 || ' days')::interval
        ),
        with_estimate AS (
            SELECT
                cr.ride_id,
                cr.started_at,
                cr.completed_at,
                cr.actual_seconds,
                dr.route_duration_seconds,
                ra.pickup_fraction,
                ra.drop_fraction,
                dr.route_duration_seconds * (ra.drop_fraction - ra.pickup_fraction)
                    AS estimated_leg_seconds
            FROM completed_rides cr
            JOIN ride_assignments ra ON ra.ride_id = cr.ride_id
            JOIN driver_runs dr ON dr.id = ra.driver_run_id
            WHERE dr.route_duration_seconds IS NOT NULL
              AND ra.pickup_fraction IS NOT NULL
              AND ra.drop_fraction IS NOT NULL
        )
        SELECT
            ride_id::text,
            started_at::text,
            completed_at::text,
            ROUND(actual_seconds::numeric, 0)         AS actual_seconds,
            ROUND(estimated_leg_seconds::numeric, 0)  AS estimated_seconds,
            ROUND((actual_seconds - estimated_leg_seconds)::numeric, 0) AS drift_seconds,
            CASE
                WHEN estimated_leg_seconds > 0 THEN
                    ROUND(((actual_seconds - estimated_leg_seconds) / estimated_leg_seconds * 100)::numeric, 1)
                ELSE NULL
            END AS drift_pct
        FROM with_estimate
        ORDER BY ABS(actual_seconds - estimated_leg_seconds) DESC
        LIMIT $2
        """,
        str(days),
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/summary")
async def eta_summary(
    days: int = Query(7, ge=1, le=30),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    """Aggregate ETA accuracy metrics."""
    row = await ka().fetchrow(
        """
        WITH completed_rides AS (
            SELECT
                rse_start.ride_id,
                EXTRACT(EPOCH FROM rse_end.occurred_at - rse_start.occurred_at) AS actual_seconds
            FROM ride_status_events rse_start
            JOIN ride_status_events rse_end
                ON rse_end.ride_id = rse_start.ride_id
               AND rse_end.to_status = 'COMPLETED'
            WHERE rse_start.to_status = 'IN_PROGRESS'
              AND rse_start.occurred_at >= now() - ($1 || ' days')::interval
        ),
        with_estimate AS (
            SELECT
                cr.ride_id,
                cr.actual_seconds,
                dr.route_duration_seconds * (ra.drop_fraction - ra.pickup_fraction)
                    AS estimated_leg_seconds
            FROM completed_rides cr
            JOIN ride_assignments ra ON ra.ride_id = cr.ride_id
            JOIN driver_runs dr ON dr.id = ra.driver_run_id
            WHERE dr.route_duration_seconds IS NOT NULL
              AND ra.pickup_fraction IS NOT NULL
              AND ra.drop_fraction IS NOT NULL
              AND dr.route_duration_seconds * (ra.drop_fraction - ra.pickup_fraction) > 0
        )
        SELECT
            COUNT(*)                                                           AS total_trips,
            ROUND(AVG(actual_seconds)::numeric, 0)                             AS avg_actual_s,
            ROUND(AVG(estimated_leg_seconds)::numeric, 0)                      AS avg_estimated_s,
            ROUND(AVG(actual_seconds - estimated_leg_seconds)::numeric, 0)     AS avg_drift_s,
            ROUND(AVG(ABS(actual_seconds - estimated_leg_seconds))::numeric, 0) AS avg_abs_drift_s,
            ROUND(
                AVG((actual_seconds - estimated_leg_seconds) / estimated_leg_seconds * 100)::numeric, 1
            )                                                                  AS avg_drift_pct,
            COUNT(*) FILTER (WHERE actual_seconds > estimated_leg_seconds * 1.5) AS severely_late,
            COUNT(*) FILTER (WHERE actual_seconds < estimated_leg_seconds * 0.5) AS severely_early
        FROM with_estimate
        """,
        str(days),
    )
    return dict(row) if row else {}


@router.get("/distribution")
async def eta_drift_distribution(
    days: int = Query(7, ge=1, le=30),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    """Histogram of ETA drift in 1-minute buckets."""
    rows = await ka().fetch(
        """
        WITH completed_rides AS (
            SELECT
                rse_start.ride_id,
                EXTRACT(EPOCH FROM rse_end.occurred_at - rse_start.occurred_at) AS actual_seconds
            FROM ride_status_events rse_start
            JOIN ride_status_events rse_end
                ON rse_end.ride_id = rse_start.ride_id
               AND rse_end.to_status = 'COMPLETED'
            WHERE rse_start.to_status = 'IN_PROGRESS'
              AND rse_start.occurred_at >= now() - ($1 || ' days')::interval
        ),
        with_estimate AS (
            SELECT
                cr.actual_seconds,
                dr.route_duration_seconds * (ra.drop_fraction - ra.pickup_fraction)
                    AS estimated_leg_seconds
            FROM completed_rides cr
            JOIN ride_assignments ra ON ra.ride_id = cr.ride_id
            JOIN driver_runs dr ON dr.id = ra.driver_run_id
            WHERE dr.route_duration_seconds IS NOT NULL
              AND ra.pickup_fraction IS NOT NULL
              AND ra.drop_fraction IS NOT NULL
        ),
        bucketed AS (
            SELECT
                FLOOR((actual_seconds - estimated_leg_seconds) / 60.0) AS drift_minutes
            FROM with_estimate
        )
        SELECT drift_minutes::int, COUNT(*) AS count
        FROM bucketed
        GROUP BY drift_minutes
        ORDER BY drift_minutes
        """,
        str(days),
    )
    return [dict(r) for r in rows]
