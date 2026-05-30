$REPO = $PSScriptRoot

Set-Location $REPO

# Resolve pnpm - fail loud if not on PATH
$pnpm = $null
try { $pnpm = (Get-Command pnpm -ErrorAction Stop).Source }
catch {
    Write-Host ""
    Write-Host "  ERROR: pnpm not found on PATH. Install it first:" -ForegroundColor Red
    Write-Host "    npm install -g pnpm" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

# Prefer pnpm.cmd over pnpm.ps1 to avoid execution-policy issues in child shells
$pnpmCmd = Join-Path (Split-Path $pnpm) "pnpm.cmd"
if (Test-Path $pnpmCmd) { $pnpm = $pnpmCmd }

Write-Host ""
Write-Host "  Starting AgentRoom..." -ForegroundColor Cyan
Write-Host "  pnpm: $pnpm" -ForegroundColor DarkGray
Write-Host "  repo: $REPO" -ForegroundColor DarkGray
Write-Host ""

# Write temp scripts - sidesteps all apostrophe/quoting issues with -Command
$repoPs = $REPO.Replace("'", "''")
$pnpmPs = $pnpm.Replace("'", "''")
$webScript    = "$env:TEMP\agentroom-web.ps1"
$bridgeScript = "$env:TEMP\agentroom-bridge.ps1"

Set-Content -Path $webScript -Encoding UTF8 -Value @"
Set-Location '$repoPs'
Write-Host '  AgentRoom Web - starting...' -ForegroundColor Cyan
& '$pnpmPs' dev:web
"@

Set-Content -Path $bridgeScript -Encoding UTF8 -Value @"
Set-Location '$repoPs'
Start-Sleep 8
Write-Host '  AgentRoom Bridge - starting...' -ForegroundColor Cyan
& '$pnpmPs' dev:bridge
"@

# Launch each in its own visible window via -File (no quoting issues at all)
Start-Process powershell -ArgumentList @("-ExecutionPolicy", "Bypass", "-NoExit", "-File", $webScript)
Start-Process powershell -ArgumentList @("-ExecutionPolicy", "Bypass", "-NoExit", "-File", $bridgeScript)

# Poll until Next.js is ready (at least 60 s, check every 3 s)
Write-Host "  Waiting for http://localhost:3000 ..." -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep 3
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/api/health" -TimeoutSec 3 -ErrorAction Stop
        if ($r.StatusCode -eq 200 -and $r.Content -match '"ok"\s*:\s*true') { $ready = $true; break }
    } catch {}
}

if ($ready) {
    Write-Host "  AgentRoom is ready!" -ForegroundColor Green
    Start-Process "http://localhost:3000"
} else {
    Write-Host "  Still starting up - opening browser anyway." -ForegroundColor Yellow
    Start-Process "http://localhost:3000"
}
