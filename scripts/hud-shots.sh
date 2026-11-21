#!/usr/bin/env bash
# Screenshots of the fleet HUD and a recorded image sequence of its replay (register row DK1601), at desktop (1280) and phone (500) width, dark and light:
#   node scripts/demo-live.ts 8811     then     scripts/hud-shots.sh [port]
# The page opens in replay with the token in the address fragment (#t=demo, removed at once) and ?autoplay=1, so it plays the 7-day window of the synthetic fleet by itself; a headless browser runs it for a stated time of its own
# clock (--virtual-time-budget) before each picture, so frame N is the replay after N seconds. docs/prototypes/dk1601/hud/ holds the frames; scripts/hud-gif.py joins them into hud-replay.gif when Pillow is installed.
set -e
OUT="docs/prototypes/dk1601/hud"; PORT="${1:-8811}"; mkdir -p "$OUT/sequence"
BROWSER="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; [ -x "$BROWSER" ] || BROWSER="/c/Program Files/Google/Chrome/Application/chrome.exe"
shot() { # file path width height scheme(0 dark, 1 light) budget_ms
  "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --blink-settings=preferredColorScheme=$5 --virtual-time-budget=${6:-6000} --window-size="$3,$4" --screenshot="$(cygpath -w "$PWD/$OUT/$1.png")" "http://127.0.0.1:$PORT$2" >/dev/null 2>&1
}
U="/fleet/Atlas/hud?range=7d&at=0.7#t=demo"
for scheme in 0 1; do
  s=dark; [ "$scheme" = 1 ] && s=light
  shot "hud-1280-$s" "$U" 1280 1300 $scheme 6000
  shot "hud-500-$s" "$U" 500 3000 $scheme 6000
done
n=0
for a in 0.05 0.12 0.2 0.28 0.36 0.44 0.52 0.6 0.68 0.76 0.84 0.92 1; do n=$((n+1)); shot "sequence/frame-$(printf %02d $n)" "/fleet/Atlas/hud?range=7d&at=$a#t=demo" 1280 1100 0 6000; done
ls "$OUT" "$OUT/sequence" | wc -l
