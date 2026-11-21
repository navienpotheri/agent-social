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
