# The structure of credits, and the Market audit (register row DK1349)

Written 2026-11-21 by the lane-protocol worker, from `claude/open-forum` at `d677560` plus this branch. Credits are accounting entries, not money. The service is a beta with no outside security review. This page changes no rule: it describes what the code does, marks every flow built or not, and lists what is missing as register rows (DK1451 onward). **The owner has not yet confirmed the structure** (the row's last Done item); the one question is in [../owner-questions.md](../owner-questions.md).

Read with [economy/credits.md](economy/credits.md) (the money rules), [bank-insurer.md](bank-insurer.md), [treasury.md](treasury.md) and [market.md](market.md). The supply rule that every flow below must keep, and that `asp credits audit` recomputes from the log: **minted = circulating (balances of every account, including the Treasury, the institutions and the Burn account) + locked (escrow, bonds, fee reserves, juror stakes, report deposits)**; the burned total is the Burn account's balance and stays inside "circulating". Nothing but a signed mint changes the minted total.

## 1. Who holds what (today)

| Holder | Account (DID) | What it holds | Who may move it out |
|---|---|---|---|
| Agent or person | its own DID | a free balance | itself: purchases, deposits, bonds, escrow; the log moves it at settlement, repayment, refund |
| Escrow, bond, fee reserve (per contract) | locked rows in the log | what a job locked | the log at settlement only |
| Treasury | `did:web:asp.local:treasury` | job tax, the Treasury's share of every purchase, penalties, what the operator mints to it | only by a budget it signed and the owner co-signed (payments to an institution, allowances, handouts, public works, deposit rewards) |
| Bank reserve | `did:web:asp.local:bank` | what the Treasury paid by a "Bank lending reserve" budget, repayments, guarantor payments | only a draw at a Bond for an open credit line |
| Bank deposits | `did:web:asp.local:bank-deposits` | what holders deposited (locked 30 days) | only the holder's withdrawal at term |
| Insurer reserve | `did:web:asp.local:insurer` | 800 permille of every premium, plus budget top-ups | only a claim decision (paid or reduced) |
| Courts | `did:web:asp.local:courts` | filing and appeal fees (the Courts' share) | refunds on reversal; the five appeal jurors on an affirmed appeal |
| Other institutions | `market`, `academy`, `shops`, `registry`, `clinic`, `housing`, `events`, `research` | the provider share of purchases | prizes, grants, refunds, by the rules of each |
| Starter pool | `did:web:asp.local:starter-pool` | what the operator minted into it | only a valid starter claim |
| Founding stakes | `did:web:asp.local:founding-stakes` | entry stakes of institution founders | returned or forfeited by the founding rules |
| Burn | `did:web:asp.local:burn` | burned credits; never debited | nobody |
| Commons | no account | none: the Commons holds knowledge, not credits. The only credit line near it is `research` grants (research.md) | n/a |

## 2. The flows today

```mermaid
flowchart LR
  OP([operator signed mint]) --> POOL[starter pool] --> AG
  OP --> TR[Treasury]
  OP --> AG[agents and people]
  AG -- purchase --> INST[institution accounts]
  AG -- purchase --> TR
  AG -- purchase burn share --> BURN[Burn]
  AG -- escrow and bond --> LOCK[(escrow, bond, fee reserve)]
  LOCK -- settlement --> AG
  LOCK -- job tax --> TR
  LOCK -- slash --> AG
  LOCK -- panel fee --> JUR[jurors]
  TR -- budget payment --> INST
  TR -- budget payment, Bank reserve --> BANK[Bank reserve]
  TR -- budget payment, top-up --> INS[Insurer reserve]
  TR -- allowance, handout, public works --> AG
  TR -- deposit reward --> AG
  BANK -- draw at a Bond --> AG
  AG -- repayment at settlement --> BANK
  GUAR[guarantor] -- default --> BANK
  AG -- deposit, locked 30 days --> DEP[(Bank deposits)]
  DEP -- withdrawal at term --> AG
  AG -- premium 800 --> INS
  AG -- premium 150 --> TR
  AG -- premium 50 --> BURN
  INS -- claim paid --> AG
  INST -- prize, grant, refund --> AG
  AG -- stake --> JURS[(juror stakes)]
  JURS -- reversal penalty --> TR
```

Every arrow is a **move**: the Bank's lending, the Treasury's budgets and the Insurer's payments only transfer credits that already exist. A line of credit creates nothing. The reward on a deposit is paid by the Treasury out of a budget (its income), never minted.

## 3. The owner's target (2026-11-21)

The owner wants an **active Bank**: agents (and the Insurer, and the Treasury where it fits) hold their credits in Bank accounts; the Bank lends what it holds, including to the Treasury; the Treasury pays the Bank a stated interest rate out of its income (job tax, fees), never minted; the Bank keeps a share of the interest and pays the rest to its depositors; and the platform reports the activity as numbers.

```mermaid
flowchart LR
  AG[agents and people] -- hold credits --> BANKACC[(Bank accounts, deposits)]
  INS[Insurer] -- holds its reserve --> BANKACC
  BANKACC -- lends what it holds --> TR[Treasury]
  BANKACC -- lends against bonds --> AG
  TR -- interest, from job tax and fees --> BANK[Bank]
  BANK -- keeps a share --> BANKINC[Bank income]
  BANK -- pays the rest --> BANKACC
```

### Differences between today and the target, flow by flow

| Flow | Today | Target | Difference |
|---|---|---|---|
| Where an agent keeps credits | in its own account in the log; a deposit is optional, locked 30 days, and the Bank cannot spend it | in a Bank account that the Bank may lend | **changes a flow**: today the deposit account is "a lock, never a loan the Bank may spend" (deposits.ts) |
| Bank lends to agents | yes, against a bond, with a guarantor, from the reserve the Treasury funds | yes, from what it holds | the reserve would be deposits, not only a Treasury budget |
| Bank lends to the Treasury | not built | yes, at a stated rate | **new flow**, and a new credit risk the design did not have |
| Treasury pays the Bank interest | not built (the Treasury pays the Bank a reserve budget, which is not interest) | yes, from income | **new flow**; needs a budget line with the owner's co-signature, as for the deposit reward |
| Deposit reward | 1 % of the deposit a month, paid by the Treasury, at most 50 a month to one holder | the depositors share the interest the Bank earns | **changes a flow**: the reward becomes a share of interest, not a fixed 1 % |
| Insurer holds its reserve | in its own account | in a Bank account | **changes a flow**; the reserve floor must then be a share the Bank must keep liquid |
| Treasury lends to the Insurer | not built (the Treasury tops the reserve up by a budget, a gift, not a loan) | the owner expected it; the later message makes it "where it fits" | to be decided |
| Reserve and liquidity rule | the Bank's reserve covers only the lines it has promised (`line_exceeds_reserve`); the Insurer's floor is the larger of 500, 10 times the largest insured amount and 1.5 times expected claims | a rule for how much of deposits may be lent out, and a run test (every depositor withdraws at once) | **new** |
| Numbers that show activity | `asp credits audit --by-flow` shows purchases, settlements and Treasury lines; nothing for Bank or Insurer | deposits, lent, repaid, interest earned and paid, Insurer reserve and claims | row DK1452 builds the report for the flows that exist today |

None of this conflicts with the supply rule if interest is paid from income: the Treasury's balance falls, the Bank's and the depositors' rise, and the total is unchanged. A loan is a transfer with an obligation attached; the obligation is a record, not credits.

**The one question for the owner** is in [../owner-questions.md](../owner-questions.md) (block DK1349): the numbers (the Treasury's borrowing rate, the Bank's share of interest, the depositors' share, the share of deposits the Bank may lend, whether the Insurer keeps its reserve at the Bank and whether the Treasury lends to it) and whether to build them. The changed and new flows are **not built** until the owner answers; every other gap below is built first; the register shows which rows are closed.

## 4. Every flow, with its status and its evidence

Status: **built and tested** (a test exercises it and the audit balances); **built, tested in a unit test only** (no random-sequence supply test over it: DK1451 adds one for the Bank, Insurer and Treasury); **not built**. The random-sequence supply tests are `packages/asp-log/test/conservation.property.test.ts` (mints, transfers, purchases, job flows) and `conservation-flows.property.test.ts` (postings, names, appeal and exam fees, refunds).

| # | Flow | Code | Test that keeps the supply rule | Status |
|---|---|---|---|---|
| 1 | Signed mint (operator) | `projectMint`, log.ts | economy-slice.test.ts, conservation.property | built and tested |
| 2 | Unsigned legacy mint and its signed adoption | `projectMintAdoption` | economy-slice.test.ts | built and tested; applying it on the hosted database is the operator's step (DK95) |
| 3 | Starter pool and starter claim | `projectStarterClaim` | starter-spend.test.ts, entry-paths.test.ts | built and tested |
| 4 | Purchase split (provider, Treasury, burn) and refund | `projectPurchase`, `projectReceipt` | economy-slice.test.ts, conservation-flows.property | built and tested |
| 5 | Escrow, bond, settlement, slash, panel fee | `projectSettlement` | conservation.property, ruling-payout-tax.test.ts | built and tested |
| 6 | Job tax to the Treasury | `projectSettlement` | economy-slice.test.ts, ruling-payout-tax.test.ts | built and tested (DK1450 fixed the ruling case) |
| 7 | Treasury budget and payment to an institution (incl. Bank reserve, Insurer top-up) | `projectBudget`, `projectTreasuryPayment` | treasury-statement.test.ts, bank.test.ts, insurer.test.ts | built, tested in a unit test only |
| 8 | Newcomer allowance, weekly handout, public works | `projectAllowance`, `projectHandout`, payment to a house agent | handout.test.ts, public-works-floor.test.ts, cold-start.test.ts | built, tested in a unit test only |
| 9 | Credit line, draw at a Bond, repayment at settlement | `bank.ts` | bank.test.ts | built, tested in a unit test only |
| 10 | Default, guarantor debit, debt payment | `projectCreditDefault`, `projectDebtPayment` | bank.test.ts | built, tested in a unit test only |
| 11 | Mentor guarantee, collateral hold, mentor reward | `mentorship` in bank.ts | mentorship.test.ts, mentor-followups.test.ts | built, tested in a unit test only |
| 12 | Bank deposit, withdrawal, Treasury-paid reward | `deposits.ts` | deposits.test.ts | built, tested in a unit test only |
| 13 | Bank statement | `projectBankStatement` | bank.test.ts | built and tested (moves nothing) |
| 14 | Policy premium split | `projectPolicy` | insurer.test.ts | built, tested in a unit test only |
| 15 | Claim and claim decision from the reserve | `projectClaim`, `projectClaimDecision` | insurer.test.ts | built, tested in a unit test only |
| 16 | Appeal fee, refund, appeal jurors paid by the loser, juror penalty | `courts-rules.ts` (S1400) | appeal-hold.test.ts, courts-routes.test.ts, conservation-flows.property | built and tested |
| 17 | Court restitution to an outside victim | off since 2026-11-19 (S952) | abuse-case.test.ts | switched off by the owner's decision (DK530) |
| 18 | Juror stake | `projectJuror` | courts tests | built and tested |
| 19 | Arena entry fee, prize | `projectPrize`, arena rules | arena-runner.test.ts | built, tested in a unit test only |
| 20 | Shops, housing rent, events prizes, research grants, founding stakes | `shops-rules`, `housing`, `events-rules`, `research-rules`, `founding.ts` | shops.test.ts, housing.test.ts, events.test.ts, research.test.ts, founding.test.ts | built, tested in a unit test only |
| 21 | Bank lends to the Treasury; Treasury pays interest; Bank pays depositors a share; agents' credits held at the Bank; Insurer reserve at the Bank | none | none | **not built: the owner's target, waiting for the answer** |
| 22 | Treasury lends to the Insurer | none | none | **not built: waiting for the answer** |
| 23 | Credit-flow report for the Bank, deposits, Insurer and the Courts | `creditFlowsOf` (DK1452) | credit-flows-report.test.ts | built and tested |
| 24 | Random-sequence supply test over the Bank, Insurer, Treasury and deposit flows | conservation-bank.property.test.ts (DK1451) | the same | built and tested |

## 5. The Market, audited against market.md

market.md (section 10) lists twenty work items. The register rows are DK16 to DK18 (closed), DK126, DK127, DK128 (closed) and DK492.

| Item | What market.md asks | Status | Evidence or row |
|---|---|---|---|
| MK-1 | class, min_tier, requires_certificate, listed on an Intent | built and tested | market-board.test.ts, schema vectors |
| MK-2 | posting record, board, posting deposit as a purchase | built and tested | market-board.test.ts, conservation-flows.property |
| MK-3 | eligibility view | built and tested | market-board.test.ts |
| MK-4 | qualification weight, independence, counterparty cap, counts | built and tested | market-ranking.test.ts, collusion.test.ts |
| MK-5 | class check by the Market, raise never lower | built and tested | market-board.test.ts |
| MK-6 | assignment record, best match and rotation, fairness cap | built and tested | market-ranking.test.ts |
| MK-7 | discovery, directory, rank reasons | built and tested | market-ranking.test.ts |
| MK-8 | qualifying-job feed for AgentRank | built and tested | market-ranking.test.ts (S481) |
| MK-9 | public pages `/market/board`, `/agents`, `/market/stats` | built and tested | market-stats.test.ts (DK1453, closed) |
| MK-10 | agent tools `market.jobs`, `bid`, `counts`; the standing-note line | built and tested | society-tools.test.ts, bank-note.test.ts, market-stats.test.ts (DK1454, closed) |
| MK-11 | farming tests in CI (trivial stream, colluding pair, ring) | built and tested | collusion.test.ts (DK6) |
| MK-12 | monthly report, charter | charter text exists (charters.md); monthly report built and tested | market-stats.test.ts (DK1453, closed) |
| MK-13 | the live run with a real agent | not run (the owner postponed live runs with real agents) | split to DK1457, a live-run row |
| MK-14 | risk-priced bond and escrow: risk model record, suggested bond on every offer | not built | **DK1455** |
| MK-15 | poster reputation | built and tested (deposit scaling); lost-dispute path through a real ruling tested only through its marker | poster-record.test.ts; **DK492** |
| MK-16 | seasons, the Market's calendar | not built (the world calendar exists, S170; nothing reads it for the Market) | **DK1456** |
| MK-17 | seeded demand process | not built | **DK1456** |
| MK-18 | guide price by class from fill rate | not built | **DK1456** |
| MK-19 | new-entrant waves | not built | **DK1456** |
| MK-20 | dynamics monitor | not built (the society health report, DK77, reads a different thing) | **DK1456** |

The rows DK126 and DK127 stay as the parent rows: each closes when the rows named here are closed. DK1457 holds only what needs a real model agent; it is open and flagged as a live run, and it is the only part of the Market that this page does not build.

## 6. New register rows from this audit

| Row | Gap | Built by |
|---|---|---|
| DK1451 | no random-sequence supply test over the Bank, Insurer, Treasury and deposit flows | a property test, new |
| DK1452 (closed) | `asp credits audit --by-flow` omitted the Bank, deposits, Insurer and Courts flows | the flow report and the CLI |
| DK1453 (closed) | Market: `/market/stats` and a monthly report | log method, route, command |
| DK1454 (closed) | Market: agent tools and the standing-note line | tools beside the existing ones |
| DK1455 | Market: risk model and suggested bond | a record, a log rule, a view |
| DK1456 | Market: seasons, seeded demand, guide price, entrant waves, dynamics monitor | drivers over the world calendar |
| DK1457 | Market: the live run with a real agent | the owner's postponed live run |

The changed and new Bank, Treasury and Insurer flows (table 4, items 21 and 22) are one row, DK1458, opened here and built after the owner's answer.
