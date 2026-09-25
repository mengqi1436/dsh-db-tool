# Build the official GaussDB (openGauss) Node driver into vendor/.
# PowerShell version (use when bash/WSL is unavailable on Windows).
#
#   powershell -ExecutionPolicy Bypass -File scripts/build-gaussdb.ps1            # skip if built
#   powershell -ExecutionPolicy Bypass -File scripts/build-gaussdb.ps1 -Force     # rebuild
#
# Equivalent to scripts/build-gaussdb.sh. Output: vendor/gaussdb-pg/packages/pg
# (CJS, pg-like: { Pool, Client, ... }; pg lib requires '../../pg-protocol'/'../../pg-pool',
#  so the monorepo packages/ layout must be preserved)
# Requires Node >= 16, npm >= 7. Source: gitcode.com/opengauss/openGauss-connector-nodejs (master latest).
# NOTE: keep this file ASCII-only so Windows PowerShell 5.1 (GBK codepage) can parse it.
param(
    [switch]$Force
)
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Src = Join-Path $RepoRoot 'vendor\gaussdb-src'
$Dst = Join-Path $RepoRoot 'vendor\gaussdb-pg'

if (-not $Force -and (Test-Path (Join-Path $Dst 'packages\pg\package.json'))) {
    Write-Host "[build-gaussdb] $Dst already built, skip (use -Force to rebuild)"
    exit 0
}

if (Test-Path (Join-Path $Src '.git')) {
    Write-Host "[build-gaussdb] source exists, updating..."
    git -C $Src pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "git pull failed (exit $LASTEXITCODE)" }
} else {
    Write-Host "[build-gaussdb] cloning openGauss-connector-nodejs..."
    if (Test-Path $Src) { Remove-Item -Recurse -Force $Src }
    New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot 'vendor') | Out-Null
    git clone https://gitcode.com/opengauss/openGauss-connector-nodejs $Src
    if ($LASTEXITCODE -ne 0) { throw "git clone failed (exit $LASTEXITCODE)" }
}

Write-Host "[build-gaussdb] npm install && npm run build..."
Push-Location $Src
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Write-Host "[build-gaussdb] copying packages layout -> vendor/gaussdb-pg/packages ..."
if (Test-Path $Dst) { Remove-Item -Recurse -Force $Dst }
New-Item -ItemType Directory -Force (Join-Path $Dst 'packages') | Out-Null
Copy-Item -Recurse (Join-Path $Src 'packages\pg') (Join-Path $Dst 'packages\pg')
Copy-Item -Recurse (Join-Path $Src 'packages\pg-protocol') (Join-Path $Dst 'packages\pg-protocol')
Copy-Item -Recurse (Join-Path $Src 'packages\pg-pool') (Join-Path $Dst 'packages\pg-pool')

$PgDir = Join-Path $Dst 'packages\pg'
Write-Host "[build-gaussdb] installing runtime deps (incl. undeclared p-limit used by fork)..."
Push-Location $PgDir
try {
    npm install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
    npm install p-limit --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install p-limit failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $PgDir 'package.json'))) {
    throw "build output missing package.json, check $Src\packages\pg layout"
}

Write-Host "[build-gaussdb] done: $PgDir"
