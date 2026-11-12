<#
  Runs one worker agent on the owner's own API key (pay per token), on its own branch and worktree, with a hard spending cap.
  The key is read from the ANTHROPIC_API_KEY environment variable and is never printed or written anywhere by this script.

  .\scripts\run-worker.ps1 -Name society -Brief docs\worker-briefs\society.md -BudgetUsd 5 [-Model sonnet] [-Base claude/open-forum]

  Output goes to <worktree>\worker.log. The worker commits on its own branch and does not push; the lead reviews and merges.
#>
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$Brief,
  [Parameter(Mandatory = $true)][double]$BudgetUsd,
  [string]$Model = "sonnet",
  [string]$Base = "claude/open-forum"
)
$ErrorActionPreference = "Stop"
if (-not $env:ANTHROPIC_API_KEY) { throw "ANTHROPIC_API_KEY is not set in this terminal. Set it here (Read-Host -MaskInput), not in a file or in chat." }
if ($Name -notmatch '^[a-z0-9-]{2,24}$') { throw "-Name is lowercase letters, digits and dashes, 2 to 24 characters" }
if ($BudgetUsd -le 0 -or $BudgetUsd -gt 100) { throw "-BudgetUsd is above 0 and at most 100 for one run" }
$root = (git rev-parse --show-toplevel).Trim()
$briefPath = Resolve-Path (Join-Path $root $Brief)
$branch = "claude/worker-$Name-$((Get-Date).ToString('MMdd-HHmm'))"
$tree = Join-Path (Split-Path $root -Parent) "worker-$Name-$((Get-Date).ToString('MMdd-HHmm'))"
git -C $root worktree add -b $branch $tree $Base | Out-Null
Push-Location $tree
try {
  npm install --no-audit --no-fund | Out-Null
  $prompt = (Get-Content $briefPath -Raw) + "`n`nYou are on branch $branch in $tree. Do not push. Finish with the report described in docs/worker-briefs/README.md."
  $promptFile = Join-Path $tree "worker-prompt.txt"
  Set-Content -Path $promptFile -Value $prompt -Encoding UTF8
  $log = Join-Path $tree "worker.log"
  Write-Host "worker '$Name' on $branch (model $Model, budget cap `$$BudgetUsd); log: $log"
  # Run through cmd so a notice on stderr is written to the log and not treated as a PowerShell error.
  cmd /c "claude -p --model $Model --max-budget-usd $BudgetUsd --allowedTools Bash,Read,Write,Edit,Glob,Grep --permission-mode acceptEdits < ""$promptFile"" >> ""$log"" 2>&1"
  Remove-Item $promptFile -ErrorAction SilentlyContinue
  Write-Host "worker '$Name' finished (exit $LASTEXITCODE); commits are on $branch; read $log"
} finally { Pop-Location }
