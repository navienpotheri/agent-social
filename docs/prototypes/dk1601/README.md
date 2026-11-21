# DK1601: the dynamic live dashboard, screenshots and an image sequence

Made 2026-11-21 by the society worker with `node scripts/demo-live.ts 8811` and `bash scripts/live-shots.sh 8811`. The demo is a synthetic fleet (Atlas: 26 agents, four personas, a tree, two caps, two freezes) whose log keeps growing: every 2 seconds a few new records are written (spend, runs, now and then a drift diagnosis or a slash), as on a live service. The demo has no sign-in; the live page opens with the token in the address fragment (`#t=demo`), which the page removes from the address at once.

- `live-<1280|500>-<light|dark>.png`: the dynamic page: time range, filters, tiles, four graphs each with its table, three bar tables that filter the page when clicked, the busiest members, and the live activity ticker.
- `sequence/frame-N-after-Ts.png`: the same page after 3, 6, 10, 15, 20 and 28 seconds of its own clock. Compare the tiles (credits, tokens, records) and the ticker from frame to frame: the numbers have moved and new lines have arrived, with no reload. (A headless browser cannot film the glide itself; each number glides over 0.4 s in a real browser, and in one step when the visitor prefers reduced motion.)
- `dashboard-*`: the page of the first version (the authenticated HTML) with the same graphs and tables.
- `fleet-1280-*`, `daily-*`: the fleet page and Society Daily with their time graphs; Daily has a range of 14, 30 or 90 days and its lines draw in (not for visitors who prefer reduced motion).

What the live page does: polls the service every 2 seconds for new records and re-fetches the numbers when there are any; tweens every number; time range 1h, 24h, 7d, 30d; filters by persona, node and tier and a switch between the tenant's fleets; hover and keyboard tooltips (arrow keys walk a graph's points and read each one aloud); a click on a bar filters the page, a click on a member opens its journey; pause and resume; a table of the same numbers for every graph; keyboard operable; both colour schemes; no outside origin. The service sends totals, a bucketed series, the mix and the busiest 50 members only, so it stays fast at 10,000 members (tests: summary 24h about 0.4 s, filtered 30d about 0.1 s, events about 0.04 s; stated at 1 s each).


## The HUD (hud/)

The dense operations view with a replay, built from the fleet's real records (the demo fleet here is synthetic). Made with `node scripts/demo-live.ts 8811`, `scripts/hud-shots.sh 8811` and `python scripts/hud-gif.py`.

- `hud-1280-dark.png`, `hud-1280-light.png`, `hud-500-dark.png`, `hud-500-light.png`: the page 70 percent through the 7-day window.
- `sequence/frame-01.png` to `frame-13.png` and `hud-replay.gif`: the replay at 5, 12, 20 ... 100 percent of the window; watch the edges fan in, the cards go from queued to active to done, the counters and the risk matrix fill. A headless browser cannot film real time, so the frames are taken at fixed points; the page itself plays in real time (open `/fleet/<fleet>/hud#t=<token>&` ... then press Play, or add `?autoplay=1`), and the owner can record that for the site and the deck.
- The owner's reference frames are not in the repository; the feel only is recorded in row DK1601.
