#!/usr/bin/env bash
# Screenshots of the fleet dashboard at desktop (1280) and phone (500) width, light and dark (register row DK1361):
#   node scripts/demo-pages.ts 8802 --fleets    then    scripts/dashboard-shots.sh [port]
set -e
OUT="docs/prototypes/dk1361"; PORT="${1:-8802}"; mkdir -p "$OUT"
BROWSER="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; [ -x "$BROWSER" ] || BROWSER="/c/Program Files/Google/Chrome/Application/chrome.exe"
for scheme in 0 1; do
  s=dark; [ "$scheme" = 1 ] && s=light
  for size in "1280 1500" "500 2400"; do set -- $size
    "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --blink-settings=preferredColorScheme=$scheme --virtual-time-budget=6000 --window-size="$1,$2" --screenshot="$(cygpath -w "$PWD/$OUT/dashboard-$1-$s.png")" "http://127.0.0.1:$PORT/fleet/Payments/dashboard" >/dev/null 2>&1
  done
done
ls "$OUT" | wc -l
