#!/usr/bin/env bash
# Screenshots of the live dashboard, the fleet page and the Daily page with their graphs at desktop (1280) and phone (500) width, light and dark (register row DK1601):
#   node scripts/demo-live.ts 8810     then     scripts/live-shots.sh [port]
set -e
OUT="docs/prototypes/dk1601"; PORT="${1:-8810}"; mkdir -p "$OUT"
BROWSER="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; [ -x "$BROWSER" ] || BROWSER="/c/Program Files/Google/Chrome/Application/chrome.exe"
shot() { # name path width height scheme(0 dark, 1 light: the browser's own numbering)
  local s=dark; [ "$5" = 1 ] && s=light
  "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --blink-settings=preferredColorScheme=$5 --virtual-time-budget=6000 --window-size="$3,$4" --screenshot="$(cygpath -w "$PWD/$OUT/$1-$3-$s.png")" "http://127.0.0.1:$PORT$2" >/dev/null 2>&1
}
for scheme in 0 1; do
  for size in "1280 3400" "500 5200"; do set -- $size
    shot dashboard "/fleet/Atlas/dashboard" $1 $2 $scheme
  done
  for size in "1280 1500" "500 2400"; do set -- $size
    shot live "/fleet/Atlas/live" $1 700 $scheme
    shot fleet "/society/fleets/Atlas" $1 $2 $scheme
    shot daily "/society/daily?day=2026-11-20" $1 $2 $scheme
  done
done
ls "$OUT" | wc -l
