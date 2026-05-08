# Kamuit Admin Dashboard — Developer Handoff

This is everything you need to get the dashboard running on macOS.
Read this file first; ignore everything else until it's working.

---

## 1. What you should already have on disk

The four backend repos must sit as **siblings** of this folder:

```
<some-parent-dir>/
├── kamuit-backend/                ← clone of your kamuit-backend
├── user-management-backend/       ← clone of your user-management-backend
├── payment-backend/               ← clone of your payment-backend
└── kamuit-admin-dashboard/        ← THIS folder
```

If your layout is different, the alembic step in setup will fail with a
clear error from the preflight checker. Move folders until it matches.

> The dashboard does **not modify any file** in the four backend repos.
> It runs each repo's own `alembic upgrade head` against local Postgres
> containers and adds new tables/views/triggers in a separate
> `db-extensions/` directory that lives only in this repo.

---

## 2. One-time prerequisites

Install once on the dev machine:

| Tool | Minimum | macOS install |
|------|--------|---------------|
| Docker Desktop | 4.x (compose v2) | https://www.docker.com/products/docker-desktop |
| Python | 3.12+ | `brew install python@3.12` |
| Node.js | 20+ | `brew install node@20` |
| `lsof`, `curl`, `git` | any | already on macOS |

Make sure **Docker Desktop is running** (whale icon steady, not animating)
before you start.

---

## 3. Run it

If you got this as a zip, unzip it next to the four backend repos:

```bash
# from the parent dir that contains kamuit-backend/, payment-backend/, etc.
unzip -q ~/Downloads/kamuit-admin-dashboard-*.zip
cd kamuit-admin-dashboard
```

Then:

```bash
chmod +x scripts/*.sh
./scripts/bootstrap.sh
```

That single command runs:

1. **preflight** — verifies Docker daemon, Python/Node versions, sibling
   repos, and that ports `54321 / 54322 / 54323 / 8000 / 5173` are free.
2. **setup** — starts 3 Postgres containers, runs each backend's alembic,
   applies the additive DB extensions (event logs, GPS pings, geo cache,
   recon views), seeds deterministic fake data, installs API + web deps.
3. **doctor** — confirms every database has the rows it should.
4. **run** — launches the API on `:8000` and the web app on `:5173`.

First-run takes ~3–5 min (mostly `npm install` + `pip install`). Subsequent
runs of `./scripts/run.sh` start in under 5 seconds.

When you see:

```
──────────────────────────────────────────────────────
  Admin API:  http://127.0.0.1:8000
  Admin Web:  http://localhost:5173
  Login:      admin / admin
──────────────────────────────────────────────────────
```

…open **http://localhost:5173** in a browser and log in.

---

## 4. Login & ports

| What            | Where                 | Default            |
|-----------------|----------------------|--------------------|
| Web dashboard   | http://localhost:5173 | username `admin`, password `admin` |
| Admin API       | http://127.0.0.1:8000 | JWT auth on all endpoints |
| user-mgmt DB    | localhost:54321       | user `kamuit_admin` / pw `local_dev_only` / db `kamuit_user_management` |
| kamuit-backend DB | localhost:54322     | user `kamuit_admin` / pw `local_dev_only` / db `kamuit_backend` (PostGIS) |
| payment DB      | localhost:54323       | user `kamuit_admin` / pw `local_dev_only` / db `kamuit_payment` |

Change credentials by editing `.env` (created automatically from
`.env.example` on first run).

---

## 5. Common workflows

```bash
# Day-to-day: just start the servers
./scripts/run.sh

# Re-check the install is healthy without restarting
./scripts/doctor.sh

# Reset everything and start over (drops all DB data)
docker compose down -v
./scripts/bootstrap.sh

# Skip parts during a re-bootstrap
SKIP_DOCTOR=1   ./scripts/bootstrap.sh   # skip the post-install check
SKIP_SETUP=1    ./scripts/bootstrap.sh   # just preflight + run

# Rebuild only the additive DB extensions (no app data wiped)
.venv-bootstrap/bin/python scripts/apply_extensions.py --drop
.venv-bootstrap/bin/python scripts/apply_extensions.py
```

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Preflight: "docker daemon is NOT responding" | Docker Desktop not running | Open Docker Desktop, wait for whale icon to settle, retry. |
| Preflight: "kamuit-backend missing" | Sibling repo not cloned alongside this one | Clone it next to this folder; see the diagram in §1. |
| Preflight: "port 54322 is already in use" | Stale container or another Postgres running locally | `docker compose down` here, or kill the offending process: `lsof -nP -iTCP:54322 -sTCP:LISTEN`. |
| `setup.sh` hangs at "Running alembic migrations" | Backend repo on a branch whose migrations require env vars we don't pass | Check out the same branch the dashboard was tested against, or run `git status` inside the backend repo. |
| Doctor: `kamuit.driver_location_pings: 0` | Trigger didn't fire because `seed_trips.py` was skipped | `.venv-bootstrap/bin/python scripts/seed_trips.py && .venv-bootstrap/bin/python scripts/derive_sessions.py` |
| Web shows "Network error" on every page | API died or didn't start | Check the terminal where `run.sh` is running; restart with `./scripts/run.sh`. |
| `npm install` errors on Apple Silicon | Native module needs rebuild | `cd web && rm -rf node_modules package-lock.json && npm install` |
| 401 "Missing token" from a curl test | You forgot the `Authorization: Bearer …` header | Get a token from `/api/auth/login` first. |

---

## 7. What's where

| Path | What it is |
|---|---|
| `scripts/bootstrap.sh` | Single entrypoint (preflight → setup → doctor → run). |
| `scripts/preflight.sh` | Prereq checker. Standalone. |
| `scripts/setup.sh` | Starts DBs, runs migrations + extensions + seeds, installs deps. |
| `scripts/doctor.sh` | Post-install row-count + endpoint sanity check. |
| `scripts/run.sh` | Starts API + web dev servers. |
| `db-extensions/` | Additive SQL (event logs, GPS pings, geo cache, recon views). Triggered automatically; never modifies app schemas. |
| `api/` | FastAPI read-only aggregator across the 3 DBs. |
| `web/` | React + Vite + Tailwind + Leaflet frontend. |
| `README.md` | Architecture, design decisions, hard limits, dashboard pages. Read this **after** you've got it running. |

---

## 8. What this dashboard cannot show you (and why)

The constraint is **"do not modify the application repos."** That means a
few things will never appear here unless the backend code is changed to
write more telemetry to the DB:

- True search funnels (incl. searches that returned zero matches). The
  matching service computes everything in memory and persists nothing.
- Match-candidate snapshots, ranking, detour minutes per candidate.
- Cancellation reason codes / who cancelled.
- OTP entered values (only attempt counts and timestamps are logged).
- Ratings, reviews, safety incidents (no schema, no app UI).
- Per-ride pricing breakdowns at compute-time.

The `Pref Funnel` page surfaces a *proxy* derived from `ride_preferences`
and clearly labels itself as such. See `README.md` § "Hard limits you
CANNOT fix without touching the app" for the full list.
