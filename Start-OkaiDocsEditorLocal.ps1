param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"

$composeWindows = Join-Path $PSScriptRoot "docker-compose.yml"
$composeWsl = ((& wsl.exe -e wslpath -a $composeWindows) -join "`n").Trim()

$keepalive = ((& wsl.exe -e bash -lc "pgrep -af '^okai-docs-wsl-keepalive ' || true") -join "`n").Trim()
if (-not $keepalive) {
  Start-Process `
    -FilePath "wsl.exe" `
    -ArgumentList '-e bash -lc "exec -a okai-docs-wsl-keepalive sleep infinity"' `
    -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

if ($Build) {
  & wsl.exe -e bash -lc "docker compose -f '$composeWsl' build"
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose build falhou."
  }
}

& wsl.exe -e bash -lc "docker compose -f '$composeWsl' up -d --remove-orphans"
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up falhou."
}

for ($i = 0; $i -lt 60; $i++) {
  try {
    $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://localhost:8093/health"
    $api = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://localhost:8093/web-apps/apps/api/documents/api.js"
    if ($health.StatusCode -eq 200 -and $api.StatusCode -eq 200) {
      Write-Host "Okai Docs editor demo local pronto:"
      Write-Host "  http://localhost:8093/"
      Write-Host "  http://localhost:8093/word"
      Write-Host "  http://localhost:8093/excel"
      Write-Host "  http://localhost:8093/pdf-readonly"
      Write-Host "  http://localhost:8093/?kind=cell"
      Write-Host "  http://localhost:8093/?kind=pdf-edit"
      Write-Host "  http://localhost:8093/?kind=pdf-comment"
      return
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

throw "Okai Docs editor local nao ficou pronto dentro do tempo esperado."
