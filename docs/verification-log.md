# Verification log

One line per audited row: id, builder commit, test, result (verified, fixed, reopened). Kept by lane-verify (the integrator and auditor). Nothing here is a claim about alignment.

| Row | Builder commit | Test | Result |
|---|---|---|---|
| DK1453 | f2dac02 | packages/asp-log/test/market-stats.test.ts, packages/asp-cli/test/market-stats-cmd.test.ts | verified (every figure, both routes, bad month; commands regenerated) |
| DK1454 | 1463eab | packages/asp-package/test/society-tools.test.ts, packages/asp-cli/test/bank-note.test.ts | pending run in the gate |
| DK76 | a0f89c2 | packages/asp-log/test/world-halt.test.ts, packages/asp-cli/test/world-halt-cmd.test.ts | verified against its Done line (reproducible run, invariants, kill-switch, adapting agent); the rest is tracked as DK1459, DK1460, DK1456 |
| DK1356 | 29b9bee | packages/asp-log/test/starter-fleet.test.ts (10,000 agents, rate rule, supply audit, second tranche) | reopened to partial: README, site and llms.txt claims still say two identities (DK1470) |
| DK1353 | 90453ac | packages/asp-log/test/fleet-declaration.test.ts, packages/asp-cli/test/fleet-cmd.test.ts | verified by reading; run result below |
| DK1355 | e2ad252 | packages/asp-log/test/mandate-template.test.ts, packages/asp-core/test/mandate-template.test.ts, fleet-cmd.test.ts | reopened to partial: the gateway refusal named in Done is DK1471, not built |
| DK1458 | 28688d3 | packages/asp-log/test/bank-active.test.ts, conservation-bank.property.test.ts | verified by reading; run result below |
| DK1453, DK1454, DK76, DK1353, DK1458 | f2dac02, 1463eab, a0f89c2, 90453ac, 28688d3 | full gate on tip 423bab0 (asp-log 800/800, asp-cli all pass) | verified (tests ran green) |
| DK791 | 4a67b983 | packages/asp-log/test/forum-checkpoint.test.ts, asp-cli forum-checkpoint tests | verified; note: the row says Closed 2026-11-22, a date after today (2026-11-21), to be corrected by launch-bar |
| DK740 | 89cb1cd4 | packages/asp-log/test/service-held-bond.test.ts (discount, binding, replay, docket label) | verified |
| DK1342 | c599d1f8 | packages/asp-cli/test/lens-course-sit.test.ts, lens-course-sit-service.test.ts | verified on its tested flow (live run is DK1600); note in the row says "status partial until the live run" while the status says closed |
| DK1307 | 6d52dab | packages/asp-cli/test/promises-audit.test.ts | fixed: T02's wording changed by DK1302 (starter second tranche), updated in docs/promises-audit.json and regenerated |
| DK1211 | 61937a7 (open-forum), 92f0db6 and 0acb878 (duplicates) | packages/asp-log/test/funnel-wired.test.ts | verified; duplicates dropped on merge (launch-bar kept lane-society's), lane-cli's still to be removed; duplicate /society/funnel route in surface.ts removed |
| DK380 | 14b5361a | packages/asp-cli/test/join.test.ts | reopened to partial: no test finishes a first course before the offer |
| DK1302, DK1348, DK1367 | d5b57239, 1d8abc9b, 6b34645d | built as partial by lane-society | status partial kept; DK1302's rule merged with DK1356's per-agent rule in log.ts |
| DK1372 | bb7675c9 | packages/asp-log/test/fleet-tree.test.ts, packages/asp-cli/test/fleet-tree-cmd.test.ts (narrowing at every level, move, node budget, 10,000-member tree; both ran green) | verified; gateway enforcement is DK1471, the dashboard tree DK1361 |
| DK1357 | 3439bbaa | packages/asp-log/test/redteam-farming.test.ts and the farming tests (19 pass: 950 of 1,000 farms caught, 0 of 1,000 honest flagged; stealth farm 0/50 stated; thresholds not published in docs/enterprise-fleets.md) | verified; adaptive attackers are DK1473, hosted facts DK1472 |
| DK1357 (integration) | 3439bbaa | packages/asp-cli/test/journey.test.ts | fixed: the new record type common_control was missing from INSTITUTION_OF in packages/asp-log/src/journey.ts (registry); added |
| DK1354 | 307b4dbb | packages/asp-cli/test/fleet.test.ts (manifest, invitation, forged and expired invitation, 10,000 agents stopped at 4,000 and resumed: 157 s in the gate), packages/asp-log/test/fleet-invite.test.ts | verified (ran green in the full gate) |
| DK1365 | 307b4dbb | packages/asp-log/test/open-door.test.ts, packages/asp-cli/test/http-enrol.test.ts (no count refuses; rush queued with a ticket) | verified (ran green); the forum's own register route limit stays DK1504 |
| U10 | c112eb73 | packages/asp-log/test/funnel-people.test.ts on the shared FunnelTap | verified; the duplicate agents' funnel (DK1211) was dropped, person road ported; surface table keeps one operator-only /society/funnel |
| DK1220, P29, US2, T12, O2, H4, DK1341 | 17c45bb1, 2f135c05, 3a402965, d3c7b894 | bank-mentor, approval-pile, budget, production-flags, abuse-due, monitor, incident-runbook, company-ceiling tests (all ran green in the full gate) | verified by reading each Done line against its tests |
| DK1358 | bb714225 | packages/asp-log/test/related-party.test.ts, packages/asp-cli/test/fleet-rp-cmd.test.ts, journey.test.ts (record, never independent, label, breach reset, journey line) | verified (ran green); registry name pages not hiding a private fleet is stated, DK1367 |
| DK1366 | 58eb2e14 | packages/asp-log/test/template-reputation.test.ts, fleet-rp-cmd.test.ts | verified (ran green); harness not in the passport is stated |
| DK1370, DK1379 | ffa1aa65, 249ca81f | partial by the builder | status kept; fixed at integration: credit_lot, usage_plan and usage_statement were missing from INSTITUTION_OF in journey.ts (treasury), journey tests pass |
| DK380 | be7b0127 | packages/asp-cli/test/allowance-first-course.test.ts (a newcomer is told the allowance opens after a first course, takes it, claims, is paid 40, books balance), join.test.ts | verified (re-closed after my reopening) |
| DK1361 | f8ba871d | packages/asp-cli/test/fleet-dashboard.test.ts (views, caps, freeze, tree, 10,000 members timed) | reopened to partial: the Done line ends with the owner's review of the screenshots, not done (as DK1348, DK1367) |
| DK858, DK1378, DK1387 | d358eae0, b106b084, 80b4a267 | by reading: DK858 is DK740's rule; DK1378 retention and erasure policy with receipt; DK1387 roadmap states no certification held | verified by reading the rows; wording-only rows, claims on the site unchanged |
