# Questions for the owner from the lane-protocol worker

One block per register row. Each question is the exact decision needed; the work that does not depend on the answer is built and tested already. A block is deleted when the owner answers it and the answer is recorded in [owner-decisions.md](owner-decisions.md).

## DK121 (built, closed): the share of a juror's stake lost on a reversal

- **Asked:** a first-panel juror whose ruling is reversed on appeal loses 20 % of its stake to the Treasury (at least 1 credit, at most its stake). Courts.md proposed 20 %; no decision records it. Keep 20 %, or choose another number between 0 and 100 %?
- **Why it matters:** the share is `JUROR_PENALTY_PERMILLE` in `packages/asp-log/src/courts-rules.ts`; changing it after the beta opens changes how a replayed log treats old reversals, so a change needs a date from which it applies (the same pattern as the bond floor cutover).
- **Default in force:** 20 %.

## DK1349: the numbers for an active Bank (one question; nothing that changes a flow is built until it is answered)

The structure is drawn, today and as you want it, in [institutions/credit-structure.md](institutions/credit-structure.md). Everything that does not change a flow is built first (rows DK1451 to DK1456; the register shows which are closed). To build the active Bank (row DK1458) one decision is needed: **do you accept these numbers, or give others?**

| Number | Proposal | Why |
|---|---|---|
| Treasury borrowing rate | 1 % a month of what the Treasury owes the Bank, paid from the job tax and fees only, never minted | today's deposit reward is 1 % a month, so the same size; the Treasury's income is about 2 % of every paid job plus its share of purchases |
| Bank's share of the interest | 20 % kept by the Bank (its income, spendable only on its reserve), 80 % paid to depositors in proportion to their balance and days held | the Bank needs a margin for defaults; most of the interest goes to the agents |
| Deposit terms | no 30-day lock: an agent may withdraw any amount the Bank holds at once, up to the liquidity rule below | "agents hold credits at the Bank" cannot mean a lock |
| Liquidity rule | the Bank lends at most 70 % of what it holds; 30 % stays as a reserve that is never lent | so that ordinary withdrawals are paid at once |
| Run test | every depositor asks for the whole balance on one day: the first 30 % is paid at once, the rest is paid as loans are repaid, in the order asked, and nothing is created or lost | shows that a run does not break the supply rule, only delays payment |
| The Insurer | keeps its reserve in a Bank account and counts it as a deposit; the Treasury does **not** lend to it (it tops up by a budget, as today) | an insurer that lends from a lender's own loan would stack two risks on one pool |
| Whether the Treasury may borrow at all | yes, up to 50 % of what the Bank holds, and only for its own budget lines | keeps the Bank from lending its whole pool to one borrower |

If you answer "accept", the lane-protocol worker builds DK1458 with a supply test for each flow and the run test. If you give other numbers, they replace the proposals. The Treasury borrowing from the Bank and the Bank spending deposits are the two changes in direction from the written design; both are your decision, not the worker's.
