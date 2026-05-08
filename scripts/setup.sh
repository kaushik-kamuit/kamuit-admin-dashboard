#!/usr/bin/env bash
# Kamuit Admin Dashboard - one-time bootstrap (macOS/Linux)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "==> Project root: $PROJECT_ROOT"

# Run the full preflight checker first — it validates Docker daemon,
# Python/Node versions, sibling repos, and free ports BEFORE we touch
# anything. Skip with SKIP_PREFLIGHT=1 if you really know what you're doing.
if [ "${SKIP_PREFLIGHT:-0}" != "1" ]; then
  bash "$SCRIPT_DIR/preflight.sh"
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example"
fi

echo
echo "==> Starting Postgres containers..."
docker compose up -d

echo
echo "==> Creating bootstrap venv (.venv-bootstrap)..."
python3 -m venv .venv-bootstrap
BOOT_PY="$PROJECT_ROOT/.venv-bootstrap/bin/python"

echo "==> Installing bootstrap requirements..."
"$BOOT_PY" -m pip install --upgrade pip --quiet
"$BOOT_PY" -m pip install -r scripts/bootstrap-requirements.txt --quiet

echo
echo "==> Running alembic migrations for each backend..."
"$BOOT_PY" scripts/migrate.py

echo
echo "==> Applying additive DB extensions (event logs, pings, geo cache, recon views)..."
"$BOOT_PY" scripts/apply_extensions.py

echo
echo "==> Seeding fake data..."
"$BOOT_PY" scripts/seed.py

echo
echo "==> Enriching with ping trails + status transitions..."
"$BOOT_PY" scripts/seed_trips.py

echo
echo "==> Deriving driver_online_sessions from pings..."
"$BOOT_PY" scripts/derive_sessions.py

echo
echo "==> Setting up admin-api venv..."
pushd api >/dev/null
python3 -m venv .venv
API_PY="$(pwd)/.venv/bin/python"
"$API_PY" -m pip install --upgrade pip --quiet
"$API_PY" -m pip install -r requirements.txt --quiet
popd >/dev/null

echo
echo "==> Installing web dependencies (npm install)..."
pushd web >/dev/null
npm install --silent
popd >/dev/null

echo
echo "Setup complete. Run the app with:  ./scripts/run.sh"
