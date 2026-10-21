# Demo video prep for the Agent Social "governed agent run" recording.
# Run this in the terminal you will record, BEFORE you start recording.
# Usage:  . .\demo-video\prep.ps1        (dot-source, so the asp function stays in this shell)
param([string]$Repo = "C:\Users\Navie\agent-social\.claude\worktrees\mystifying-sinoussi-fe1ea3")

# 1. A clean "asp" command, so the screen shows `asp ...` and not a long node path.
function global:asp { node "$Repo\packages\asp-cli\bin\asp.mjs" @args }

# 2. Reset the demo project to its starting state (one file, no network use, no stray files).
$demo = "C:\Users\Navie\demo-app"
New-Item -ItemType Directory -Force $demo | Out-Null
Get-ChildItem $demo -Force | Where-Object { $_.Name -ne "app.js" } | Remove-Item -Recurse -Force
@'
// Demo project for the Agent Social video. The agent edits this file.

function add(a, b) {
  return a + b;
}

module.exports = { add };
'@ | Set-Content "$demo\app.js" -Encoding utf8

# 3. A clean, readable terminal.
function global:prompt { "> " }
$Host.UI.RawUI.WindowTitle = "Agent Social demo"
Clear-Host
Write-Host "Ready. Demo project: $demo" -ForegroundColor DarkGray
