# Windows VPS Setup — No Admin Required

Complete deployment guide for Windows VPS with limited user access.

## Prerequisites

- Windows VPS with RDP access
- Your user account (no admin needed)
- Internet connection from the VPS

---

## Option A — Automated (Recommended)

Run the one-click setup script. It handles everything.

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\server\setup.ps1
```

Then get your tunnel URL:

```powershell
Get-Content "$env:USERPROFILE\photopdf-app\logs\tunnel.log" -Tail 20
```

---

## Option B — Manual Step by Step

### 1. Create folders

```powershell
New-Item -ItemType Directory -Path "$env:USERPROFILE\photopdf-app\node" -Force
New-Item -ItemType Directory -Path "$env:USERPROFILE\photopdf-app\logs" -Force
New-Item -ItemType Directory -Path "$env:USERPROFILE\photopdf-app\server\scripts" -Force
```

### 2. Download Node.js portable

```powershell
$nodeUrl = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip"
Invoke-WebRequest -Uri $nodeUrl -OutFile "$env:USERPROFILE\photopdf-app\node.zip" -UseBasicParsing
Expand-Archive -Path "$env:USERPROFILE\photopdf-app\node.zip" -DestinationPath "$env:USERPROFILE\photopdf-app\node-tmp" -Force
$inner = Get-ChildItem "$env:USERPROFILE\photopdf-app\node-tmp" | Select-Object -First 1
Move-Item "$($inner.FullName)\*" "$env:USERPROFILE\photopdf-app\node" -Force
Remove-Item "$env:USERPROFILE\photopdf-app\node-tmp" -Recurse -Force
Remove-Item "$env:USERPROFILE\photopdf-app\node.zip" -Force
```

### 3. Download cloudflared

```powershell
Invoke-WebRequest `
  -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
  -OutFile "$env:USERPROFILE\photopdf-app\cloudflared.exe" `
  -UseBasicParsing
```

### 4. Copy server files

Copy these from the repo into `%USERPROFILE%\photopdf-app\server\`:
- `server/server.js`
- `server/package.json`
- `server/config.example.json`
- `server/scripts/init.js`
- `server/scripts/admin.js`

Copy `server/start.bat` and `server/stop.bat` to `%USERPROFILE%\photopdf-app\`.

### 5. Generate config and keys

```powershell
$env:PATH = "$env:USERPROFILE\photopdf-app\node;" + $env:PATH
cd "$env:USERPROFILE\photopdf-app\server"
node scripts/init.js
```

### 6. Test the server

```powershell
node server.js
```

You should see: `Listening on http://localhost:3000`

Press `Ctrl+C` to stop.

### 7. Start Cloudflare Quick Tunnel

In a new PowerShell window:

```powershell
& "$env:USERPROFILE\photopdf-app\cloudflared.exe" tunnel --url http://localhost:3000
```

Note the `trycloudflare.com` URL that appears.

### 8. Register Task Scheduler (auto-start on reboot)

```powershell
$action   = New-ScheduledTaskAction -Execute "$env:USERPROFILE\photopdf-app\start.bat"
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
              -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
              -RestartCount 3 `
              -RestartInterval (New-TimeSpan -Minutes 1) `
              -StartWhenAvailable

Register-ScheduledTask `
  -TaskName "PhotoPDF-License-Server" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Force
```

---

## Daily Commands

```powershell
# Start everything
& "$env:USERPROFILE\photopdf-app\start.bat"

# Stop everything
& "$env:USERPROFILE\photopdf-app\stop.bat"

# Check processes
Get-Process node, cloudflared -ErrorAction SilentlyContinue

# View server logs
Get-Content "$env:USERPROFILE\photopdf-app\logs\server.log" -Tail 30

# Get current tunnel URL
Select-String -Path "$env:USERPROFILE\photopdf-app\logs\tunnel.log" -Pattern "trycloudflare.com"

# Backup database
$d = Get-Date -Format "yyyyMMdd"
Copy-Item "$env:USERPROFILE\photopdf-app\server\license_db.json" `
          "$env:USERPROFILE\photopdf-app\server\license_db_backup_$d.json"
```

---

## Updating the Server URL in the HTML

Each time the tunnel URL changes (after reboot when using Quick Tunnel), update the HTML:

```javascript
// In client/PhotoToPDF.html, find and update:
const SERVER_URL = 'https://new-url.trycloudflare.com';
```

To avoid this, set up a Named Tunnel with a domain — see README.md for details.
