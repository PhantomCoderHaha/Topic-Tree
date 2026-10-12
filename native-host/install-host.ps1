# Registers the Topic Tree native messaging host for Brave (current user only, no admin).
# Usage: powershell -ExecutionPolicy Bypass -File native-host\install-host.ps1
$ErrorActionPreference = 'Stop'
$name = 'com.ronald.topictree'
$here = $PSScriptRoot
$id = (Get-Content (Join-Path $here '..\static\key.json') -Raw | ConvertFrom-Json).id
$python = (Get-Command python -ErrorAction Stop).Source

# Brave launches the host through this wrapper; native hosts get no console window
$dir = Join-Path $env:LOCALAPPDATA 'TopicTree\host'
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item (Join-Path $here 'topic_tree_host.py') $dir -Force
$bat = Join-Path $dir 'topic_tree_host.bat'
Set-Content -Encoding ascii $bat "@echo off`r`n`"$python`" -u `"%~dp0topic_tree_host.py`" %*"

$manifest = Join-Path $dir "$name.json"
@{
  name            = $name
  description     = 'Topic Tree: mirrors event logs to disk'
  path            = $bat
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$id/")
} | ConvertTo-Json | ForEach-Object {
  # no BOM: Windows PowerShell's utf8 adds one, and the browser's JSON parser rejects it
  [IO.File]::WriteAllText($manifest, $_, (New-Object Text.UTF8Encoding $false))
}

foreach ($browser in @('BraveSoftware\Brave-Browser')) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\$name"
  New-Item -Force $key | Out-Null
  Set-Item $key $manifest
  Write-Host "registered for $browser"
}
Write-Host "host: $bat"
Write-Host "data: $(Join-Path $env:LOCALAPPDATA 'TopicTree\sessions')"
