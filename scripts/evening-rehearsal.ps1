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
param([switch]$Clone, [switch]$SkipInstall, [switch]$Ladder)

$ErrorActionPreference = "Continue"
$results = New-Object System.Collections.Generic.List[object]
$ladderFlag = @(); if ($Ladder) { $ladderFlag = @("--escalation-ladder") }
# The stand-in costs nothing, so the rehearsal names a price: it measures the governed path whatever model the installed program defaults to. A model that is NOT in the gateway's price table is priced high (USD 15 in and 75 out
# per million tokens), and under a cap of USD 5 the worst case of one call then exceeds the cap and EVERY model call is refused: that is what the owner's first rehearsal showed, and the step "tonight: the model's price" below tells you
# which case you are in. Tonight's real run must name the real price of your model in the same way (docs/tonight.md, step 2).
$priceFlags = @("--price-in", "3", "--price-out", "15")
function Step([string]$name, [bool]$ok, [string]$detail) { $results.Add([pscustomobject]@{ Step = $name; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $detail }); Write-Host ("{0,-4} {1}: {2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $detail) }

function Explain([string]$what, [string]$text) { Write-Host ("     what the step saw (first lines of $what):"); (($text -split "`n") | Select-Object -First 25 | ForEach-Object { "       " + $_.TrimEnd() }) | Write-Host }

$origin = (Get-Location).Path
$repo = $origin
if ($Clone) {
  $src = (Resolve-Path "$PSScriptRoot\..").Path
  $repo = Join-Path ([System.IO.Path]::GetTempPath()) ("asp clone " + [guid]::NewGuid().ToString("N").Substring(0, 8) + "\agent social")
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
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("asp rehearsal " + [guid]::NewGuid().ToString("N").Substring(0, 8))
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

<<<<<<< HEAD
$run = (npm run asp -- run claude-code --local --project "$work\project" --prompt "List the files, then run: curl -s https://example.com" --permissions develop --budget-usd 5 $priceFlags $ladderFlag 2>$null) -join "`n"
Step "governed run: one call refused" ($run -match "(?<![0-9])1 refused" -and $run -match "shell\.network") "the curl call was refused with the scope shell.network"
if (-not ($run -match "(?<![0-9])1 refused" -and $run -match "shell\.network")) { Explain "the governed run" $run }
=======
$run = (npm run asp -- run claude-code --local --project "$work\project" --prompt "List the files, then run: curl -s https://example.com" --permissions develop --budget-usd 5 $ladderFlag 2>$null) -join "`n"
Step "governed run: one call refused" ($run -match "\b1 refused" -and $run -match "shell\.network") "the curl call was refused with the scope shell.network"
if (-not ($run -match "\b1 refused" -and $run -match "shell\.network")) { Explain "the governed run" $run }
>>>>>>> claude/protocol-ledger-3
Step "governed run: the run ended" ($run -match "finished|Session summary") "session summary printed"
if ($run -match "model\.usd|dollar cap|call could cost up to") { Write-Host "     HINT: the dollar cap refused the MODEL calls, not the curl call. A model that is not in the price table is priced high, and a cap of USD 5 then admits no call at all; name your model's real price with --price-in and --price-out (dollars per million tokens), as docs/tonight.md says." }

# Tonight's real run: which model does the installed program use, and does the gateway know its price?
$modelSeen = $null
$logPath = [regex]::Match($run, "run log\s+(.+?run-log\.ndjson)").Groups[1].Value
if ($logPath -and (Test-Path -LiteralPath $logPath)) {
  $mr = Get-Content -LiteralPath $logPath | Where-Object { $_ -match '"kind":"model_request"' } | Select-Object -First 1
  if ($mr) { $modelSeen = [regex]::Match($mr, '"model":"([^"]+)"').Groups[1].Value }
}
if ($modelSeen) {
  $pc = (npm run asp -- live preflight --local --model $modelSeen --budget-usd 5 --api-key-env ANTHROPIC_API_KEY 2>$null) -join "`n"
  $capLine = (($pc -split "`n" | Select-String "the budget cap" | Select-Object -First 1).Line)
  if ($capLine) { $capLine = $capLine.Trim() }
  $unpriced = $capLine -match "not in the price table"
  Step "tonight: the model's price (information)" $true ("the program's default model is $modelSeen; " + $(if ($unpriced) { "it is NOT in the gateway's price table: tonight name its real price with --price-in and --price-out, or a cap of USD 5 will refuse every call" } else { "it is in the price table: no price flags are needed" }))
} else { Step "tonight: the model's price (information)" $true "no model request was seen in the run log (a stand-in program was used, or the run did not reach the model)" }

$rep = (npm run asp -- live report 2>$null) -join "`n"
<<<<<<< HEAD
Step "asp live report" ($rep -match "(?<![0-9])1 allowed, 1 refused" -and $rep -match "hash chain verifies") "calls, spend and the hash chain"
if (-not ($rep -match "(?<![0-9])1 allowed, 1 refused" -and $rep -match "hash chain verifies")) { Explain "asp live report" $rep }
$runs = (npm run asp -- runs 2>$null) -join "`n"
Step "asp runs" ($runs -match "(?<![0-9])1 refused") "the session is listed"
=======
Step "asp live report" ($rep -match "\b1 allowed, 1 refused" -and $rep -match "hash chain verifies") "calls, spend and the hash chain"
if (-not ($rep -match "\b1 allowed, 1 refused" -and $rep -match "hash chain verifies")) { Explain "asp live report" $rep }
$runs = (npm run asp -- runs 2>$null) -join "`n"
Step "asp runs" ($runs -match "\b1 refused") "the session is listed"
>>>>>>> claude/protocol-ledger-3

$p = (npm run asp -- pause 2>$null) -join "`n"
$r = (npm run asp -- resume 2>$null) -join "`n"
Step "asp pause / resume" ($p -match "paused" -and $r -match "resumed") "$($p.Trim().Split("`n")[-1])"
$st = (npm run asp -- stop --all 2>$null) -join "`n"
Step "asp stop --all" ($st -match "nothing is running|stopping") "no session is left running"

# Codex, when it is installed: the same governed run on the OpenAI wire (Responses API), against a stand-in that needs no key
$skipped = @()
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) { Start-Sleep -Seconds 2; $codex = Get-Command codex -ErrorAction SilentlyContinue }  # one retry: a PATH lookup that fails once is not proof that Codex is missing
if ($codex) {
  $l2 = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0); $l2.Start(); $port2 = $l2.LocalEndpoint.Port; $l2.Stop()
  $stand2 = Start-Process -FilePath "node" -ArgumentList @("scripts\standin-openai.mjs", "$port2") -PassThru -WindowStyle Hidden -RedirectStandardOutput "$work\standin2.log" -RedirectStandardError "$work\standin2.err"
  for ($i = 0; $i -lt 50 -and -not ((Test-Path "$work\standin2.log") -and ((Get-Content "$work\standin2.log" -Raw) -match "listening")); $i++) { Start-Sleep -Milliseconds 200 }
  $env:ASP_RUN_OPENAI_UPSTREAM = "http://127.0.0.1:$port2/v1"
  $env:OPENAI_API_KEY = "sk-rehearsal-placeholder-not-a-key-000000"
<<<<<<< HEAD
  $cx = (npm run asp -- run codex --local --project "$work\project" --prompt "List the files, then run: curl -s https://example.com" --budget-usd 5 $priceFlags $ladderFlag 2>$null) -join "`n"
  Step "codex: governed run, one call refused" ($cx -match "(?<![0-9])1 refused" -and $cx -match "shell\.network") "the real Codex ran against the stand-in; its curl call was refused"
=======
  $cx = (npm run asp -- run codex --local --project "$work\project" --prompt "List the files, then run: curl -s https://example.com" --budget-usd 5 $ladderFlag 2>$null) -join "`n"
  Step "codex: governed run, one call refused" ($cx -match "\b1 refused" -and $cx -match "shell\.network") "the real Codex ran against the stand-in; its curl call was refused"
>>>>>>> claude/protocol-ledger-3
  if ($stand2 -and -not $stand2.HasExited) { Stop-Process -Id $stand2.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:OPENAI_API_KEY, Env:ASP_RUN_OPENAI_UPSTREAM -ErrorAction SilentlyContinue
} else { $skipped += "codex"; Write-Host "SKIP codex: not installed here (PATH: $($env:PATH.Split([IO.Path]::PathSeparator).Count) entries)" }

# clean up the throwaway pieces
if ($stand -and -not $stand.HasExited) { Stop-Process -Id $stand.Id -Force -ErrorAction SilentlyContinue }
Remove-Item Env:ANTHROPIC_API_KEY, Env:ASP_RUN_ANTHROPIC_UPSTREAM, Env:ASP_HOME, Env:ASP_CLAUDE_BIN, Env:ASP_CLAUDE_SCRIPT, Env:REHEARSAL_N -ErrorAction SilentlyContinue
Set-Location $origin
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
if ($Clone) { Remove-Item -Recurse -Force $repo -ErrorAction SilentlyContinue }

$failed = @($results | Where-Object { $_.Result -eq "FAIL" })
Write-Host ""
if ($failed.Count -eq 0) { Write-Host "REHEARSAL PASSED: $($results.Count) steps.$(if ($skipped.Count) { " SKIPPED: $($skipped -join ", ") (a run with the real program installed is 15 steps; fewer means a step did not run)" })" ; exit 0 } else { Write-Host "REHEARSAL FAILED: $($failed.Count) of $($results.Count) steps."; exit 1 }
