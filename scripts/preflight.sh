#!/usr/bin/env bash
# Preflight checker — verifies every prerequisite is in place BEFORE we
# touch Docker, the venvs, or the backend repos. Designed to fail fast
# with a clear, actionable error message instead of cryptic mid-script
# crashes ten minutes later.
#
# Run on its own:   ./scripts/preflight.sh
# Called by:        scripts/setup.sh, scripts/bootstrap.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WORKSPACE_ROOT="$(dirname "$PROJECT_ROOT")"
cd "$PROJECT_ROOT"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n"  "$*"; }

errors=0
fail() { red   "  ✗ $*"; errors=$((errors + 1)); }
ok()   { green "  ✓ $*"; }
warn() { yellow "  ! $*"; }

bold "==> Preflight: required commands"
for cmd in docker python3 node npm git; do
    if command -v "$cmd" >/dev/null 2>&1; then
        ok "$cmd  ($(command -v "$cmd"))"
    else
        fail "$cmd not found on PATH"
    fi
done

bold "==> Preflight: Docker daemon reachable"
if docker info >/dev/null 2>&1; then
    ok "docker daemon is responding"
else
    fail "docker daemon is NOT responding. Open Docker Desktop and wait for the whale to be steady, then re-run."
fi

bold "==> Preflight: docker compose v2"
if docker compose version >/dev/null 2>&1; then
    ok "$(docker compose version | head -n1)"
else
    fail "'docker compose' (v2) not available. You may have the legacy 'docker-compose' instead. Install Docker Desktop ≥ 4.x."
fi

bold "==> Preflight: Python 3.12+"
if command -v python3 >/dev/null 2>&1; then
    py_ver=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
    py_major=$(python3 -c 'import sys; print(sys.version_info[0])')
    py_minor=$(python3 -c 'import sys; print(sys.version_info[1])')
    if [ "$py_major" -ge 3 ] && [ "$py_minor" -ge 12 ]; then
        ok "python3 $py_ver"
    else
        fail "python3 $py_ver detected. Need 3.12+. Install via 'brew install python@3.12' or pyenv."
    fi
fi

bold "==> Preflight: Node 20+"
if command -v node >/dev/null 2>&1; then
    node_major=$(node -p 'process.versions.node.split(".")[0]')
    if [ "$node_major" -ge 20 ]; then
        ok "node $(node -v)"
    else
        fail "node $(node -v) detected. Need 20+. Install via 'brew install node@20' or nvm."
    fi
fi

bold "==> Preflight: sibling backend repos"
# These are the four upstream repos. The setup runs each one's own
# `alembic upgrade head` against the local Postgres containers, so they
# must be cloned on disk. We deliberately do NOT modify their files.
for repo in user-management-backend kamuit-backend payment-backend; do
    repo_path="$WORKSPACE_ROOT/$repo"
    if [ -d "$repo_path" ] && [ -f "$repo_path/alembic.ini" ]; then
        ok "$repo  ($repo_path)"
    elif [ -d "$repo_path" ]; then
        fail "$repo found at $repo_path but has no alembic.ini — wrong directory?"
    else
        fail "$repo missing. Expected at $repo_path"
    fi
done

bold "==> Preflight: ports are free"
# These are the ports the dashboard binds. If something is squatting on
# them we'll fail mysteriously inside docker / uvicorn / vite, so check now.
for port in 54321 54322 54323 8000 5173; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        owner=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN | awk 'NR==2 {print $1, "(pid", $2 ")"}')
        warn "port $port is already in use by $owner — will collide with the dashboard"
    else
        ok "port $port free"
    fi
done

bold "==> Preflight: .env"
if [ -f .env ]; then
    ok ".env present"
else
    if [ -f .env.example ]; then
        warn ".env not found — setup.sh will copy .env.example → .env on first run"
    else
        fail "neither .env nor .env.example found. Repo is incomplete."
    fi
fi

echo
if [ "$errors" -gt 0 ]; then
    red "Preflight FAILED with $errors blocker(s). Fix the items above and re-run."
    exit 1
fi
green "Preflight OK."
