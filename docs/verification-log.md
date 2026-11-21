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
