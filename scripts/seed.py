"""
Deterministic fake-data seed for the three Kamuit databases.

Run AFTER migrate.py has applied all schemas. Idempotent-ish: wipes rows
from tables it owns before inserting, so re-running gives the same state.

Cross-DB references:
- user-management-backend owns the canonical users table (UUID PKs).
- kamuit-backend.rides.rider_id, driver_runs.driver_id are STRINGS holding
  those user UUIDs (no FK — microservice split).
- payment-backend.*.user_id/driver_id/passenger_id same story.
- ride_preferences.payment_intent_id is a string holding stripe_pi_id, while
  payment_intents.preference_id is a string holding the preference UUID.
"""
from __future__ import annotations

import os
import random
import uuid
from datetime import datetime, timedelta, timezone, date, time as dtime
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from faker import Faker


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")


SEED = 42
random.seed(SEED)
fake = Faker()
Faker.seed(SEED)


# Austin, TX-ish
CITY_LAT, CITY_LNG = 30.2672, -97.7431
CITY_SPREAD = 0.15  # ~10 miles


def _resolve_creds(host_env: str) -> tuple[str, str]:
    """Derive per-DB credentials from the host env var prefix."""
    prefix_map = {
        "USER_MGMT_DB_HOST": "USER_MGMT",
        "KAMUIT_DB_HOST": "KAMUIT",
        "PAYMENT_DB_HOST": "PAYMENT",
    }
    prefix = prefix_map.get(host_env, "")
    user = (os.environ.get(f"{prefix}_DB_USER") if prefix else None) or os.environ.get("LOCAL_PG_USER", "kamuit_admin")
    password = (os.environ.get(f"{prefix}_DB_PASSWORD") if prefix else None) or os.environ.get("LOCAL_PG_PASSWORD", "local_dev_only")
    return user, password


def conn(host_env: str, port_env: str, name_env: str) -> psycopg2.extensions.connection:
    user, password = _resolve_creds(host_env)
    return psycopg2.connect(
        host=os.environ[host_env],
        port=int(os.environ[port_env]),
        dbname=os.environ[name_env],
        user=user,
        password=password,
    )


def rand_point() -> tuple[float, float]:
    return (
        CITY_LAT + (random.random() - 0.5) * CITY_SPREAD,
        CITY_LNG + (random.random() - 0.5) * CITY_SPREAD,
    )


def rand_recent_dt(days_back: int = 30) -> datetime:
    delta = timedelta(
        days=random.randint(0, days_back),
        hours=random.randint(0, 23),
        minutes=random.randint(0, 59),
    )
    return datetime.utcnow() - delta


def weighted_choice(choices: list[tuple[Any, float]]) -> Any:
    r = random.random()
    cum = 0.0
    for val, w in choices:
        cum += w
        if r < cum:
            return val
    return choices[-1][0]


# ========================================================================
# Phase 1 — users + driver_profiles + passenger_profiles + vehicles + verifs
# ========================================================================


