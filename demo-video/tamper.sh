# Tamper demo (Git Bash): copy the latest run log, delete one entry from the middle, verify the copy.
# The original log is not touched. Run after the governed run, with prep.sh loaded:   source demo-video/tamper.sh
runs="${ASP_HOME:-$HOME/.asp}/runs"
latest=$(ls -td "$runs"/*/ 2>/dev/null | while read -r d; do [ -f "${d}run-log.ndjson" ] && echo "$d" && break; done)
if [ -z "$latest" ]; then echo "No run log found in $runs"; return 0 2>/dev/null || exit 0; fi
total=$(wc -l < "${latest}run-log.ndjson")
if [ "$total" -lt 4 ]; then echo "Log too short to tamper with ($total entries)"; return 0 2>/dev/null || exit 0; fi
drop=$(( total / 2 + 1 ))
tampered="${TMPDIR:-/tmp}/tampered-run-log.ndjson"
sed "${drop}d" "${latest}run-log.ndjson" > "$tampered"
echo "Removed entry $drop of $total from a copy."
asp run-log verify "$tampered"
