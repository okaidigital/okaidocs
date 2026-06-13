param(
  [string]$Hostname = "docs.okai.com.br",
  [string]$TunnelName = "okai-docs",
  [string]$TunnelId = $env:OKD_CLOUDFLARE_TUNNEL_ID,
  [string]$Workspace = $PSScriptRoot,
  [string]$LocalHealthUrl = "http://127.0.0.1:8093/health"
)

$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $Workspace ".cloudflared"
$logPath = Join-Path $runtimeDir "okai-docs.watchdog.log"
$startScript = Join-Path $Workspace "Start-OkaiDocsEditorPublic.ps1"
$publicHealthUrl = "https://$Hostname/health"

function Write-WatchdogLog {
  param([string]$Message)

  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Get-DotEnvValue {
  param([string]$Key)

  $envPath = Join-Path $Workspace ".env"
  if (-not (Test-Path -LiteralPath $envPath)) {
    return ""
  }

  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match "^\s*#" -or $line -notmatch "=") {
      continue
    }

    $name, $value = $line -split "=", 2
    if ($name.Trim() -eq $Key) {
      return $value.Trim()
    }
  }

  return ""
}

function Redact-Secrets {
  param([string]$Value)

  $token = Get-DotEnvValue -Key "OKD_DEMO_ACCESS_TOKEN"
  if ([string]::IsNullOrWhiteSpace($token)) {
    return $Value
  }

  return $Value.Replace($token, "<redacted>")
}

function Get-TunnelIdFromList {
  param(
    [string[]]$Lines,
    [string]$Name
  )

  foreach ($line in $Lines) {
    if ($line -match "^([0-9a-fA-F-]{36})\s+$([regex]::Escape($Name))\s") {
      return $Matches[1]
    }
  }

  return $null
}

function Resolve-TunnelId {
  param([switch]$AllowMissing)

  if (-not [string]::IsNullOrWhiteSpace($TunnelId)) {
    return $TunnelId
  }

  $dotEnvTunnelId = Get-DotEnvValue -Key "OKD_CLOUDFLARE_TUNNEL_ID"
  if (-not [string]::IsNullOrWhiteSpace($dotEnvTunnelId)) {
    return $dotEnvTunnelId
  }

  $cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
  $configPath = Join-Path $runtimeDir "no-default-config.yml"
  if (-not (Test-Path -LiteralPath $configPath)) {
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    [System.IO.File]::WriteAllText($configPath, "no-autoupdate: true`n", [System.Text.UTF8Encoding]::new($false))
  }

  $tunnelList = & $cloudflared --config $configPath tunnel list
  if ($LASTEXITCODE -ne 0) {
    throw "cloudflared tunnel list failed: $tunnelList"
  }

  $resolved = Get-TunnelIdFromList -Lines $tunnelList -Name $TunnelName
  if ([string]::IsNullOrWhiteSpace($resolved) -and -not $AllowMissing) {
    throw "Could not resolve Cloudflare tunnel id for $TunnelName. Pass -TunnelId or set OKD_CLOUDFLARE_TUNNEL_ID."
  }

  return $resolved
}

function Test-OkaiDocsTunnelProcess {
  param([string]$ResolvedTunnelId)

  if ([string]::IsNullOrWhiteSpace($ResolvedTunnelId)) {
    return $false
  }

  $escapedTunnelId = [regex]::Escape($ResolvedTunnelId)
  $process = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -ieq "cloudflared.exe" -and
      $_.CommandLine -match $escapedTunnelId -and
      $_.CommandLine -match "tunnel" -and
      $_.CommandLine -match "run"
    } |
    Select-Object -First 1

  return [bool]$process
}

function Test-HttpOk {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 $Url
    return $response.StatusCode -eq 200
  } catch {
    Write-WatchdogLog "health-failed url=$Url error=$($_.Exception.Message)"
    return $false
  }
}

if (-not (Test-Path -LiteralPath $startScript)) {
  throw "Missing start script: $startScript"
}

$resolvedTunnelId = Resolve-TunnelId -AllowMissing
$hasProcess = Test-OkaiDocsTunnelProcess -ResolvedTunnelId $resolvedTunnelId
$localOk = Test-HttpOk -Url $LocalHealthUrl
$publicOk = $false
if ($hasProcess) {
  $publicOk = Test-HttpOk -Url $publicHealthUrl
}

if ($hasProcess -and $localOk -and $publicOk) {
  Write-WatchdogLog "healthy process=true local=true public=true"
  return
}

Write-WatchdogLog "repair-start process=$hasProcess local=$localOk public=$publicOk"

try {
  & $startScript -Hostname $Hostname -TunnelName $TunnelName -NoBuild 6>$null | ForEach-Object {
    $line = $_
    Write-WatchdogLog ("start-output " + (Redact-Secrets -Value ([string]$line)))
  }
  Write-WatchdogLog "start-completed"
} catch {
  Write-WatchdogLog ("repair-failed " + (Redact-Secrets -Value $_.Exception.Message))
  throw
}

Start-Sleep -Seconds 5

$resolvedTunnelId = Resolve-TunnelId
$hasProcess = Test-OkaiDocsTunnelProcess -ResolvedTunnelId $resolvedTunnelId
$localOk = Test-HttpOk -Url $LocalHealthUrl
$publicOk = Test-HttpOk -Url $publicHealthUrl

if (-not ($hasProcess -and $localOk -and $publicOk)) {
  $message = "repair-incomplete process=$hasProcess local=$localOk public=$publicOk"
  Write-WatchdogLog $message
  throw $message
}

Write-WatchdogLog "repair-ok process=true local=true public=true"
