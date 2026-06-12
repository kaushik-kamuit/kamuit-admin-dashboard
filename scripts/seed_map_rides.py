"""
Seed realistic College Station driver-runs with encoded polylines,
linked rides, and ride assignments — for Live Map visualization.

Connects directly to the Render production DBs.
Does NOT truncate existing data — purely additive.

Usage:
    python scripts/seed_map_rides.py
"""
from __future__ import annotations

import os
import random
import uuid
from datetime import datetime, timedelta, timezone, date, time as dtime
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
load_dotenv(PROJECT_ROOT / "render.env")
load_dotenv(PROJECT_ROOT / ".env")

random.seed(2026)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _conn(host_key: str, port_key: str, name_key: str, user_key: str, pw_key: str):
    dsn_params = dict(
        host=os.environ[host_key],
        port=int(os.environ[port_key]),
        dbname=os.environ[name_key],
        user=os.environ.get(user_key, os.environ.get("LOCAL_PG_USER", "kamuit_admin")),
        password=os.environ.get(pw_key, os.environ.get("LOCAL_PG_PASSWORD", "")),
        sslmode=os.environ.get("DB_SSLMODE", "prefer"),
    )
    return psycopg2.connect(**dsn_params)


def ka_conn():
    return _conn(
        "KAMUIT_DB_HOST", "KAMUIT_DB_PORT", "KAMUIT_DB_NAME",
        "KAMUIT_DB_USER", "KAMUIT_DB_PASSWORD",
    )


def um_conn():
    return _conn(
        "USER_MGMT_DB_HOST", "USER_MGMT_DB_PORT", "USER_MGMT_DB_NAME",
        "USER_MGMT_DB_USER", "USER_MGMT_DB_PASSWORD",
    )


# ---------------------------------------------------------------------------
# Google polyline encoder
# ---------------------------------------------------------------------------

def encode_polyline(coords: list[tuple[float, float]]) -> str:
    """Encode a list of (lat, lng) into a Google-encoded polyline string."""
    result = []
    prev_lat = 0
    prev_lng = 0
    for lat, lng in coords:
        lat_e5 = round(lat * 1e5)
        lng_e5 = round(lng * 1e5)
        d_lat = lat_e5 - prev_lat
        d_lng = lng_e5 - prev_lng
        for v in (d_lat, d_lng):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                result.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            result.append(chr(v + 63))
        prev_lat = lat_e5
        prev_lng = lng_e5
    return "".join(result)


# ---------------------------------------------------------------------------
# College Station route definitions — real road corridors
# ---------------------------------------------------------------------------

