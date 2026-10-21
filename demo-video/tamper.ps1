# Tamper demo: copy the latest run log, delete one entry from the middle, and verify the copy.
# The original log is not touched. Run after the governed run, with prep.ps1 loaded.
$home_ = if ($env:ASP_HOME) { $env:ASP_HOME } else { Join-Path $HOME ".asp" }
$runs = Join-Path $home_ "runs"
$latest = Get-ChildItem $runs -Directory | Where-Object { Test-Path (Join-Path $_.FullName "run-log.ndjson") } |
  Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $latest) { Write-Host "No run log found in $runs"; return }
$lines = Get-Content (Join-Path $latest.FullName "run-log.ndjson")
if ($lines.Count -lt 4) { Write-Host "Log too short to tamper with ($($lines.Count) entries)"; return }
$drop = [math]::Floor($lines.Count / 2)
$tampered = Join-Path $env:TEMP "tampered-run-log.ndjson"
$kept = @(); for ($i = 0; $i -lt $lines.Count; $i++) { if ($i -ne $drop) { $kept += $lines[$i] } }
$kept | Set-Content $tampered -Encoding utf8
Write-Host "Removed entry $($drop + 1) of $($lines.Count) from a copy." -ForegroundColor DarkGray
asp run-log verify $tampered
