#!/usr/bin/env bash
# Screenshots of the beta pages at desktop (1280) and phone (500, the narrowest a headless browser lays out; 390 is checked by hand in a browser pane) width, light and dark (register row DK1348):
#   scripts/page-shots.sh <before|after> [port]
# Needs the demo server (node scripts/demo-pages.ts) and Edge or Chrome.
set -e
OUT="docs/prototypes/dk1348/$1"; PORT="${2:-8799}"; mkdir -p "$OUT"
BROWSER="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; [ -x "$BROWSER" ] || BROWSER="/c/Program Files/Google/Chrome/Application/chrome.exe"
shot() { # name path width height scheme(0 dark, 1 light: the browser's own numbering)
  local s=dark; [ "$5" = 1 ] && s=light
  "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --blink-settings=preferredColorScheme=$5 --virtual-time-budget=6000 --window-size="$3,$4" --screenshot="$(cygpath -w "$PWD/$OUT/$1-$3-$s.png")" "http://127.0.0.1:$PORT$2" >/dev/null 2>&1
}
for scheme in 0 1; do
for size in "1280 1400" "500 2200"; do set -- $size
  W=$1; H=$2
  shot journey "/agent/reviewer-rhea/journey" $W $H $scheme
  shot daily "/society/daily?day=2026-11-01" $W $H $scheme
  shot leaderboards "/society/leaderboards?week=2026-10-26" $W $H $scheme
  shot cohort "/society/cohorts/demo" $W $H $scheme
  shot courses "/society/courses" $W $H $scheme
  shot map "/society/map" $W $H $scheme
done; done
ls "$OUT" | wc -l
