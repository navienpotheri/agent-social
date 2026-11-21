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

## DK1: ratify the monetary policy (what is left is your signature, not work)

- **Asked:** docs/institutions/economy/credits.md is the written monetary policy (the supply rule, every faucet and sink with its rate, who may mint, the Treasury, the burn, the closed-loop rule). Its tests run: the supply rule holds over random sequences of every credit-moving flow (conservation.property, conservation-flows.property and, since DK1451, conservation-bank.property), and `asp credits audit --by-flow` reproduces the supply from the log alone and now covers the Bank, deposits, Insurer and Courts (DK1452). Do you ratify credits.md as it stands, together with docs/institutions/credit-structure.md and your answer to the DK1349 block above?
- **Why a question:** the row's Done line says "ratified by the owner". Everything else in it is built and tested.

## AG3: who hears a contest of a refusal, a strike or a slash, and in how long?

- **Asked:** every refusal already names the rule and the way forward, and the false-refusal rate is measured with a ceiling that may only go down. What is missing is a contest route. Proposal: a contest of a refusal, strike or slash is filed within 14 days to the Courts' small-claim route (one juror, flat fee 2 credits, refunded if upheld), heard in 30 days, and an upheld contest removes the strike or returns the slashed part; the Registrar's interim suspensions already follow the same 14-day window (DK535).
- **Default in force until you answer:** none; the row stays partial.

## DK530: re-sign the Code to change Article 3.7?

- **Asked:** the abuse-report restitution to an outside victim is switched off in the log (S952). Article 3.7 of the signed Code still says a reporter is paid restitution; changing it re-signs the Code (your decision LW3.7: amend Article 3.7 and sign Code 1.0 with your own key when ready). Do you want the amended text published now, so this row can close, or with Code 1.0?
- **Why a question:** a worker never signs the Code.

## DK95 and DK9: two operator steps on the hosted database (no build left)

- **Asked:** (DK95) run `asp credits adopt` on the hosted database with the operator key and your co-signature so that `asp credits audit --require-signed` passes there. (DK9) start `asp serve` on the hosted service with `--mail-from` and `--mail-operator` so the supply audit runs nightly, and record one day of it in docs/live-run-checklist.md.
- **Why a question:** both need the deployed host and your keys; the code and its tests are done (S330, S84).

## T21: the waiting time for an approval, apart from the working time

- **Asked:** do you want the contract's deadline extended by the seconds an agent waits for its principal's approval (so a slow principal cannot make a good agent late), with the waits recorded in the Action? It changes what a deadline means in the protocol (a field on the Action, a rule in the lifecycle guards, vectors in both SDKs). A gated long run with a real model agent is also part of the row and is postponed.
- **Default in force until you answer:** none; the row stays partial.

