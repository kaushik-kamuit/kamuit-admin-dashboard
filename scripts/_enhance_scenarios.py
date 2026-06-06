"""
Post-seed enhancement: add realistic status transitions for ETA accuracy,
more cancellation scenarios, and fresh "right now" driver_locations for
the live map.
"""
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

random.seed(44)


def connect():
    user = os.environ.get("KAMUIT_DB_USER") or os.environ.get("LOCAL_PG_USER", "kamuit_admin")
    password = os.environ.get("KAMUIT_DB_PASSWORD") or os.environ.get("LOCAL_PG_PASSWORD", "local_dev_only")
    return psycopg2.connect(
        host=os.environ["KAMUIT_DB_HOST"],
        port=int(os.environ["KAMUIT_DB_PORT"]),
        dbname=os.environ["KAMUIT_DB_NAME"],
        user=user,
        password=password,
    )


def main():
    c = connect()
    c.autocommit = False
    cur = c.cursor()
    now = datetime.now(timezone.utc)

    # 1. Create realistic IN_PROGRESS -> COMPLETED transitions for ETA accuracy
    # Find rides currently IN_PROGRESS with assignments that have pickup/drop fractions
    cur.execute("""
        SELECT r.id, ra.driver_run_id, ra.pickup_fraction, ra.drop_fraction,
               dr.route_duration_seconds
        FROM rides r
        JOIN ride_assignments ra ON ra.ride_id = r.id
        JOIN driver_runs dr ON dr.id = ra.driver_run_id
        WHERE r.status = 'IN_PROGRESS'
          AND ra.pickup_fraction IS NOT NULL
          AND ra.drop_fraction IS NOT NULL
          AND dr.route_duration_seconds IS NOT NULL
    """)
    in_progress = cur.fetchall()
    completed_count = 0
    for ride_id, run_id, pf, df, dur_s in in_progress[:15]:
        estimated_leg = dur_s * (df - pf)
        actual_deviation = random.uniform(-0.4, 0.6)
        actual_leg = max(30, estimated_leg * (1 + actual_deviation))

        # First ensure there's an IN_PROGRESS event
        cur.execute("""
            SELECT COUNT(*) FROM ride_status_events
            WHERE ride_id = %s AND to_status = 'IN_PROGRESS'
        """, (ride_id,))
        has_ip = cur.fetchone()[0]
        if not has_ip:
            ip_time = now - timedelta(seconds=int(actual_leg) + random.randint(60, 300))
            cur.execute("""
                INSERT INTO ride_status_events (ride_id, from_status, to_status, reason_code, occurred_at)
                VALUES (%s, 'PICKUP_ARRIVING', 'IN_PROGRESS', 'SEED_ENHANCE', %s)
            """, (ride_id, ip_time))

        # Now complete the ride
        cur.execute("""
            SELECT occurred_at FROM ride_status_events
            WHERE ride_id = %s AND to_status = 'IN_PROGRESS'
            ORDER BY occurred_at DESC LIMIT 1
        """, (ride_id,))
        ip_event = cur.fetchone()
        if ip_event:
            completed_at = ip_event[0] + timedelta(seconds=int(actual_leg))
            cur.execute("UPDATE rides SET status = 'COMPLETED', updated_at = %s WHERE id = %s",
                        (completed_at, ride_id))
            completed_count += 1

    print(f"  Completed {completed_count} IN_PROGRESS rides for ETA accuracy")

    # 2. Add some recent cancellations with varied stages
    cur.execute("""
        SELECT r.id, r.status::text FROM rides r
        WHERE r.status IN ('ACCEPTED', 'PICKUP_ARRIVING', 'OFFER_SENT', 'REQUESTED')
        ORDER BY random() LIMIT 20
    """)
    cancel_targets = cur.fetchall()
    cancel_count = 0
    for ride_id, current_status in cancel_targets:
        if random.random() < 0.5:
            cur.execute("UPDATE rides SET status = 'CANCELLED', updated_at = %s WHERE id = %s",
                        (now - timedelta(minutes=random.randint(1, 1440)), ride_id))
            cancel_count += 1

    print(f"  Added {cancel_count} additional cancellations from various stages")

    # 3. Ensure driver_locations are fresh (within last 5 minutes) for the live map
    cur.execute("""
        SELECT dr.id, dr.driver_id,
               ST_Y(dr.origin_point::geometry) AS olat,
               ST_X(dr.origin_point::geometry) AS olng,
               ST_Y(dr.dest_point::geometry) AS dlat,
               ST_X(dr.dest_point::geometry) AS dlng,
               (SELECT ds.id FROM driver_run_schedules ds WHERE ds.driver_run_id = dr.id LIMIT 1) AS sched_id
        FROM driver_runs dr
        WHERE dr.status IN ('IN_PROGRESS', 'PARTIALLY_FILLED')
    """)
    active_runs = cur.fetchall()
    loc_count = 0
    for run_id, driver_id, olat, olng, dlat, dlng, sched_id in active_runs:
        if not sched_id:
            continue
        t = random.uniform(0.1, 0.9)
        lat = olat + (dlat - olat) * t + (random.random() - 0.5) * 0.002
        lng = olng + (dlng - olng) * t + (random.random() - 0.5) * 0.002
        speed = random.uniform(5, 25)

        # Upsert into driver_locations
        cur.execute("""
            INSERT INTO driver_locations (
                id, driver_run_id, schedule_id, driver_id,
                latitude, longitude, location_point,
                accuracy_meters, heading, speed_mps,
                route_fraction, distance_to_next_stop_m, next_stop_leg_order,
                recommended_interval_s,
                created_at, updated_at, is_active
            )
            VALUES (%s, %s, %s, %s, %s, %s,
                    ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                    %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, true)
            ON CONFLICT (driver_run_id, schedule_id) DO UPDATE SET
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                location_point = EXCLUDED.location_point,
                speed_mps = EXCLUDED.speed_mps,
                route_fraction = EXCLUDED.route_fraction,
                heading = EXCLUDED.heading,
                updated_at = EXCLUDED.updated_at
        """, (
            run_id, run_id, sched_id, driver_id,
            lat, lng, lng, lat,
            random.uniform(3, 15), random.uniform(0, 359), speed,
            round(t, 3), max(0, (1 - t) * random.uniform(500, 5000)),
            random.randint(1, 3), random.randint(5, 15),
            now, now,
        ))
        loc_count += 1

        # Also add a very recent ping
        cur.execute("""
            INSERT INTO driver_location_pings (
                driver_run_id, schedule_id, driver_id,
                latitude, longitude, location_point,
                accuracy_meters, heading, speed_mps,
                route_fraction, distance_to_next_stop_m,
                source, recorded_at
            )
            VALUES (%s, %s, %s, %s, %s,
                    ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                    %s, %s, %s, %s, %s, 'LIVE_SEED', %s)
        """, (
            run_id, sched_id, driver_id,
            lat, lng, lng, lat,
            random.uniform(3, 10), random.uniform(0, 359), speed,
            round(t, 3), max(0, (1 - t) * random.uniform(500, 3000)),
            now - timedelta(seconds=random.randint(5, 120)),
        ))

    print(f"  Updated {loc_count} driver_locations to fresh positions for live map")

    c.commit()
    cur.close()
    c.close()
    print("  Enhancement complete")


if __name__ == "__main__":
    main()