def seed_user_management() -> dict[str, Any]:
    print("\n=== Seeding user-management-backend ===")
    c = conn("USER_MGMT_DB_HOST", "USER_MGMT_DB_PORT", "USER_MGMT_DB_NAME")
    c.autocommit = False
    cur = c.cursor()

    tables_to_clear = [
        "preferred_locations", "email_otps", "social_accounts",
        "vehicles", "driver_verifications",
        "driver_profiles", "passenger_profiles",
        "rides",
        "users",
    ]
    for t in tables_to_clear:
        try:
            cur.execute(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE")
        except psycopg2.errors.UndefinedTable:
            c.rollback()
            cur = c.cursor()
            continue

    cur.execute("SELECT id, name FROM usertype")
    usertype_map = {name: uid for uid, name in cur.fetchall()}
    if not usertype_map:
        usertype_map = {"admin": 1, "driver": 2, "passenger": 3}
        now = datetime.utcnow()
        for name, uid in usertype_map.items():
            cur.execute(
                "INSERT INTO usertype (id, name, created_at, updated_at, is_active) "
                "VALUES (%s, %s, %s, %s, true) ON CONFLICT (id) DO NOTHING",
                (uid, name, now, now),
            )

    admin_uid = uuid.uuid4()
    driver_uids: list[uuid.UUID] = [uuid.uuid4() for _ in range(40)]
    passenger_uids: list[uuid.UUID] = [uuid.uuid4() for _ in range(60)]

    now = datetime.utcnow()
    genders = ["male", "female", "other", "prefer_not_to_say"]
    auth_providers = ["email", "google", "apple"]

    def insert_user(uid: uuid.UUID, usertype_name: str, is_admin: bool = False) -> None:
        full_name = "Admin User" if is_admin else fake.name()
        email = ("admin@kamuit.local" if is_admin else fake.unique.email()).lower()
        phone = f"+1{random.randint(2000000000, 9999999999)}"
        created = now - timedelta(days=random.randint(1, 180))
        cur.execute(
            """
            INSERT INTO users (id, usertype_id, full_name, phone_number, email, is_active,
                               created_at, updated_at, gender, is_email_verified,
                               is_phone_verified, date_of_birth, password_hash, auth_provider)
            VALUES (%s, %s, %s, %s, %s, true, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                str(uid),
                usertype_map[usertype_name],
                full_name,
                phone,
                email,
                created,
                created,
                random.choice(genders),
                random.random() < 0.85,
                random.random() < 0.9,
                fake.date_of_birth(minimum_age=19, maximum_age=65),
                "$2b$12$abcdefghijklmnopqrstuvFAKEHASHFOR_LOCAL_DEV_ONLY_NOT_REAL",
                random.choice(auth_providers),
            ),
        )

    insert_user(admin_uid, "admin", is_admin=True)
    for uid in driver_uids:
        insert_user(uid, "driver")
    for uid in passenger_uids:
        insert_user(uid, "passenger")

    for uid in driver_uids:
        ver_status = weighted_choice([("approved", 0.7), ("pending", 0.2), ("rejected", 0.1)])
        cur.execute(
            """
            INSERT INTO driver_profiles (id, user_id, license_number, license_url,
                                          accepted_rides, completed_rides, denied_rides,
                                          verification_status, is_verified,
                                          experience_years, created_at, updated_at, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true)
            """,
            (
                str(uuid.uuid4()),
                str(uid),
                f"DL-{fake.unique.bothify('########')}",
                f"https://fake.kamuit.local/licenses/{uid}.jpg",
                random.randint(0, 40),
                random.randint(0, 30),
                random.randint(0, 15),
                ver_status,
                ver_status == "approved",
                random.randint(0, 20),
                now, now,
            ),
        )

    for uid in passenger_uids:
        cur.execute(
            "INSERT INTO passenger_profiles (id, user_id, created_at, updated_at, is_active) "
            "VALUES (%s, %s, %s, %s, true)",
            (str(uuid.uuid4()), str(uid), now, now),
        )

    cur.execute("SELECT id, user_id FROM driver_profiles")
    driver_profile_rows = cur.fetchall()
    driver_profile_by_user: dict[str, str] = {str(u): str(p) for p, u in driver_profile_rows}

    makes = ["Toyota", "Honda", "Ford", "Chevrolet", "Tesla", "Hyundai", "Nissan", "BMW"]
    models = {"Toyota": ["Camry", "Corolla", "RAV4"], "Honda": ["Civic", "Accord", "CR-V"],
              "Ford": ["F-150", "Escape", "Focus"], "Chevrolet": ["Malibu", "Equinox"],
              "Tesla": ["Model 3", "Model Y"], "Hyundai": ["Elantra", "Sonata"],
              "Nissan": ["Altima", "Rogue"], "BMW": ["3 Series", "5 Series"]}

    for uid in driver_uids:
        make = random.choice(makes)
        model = random.choice(models[make])
        dp_id = driver_profile_by_user[str(uid)]
        ver_status = weighted_choice([("approved", 0.65), ("pending", 0.25), ("rejected", 0.10)])
        cur.execute(
            """
            INSERT INTO vehicles (id, driver_id, vin, vin_valid, check_digit, checksum_ok,
                                   origin_country, manufacturer, vehicle_type, plate_number,
                                   plate_state, year, make, model, color, verification_status,
                                   vin_verified, history_verified, insurance_verified, doc_verified,
                                   specs_json, links_json, registration_doc_json, history_flags,
                                   insurance_summary, owner_permission_granted,
                                   created_at, updated_at, is_active)
            VALUES (%s, %s, %s, true, %s, true, %s, %s, 'sedan', %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, NULL, NULL, NULL, NULL, NULL, %s,
                    %s, %s, true)
            """,
            (
                str(uuid.uuid4()),
                dp_id,
                fake.unique.bothify("#################"),
                str(random.randint(0, 9)),
                "USA",
                make,
                fake.unique.bothify("???####").upper(),
                random.choice(["TX", "CA", "NY", "WA"]),
                random.randint(2015, 2024),
                make, model,
                random.choice(["Black", "White", "Silver", "Red", "Blue", "Gray"]),
                ver_status,
                ver_status == "approved",
                random.random() < 0.8,
                random.random() < 0.75,
                random.random() < 0.7,
                random.random() < 0.85,
                now, now,
            ),
        )

    for uid in driver_uids:
        is_verified = random.random() < 0.7
        verified_at = now - timedelta(days=random.randint(1, 60)) if is_verified else None
        cur.execute(
            """
            INSERT INTO driver_verifications (user_id, is_verified, stripe_session_id,
                                               verified_at, created_at, updated_at, last_error)
            VALUES (%s, %s, %s, %s, now(), now(), %s)
            """,
            (
                str(uid),
                is_verified,
                f"vs_{uuid.uuid4().hex[:24]}",
                verified_at,
                None if is_verified else random.choice(["document_unreadable", "face_mismatch", None]),
            ),
        )

    for uid in random.sample(driver_uids + passenger_uids, 20):
        cur.execute(
            """
            INSERT INTO social_accounts (id, user_id, provider, provider_user_id, email,
                                          created_at, updated_at, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, true)
            """,
            (
                str(uuid.uuid4()),
                str(uid),
                random.choice(["google", "apple"]),
                f"ext_{uuid.uuid4().hex[:20]}",
                fake.email(),
                now, now,
            ),
        )

    for _ in range(15):
        cur.execute(
            """
            INSERT INTO email_otps (id, email, otp_code, expires_at, attempts,
                                     max_attempts, is_used, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                str(uuid.uuid4()),
                fake.email(),
                f"{random.randint(100000, 999999)}",
                now + timedelta(minutes=random.randint(-30, 10)),
                random.randint(0, 3),
                5,
                random.random() < 0.7,
                now - timedelta(minutes=random.randint(5, 60)),
            ),
        )

    for uid in random.sample(passenger_uids, 15):
        lat, lng = rand_point()
        cur.execute(
            """
            INSERT INTO preferred_locations (id, user_id, label, address, lat, lng,
                                              created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                str(uuid.uuid4()),
                str(uid),
                random.choice(["home", "office", "custom", "custom", "custom"]),
                fake.address().replace("\n", ", "),
                lat, lng,
                now, now,
            ),
        )

    c.commit()
    print(f"  users: 1 admin + {len(driver_uids)} drivers + {len(passenger_uids)} passengers")
    cur.close()
    c.close()

    return {
        "admin_uid": str(admin_uid),
        "driver_uids": [str(u) for u in driver_uids],
        "passenger_uids": [str(u) for u in passenger_uids],
    }


# ========================================================================
# Phase 2 — kamuit-backend: driver_runs, schedules, rides, preferences, assignments
# ========================================================================


RIDE_STATUSES = [
    "REQUESTED", "OFFER_SENT", "ACCEPTED", "PICKUP_ARRIVING",
    "IN_PROGRESS", "COMPLETED", "CANCELLED",
]
RIDE_STATUS_WEIGHTS = [0.18, 0.06, 0.12, 0.05, 0.12, 0.35, 0.12]

DRIVER_RUN_STATUSES = ["OPEN", "IN_PROGRESS", "PARTIALLY_FILLED", "COMPLETED", "CANCELLED"]
DRIVER_RUN_STATUS_WEIGHTS = [0.25, 0.10, 0.15, 0.40, 0.10]


def seed_kamuit_backend(users: dict[str, Any]) -> dict[str, Any]:
    print("\n=== Seeding kamuit-backend ===")
    c = conn("KAMUIT_DB_HOST", "KAMUIT_DB_PORT", "KAMUIT_DB_NAME")
    c.autocommit = False
    cur = c.cursor()

    for t in [
        "driver_locations", "ride_assignments", "ride_preferences",
        "driver_run_schedules", "rides", "driver_runs",
        "route_legs", "merged_routes", "push_tokens",
    ]:
        try:
            cur.execute(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE")
        except psycopg2.errors.UndefinedTable:
            c.rollback()
            cur = c.cursor()

    now = datetime.utcnow()
    driver_uids: list[str] = users["driver_uids"]
    passenger_uids: list[str] = users["passenger_uids"]

    driver_run_ids: list[str] = []
    run_to_driver: dict[str, str] = {}
    run_statuses: dict[str, str] = {}
    run_schedules: dict[str, list[str]] = {}

    for _ in range(60):
        run_id = str(uuid.uuid4())
        driver_id = random.choice(driver_uids)
        olat, olng = rand_point()
        dlat, dlng = rand_point()
        seats_total = random.choice([1, 2, 3, 4])
        status = weighted_choice(list(zip(DRIVER_RUN_STATUSES, DRIVER_RUN_STATUS_WEIGHTS)))
        seats_left = seats_total if status == "OPEN" else max(0, seats_total - random.randint(1, seats_total))
        created = rand_recent_dt(30)

        cur.execute(
            """
            INSERT INTO driver_runs (
                id, driver_id,
                origin_point, dest_point,
                origin_address, dest_address,
                seats_total, seats_left,
                max_detour_minutes, status, notes,
                route_polyline, route_distance_meters, route_duration_seconds,
                created_at, updated_at, is_active
            )
            VALUES (
                %s, %s,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s, %s, %s, %s, %s, %s, %s,
                NULL, %s, %s, %s, %s, true
            )
            """,
            (
                run_id, driver_id,
                olng, olat, dlng, dlat,
                fake.street_address(), fake.street_address(),
                seats_total, seats_left, random.randint(5, 20),
                status, random.choice([None, "Please be on time", "Non-smoking car"]),
                random.randint(5000, 30000), random.randint(600, 3600),
                created, created,
            ),
        )
        driver_run_ids.append(run_id)
        run_to_driver[run_id] = driver_id
        run_statuses[run_id] = status

    for run_id in driver_run_ids:
        run_schedules[run_id] = []
        for _ in range(random.randint(1, 3)):
            sched_id = str(uuid.uuid4())
            d = date.today() + timedelta(days=random.randint(-10, 14))
            start_h = random.randint(5, 21)
            start = dtime(hour=start_h, minute=random.choice([0, 15, 30, 45]))
            end = dtime(hour=min(start_h + random.randint(1, 3), 23), minute=0)
            is_completed = run_statuses[run_id] in ("COMPLETED", "PARTIALLY_FILLED") and random.random() < 0.7
            cur.execute(
                """
                INSERT INTO driver_run_schedules (id, driver_run_id, date, start_time, end_time,
                                                   is_completed, created_at, updated_at, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, now(), now(), true)
                """,
                (sched_id, run_id, d, start, end, is_completed),
            )
            run_schedules[run_id].append(sched_id)

    ride_rows: list[dict[str, Any]] = []
    ride_preference_rows: list[dict[str, Any]] = []
    ride_assignment_rows: list[dict[str, Any]] = []

    for _ in range(150):
        ride_id = str(uuid.uuid4())
        rider_id = random.choice(passenger_uids)
        status = weighted_choice(list(zip(RIDE_STATUSES, RIDE_STATUS_WEIGHTS)))
        plat, plng = rand_point()
        dlat, dlng = rand_point()
        seats_requested = random.choice([1, 1, 1, 2, 2, 3])
        created = rand_recent_dt(30)
        preference_session_id = str(uuid.uuid4())

        has_otp = status in ("PICKUP_ARRIVING", "IN_PROGRESS", "COMPLETED")
        pickup_otp = f"{random.randint(1000, 9999)}" if has_otp else None
        otp_generated_at = created + timedelta(minutes=random.randint(5, 30)) if has_otp else None
        otp_attempts = random.randint(0, 2) if has_otp else 0

        cur.execute(
            """
            INSERT INTO rides (
                id, rider_id,
                pickup_point, drop_point,
                pickup_address, drop_address,
                seats_requested, status,
                payment_method_id, notes,
                preference_session_id, accepted_preference_id,
                pickup_otp, otp_generated_at, otp_attempts,
                created_at, updated_at, is_active
            )
            VALUES (
                %s, %s,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s, %s, %s, %s, %s, %s, %s, NULL,
                %s, %s, %s, %s, %s, true
            )
            """,
            (
                ride_id, rider_id,
                plng, plat, dlng, dlat,
                fake.street_address(), fake.street_address(),
                seats_requested, status,
                f"pm_{uuid.uuid4().hex[:24]}",
                None,
                preference_session_id,
                pickup_otp, otp_generated_at, otp_attempts,
                created, created,
            ),
        )
        ride_rows.append({
            "id": ride_id, "rider_id": rider_id, "status": status,
            "preference_session_id": preference_session_id, "seats_requested": seats_requested,
            "created": created,
        })

    for ride in ride_rows:
        n_prefs = random.randint(1, 4)
        candidate_runs = random.sample(driver_run_ids, min(n_prefs, len(driver_run_ids)))

        if ride["status"] == "REQUESTED":
            pref_status_for_primary = "PENDING"
        elif ride["status"] == "OFFER_SENT":
            pref_status_for_primary = "OFFERED"
        elif ride["status"] == "CANCELLED":
            pref_status_for_primary = random.choice(["CANCELLED", "EXPIRED", "DECLINED"])
        else:
            pref_status_for_primary = "ACCEPTED"

        primary_pref_id: str | None = None
        accepted_pref_id: str | None = None

        for order, run_id in enumerate(candidate_runs, start=1):
            pref_id = str(uuid.uuid4())
            is_primary = order == 1
            schedule_ids = run_schedules.get(run_id) or [str(uuid.uuid4())]
            schedule_id = random.choice(schedule_ids)
            selected_at = ride["created"] + timedelta(seconds=random.randint(0, 60))

            if is_primary:
                status_pref = pref_status_for_primary
            else:
                status_pref = random.choice(["PENDING", "DECLINED", "EXPIRED", "CANCELLED"])

            offered_at = (
                selected_at + timedelta(seconds=random.randint(10, 120))
                if status_pref in ("OFFERED", "ACCEPTED", "DECLINED", "EXPIRED")
                else None
            )
            responded_at = (
                offered_at + timedelta(seconds=random.randint(5, 600))
                if offered_at and status_pref in ("ACCEPTED", "DECLINED")
                else None
            )

            stripe_pi_id = None
            if status_pref in ("OFFERED", "ACCEPTED"):
                stripe_pi_id = f"pi_{uuid.uuid4().hex[:24]}"

            cur.execute(
                """
                INSERT INTO ride_preferences (
                    id, preference_session_id, passenger_id, driver_run_id, schedule_id,
                    preference_order, is_primary,
                    seats_needed, estimated_price, pickup_time, drop_time,
                    payment_intent_id, status,
                    selected_at, offered_at, responded_at,
                    created_at, updated_at, is_active
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, true)
                """,
                (
                    pref_id, ride["preference_session_id"], ride["rider_id"],
                    run_id, schedule_id, order, is_primary,
                    ride["seats_requested"],
                    round(random.uniform(6.0, 42.0), 2),
                    ride["created"] + timedelta(minutes=random.randint(15, 90)),
                    ride["created"] + timedelta(minutes=random.randint(30, 180)),
                    stripe_pi_id, status_pref,
                    selected_at, offered_at, responded_at,
                    ride["created"], ride["created"],
                ),
            )

            ride_preference_rows.append({
                "id": pref_id, "ride_id": ride["id"], "driver_run_id": run_id,
                "schedule_id": schedule_id, "status": status_pref,
                "stripe_pi_id": stripe_pi_id, "is_primary": is_primary,
                "estimated_price_cents": int(round(random.uniform(6.0, 42.0) * 100)),
                "passenger_id": ride["rider_id"],
            })

            if is_primary:
                primary_pref_id = pref_id
            if status_pref == "ACCEPTED":
                accepted_pref_id = pref_id

        if accepted_pref_id:
            cur.execute("UPDATE rides SET accepted_preference_id = %s WHERE id = %s",
                        (accepted_pref_id, ride["id"]))

            accepted_pref = next(p for p in ride_preference_rows if p["id"] == accepted_pref_id)
            cur.execute(
                """
                INSERT INTO ride_assignments (
                    id, ride_id, driver_run_id, assigned_at,
                    pickup_fraction, drop_fraction, schedule_id, accepted_preference_id,
                    created_at, updated_at, is_active
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true)
                """,
                (
                    str(uuid.uuid4()), ride["id"], accepted_pref["driver_run_id"],
                    ride["created"] + timedelta(minutes=random.randint(1, 20)),
                    round(random.uniform(0.0, 0.4), 3),
                    round(random.uniform(0.5, 1.0), 3),
                    accepted_pref["schedule_id"], accepted_pref_id,
                    ride["created"], ride["created"],
                ),
            )
            ride_assignment_rows.append({
                "ride_id": ride["id"],
                "driver_run_id": accepted_pref["driver_run_id"],
                "driver_id": run_to_driver.get(accepted_pref["driver_run_id"]),
                "status": ride["status"],
                "estimated_price_cents": accepted_pref["estimated_price_cents"],
                "ride_created": ride["created"],
            })

    # Push tokens for a subset of users
    all_user_ids = driver_uids + passenger_uids
    for uid in random.sample(all_user_ids, min(50, len(all_user_ids))):
        cur.execute(
            """
            INSERT INTO push_tokens (id, user_id, expo_push_token, platform,
                                      created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                str(uuid.uuid4()), uid,
                f"ExponentPushToken[{uuid.uuid4().hex[:22]}]",
                random.choice(["ios", "ios", "ios", "android"]),
                now - timedelta(days=random.randint(0, 90)),
                now - timedelta(days=random.randint(0, 30)),
            ),
        )

    # Ride alerts for some passengers
    for uid in random.sample(passenger_uids, min(15, len(passenger_uids))):
        lat, lng = rand_point()
        dlat, dlng = rand_point()
        try:
            cur.execute(
                """
                INSERT INTO ride_alerts (id, passenger_id, origin_lat, origin_lng,
                                          destination_lat, destination_lng,
                                          trip_date, is_notified, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()), uid,
                    lat, lng, dlat, dlng,
                    date.today() + timedelta(days=random.randint(0, 7)),
                    random.random() < 0.3,
                    now - timedelta(days=random.randint(0, 5)),
                ),
            )
        except psycopg2.errors.UndefinedTable:
            c.rollback()
            cur = c.cursor()
            break

    active_run_ids = [r for r in driver_run_ids if run_statuses[r] in ("IN_PROGRESS", "PARTIALLY_FILLED", "OPEN")]
    for run_id in active_run_ids:
        sched_ids = run_schedules.get(run_id, [])
        if not sched_ids:
            continue
        lat, lng = rand_point()
        try:
            cur.execute(
                """
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
                        now(), now(), true)
                """,
                (
                    str(uuid.uuid4()), run_id, sched_ids[0], run_to_driver[run_id],
                    lat, lng, lng, lat,
                    random.uniform(3, 25), random.uniform(0, 359), random.uniform(0, 30),
                    round(random.uniform(0, 1), 3), random.uniform(100, 5000),
                    random.randint(1, 3), random.randint(5, 30),
                ),
            )
        except psycopg2.errors.UndefinedTable:
            c.rollback()
            cur = c.cursor()
            break

    c.commit()
    print(f"  driver_runs: {len(driver_run_ids)}, rides: {len(ride_rows)}, "
          f"preferences: {len(ride_preference_rows)}, assignments: {len(ride_assignment_rows)}")
    cur.close()
    c.close()

    return {
        "driver_run_ids": driver_run_ids,
        "run_to_driver": run_to_driver,
        "preferences": ride_preference_rows,
        "assignments": ride_assignment_rows,
    }


# ========================================================================
# Phase 3 — payment-backend: payment_methods, intents, wallets, stripe_connect
# ========================================================================


def seed_payment_backend(users: dict[str, Any], rides: dict[str, Any]) -> None:
    print("\n=== Seeding payment-backend ===")
    c = conn("PAYMENT_DB_HOST", "PAYMENT_DB_PORT", "PAYMENT_DB_NAME")
    c.autocommit = False
    cur = c.cursor()

    for t in ["wallet_transactions", "wallet_balances", "stripe_connect",
              "payment_intents", "payment_methods"]:
        try:
            cur.execute(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE")
        except psycopg2.errors.UndefinedTable:
            c.rollback()
            cur = c.cursor()

    now = datetime.utcnow()
    driver_uids: list[str] = users["driver_uids"]
    passenger_uids: list[str] = users["passenger_uids"]

    brands = ["visa", "mastercard", "amex", "discover"]
    for pid in passenger_uids:
        for idx in range(random.randint(1, 2)):
            cur.execute(
                """
                INSERT INTO payment_methods (id, user_id, stripe_pm_id, brand, last4,
                                              exp_month, exp_year, is_default, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()), pid,
                    f"pm_{uuid.uuid4().hex[:24]}",
                    random.choice(brands),
                    f"{random.randint(1000, 9999)}",
                    random.randint(1, 12), random.randint(2026, 2030),
                    idx == 0,
                    now - timedelta(days=random.randint(1, 120)),
                ),
            )

    for pref in rides["preferences"]:
        if not pref["stripe_pi_id"]:
            continue

        pref_status = pref["status"]
        if pref_status == "ACCEPTED":
            pi_status = weighted_choice([("succeeded", 0.85), ("requires_capture", 0.10),
                                         ("failed", 0.05)])
        elif pref_status == "OFFERED":
            pi_status = "requires_capture"
        elif pref_status == "DECLINED":
            pi_status = "canceled"
        elif pref_status == "EXPIRED":
            pi_status = "canceled"
        else:
            pi_status = "requires_capture"

        cur.execute(
            """
            INSERT INTO payment_intents (id, stripe_pi_id, passenger_id, preference_id,
                                          amount_cents, currency, status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, 'usd', %s, %s, %s)
            """,
            (
                str(uuid.uuid4()),
                pref["stripe_pi_id"],
                pref["passenger_id"],
                pref["id"],
                pref["estimated_price_cents"],
                pi_status,
                now - timedelta(days=random.randint(0, 25)),
                now,
            ),
        )

    for did in driver_uids:
        earnings = random.randint(0, 80000)
        credits = random.randint(0, 5000)
        cur.execute(
            """
            INSERT INTO wallet_balances (driver_id, earnings_cents, credits_cents, currency, updated_at)
            VALUES (%s, %s, %s, 'usd', %s)
            """,
            (did, earnings, credits, now),
        )

    for a in rides["assignments"]:
        if a["status"] != "COMPLETED":
            continue
        driver_id = a["driver_id"]
        if not driver_id:
            continue

        amount = a["estimated_price_cents"]
        platform_fee = int(amount * 0.15)
        driver_earn = amount - platform_fee

        created = a["ride_created"] + timedelta(hours=random.randint(1, 24))
        cur.execute(
            """
            INSERT INTO wallet_transactions (id, driver_id, ledger, tx_type, amount_cents,
                                              balance_after_cents, source_type, source_id,
                                              description, origin_address, dest_address,
                                              rider_count, created_at)
            VALUES (%s, %s, 'earnings', 'credit', %s, NULL, 'ride', %s, %s, %s, %s, %s, %s)
            """,
            (
                str(uuid.uuid4()), driver_id, driver_earn,
                a["ride_id"],
                "Ride completed",
                fake.street_address(), fake.street_address(),
                random.randint(1, 3),
                created,
            ),
        )

    for did in driver_uids:
        onboarded = random.random() < 0.8
        cur.execute(
            """
            INSERT INTO stripe_connect (driver_id, stripe_account_id, is_us_resident,
                                         declared_at, payouts_enabled, details_submitted,
                                         account_status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                did,
                f"acct_{uuid.uuid4().hex[:16]}" if onboarded else None,
                True,
                now - timedelta(days=random.randint(1, 60)) if onboarded else None,
                onboarded and random.random() < 0.9,
                onboarded,
                "active" if onboarded else "pending",
                now - timedelta(days=random.randint(1, 60)),
                now,
            ),
        )

    c.commit()
    print("  payment_methods, payment_intents, wallet_balances, wallet_transactions, stripe_connect seeded.")
    cur.close()
    c.close()


def main() -> None:
    users = seed_user_management()
    rides = seed_kamuit_backend(users)
    seed_payment_backend(users, rides)
    print("\nSeed complete.")


if __name__ == "__main__":
    main()
