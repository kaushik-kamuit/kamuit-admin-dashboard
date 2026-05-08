"""Quick post-setup sanity check for the additive DB extensions.

Not run automatically; invoke manually when you want to confirm that the
triggers, pings, and derived sessions are populated end-to-end:

    .\\.venv-bootstrap\\Scripts\\python.exe scripts\\verify_extensions.py
"""
from __future__ import annotations

import asyncio

import asyncpg


KAMUIT_DSN = "postgresql://kamuit_admin:local_dev_only@localhost:54322/kamuit_backend"
PAYMENT_DSN = "postgresql://kamuit_admin:local_dev_only@localhost:54323/kamuit_payment"


async def main() -> None:
    conn = await asyncpg.connect(KAMUIT_DSN)
    try:
        counts = {
            "ride_status_events": "SELECT count(*) FROM ride_status_events",
            "driver_run_status_events": "SELECT count(*) FROM driver_run_status_events",
            "preference_status_events": "SELECT count(*) FROM preference_status_events",
            "assignment_events": "SELECT count(*) FROM assignment_events",
            "otp_attempt_events": "SELECT count(*) FROM otp_attempt_events",
            "driver_location_pings": "SELECT count(*) FROM driver_location_pings",
            "driver_online_sessions": "SELECT count(*) FROM driver_online_sessions",
            "ride_geo_cache": "SELECT count(*) FROM ride_geo_cache",
            "driver_run_geo_cache": "SELECT count(*) FROM driver_run_geo_cache",
            "inferred_searches (view)": "SELECT count(*) FROM inferred_searches",
        }
        for label, sql in counts.items():
            n = await conn.fetchval(sql)
            print(f"  {label:<32} {n}")

        print("\nride_status_events by reason_code:")
        rows = await conn.fetch(
            "SELECT reason_code, count(*) FROM ride_status_events "
            "GROUP BY reason_code ORDER BY 1"
        )
        for reason, n in rows:
            print(f"    {reason:<12} {n}")

        print("\ndriver_location_pings sample (top 3):")
        rows = await conn.fetch(
            "SELECT driver_run_id, recorded_at, cell_500m, cell_2km "
            "FROM driver_location_pings ORDER BY recorded_at DESC LIMIT 3"
        )
        for r in rows:
            run = str(r["driver_run_id"])[:8]
            print(
                f"    run={run}  at={r['recorded_at']}  "
                f"c500={r['cell_500m']}  c2k={r['cell_2km']}"
            )
    finally:
        await conn.close()

    print("\nPayment views:")
    conn = await asyncpg.connect(PAYMENT_DSN)
    try:
        for view in ("v_driver_settlement", "v_payment_intent_daily"):
            n = await conn.fetchval(f"SELECT count(*) FROM {view}")
            print(f"  {view:<32} {n}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
