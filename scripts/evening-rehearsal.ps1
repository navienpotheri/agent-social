<#
.SYNOPSIS
  A dry rehearsal of the live run's path on this machine, with no key and no provider: read-only checks, then a governed run against a stand-in model server.

.DESCRIPTION
  Run from the repository root in Windows PowerShell or PowerShell 7:   .\scripts\evening-rehearsal.ps1
  Optional: -Clone  makes a fresh clone of this repository in a temporary folder first and runs everything there (git and network needed for npm install);
            -SkipInstall  skips npm install (the default installs only when node_modules is missing).
  It uses a throwaway ASP_HOME, a placeholder key that no provider ever sees, a stand-in server on a free local port, and (when Claude Code is installed) the real `claude` program, which talks to the stand-in.
  Steps: node and git, npm install, `asp help`, `asp live preflight --local`, a governed run (one allowed call, one refused call), `asp live report`, `asp runs`, `asp pause` / `asp resume`, `asp stop --all`.
  It changes nothing outside the throwaway folders and removes them at the end. Credits are accounting entries, not money. Exit code 0 when every step passed, 1 otherwise.
#>
param([switch]$Clone, [switch]$SkipInstall)

$ErrorActionPreference = "Continue"
$results = New-Object System.Collections.Generic.List[object]
function Step([string]$name, [bool]$ok, [string]$detail) { $results.Add([pscustomobject]@{ Step = $name; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $detail }); Write-Host ("{0,-4} {1}: {2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $detail) }

$origin = (Get-Location).Path
$repo = $origin
if ($Clone) {
  $src = (Resolve-Path "$PSScriptRoot\..").Path
  $repo = Join-Path ([System.IO.Path]::GetTempPath()) ("asp-clone-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  git clone --quiet $src $repo 2>&1 | Out-Null
  Step "fresh clone" ($LASTEXITCODE -eq 0 -and (Test-Path "$repo\package.json")) $repo
}
Set-Location $repo

$nodeV = (node --version) 2>$null
$nodeOk = $false
if ($nodeV -match "^v(\d+)\.(\d+)") { $nodeOk = ([int]$Matches[1] -gt 22) -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 18) }
Step "node 22.18 or newer" $nodeOk "$nodeV"
$gitV = (git --version) 2>$null
Step "git" ([bool]$gitV) "$gitV"

if (-not $SkipInstall -and -not (Test-Path "$repo\node_modules")) {
  npm install --no-audit --no-fund 2>&1 | Out-Null
  Step "npm install" ($LASTEXITCODE -eq 0) "exit $LASTEXITCODE"
} else { Step "npm install" (Test-Path "$repo\node_modules") "node_modules present" }

# a throwaway home, a placeholder key (never a real one), no service
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("asp-rehearsal-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force "$work\project" | Out-Null
Set-Content -Path "$work\project\a.txt" -Value "hello"
$env:ASP_HOME = "$work\home"
$env:ANTHROPIC_API_KEY = "sk-ant-rehearsal-placeholder-not-a-key-000000"
Remove-Item Env:ASP_LOG_URL -ErrorAction SilentlyContinue
Remove-Item Env:ASP_LOG_TOKEN -ErrorAction SilentlyContinue

$help = (npm run asp -- help 2>$null) -join "`n"
Step "asp help" ($LASTEXITCODE -eq 0 -and $help -match "asp") "prints the home screen"

# a free local port for the stand-in
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$stand = Start-Process -FilePath "node" -ArgumentList @("scripts\standin-anthropic.mjs", "$port") -PassThru -WindowStyle Hidden -RedirectStandardOutput "$work\standin.log" -RedirectStandardError "$work\standin.err"
for ($i = 0; $i -lt 50 -and -not ((Test-Path "$work\standin.log") -and ((Get-Content "$work\standin.log" -Raw) -match "listening")); $i++) { Start-Sleep -Milliseconds 200 }
Step "stand-in server" ((Get-Content "$work\standin.log" -Raw) -match "listening") "127.0.0.1:$port (not a provider; no key is used)"
$env:ASP_RUN_ANTHROPIC_UPSTREAM = "http://127.0.0.1:$port"

$claude = (Get-Command claude -ErrorAction SilentlyContinue)
if ($claude) { Step "claude program" $true "the real Claude Code is installed: it will talk to the stand-in" }
else {
  $env:ASP_CLAUDE_BIN = (Get-Command node).Source
  $env:ASP_CLAUDE_SCRIPT = "$repo\packages\asp-cli\test\fake-claude-rehearsal.mjs"
  $env:REHEARSAL_N = "2"
  Step "claude program" $true "Claude Code is not installed here: a stand-in program is used instead"
}

$pre = (npm run asp -- live preflight --local --model claude-haiku-5-5 --budget-usd 5 --api-key-env ANTHROPIC_API_KEY 2>$null) -join "`n"
$preOk = $pre -match "READY" -and $pre -notmatch "NOT READY"
Step "asp live preflight --local" $preOk (($pre -split "`n" | Select-String "RED|NOT READY|READY" | ForEach-Object { $_.Line.Trim() }) -join " | ")
Step "the key is not printed" (-not ($pre -match [regex]::Escape($env:ANTHROPIC_API_KEY))) "only its length is shown"

$run = (npm run asp -- run claude-code --local --project "$work\project" --prompt "List the files, then run: curl -s https://example.com" --permissions develop --budget-usd 5 2>$null) -join "`n"
Step "governed run: one call refused" ($run -match "1 refused" -and $run -match "shell\.network") "the curl call was refused with the scope shell.network"
Step "governed run: the run ended" ($run -match "finished|Session summary") "session summary printed"

$rep = (npm run asp -- live report 2>$null) -join "`n"
Step "asp live report" ($rep -match "1 allowed, 1 refused" -and $rep -match "hash chain verifies") "calls, spend and the hash chain"
$runs = (npm run asp -- runs 2>$null) -join "`n"
Step "asp runs" ($runs -match "1 refused") "the session is listed"

$p = (npm run asp -- pause 2>$null) -join "`n"
$r = (npm run asp -- resume 2>$null) -join "`n"
Step "asp pause / resume" ($p -match "paused" -and $r -match "resumed") "$($p.Trim().Split("`n")[-1])"
$st = (npm run asp -- stop --all 2>$null) -join "`n"
Step "asp stop --all" ($st -match "nothing is running|stopping") "no session is left running"

# clean up the throwaway pieces
if ($stand -and -not $stand.HasExited) { Stop-Process -Id $stand.Id -Force -ErrorAction SilentlyContinue }
Remove-Item Env:ANTHROPIC_API_KEY, Env:ASP_RUN_ANTHROPIC_UPSTREAM, Env:ASP_HOME, Env:ASP_CLAUDE_BIN, Env:ASP_CLAUDE_SCRIPT, Env:REHEARSAL_N -ErrorAction SilentlyContinue
Set-Location $origin
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
if ($Clone) { Remove-Item -Recurse -Force $repo -ErrorAction SilentlyContinue }

$failed = @($results | Where-Object { $_.Result -eq "FAIL" })
Write-Host ""
if ($failed.Count -eq 0) { Write-Host "REHEARSAL PASSED: $($results.Count) steps." ; exit 0 } else { Write-Host "REHEARSAL FAILED: $($failed.Count) of $($results.Count) steps."; exit 1 }
