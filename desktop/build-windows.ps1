# ForgeEngine Windows build helper
# --------------------------------
# Run this script from PowerShell when you want a fresh installer build.
# It intentionally uses the normal npm scripts from package.json so CI/CD can
# use exactly the same build commands later.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "ForgeEngine Windows Installer Build" -ForegroundColor Cyan
Write-Host "Project: $Root"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required. Install Node.js 18 or newer first."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required but was not found in PATH."
}

Write-Host "`n[1/3] Installing/updating build dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Write-Host "`n[2/3] Checking desktop/server JavaScript syntax..." -ForegroundColor Yellow
node --check desktop/main.js
node --check core/index.js
node --check src/account-manager.js
if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed." }

Write-Host "`n[3/3] Building ForgeEngine Setup.exe..." -ForegroundColor Yellow
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw "Installer build failed." }

Write-Host "`nDone. Look in the dist folder for ForgeEngine-Setup-*.exe" -ForegroundColor Green
