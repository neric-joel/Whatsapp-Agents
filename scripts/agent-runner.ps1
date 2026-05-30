<#
.SYNOPSIS
  Restart-safe headless runner for the AgentRoom production-hardening loop.
.DESCRIPTION
  Repeatedly invokes Claude Code headless to drive /goal -> /loop from PROGRESS.md
  until the hardening is TRULY complete: every box in 03_DEFINITION_OF_DONE.md is
  checked AND a v1 git tag exists. A bare DONE.flag is NOT trusted on its own — it
  is verified, and DELETED as stale (then the loop continues) if work remains.
  Survives usage-limit windows by sleeping ~5h; relaunched by the AgentRoomHarden
  task/Startup launcher on crash/logon.
.PARAMETER DryRun
  Verify resume wiring (active goal, DoD state, tools, flag validity) and exit.
#>
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$HardenDir = Join-Path $RepoRoot 'docs\production-hardening'
$Log       = Join-Path $HardenDir 'runner.log'
$DoneFlag  = Join-Path $HardenDir 'DONE.flag'
$Progress  = Join-Path $HardenDir 'PROGRESS.md'
$Dod       = Join-Path $HardenDir '03_DEFINITION_OF_DONE.md'
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

# The active goal = the GOAL heading marked ACTIVE (NOT a DONE one). Fixes the old
# "last GOAL line" bug that pointed at the already-DONE Phase 1 block.
function Get-ActiveGoal {
  if (-not (Test-Path $Progress)) { return '(PROGRESS.md missing)' }
  $active = Select-String -Path $Progress -Pattern '^##\s+\d{4}-\d{2}-\d{2}.+GOAL:.*ACTIVE' | Select-Object -Last 1
  if ($active) { return $active.Line.Trim() }
  $any = Select-String -Path $Progress -Pattern '^##\s+\d{4}-\d{2}-\d{2}.+GOAL:' |
         Where-Object { $_.Line -notmatch '(?i)DONE' } | Select-Object -Last 1
  if ($any) { return $any.Line.Trim() } else { return '(no ACTIVE goal found)' }
}

# Completion is OBJECTIVE: zero unchecked DoD boxes AND a v1 tag. Nothing else counts.
function Get-UncheckedCount {
  if (-not (Test-Path $Dod)) { return 9999 }
  return (Select-String -Path $Dod -Pattern '^\s*-\s*\[ \]').Count
}
function Test-HasV1Tag {
  $tags = & git tag 2>$null
  return [bool]($tags -match '^v1\.')
}
function Test-HardeningComplete {
  return ((Get-UncheckedCount) -eq 0 -and (Test-HasV1Tag))
}

# Honor DONE.flag ONLY if truly complete; otherwise it is stale -> delete, log, continue.
function Confirm-Done {
  if (-not (Test-Path $DoneFlag)) { return $false }
  if (Test-HardeningComplete) {
    Write-Log 'DONE.flag verified: 0 unchecked DoD boxes + v1 tag present. Complete.'
    return $true
  }
  $u = Get-UncheckedCount
  Remove-Item $DoneFlag -Force -ErrorAction SilentlyContinue
  Write-Log ('STALE DONE.flag removed: {0} unchecked DoD box(es) remain / no v1 tag. Continuing.' -f $u)
  return $false
}

$Prompt = @'
Load state from docs/production-hardening/PROGRESS.md, CLAUDE.md and git. Continue the hardening loop: run the ACTIVE /goal in PROGRESS.md to DONE, then immediately set the next /goal per 01_HARDENING_PLAN.md + 04_HERMES_CAPABILITIES.md and keep going. Never stop to ask; on a blocker take the safe reversible path or log it under "## For morning review" and continue. Feature branches + PRs only; never touch main; no secrets. Self-heal on any failure: write a root-cause note, set a corrective "fix:" goal, fix, re-verify green.

COMPLETION IS OBJECTIVE. Do NOT create docs/production-hardening/DONE.flag unless BOTH are true RIGHT NOW: (1) 03_DEFINITION_OF_DONE.md has ZERO unchecked "- [ ]" boxes, and (2) `git tag` shows a v1 tag. Finishing one goal or phase is NOT completion — set the next goal and continue. Never create DONE.flag to signal that a cycle or phase finished. If in doubt, do NOT create it.
'@

if ($DryRun) {
  Write-Log 'DRY RUN - verifying resume wiring (no Claude launch).'
  Write-Log ('RepoRoot      : {0}' -f $RepoRoot)
  Write-Log ('PROGRESS.md   : {0}' -f (Test-Path $Progress))
  Write-Log ('Active goal   : {0}' -f (Get-ActiveGoal))
  Write-Log ('DoD unchecked : {0}' -f (Get-UncheckedCount))
  Write-Log ('v1 tag        : {0}' -f (Test-HasV1Tag))
  Write-Log ('Truly complete: {0}' -f (Test-HardeningComplete))
  if (Test-Path $DoneFlag) {
    if (Test-HardeningComplete) { Write-Log 'DONE.flag      : present and VALID.' }
    else { Write-Log 'DONE.flag      : present but STALE (real run would delete it and continue).' }
  } else { Write-Log 'DONE.flag      : absent.' }
  foreach ($t in 'claude','pnpm','git','gh','node') {
    $c = Get-Command $t -ErrorAction SilentlyContinue
    Write-Log ('tool {0,-7}: {1}' -f $t, $(if ($c) { $c.Source } else { 'NOT FOUND' }))
  }
  Write-Log 'DRY RUN complete - runner would resume from the active goal above.'
  return
}

# Singleton per logon session: dedupes the Startup launcher + a manual run + re-entry.
$mutex = New-Object System.Threading.Mutex($false, 'Local\AgentRoomHardenRunner')
if (-not $mutex.WaitOne(0)) { Write-Log 'Another runner instance is already active - exiting.'; return }
try {
  Write-Log '==== AgentRoomHarden runner starting ===='
  while (-not (Confirm-Done)) {
    Write-Log ('Launching headless Claude Code cycle... (active: {0}; {1} DoD box(es) left)' -f (Get-ActiveGoal), (Get-UncheckedCount))
    # --dangerously-skip-permissions: unattended operation cannot stop for a prompt.
    # main stays protected by CLAUDE.md + branch/PR discipline; secrets are never committed.
    & claude -p $Prompt --dangerously-skip-permissions --model opus 2>&1 |
      ForEach-Object { RedactSecrets ([string]$_) } | Tee-Object -FilePath $Log -Append
    $code = $LASTEXITCODE
    Write-Log ('Cycle returned (exit {0}); {1} DoD box(es) left.' -f $code, (Get-UncheckedCount))
    if (Confirm-Done) { break }
    $tail = (Get-Content $Log -Tail 60 -ErrorAction SilentlyContinue) -join "`n"
    if ($tail -match '(?i)(usage limit|rate limit|limit reached|resets? at|too many requests|\b429\b|quota exceeded)') {
      Write-Log ('Usage/rate limit detected - sleeping {0}s until the window resets.' -f $SleepOnLimitSec)
      Start-Sleep -Seconds $SleepOnLimitSec
    } else {
      Write-Log ('Backoff {0}s, then continue.' -f $BackoffSec)
      Start-Sleep -Seconds $BackoffSec
    }
  }
  Write-Log '==== runner finished (hardening verified complete: 0 unchecked DoD boxes + v1 tag) ===='
} finally { try { [void]$mutex.ReleaseMutex() } catch {}; $mutex.Dispose() }
