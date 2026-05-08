#!/usr/bin/env bash
# Single-command developer entrypoint.
#
#   ./scripts/bootstrap.sh
#
# Runs:
#   1. preflight  — fail fast on missing prereqs / busy ports / missing repos
#   2. setup      — start DBs, run sibling alembic, apply additive extensions,
#                   seed fake data, install API + web deps
#   3. doctor     — verify the data layer is populated end-to-end
#   4. run        — start the API on :8000 and the web dev server on :5173
#
# The first three steps are skippable individually (SKIP_PREFLIGHT=1,
# SKIP_SETUP=1, SKIP_DOCTOR=1) so re-runs after a fresh `docker compose
# down -v` don't have to start from zero every time.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

bold() { printf "\n\033[1;36m%s\033[0m\n" "$*"; }

bold "[1/4] Preflight"
if [ "${SKIP_PREFLIGHT:-0}" = "1" ]; then
  echo "  (skipped via SKIP_PREFLIGHT=1)"
else
  bash "$SCRIPT_DIR/preflight.sh"
fi

bold "[2/4] Setup (idempotent — safe to re-run)"
if [ "${SKIP_SETUP:-0}" = "1" ]; then
  echo "  (skipped via SKIP_SETUP=1)"
else
  # setup.sh already invokes preflight internally; suppress the duplicate.
  SKIP_PREFLIGHT=1 bash "$SCRIPT_DIR/setup.sh"
fi

bold "[3/4] Doctor (data-layer sanity)"
if [ "${SKIP_DOCTOR:-0}" = "1" ]; then
  echo "  (skipped via SKIP_DOCTOR=1)"
else
  bash "$SCRIPT_DIR/doctor.sh"
fi

bold "[4/4] Starting servers"
echo "  Press Ctrl+C to stop both."
echo
exec bash "$SCRIPT_DIR/run.sh"
