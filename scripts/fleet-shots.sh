#!/usr/bin/env bash
# Screenshots of the fleet pages and marks at desktop (1280) and phone (500) width, light and dark (register row DK1367):
#   node scripts/demo-pages.ts 8801 --fleets      (in one terminal)
#   scripts/fleet-shots.sh [port]                  (in another; needs Edge or Chrome)
set -e
OUT="docs/prototypes/dk1367"; PORT="${1:-8801}"; mkdir -p "$OUT"
BROWSER="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; [ -x "$BROWSER" ] || BROWSER="/c/Program Files/Google/Chrome/Application/chrome.exe"
FLEET="did%3Aweb%3Aexample.com%3Afleets%3Apayments"
shot() { # name path width height scheme(0 dark, 1 light: the browser's own numbering)
  local s=dark; [ "$5" = 1 ] && s=light
  "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --blink-settings=preferredColorScheme=$5 --virtual-time-budget=6000 --window-size="$3,$4" --screenshot="$(cygpath -w "$PWD/$OUT/$1-$3-$s.png")" "http://127.0.0.1:$PORT$2" >/dev/null 2>&1
}
for scheme in 0 1; do
for size in "1280 1400" "500 2000"; do set -- $size
  W=$1; H=$2
  shot fleets "/society/fleets" $W $H $scheme
  shot fleet "/society/fleets/$FLEET" $W $H $scheme
  shot journey-member "/agent/payments-lead/journey" $W $H $scheme
  shot leaderboards-fleet "/society/leaderboards?week=2026-10-26&fleet=$FLEET" $W $H $scheme
  shot map "/society/map" $W $H $scheme
done; done
ls "$OUT" | wc -l
