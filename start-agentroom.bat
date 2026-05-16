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
powershell -NoProfile -Command "$webEnv='apps\web\.env.local'; $bridgeEnv='bridge\.env'; if ((Test-Path -LiteralPath $webEnv) -and (Test-Path -LiteralPath $bridgeEnv)) { exit 0 }; $status=& supabase status 2>&1; $publishable=$null; $secret=$null; foreach ($line in $status) { $text=[string]$line; if (-not $publishable) { if ($text -match '(sb_publishable_[A-Za-z0-9_-]+)') { $publishable=$Matches[1] } elseif ($text -match 'Publishable') { $tokens=$text.Trim() -split '\s+'; if ($tokens.Count -gt 0) { $publishable=$tokens[-1] } } }; if (-not $secret) { if ($text -match '(sb_secret_[A-Za-z0-9_-]+)') { $secret=$Matches[1] } elseif ($text -match 'Secret') { $tokens=$text.Trim() -split '\s+'; if ($tokens.Count -gt 0) { $secret=$tokens[-1] } } } }; if (-not $publishable -or -not $secret) { Write-Host '[ERROR] Could not extract Supabase keys from supabase status output.'; exit 1 }; if (-not (Test-Path -LiteralPath $webEnv)) { @('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321', ('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' + $publishable), ('SUPABASE_SERVICE_ROLE_KEY=' + $secret), 'NEXT_PUBLIC_APP_URL=http://localhost:3000') | Set-Content -LiteralPath $webEnv -Encoding ASCII; Write-Host '[OK] Created apps\web\.env.local' }; if (-not (Test-Path -LiteralPath $bridgeEnv)) { @('SUPABASE_URL=http://127.0.0.1:54321', ('SUPABASE_SERVICE_ROLE_KEY=' + $secret), 'BRIDGE_WORKER_ID=bridge-local-1', 'BRIDGE_POLL_INTERVAL_MS=2000', 'BRIDGE_MAX_CONCURRENT_RUNS=3', 'BRIDGE_HEARTBEAT_INTERVAL_MS=5000', 'BRIDGE_STALE_RUN_TIMEOUT_MS=60000', 'CLAUDE_BIN=claude', 'CODEX_BIN=codex', 'MYCLAUDE_BIN=myclaude', 'RUFLO_BIN=ruflo') | Set-Content -LiteralPath $bridgeEnv -Encoding ASCII; Write-Host '[OK] Created bridge\.env' }"
if errorlevel 1 (
    echo [ERROR] Failed to create missing env files from Supabase status.
    pause & exit /b 1
)
echo.
echo [4/5] Starting web server...
echo [!] Clearing stale Next.js dev cache...
powershell -NoProfile -Command "if (Test-Path -LiteralPath 'apps\web\.next') { Remove-Item -LiteralPath 'apps\web\.next' -Recurse -Force }"
start "AgentRoom Web" cmd /k "cd /d %~dp0 && pnpm --filter web dev"
timeout /t 6 /nobreak >/dev/null
echo.
echo [5/5] Starting bridge daemon...
start "AgentRoom Bridge" cmd /k "cd /d %~dp0 && pnpm --filter bridge dev"
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
