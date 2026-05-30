#requires -RunAsAdministrator
<#
.SYNOPSIS
  Register the AgentRoomHarden scheduled task (logon + every 5h, IgnoreNew).
.DESCRIPTION
  Run ONCE from an elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
  Creating a logon-triggered task requires admin; that's the only step that does.
  (For a no-admin equivalent, a Startup-folder launcher calls scripts\agent-runner.ps1.)
#>
$ErrorActionPreference = 'Stop'
$repo   = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $repo 'scripts\agent-runner.ps1'
$start  = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>AgentRoom production-hardening runner (restart-safe).</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
    <TimeTrigger><StartBoundary>$start</StartBoundary><Enabled>true</Enabled><Repetition><Interval>PT5H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$runner"</Arguments>
      <WorkingDirectory>$repo</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$xmlPath = Join-Path $env:TEMP 'AgentRoomHarden.xml'
Set-Content -LiteralPath $xmlPath -Value $xml -Encoding Unicode
schtasks /Create /TN AgentRoomHarden /XML "$xmlPath" /F
schtasks /Query /TN AgentRoomHarden /FO LIST
Write-Host ''
Write-Host 'Registered AgentRoomHarden. Start now with:  schtasks /Run /TN AgentRoomHarden'
Write-Host 'Stop with: New-Item docs\production-hardening\DONE.flag  (graceful)  or  schtasks /End /TN AgentRoomHarden'
