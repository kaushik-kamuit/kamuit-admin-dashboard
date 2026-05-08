#requires -Version 5.1
# Kamuit Admin Dashboard - one-time bootstrap (Windows / PowerShell)
# - Starts the 3 local Postgres containers
# - Creates .venv-bootstrap and installs backend deps needed to run alembic
# - Runs each sibling backend's alembic migrations against the local DBs
# - Seeds fake data across all 3 DBs
# - Installs admin-api venv and web node_modules

$ErrorActionPreference = "Stop"
# NOTE: we deliberately do NOT enable $PSNativeCommandUseErrorActionPreference,
# because `docker compose` writes its normal progress output to stderr,
# which would otherwise terminate the script even on success. We check the
# actual container state with `docker compose ps` instead.

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "==> Project root: $ProjectRoot" -ForegroundColor Cyan

if (-not (Test-Path ".\.env")) {
    Copy-Item .env.example .env
    Write-Host "==> Created .env from .env.example" -ForegroundColor Yellow
}

Write-Host "`n==> Checking prerequisites..." -ForegroundColor Cyan
foreach ($cmd in @("docker", "python", "node", "npm")) {
    $exe = Get-Command $cmd -ErrorAction SilentlyContinue
    if (-not $exe) { throw "Missing prerequisite on PATH: $cmd" }
    Write-Host ("  {0} -> {1}" -f $cmd, $exe.Source)
}

Write-Host "`n==> Starting Postgres containers..." -ForegroundColor Cyan
# docker compose writes its normal progress output to stderr, which under
# $ErrorActionPreference=Stop would kill the script. Wrap the call so stderr
# is forwarded to stdout, then inspect the container state explicitly.
& cmd /c "docker compose up -d 2>&1"
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed with exit code $LASTEXITCODE"
}
Start-Sleep -Seconds 3
$running = (& cmd /c "docker compose ps --services --filter status=running 2>nul")
if (-not $running -or ($running -split "`n" | Where-Object { $_ -ne "" }).Count -lt 3) {
    throw "docker compose did not bring up all 3 DB containers. Check 'docker compose logs'."
}

Write-Host "`n==> Creating bootstrap venv (.venv-bootstrap)..." -ForegroundColor Cyan
if (-not (Test-Path ".\.venv-bootstrap")) {
    python -m venv .venv-bootstrap
}
$bootstrapPy = Join-Path $ProjectRoot ".venv-bootstrap\Scripts\python.exe"

Write-Host "==> Installing bootstrap requirements..." -ForegroundColor Cyan
& $bootstrapPy -m pip install --upgrade pip --quiet
& $bootstrapPy -m pip install -r scripts\bootstrap-requirements.txt --quiet

Write-Host "`n==> Running alembic migrations for each backend..." -ForegroundColor Cyan
& $bootstrapPy scripts\migrate.py

Write-Host "`n==> Applying additive DB extensions (event logs, pings, geo cache, recon views)..." -ForegroundColor Cyan
& $bootstrapPy scripts\apply_extensions.py

Write-Host "`n==> Seeding fake data..." -ForegroundColor Cyan
& $bootstrapPy scripts\seed.py

Write-Host "`n==> Enriching with ping trails + status transitions..." -ForegroundColor Cyan
& $bootstrapPy scripts\seed_trips.py

Write-Host "`n==> Deriving driver_online_sessions from pings..." -ForegroundColor Cyan
& $bootstrapPy scripts\derive_sessions.py

Write-Host "`n==> Setting up admin-api venv..." -ForegroundColor Cyan
Push-Location api
if (-not (Test-Path ".\.venv")) { python -m venv .venv }
$apiPy = Join-Path (Get-Location) ".venv\Scripts\python.exe"
& $apiPy -m pip install --upgrade pip --quiet
& $apiPy -m pip install -r requirements.txt --quiet
Pop-Location

Write-Host "`n==> Installing web dependencies (npm install)..." -ForegroundColor Cyan
Push-Location web
npm install --silent
Pop-Location

Write-Host "`nSetup complete. Run the app with:  .\scripts\run.ps1" -ForegroundColor Green
