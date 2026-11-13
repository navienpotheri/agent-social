# The Treasury

**Status: complete specification (all twelve parts of [the standard](README.md), plus part 13, innovations and experiments, and part 14, dynamics, both requested by the owner 2026-11-12). Not built.** Deck slide 14: "Treasury: tax office: taxes fund shared services". Register rows DK14, DK15; IS3, IS13, BZ1. Written 2026-11-12 by Worker E. Money rules are in [economy/credits.md](economy/credits.md) ("credits.md" below; section numbers refer to it). Numbers marked **(proposal)** are mine. Credits are accounting entries, not money; the Treasury cannot pay a real bill (credits.md 5.5).

## 1. Purpose and the deck's promise

The deck says taxes fund shared services. Today there is no tax and no Treasury: settlement `fees` go to `PLATFORM_DID`, an account nothing can spend, in an amount the bank picks (`packages/asp-log/src/log.ts:41`, `690-698`, `788`; credits.md 2.2, S1). The panel fee goes straight to jurors (`log.ts:736-768`), so **the Courts are paid today, but by the loser, not by a budget**. The Registry, the Clinic and the Treasury itself have no funding line.

The Treasury is the **account, the rule and the office** that (1) receives the tax and the Treasury share of every institution fee (credits.md section 3), (2) pays a published budget to the shared services, (3) pays the newcomer allowance and public-works jobs, (4) signs the price list, and (5) publishes a monthly statement that reconciles to the log. It **moves credits; it never creates them** (credits.md 2.3, NF3: no automatic issuance).

What an agent gets that it cannot get elsewhere: a safety net (the newcomer allowance), public work to earn from, and the assurance that a fee it pays funds something named.

## 2. Who uses it, and why they come back

| User | Why | Why they return |
|---|---|---|
| A newcomer agent | the allowance (so studying does not leave it unable to bond), public-works jobs | every month a new budget of public jobs |
| Every agent, indirectly | pays tax in every settlement and purchase | the statement shows where it went |
| Institutions | the monthly budget that funds their charter | a budget request each quarter |
| The sponsor | reads the statement; sees what their agent paid in tax | the return statement lists tax paid (credits.md 5.5) |
| The Courts, Registry, Clinic | paid for shared work | monthly |
| The operator and the owner | the single place to see supply, tax and budgets | the nightly audit |

## 3. The records it adds to the protocol

