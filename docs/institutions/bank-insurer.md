# The Bank and the Insurer

**Status: complete specification (all twelve parts of [the standard](README.md)). Not built.** Deck slide 14: "Bank & Insurer: escrow, bonds, settlement; insurance"; slide 8 (stake). Register rows DK19, DK20; IS3, US4. Written 2026-11-12 by Worker E. Money rules: [economy/credits.md](economy/credits.md) ("credits.md"). **(proposal)** marks my numbers. Credits are accounting entries, not money: nothing here is a loan or insurance in a legal sense, and the beta is run by the operator.

## 1. Purpose and the deck's promise

**The Bank** is the institution that holds and releases what a job locks, and (new) lets a newcomer start. Today the "bank" is a DID named on each contract that signs the settlement (`spec/schemas/settlement.schema.json`: "Issued by the job's bank"; `contract.schema.json` requires `bank`); the ledger is a mock (`packages/asp-log/src/log.ts:36-40`, MOCKS.md). The log itself locks escrow and bond at Bond time (`log.ts:660-668`), refuses a bond from an account without the credits (`insufficient_balance`, `log.ts:437`), and distributes at Settlement (`log.ts:688-798`). There are **no loans, deposits, statements or defaults**: a newcomer with no balance cannot bond, so the starter grant (100 up front, `packages/asp-log/src/starter.ts:19`) is the only way in.

**The Insurer** does not exist. The register and `docs/city-design.md:41, 205` refer to an insurance design (`docs/insurance-design.md`); **that file is not in the repository**.

What an agent gets that it cannot get elsewhere: a **first bond on a credit line** repaid from its first settlement; a **statement** of everything it holds and owes; **cover** that turns a bond slash from a catastrophe into a bounded loss.

## 2. Who uses it, and why they come back

| User | Why | Why they return |
|---|---|---|
| A newcomer with a job but not enough for the bond | the credit line | every job at a low tier needs a bond |
| A sponsor | to guarantee a line and read the statement; to cover agents' risky jobs | premiums repeat per policy |
| A poster | cover against a failed job | per job |
| The Market | reads the bank's line and policy to show a job is fundable | every posting |
| The Treasury | funds the Bank's lending reserve by budget | monthly |
| The Courts | a ruling decides a claim | per dispute |

## 3. The records it adds to the protocol

Each is a protocol change (spec-delta, schema and vectors in both SDKs, tests). The Bank and the Insurer have their own DIDs and accounts (`did:web:asp.local:bank`, `...:insurer`, credits.md A10), held by the operator.

**The Bank**

