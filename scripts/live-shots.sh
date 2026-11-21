#!/usr/bin/env bash
# Screenshots of the dynamic live dashboard, the fleet dashboard, the fleet page and the Daily page at desktop (1280) and phone (500) width, light and dark, and an image sequence of the live page updating (register row DK1601):
#   node scripts/demo-live.ts 8811     then     scripts/live-shots.sh [port]
# The demo keeps writing records; the live page opens with the token in the address fragment (#t=demo, which the page removes at once) and polls every 2 seconds. A headless browser runs the page for a stated
# time of its own clock (--virtual-time-budget) before each picture, so the frames of the sequence are the page after 3, 6, 10, 15, 20 and 28 seconds.
set -e
OUT="docs/prototypes/dk1601"; PORT="${1:-8811}"; mkdir -p "$OUT/sequence"
BROWSER="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; [ -x "$BROWSER" ] || BROWSER="/c/Program Files/Google/Chrome/Application/chrome.exe"
shot() { # file path width height scheme(0 dark, 1 light) budget_ms
  "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --blink-settings=preferredColorScheme=$5 --virtual-time-budget=${6:-6000} --window-size="$3,$4" --screenshot="$(cygpath -w "$PWD/$OUT/$1.png")" "http://127.0.0.1:$PORT$2" >/dev/null 2>&1
}
for scheme in 0 1; do
  s=dark; [ "$scheme" = 1 ] && s=light
  shot "live-1280-$s" "/fleet/Atlas/live#t=demo" 1280 3000 $scheme 9000
  shot "live-500-$s" "/fleet/Atlas/live#t=demo" 500 5600 $scheme 9000
  shot "dashboard-1280-$s" "/fleet/Atlas/dashboard" 1280 3400 $scheme
  shot "dashboard-500-$s" "/fleet/Atlas/dashboard" 500 5200 $scheme
  shot "fleet-1280-$s" "/society/fleets/Atlas" 1280 1500 $scheme
  shot "daily-1280-$s" "/society/daily?day=2026-11-20&range=30" 1280 1500 $scheme
  shot "daily-500-$s" "/society/daily?day=2026-11-20&range=30" 500 2400 $scheme
done
n=0
for t in 3000 6000 10000 15000 20000 28000; do n=$((n+1)); shot "sequence/frame-$n-after-$((t/1000))s" "/fleet/Atlas/live#t=demo" 1280 1500 1 $t; done
ls "$OUT" "$OUT/sequence" | wc -l
