<#
.SYNOPSIS
  Restart-safe headless runner for the AgentRoom production-hardening loop.
.DESCRIPTION
  Repeatedly invokes Claude Code headless to drive /goal -> /loop from PROGRESS.md
  until docs/production-hardening/DONE.flag exists. Survives usage-limit windows by
  sleeping ~5h; relaunched by the AgentRoomHarden scheduled task on crash/logon.
.PARAMETER DryRun
  Verify resume wiring (PROGRESS.md, tools, DONE.flag) and exit without launching Claude.
#>
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$HardenDir = Join-Path $RepoRoot 'docs\production-hardening'
$Log       = Join-Path $HardenDir 'runner.log'
$DoneFlag  = Join-Path $HardenDir 'DONE.flag'
$Progress  = Join-Path $HardenDir 'PROGRESS.md'
$SleepOnLimitSec = 5 * 60 * 60   # one Claude usage window
$BackoffSec = 30

# Re-read PATH from the registry so a newly-installed/authed gh/node is resolvable
# even if this process inherited a stale environment block.
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $msg
  $line | Tee-Object -FilePath $Log -Append
}

# Mask secret-shaped tokens before they reach runner.log (mirrors bridge/src/lib/redact.ts).
# Defends against an agent echoing env/keys into stdout under --dangerously-skip-permissions.
function RedactSecrets([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return $s }
  $s = [regex]::Replace($s, 'sk-[A-Za-z0-9]{20,}', '[REDACTED]')
  $s = [regex]::Replace($s, 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', '[REDACTED-JWT]')
  $s = [regex]::Replace($s, '(?i)(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+', '$1=[REDACTED]')
  $s = [regex]::Replace($s, 'SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+', 'SUPABASE_SERVICE_ROLE_KEY=[REDACTED]')
  $s = [regex]::Replace($s, '(gh[posru]_|github_pat_)[A-Za-z0-9_]{20,}', '[REDACTED-GH]')
  $s = [regex]::Replace($s, 'AKIA[0-9A-Z]{16}', '[REDACTED-AWS]')
  return $s
}

function Get-ActiveGoal {
  if (-not (Test-Path $Progress)) { return '(PROGRESS.md missing)' }
  $g = Select-String -Path $Progress -Pattern '^##\s+\d{4}-\d{2}-\d{2}.+GOAL:' | Select-Object -Last 1
  if ($g) { return $g.Line.Trim() } else { return '(no GOAL line found)' }
}

$Prompt = @'
Resume the hardening loop: read docs/production-hardening/PROGRESS.md, run /loop until the active /goal is DONE, then set the next /goal per 01_HARDENING_PLAN.md + 04_HERMES_CAPABILITIES.md and continue. Stop only when docs/production-hardening/DONE.flag exists.
'@

if ($DryRun) {
  Write-Log 'DRY RUN - verifying resume wiring (no Claude launch).'
  Write-Log ('RepoRoot    : {0}' -f $RepoRoot)
  Write-Log ('PROGRESS.md : {0}' -f (Test-Path $Progress))
  Write-Log ('Active goal : {0}' -f (Get-ActiveGoal))
  Write-Log ('DONE.flag   : {0}' -f (Test-Path $DoneFlag))
  foreach ($t in 'claude','pnpm','git','gh','node') {
    $c = Get-Command $t -ErrorAction SilentlyContinue
    Write-Log ('tool {0,-7}: {1}' -f $t, $(if ($c) { $c.Source } else { 'NOT FOUND' }))
  }
  Write-Log 'DRY RUN complete - runner would resume from the active goal above.'
  return
}

# Singleton (Local\ = this logon session): dedupes the Startup launcher, a manual run,
# and re-entry within one session; the scheduled task's IgnoreNew covers its own
# triggers. Not machine-wide — two simultaneous interactive logons would each get one.
$mutex = New-Object System.Threading.Mutex($false, 'Local\AgentRoomHardenRunner')
if (-not $mutex.WaitOne(0)) { Write-Log 'Another runner instance is already active - exiting.'; return }
try {
Write-Log '==== AgentRoomHarden runner starting ===='
while (-not (Test-Path $DoneFlag)) {
  Write-Log 'Launching headless Claude Code cycle...'
  # --dangerously-skip-permissions: unattended operation cannot stop for a prompt.
  # main stays protected by CLAUDE.md + branch/PR discipline; secrets are never committed.
  & claude --model opus --continue -p $Prompt --dangerously-skip-permissions 2>&1 |
    ForEach-Object { RedactSecrets ([string]$_) } | Tee-Object -FilePath $Log -Append
  $code = $LASTEXITCODE
  if (Test-Path $DoneFlag) { Write-Log 'DONE.flag present - stopping.'; break }
  $tail = (Get-Content $Log -Tail 60 -ErrorAction SilentlyContinue) -join "`n"
  if ($tail -match '(?i)(usage limit|rate limit|limit reached|resets? at|too many requests|\b429\b|quota exceeded)') {
    Write-Log ('Usage/rate limit detected - sleeping {0}s until the window resets.' -f $SleepOnLimitSec)
    Start-Sleep -Seconds $SleepOnLimitSec
  } else {
    Write-Log ('Cycle exited (code {0}). Backoff {1}s, then continue.' -f $code, $BackoffSec)
    Start-Sleep -Seconds $BackoffSec
  }
}
Write-Log '==== runner finished (DONE.flag present) ===='
} finally { try { [void]$mutex.ReleaseMutex() } catch {}; $mutex.Dispose() }
