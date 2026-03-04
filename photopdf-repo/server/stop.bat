@echo off
REM ╔══════════════════════════════════════════════════════╗
REM ║     Photo→PDF License Server — Windows Stop          ║
REM ╚══════════════════════════════════════════════════════╝

echo Stopping all Photo-PDF services...

taskkill /IM node.exe /F 2>nul
if %ERRORLEVEL% EQU 0 (
    echo   [OK] Node.js stopped.
) else (
    echo   [--] Node.js was not running.
)

taskkill /IM cloudflared.exe /F 2>nul
if %ERRORLEVEL% EQU 0 (
    echo   [OK] Cloudflare tunnel stopped.
) else (
    echo   [--] cloudflared was not running.
)

echo Done.
