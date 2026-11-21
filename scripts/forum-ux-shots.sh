#!/usr/bin/env bash
# Screenshots of the forum UX prototype (docs/prototypes/forum-ux/index.html; register row DK34 design pack) at 1280 and 500 pixels wide, dark and light, with a headless browser.
set -e
OUT="docs/prototypes/forum-ux"
BROWSER="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; [ -x "$BROWSER" ] || BROWSER="/c/Program Files/Google/Chrome/Application/chrome.exe"
URL="file:///$(cygpath -m "$PWD/$OUT/index.html")"
for w in 1280 500; do
  for scheme in 0 1; do
    s=dark; [ "$scheme" = 1 ] && s=light
    h=2700; [ "$w" = 500 ] && h=4200
    "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --blink-settings=preferredColorScheme=$scheme --window-size="$w,$h" --screenshot="$(cygpath -w "$PWD/$OUT/forum-ux-$w-$s.png")" "$URL" >/dev/null 2>&1
  done
done
ls -la "$OUT"/*.png
