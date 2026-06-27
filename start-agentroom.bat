@echo off
setlocal enabledelayedexpansion
title AgentRoom Launcher
color 0F
cd /d "%~dp0"
echo ========================================
echo   AgentRoom - Starting...
echo ========================================
echo.
echo AgentRoom is a local, single-user app: no Docker, no database to install,
echo no login. State lives in %%APPDATA%%\AgentRoom. To run real agents, install and
echo log in your CLIs (claude, codex, ...) in your terminal first.
echo.

echo [1/3] Checking dependencies...
if not exist "node_modules" (
    echo [!] Installing dependencies (first run)...
    call pnpm install
    if errorlevel 1 (
        echo [ERROR] pnpm install failed. Install Node 22.13+ and run "corepack enable".
        pause & exit /b 1
    )
)
echo [OK] Dependencies present.
echo.

echo [2/3] Starting web server...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\check-web-ready.ps1" >nul 2>&1
if errorlevel 1 (
    echo [!] Clearing any stale port 3000 listener + Next.js cache...
    powershell -NoProfile -Command "$listeners=Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; foreach ($listener in $listeners) { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue }"
    powershell -NoProfile -Command "if (Test-Path -LiteralPath 'apps\web\.next') { Remove-Item -LiteralPath 'apps\web\.next' -Recurse -Force }"
    start "AgentRoom Web" cmd /k "cd /d %~dp0 && pnpm --filter web dev"
) else (
    echo [OK] Web server already healthy on port 3000.
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(45); do { & '.\scripts\check-web-ready.ps1'; if ($LASTEXITCODE -eq 0) { exit 0 }; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
    echo [ERROR] Web server did not become ready at http://localhost:3000.
    pause & exit /b 1
)
echo.

echo [3/3] Starting bridge daemon...
powershell -NoProfile -Command "$root=(Resolve-Path '.').Path; $bridge=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and (($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*pnpm --filter bridge dev*' -and $_.CommandLine -like ('*' + $root + '*')) -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $root + '*bridge*tsx*watch src/index.ts*'))) }; if ($bridge) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
    start "AgentRoom Bridge" cmd /k "cd /d %~dp0 && pnpm --filter bridge dev"
    timeout /t 4 /nobreak >nul
) else (
    echo [OK] Bridge daemon already running.
)
echo.
echo [OK] Opening browser...
start http://localhost:3000
echo.
echo ========================================
echo   AgentRoom is running!
echo   http://localhost:3000
echo   Open Connections (plug icon) to add your CLIs.
echo   Close "AgentRoom Web" and
echo   "AgentRoom Bridge" windows to stop.
echo ========================================
pause >nul
exit /b 0
