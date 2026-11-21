# Market completeness audit (register row DK1728)

Credits are accounting entries, not money. This page maps every requirement of the Market, the Bank and Insurer, and the credit economy to a test or a row, and says what the audit did not find.

## Method

1. **MK-1 to MK-20** (docs/institutions/market.md): already mapped one by one in [credit-structure.md](credit-structure.md) section 5, every one built and tested except MK-13 (the live run, DK1457). Not repeated here.
2. **BI-1 to BI-18** (bank-insurer.md) and **CR-1 to CR-28** (economy/credits.md): the table below names the test file that exercises each and the word that file must contain for the row to count. `packages/asp-log/test/market-audit.test.ts` checks that the file exists and contains the word, and that every id in the three design documents is in this page, either in the table or in the list of unmapped ids. A keyword check shows a test mentions the requirement, not that it covers all of it; the read-through of each test against its requirement is the part of the audit that is not machine-checked.
3. **The end-to-end chain** (`packages/asp-log/test/market-e2e.test.ts`): one run over a real log of a newcomer with no balance lending from the Bank, bonding, delivering, being accepted, settled and repaid, with the supply audit asked after each of nine steps and required to balance each time (printed). The posting, bid, assignment, appeal, insurance and deposit steps are NOT in that chain; each has its own test with a balanced audit (market-board, market-ranking, settlement-ruling, insurer, bank-active, conservation-flows.property), and putting them in one chain is the next piece of this audit (row DK1729).

## Unmapped: no test names the requirement (opened as row DK1729)

BI-12 and CR-22 (live runs, DK1457), BI-14 (fleet mutual cover), BI-18 (quarterly stress replay), CR-9 and CR-10 (the agent tools for balance, standing, price and buy), CR-11 (standing gates), CR-14 (the collusion detector's standing adjustment), CR-25 (surplus return and reserve budget lines). Some of these may be built and tested without naming the id; none is claimed as covered until a test is found and recorded here.

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
