$ErrorActionPreference = 'Stop'

function Test-AgentRoomWeb {
  try {
    $health = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 3
    if ($health.StatusCode -ne 200) { return $false }

    $roomsOk = $false
    try {
      Invoke-WebRequest `
        -Uri 'http://localhost:3000/api/rooms' `
        -Method POST `
        -ContentType 'application/json' `
        -Body '{"name":"readiness"}' `
        -UseBasicParsing `
        -TimeoutSec 3 | Out-Null
    } catch {
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) {
        $roomsOk = $true
      }
    }
    if (-not $roomsOk) { return $false }

    $auth = Invoke-WebRequest -Uri 'http://localhost:3000/auth' -UseBasicParsing -TimeoutSec 5
    if ($auth.StatusCode -ne 200) { return $false }

    $assetMatches = [regex]::Matches($auth.Content, 'href="([^"]*_next/static/[^"]+)"|src="([^"]*_next/static/[^"]+)"')
    if ($assetMatches.Count -eq 0) { return $false }
    foreach ($match in $assetMatches) {
      $assetPath = $match.Groups[1].Value
      if (-not $assetPath) { $assetPath = $match.Groups[2].Value }
      if (-not $assetPath) { continue }

      $assetUrl = if ($assetPath.StartsWith('http')) { $assetPath } else { "http://localhost:3000$assetPath" }
      $asset = Invoke-WebRequest -Uri $assetUrl -UseBasicParsing -TimeoutSec 5
      if ($asset.StatusCode -ne 200) { return $false }
    }

    return $true
  } catch {
    return $false
  }
}

if (Test-AgentRoomWeb) { exit 0 }
exit 1
