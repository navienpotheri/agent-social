<#
.SYNOPSIS
  Puts the API key that is on YOUR clipboard into an environment variable of THIS window only, then clears the clipboard.

.DESCRIPTION
  Run it yourself, in your own PowerShell window, before the live run:

      .\scripts\live-key.ps1                       # Anthropic key into ANTHROPIC_API_KEY
      .\scripts\live-key.ps1 -Var OPENAI_API_KEY   # an OpenAI key into OPENAI_API_KEY

  The key is never printed, never written to a file and never sent anywhere: only its length is shown. The variable lives in this window's process and ends when you close the window.
  Nobody else should run this script for you: it reads your clipboard.
#>
param([string]$Var = "ANTHROPIC_API_KEY")

if ($Var -notmatch '^[A-Z][A-Z0-9_]*$') { Write-Host "FAIL  the variable name must be capital letters, digits and underscores, for example ANTHROPIC_API_KEY."; return }
$raw = Get-Clipboard -Raw
if ($null -eq $raw) { Write-Host "FAIL  the clipboard is empty: copy the key again, then run this."; return }
$key = ($raw -replace '\s', '')
if ($key.Length -lt 40) { Write-Host "FAIL  what is on the clipboard does not look like an API key (too short; its length is $($key.Length)). Nothing was set."; return }
if ($raw.Trim() -ne $key) { Write-Host "FAIL  the clipboard holds more than one word or line, so it is not a single key. Nothing was set."; return }

Set-Item -Path "Env:$Var" -Value $key
Set-Clipboard -Value " "
Write-Host "PASS  $Var is set for this window only (length $($key.Length)); the clipboard is cleared. Nothing was printed or saved."
$key = $null; $raw = $null
