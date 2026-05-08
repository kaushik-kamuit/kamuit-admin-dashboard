#!/usr/bin/env bash
# Starts admin-api (uvicorn) on :8000 and admin-web (vite) on :5173,
# and tears them both down cleanly on Ctrl+C / SIGTERM.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "==> Ensuring Postgres containers are up..."
docker compose up -d >/dev/null

API_PY="$PROJECT_ROOT/api/.venv/bin/python"
[ -x "$API_PY" ]                          || { echo "admin-api venv missing. Run ./scripts/setup.sh first."; exit 1; }
[ -d "$PROJECT_ROOT/web/node_modules" ]   || { echo "web deps missing. Run ./scripts/setup.sh first.";       exit 1; }

# Track child PIDs and ensure they die when this script exits, even on
# unclean exits — otherwise stale uvicorn/vite processes will squat on
# the ports and the next run will fail mysteriously.
API_PID=""
WEB_PID=""
cleanup() {
    echo
    echo "==> Stopping servers..."
    [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
    [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd api && "$API_PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) &
API_PID=$!

(cd web && npm run dev) &
WEB_PID=$!

cat <<EOF

──────────────────────────────────────────────────────
  Admin API:  http://127.0.0.1:8000
  Admin Web:  http://localhost:5173
  Login:      admin / admin   (override in .env)
──────────────────────────────────────────────────────
  Press Ctrl+C to stop both servers.
EOF

wait
