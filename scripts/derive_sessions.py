"""
Derive `driver_online_sessions` from `driver_location_pings`.

A session is a run of pings from the same driver where consecutive pings
are no more than IDLE_GAP_S seconds apart. A new session starts after a
gap larger than that.

Designed to run idempotently: it TRUNCATEs and rebuilds each time. That's
fine at dev / small-prod volume; if pings table grows beyond a few million
rows, switch to incremental (MAX(ended_at) watermark + only recompute
after that).

Run:
    python scripts/derive_sessions.py
"""
from __future__ import annotations

import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")


IDLE_GAP_S = 180  # 3 minutes with no ping => session ended


def connect() -> psycopg2.extensions.connection:
    return psycopg2.connect(
        host=os.environ["KAMUIT_DB_HOST"],
        port=int(os.environ["KAMUIT_DB_PORT"]),
        dbname=os.environ["KAMUIT_DB_NAME"],
        user=os.environ.get("LOCAL_PG_USER", "kamuit_admin"),
        password=os.environ.get("LOCAL_PG_PASSWORD", "local_dev_only"),
    )


SQL = """
TRUNCATE TABLE driver_online_sessions RESTART IDENTITY;

WITH ordered AS (
    SELECT driver_id, recorded_at, latitude, longitude, driver_run_id,
           LAG(recorded_at) OVER (PARTITION BY driver_id ORDER BY recorded_at) AS prev_at
    FROM driver_location_pings
),
marked AS (
    SELECT *,
           CASE WHEN prev_at IS NULL
                     OR EXTRACT(EPOCH FROM (recorded_at - prev_at)) > %(gap_s)s
                THEN 1 ELSE 0
           END AS is_new_session
    FROM ordered
),
session_ids AS (
    SELECT driver_id, recorded_at, latitude, longitude, driver_run_id,
           SUM(is_new_session) OVER (PARTITION BY driver_id ORDER BY recorded_at
                                      ROWS UNBOUNDED PRECEDING) AS session_num
    FROM marked
)
INSERT INTO driver_online_sessions (
    driver_id, started_at, ended_at, total_seconds,
    assigned_seconds, idle_seconds, pings_count,
    start_lat, start_lng, end_lat, end_lng, computed_at
)
SELECT
    driver_id,
    MIN(recorded_at)                                  AS started_at,
    MAX(recorded_at)                                  AS ended_at,
    GREATEST(
        EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at)))::int,
        0
    )                                                 AS total_seconds,
    GREATEST(
        EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at)))::int,
        0
    )                                                 AS assigned_seconds,
    0                                                 AS idle_seconds,
    COUNT(*)                                          AS pings_count,
    (ARRAY_AGG(latitude  ORDER BY recorded_at))[1]    AS start_lat,
    (ARRAY_AGG(longitude ORDER BY recorded_at))[1]    AS start_lng,
    (ARRAY_AGG(latitude  ORDER BY recorded_at DESC))[1] AS end_lat,
    (ARRAY_AGG(longitude ORDER BY recorded_at DESC))[1] AS end_lng,
    now()
FROM session_ids
GROUP BY driver_id, session_num;
"""


def main() -> None:
    conn = connect()
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute(SQL, {"gap_s": IDLE_GAP_S})
            cur.execute("SELECT COUNT(*) FROM driver_online_sessions")
            count = cur.fetchone()[0]
        conn.commit()
        print(f"  driver_online_sessions rebuilt: {count} rows")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
