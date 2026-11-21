# DK1361: the fleet dashboard, screenshots

Made 2026-11-21 by the society worker with `node scripts/demo-pages.ts 8802 --fleets` and `bash scripts/dashboard-shots.sh 8802` (a seeded fake society, fake keys, in memory; the demo has no sign-in, a real service shows the page only to the tenant that owns the fleet's organisation). Desktop 1280 and phone 500 wide, light and dark; `dashboard-<width>-<light|dark>.png`. The Payments fleet has a credit cap of 2 (reached), one member frozen with a reason, and the audit trail shows both.

Status: built and tested (`packages/asp-cli/test/fleet-dashboard.test.ts`); the owner's review of these screenshots is still to come, and the fleet tree and roles wait for DK1372 and DK1359.