ROUTES = [
    {
        "name": "Texas A&M to Walmart on Texas Ave",
        "origin_address": "Texas A&M University, College Station, TX",
        "dest_address": "Walmart Supercenter, 1815 Texas Ave S, College Station, TX",
        "coords": [
            (30.6187, -96.3365), (30.6195, -96.3350), (30.6210, -96.3340),
            (30.6228, -96.3325), (30.6245, -96.3308), (30.6260, -96.3290),
            (30.6275, -96.3270), (30.6290, -96.3248), (30.6305, -96.3230),
            (30.6318, -96.3210), (30.6330, -96.3190), (30.6342, -96.3170),
            (30.6355, -96.3150), (30.6368, -96.3130), (30.6380, -96.3110),
            (30.6395, -96.3090), (30.6410, -96.3070), (30.6428, -96.3050),
            (30.6440, -96.3035), (30.6455, -96.3020), (30.6465, -96.3005),
        ],
        "distance_m": 4200,
        "duration_s": 720,
    },
    {
        "name": "Northgate to Post Oak Mall",
        "origin_address": "Northgate District, College Station, TX",
        "dest_address": "Post Oak Mall, 1500 Harvey Rd, College Station, TX",
        "coords": [
            (30.6215, -96.3410), (30.6225, -96.3395), (30.6238, -96.3378),
            (30.6250, -96.3360), (30.6260, -96.3340), (30.6268, -96.3320),
            (30.6275, -96.3298), (30.6280, -96.3275), (30.6288, -96.3250),
            (30.6295, -96.3225), (30.6300, -96.3200), (30.6308, -96.3180),
            (30.6315, -96.3155), (30.6320, -96.3130), (30.6325, -96.3105),
            (30.6330, -96.3080), (30.6332, -96.3060), (30.6330, -96.3040),
            (30.6325, -96.3020), (30.6315, -96.3000), (30.6305, -96.2980),
            (30.6295, -96.2960), (30.6285, -96.2945),
        ],
        "distance_m": 5800,
        "duration_s": 900,
    },
    {
        "name": "Kyle Field to Bryan Downtown",
        "origin_address": "Kyle Field, 756 Houston St, College Station, TX",
        "dest_address": "Downtown Bryan, Main St, Bryan, TX",
        "coords": [
            (30.6102, -96.3404), (30.6115, -96.3410), (30.6130, -96.3418),
            (30.6148, -96.3425), (30.6165, -96.3430), (30.6185, -96.3438),
            (30.6205, -96.3445), (30.6228, -96.3450), (30.6250, -96.3455),
            (30.6275, -96.3460), (30.6300, -96.3465), (30.6325, -96.3468),
            (30.6350, -96.3470), (30.6375, -96.3472), (30.6400, -96.3475),
            (30.6425, -96.3478), (30.6450, -96.3480), (30.6478, -96.3482),
            (30.6505, -96.3485), (30.6530, -96.3488), (30.6555, -96.3490),
            (30.6580, -96.3492), (30.6610, -96.3495), (30.6640, -96.3498),
            (30.6670, -96.3500), (30.6700, -96.3505), (30.6720, -96.3510),
        ],
        "distance_m": 8200,
        "duration_s": 1080,
    },
    {
        "name": "Wolf Pen Creek to TAMU Research Park",
        "origin_address": "Wolf Pen Creek Park, College Station, TX",
        "dest_address": "Texas A&M Research Park, College Station, TX",
        "coords": [
            (30.6310, -96.3160), (30.6298, -96.3175), (30.6285, -96.3190),
            (30.6270, -96.3208), (30.6258, -96.3228), (30.6245, -96.3248),
            (30.6230, -96.3265), (30.6215, -96.3280), (30.6198, -96.3295),
            (30.6180, -96.3310), (30.6165, -96.3325), (30.6148, -96.3342),
            (30.6130, -96.3358), (30.6112, -96.3375), (30.6095, -96.3390),
            (30.6078, -96.3408), (30.6060, -96.3425), (30.6045, -96.3440),
            (30.6028, -96.3455), (30.6010, -96.3470),
        ],
        "distance_m": 4800,
        "duration_s": 780,
    },
    {
        "name": "Blinn College Bryan to Century Square",
        "origin_address": "Blinn College, 2423 Blinn Blvd, Bryan, TX",
        "dest_address": "Century Square, 175 Century Square Dr, College Station, TX",
        "coords": [
            (30.6745, -96.3700), (30.6730, -96.3680), (30.6715, -96.3660),
            (30.6698, -96.3640), (30.6680, -96.3620), (30.6665, -96.3598),
            (30.6648, -96.3575), (30.6630, -96.3550), (30.6615, -96.3528),
            (30.6598, -96.3505), (30.6580, -96.3480), (30.6565, -96.3458),
            (30.6548, -96.3435), (30.6530, -96.3410), (30.6515, -96.3388),
            (30.6498, -96.3365), (30.6480, -96.3345), (30.6462, -96.3320),
            (30.6445, -96.3298), (30.6428, -96.3275), (30.6410, -96.3250),
        ],
        "distance_m": 7100,
        "duration_s": 1020,
    },
    {
        "name": "Traditions Apts to H-E-B on Harvey",
        "origin_address": "The Traditions Apartments, 3000 Tradition Dr, Bryan, TX",
        "dest_address": "H-E-B, 725 E Villa Maria Rd, Bryan, TX",
        "coords": [
            (30.5995, -96.3150), (30.6010, -96.3168), (30.6028, -96.3185),
            (30.6045, -96.3200), (30.6062, -96.3218), (30.6078, -96.3235),
            (30.6095, -96.3250), (30.6112, -96.3268), (30.6128, -96.3285),
            (30.6145, -96.3300), (30.6162, -96.3315), (30.6178, -96.3330),
            (30.6195, -96.3345), (30.6210, -96.3360), (30.6225, -96.3375),
            (30.6240, -96.3390), (30.6255, -96.3405), (30.6270, -96.3420),
        ],
        "distance_m": 4500,
        "duration_s": 660,
    },
    {
        "name": "Easterwood Airport to Northgate",
        "origin_address": "Easterwood Airport, College Station, TX",
        "dest_address": "Northgate District, College Station, TX",
        "coords": [
            (30.5885, -96.3638), (30.5900, -96.3625), (30.5918, -96.3610),
            (30.5935, -96.3595), (30.5952, -96.3578), (30.5970, -96.3560),
            (30.5988, -96.3542), (30.6005, -96.3525), (30.6022, -96.3508),
            (30.6040, -96.3490), (30.6058, -96.3472), (30.6075, -96.3455),
            (30.6092, -96.3438), (30.6110, -96.3420), (30.6128, -96.3405),
            (30.6145, -96.3390), (30.6162, -96.3378), (30.6178, -96.3368),
            (30.6195, -96.3358), (30.6210, -96.3350), (30.6218, -96.3410),
        ],
        "distance_m": 5500,
        "duration_s": 840,
    },
    {
        "name": "Veterans Park to Texas A&M Rec Center",
        "origin_address": "Veterans Park & Athletic Complex, College Station, TX",
        "dest_address": "Student Rec Center, Texas A&M, College Station, TX",
        "coords": [
            (30.6520, -96.2880), (30.6510, -96.2900), (30.6498, -96.2922),
            (30.6485, -96.2945), (30.6470, -96.2968), (30.6458, -96.2990),
            (30.6445, -96.3012), (30.6430, -96.3035), (30.6418, -96.3058),
            (30.6405, -96.3078), (30.6390, -96.3098), (30.6375, -96.3120),
            (30.6360, -96.3142), (30.6345, -96.3165), (30.6330, -96.3188),
            (30.6315, -96.3210), (30.6300, -96.3230), (30.6285, -96.3250),
            (30.6268, -96.3270), (30.6250, -96.3290), (30.6235, -96.3310),
            (30.6218, -96.3330), (30.6200, -96.3350), (30.6185, -96.3368),
        ],
        "distance_m": 6800,
        "duration_s": 960,
    },
    {
        "name": "Harvey Mitchell Pkwy loop",
        "origin_address": "2818 @ Holleman Dr, College Station, TX",
        "dest_address": "2818 @ Texas Ave, College Station, TX",
        "coords": [
            (30.6050, -96.3250), (30.6065, -96.3240), (30.6080, -96.3228),
            (30.6098, -96.3215), (30.6115, -96.3200), (30.6130, -96.3185),
            (30.6148, -96.3168), (30.6165, -96.3150), (30.6180, -96.3132),
            (30.6198, -96.3115), (30.6215, -96.3098), (30.6230, -96.3080),
            (30.6248, -96.3062), (30.6265, -96.3045), (30.6280, -96.3028),
            (30.6298, -96.3010), (30.6315, -96.2992), (30.6330, -96.2975),
        ],
        "distance_m": 4100,
        "duration_s": 600,
    },
    {
        "name": "Bryan High School to Cavalry Court Hotel",
        "origin_address": "Bryan High School, 3450 Campus Dr, Bryan, TX",
        "dest_address": "Cavalry Court Hotel, 200 Century Court, College Station, TX",
        "coords": [
            (30.6620, -96.3580), (30.6605, -96.3560), (30.6590, -96.3540),
            (30.6575, -96.3520), (30.6558, -96.3498), (30.6540, -96.3478),
            (30.6525, -96.3455), (30.6508, -96.3435), (30.6490, -96.3412),
            (30.6475, -96.3390), (30.6458, -96.3368), (30.6440, -96.3348),
            (30.6425, -96.3328), (30.6408, -96.3308), (30.6392, -96.3288),
            (30.6375, -96.3268), (30.6360, -96.3248), (30.6345, -96.3230),
        ],
        "distance_m": 5200,
        "duration_s": 780,
    },
    {
        "name": "Bee Creek Park to MSC",
        "origin_address": "Bee Creek Park, 1900 Anderson St, College Station, TX",
        "dest_address": "Memorial Student Center, Texas A&M, College Station, TX",
        "coords": [
            (30.6350, -96.3550), (30.6340, -96.3530), (30.6328, -96.3510),
            (30.6315, -96.3490), (30.6302, -96.3470), (30.6288, -96.3450),
            (30.6275, -96.3432), (30.6260, -96.3415), (30.6248, -96.3398),
            (30.6235, -96.3380), (30.6222, -96.3365), (30.6210, -96.3350),
            (30.6198, -96.3338), (30.6185, -96.3325),
        ],
        "distance_m": 3100,
        "duration_s": 480,
    },
    {
        "name": "The Barracks to Callaway House",
        "origin_address": "The Barracks, 401 Boyett St, College Station, TX",
        "dest_address": "Callaway House, 1700 George Bush Dr, College Station, TX",
        "coords": [
            (30.6208, -96.3420), (30.6200, -96.3408), (30.6190, -96.3395),
            (30.6178, -96.3382), (30.6165, -96.3370), (30.6152, -96.3358),
            (30.6140, -96.3348), (30.6128, -96.3340), (30.6115, -96.3335),
            (30.6102, -96.3332), (30.6088, -96.3330), (30.6075, -96.3328),
        ],
        "distance_m": 1800,
        "duration_s": 360,
    },
]


