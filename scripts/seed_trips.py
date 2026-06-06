"""
Post-seed enrichment that only runs AFTER `seed.py` and `apply_extensions.py`.

It produces:
  * Rich `driver_location_pings` trails along a straight-line interpolation
    from each active driver_run's origin to its destination, with small
    noise. ~40 points per trip over a synthetic 20-minute window.
  * A handful of status UPDATEs on rides / driver_runs / preferences so the
    *_status_events tables contain real TRIGGER rows (not only BACKFILL).
  * A handful of otp_attempts increments to exercise `otp_attempt_events`.

It is safe to run multiple times — each run appends more pings but the
event-log triggers only fire on actual transitions so the event tables
won't explode.
"""
from __future__ import annotations

import os
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

random.seed(43)  # different from seed.py's 42 so we layer new randomness


def connect() -> psycopg2.extensions.connection:
    user = os.environ.get("KAMUIT_DB_USER") or os.environ.get("LOCAL_PG_USER", "kamuit_admin")
    password = os.environ.get("KAMUIT_DB_PASSWORD") or os.environ.get("LOCAL_PG_PASSWORD", "local_dev_only")
    return psycopg2.connect(
        host=os.environ["KAMUIT_DB_HOST"],
        port=int(os.environ["KAMUIT_DB_PORT"]),
        dbname=os.environ["KAMUIT_DB_NAME"],
        user=user,
        password=password,
    )


def interpolate(a: float, b: float, t: float, jitter_deg: float = 0.0005) -> float:
    return a + (b - a) * t + (random.random() - 0.5) * jitter_deg * 2


def main() -> None:
    c = connect()
    c.autocommit = False
    cur = c.cursor()

    cur.execute("""
        SELECT dr.id::text, dr.driver_id,
               ST_Y(dr.origin_point::geometry) AS olat,
               ST_X(dr.origin_point::geometry) AS olng,
               ST_Y(dr.dest_point::geometry)   AS dlat,
               ST_X(dr.dest_point::geometry)   AS dlng,
               dr.status::text,
               (SELECT id FROM driver_run_schedules ds
                WHERE ds.driver_run_id = dr.id LIMIT 1) AS schedule_id
        FROM driver_runs dr
        WHERE dr.status IN ('IN_PROGRESS', 'PARTIALLY_FILLED', 'COMPLETED')
    """)
    runs = cur.fetchall()
    print(f"  generating ping trails for {len(runs)} active/completed runs")

    trail_rows = 0
    for run_id, driver_id, olat, olng, dlat, dlng, status, schedule_id in runs:
        if schedule_id is None:
            continue

        n_points = random.randint(30, 60)
        span_minutes = random.randint(15, 40)
        started = datetime.utcnow() - timedelta(minutes=span_minutes)

        for i in range(n_points):
            t = i / max(1, n_points - 1)
            lat = interpolate(olat, dlat, t)
            lng = interpolate(olng, dlng, t)
            recorded_at = started + timedelta(seconds=int((span_minutes * 60) * t))
            speed = max(0.0, random.gauss(12.0, 4.0))
            heading = random.uniform(0, 359)

            cur.execute(
                """
                INSERT INTO driver_location_pings (
                    driver_run_id, schedule_id, driver_id,
                    latitude, longitude, location_point,
                    accuracy_meters, heading, speed_mps,
                    route_fraction, distance_to_next_stop_m,
                    source, recorded_at
                )
                VALUES (
                    %s, %s, %s,
                    %s, %s,
                    ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                    %s, %s, %s, %s, %s,
                    'SEED', %s
                )
                """,
                (
                    run_id, schedule_id, driver_id,
                    lat, lng, lng, lat,
                    random.uniform(3, 15),
                    heading,
                    speed,
                    round(t, 3),
                    max(0.0, (1 - t) * random.uniform(500, 5000)),
                    recorded_at,
                ),
            )
            trail_rows += 1

    print(f"  inserted {trail_rows} ping rows")

    # Exercise the status-event triggers with some synthetic transitions.
    # UPDATE a few rides with current status != OFFER_SENT toward a new state
    # so *_status_events gets a TRIGGER row (not just BACKFILL).
    cur.execute("SELECT id FROM rides WHERE status = 'REQUESTED' LIMIT 3")
    for (ride_id,) in cur.fetchall():
        cur.execute("UPDATE rides SET status = 'OFFER_SENT', updated_at = now() WHERE id = %s", (ride_id,))
    cur.execute("SELECT id FROM rides WHERE status = 'ACCEPTED' LIMIT 2")
    for (ride_id,) in cur.fetchall():
        cur.execute("UPDATE rides SET status = 'PICKUP_ARRIVING', updated_at = now() WHERE id = %s", (ride_id,))
    cur.execute("SELECT id FROM rides WHERE status = 'PICKUP_ARRIVING' LIMIT 2")
    for (ride_id,) in cur.fetchall():
        cur.execute("UPDATE rides SET status = 'IN_PROGRESS', otp_attempts = otp_attempts + 1, updated_at = now() WHERE id = %s", (ride_id,))

    cur.execute("SELECT id FROM ride_preferences WHERE status = 'PENDING' LIMIT 3")
    for (pref_id,) in cur.fetchall():
        cur.execute("UPDATE ride_preferences SET status = 'OFFERED', offered_at = now() WHERE id = %s", (pref_id,))

    cur.execute("SELECT id FROM driver_runs WHERE status = 'OPEN' LIMIT 2")
    for (run_id,) in cur.fetchall():
        cur.execute("UPDATE driver_runs SET status = 'PARTIALLY_FILLED', updated_at = now() WHERE id = %s", (run_id,))

    c.commit()
    cur.close()
    c.close()
    print("  post-seed enrichment complete")


if __name__ == "__main__":
    main()
