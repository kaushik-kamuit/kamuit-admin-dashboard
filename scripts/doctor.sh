#!/usr/bin/env bash
# Post-install sanity check. Verifies that the three Postgres containers
# are healthy, that every database has the rows we expect (both core
# seeded data AND the additive extension tables), and — if the API is
# already running — that every read-only endpoint returns 200.
#
# Run on its own:   ./scripts/doctor.sh
# Called by:        scripts/bootstrap.sh after setup, before run.
#
# Exits 0 if every check passes, non-zero otherwise.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n"  "$*"; }

errors=0
fail() { red   "  ✗ $*"; errors=$((errors + 1)); }
ok()   { green "  ✓ $*"; }
warn() { yellow "  ! $*"; }

bold "==> Doctor: Docker containers"
running=$(docker compose ps --services --filter status=running 2>/dev/null | wc -l | tr -d ' ')
if [ "$running" -ge 3 ]; then
    ok "all 3 db containers are running"
else
    fail "expected 3 running containers, found $running. Run 'docker compose up -d'."
fi

# ---------------------------------------------------------------------------
# Database row-count probes.
# ---------------------------------------------------------------------------
BOOT_PY="$PROJECT_ROOT/.venv-bootstrap/bin/python"
if [ ! -x "$BOOT_PY" ]; then
    fail "bootstrap venv missing at $BOOT_PY. Run ./scripts/setup.sh."
    exit "$errors"
fi

bold "==> Doctor: database row counts"
# Disable -e here: if the embedded python exits non-zero we want to
# capture that into db_rc and continue with the API checks rather than
# aborting the whole doctor run.
set +e
"$BOOT_PY" - <<'PY'
import asyncio, os, sys
from pathlib import Path
import asyncpg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env" if "__file__" in dir() else Path.cwd() / ".env")

def _dsn(prefix):
    host = os.environ.get(f"{prefix}_DB_HOST", "localhost")
    port = os.environ.get(f"{prefix}_DB_PORT", "5432")
    name = os.environ.get(f"{prefix}_DB_NAME", "")
    user = os.environ.get(f"{prefix}_DB_USER") or os.environ.get("LOCAL_PG_USER", "kamuit_admin")
    pw   = os.environ.get(f"{prefix}_DB_PASSWORD") or os.environ.get("LOCAL_PG_PASSWORD", "local_dev_only")
    return f"postgresql://{user}:{pw}@{host}:{port}/{name}"

um = _dsn("USER_MGMT")
ka = _dsn("KAMUIT")
pa = _dsn("PAYMENT")

checks = [
    ("user-mgmt.users",                        um, "SELECT count(*) FROM users",                  10),
    ("kamuit.driver_runs",                      ka, "SELECT count(*) FROM driver_runs",            5),
    ("kamuit.rides",                            ka, "SELECT count(*) FROM rides",                  5),
    ("kamuit.ride_status_events  (extension)",  ka, "SELECT count(*) FROM ride_status_events",     5),
    ("kamuit.driver_location_pings (extension)",ka, "SELECT count(*) FROM driver_location_pings",  20),
    ("kamuit.driver_online_sessions (extension)",ka,"SELECT count(*) FROM driver_online_sessions", 1),
    ("kamuit.ride_geo_cache (extension)",       ka, "SELECT count(*) FROM ride_geo_cache",         1),
    ("payment.wallet_transactions",            pa, "SELECT count(*) FROM wallet_transactions",     1),
    ("payment.v_driver_settlement (extension)",pa, "SELECT count(*) FROM v_driver_settlement",     1),
]

GREEN = "\033[32m"; RED = "\033[31m"; END = "\033[0m"
errors = 0

async def main():
    global errors
    for label, dsn, sql, mn in checks:
        try:
            c = await asyncpg.connect(dsn)
            n = await c.fetchval(sql)
            await c.close()
        except Exception as e:
            print(f"  {RED}✗ {label}: {e}{END}")
            errors += 1
            continue
        if n is None or n < mn:
            print(f"  {RED}✗ {label}: {n} (expected >= {mn}){END}")
            errors += 1
        else:
            print(f"  {GREEN}✓ {label}: {n}{END}")

asyncio.run(main())
sys.exit(1 if errors else 0)
PY
db_rc=$?
set -e
if [ "$db_rc" -ne 0 ]; then
    errors=$((errors + 1))
fi

# ---------------------------------------------------------------------------
# API endpoint probes (only if API is up).
# ---------------------------------------------------------------------------
bold "==> Doctor: API endpoints (only checked if API is running)"
if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    ok "/api/health responding"

    token=$(curl -fsS -X POST http://127.0.0.1:8000/api/auth/login \
              -H 'Content-Type: application/json' \
              -d '{"username":"admin","password":"admin"}' \
            | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])' \
            2>/dev/null) || true

    if [ -z "${token:-}" ]; then
        fail "could not get a JWT from /api/auth/login. Check ADMIN_USERNAME/ADMIN_PASSWORD in .env."
    else
        ok "JWT login OK"
        endpoints=(
            "/api/overview"
            "/api/users?limit=1"
            "/api/drivers?limit=1"
            "/api/rides?limit=1"
            "/api/driver-runs?limit=1"
            "/api/analytics/heatmap/rides?kind=pickup&resolution=2km"
            "/api/analytics/heatmap/pings?resolution=2km"
            "/api/analytics/sessions/drivers"
            "/api/analytics/funnel/preferences"
            "/api/analytics/recon/drivers"
        )
        for ep in "${endpoints[@]}"; do
            # `|| true` is required: under `set -e`, a curl that fails to
            # even connect would abort the loop and skip subsequent
            # endpoints. We want every endpoint reported.
            code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $token" "http://127.0.0.1:8000$ep" || echo "000")
            if [ "$code" = "200" ]; then
                ok "$ep -> 200"
            else
                fail "$ep -> HTTP $code"
            fi
        done
    fi
else
    warn "API not reachable on http://127.0.0.1:8000 — skipping endpoint probes."
    warn "Start it with: ./scripts/run.sh"
fi

echo
if [ "$errors" -gt 0 ]; then
    red "Doctor FAILED with $errors check(s) failing."
    exit 1
fi
green "Doctor OK — dashboard is in a good state."
