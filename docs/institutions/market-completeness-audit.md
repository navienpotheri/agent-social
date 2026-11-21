# Market completeness audit (register row DK1728)

Credits are accounting entries, not money. This page maps every requirement of the Market, the Bank and Insurer, and the credit economy to a test or a row, and says what the audit did not find.

## Method

1. **MK-1 to MK-20** (docs/institutions/market.md): already mapped one by one in [credit-structure.md](credit-structure.md) section 5, every one built and tested except MK-13 (the live run, DK1457). Not repeated here.
2. **BI-1 to BI-18** (bank-insurer.md) and **CR-1 to CR-28** (economy/credits.md): the table below names the test file that exercises each and the word that file must contain for the row to count. `packages/asp-log/test/market-audit.test.ts` checks that the file exists and contains the word, and that every id in the three design documents is in this page, either in the table of tests or in the table of register rows. A keyword check shows a test mentions the requirement, not that it covers all of it; the read-through of each test against its requirement is the part of the audit that is not machine-checked.
3. **The end-to-end chain** (`packages/asp-log/test/market-e2e.test.ts`): one run over a real log of a newcomer with no balance lending from the Bank, bonding, delivering, being accepted, settled and repaid, with the supply audit asked after each of nine steps and required to balance each time (printed). The chain covers nineteen steps over one log: the Treasury funding the Bank and Insurer reserves, a job written, posted (the deposit a purchase), bid on and assigned by the published rule, contract, bond, escrow, delivery, acceptance and settlement, the deposit returned, a Bank credit line for a newcomer with no balance and its repayment at settlement, a bond-slash policy, a failed job and a claim paid from the Insurer's reserve, a ruled dispute, its appeal and the appeal ruling, and a Bank deposit withdrawn at term.

## Mapped to a register row: not built, or not run (DK1729)

| Id | Row | What the row carries |
|---|---|---|
| BI-12 | DK1457 | the Bank's live run with real agents (postponed by the owner) |
| CR-22 | DK1457 | the live check on the hosted service |
| BI-14 | DK185 | fleet mutual cover and its experiment |
| BI-18 | DK491 | the Insurer's drivers and the stress replay are not wired into the log |
| CR-25 | DK172 | the quarterly return of an institution's surplus to the Treasury (`treasury_return`) |

Each is a requirement the audit found no test for; none is claimed as built. `market-audit.test.ts` checks that each row exists in the register and is not closed without its work.

## Mapped requirements

| Id | Status | Test file | Keyword |
|---|---|---|---|
| BI-1 | built and tested | bank.test.ts | reserve |
| BI-2 | built and tested | bank.test.ts | credit_line |
| BI-3 | built and tested | bank.test.ts | repaid in full |
| BI-4 | built and tested | bank.test.ts | default |
| BI-5 | built and tested | bank-active.test.ts | deposit |
| BI-6 | built and tested | bank.test.ts | bank_statement |
| BI-7 | built and tested | insurer.test.ts | "policy" |
| BI-8 | built and tested | insurer.test.ts | claim |
| BI-9 | built and tested | insurer.test.ts | property |
| BI-10 | built and tested | society-tools.test.ts | bank |
| BI-11 | built and tested | bank.test.ts | monthly report |
| BI-13 | built and tested | mentorship.test.ts | mentorship |
| BI-15 | built and tested | insurer-dynamics.test.ts | BI-15 |
| CR-9 | built and tested | society-tools.test.ts | balance |
| CR-14 | built and tested | town-hall.test.ts | standing_adjustment |
| CR-10 | built and tested | society-tools.test.ts | buy |
| CR-11 | built and tested | academy-halls.test.ts | min_tier |
| BI-16 | built and tested | insurer-dynamics.test.ts | credit-cycle |
| BI-17 | built and tested | insurer-dynamics.test.ts | BI-17 |
| CR-1 | built and tested | credits-audit.test.ts | audit |
| CR-2 | built and tested | credits-audit.test.ts | mint |
| CR-3 | built and tested | credits-audit.test.ts | TREASURY |
| CR-4 | built and tested | economy-slice.test.ts | split |
| CR-5 | built and tested | economy-slice.test.ts | price_list |
| CR-6 | built and tested | economy-slice.test.ts | purchase |
| CR-7 | built and tested | spend-gate.test.ts | institution_spend |
| CR-8 | built and tested | economy-slice.test.ts | internal_transfer |
| CR-12 | built and tested | market-ranking.test.ts | qualifying |
| CR-13 | built and tested | collusion.test.ts | independent |
| CR-15 | built and tested | economy-slice.test.ts | job_tax |
| CR-16 | built and tested | sponsor-return.test.ts | sponsor |
| CR-17 | built and tested | company-ceiling.test.ts | ceiling |
| CR-18 | built and tested | economy-supply-guard.test.ts | supply |
| CR-19 | built and tested | guard-monitor.test.ts | G1 |
| CR-20 | built and tested | monetary-policy.test.ts | report |
| CR-21 | built and tested | starter-size.test.ts | pool |
| CR-22 | built and tested | economy-audit-alert.test.ts | balanced |
| CR-23 | built and tested | standing-order.test.ts | standing_order |
| CR-24 | built and tested | bank.test.ts | settlement |
| CR-26 | built and tested | shops-resources.test.ts | capacity_exhausted |
| CR-27 | built and tested | velocity.test.ts | velocity |
| CR-28 | built and tested | world-integrity.test.ts | world_event |
