# The owner's local log service for the live runs: a throwaway service on 127.0.0.1 (not the hosted one) with key-only sign-up, the operator and owner named, the starter pool funded and a database under
# $HOME\asp-live-local, so that `asp enrol` and `asp run claude-code` can be run for real and leave signed Action reports in a log you can read.
#   .\scripts\live-local-service.ps1            start it (or say it is running) and print the exact commands for your other window
#   .\scripts\live-local-service.ps1 -Stop      stop it
#   .\scripts\live-local-service.ps1 -Status
#   .\scripts\live-local-service.ps1 -Port 8788 -Dir D:\somewhere
# The work is in scripts\live\local-service.mjs (Node 22.18 or newer; run from the repository folder). Credits are accounting entries, not money; nothing here touches the hosted service.
param([switch]$Stop, [switch]$Status, [int]$Port = 8787, [string]$Dir = "$HOME\asp-live-local", [int]$PowBits = 12)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$verb = if ($Stop) { "stop" } elseif ($Status) { "status" } else { "start" }
node "$repo\scripts\live\local-service.mjs" $verb --dir $Dir --port $Port --pow-bits $PowBits
exit $LASTEXITCODE
