"""Time-series metrics and trend data."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.auth import require_role
from app.db import ka, pa, um

router = APIRouter()


@router.get("/snapshots")
async def get_snapshots(
    hours: int = Query(24, ge=1, le=168),
    _user=Depends(require_role("viewer")),
):
    rows = await um().fetch("""
        SELECT * FROM admin_metrics_snapshots
        WHERE ts > now() - make_interval(hours => $1)
        ORDER BY ts
    """, hours)
    return [dict(r) for r in rows]


@router.get("/latest")
async def get_latest(_user=Depends(require_role("viewer"))):
    row = await um().fetchrow("""
        SELECT * FROM admin_metrics_snapshots ORDER BY ts DESC LIMIT 1
    """)
    return dict(row) if row else {}


@router.get("/utilization")
async def driver_utilization(_user=Depends(require_role("viewer"))):
    """Driver utilization from v_driver_utilization view."""
    try:
        rows = await ka().fetch("SELECT * FROM v_driver_utilization ORDER BY online_hours DESC LIMIT 50")
        return [dict(r) for r in rows]
    except Exception:
        return []


@router.get("/payment-waterfall")
async def payment_waterfall(_user=Depends(require_role("viewer"))):
    try:
        rows = await pa().fetch("SELECT * FROM v_payment_waterfall")
        return [dict(r) for r in rows]
    except Exception:
        return []


@router.get("/payment-daily")
async def payment_daily(
    days: int = Query(30, ge=1, le=90),
    _user=Depends(require_role("viewer")),
):
    try:
        rows = await pa().fetch("""
            SELECT * FROM v_payment_daily
            WHERE day > current_date - $1
            ORDER BY day
        """, days)
        return [dict(r) for r in rows]
    except Exception:
        return []


@router.get("/anomalies")
async def trip_anomalies(
    limit: int = Query(50, ge=1, le=200),
    _user=Depends(require_role("viewer")),
):
    try:
        rows = await ka().fetch("""
            SELECT * FROM v_trip_anomalies
            ORDER BY recorded_at DESC LIMIT $1
        """, limit)
        return [dict(r) for r in rows]
    except Exception:
        return []


@router.get("/supply-demand")
async def supply_demand(
    resolution: str = Query("2km", pattern="^(500m|2km|10km)$"),
    hours: int = Query(24, ge=1, le=168),
    _user=Depends(require_role("viewer")),
):
    """Supply (driver pings) vs demand (ride preference origins) by cell."""
    cell_col = {"500m": "cell_500m", "2km": "cell_2km", "10km": "cell_10km"}.get(resolution, "cell_2km")
    center_lat_fn = {"500m": "admin_cell_center_lat(cell_500m, 0.005)",
                     "2km": "admin_cell_center_lat(cell_2km, 0.02)",
                     "10km": "admin_cell_center_lat(cell_10km, 0.1)"}.get(resolution, "admin_cell_center_lat(cell_2km, 0.02)")
    center_lng_fn = {"500m": "admin_cell_center_lng(cell_500m, 0.005)",
                     "2km": "admin_cell_center_lng(cell_2km, 0.02)",
                     "10km": "admin_cell_center_lng(cell_10km, 0.1)"}.get(resolution, "admin_cell_center_lng(cell_2km, 0.02)")

    try:
        # Supply: unique driver pings per cell
        supply = await ka().fetch(f"""
            SELECT {cell_col} AS cell,
                   {center_lat_fn} AS lat,
                   {center_lng_fn} AS lng,
                   COUNT(DISTINCT driver_id) AS supply
            FROM driver_location_pings
            WHERE recorded_at > now() - make_interval(hours => $1)
              AND {cell_col} IS NOT NULL
            GROUP BY {cell_col}
        """, hours)

        # Demand: ride preferences created per cell (using origin coords)
        demand = await ka().fetch("""
            SELECT COUNT(*) AS demand,
                   ROUND(AVG(rp.pickup_latitude)::numeric, 4) AS lat,
                   ROUND(AVG(rp.pickup_longitude)::numeric, 4) AS lng
            FROM ride_preferences rp
            WHERE rp.created_at > now() - make_interval(hours => $1)
              AND rp.pickup_latitude IS NOT NULL
            GROUP BY ROUND(rp.pickup_latitude::numeric, 2), ROUND(rp.pickup_longitude::numeric, 2)
        """, hours)

        return {
            "supply": [dict(r) for r in supply],
            "demand": [dict(r) for r in demand],
        }
    except Exception:
        return {"supply": [], "demand": []}
