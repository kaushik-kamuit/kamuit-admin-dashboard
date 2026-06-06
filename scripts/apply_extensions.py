"""
Apply additive SQL extensions (event logs, triggers, geo caches, helper views)
onto the three backend databases without touching any existing column.

Usage:
    python scripts/apply_extensions.py          # apply (idempotent)
    python scripts/apply_extensions.py --drop   # remove every extension object

Order: apply BEFORE scripts/seed.py so seed INSERTs fire the triggers and
populate event logs / pings / geo caches naturally.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
EXT_ROOT = PROJECT_ROOT / "db-extensions"

load_dotenv(PROJECT_ROOT / ".env")


# --- DB targets -------------------------------------------------------------

TARGETS = [
    {
        "name": "user-mgmt",
        "subdir": "user_mgmt",
        "host_env": "USER_MGMT_DB_HOST",
        "port_env": "USER_MGMT_DB_PORT",
        "name_env": "USER_MGMT_DB_NAME",
        "cred_prefix": "USER_MGMT",
    },
    {
        "name": "kamuit",
        "subdir": "kamuit",
        "host_env": "KAMUIT_DB_HOST",
        "port_env": "KAMUIT_DB_PORT",
        "name_env": "KAMUIT_DB_NAME",
        "cred_prefix": "KAMUIT",
    },
    {
        "name": "payment",
        "subdir": "payment",
        "host_env": "PAYMENT_DB_HOST",
        "port_env": "PAYMENT_DB_PORT",
        "name_env": "PAYMENT_DB_NAME",
        "cred_prefix": "PAYMENT",
    },
]


def _resolve_creds(target: dict) -> tuple[str, str]:
    prefix = target.get("cred_prefix", "")
    user = (os.environ.get(f"{prefix}_DB_USER") if prefix else None) or os.environ.get("LOCAL_PG_USER", "kamuit_admin")
    password = (os.environ.get(f"{prefix}_DB_PASSWORD") if prefix else None) or os.environ.get("LOCAL_PG_PASSWORD", "local_dev_only")
    return user, password


def connect(target: dict) -> psycopg2.extensions.connection:
    user, password = _resolve_creds(target)
    return psycopg2.connect(
        host=os.environ[target["host_env"]],
        port=int(os.environ[target["port_env"]]),
        dbname=os.environ[target["name_env"]],
        user=user,
        password=password,
    )


# --- apply -------------------------------------------------------------------

def apply_sql_files(target: dict) -> None:
    subdir = EXT_ROOT / target["subdir"]
    if not subdir.exists():
        print(f"  [{target['name']}] no extensions directory at {subdir}, skipping")
        return

    sql_files = sorted(p for p in subdir.glob("*.sql"))
    if not sql_files:
        print(f"  [{target['name']}] no .sql files under {subdir}")
        return

    conn = connect(target)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for sql_file in sql_files:
                sql = sql_file.read_text(encoding="utf-8")
                print(f"  [{target['name']}] applying {sql_file.name} ...")
                cur.execute(sql)
                conn.commit()
                print(f"  [{target['name']}] {sql_file.name} OK")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# --- drop --------------------------------------------------------------------

DROP_SQL = {
    "kamuit": """
        DROP TRIGGER IF EXISTS trg_ride_status_event         ON rides;
        DROP TRIGGER IF EXISTS trg_driver_run_status_event   ON driver_runs;
        DROP TRIGGER IF EXISTS trg_preference_status_event   ON ride_preferences;
        DROP TRIGGER IF EXISTS trg_assignment_event          ON ride_assignments;
        DROP TRIGGER IF EXISTS trg_capture_driver_location_ping ON driver_locations;
        DROP TRIGGER IF EXISTS trg_otp_attempt_event         ON rides;
        DROP TRIGGER IF EXISTS trg_sync_ride_geo_cache       ON rides;
        DROP TRIGGER IF EXISTS trg_sync_driver_run_geo_cache ON driver_runs;
        DROP TRIGGER IF EXISTS trg_fill_ping_cells           ON driver_location_pings;

        DROP FUNCTION IF EXISTS log_ride_status_event();
        DROP FUNCTION IF EXISTS log_driver_run_status_event();
        DROP FUNCTION IF EXISTS log_preference_status_event();
        DROP FUNCTION IF EXISTS log_assignment_event();
        DROP FUNCTION IF EXISTS capture_driver_location_ping();
        DROP FUNCTION IF EXISTS log_otp_attempt_event();
        DROP FUNCTION IF EXISTS sync_ride_geo_cache();
        DROP FUNCTION IF EXISTS sync_driver_run_geo_cache();
        DROP FUNCTION IF EXISTS fill_ping_cells();
        DROP FUNCTION IF EXISTS admin_cell_key(double precision, double precision, double precision);
        DROP FUNCTION IF EXISTS admin_cell_center_lng(text, double precision);
        DROP FUNCTION IF EXISTS admin_cell_center_lat(text, double precision);

        DROP VIEW  IF EXISTS preference_funnel_v2;
        DROP VIEW  IF EXISTS inferred_searches;

        DROP TABLE IF EXISTS ride_status_events;
        DROP TABLE IF EXISTS driver_run_status_events;
        DROP TABLE IF EXISTS preference_status_events;
        DROP TABLE IF EXISTS assignment_events;
        DROP TABLE IF EXISTS otp_attempt_events;
        DROP TABLE IF EXISTS driver_location_pings;
        DROP TABLE IF EXISTS driver_online_sessions;
        DROP TABLE IF EXISTS ride_geo_cache;
        DROP TABLE IF EXISTS driver_run_geo_cache;
    """,
    "payment": """
        DROP VIEW IF EXISTS v_driver_settlement;
        DROP VIEW IF EXISTS v_payment_intent_daily;
    """,
    "user-mgmt": """
        DROP INDEX IF EXISTS ix_users_created_at;
        DROP INDEX IF EXISTS ix_users_usertype;
        DROP INDEX IF EXISTS ix_users_auth_provider;
        DROP INDEX IF EXISTS ix_preferred_loc_user;
    """,
}


def drop_everything() -> None:
    for target in TARGETS:
        sql = DROP_SQL.get(target["name"], "")
        if not sql.strip():
            continue
        print(f"  [{target['name']}] dropping extension objects ...")
        conn = connect(target)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
        finally:
            conn.close()
        print(f"  [{target['name']}] drop OK")


# --- main --------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--drop", action="store_true",
                    help="drop every object the extensions install")
    args = ap.parse_args()

    if args.drop:
        drop_everything()
        print("\nAll extension objects dropped.")
        return

    for target in TARGETS:
        print(f"\n=== Applying extensions for {target['name']} ===")
        apply_sql_files(target)

    print("\nAll extensions applied.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)
