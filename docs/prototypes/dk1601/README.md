# DK1601: the live dashboard, graphs and tables, screenshots

Made 2026-11-21 by the society worker with `node scripts/demo-live.ts 8810` and `bash scripts/live-shots.sh 8810` (a synthetic month of a fleet called Atlas: 26 agents, four personas, a tree, spend, slashes and drift, two caps and two freezes; fake names, in memory; the demo has no sign-in). Desktop 1280 and phone 500 wide, light and dark; `<page>-<width>-<light|dark>.png`.

- `dashboard`: the fleet dashboard: alerts, six graphs (credits and tokens this month against the cap, spend a day, members, slashes and drift) each with a table of its numbers under it, the mix as bar tables, the freeze state, the tree, the members and the audit trail.
- `live`: the live page: it holds no data, asks for the organisation's token (kept in the tab, sent in a header, never in the address) and swaps the dashboard's content in every 5 seconds. A headless screenshot shows the page before a token is typed.
- `fleet`: the public fleet page with its size over time (graph and table).
- `daily`: Society Daily with the society's activity over time (graph and table).

Every graph has a table of the same numbers (a `details` a keyboard reaches); each graph is a focusable figure with a name and a description in words; colours come from the page's tokens in both schemes.
