"""Background tasks: periodic metrics snapshots and anomaly detection."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

from app.db import ka, pa, um

logger = logging.getLogger("kamuit.background")

SNAPSHOT_INTERVAL_S = 900  # 15 minutes
ANOMALY_INTERVAL_S = 300   # 5 minutes

_tasks: list[asyncio.Task] = []


async def _ensure_admin_tables() -> None:
    """Ensure admin tables exist (idempotent)."""
    try:
        await um().execute("SELECT 1 FROM admin_metrics_snapshots LIMIT 0")
    except Exception:
        logger.warning("admin_metrics_snapshots table not found; skipping background tasks")
        raise


async def _collect_snapshot() -> None:
    """Collect metrics from all 3 DBs and insert a snapshot row."""
    try:
        # kamuit DB metrics
        ka_row = await ka().fetchrow("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') AS active_trips,
                COUNT(*) FILTER (WHERE status = 'OPEN') AS open_runs,
                COUNT(*) FILTER (WHERE status = 'COMPLETED' AND updated_at > now() - interval '24 hours') AS completed_24h,
                COUNT(*) FILTER (WHERE status = 'CANCELLED' AND updated_at > now() - interval '24 hours') AS cancelled_24h
            FROM driver_runs
        """)

        # user_mgmt DB metrics
        um_row = await um().fetchrow("""
            SELECT
                COUNT(*) FILTER (WHERE dp.verification_status = 'pending') AS pending_verifications
            FROM driver_profiles dp
        """)

        # Count online drivers (had a ping in last 10 min)
        online = await ka().fetchval("""
            SELECT COUNT(DISTINCT driver_id)
            FROM driver_location_pings
            WHERE recorded_at > now() - interval '10 minutes'
        """) or 0

        # payment DB metrics
        pa_row = await pa().fetchrow("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'failed') AS failed_payments,
                COALESCE(SUM(amount_cents) FILTER (WHERE status = 'requires_capture'), 0) / 100.0 AS held_amount,
                COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded' AND created_at > now() - interval '24 hours'), 0) / 100.0 AS revenue_24h
            FROM payment_intents
        """)

        await um().execute("""
            INSERT INTO admin_metrics_snapshots
                (ts, active_drivers, active_trips, open_runs, pending_verifications,
                 failed_payments, held_capture_amount, online_drivers,
                 completed_rides_24h, cancelled_rides_24h, total_revenue_24h)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        """,
            datetime.now(timezone.utc),
            online,
            ka_row["active_trips"] if ka_row else 0,
            ka_row["open_runs"] if ka_row else 0,
            um_row["pending_verifications"] if um_row else 0,
            pa_row["failed_payments"] if pa_row else 0,
            float(pa_row["held_amount"]) if pa_row else 0.0,
            online,
            ka_row["completed_24h"] if ka_row else 0,
            ka_row["cancelled_24h"] if ka_row else 0,
            float(pa_row["revenue_24h"]) if pa_row else 0.0,
        )
        logger.info("Metrics snapshot collected")
    except Exception as e:
        logger.error(f"Metrics snapshot failed: {e}")


async def _detect_anomalies() -> None:
    """Scan for trip anomalies and insert alerts."""
    try:
        # Stale GPS on active runs (no ping in 10+ minutes)
        stale = await ka().fetch("""
            SELECT dr.id AS run_id, dr.driver_id, dr.status,
                   MAX(dlp.recorded_at) AS last_ping
            FROM driver_runs dr
            LEFT JOIN driver_location_pings dlp ON dlp.driver_run_id = dr.id
            WHERE dr.status = 'IN_PROGRESS'
            GROUP BY dr.id
            HAVING MAX(dlp.recorded_at) < now() - interval '10 minutes'
               OR MAX(dlp.recorded_at) IS NULL
        """)
        for row in stale:
            existing = await um().fetchval("""
                SELECT id FROM admin_alerts
                WHERE category = 'stale_gps' AND entity_id = $1 AND resolved_at IS NULL
            """, str(row["run_id"]))
            if not existing:
                await um().execute("""
                    INSERT INTO admin_alerts (severity, category, title, detail, entity_type, entity_id, meta)
                    VALUES ('warning', 'stale_gps', $1, $2, 'driver_run', $3, $4::jsonb)
                """,
                    f"Stale GPS on run {str(row['run_id'])[:8]}",
                    f"No ping since {row['last_ping'] or 'never'} for active run",
                    str(row["run_id"]),
                    json.dumps({"driver_id": str(row["driver_id"])}),
                )

        # Speed anomalies (>160 km/h)
        try:
            speed_anomalies = await ka().fetch("""
                SELECT * FROM v_trip_anomalies
                WHERE anomaly_type IN ('gps_spoof', 'excessive_speed')
                AND recorded_at > now() - interval '10 minutes'
                LIMIT 20
            """)
            for row in speed_anomalies:
                existing = await um().fetchval("""
                    SELECT id FROM admin_alerts
                    WHERE category = 'speed_anomaly' AND entity_id = $1
                    AND ts > now() - interval '1 hour' AND resolved_at IS NULL
                """, str(row["ping_id"]))
                if not existing:
                    await um().execute("""
                        INSERT INTO admin_alerts (severity, category, title, detail, entity_type, entity_id, meta)
                        VALUES ($1, 'speed_anomaly', $2, $3, 'ping', $4, $5::jsonb)
                    """,
                        "critical" if row["anomaly_type"] == "gps_spoof" else "warning",
                        f"{'GPS spoof' if row['anomaly_type'] == 'gps_spoof' else 'Excessive speed'} detected: {row['speed_kmh']} km/h",
                        f"Run {str(row['driver_run_id'])[:8]}, driver {str(row['driver_id'])[:8]}",
                        str(row["ping_id"]),
                        json.dumps({
                            "driver_run_id": str(row["driver_run_id"]),
                            "driver_id": str(row["driver_id"]),
                            "speed_kmh": float(row["speed_kmh"]) if row["speed_kmh"] else None,
                        }),
                    )
        except Exception:
            pass  # v_trip_anomalies may not exist yet

        # Failed payment intents (new in last 10 min)
        try:
            failed = await pa().fetch("""
                SELECT id, passenger_id, amount_cents, status
                FROM payment_intents
                WHERE status = 'failed'
                AND updated_at > now() - interval '10 minutes'
            """)
            for row in failed:
                existing = await um().fetchval("""
                    SELECT id FROM admin_alerts
                    WHERE category = 'payment_failed' AND entity_id = $1 AND resolved_at IS NULL
                """, str(row["id"]))
                if not existing:
                    amt = (row["amount_cents"] or 0) / 100.0
                    await um().execute("""
                        INSERT INTO admin_alerts (severity, category, title, detail, entity_type, entity_id, meta)
                        VALUES ('warning', 'payment_failed', $1, $2, 'payment_intent', $3, $4::jsonb)
                    """,
                        f"Payment failed: ${amt:.2f}",
                        f"Passenger {str(row['passenger_id'] or '')[:8]}",
                        str(row["id"]),
                        json.dumps({"passenger_id": str(row["passenger_id"] or ""), "amount": amt}),
                    )
        except Exception:
            pass

        logger.info("Anomaly detection completed")
    except Exception as e:
        logger.error(f"Anomaly detection failed: {e}")


async def _snapshot_loop() -> None:
    await asyncio.sleep(5)  # let pools initialize
    try:
        await _ensure_admin_tables()
    except Exception:
        return
    # Collect an initial snapshot immediately
    await _collect_snapshot()
    while True:
        await asyncio.sleep(SNAPSHOT_INTERVAL_S)
        await _collect_snapshot()


async def _anomaly_loop() -> None:
    await asyncio.sleep(10)
    try:
        await _ensure_admin_tables()
    except Exception:
        return
    await _detect_anomalies()
    while True:
        await asyncio.sleep(ANOMALY_INTERVAL_S)
        await _detect_anomalies()


def start_background_tasks() -> None:
    _tasks.append(asyncio.create_task(_snapshot_loop()))
    _tasks.append(asyncio.create_task(_anomaly_loop()))
    logger.info("Background tasks started (metrics: %ds, anomaly: %ds)", SNAPSHOT_INTERVAL_S, ANOMALY_INTERVAL_S)


async def stop_background_tasks() -> None:
    for t in _tasks:
        t.cancel()
    for t in _tasks:
        try:
            await t
        except asyncio.CancelledError:
            pass
    _tasks.clear()