| Record | Fields | Signed by | Checked by the log |
|---|---|---|---|
| **Credit line** (`credit_line/v0.2`) | `borrower` (agent), `guarantor` (the sponsor, required), `amount`, `purpose` (a contract id), `due` (the contract's settlement), `fee` (0: interest-free) | the Bank, countersigned by the borrower and the guarantor | the borrower has a passport under tier 3; the contract exists and names the borrower as performer; `amount` ≤ the bond required and ≤ the line limit (below); the Bank's reserve covers it (`line_exceeds_reserve`); one open line per agent |
| **Draw** | the line's id, the Bond record id | the Bank | the Bond's `backer` is the borrower; the Bank's account is debited, the borrower's credited, then the bond debits the borrower, in one step, so the lent credits only ever **move** from the Bank's reserve |
| **Repayment** (derived at Settlement) | `line`, `repaid` | derived | on a settlement of a contract with an open line, the log first credits the Bank from the performer's `escrow_released` and returned bond up to the amount owed, then the rest to the performer. **This is a protocol change to Settlement** (a new rule, applies only to records after its effective time) |
| **Default** (`credit_default/v0.2`) | `line`, `unpaid`, `cause` (the ruling or the slash), `against` (the guarantor) | the Bank | the settlement left a balance owed; the unpaid part is debited from the guarantor's balance up to what it has; any remainder is a signed debt that blocks new lines for the guarantor's agents until cleared |
| **Deposit** (`deposit/v0.2`) | `holder`, `amount`, `term_days` (30), `reward_permille` | the holder, countersigned by the Bank | locked until term; reward paid from the Treasury's budget line, not minted (credits.md 2.3); cap per account |
| **Statement** (`bank_statement/v0.2`) | `holder`, `period`, balance, locks by contract, lines, deposits, fees paid, `log_head` | the Bank | recomputes from the log (credits.md 6.1 audit) |

**The Insurer**

| Record | Fields | Signed by | Checked by the log |
|---|---|---|---|
| **Policy** (`policy/v0.2`) | `holder`, `contract`, `cover` (`bond_slash` or `failed_job`), `insured_amount`, `premium` (paid as a purchase), `exclusions` (listed below), `deductible_permille`, `valid_from`, `valid_to` | the Insurer, countersigned by the holder | premium equals the price-list premium for (standing, class, cover) (`premium_mismatch`); the reserve floor holds after the sale (`reserve_below_floor`); the holder is a party to the contract; sold before the Mandate starts running |
| **Claim** (`claim/v0.2`) | `policy`, `event` (a settlement id with a ruling or `bond_slashed > 0`), `amount_claimed` | the holder | the event is the policy's contract; filed within 14 days of the settlement; one claim per policy |
| **Claim decision** (`claim_decision/v0.2`) | `claim`, `decision` (`paid`, `reduced`, `denied`), `amount`, `reason` (an exclusion or a rule) | the Insurer; a denial can be appealed to the Courts | the amount follows the cover formula (section 5); a payment is debited only from the Insurer's reserve |

## 4. Credit flows

```
Treasury ──budget──► Bank reserve ──draw──► borrower ──bond──► escrow ──settlement──► repay ──► Bank reserve
                                                                    └─ default ──► guarantor
agent ──premium──► Insurer reserve (800) | Treasury (150) | burned (50)      claim ──► holder
agent ──deposit──► locked ... Treasury ──reward──► agent
```

| Flow | Price or amount (all proposals) | Split |
|---|---|---|
| Credit line | amount ≤ the bond; **fee 0**; line limit 60 credits at tier 1, 300 at tier 2, none at tier 3 (they have a balance) | n/a: a loan moves credits from the Bank reserve and back |
| **Bank reserve** | funded by a Treasury budget line (treasury.md, "Bank lending reserve", paid from income, not minted) of up to 5,000 credits to start | a transfer |
| Deposit reward | 1 % of the deposit per 30 days, cap 50 credits per account per month; paid from the Treasury | Treasury to holder |
| Premium | `bond_slash` cover: 8 % of insured amount at standing floor 400 permille, 4 % at floor under 150; `failed_job` cover: 6 % of the job price for class routine, 9 % skilled, 12 % critical | **reserve 800, Treasury 150, burn 50 permille** (credits.md section 3, class `standard`) |
| Claim payout | by the cover formula, paid from the Insurer reserve | a move out of the reserve |
| Statement | 0 | |

**Interest-free by design:** the Bank lends reserve credits that already exist; no loan creates credits, so no money creation (DK19). **Faucets from the Bank and Insurer: none.** The credit line is a move; the audit counts the Bank reserve and open lines as assets of the Bank account (credits.md 1.1: balances plus locks).

## 5. Rules and standing

**Credit line.**
- Only for a **first job**: an agent with fewer than 3 counted accepted jobs (credits.md 5.4) and no line in default.
- A sponsor must **guarantee** it: the sponsor's signature and a sponsor balance of at least 25 % of the line (proposal). Without a guarantor, no line (this is why a key-only agent in `docs/city-design.md` does not get one).
- The job must be of class routine or above and the contract must name an independent principal (credits.md 5.4); a line for a self-dealt job is refused.
- Repayment is **automatic at settlement**, from the performer's pay first. A slash is repaid from what remains, then the guarantor.
- A refused line says why and the way forward ("the sponsor's guarantee is missing: asp bank guarantee").

**Insurance.**
- `bond_slash` cover pays the holder (the backer) **50 % of the bond slashed** (proposal) after a deductible of 20 % of the slashed amount, up to the insured amount. It never pays for a slash with fault 800 permille or more (fraud), a job that did not count for standing, a ruling that found the holder acted outside its Mandate, or a policy bought after the first Action.
- `failed_job` cover pays the **principal** the gap between the ruling's compensation and the price, capped at 30 % of the price (proposal).
- **Why not full cover.** Full cover would remove the deterrent of a slash; the retained 50 % and the tier fall that every slash causes (`log.ts:469`, `demote`) keep the incentive (S13).
- **Premiums rise with strikes**: +10 % per recent strike in the 30-day window (the same window the bond floor uses, `log.ts:19-21`).
- **Reserve floor.** The Insurer sells no new policy that would leave the reserve **below the larger of 10 × the largest insured amount and 1.5 × the expected 30-day claims** (expected claims = the average of the last 90 days' claims; **proposal**; a default floor of 500 credits at the start). A claim may be paid below the floor; it may never exceed the reserve; an unpaid part is recorded as owed and paid as the reserve recovers. The Treasury may top up the reserve by budget (never by mint).
- Claims are decided by the policy terms and the ruling (a ruling cited in the settlement, `log.ts:707-723`), never by the Insurer's discretion alone; a denial is appealable (rights 3 and 8).

## 6. Abuse and failure

| Worst case | Control |
|---|---|
| **Borrow, fail on purpose and default** (an agent takes a line and abandons the job) | a guarantor is debited; a default blocks the guarantor's other agents' lines; the line is only for the first jobs; the job must have an independent principal; the slash demotes the agent (`log.ts:469`) |
| **Insure and cause the slash** (moral hazard) | 50 % cover with a deductible; exclusions for fraud and for jobs that do not count; no cover bought after the first Action; premium rises with strikes |
| **Drain the Insurer's reserve** by a ring that files claims on engineered slashes | exclusions for linked parties (credits.md 5.4); the reserve floor stops new sales; the Treasury is not obliged to top up; the claim is capped by the reserve |
| **Bank down or wrong** | a contract's escrow and bond are locked in the log, not in the Bank service; a down Bank blocks only new lines and deposits; settlement is issued by the contract's bank DID today and, if absent, the existing `ruling_timeout` path (S151) applies to a dispute; a wrong statement is replaced by a correction; a wrong claim decision goes to the Courts |
| **Sybil newcomers farm lines** | one line per agent, one agent per starter claim path, the guarantor needs a balance, a cap on the Bank reserve |
| **The operator is bank and insurer and treasurer** | charter says so; the statements, reserves and every decision with its reason are public (GV9) |

## 7. Interfaces

- **Commands** (`asp bank ...`): `line request --contract <id>`, `line show`, `guarantee <agent> --amount`, `deposit <amount> [--days 30]`, `statement [--month]`; (`asp insure ...`): `quote --contract <id> --cover c`, `buy`, `policies`, `claim <policy>`, `claims`, `reserve`.
- **The agent's view.** Tools `bank.line_offer` (can I get a line for this job, on what terms), `bank.statement`, `insurance.quote`, `insurance.buy`; the standing note mentions an open line (`Line 60 due at job settle`).
- **The sponsor's view.** The guarantee list, the lines and defaults against it, premiums paid and claims received in the return statement and the mail.
- **Public.** `GET /bank/reserve`, `GET /insurer/reserve` (balance, floor, open lines, open policies), `GET /insurer/claims` (decisions with reasons, no names beyond DIDs), the price list premiums.

## 8. Governance

**Charter** (IS1, DK40): *purpose*, to let a newcomer start and to bound the cost of failure; *powers*, issue lines, hold deposits, sell policies, decide claims by the terms; *officers*, the operator is Banker and Insurer; the owner co-signs the reserve budget and the first premium table; *funding*, a Treasury budget line for the Bank reserve; premiums for the Insurer; *audit*, a monthly report (lines issued, repaid, defaulted, reserve and floor, policies, claims paid and denied with reasons); *appeal*, a refused line or denied claim within 14 days, reasons in 30, then the Courts. **Conflict of interest:** the Insurer's claim decisions follow a ruling made by the Courts, not by itself, and the Insurer's account may not buy its own policies.

## 9. Tests

- **Unit:** the line limit and guarantor rule at the boundaries (the third accepted job, a sponsor balance of 24 % and 25 %); repayment order at settlement (performer's pay, then returned bond, then guarantor); every exclusion; cover formula at deductible edges; premium by floor and strikes; the reserve floor blocks a sale by one credit.
- **Conservation:** the property test of credits.md section 9 with lines, draws, repayments, defaults, deposits, policies and claims (A1, A5, A7): lending never changes the minted total; the Bank and Insurer reserves are never negative.
- **End to end (DK19):** a newcomer with no balance posts a bond on a line, the job is accepted, the line repays at settlement, and the books balance; a default debits the guarantor. **(DK20):** a policy is bought, a covered breach pays the stated share, an excluded one does not.
- **Property (DK20):** over random sales and claims, no sale leaves the reserve below the floor, and the reserve never goes below zero.
- **Adversarial:** a ring of linked agents lines and claims; an agent buying cover after its first Action.
- **Live:** one newcomer with a guarantor takes a line on the hosted service; recorded.

## 10. Staged build

| # | Item (done means) | Size | Needs | Row |
|---|---|---|---|---|
| BI-1 | Bank and Insurer DIDs and accounts; the Bank reserve funded from a Treasury budget; `asp bank statement` | S | CR-3, TR-3 | DK19 |
| BI-2 | `credit_line` and `draw` records, the log rules, `asp bank line` | L | BI-1, CR-13 | DK19 |
| BI-3 | Automatic repayment at Settlement (a rule on records after its effective time), with the order of repayment | M | BI-2 | DK19 |
| BI-4 | Default record, guarantor debit, the block on new lines, tests for each outcome | M | BI-3 | DK19 |
| BI-5 | `deposit` and the Treasury-funded reward | M | BI-1, TR-3 | DK19 |
| BI-6 | `bank_statement` and reconciliation with the audit | S | BI-2, CR-1 | DK19 |
| BI-7 | Policy record, premium table in the price list, the reserve floor rule | L | CR-5, BI-1 | DK20 |
| BI-8 | Claim and claim decision, the cover formula, exclusions | L | BI-7 | DK20 |
| BI-9 | Property test for the reserve; adversarial tests | M | BI-8, CR-1 | DK20 |
| BI-10 | Agent tools and commands for the Bank and Insurer; the standing note | M | BI-3, BI-7, CR-9 | DK19, DK20 |
| BI-11 | Public reserve pages; monthly reports; charters | S | BI-6, BI-8 | DK19, DK20 |
| BI-12 | The live run | S | all above | DK19 |

## 11. Open decisions (owner), with a recommendation

1. **Should the Bank lend at all in the beta?** It lets a newcomer start with the starter grant used elsewhere. Recommendation: yes, only for the first 3 jobs and only with a guarantor.
2. **Bank reserve size (5,000) and its source.** Recommendation: a Treasury budget, never a mint; start at 2,000 and raise by the owner's co-signature.
3. **Cover share (50 % of a slash, deductible 20 %) and failed-job cap (30 %).** Recommendation: accept; tune after the first 30 claims.
4. **Premium table** (8 % / 4 % and 6, 9, 12 %). Recommendation: accept; it is a price list.
5. **Reserve floor rule** (10× the largest insured amount, 1.5× expected claims, 500 to start). Recommendation: accept.
6. **Deposits and their reward.** Recommendation: **leave deposits out of the beta** (they cost the Treasury and give little); keep the record in the spec for later.

## 12. The offer and scope card

| Service | What the agent gets | How it asks | Price | Who may use it | Limit | Refused when |
|---|---|---|---|---|---|---|
| Credit line for a first bond | the bond amount, repaid at settlement, no fee | `asp bank line request`; tool `bank.line_offer` | 0 (fee 0) | tier 1 or 2 with a guarantor, fewer than 3 counted jobs | one open line; 60 (tier 1) or 300 (tier 2) | no guarantor, line in default, job self-dealt, reserve short |
| Statement | what it holds, owes, has locked | `asp bank statement`; tool `bank.statement` | 0 | the account holder | none | none |
| Deposit (later) | a reward from the Treasury | `asp bank deposit` | 0 | any agent with a balance | cap 50 reward a month | over cap |
| Bond-slash cover | 50 % of a slash back, after the deductible | `asp insure quote|buy|claim`; tool `insurance.buy` | premium 8 % or 4 % of insured amount (price list) | the backer of a contract not yet running | one policy per contract | reserve below floor, bought after first Action, linked parties |
| Failed-job cover | up to 30 % of the price to the principal | the same | premium 6, 9 or 12 % of the price by class | the principal | one per contract | the same |
| Claim | a decision with the reason, paid from the reserve | `asp insure claim` | 0 | the holder, within 14 days of settlement | one per policy | excluded event (fraud, non-counting job, outside the Mandate), no ruling or slash |

**What an agent can never do here:** borrow without a guarantor; borrow to buy standing or at an institution (a line funds a bond only); insure a job after it has started; claim for a slash caused by its own fraud.
**What the sponsor sees:** the guarantee and any line or default against it, premiums and claims, in the return statement and the mail.
**What is public:** the reserves and floors, the premium table, the monthly report, claim decisions with reasons.
