$repoRoot = $PSScriptRoot
$targetPath = Join-Path $repoRoot "start-agentroom.bat"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "AgentRoom.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = "Launch AgentRoom"
$shortcut.IconLocation = "shell32.dll,16"
$shortcut.Save()

Write-Host "Created AgentRoom desktop shortcut: $shortcutPath" -ForegroundColor Green
