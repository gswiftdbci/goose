# build-all-locals.ps1 — build every local component from the local/all-fixes fork:
#   1. goose.exe engine (release, default features = full local set)
#   2. packaged Desktop (ui/desktop/out/Goose-win32-x64)
#   3. hosted webui renderer bundle (ui/desktop/dist, served by web-test-server.js)
#
# Run from anywhere:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-all-locals.ps1
# Deploy afterwards with C:\Users\nepha\GooseRemote\update-goose-locals.cmd
param(
    [switch]$SkipEngine,
    [switch]$SkipDesktop,
    [switch]$SkipWebui
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host '=== all-locals build ===' -ForegroundColor Cyan

if (-not $SkipEngine) {
    Write-Host '[1/5] engine: cargo build --release -p goose-cli --bin goose' -ForegroundColor Yellow
    cargo build --release -p goose-cli --bin goose
    if ($LASTEXITCODE -ne 0) { throw 'engine build failed' }

    $binDir = Join-Path $Root 'ui\desktop\src\bin'
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    $dst = Join-Path $binDir 'goose.exe'
    if (Test-Path $dst) { Rename-Item $dst 'goose.exe.old' -Force }
    Copy-Item (Join-Path $Root 'target\release\goose.exe') $dst
    Write-Host '  engine staged into ui/desktop/src/bin' -ForegroundColor Green
}

Write-Host '[2/5] workspace deps: pnpm install' -ForegroundColor Yellow
Push-Location (Join-Path $Root 'ui')
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'pnpm install failed' }
Pop-Location

Push-Location (Join-Path $Root 'ui\desktop')
Write-Host '[3/5] acp client + i18n' -ForegroundColor Yellow
pnpm run build-goose-acp-client
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'acp client build failed' }
pnpm run i18n:compile
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'i18n compile failed' }

if (-not $SkipDesktop) {
    Write-Host '[4/5] desktop: electron-forge package' -ForegroundColor Yellow
    pnpm exec electron-forge package
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'desktop package failed' }
}

if (-not $SkipWebui) {
    Write-Host '[5/5] webui: vite renderer build -> dist/' -ForegroundColor Yellow
    pnpm exec vite build --config vite.renderer.config.mts
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'webui build failed' }
}
Pop-Location

Write-Host '=== all-locals build complete ===' -ForegroundColor Cyan
Write-Host "  engine:  $Root\target\release\goose.exe"
Write-Host "  desktop: $Root\ui\desktop\out\Goose-win32-x64\Goose.exe"
Write-Host "  webui:   $Root\ui\desktop\dist (served by web-test-server.js)"