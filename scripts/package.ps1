#requires -Version 5.1
# Packages the dashboard into a clean zip for handoff.
#
# Excludes:
#   - .venv-bootstrap/        (Windows-built Python venv; useless on macOS)
#   - api/.venv/              (same)
#   - web/node_modules/       (~400MB, must be installed on target OS anyway)
#   - .env                    (may contain secrets you didn't mean to send)
#   - any pg-data-* dirs      (mounted Postgres data; large + unnecessary)
#   - __pycache__, *.pyc, .DS_Store, etc.
#
# Output:  kamuit-admin-dashboard-YYYYMMDD-HHmm.zip in the parent directory.

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$stamp   = Get-Date -Format "yyyyMMdd-HHmm"
$outName = "kamuit-admin-dashboard-$stamp.zip"
$outPath = Join-Path (Split-Path -Parent $ProjectRoot) $outName

if (Test-Path $outPath) {
    Remove-Item $outPath -Force
}

Write-Host "==> Building handoff archive..."
Write-Host "    source: $ProjectRoot"
Write-Host "    output: $outPath"

$exclude = @(
    "*\.venv-bootstrap\*",
    "*\.venv\*",
    "*\node_modules\*",
    "*\__pycache__\*",
    "*\dist\*",
    "*\.vite\*",
    "*\pg-data-*\*",
    "*\.DS_Store",
    "*\.idea\*",
    "*\.vscode\*",
    "*\.git\*",
    "*\*.log",
    "*\.env",
    "*\.env.local"
)

# Walk the tree and exclude paths matching any pattern. We use
# Get-ChildItem + Where-Object instead of Compress-Archive's native
# globs because Compress-Archive's -Path doesn't support exclusions.
$files = Get-ChildItem -Path $ProjectRoot -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($ProjectRoot.Length).TrimStart('\','/')
    $skip = $false
    foreach ($pat in $exclude) {
        $bare = $pat.TrimStart('*\').TrimEnd('\*')
        if ($rel -like $pat -or $rel -like "$bare\*" -or $rel -eq $bare) {
            $skip = $true; break
        }
    }
    -not $skip
}

Write-Host "    files:  $($files.Count)"

# PowerShell 5.1's Compress-Archive writes backslash separators inside
# the zip, which BSD `unzip` on macOS treats as a literal character in
# the file name (so you get one giant flat file instead of a tree).
# Build the zip manually via System.IO.Compression and force '/' as the
# entry name separator. This produces a Mac/Linux-friendly archive.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipStream = [System.IO.File]::Open($outPath, [System.IO.FileMode]::CreateNew)
try {
    $zip = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($f in $files) {
            $rel = $f.FullName.Substring($ProjectRoot.Length).TrimStart('\','/').Replace('\','/')
            $entryName = "kamuit-admin-dashboard/$rel"
            $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
            $es = $entry.Open()
            try {
                $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
                $es.Write($bytes, 0, $bytes.Length)
            } finally {
                $es.Dispose()
            }
        }
    } finally {
        $zip.Dispose()
    }
} finally {
    $zipStream.Dispose()
}

$sizeMB = [math]::Round((Get-Item $outPath).Length / 1MB, 1)
Write-Host ""
Write-Host "Done.  $outPath  ($sizeMB MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Tell your developer:" -ForegroundColor Cyan
Write-Host "  1. Unzip somewhere alongside the 4 backend repos."
Write-Host "  2. Open HANDOFF.md and follow it."
