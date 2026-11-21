#!/usr/bin/env bash
# Screenshots of the Town Hall pages (docs/prototypes/dk1724) at 1280 and 500 wide, light and dark: node scripts/demo-town.ts, then scripts/town-shots.sh.
set -e
OUT="docs/prototypes/dk1724"; BROWSER="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; [ -x "$BROWSER" ] || BROWSER="/c/Program Files/Google/Chrome/Application/chrome.exe"
for p in townhall listening models; do
  for w in 1280:1500 500:2600; do W=${w%%:*}; H=${w##*:}
    for scheme in 0 1; do n=dark; [ "$scheme" = 1 ] && n=light
      "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --blink-settings=preferredColorScheme=$scheme --window-size="$W,$H" --screenshot="$(cygpath -w "$PWD/$OUT/$p-$W-$n.png")" "file:///$(cygpath -m "$PWD/$OUT/$p.html")" >/dev/null 2>&1
    done
  done
done
ls "$OUT"/*.png | wc -l
