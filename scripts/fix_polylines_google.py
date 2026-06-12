"""
Fetch real Google Directions API polylines for all driver_runs that have
polylines (the seeded ones), using the same API and format as
kamuit-backend's RoutingService.get_route_google().

Replaces OSRM/fake polylines with actual Google overview_polyline.points.

Usage:
    python scripts/fix_polylines_google.py
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

load_dotenv(PROJECT_ROOT / "render.env")
load_dotenv(PROJECT_ROOT / ".env")

# Use the same key the kamuit-backend uses
KAMUIT_BACKEND_ENV = PROJECT_ROOT.parent / "kamuit-backend" / ".env"
if KAMUIT_BACKEND_ENV.exists():
    load_dotenv(KAMUIT_BACKEND_ENV, override=True)

GOOGLE_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
GOOGLE_BASE = "https://maps.googleapis.com/maps/api/directions/json"


def ka_conn():
    return psycopg2.connect(
        host=os.environ["KAMUIT_DB_HOST"],
        port=int(os.environ["KAMUIT_DB_PORT"]),
        dbname=os.environ["KAMUIT_DB_NAME"],
        user=os.environ.get("KAMUIT_DB_USER", os.environ.get("LOCAL_PG_USER", "")),
        password=os.environ.get("KAMUIT_DB_PASSWORD", os.environ.get("LOCAL_PG_PASSWORD", "")),
        sslmode=os.environ.get("DB_SSLMODE", "prefer"),
    )


def fetch_google_polyline(origin_lat, origin_lng, dest_lat, dest_lng):
    """
    Mirror of RoutingService.get_route_google() — calls Google Directions API
    and returns (overview_polyline, distance_m, duration_s).
    """
    params = (
        f"origin={origin_lat},{origin_lng}"
        f"&destination={dest_lat},{dest_lng}"
        f"&mode=driving"
        f"&key={GOOGLE_API_KEY}"
    )
    url = f"{GOOGLE_BASE}?{params}"

    req = urllib.request.Request(url)
    resp = urllib.request.urlopen(req, timeout=15)
    data = json.loads(resp.read())

    if data.get("status") != "OK" or not data.get("routes"):
        return None, None, None, data.get("status"), data.get("error_message")

    route = data["routes"][0]
    leg = route["legs"][0]

    polyline = route["overview_polyline"]["points"]
    distance_m = leg["distance"]["value"]
    duration_s = leg["duration"]["value"]
    return polyline, distance_m, duration_s, "OK", None


def main():
    if not GOOGLE_API_KEY:
        print("ERROR: GOOGLE_MAPS_API_KEY not found.")
        print("  Checked: render.env, .env, and kamuit-backend/.env")
        return

    print(f"Using Google API key: {GOOGLE_API_KEY[:12]}...{GOOGLE_API_KEY[-4:]}")
    print(f"Endpoint: {GOOGLE_BASE}\n")

    c = ka_conn()
    cur = c.cursor()

    cur.execute("""
        SELECT id::text,
               ST_Y(origin_point::geometry) AS origin_lat,
               ST_X(origin_point::geometry) AS origin_lng,
               ST_Y(dest_point::geometry) AS dest_lat,
               ST_X(dest_point::geometry) AS dest_lng,
               origin_address, dest_address,
               status::text,
               length(route_polyline) AS pl_len
        FROM driver_runs
        ORDER BY created_at DESC
    """)
    runs = cur.fetchall()
    print(f"Found {len(runs)} runs to update with Google polylines\n")

    updated = 0
    failed = 0

    for run in runs:
        run_id, olat, olng, dlat, dlng, oaddr, daddr, status, pl_len = run
        short_id = run_id[:8]

        print(f"  {short_id}  {status:18s}  {oaddr[:40]:40s}  ", end="", flush=True)

        try:
            polyline, dist_m, dur_s, gstatus, gerr = fetch_google_polyline(olat, olng, dlat, dlng)
        except Exception as e:
            print(f"FAILED: {e}")
            failed += 1
            time.sleep(0.5)
            continue

        if not polyline:
            print(f"FAILED: Google status={gstatus} err={gerr}")
            failed += 1
            time.sleep(0.5)
            continue

        cur.execute("""
            UPDATE driver_runs
            SET route_polyline = %s,
                route_distance_meters = %s,
                route_duration_seconds = %s
            WHERE id = %s
        """, (polyline, dist_m, dur_s, run_id))

        print(f"OK  polyline={len(polyline)} chars  {dist_m}m  {dur_s}s")
        updated += 1

        time.sleep(0.3)

    c.commit()
    cur.close()
    c.close()

    print(f"\nDone: {updated} updated with Google polylines, {failed} failed")


if __name__ == "__main__":
    main()
