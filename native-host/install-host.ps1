# OPTIONAL. Lets Topic Tree save every session to disk (%LOCALAPPDATA%\TopicTree\sessions).
# Needs Python 3. Registers for the current user only (no admin) in Brave and Chrome.
# Usage: right-click > Run with PowerShell, or:
#   powershell -ExecutionPolicy Bypass -File install-host.ps1
$ErrorActionPreference = 'Stop'
$name = 'com.ronald.topictree'
$here = $PSScriptRoot

# The extension's fixed id (pinned by the public key in static/key.json)
$id = 'lonhgbkiohfncnfgnhkbnbbgfchkeljc'
$keyFile = Join-Path $here '..\static\key.json'
if (Test-Path $keyFile) { $id = (Get-Content $keyFile -Raw | ConvertFrom-Json).id }

# Find a real Python 3. Windows ships a "python" shortcut that only opens the
# Microsoft Store, so check that it actually runs.
$python = $null
foreach ($candidate in @('python', 'py')) {
  $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
  if (-not $cmd) { continue }
  try {
    $exe = & $cmd.Source -c "import sys; print(sys.executable if sys.version_info[0] == 3 else '')" 2>$null
    if ($LASTEXITCODE -eq 0 -and $exe) { $python = $exe.Trim(); break }
  } catch { }
}
if (-not $python) {
  Write-Host ''
  Write-Host 'Python 3 was not found.' -ForegroundColor Yellow
  Write-Host 'Saving to disk is optional: Topic Tree works without it.'
  Write-Host 'To enable it, install Python 3 from https://www.python.org/downloads/'
  Write-Host '(tick "Add python.exe to PATH" during setup), then run this script again.'
  exit 1
}

# The browser launches the host through this wrapper; native hosts get no console window
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

foreach ($browser in @('BraveSoftware\Brave-Browser', 'Google\Chrome')) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\$name"
  New-Item -Force $key | Out-Null
  Set-Item $key $manifest
  Write-Host "registered for $browser"
}
Write-Host "python: $python"
Write-Host "data:   $(Join-Path $env:LOCALAPPDATA 'TopicTree\sessions')"
Write-Host 'Done. Reload the extension; Settings (gear) should say "Saving to disk: connected".'