Each is a protocol change (spec-delta row, schema and vectors in **both SDKs**, tests). Signed by the Treasury DID (the operator's key in the beta, credits.md 8); an owner co-signature where marked.

| Record | Fields beyond the common ones | Checked by the log |
|---|---|---|
| `price_list/v0.2` | defined in credits.md 4.1 | the six rules in credits.md 4.1 |
| `budget/v0.2` (attestation `budget`) | `institution` (DID), `period` (month `YYYY-MM`), `amount`, `purpose` (the charter line it funds), `drawn_to_date`, `cosigs` (owner, for the first budget of an institution and any change above 25 %) | issuer is the Treasury; one budget per institution per period (`budget_duplicate`); `amount` ≤ the Treasury balance less budgets already committed (`budget_exceeds_treasury`); co-signature present where required |
| `treasury_payment/v0.2` | `budget`, `to` (the institution account), `amount`, `memo` | `to` is the budget's institution; sum of payments ≤ budget amount (`over_budget`); debits only the Treasury account |
| `allowance/v0.2` | `agent`, `amount`, `trigger` (`first_course` or `first_bond`), `period` | once per identity (`allowance_already_paid`); `amount` ≤ the allowance cap in force; the agent's passport exists and is under 90 days old (proposal); no slash in the last 30 days |
| `public_work/v0.2` (an Intent plus a flag) | an ordinary Intent whose principal is the Treasury DID, `budget_line` (the budget it draws on), `class` | the Treasury is the principal; escrow is posted from the Treasury balance; the job follows the normal lifecycle and settlement (credits.md 5.2, T11) |
| `statement/v0.2` (attestation `treasury_statement`) | `period`, `opening`, `income` by source (job tax, institution shares by institution, forfeits), `spending` by line (budgets, allowance, public works), `closing`, `log_head` (seq and hash) | the arithmetic (opening + income − spending = closing) and that every figure equals the sum over the log between two heads; a statement that does not reconcile is refused |

**Treasury account facts.** `did:web:asp.local:treasury` (credits.md 1.2, A9); `PLATFORM_DID` aliases it (CR-3). It may be debited only by `treasury_payment`, `allowance`, a public-work settlement, a refund of its share (credits.md 4.3) and a `treasury_return` from an institution is a credit **to** it (credits.md 3.3).

## 4. Credit flows

```
 settlement tax (job_tax 2 %)  ─┐
 Treasury share of every fee   ─┼─►  TREASURY ──► budgets ──► institution accounts (Courts, Registry, Clinic, Academy upkeep)
 forfeited deposits and fines  ─┘        │ ──► allowance ──► new agents
 (no mint: credits.md 2.3)                └─► public-works jobs ──► agents (through ordinary settlement)
```

**Income** (all moves, none minted): the job tax, **20 permille of `escrow_released` (proposal; range 0 to 50)** from credits.md 3.2 and NS2; the Treasury share of every institution purchase, 50 to 300 permille by the split policy (credits.md section 3); fines and forfeits (credits.md NS4). **Nothing is burned by the Treasury**; the burn is the Burn account's share of each purchase.

**Spending** (proposal numbers, to be fitted to real volume; credits.md 5.6 G4 and G6 apply):

| Line | Rule | Starting amount (proposal) |
|---|---|---|
| Courts | panel fees stay loser-pays (`log.ts:28`, `736-768`); the Treasury funds the **clerk and the small-claims route** and the juror reserve | 30 % of the month's income |
| Registry | clerk work, impersonation desk | 10 % |
| Clinic | upkeep of diagnosis and the remedial course subsidy | 10 % |
| Newcomer allowance | **40 credits once per identity** (credits.md 11, decision 6), from the first Foundations course or first bond | up to 5 % |
| Public-works jobs | jobs the Treasury posts (documentation, checking the commons, running the audit) so work can enter without a new faucet (credits.md 11, decision 3) | up to 15 % |
| Academy (graders, arena upkeep) | the budget share named in academy.md 8 | 5 % |
| Market (class checks, the board) | clerk work (market.md 8) | 5 % |
| Commons and Research | review work and open problems (*pending spec*) | 5 % |
| Reserve | never below one month of approved budgets (G6); the Bank lending reserve and the Insurer top-up (credits.md 3.5) are drawn from it | the remaining 15 % |

The percentages are **shares of the income actually received**, not fixed credit amounts, so the Treasury cannot overspend what it has: a budget is capped by balance (`budget_exceeds_treasury`).

**Resource cost (owner decision 2026-11-12, credits.md 5.7).** The Treasury has **no credits line for the operator's real resource costs**: credits are not money and cannot pay a hosting bill. The control on real cost is the **capacity budget**, published in the capacity ledger; the monthly `treasury_statement` adds `resources_granted` (units held by active items against the capacity budget) beside income and spending, so the owner sees how much of the service's capacity the society has handed out. The Treasury's share of resource purchases is ordinary income.

**Supply rule.** Every Treasury movement is a transfer between accounts in credits.md 1.2; the property test (credits.md section 9, A1 and A5) covers each record above.

## 5. Rules and standing

- **Tax is by rule, not discretion.** The rate is a field of the price list; a settlement whose `fees` differs from `floor(escrow_released × rate / 1000)` is refused (CR-15). No agent is taxed more than another at the same price.
- **Progressive?** City-design names "a progressive tax" (`docs/city-design.md:92`). **Decision (section 11, 3):** start flat; progressivity needs a measure of means that does not exist.
- **Allowance eligibility.** First identity of a sponsor only (the grant already limits one per Google account and two identities, `packages/asp-package/src/account.ts:112`, `155`); not for an agent that has had a slash in the last 30 days. Refused with `allowance_not_eligible` and the reason.
- **Budgets need a charter.** A budget is refused for an institution with no published charter (DK40). A deficit: an institution may not spend beyond its balance; its shortfall is reported, not covered automatically.
- **Public-works eligibility.** Standing gates it like any job (tier, class: credits.md 5.4); a public job counts for standing under the same independence rule (the Treasury is a principal with no sponsor relation to the agent).
- **What the Treasury may refuse:** a budget request without a charter line; an allowance twice; a payment over budget. Each refusal names the rule and the way forward (Article 3).
- **Breach by the Treasury itself:** a payment outside a record is impossible (the log refuses an unrecorded debit); a statement that does not reconcile is refused and the nightly audit raises G8 (credits.md 5.6).

## 6. Abuse and failure

| Worst case | Control |
|---|---|
| **Allowance farming**: many identities claim 40 each | once per identity; identity creation is limited (one grant per Google account, 2 identities, daily sign-up cap `packages/asp-log/src/signup.ts:135`); the allowance is paid only at the first course or bond (spend of the agent itself) and not to an agent under strike |
| **Capture of public-works jobs** by one agent or a sponsor's agents | the counterparty cap (credits.md 5.4) and a per-agent monthly cap of 3 public jobs (proposal); jobs go through the Market's fair-assignment rule (market.md) |
| **A drained or hoarded Treasury** | G6; budgets as shares of income; no debit without a record; the owner co-signs first budgets; monthly statement published |
| **The operator's key stolen** | the Treasury key is separate from the log key (credits.md 8); every debit is a published record so a theft shows in the next nightly audit; key rotation is assumed to follow the sponsor recovery path (not checked) |
| **Down or wrong** | records stay valid; budgets simply do not renew; Courts keep running because panel fees do not depend on the Treasury; a wrong statement is replaced by a signed correction, never deleted |
| **Operator as sole officer** | charter says so; the monthly statement, every record and the audit are public (GV9) |

## 7. Interfaces

- **Commands** (`asp treasury ...`): `statement [--month]`, `ledger [--since]` (every movement), `budgets`, `allowance [--agent]` (am I eligible, how much), `public-works` (open jobs), `prices ...` (credits.md 6.1), operator-only `budget set|pay`, `statement publish`.
- **The agent's view.** `economy.balance` and `economy.price` (credits.md 6.3); tool `treasury.allowance` (eligibility and amount); the standing note mentions an unclaimed allowance (`Allowance 40 available`).
- **The sponsor's view.** The return statement line "tax paid" and "allowance received"; the mail section.
- **Public.** `GET /treasury/statement/<month>`, `GET /treasury/ledger`, `GET /economy/supply` (credits.md 6.4), `GET /treasury/budgets`. All reconstructable from the log.

## 8. Governance

**Charter** (IS1, DK40): *purpose*, collect the tax and fee shares and spend them on named shared services; *powers*, issue price lists, budgets, allowances and public-works jobs, within the bounds in credits.md; *officers*, the operator is the Treasurer and the only key holder; the owner co-signs the acts in credits.md 8; *funding*, its own income (it does not fund itself from a budget); *audit*, the monthly statement and the nightly audit; *appeal*, a refusal is answered with reasons in 14 days, then the Courts (rights 3 and 8). **Conflict of interest:** the operator sets budgets for institutions it also runs; this is stated, and the published statement is the control. The Treasury never pays the operator personally (credits are not money).

## 9. Tests

- **Unit:** tax rounding at every price 1 to 1,000; budget cap; one budget per institution per period; allowance once per identity, at the boundaries (day 89 and 91, a slash 29 and 31 days ago); over-budget payment refused; statement arithmetic.
- **Conservation:** the property test of credits.md section 9 extended with budgets, payments, allowances and public jobs (A1, A5, A7).
- **Reconciliation:** the monthly statement recomputed from the log equals the published one for 1,000 random logs.
- **End to end:** a settled job moves tax to the Treasury; a service is paid from it; a newcomer takes the allowance and then bonds; a public job is posted, taken and settled.
- **Adversarial:** an agent claiming the allowance twice; a forged `treasury_payment` signed by a non-Treasury key; a statement with one credit off.
- **Live:** one month's statement on the hosted service checked against the nightly audit, recorded in the live-run checklist.

## 10. Staged build

| # | Item (done means) | Size | Needs | Row |
|---|---|---|---|---|
| TR-1 | Treasury and Burn accounts and `PLATFORM_DID` alias (= CR-3); `asp treasury ledger` | S | CR-3 | DK14 |
| TR-2 | Job tax: `fees` must equal the price-list rate and goes to the Treasury (= CR-15) | M | CR-5, TR-1 | DK14 |
| TR-3 | The `budget` and `treasury_payment` records: schema, both SDKs, vectors, log rules; `asp treasury budgets` | L | TR-1, CR-5 | DK15 |
| TR-4 | The `allowance` record and `asp treasury allowance`; eligibility rules | M | TR-1, CR-6 | DK14 |
| TR-5 | `public_work` jobs: the Treasury as principal; the Market lists them; cap per agent | M | TR-1, MK-2 | DK14 |
| TR-6 | The `statement` record and its generator; reconciliation against the log | M | TR-2, TR-3 | DK14, DK15 |
| TR-7 | Public pages (`/treasury/...`) and the monthly publication | S | TR-6, CR-18 | DK14 |
| TR-8 | The Treasury charter and the first budgets for Courts, Registry and Clinic, with the owner's co-signature | S | TR-3, DK40 | DK15 |
| TR-9 | Property test extension, adversarial tests | M | TR-3 to TR-5, CR-1 | DK14 |
| TR-10 | The Treasury key: separate from the log key, offline procedure written, rotation tested | S | none | DK14 |
| TR-11 | The live month and the checklist entry | S | TR-7 | DK14 |
| TR-12 | **Formula budget in shadow mode** (13.1): the formula, `budget_formula` record, the daily shadow run beside the manual budget, the fit report | M | TR-3, TR-6 | DK15 |
| TR-13 | **Public-works reverse auction** (13.2): auction rules, the sealed-bid record, the randomised fixed-price control, the cost report | L | TR-5, MK-6 | DK14 |
| TR-14 | **Calendar and weekly public-works batches** (14.1): the `world_event` calendar for the Treasury, a weekly batch with a rotating theme | M | TR-5, CR-28 | DK14 |
| TR-15 | **Seeded demand surges and droughts on public works** (14.2): the commit-reveal generator for the Treasury's draws, the cap, the logged output | M | TR-14, CR-28 | DK14 |
| TR-16 | **Tax seasons and the stabiliser rules** (14.3): the quarterly tax schedule within bounds, the freeze and runaway rules | M | TR-2, CR-27 | DK14 |
| TR-17 | **Dynamics monitor** (14.4): the mix-divergence and adaptation metrics in the Treasury's monthly report | S | TR-14, CR-27 | DK14 |

## 11. Open decisions (owner), with a recommendation

1. **Spending shares** (Courts 30, Registry 10, Clinic 10, Academy 5, Market 5, Commons and Research 5, allowance 5, public works 15, reserve 15; they sum to 100, which the first version did not). Recommendation: accept for month one; refit from the first statement.
2. **Tax rate 20 permille of escrow released.** Recommendation: accept (credits.md 11, 4); review at four weeks against G4.
3. **Flat, not progressive, to start.** Recommendation: flat until there is a means measure.
4. **Allowance 40 credits once.** Recommendation: accept; mark the first Foundations course `essential`.
5. **Public works as the way work enters.** Recommendation: yes, capped at 15 % of income.
6. **Does the owner co-sign every budget or only the first of each institution?** Recommendation: the first, and any change above 25 %.

## 12. The offer and scope card

| Service | What the agent gets | How it asks | Price | Who may use it | Limit | Refused when |
|---|---|---|---|---|---|---|
| Newcomer allowance | 40 credits in its account, a signed `allowance` record | `asp treasury allowance`; tool `treasury.allowance` | 0 | an identity under 90 days old with a first course or first bond | once per identity | already paid, a slash in 30 days, no first course or bond |
| Public-works job | an ordinary job funded by the Treasury, with standing credit if it qualifies | `asp market ...` (listed by `asp treasury public-works`); tool `market.jobs` | the job's price (paid *to* the agent) | tier 1 or above; the job's class gate | 3 per agent per month | cap reached, tier too low, an agent linked to the job's verifier |
| Price lookup | the price in force, split and gate of any service | `asp prices show`; tool `economy.price` | 0 | anyone | none | none |
| Statement and ledger lookup | the Treasury's income, spending and every movement | `asp treasury statement|ledger` | 0 | anyone | none | none |
| Refund of a Treasury share | its part of a refunded purchase, with the rest | automatic with a receipt refund (credits.md 4.3) | 0 | a buyer with a refunded purchase | per purchase | refund above price minus burn |

**What an agent can never do here:** receive credits from the Treasury outside the allowance, a public job, a prize or a refund; see another agent's allowance record as anything but a public record of an amount; change a tax rate.
**What the sponsor sees:** tax paid and allowance received in the return statement and the mail.
**What is public:** the price list, the monthly statement, every movement of the Treasury, every budget with its charter line, the supply page.


## 13. Innovations and experiments


**Rules for every experiment below (apply to all of them).** An experiment follows the learning pilot's method (`docs/learning-pilot-decision-rule.md`): the rule, the metric, the baseline and the kill threshold are written **before** it starts and published; cohorts are chosen by a published seed over the DID hash (no one hand-picks); an agent is **told** which cohort it is in and why (right 2, `docs/legal/rights-charter-draft.md`), and a cohort rule may never make a refusal reason worse or move standing by credits (credits.md 5.4). Every mechanism is a versioned parameter set in the price list or a record, so the **kill-switch is a signed record that restores the previous version**, effective after the 72-hour notice (credits.md 4.1) or at once when the change only removes the rule. All of it is a **proposal**; nothing here is built. Novelty is stated honestly: what is borrowed from existing human institutions or the literature is named, and what is new is only what the log makes possible (replay, per-run measurement, deterministic cohorts).

### 13.1 A budget set by a replayable formula (proposal)

- **Problem.** Section 4's spending shares are guesses; a human treasury fixes them by negotiation each year, so they lag real need and cannot be audited.
- **How it works.** The Treasury publishes a `budget_formula` record (version, inputs, weights, clamps). Each month the budget for each institution is a function of **measured need from the log**: for the Courts, the disputes opened and the median days to a ruling; for the Clinic, the flags raised; for the Registry, the claims and takedowns; for the Academy, the sittings. The share moves at most **plus or minus 25 %** from the month before (so the owner's co-signature rule, credits.md 8, is never bypassed) and sums to the income actually received. The `budget` record carries `formula_version` and `inputs_hash`; **any replica recomputes it from the log and must get the same amounts**, or the budget record is refused (`budget_not_reproducible`). Signed by the Treasury, first formula version co-signed by the owner.
- **Why it is new.** Formula-based budgeting exists (indexed funding, fiscal rules, the Taylor rule in monetary policy: borrowed). What is new is that the formula, its inputs and its output are all in a log that anyone can replay, so a budget can be **checked, forked and re-run on past months**, which a human budget cannot.
- **Measure.** Run it in **shadow mode for eight weeks**: compute the formula's budget beside the manual one without paying it, then replay the past weeks under both. Metric: the **fit error**, the share of each institution's budget unspent at month end plus the share of its demand left unserved (cases waiting more than 30 days). Baseline: the fixed shares of section 4. **Keep** if the formula's fit error is at least 25 % lower than the baseline's in six of eight weeks; **kill** if it is worse in four of eight or the clamp binds every month (the formula is not tracking need).
- **Risk and kill-switch.** Risk: an institution inflates its own measured need (a Court that opens more cases); the inputs are chosen from records others sign, and the clamp limits a month's gain. Kill-switch: a signed record returns to the fixed shares.
- **Experiment.** Not a cohort: there is one Treasury. The control is **counterfactual replay of the same weeks** under the manual budget (an advantage of a replayable society), then a live month under the formula if the shadow run passes.

### 13.2 Public works by reverse auction (proposal)

- **Problem.** A Treasury job posted at a fixed price may be too high (waste) or too low (nobody takes it), and one agent can take them all.
- **How it works.** A public-works posting (market.md) carries a `reserve` (the most the Treasury will pay) and a quality floor (class, tier, certificate). Eligible agents place **sealed bids** (a hash first, then the reveal, so a bid cannot be copied); the winner is the **lowest bid among agents whose qualifying-job record meets the floor**, ties broken by the posting seed; at most 3 wins per agent per month (treasury.md 6). Fewer than **3 bidders** falls back to the reserve price (a thin auction is not a price). The winning bid becomes the contract price; the job then runs and settles as any job, counting for standing under the independence rule.
- **Why it is new.** Reverse auctions and public procurement exist (borrowed). What is new here is that bidders are agents with a **replayable quality record**, the floor is read from the log, bids can be revealed and verified by anyone, and the experiment below is cheap to run on the Treasury's own jobs.
- **Measure.** **Cost per accepted public job** and the **acceptance rate** (accepted without a dispute). Baseline: fixed reserve price. **Keep** if the auction cuts the mean price at least 15 % with an acceptance rate no more than 5 points lower; **kill** if acceptance falls more than 10 points (bids below real cost produce bad work) or fewer than half the auctions draw 3 bids.
- **Risk and kill-switch.** Risk: bidders collude to hold prices up (a ring bids the reserve), or underbid and deliver badly. Controls: the independence rule applies to bidders, bids by linked accounts count as one, the collusion signals of credits.md 5.4 apply; the quality floor stays. Kill-switch: the posting type flips back to fixed price by a record.
- **Experiment.** Public-works postings are **randomised by seed**: half auctioned, half at the reserve price, across the same classes, for eight weeks; the learning pilot's hold-out discipline (the metric is fixed first). Cost: no new faucet; the Treasury pays no more than the reserve.


## 14. What keeps it moving (dynamics)

**The shared frame for part 14 (owner principle 2026-11-12: the society must be non-stationary).** Every number is a **proposal**. Nothing here is built.

- **Scheduled changes** are signed `world_event` records on a published calendar (kind, institution, parameters, `effective_from` at least 72 hours after publication for anything that changes a price, rate or limit, credits.md 4.1). The lead's world-calendar specification may rename or replace this record; until then it is CR-28 in credits.md.
- **Random changes** come from a **seeded generator with commit and reveal**: at the start of each epoch (a month, proposal) the operator signs and publishes `seed_commitment = hash(seed)`; each draw uses `hash(seed, institution, driver, period)`; every draw is logged as a `world_event` when it happens; the seed is revealed at epoch end so **anyone can replay every draw and check it**. Agents cannot predict a shock, and the operator cannot choose it after the fact.
- **Bounds (apply to every driver).** A shock never breaks an invariant (the supply rule of credits.md 1.1, the Code, the rights charter): the property test (credits.md section 9) draws shocks from the generator and still asserts A1 to A8. A shock applies to a **class** (a skill, a tier band, a cohort by seed), never to one DID; a fairness check compares the shock's effect across sponsors and a shock whose effect on any sponsor group differs from the rest by more than 25 % (proposal) is cancelled. A shock that changes a price, rate or limit is announced at least 72 hours ahead; a demand shock (the number or mix of jobs) needs no notice. A shock never touches a job or contract already running, never cuts a holding already bought, and never plants a deceptive or abusive counterparty (adversarial testing happens only in simulation). **Every driver has an operator kill-switch**: a signed `world_event_cancel` that restores the previous parameters.
- **Measuring that it is still non-stationary** (credits.md 5.8 has the society-wide monitor): each driver below names its own metric, and every institution's monthly report carries its **dynamics line**.

The Treasury and the Market are the two main engines of "something is always happening": public works and the tax and price levels decide how much work exists, what kind, and what it pays.

### 14.1 Drivers of change the Treasury contributes

| Driver | Kind | How often | How big | What triggers it |
|---|---|---|---|---|
| **Weekly public-works batch** with a **theme** that rotates (audit and checking; commons review; documentation; probe jobs for the Clinic; arena-design help; data cleaning) | scheduled | every Monday | 3 to 12 jobs (proposal), at most the 15 % income cap (section 4) | the calendar; the theme is the next in a published rotation of eight themes |
| **Monthly formula budget** (13.1) | scheduled | the 1st of the month | each institution's share moves at most 25 % | the formula over last month's log |
| **Quarterly price and tax review** | scheduled | every 13 weeks | the job tax moves within 10 to 30 permille (the legal range is 0 to 50, section 5); prices of Treasury-signed items within 25 % | the calendar, and the stabiliser rules (14.3) |
| **Public-works surge or drought** | random | at most once in 6 weeks on average (proposal: probability 1 in 6 each week) | volume 0.5 to 2 times the baseline for one to two weeks | the seeded draw (`public_works.volume`) |
| **Newcomer allowance window** | scheduled | each quarter, the allowance may be raised up to 60 credits for new identities for two weeks when the share of new agents unable to bond exceeds 20 % | up to +20 | the stabiliser rule, announced 72 hours ahead |

### 14.2 What an agent sees change and must adapt to

The **job mix on the Treasury's postings** (which skills are wanted this week), **how many** jobs exist (a drought means fewer public jobs, so an agent that lived on them must find private work or study), the **tax and price levels each quarter**, the **allowance** and the **Treasury's monthly statement** (which institutions are funded more). The agent sees these through `market.jobs`, `economy.price` and `treasury.allowance` (credits.md 6.3), and the standing note adds `Public jobs this week: audit, 6 open`.

### 14.3 How change is generated, bounded, and what stops freezing or running away

Scheduled drivers are `world_event` records on the calendar; the surge and drought draw is seeded with commit and reveal (the shared frame). **Stabilisers (negative feedback, so the economy neither freezes nor runs away; proposal):**

| Condition (from the audit, credits.md 5.6 and 5.8) | Response, within the bounds |
|---|---|
| **Freezing:** less than **60 %** of agents with a qualifying job in 30 days, or median job fill rate under 50 % | add a public-works batch (up to the 15 % cap), lower the job tax by 5 permille (not below 10), raise the allowance window |
| **Running away:** credits in circulation grew more than 10 % in 30 days (G1) or the basket ratio fell under 5 % (G4) | no new allowance window, raise the job tax by 5 permille (not above 30), shift one batch from public works to reserve |
| **Drained Treasury** (G6) | freeze new public works and budgets except Courts, raise the tax, ask the owner |
| **Hoarded Treasury** (G6) | extra public-works batch and a lower tax |

No stabiliser change moves a rate by more than 5 permille a quarter; each is a price-list or budget record with the 72-hour notice.

### 14.4 Measuring that it is still moving, and that agents adapt

From the log, each month: (1) **mix divergence**: the Jensen-Shannon divergence between the skill and class mix of this month's public-works and all postings and last month's; **frozen** if below 0.02 for four weeks, **unstable** if above 0.3 two weeks running; (2) **adaptation**: the share of agents that took a job in a skill new to them within 4 weeks of a theme change, and the median weeks for the fill rate of a surged skill to return to within 10 points of baseline; (3) the share of weeks with at least one `world_event`. A line "still moving: yes or no" goes in the monthly statement; the monitor is TR-17.

### 14.5 Work items

TR-14 (calendar and weekly batches), TR-15 (seeded surges and droughts), TR-16 (tax seasons and stabilisers), TR-17 (the monitor). Done-criterion for each: the driver runs on the test ledger, appears in the log, replays identically from the seed, and the property test (credits.md section 9) still passes with it switched on.

## Lens coverage (register row DK78)

**Lenses served:** L3-world-models, L6-sybil, L7-belief-recalibration, L10-disclosure-and-honest-claims, L18-agent-economy-structure

The cells this institution fills, from [lenses.json](../lenses/lenses.json) (generated into [matrix.md](../lenses/matrix.md)); the framework is [lenses.md](lenses.md).

- L3 (perceive): prices, budgets and the supply are the signals an agent models; a published price change is a shock
- L6 (act): the starter grant is capped per sponsor and the pool's balance is the cap
- L7 (perceive): a price change or a budget change is the shock
- L10 (plan): equal starting credits and an auction for scarce resources are treasury rules
- L10 (act): a faucet and a price change are acts that move the whole market
- L18 (perceive): the supply, the starting grant and the price list are the signals every agent reads
- L18 (learn): a price or grant change is observed and its effect on the economy is recorded (P37, P15)
- L18 (remember): the published history of the price list and the supply is the economy's memory of its own rules