# ---------------------------------------------------------------------------
# Main seed logic
# ---------------------------------------------------------------------------

def get_existing_users():
    """Grab some real driver and passenger user IDs from user-management DB."""
    c = um_conn()
    cur = c.cursor()
    cur.execute("""
        SELECT u.id::text, ut.name
        FROM users u
        JOIN usertype ut ON ut.id = u.usertype_id
        WHERE ut.name IN ('driver', 'passenger')
        ORDER BY u.created_at
        LIMIT 100
    """)
    rows = cur.fetchall()
    cur.close()
    c.close()

    drivers = [r[0] for r in rows if r[1] == "driver"]
    passengers = [r[0] for r in rows if r[1] == "passenger"]
    return drivers, passengers


def seed():
    drivers, passengers = get_existing_users()
    if not drivers or not passengers:
        print("ERROR: No drivers or passengers found in user-management DB.")
        print("  Run the main seed.py first, or check render.env credentials.")
        return

    print(f"Found {len(drivers)} drivers, {len(passengers)} passengers")

    c = ka_conn()
    c.autocommit = False
    cur = c.cursor()

    now = datetime.now(timezone.utc)

    # Distribute routes across statuses
    status_plan = [
        # 4 active (IN_PROGRESS / PARTIALLY_FILLED)
        ("IN_PROGRESS", ROUTES[0]),
        ("IN_PROGRESS", ROUTES[1]),
        ("PARTIALLY_FILLED", ROUTES[2]),
        ("PARTIALLY_FILLED", ROUTES[3]),
        # 5 completed
        ("COMPLETED", ROUTES[4]),
        ("COMPLETED", ROUTES[5]),
        ("COMPLETED", ROUTES[6]),
        ("COMPLETED", ROUTES[7]),
        ("COMPLETED", ROUTES[8]),
        # 3 scheduled / open
        ("OPEN", ROUTES[9]),
        ("OPEN", ROUTES[10]),
        ("OPEN", ROUTES[11]),
    ]

    inserted_runs = []

    for status, route in status_plan:
        run_id = str(uuid.uuid4())
        driver_id = random.choice(drivers)
        coords = route["coords"]
        origin = coords[0]
        dest = coords[-1]
        polyline = encode_polyline(coords)

        seats_total = random.choice([2, 3, 4])
        if status == "OPEN":
            seats_left = seats_total
            created = now + timedelta(hours=random.randint(2, 48))
        elif status == "COMPLETED":
            seats_left = 0
            created = now - timedelta(hours=random.randint(1, 72))
        else:
            seats_left = max(0, seats_total - random.randint(1, 2))
            created = now - timedelta(minutes=random.randint(10, 120))

        updated = created + timedelta(minutes=random.randint(5, 60)) if status != "OPEN" else created

        cur.execute("""
            INSERT INTO driver_runs (
                id, driver_id,
                origin_point, dest_point,
                origin_address, dest_address,
                seats_total, seats_left,
                max_detour_minutes, status, notes,
                route_polyline, route_distance_meters, route_duration_seconds,
                created_at, updated_at, is_active
            ) VALUES (
                %s, %s,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s, %s, %s, %s, %s, %s, NULL,
                %s, %s, %s, %s, %s, true
            )
        """, (
            run_id, driver_id,
            origin[1], origin[0],  # lng, lat for PostGIS
            dest[1], dest[0],
            route["origin_address"], route["dest_address"],
            seats_total, seats_left, 15,
            status,
            polyline, route["distance_m"], route["duration_s"],
            created, updated,
        ))

        # Schedule
        sched_id = str(uuid.uuid4())
        sched_date = created.date() if hasattr(created, 'date') else date.today()
        cur.execute("""
            INSERT INTO driver_run_schedules (
                id, driver_run_id, date, start_time, end_time,
                is_completed, created_at, updated_at, is_active
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true)
        """, (
            sched_id, run_id, sched_date,
            dtime(hour=max(0, min(23, created.hour)), minute=0),
            dtime(hour=max(0, min(23, created.hour + 2)), minute=0),
            status == "COMPLETED",
            created, updated,
        ))

        # Create a ride and link it via ride_assignment
        ride_id = str(uuid.uuid4())
        rider_id = random.choice(passengers)
        pref_session_id = str(uuid.uuid4())
        pref_id = str(uuid.uuid4())

        # Pick ride status that matches the run status
        ride_status_map = {
            "OPEN": "REQUESTED",
            "IN_PROGRESS": "IN_PROGRESS",
            "PARTIALLY_FILLED": "ACCEPTED",
            "COMPLETED": "COMPLETED",
        }
        ride_status = ride_status_map[status]

        has_otp = ride_status in ("IN_PROGRESS", "COMPLETED")
        pickup_otp = f"{random.randint(1000, 9999)}" if has_otp else None
        otp_generated_at = created + timedelta(minutes=5) if has_otp else None

        # Rider pickup/drop slightly offset from route origin/dest
        pickup_lat = origin[0] + random.uniform(-0.003, 0.003)
        pickup_lng = origin[1] + random.uniform(-0.003, 0.003)
        drop_lat = dest[0] + random.uniform(-0.003, 0.003)
        drop_lng = dest[1] + random.uniform(-0.003, 0.003)

        cur.execute("""
            INSERT INTO rides (
                id, rider_id,
                pickup_point, drop_point,
                pickup_address, drop_address,
                seats_requested, status,
                payment_method_id, notes,
                preference_session_id, accepted_preference_id,
                pickup_otp, otp_generated_at, otp_attempts,
                created_at, updated_at, is_active
            ) VALUES (
                %s, %s,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s, %s, %s, %s, %s, NULL,
                %s, NULL,
                %s, %s, 0, %s, %s, true
            )
        """, (
            ride_id, rider_id,
            pickup_lng, pickup_lat,
            drop_lng, drop_lat,
            route["origin_address"], route["dest_address"],
            random.choice([1, 1, 2]),
            ride_status,
            f"pm_{uuid.uuid4().hex[:24]}",
            pref_session_id,
            pickup_otp, otp_generated_at,
            created, updated,
        ))

        # Ride preference
        cur.execute("""
            INSERT INTO ride_preferences (
                id, preference_session_id, passenger_id,
                driver_run_id, schedule_id,
                preference_order, is_primary,
                seats_needed, estimated_price, pickup_time, drop_time,
                payment_intent_id, status,
                selected_at, offered_at, responded_at,
                created_at, updated_at, is_active
            ) VALUES (
                %s, %s, %s, %s, %s,
                1, true,
                1, %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s, true
            )
        """, (
            pref_id, pref_session_id, rider_id,
            run_id, sched_id,
            round(random.uniform(8.0, 25.0), 2),
            created + timedelta(minutes=15),
            created + timedelta(minutes=45),
            f"pi_{uuid.uuid4().hex[:24]}" if ride_status != "REQUESTED" else None,
            "ACCEPTED" if ride_status not in ("REQUESTED",) else "PENDING",
            created,
            created + timedelta(seconds=30) if ride_status != "REQUESTED" else None,
            created + timedelta(seconds=90) if ride_status not in ("REQUESTED",) else None,
            created, updated,
        ))

        # Link accepted preference back to ride
        if ride_status != "REQUESTED":
            cur.execute(
                "UPDATE rides SET accepted_preference_id = %s WHERE id = %s",
                (pref_id, ride_id),
            )

        # Ride assignment (only for non-OPEN statuses)
        if ride_status != "REQUESTED":
            cur.execute("""
                INSERT INTO ride_assignments (
                    id, ride_id, driver_run_id, assigned_at,
                    pickup_fraction, drop_fraction,
                    schedule_id, accepted_preference_id,
                    created_at, updated_at, is_active
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true)
            """, (
                str(uuid.uuid4()), ride_id, run_id,
                created + timedelta(minutes=2),
                round(random.uniform(0.05, 0.2), 3),
                round(random.uniform(0.8, 0.98), 3),
                sched_id, pref_id,
                created, updated,
            ))

        # Location pings for active runs
        if status in ("IN_PROGRESS", "PARTIALLY_FILLED"):
            fraction = random.uniform(0.3, 0.7)
            idx = int(fraction * (len(coords) - 1))
            ping_coord = coords[idx]
            cur.execute("""
                INSERT INTO driver_location_pings (
                    driver_run_id, schedule_id, driver_id,
                    latitude, longitude, location_point,
                    accuracy_meters, heading, speed_mps,
                    route_fraction, distance_to_next_stop_m,
                    source, recorded_at
                ) VALUES (
                    %s, %s, %s,
                    %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                    %s, %s, %s,
                    %s, %s,
                    'SEED', %s
                )
            """, (
                run_id, sched_id, driver_id,
                ping_coord[0], ping_coord[1],
                ping_coord[1], ping_coord[0],
                random.uniform(5, 15),
                random.uniform(0, 360),
                random.uniform(5, 20),
                round(fraction, 3),
                random.uniform(200, 3000),
                now - timedelta(seconds=random.randint(10, 120)),
            ))

        inserted_runs.append({
            "run_id": run_id,
            "status": status,
            "name": route["name"],
            "ride_id": ride_id,
            "polyline_len": len(polyline),
        })
        print(f"  OK {status:18s} | {route['name']:45s} | polyline={len(polyline)} chars")

    c.commit()
    cur.close()
    c.close()

    print(f"\nDone — inserted {len(inserted_runs)} runs:")
    for cat in ("IN_PROGRESS", "PARTIALLY_FILLED", "COMPLETED", "OPEN"):
        count = sum(1 for r in inserted_runs if r["status"] == cat)
        print(f"  {cat}: {count}")


if __name__ == "__main__":
    seed()
