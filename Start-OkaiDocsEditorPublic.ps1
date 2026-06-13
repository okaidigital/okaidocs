param(
  [string]$Hostname = "docs.okai.com.br",
  [string]$TunnelName = "okai-docs",
  [string]$LocalUrl = "http://localhost:8093",
  [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

function New-UrlSafeToken {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }

  return ([Convert]::ToBase64String($bytes).TrimEnd("=") -replace "\+", "-" -replace "/", "_")
}

function Read-DotEnv {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*#" -or $line -notmatch "=") {
      continue
    }

    $key, $value = $line -split "=", 2
    $values[$key.Trim()] = $value.Trim()
  }

  return $values
}

function Set-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )

  $lines = @()
  if (Test-Path -LiteralPath $Path) {
    $lines = @(Get-Content -LiteralPath $Path)
  }

  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match "^\s*$([regex]::Escape($Key))=") {
      $found = $true
      "$Key=$Value"
    } else {
      $line
    }
  }

  if (-not $found) {
    $updated += "$Key=$Value"
  }

  $encoding = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllLines((Resolve-Path -LiteralPath $Path), [string[]]$updated, $encoding)
}

function Ensure-DotEnvValue {
  param(
    [string]$Path,
    [hashtable]$Values,
    [string]$Key,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Values[$Key])) {
    Set-DotEnvValue -Path $Path -Key $Key -Value $Value
    $Values[$Key] = $Value
  }

  return $Values[$Key]
}

$envPath = Join-Path $PSScriptRoot ".env"
$values = Read-DotEnv -Path $envPath
$publicUrl = "https://$Hostname"
$accessParam = Ensure-DotEnvValue -Path $envPath -Values $values -Key "OKD_DEMO_ACCESS_PARAM" -Value "okd_access"
$accessToken = Ensure-DotEnvValue -Path $envPath -Values $values -Key "OKD_DEMO_ACCESS_TOKEN" -Value (New-UrlSafeToken)
Ensure-DotEnvValue -Path $envPath -Values $values -Key "OKD_PUBLIC_EDITOR_URL" -Value $publicUrl | Out-Null

if ($NoBuild) {
  & (Join-Path $PSScriptRoot "Start-OkaiDocsEditorLocal.ps1")
} else {
  & (Join-Path $PSScriptRoot "Start-OkaiDocsEditorLocal.ps1") -Build
}

& (Join-Path $PSScriptRoot "Test-OkaiDocsEditorPublicAuth.ps1") `
  -Hostname $Hostname `
  -LocalUrl $LocalUrl `
  -EnvPath $envPath `
  -AccessParam $accessParam `
  -AccessToken $accessToken

$cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
$runtimeDir = Join-Path $PSScriptRoot ".cloudflared"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$logPath = Join-Path $runtimeDir "$TunnelName.log"
$pidPath = Join-Path $runtimeDir "$TunnelName.pid"
$configPath = Join-Path $runtimeDir "no-default-config.yml"
if (-not (Test-Path -LiteralPath $configPath)) {
  [System.IO.File]::WriteAllText($configPath, "no-autoupdate: true`n", [System.Text.UTF8Encoding]::new($false))
}
$tunnelArgs = @("--config", $configPath, "tunnel", "--logfile", $logPath, "--loglevel", "info")

$tunnelList = & $cloudflared @tunnelArgs list
if ($LASTEXITCODE -ne 0) {
  throw "cloudflared tunnel list failed: $tunnelList"
}

function Get-TunnelId {
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

$tunnelId = Get-TunnelId -Lines $tunnelList -Name $TunnelName
if (-not $tunnelId) {
  & $cloudflared @tunnelArgs create $TunnelName
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create Cloudflare tunnel $TunnelName."
  }
  $tunnelList = & $cloudflared @tunnelArgs list
  $tunnelId = Get-TunnelId -Lines $tunnelList -Name $TunnelName
  if (-not $tunnelId) {
    throw "Could not resolve Cloudflare tunnel id for $TunnelName."
  }
}

& $cloudflared @tunnelArgs route dns --overwrite-dns $tunnelId $Hostname
if ($LASTEXITCODE -ne 0) {
  throw "Could not route $Hostname to Cloudflare tunnel $TunnelName."
}

$alreadyRunning = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -match "cloudflared" -and
    $_.CommandLine -match "tunnel" -and
    $_.CommandLine -match "run" -and
    $_.CommandLine -match [regex]::Escape($tunnelId)
  } |
  Select-Object -First 1

if (-not $alreadyRunning) {
  $args = @(
    "--config",
    $configPath,
    "tunnel",
    "--logfile", $logPath,
    "--loglevel", "info",
    "--pidfile", $pidPath,
    "run",
    "--url", $LocalUrl,
    $tunnelId
  )
  Start-Process -FilePath $cloudflared -ArgumentList $args -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 5
}

try {
  $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "$publicUrl/health"
  if ($health.StatusCode -ne 200) {
    Write-Warning "Public health check returned HTTP $($health.StatusCode)."
  }
} catch {
  $response = $_.Exception.Response
  $mitigated = $response -and $response.Headers["Cf-Mitigated"]
  if ($mitigated) {
    Write-Warning "Cloudflare returned a browser challenge for /health. The tunnel is up, but this challenge response sends iframe-blocking security headers. Bypass Cloudflare challenges for the editor host/routes before embedding it in the Okai app."
  } else {
    throw
  }
}

Write-Host "Okai Docs editor publico pronto:"
Write-Host "  $publicUrl/word?$accessParam=$accessToken"
Write-Host "  $publicUrl/excel?$accessParam=$accessToken"
Write-Host "  $publicUrl/pdf-readonly?$accessParam=$accessToken"
