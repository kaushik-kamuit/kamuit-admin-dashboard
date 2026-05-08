# Kamuit Admin Dashboard

> **Just trying to run this?** Read [`HANDOFF.md`](./HANDOFF.md) instead.
> One command (`./scripts/bootstrap.sh`) does everything.

Internal, **local-only**, read-only admin dashboard for the Kamuit commute app.
Aggregates data from the three backend Postgres databases (`user-management`,
`kamuit-backend`, `payment`) into a single web UI with filters, drill-downs,
and cross-service views.

> This folder is **independent**. It does not modify any of the existing repos
> (`kamuit-backend`, `user-management-backend`, `payment-backend`,
> `kamuit-mobile`). It reuses their Alembic migrations read-only to spin up
> local schemas.

---

## TL;DR — clone and run

Prerequisites (install once):

- **Docker Desktop** (running)
- **Python 3.12+** on PATH
- **Node.js 20+** on PATH
- The four Kamuit repos cloned as **siblings** to this one:

  ```
  Kamuit-2.0/
  ├── kamuit-backend/
  ├── kamuit-mobile/
  ├── payment-backend/
  ├── user-management-backend/
  └── kamuit-admin-dashboard/      <-- this repo
  ```

Then, from inside `kamuit-admin-dashboard/`:

### Windows (PowerShell)

```powershell
# First time: start DBs, run migrations from sibling backends, seed fake data,
# install API deps, install web deps.
.\scripts\setup.ps1

# Every time after: start API (:8000) and web (:5173) on the host.
.\scripts\run.ps1
```

### macOS / Linux

```bash
chmod +x scripts/*.sh
./scripts/setup.sh
./scripts/run.sh
```

Then open <http://localhost:5173>. Default admin login:

- Username: `admin`
- Password: `admin` (override in `.env`, see below)

---

## What's in this repo

| Path | Purpose |
|---|---|
| `docker-compose.yml` | 3 Postgres services (2 with PostGIS) on ports 54321/54322/54323. |
| `scripts/setup.*`    | One-time bootstrap: starts DBs, runs each sibling backend's `alembic upgrade head`, runs `seed.py`. |
| `scripts/run.*`      | Starts the admin API + web dev servers. |
| `scripts/migrate.py` | Python orchestrator that invokes alembic in each sibling backend repo with env vars pointing at the local DBs. |
| `scripts/seed.py`    | Deterministic fake-data generator that populates all 3 DBs with internally-consistent records (users ↔ driver_runs ↔ rides ↔ preferences ↔ payment_intents). |
| `scripts/apply_extensions.py` | Installs the additive DB extensions (event-log tables + triggers, geo cache, heatmap helpers, recon views) onto the 3 DBs. Idempotent; `--drop` removes them all. |
| `scripts/seed_trips.py` | Post-seed enrichment that generates ~40-point GPS trails per active run and a handful of status transitions to exercise the triggers. |
| `scripts/derive_sessions.py` | Rebuilds `driver_online_sessions` from `driver_location_pings` via gap analysis. |
| `db-extensions/`     | SQL files that install the additive objects. One subdir per target DB. No file in the backend repos is touched. |
| `api/`               | FastAPI read-only admin API. Uses `asyncpg` with separate connection pools per DB. JWT auth. |
| `web/`               | Vite + React + TypeScript + Tailwind + TanStack Query + Leaflet frontend. |

---

## Architecture notes

### Why this design

1. **Read-only API + separate DB pools.** The admin API owns no tables. It
   reads from the three existing Postgres DBs via three asyncpg pools. No ORM
   for analytic queries — raw SQL is clearer when joining across databases.
2. **Schema provisioning by running sibling alembic.** We do NOT copy or
   fork migration files. The bootstrap runs each backend's own
   `alembic upgrade head` against the local Postgres, with env vars pointing
   at the local container. This guarantees schema parity and picks up any
   future migrations automatically.
3. **Cross-DB joins live in the admin API, not in SQL.** User IDs are `String`
   on the kamuit-backend and payment-backend sides (no cross-DB FK). The API
   resolves user details via an in-memory map keyed by UUID string.
4. **Fake data is deterministic.** `seed.py` uses a fixed RNG seed. Every
   dev gets the same users, rides, and IDs.

### DB extensions (additive — no app code touched)

Installed by `scripts/apply_extensions.py` between `migrate.py` and
`seed.py`. Idempotent, trigger-driven. **The four underlying backend repos
are not modified.**

| Object (in `kamuit` DB) | Source of writes | What it solves |
|---|---|---|
| `ride_status_events`, `driver_run_status_events`, `preference_status_events`, `assignment_events` | AFTER INSERT/UPDATE triggers on the original tables | Full history of status transitions. Without this, each status column is overwritten and timings are lost. |
| `driver_location_pings` | AFTER INSERT/UPDATE trigger on `driver_locations` | The app upserts one-row-per-run. The trigger copies every upsert into an append-only table → full GPS breadcrumbs, trip replay, heatmaps. |
| `otp_attempt_events` | AFTER UPDATE trigger on `rides.otp_attempts / otp_generated_at` | Per-attempt log. Caveat: entered OTP value / correctness never leaves the app, so we only see timing & ride status at time of attempt. |
| `ride_geo_cache`, `driver_run_geo_cache`, `driver_location_pings.cell_*` | Triggers + generated cell keys at 500 m / 2 km / 10 km | Indexed grid keys; heatmap GROUP BYs run in milliseconds without PostGIS extras. |
| `driver_online_sessions` | `scripts/derive_sessions.py` (gap analysis on pings) | Driver availability windows, inferred from heartbeats. |
| `inferred_searches`, `preference_funnel_v2` (views) | View over `ride_preferences` | Best-effort search funnel. |
| `v_driver_settlement`, `v_payment_intent_daily` (views, payment DB) | View over `wallet_transactions`, `payment_intents` | Cross-driver reconciliation. |

