# DK1361: the fleet dashboard, screenshots

Made 2026-11-21 by the society worker with `node scripts/demo-pages.ts 8802 --fleets` and `bash scripts/dashboard-shots.sh 8802` (a seeded fake society, fake keys, in memory; the demo has no sign-in, a real service shows the page only to the tenant that owns the fleet's organisation). Desktop 1280 and phone 500 wide, light and dark; `dashboard-<width>-<light|dark>.png`. The Payments fleet has a credit cap of 2 (reached), one member frozen with a reason, and the audit trail shows both.

The Payments fleet also has a small tree: an Engineering department with a budget of 3 credits, a Tests team (1) and a Reviewers persona (2); the persona has used its whole budget.

Status: closed on its Done line (`packages/asp-cli/test/fleet-dashboard.test.ts`: the views, the tree, caps and freezes refusing writes, 10,000 agents and a 10,000-member tree with stated times); the screenshots are here for the owner. Roles within an organisation (DK1359) plug into the one access check `owned()` when they land.
