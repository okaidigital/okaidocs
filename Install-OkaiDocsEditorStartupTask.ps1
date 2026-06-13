param(
  [string]$TaskName = "OkaiDocsEditorPublic",
  [string]$WatchdogTaskName = "OkaiDocsEditorPublicWatchdog",
  [string]$Workspace = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $Workspace "Start-OkaiDocsEditorPublic.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Missing startup script: $scriptPath"
}

$watchdogPath = Join-Path $Workspace "Watch-OkaiDocsEditorPublic.ps1"
if (-not (Test-Path -LiteralPath $watchdogPath)) {
  throw "Missing watchdog script: $watchdogPath"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -NoBuild" `
  -WorkingDirectory $Workspace

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

$watchdogAction = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdogPath`"" `
  -WorkingDirectory $Workspace

$watchdogLogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$watchdogIntervalTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$watchdogIntervalTrigger.Repetition.StopAtDurationEnd = $false

$watchdogSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

$watchdogTask = New-ScheduledTask `
  -Action $watchdogAction `
  -Trigger @($watchdogLogonTrigger, $watchdogIntervalTrigger) `
  -Settings $watchdogSettings `
  -Principal $principal
Register-ScheduledTask -TaskName $WatchdogTaskName -InputObject $watchdogTask -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Installed scheduled task: $WatchdogTaskName"