Every SQL file is under `db-extensions/`. Roll back with:

```powershell
.\.venv-bootstrap\Scripts\python.exe scripts\apply_extensions.py --drop
```

### Hard limits you CANNOT fix without touching the app

The user explicitly forbade changes to the four application repos. These
gaps therefore remain and are clearly flagged in the UI where relevant:

| Gap | Why DB-only cannot fix it |
|---|---|
| **Search telemetry** (including searches that returned zero matches → unmet-demand heatmaps) | `CorridorMatchingService` computes everything in memory; no DB write to trigger from. The `inferred_searches` view is a proxy over preferences and is labeled as such. |
| **Match-candidate snapshots** (ranked candidates, detour minutes, rejected options) | Same — in-memory only. |
| **Cancellation reason codes & `cancelled_by`** | Known to the app, never written to DB. |
| **OTP entered value / correctness** | Discarded in app layer. |
| **Ratings / reviews / safety incidents** | No app UI or schema. |
| **Price-snapshot breakdown** (IRS rate, tier %, service fee at compute time) | Lives only in the pricing service at compute time. |
| **Push notification delivery / opens** | External to DB. |

### Other domain-model concerns (surfaced for the record)

- **Two `rides` tables.** `user-management-backend.rides` and
  `kamuit-backend.rides` have different schemas. Dashboard treats the
  kamuit one as authoritative.
- **Denormalized counters on `driver_profiles`** (`accepted_rides` etc.)
  drift. The dashboard always computes from `rides`.
- **No Stripe webhook event log** persisted. The reconciliation page shows
  a `wallet_transactions` vs `wallet_balances` delta so you can still spot
  drift.
- **Admin auth is a single shared password.** Local only; not
  production-grade.

---

## Port layout

| Service | Port | Inside container | Notes |
|---|---|---|---|
| `db-user-mgmt`   | 54321 | 5432 | PostGIS-enabled |
| `db-kamuit`      | 54322 | 5432 | PostGIS-enabled |
| `db-payment`     | 54323 | 5432 | Plain Postgres |
| `admin-api`      | 8000  | —    | FastAPI on host |
| `admin-web`      | 5173  | —    | Vite on host |

All DBs: user `kamuit_admin` / password `local_dev_only` / db matches the
Render database name.

---

## Reproducibility

- `seed.py` uses a fixed `random.seed(42)` and a frozen `Faker` seed.
- DB state is fully disposable: `docker compose down -v` resets everything,
  then re-run `.\scripts\setup.ps1`.
- The seed intentionally generates rides in every lifecycle state (pending,
  offered, accepted, in-progress, completed, cancelled) so every dashboard
  view has data to render.

---

## Resetting

```powershell
# Wipe DBs and re-seed
docker compose down -v
.\scripts\setup.ps1
```

---

## Security notes

- `.env` is gitignored. `.env.example` is committed.
- DB credentials in `.env` point at **local containers only**. Never put
  real Render credentials here.
- The admin API's JWT secret defaults to a placeholder; override in `.env`
  if you care, but again — this is local-only.

## Dashboard pages

- **Overview** — aggregate counts and recent activity.
- **Users / User detail** — user directory with preferred locations, social accounts.
- **Drivers / Driver detail** — verification, vehicles, wallet, Stripe Connect.
- **Rides / Ride detail** — full ride info + geography map + event timeline
  (ride + preference + OTP + assignment events on a single axis).
- **Driver Runs / Driver Run detail** — route origin/destination markers,
  blue polyline of the actual GPS trail (pings), pickup/drop waypoints
  along the route, status event history, per-assignment drill-down.
- **Heatmap** — ride pickups, ride dropoffs, driver-run origins and
  destinations, and driver GPS density. Selectable resolution (500 m /
  2 km / 10 km) and ride-status filter.
- **Online Sessions** — heartbeat-derived driver availability windows.
- **Pref Funnel** — proxy funnel over `ride_preferences` with explicit
  "this is a proxy" warning.
- **Matching** — cross-DB listing of which driver_runs got which rides.
- **Payments** — payment intents listing.
- **Reconciliation** — per-driver settlement rollup with ledger-delta
  highlights.

## Scope limitations (deliberately out of scope)

- Admin write actions (suspend user, refund, force-cancel ride). Those
  must go through the existing backend APIs with admin JWT — not added.
- Real-time updates. Dashboard is pull-based via TanStack Query refetch.
- True "unmet demand" heatmap (requires app-side search logging).
- Ratings, reviews, safety event views (no data source exists yet).
