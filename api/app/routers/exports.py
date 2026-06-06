"""Regulatory data export — CSV/JSON trip data for TNC compliance filings."""
from __future__ import annotations

import csv
import io
import json
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from app.auth import TokenPayload, require_role
from app.db import ka, pa
from app.audit import log_action

router = APIRouter()


@router.get("/trips")
async def export_trips(
    start_date: date = Query(..., description="Start date (inclusive)"),
    end_date: date = Query(..., description="End date (inclusive)"),
    fmt: str = Query("csv", pattern="^(csv|json)$"),
    user: TokenPayload = Depends(require_role("admin")),
):
    """Export trip data for TNC regulatory compliance."""
    rows = await ka().fetch(
        """
        SELECT
            r.id::text                       AS ride_id,
            r.rider_id,
            r.status::text                   AS ride_status,
            r.pickup_address,
            r.drop_address,
            ST_Y(r.pickup_point::geometry)   AS pickup_lat,
            ST_X(r.pickup_point::geometry)   AS pickup_lng,
            ST_Y(r.drop_point::geometry)     AS drop_lat,
            ST_X(r.drop_point::geometry)     AS drop_lng,
            r.seats_requested,
            r.created_at::text               AS requested_at,
            r.updated_at::text               AS last_updated,
            ra.driver_run_id::text,
            dr.driver_id,
            dr.origin_address                AS driver_origin,
            dr.dest_address                  AS driver_destination,
            dr.route_distance_meters,
            dr.route_duration_seconds
        FROM rides r
        LEFT JOIN ride_assignments ra ON ra.ride_id = r.id
        LEFT JOIN driver_runs dr ON dr.id = ra.driver_run_id
        WHERE r.created_at::date >= $1
          AND r.created_at::date <= $2
        ORDER BY r.created_at
        """,
        start_date,
        end_date,
    )

    await log_action(
        user.sub,
        "EXPORT_TRIPS",
        role=user.role,
        resource="trips",
        resource_id=f"{start_date}..{end_date}",
        detail={"format": fmt, "row_count": len(rows)},
    )

    data = [dict(r) for r in rows]

    if fmt == "json":
        return StreamingResponse(
            io.BytesIO(json.dumps(data, default=str, indent=2).encode()),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=kamuit-trips-{start_date}-{end_date}.json"},
        )

    buf = io.StringIO()
    if data:
        writer = csv.DictWriter(buf, fieldnames=list(data[0].keys()))
        writer.writeheader()
        writer.writerows(data)

    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=kamuit-trips-{start_date}-{end_date}.csv"},
    )


@router.get("/payments")
async def export_payments(
    start_date: date = Query(..., description="Start date (inclusive)"),
    end_date: date = Query(..., description="End date (inclusive)"),
    fmt: str = Query("csv", pattern="^(csv|json)$"),
    user: TokenPayload = Depends(require_role("admin")),
):
    """Export payment data for financial reporting."""
    rows = await pa().fetch(
        """
        SELECT
            pi.id::text                  AS payment_intent_id,
            pi.passenger_id,
            pi.driver_id,
            pi.ride_id::text,
            pi.amount_cents,
            ROUND(pi.amount_cents / 100.0, 2) AS amount_dollars,
            pi.currency,
            pi.status,
            pi.stripe_payment_intent_id,
            pi.created_at::text,
            pi.updated_at::text
        FROM payment_intents pi
        WHERE pi.created_at::date >= $1
          AND pi.created_at::date <= $2
        ORDER BY pi.created_at
        """,
        start_date,
        end_date,
    )

    await log_action(
        user.sub,
        "EXPORT_PAYMENTS",
        role=user.role,
        resource="payments",
        resource_id=f"{start_date}..{end_date}",
        detail={"format": fmt, "row_count": len(rows)},
    )

    data = [dict(r) for r in rows]

    if fmt == "json":
        return StreamingResponse(
            io.BytesIO(json.dumps(data, default=str, indent=2).encode()),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=kamuit-payments-{start_date}-{end_date}.json"},
        )

    buf = io.StringIO()
    if data:
        writer = csv.DictWriter(buf, fieldnames=list(data[0].keys()))
        writer.writeheader()
        writer.writerows(data)

    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=kamuit-payments-{start_date}-{end_date}.csv"},
    )


@router.get("/drivers")
async def export_drivers(
    fmt: str = Query("csv", pattern="^(csv|json)$"),
    user: TokenPayload = Depends(require_role("admin")),
):
    """Export driver roster for TNC compliance."""
    rows = await ka().fetch(
        """
        SELECT
            dr.driver_id,
            COUNT(*)                                                  AS total_runs,
            COUNT(*) FILTER (WHERE dr.status::text = 'COMPLETED')     AS completed_runs,
            COUNT(*) FILTER (WHERE dr.status::text = 'CANCELLED')     AS cancelled_runs,
            MIN(dr.created_at)::text                                  AS first_run_at,
            MAX(dr.created_at)::text                                  AS last_run_at,
            SUM(dr.route_distance_meters)                             AS total_distance_m,
            SUM(dr.route_duration_seconds)                            AS total_duration_s
        FROM driver_runs dr
        GROUP BY dr.driver_id
        ORDER BY total_runs DESC
        """
    )

    await log_action(
        user.sub,
        "EXPORT_DRIVERS",
        role=user.role,
        resource="drivers",
        detail={"format": fmt, "row_count": len(rows)},
    )

    data = [dict(r) for r in rows]

    if fmt == "json":
        return StreamingResponse(
            io.BytesIO(json.dumps(data, default=str, indent=2).encode()),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=kamuit-drivers.json"},
        )

    buf = io.StringIO()
    if data:
        writer = csv.DictWriter(buf, fieldnames=list(data[0].keys()))
        writer.writeheader()
        writer.writerows(data)

    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=kamuit-drivers.csv"},
    )
