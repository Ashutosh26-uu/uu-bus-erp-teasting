@echo off
title UU Bus ERP - public link
cd /d "%~dp0"

set CF=%LOCALAPPDATA%\cloudflared\cloudflared.exe
if not exist "%CF%" (
  echo cloudflared.exe not found at %CF%
  echo Download it from https://github.com/cloudflare/cloudflared/releases  ^(cloudflared-windows-amd64.exe^)
  pause
  exit /b 1
)

echo Starting the UU Bus ERP server...
start "UU Bus ERP server" /min cmd /c "node server.js"
timeout /t 3 /nobreak >nul

echo.
echo Opening the public link. Look for the line ending in  .trycloudflare.com  below
echo and share that https:// address. Keep BOTH windows open while the portal is in use.
echo.
"%CF%" tunnel --no-autoupdate --url http://localhost:3000
pause
