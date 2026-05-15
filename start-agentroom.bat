@echo off
setlocal enabledelayedexpansion
title AgentRoom Launcher
color 0F
cd /d "%~dp0"
echo ========================================
echo   AgentRoom - Starting Stack...
echo ========================================
echo.
echo [1/5] Checking Docker Desktop...
docker info >/dev/null 2>&1
if errorlevel 1 (
    echo [!] Starting Docker Desktop - waiting 35s...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    timeout /t 35 /nobreak >/dev/null
    docker info >/dev/null 2>&1
    if errorlevel 1 (
        echo [ERROR] Docker failed to start. Please start manually.
        pause & exit /b 1
    )
)
echo [OK] Docker running.
echo.
echo [2/5] Checking Supabase on port 54321...
powershell -Command "try{(New-Object Net.Sockets.TcpClient('127.0.0.1',54321)).Close();exit 0}catch{exit 1}" >/dev/null 2>&1
if errorlevel 1 (
    echo [!] Starting Supabase...
    supabase start
)
echo [OK] Supabase running.
echo.
echo [3/5] Checking env files...
if not exist "apps\web\.env.local" echo [WARN] Missing apps\web\.env.local - see QUICKSTART.md
if not exist "bridge\.env" echo [WARN] Missing bridge\.env - see QUICKSTART.md
echo.
echo [4/5] Starting web server...
start "AgentRoom Web" cmd /k "cd /d %~dp0 && pnpm dev:web"
timeout /t 6 /nobreak >/dev/null
echo.
echo [5/5] Starting bridge daemon...
start "AgentRoom Bridge" cmd /k "cd /d %~dp0 && pnpm dev:bridge"
timeout /t 4 /nobreak >/dev/null
echo.
echo [OK] Opening browser...
start http://localhost:3000
echo.
echo ========================================
echo   AgentRoom is running!
echo   http://localhost:3000
echo   Supabase Studio: http://127.0.0.1:54323
echo   Close "AgentRoom Web" and
echo   "AgentRoom Bridge" windows to stop.
echo ========================================
pause >/dev/null
