# ╔══════════════════════════════════════════════════════╗
# ║     Photo→PDF License Server — One-Click VPS Setup   ║
# ║     No admin required. Runs as normal user.          ║
# ╚══════════════════════════════════════════════════════╝
#
# USAGE (in PowerShell):
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\setup.ps1
#
# What this does:
#   1. Creates folder structure in your user profile
#   2. Downloads Node.js portable (no install)
#   3. Downloads cloudflared portable (no install)
#   4. Copies server files into place
#   5. Runs init.js to generate keys and config
#   6. Registers Task Scheduler entry (no admin needed)
#   7. Starts everything

$ErrorActionPreference = "Stop"

$APP    = "$env:USERPROFILE\photopdf-app"
$SERVER = "$APP\server"
$NODE   = "$APP\node"
$LOGS   = "$APP\logs"

Write-Host ""
Write-Host "  Photo-PDF License Server — Setup" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── 1. Create directories ─────────────────────────────
Write-Host "  [1/6] Creating directories..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $APP    -Force | Out-Null
New-Item -ItemType Directory -Path $SERVER -Force | Out-Null
New-Item -ItemType Directory -Path $NODE   -Force | Out-Null
New-Item -ItemType Directory -Path $LOGS   -Force | Out-Null
New-Item -ItemType Directory -Path "$APP\server\scripts" -Force | Out-Null
Write-Host "         Done." -ForegroundColor Green

# ── 2. Download Node.js portable ─────────────────────
Write-Host "  [2/6] Downloading Node.js 20 portable..." -ForegroundColor Yellow
$nodeUrl = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip"
$nodeZip = "$APP\node.zip"

if (!(Test-Path "$NODE\node.exe")) {
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip -UseBasicParsing
    Write-Host "         Extracting..." -ForegroundColor DarkGray
    Expand-Archive -Path $nodeZip -DestinationPath "$APP\node-tmp" -Force
    $inner = Get-ChildItem "$APP\node-tmp" | Select-Object -First 1
    Move-Item "$($inner.FullName)\*" $NODE -Force
    Remove-Item "$APP\node-tmp" -Recurse -Force
    Remove-Item $nodeZip -Force
    Write-Host "         Done." -ForegroundColor Green
} else {
    Write-Host "         Already exists, skipping." -ForegroundColor DarkGray
}

# ── 3. Download cloudflared ───────────────────────────
Write-Host "  [3/6] Downloading cloudflared..." -ForegroundColor Yellow
$cfExe = "$APP\cloudflared.exe"

if (!(Test-Path $cfExe)) {
    $cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Invoke-WebRequest -Uri $cfUrl -OutFile $cfExe -UseBasicParsing
    Write-Host "         Done." -ForegroundColor Green
} else {
    Write-Host "         Already exists, skipping." -ForegroundColor DarkGray
}

# ── 4. Copy server files ──────────────────────────────
Write-Host "  [4/6] Copying server files..." -ForegroundColor Yellow
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$filesToCopy = @(
    "server.js",
    "package.json",
    "start.bat",
    "stop.bat"
)

foreach ($f in $filesToCopy) {
    $src = Join-Path $scriptDir $f
    if (Test-Path $src) {
        Copy-Item $src "$SERVER\$f" -Force
        Write-Host "         Copied $f" -ForegroundColor DarkGray
    } else {
        Write-Host "         [WARN] $f not found at $src" -ForegroundColor DarkRed
    }
}

# Copy scripts subfolder
$scriptSrc = Join-Path $scriptDir "scripts"
if (Test-Path $scriptSrc) {
    Copy-Item $scriptSrc "$SERVER\scripts" -Recurse -Force
    Write-Host "         Copied scripts/" -ForegroundColor DarkGray
}

Write-Host "         Done." -ForegroundColor Green

# ── 5. Generate config + keys ─────────────────────────
Write-Host "  [5/6] Generating config and license keys..." -ForegroundColor Yellow
$env:PATH = "$NODE;" + $env:PATH

if (!(Test-Path "$SERVER\config.json")) {
    Push-Location $SERVER
    & "$NODE\node.exe" scripts/init.js
    Pop-Location
    Write-Host "         Done." -ForegroundColor Green
} else {
    Write-Host "         config.json already exists, skipping." -ForegroundColor DarkGray
}

# Copy start.bat to app root for Task Scheduler
Copy-Item "$SERVER\start.bat" "$APP\start.bat" -Force

# ── 6. Register Task Scheduler ────────────────────────
Write-Host "  [6/6] Registering startup task..." -ForegroundColor Yellow
$taskName = "PhotoPDF-License-Server"

$action   = New-ScheduledTaskAction -Execute "$APP\start.bat"
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

try {
    Register-ScheduledTask `
        -TaskName    $taskName `
        -Action      $action `
        -Trigger     $trigger `
        -Settings    $settings `
        -Description "Starts PhotoPDF license server and Cloudflare tunnel at logon" `
        -Force | Out-Null
    Write-Host "         Task '$taskName' registered." -ForegroundColor Green
} catch {
    Write-Host "         [WARN] Could not register task: $_" -ForegroundColor DarkRed
    Write-Host "         You can start manually by running: $APP\start.bat" -ForegroundColor DarkGray
}

# ── Done ──────────────────────────────────────────────
Write-Host ""
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  App directory : $APP" -ForegroundColor White
Write-Host "  Server files  : $SERVER" -ForegroundColor White
Write-Host "  Keys list     : $SERVER\LICENSE_KEYS.txt" -ForegroundColor White
Write-Host ""
Write-Host "  To start now:" -ForegroundColor Cyan
Write-Host "    & '$APP\start.bat'" -ForegroundColor White
Write-Host ""
Write-Host "  Then check your tunnel URL:" -ForegroundColor Cyan
Write-Host "    Get-Content '$LOGS\tunnel.log' -Tail 20" -ForegroundColor White
Write-Host ""
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
