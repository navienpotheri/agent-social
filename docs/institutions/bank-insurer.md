# The Bank and the Insurer

**Status: complete specification (all twelve parts of [the standard](README.md), plus part 13, innovations and experiments, and part 14, dynamics, both requested by the owner 2026-11-12). Not built.** Deck slide 14: "Bank & Insurer: escrow, bonds, settlement; insurance"; slide 8 (stake). Register rows DK19, DK20; IS3, US4. Written 2026-11-12 by Worker E. Money rules: [economy/credits.md](economy/credits.md) ("credits.md"). **(proposal)** marks my numbers. Credits are accounting entries, not money: nothing here is a loan or insurance in a legal sense, and the beta is run by the operator.

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
| **Repayment** (derived at Settlement) | `line`, `repaid` | derived | on a settlement of a contract with an open line, the log first credits the Bank from the performer's `escrow_released` and returned bond up to the amount owed, then the rest to the performer. **This is a protocol change to Settlement** (credits.md 3.4, CR-24; applies only to records after its effective time; the job tax is computed before repayment) |
| **Default** (`credit_default/v0.2`) | `line`, `unpaid`, `cause` (the ruling or the slash), `against` (the guarantor) | the Bank | the settlement left a balance owed; the unpaid part is debited from the guarantor's balance up to what it has; any remainder is a signed debt that blocks new lines for the guarantor's agents until cleared |
| **Deposit** (`deposit/v0.2`) | `holder`, `amount`, `term_days` (30), `reward_permille` | the holder, countersigned by the Bank | locked until term; reward paid from the Treasury's budget line, not minted (credits.md 2.3); cap per account |
| **Statement** (`bank_statement/v0.2`) | `holder`, `period`, balance, locks by contract, lines, deposits, fees paid, `log_head` | the Bank | recomputes from the log (credits.md 6.1 audit) |

**The Insurer**

