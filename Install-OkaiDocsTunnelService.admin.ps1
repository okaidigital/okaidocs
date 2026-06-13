param(
  [string]$ServiceName = "OkaiDocsCloudflared",
  [string]$Hostname = "docs.okai.com.br",
  [string]$TunnelName = "okai-docs",
  [string]$TunnelId = $env:OKD_CLOUDFLARE_TUNNEL_ID,
  [string]$EnvPath = (Join-Path $PSScriptRoot ".env"),
  [string]$LocalUrl = "http://localhost:8093"
)

$ErrorActionPreference = "Stop"

$cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return ""
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
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
  param(
    [string]$ExplicitTunnelId,
    [string]$Name
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitTunnelId)) {
    return $ExplicitTunnelId
  }

  $tunnelList = & $cloudflared tunnel list
  if ($LASTEXITCODE -ne 0) {
    throw "cloudflared tunnel list failed: $tunnelList"
  }

  $resolved = Get-TunnelIdFromList -Lines $tunnelList -Name $Name
  if ([string]::IsNullOrWhiteSpace($resolved)) {
    throw "Could not resolve Cloudflare tunnel id for $Name. Pass -TunnelId or set OKD_CLOUDFLARE_TUNNEL_ID."
  }

  return $resolved
}

if ([string]::IsNullOrWhiteSpace($TunnelId)) {
  $TunnelId = Get-DotEnvValue -Path $EnvPath -Key "OKD_CLOUDFLARE_TUNNEL_ID"
}

$TunnelId = Resolve-TunnelId -ExplicitTunnelId $TunnelId -Name $TunnelName
$programDataDir = "C:\ProgramData\OkaiDocs\cloudflared"
$sourceCred = Join-Path $env:USERPROFILE ".cloudflared\$TunnelId.json"
$destCred = Join-Path $programDataDir "$TunnelId.json"
$configPath = Join-Path $programDataDir "okai-docs.yml"
$logPath = Join-Path $programDataDir "okai-docs.log"

if (-not (Test-Path -LiteralPath $sourceCred)) {
  throw "Missing tunnel credentials: $sourceCred"
}

New-Item -ItemType Directory -Force -Path $programDataDir | Out-Null
Copy-Item -LiteralPath $sourceCred -Destination $destCred -Force

@"
tunnel: $TunnelId
credentials-file: $destCred
logfile: $logPath
loglevel: info
ingress:
  - hostname: $Hostname
    service: $LocalUrl
    originRequest:
      httpHostHeader: $Hostname
  - service: http_status:404
"@ | Set-Content -LiteralPath $configPath -Encoding ascii

$binPath = '"' + $cloudflared + '" --config "' + $configPath + '" tunnel run'
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  & sc.exe stop $ServiceName | Out-Null
  Start-Sleep -Seconds 2
  & sc.exe config $ServiceName binPath= $binPath start= auto DisplayName= "Okai Docs Cloudflare Tunnel"
} else {
  & sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "Okai Docs Cloudflare Tunnel"
}

if ($LASTEXITCODE -ne 0) {
  throw "Could not create/configure $ServiceName service."
}

& sc.exe config $ServiceName start= delayed-auto | Out-Null
& sc.exe failure $ServiceName reset= 60 actions= restart/5000/restart/30000/restart/60000 | Out-Null
& sc.exe failureflag $ServiceName 1 | Out-Null
& sc.exe start $ServiceName | Out-Null

Write-Host "Installed service: $ServiceName"
