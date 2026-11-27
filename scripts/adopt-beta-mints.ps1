# Adopt the 4,500 unsigned credits of the hosted beta database (register row DK95): 500 credits for each of nine accounts, signed by the owner as operator and co-signed as owner.
# No balance moves; the adoption cannot be undone (the log is append-only). Run it in the PowerShell window where ASP_LOG_URL and ASP_LOG_TOKEN (the admin token) are already set.
#
#   .\scripts\adopt-beta-mints.ps1                          finds the ASP home that holds the operator's key (by file name only) and uses it if there is exactly one
#   .\scripts\adopt-beta-mints.ps1 -AspHome C:\path\home    uses that home
#
# It never reads or prints a key, and it stops at the first failure.
param([string]$AspHome = "")
$ErrorActionPreference = "Stop"

$OP = "did:web:log.thedeeptransformation.com:u:navien-agentrun"
$dids = @(
  "did:web:thedeeptransformation.com:users:navien-test-alice",
  "did:web:thedeeptransformation.com:agents:navien-test-coder",
  "did:web:log.thedeeptransformation.com:u:navien-live",
  "did:web:log.thedeeptransformation.com:a:navien-live:my-agent",
  "did:web:log.thedeeptransformation.com:court:juror-1",
  "did:web:log.thedeeptransformation.com:court:juror-2",
  "did:web:log.thedeeptransformation.com:court:juror-3",
  "did:web:log.thedeeptransformation.com:u:navien-log",
  "did:web:log.thedeeptransformation.com:a:navien-log:my-agent"
)

if (-not $env:ASP_LOG_URL -or -not $env:ASP_LOG_TOKEN) { throw "ASP_LOG_URL and ASP_LOG_TOKEN must be set in this window first (the service address and the admin token)." }

if (-not $AspHome) {
  # Candidate homes: ~/.asp and any folder under the user's home whose name starts with asp, one level down as well. A home qualifies when its keys folder holds a file named for the operator.
  $cands = @("$HOME\.asp")
  foreach ($d in (Get-ChildItem $HOME -Directory -Filter "asp*" -ErrorAction SilentlyContinue)) {
    $cands += $d.FullName
    foreach ($s in (Get-ChildItem $d.FullName -Directory -ErrorAction SilentlyContinue)) { $cands += $s.FullName }
  }
  $found = @($cands | Where-Object { (Test-Path "$_\keys") -and (@(Get-ChildItem "$_\keys" -Filter "*agentrun*.json" -ErrorAction SilentlyContinue).Count -gt 0) } | Select-Object -Unique)
  if ($found.Count -eq 0) { "No ASP home with a key file named for navien-agentrun was found under $HOME. Tell the lead; nothing was written."; return }
  if ($found.Count -gt 1) { "More than one home holds such a key file. Run again with -AspHome and one of:"; $found | ForEach-Object { "  $_" }; return }
  $AspHome = $found[0]
}
if (-not (Test-Path "$AspHome\keys")) { throw "$AspHome has no keys folder." }
$env:ASP_HOME = $AspHome
"Signing with the ASP home: $AspHome"

foreach ($d in $dids) {
  npm run asp -- credits adopt --to $d --amount 500 --by $OP --cosign-by $OP --reason "adopt the unsigned mints of the beta database"
  if ($LASTEXITCODE -ne 0) { "STOPPED at $d. Nothing after it was run."; return }
}
npm run asp -- credits audit --require-signed