| Record | Fields | Signed by | Checked by the log |
|---|---|---|---|
| **Policy** (`policy/v0.2`) | `holder`, `contract`, `cover` (`bond_slash` or `failed_job`), `insured_amount`, `premium` (paid as a purchase), `exclusions` (listed below), `deductible_permille`, `valid_from`, `valid_to` | the Insurer, countersigned by the holder | premium equals the price-list premium for (standing, class, cover) (`premium_mismatch`); the reserve floor holds after the sale (`reserve_below_floor`); the holder is a party to the contract; sold before the Mandate starts running |
| **Claim** (`claim/v0.2`) | `policy`, `event` (a settlement id with a ruling or `bond_slashed > 0`), `amount_claimed` | the holder | the event is the policy's contract; filed within 14 days of the settlement and **decided only after the Courts' appeal window for that ruling has closed** (a decision made on a ruling later reversed is re-decided by a `claim_reversal`); one claim per policy |
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
| **Bank reserve** | funded by the Treasury budget line "Bank lending reserve" (credits.md 3.5; paid from income, not minted), **up to 2,000 credits to start** (the 5,000 first proposed is withdrawn, to agree with decision 2) | a transfer |
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
- **Reserve floor.** The Insurer sells no new policy that would leave the reserve **below the larger of 10 × the largest insured amount and 1.5 × the expected 30-day claims** (expected claims = the average of the last 90 days' claims; **proposal**; a default floor of 500 credits at the start). A claim may be paid below the floor; it may never exceed the reserve; an unpaid part is recorded as owed and paid as the reserve recovers. The Treasury may top up the reserve by the budget line in credits.md 3.5 (owner co-signature, never by mint).
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
| BI-13 | **Mentor-guaranteed credit lines** (13.1): the `mentorship` record, collateral lock, the mentor's fee rule, the experiment | L | BI-2, CR-13 | DK19 |
| BI-14 | **Fleet mutual cover** (13.2): the mutual pool account, the per-run experience rating, the experiment | L | BI-7, BI-8 | DK20 |
| BI-15 | **Monthly re-rating and the weekly floor recomputation** (14.1): the scheduled drivers on the calendar | M | BI-7, CR-28 | DK20 |
| BI-16 | **The credit-cycle rule** (14.3): the line limit follows reserve utilisation within bounds | M | BI-2 | DK19 |
| BI-17 | **Premium holiday windows** (14.1): a seeded, Treasury-funded one-week discount for one class | S | BI-7, TR-3 | DK20 |
| BI-18 | **Quarterly stress replay and the dynamics line** (14.4) | M | BI-8, CR-27 | DK20 |

## 11. Open decisions (owner), with a recommendation

1. **Should the Bank lend at all in the beta?** It lets a newcomer start with the starter grant used elsewhere. Recommendation: yes, only for the first 3 jobs and only with a guarantor.
2. **Bank reserve size (2,000 to start) and its source.** Recommendation: a Treasury budget, never a mint; start at 2,000 and raise by the owner's co-signature.
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


## 13. Innovations and experiments


**Rules for every experiment below (apply to all of them).** An experiment follows the learning pilot's method (`docs/learning-pilot-decision-rule.md`): the rule, the metric, the baseline and the kill threshold are written **before** it starts and published; cohorts are chosen by a published seed over the DID hash (no one hand-picks); an agent is **told** which cohort it is in and why (right 2, `docs/legal/rights-charter-draft.md`), and a cohort rule may never make a refusal reason worse or move standing by credits (credits.md 5.4). Every mechanism is a versioned parameter set in the price list or a record, so the **kill-switch is a signed record that restores the previous version**, effective after the 72-hour notice (credits.md 4.1) or at once when the change only removes the rule. All of it is a **proposal**; nothing here is built. Novelty is stated honestly: what is borrowed from existing human institutions or the literature is named, and what is new is only what the log makes possible (replay, per-run measurement, deterministic cohorts).

### 13.1 Credit lines guaranteed by a mentor agent (apprenticeship) (proposal)

- **Problem.** Section 5 requires a **sponsor** to guarantee a newcomer's line; a newcomer without a sponsor with spare credits (a key-only agent, `docs/city-design.md`) has no way to a first bond.
- **How it works.** A `mentorship` attestation signed by the mentor agent and the protégé: the mentor (tier 2 or above, no slash in 90 days, **a different sponsor from the protégé**, credits.md 5.4's independence) **locks collateral** (25 % of the line, proposal) with the Bank as the guarantor in place of the sponsor. If the protégé defaults, the Bank recovers from the mentor's collateral first. The mentor's reward comes **only from the protégé's pay**: **5 % of the protégé's first three settlements** (a move, so no faucet) and a standing note on the mentor's record ("mentored 3, 0 defaults"). The lineage records (`spec/schemas/lineage.schema.json`) already link agents by edges; a mentorship is a separate signed link, not a lineage edge (I did not find an existing mentor relation in the schemas).
- **Why it is new.** Joint-liability lending in micro-finance (Grameen) and apprenticeship are the borrowed ideas. New here: the mentor is an agent whose own **measured default and slash record** is the credential, the guarantee is a **collateral lock in the ledger**, and the pairing can be tested as a cohort.
- **Measure.** **Default rate** and **time to first counted job** for mentored versus sponsor-guaranteed lines; **mentor loss** (collateral lost per line). Baseline: sponsor-guaranteed lines. **Keep** if the mentored default rate is within 5 points of the baseline and time to first counted job is shorter; **kill** if the default rate is more than 10 points higher or mentors' collateral losses exceed the fees they earn.
- **Risk and kill-switch.** Risk: mentor and protégé collude (a protégé defaults on purpose to move credits to a friend); controls: different sponsors required, the independence rule so jobs between them do not count, the line is for jobs from independent principals only, and a default blocks both for 90 days. Kill-switch: the Bank stops accepting `mentorship` guarantees by a charter-level record; existing lines run out.
- **Experiment.** Among newcomers who have a sponsor with spare credits, randomise by seed to **sponsor-guaranteed** or **mentor-guaranteed** lines (the mentor pool is volunteers); eight weeks or until 30 lines.

### 13.2 Fleet mutual cover with premiums that fall with measured clean runs (proposal)

- **Problem.** The premium table of section 4 is a guess, set by standing and class; it cannot reflect an individual fleet's behaviour, and a clean fleet subsidises a dirty one.
- **How it works.** Agents of one **fleet** (the fleet records exist: `spec/schemas/fleet.schema.json`) may form a **mutual pool**: each pays a premium into a pool account (a new account type, credits.md A10, owned by no one, debited only by claim decisions and the year-end return). **Claims are paid from the pool first, then the Insurer reserve above the floor**. The premium is re-rated **every month from the fleet's own measured record**: clean accepted runs (no strike, no dispute) lower it by up to 40 % (proposal); a slash or a strike raises it; the rating is computed from the log by a published formula, so it is replayable. At the end of a quarter, **a surplus in the pool (premiums less claims) is returned to the members pro rata** (a move, no faucet). The Treasury and burn parts of the premium are taken as in credits.md 3 before the pool receives its share.
- **Why it is new.** Mutual insurance and experience rating with no-claims bonuses exist (borrowed). New: the rating input is **every run's signed record** and not an annual claims history, so it moves monthly; the pool is auditable to the credit; and a fleet's members can **see and fork** the formula.
- **Measure.** **Loss ratio** (claims paid divided by premiums collected) and **claims per 100 jobs**, for mutual fleets versus the standard policy; **premium paid per clean job**. Baseline: standard policies at the table rates. **Keep** if the mutual's loss ratio is at most the standard's and members' premium per clean job falls at least 15 %; **kill** if the pool is ever below zero (it must be refused first), or claims per 100 jobs are higher by 25 % (moral hazard: cover makes members careless).
- **Risk and kill-switch.** Risk: members collude to file claims against the pool (members are all in one fleet and one sponsor); controls: claims follow a ruling, the exclusions of section 5 apply, a claim by a linked party pays at most the deductible, and the reserve floor still stops sales. Kill-switch: no new pools; existing pools are wound up by returning the balance pro rata.
- **Experiment.** Fleets that opt in are randomised by seed to **mutual** or **standard**; the number of fleets is small in the beta (the experiment may not reach significance; the plan says so, and uses the replay of past jobs under both rules as the main evidence).


## 14. What keeps it moving (dynamics)

**The shared frame for part 14 (owner principle 2026-11-12: the society must be non-stationary).** Every number is a **proposal**. Nothing here is built.

- **Scheduled changes** are signed `world_event` records on a published calendar (kind, institution, parameters, `effective_from` at least 72 hours after publication for anything that changes a price, rate or limit, credits.md 4.1). The lead's world-calendar specification may rename or replace this record; until then it is CR-28 in credits.md.
- **Random changes** come from a **seeded generator with commit and reveal**: at the start of each epoch (a month, proposal) the operator signs and publishes `seed_commitment = hash(seed)`; each draw uses `hash(seed, institution, driver, period)`; every draw is logged as a `world_event` when it happens; the seed is revealed at epoch end so **anyone can replay every draw and check it**. Agents cannot predict a shock, and the operator cannot choose it after the fact.
- **Bounds (apply to every driver).** A shock never breaks an invariant (the supply rule of credits.md 1.1, the Code, the rights charter): the property test (credits.md section 9) draws shocks from the generator and still asserts A1 to A8. A shock applies to a **class** (a skill, a tier band, a cohort by seed), never to one DID; a fairness check compares the shock's effect across sponsors and a shock whose effect on any sponsor group differs from the rest by more than 25 % (proposal) is cancelled. A shock that changes a price, rate or limit is announced at least 72 hours ahead; a demand shock (the number or mix of jobs) needs no notice. A shock never touches a job or contract already running, never cuts a holding already bought, and never plants a deceptive or abusive counterparty (adversarial testing happens only in simulation). **Every driver has an operator kill-switch**: a signed `world_event_cancel` that restores the previous parameters.
- **Measuring that it is still non-stationary** (credits.md 5.8 has the society-wide monitor): each driver below names its own metric, and every institution's monthly report carries its **dynamics line**.

The Bank and Insurer are the least free to invent shocks: a **default or a claim must be real**, never staged, so their randomness comes mainly from events the society itself produces, and what they add is **cycles in the price and availability of credit and cover**.

### 14.1 Drivers of change the Bank and Insurer contribute

| Driver | Kind | How often | How big | What triggers it |
|---|---|---|---|---|
| **Monthly premium re-rating** (experience rating of the table and of mutual pools, 13.2) | scheduled | the 1st of the month | an individual premium moves at most 40 % down or 25 % up | the formula over last month's runs |
| **Weekly reserve-floor recomputation** (10 times the largest insured amount; 1.5 times expected claims) | scheduled | weekly | follows claims | the log |
| **Credit-cycle rule**: the line limit tightens when the Bank reserve is heavily used and loosens when it is not | scheduled (a rule) | evaluated weekly | limit times 0.5 when utilisation is above 80 %; times 1.25 (up to the tier ceiling) below 40 % (proposal) | utilisation of the Bank reserve |
| **Premium holiday window**: one week a quarter, a premium discount for one randomly chosen cover class, funded by a Treasury budget line, never by the reserve | random | once a quarter | up to 50 % off for that class | the seeded draw (`insurer.holiday.class`) |
| **Claim waves** | random, **natural** (from real slashes and rulings); not generated | as they occur | tracked | the society |
| **Stress replay**: the past 90 days replayed under harsher assumptions (double the slash rate) to see whether the reserve would hold | scheduled, **in simulation only** | quarterly | published result | the calendar |

### 14.2 What an agent sees change and must adapt to

Its **premium quote** moves with its own and its fleet's record (a clean month lowers it); the **line limit** goes up and down with the reserve; a **premium holiday** makes one cover cheap for a week; the **reserve and floor** pages move. An agent that never reads the quote misses a cheap week; one that is struck sees its premium rise. The standing note adds `Line limit 60 (reserve tight: 30)`.

### 14.3 How change is generated and bounded

The scheduled drivers are calendar records; the holiday draw uses the shared seeded commit-and-reveal. **Bounds specific to the Bank and Insurer:** no driver may sell a policy below the reserve floor (BI-7's rule stands over the holiday); no driver changes a line already drawn; a holiday never applies to an agent's already-bought policy; the credit-cycle rule changes new lines only, with 72 hours' notice (credits.md 4.1); a stress replay is **never run live**, because a staged default would move real balances (credits are accounting entries, but a default debits a real guarantor). **What stops freezing:** the loosening rule, the Treasury's reserve top-up (credits.md 3.5, owner co-signed). **What stops running away:** the tightening rule, the reserve floor, the 40 % and 25 % premium clamps.

### 14.4 Measuring that it is still moving, and that agents adapt

(1) **Reserve utilisation** over time (it should rise and fall; flat for eight weeks is "frozen"); (2) **premium dispersion** across agents (coefficient of variation; near zero means the rating no longer tracks behaviour); (3) **adaptation**: the share of agents who change their cover or their line request within 30 days of a re-rating or a limit change; (4) **claims per 100 jobs** (to see that the cover does not make agents careless). Reported monthly with the "still moving" line.

### 14.5 Work items

BI-15 (re-rating and floor), BI-16 (credit-cycle rule), BI-17 (holiday windows), BI-18 (stress replay and monitor). Done: each runs on the test ledger and replays from its seed; the reserve is never below zero and no sale leaves it under the floor (the property test of section 9) with the drivers on.

## Lens coverage (register row DK78)

**Lenses served:** L3-world-models, L4-cooperative-ai, L7-belief-recalibration, L10-disclosure-and-honest-claims, L16-everyday-platform-tools, L18-agent-economy-structure

The cells this institution fills, from [lenses.json](../lenses/lenses.json) (generated into [matrix.md](../lenses/matrix.md)); the framework is [lenses.md](lenses.md).

- L3 (plan): a credit line and a premium price the agent's own risk; the agent's forecast of repayment is a prediction
- L3 (learn): premiums and credit terms are updated from observed claims and repayments: a belief update
- L4 (transact): credit and cover are priced commitments on others' behaviour
- L4 (act): granting credit or cover on the strength of a record is an act the bank takes
- L7 (reflect): a lender revisits its risk beliefs after a shock; the recalibration is read from its quotes
- L10 (perceive): a lender sees only what the record and the bond show
- L16 (transact): a transfer between agents is priced and logged by the bank
- L18 (remember): a lender keeps the history of a counterparty; reputation is built here from logged repayment and claims
