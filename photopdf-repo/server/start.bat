@echo off
REM ╔══════════════════════════════════════════════════════╗
REM ║     Photo→PDF License Server — Windows Startup       ║
REM ╚══════════════════════════════════════════════════════╝
REM
REM Place this file in: %USERPROFILE%\photopdf-app\
REM It is auto-called by Task Scheduler at logon.

SET APP_DIR=%USERPROFILE%\photopdf-app
SET NODE_EXE=%APP_DIR%\node\node.exe
SET CF_EXE=%APP_DIR%\cloudflared.exe
SET LOG_DIR=%APP_DIR%\logs

REM Create logs directory if missing
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo [%DATE% %TIME%] Starting Photo-PDF License Server... >> "%LOG_DIR%\startup.log"

REM ── Start Node.js license server ─────────────────────
start "" /B "%NODE_EXE%" "%APP_DIR%\server\server.js" >> "%LOG_DIR%\server.log" 2>&1
echo [%DATE% %TIME%] Node.js server started. >> "%LOG_DIR%\startup.log"

REM ── Wait for Node to initialise ──────────────────────
timeout /t 3 /nobreak > nul

REM ── Start Cloudflare tunnel ───────────────────────────
REM Quick tunnel (no domain required):
start "" /B "%CF_EXE%" tunnel --url http://localhost:3000 >> "%LOG_DIR%\tunnel.log" 2>&1

REM Named tunnel (uncomment if you have a domain set up):
REM start "" /B "%CF_EXE%" tunnel --config "%APP_DIR%\tunnel-config.yml" run >> "%LOG_DIR%\tunnel.log" 2>&1

echo [%DATE% %TIME%] Cloudflare tunnel started. >> "%LOG_DIR%\startup.log"
echo [%DATE% %TIME%] All services running. >> "%LOG_DIR%\startup.log"
