param(
  [string]$Hostname = "docs.okai.com.br",
  [string]$LocalUrl = "http://localhost:8093",
  [string]$EnvPath = (Join-Path $PSScriptRoot ".env"),
  [string]$AccessParam = "",
  [string]$AccessToken = "",
  [string]$AccessCookie = "",
  [string]$FrameAncestors = "'self' http://localhost:* https://localhost:* https://okai.com.br https://app.okai.com.br https://www.okai.com.br https://okaiedgeqa.azurewebsites.net https://okaiedge.azurewebsites.net"
)

$ErrorActionPreference = "Stop"

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

function Assert-Contains {
  param(
    [string]$Value,
    [string]$Pattern,
    [string]$Message
  )

  if ($Value -notmatch $Pattern) {
    throw $Message
  }
}

function Assert-FrameHeaders {
  param(
    [string[]]$Headers,
    [string]$Route,
    [string]$ExpectedFrameAncestors
  )

  $statusLine = ($Headers | Select-Object -First 1)
  Assert-Contains -Value $statusLine -Pattern "^HTTP/\S+\s+200\b" `
    -Message "Expected $Route to return 200, got: $statusLine"

  $xFrame = ($Headers | Where-Object { $_ -match "^X-Frame-Options:" } | Select-Object -First 1)
  if (-not [string]::IsNullOrWhiteSpace($xFrame)) {
    throw "Expected $Route not to send X-Frame-Options."
  }

  $csp = ($Headers | Where-Object { $_ -match "^Content-Security-Policy:" } | Select-Object -First 1)
  if ([string]::IsNullOrWhiteSpace($csp)) {
    throw "Expected $Route to send Content-Security-Policy."
  }

  Assert-Contains -Value $csp -Pattern "(?i)\bframe-ancestors\b" `
    -Message "Expected $Route CSP to include frame-ancestors."
  Assert-Contains -Value $csp -Pattern ([regex]::Escape($ExpectedFrameAncestors)) `
    -Message "Expected $Route CSP frame-ancestors to match the configured trusted origins."
}

$values = Read-DotEnv -Path $EnvPath
if ([string]::IsNullOrWhiteSpace($AccessParam)) {
  $AccessParam = if ($values["OKD_DEMO_ACCESS_PARAM"]) { $values["OKD_DEMO_ACCESS_PARAM"] } else { "okd_access" }
}

if ([string]::IsNullOrWhiteSpace($AccessToken)) {
  $AccessToken = $values["OKD_DEMO_ACCESS_TOKEN"]
}

if ([string]::IsNullOrWhiteSpace($AccessCookie)) {
  $AccessCookie = if ($values["OKD_DEMO_ACCESS_COOKIE"]) { $values["OKD_DEMO_ACCESS_COOKIE"] } else { "okd_demo_access" }
}

if ([string]::IsNullOrWhiteSpace($AccessToken)) {
  throw "OKD_DEMO_ACCESS_TOKEN is required for the public auth smoke test."
}

$curl = (Get-Command curl.exe -ErrorAction Stop).Source
$testUrl = "$($LocalUrl.TrimEnd('/'))/word?$AccessParam=$AccessToken"
$response = & $curl -i -s -o - -H "Host: $Hostname" -H "X-Forwarded-Proto: https" $testUrl
if ($LASTEXITCODE -ne 0) {
  throw "Public auth smoke test could not reach $LocalUrl."
}

$text = ($response -join "`n")
$statusLine = ($response | Select-Object -First 1)
$setCookie = ($response | Where-Object { $_ -match "^Set-Cookie:" } | Select-Object -First 1)
$location = ($response | Where-Object { $_ -match "^Location:" } | Select-Object -First 1)

Assert-Contains -Value $statusLine -Pattern "^HTTP/\S+\s+302\b" `
  -Message "Expected the public auth request to return 302, got: $statusLine"

if ([string]::IsNullOrWhiteSpace($setCookie)) {
  throw "Expected the public auth request to set the access cookie."
}

Assert-Contains -Value $setCookie -Pattern "^Set-Cookie:\s*$([regex]::Escape($AccessCookie))=" `
  -Message "Expected Set-Cookie to use $AccessCookie."
Assert-Contains -Value $setCookie -Pattern "(?i);\s*Path=/" `
  -Message "Expected auth cookie Path=/."
Assert-Contains -Value $setCookie -Pattern "(?i);\s*HttpOnly\b" `
  -Message "Expected auth cookie HttpOnly."
Assert-Contains -Value $setCookie -Pattern "(?i);\s*SameSite=None\b" `
  -Message "Expected auth cookie SameSite=None for iframe embeds."
Assert-Contains -Value $setCookie -Pattern "(?i);\s*Secure\b" `
  -Message "Expected auth cookie Secure for public HTTPS embeds."

if ([string]::IsNullOrWhiteSpace($location)) {
  throw "Expected the public auth request to redirect after consuming the token."
}

Assert-Contains -Value $location -Pattern "^Location:\s*/word\s*$" `
  -Message "Expected token redirect to clean /word, got: $location"

if ($text -match [regex]::Escape($AccessToken)) {
  throw "Access token leaked in the auth redirect response."
}

$cookiePair = (($setCookie -replace "^Set-Cookie:\s*", "") -split ";", 2)[0]
if ([string]::IsNullOrWhiteSpace($cookiePair)) {
  throw "Could not parse the public auth cookie."
}

foreach ($route in @("/word", "/excel", "/pdf-readonly")) {
  $headers = & $curl -I -s -o - `
    -H "Host: $Hostname" `
    -H "X-Forwarded-Proto: https" `
    -H "Cookie: $cookiePair" `
    "$($LocalUrl.TrimEnd('/'))$route`?test=1"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not validate frame headers for $route."
  }

  Assert-FrameHeaders -Headers $headers -Route $route -ExpectedFrameAncestors $FrameAncestors
}

Write-Host "Okai Docs public auth smoke test passed."
