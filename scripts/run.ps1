#requires -Version 5.1
# Starts admin-api (uvicorn) and admin-web (vite) concurrently.
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "==> Ensuring Postgres containers are up..." -ForegroundColor Cyan
docker compose up -d | Out-Null

$ApiPy = Join-Path $ProjectRoot "api\.venv\Scripts\python.exe"
if (-not (Test-Path $ApiPy)) { throw "admin-api venv missing. Run .\scripts\setup.ps1 first." }
if (-not (Test-Path "web\node_modules")) { throw "web deps missing. Run .\scripts\setup.ps1 first." }

$env:PYTHONUNBUFFERED = "1"

$apiJob = Start-Job -Name "kamuit-admin-api" -ScriptBlock {
    param($root, $py)
    Set-Location (Join-Path $root "api")
    & $py -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
} -ArgumentList $ProjectRoot, $ApiPy

$webJob = Start-Job -Name "kamuit-admin-web" -ScriptBlock {
    param($root)
    Set-Location (Join-Path $root "web")
    npm run dev
} -ArgumentList $ProjectRoot

Write-Host "`nAdmin API:  http://127.0.0.1:8000"
Write-Host "Admin Web:  http://localhost:5173"
Write-Host "Default login: admin / admin`n"
Write-Host "Tailing logs. Press Ctrl+C to stop both." -ForegroundColor Yellow

try {
    while ($true) {
        # Both uvicorn and vite write progress/info to their stderr streams.
        # Receiving a job surfaces those as terminating errors under
        # $ErrorActionPreference=Stop, so we swallow them manually.
        try {
            Receive-Job -Job $apiJob, $webJob -ErrorAction Continue 2>&1 |
                ForEach-Object { Write-Host $_ }
        } catch {
            Write-Host $_ -ForegroundColor DarkGray
        }
        Start-Sleep -Milliseconds 500
        if ($apiJob.State -eq "Failed" -or $webJob.State -eq "Failed") {
            Write-Host "A job failed." -ForegroundColor Red
            break
        }
        if ($apiJob.State -eq "Completed" -and $webJob.State -eq "Completed") {
            break
        }
    }
}
finally {
    Write-Host "`nStopping jobs..." -ForegroundColor Yellow
    Stop-Job -Job $apiJob, $webJob -ErrorAction SilentlyContinue
    Remove-Job -Job $apiJob, $webJob -Force -ErrorAction SilentlyContinue
}
