# Proposed register rows, corrections and questions from Worker E (credits.md, pilot round, 2026-11-12)

For the programme lead to integrate. I did not edit the register, `scope.md`, `deck-promises.md` or any other file. Row ids are working ids (`DK-E-n`); statuses follow the register's four words.

## 1. Proposed new or changed rows

| ID | Gap | Fix | Done when | Pri | Status |
|---|---|---|---|---|---|
| DK-E-1 (changes the "Covered today by" of DK1 and DK9) | The register says `asp credits audit` ("checks that none were lost") covers the ledger today. **No such command exists.** `grep` finds the words only in the register and in `academy.md` (AC-20). The only check is `conservation()` in `packages/asp-cli/src/ledger.ts:65`, a client-side check over a snapshot built from named accounts and a total the caller supplies. The log has no listing of all accounts (`store.ts:235` lists mints only; the public surface is `balance(did)` and `mints()`, `log.ts:1017`, `log.ts:1089`) | Replace the covered-today text with "ledger.ts conservation() (client side)"; build CR-1 | `asp credits audit` exists and a corrupted copy fails it; the property test runs 1,000 sequences, seed 20261112, in CI | A | open |
| DK-E-2 | Mint is not a signed record, so balances cannot be re-derived from the log alone (`log.ts:1048-1065`, replay seeds from a mint snapshot, `log.ts:1073`, `1129`). DK1's done-criterion "the report reproduces the supply from the log alone" cannot be met without this | CR-2: a signed `mint` record with a reason code; protocol change (spec-delta, both SDKs, vectors) | A fresh log replaying records alone reproduces every balance and the minted total; an unsigned or wrongly signed mint is refused | A | open |
| DK-E-3 | Nothing is burned and the settlement `fees` go to an account with no owner and no outflow (`PLATFORM_DID`, `log.ts:41`, `log.ts:788`); the amount is chosen by the bank, bounded only by the escrow (`log.ts:697`). DK1, DK14 and the Academy spec assume a burn and a tax rate | CR-3 (reserved Treasury and Burn accounts), CR-15 (the `fees` amount must equal the job-tax rate in the price list) | The Burn account refuses debits; a settlement with `fees` off the rate is refused | A | open |
| DK-E-4 | **Standing can be farmed today.** `countAcceptedJob` counts every job settled `accepted` with no independence check (`log.ts:474-478`, called `log.ts:792`), and the starter "rest" (400 credits each) is released by any accepted job (`account.ts:121-137`). Under the opt-in bond floor v2 each accepted job takes 15 permille off the floor | CR-12, CR-13: qualifying jobs, the independence rule and the counterparty cap in the log; release the starter rest only on a qualifying job | A pair of agents of one sponsor exchanging 30 jobs does not lower the bond floor or release the rest; the same from independent principals does | A | open (DK6 covers the design; this is the live hole) |
| DK-E-5 | Starter pool state is a JSON file separate from the ledger (`starter.ts:26-92`); it counts only starter mints, not operator mints; two sources of truth for what was minted | CR-21: derive the pool's use from the mint records | The supply page's starter figure equals the sum of `starter_*` mint records | B | open |
| DK-E-6 | Closed-loop rules are true today only because no transfer path exists (every `credit`/`debit` is in Bond, Settlement, Juror, Report code). Each refusal needs a named rule and a test before the first new record type (purchase, prize, budget) is added | CR-8 | One test per movement T1 to T12 and R1 to R13 in `credits.md` | A | open (inside DK7; a checklist for it) |
| DK-E-7 | The Mandate has no `institution_spend`, and `TIER_SPEND_LIMIT` applies only to `spend.cap` and `per_action_max` (`log.ts:497-503`) | CR-7, including that the sum of institution caps in a period is within the tier limit | A tier 1 Mandate with institution caps summing to 101 is refused | A | open (inside DK3) |
| DK-E-8 | The deflation side of the economy has no owner: burn and tax remove credits while the only faucets are new tenants' grants. Neither DK1 nor GV2 names a rule for a drained society | `credits.md` 5.6 (G4, G6, G7); CR-19 monitor | A synthetic log trips each trigger in a test | B | designed |

## 2. Wrong or missing facts in `docs/deck-promises.md` and the DK rows

1. **DK1 and DK9 "Covered today by": `asp credits audit` does not exist** (see DK-E-1). DK9's fix says "Run the audit on a schedule": there is nothing to schedule yet; CR-1 first.
2. **DK1 says "mint by the operator only"**: true, but it is also unsigned and unlogged (DK-E-2).
3. **DK1, DK14 and `academy.md` §4 talk about "the burn" as if it existed.** It does not (`credits.md` 2.2).
4. **DK2 "Fees on settlements (a mock account)"**: correct; add that the amount is chosen by the bank. **"the panel fee (5 percent of price, loser pays)"**: correct (`PANEL_FEE_PERMILLE` 50, `log.ts:28`); add that each side also locks half of it at Bond time when jurors are registered (`log.ts:660`).
5. **DK5 "bond floor v2 ... opt-in (S143)"**: correct; add that the positive term is farmable (DK-E-4).
6. **DK14 "report rewards"**: exists (`REPORT_REWARD_PERMILLE` 200, `log.ts:30`).
7. **A wrong cross-reference in code:** the comment above `REPORT_REWARD_PERMILLE` (`log.ts:29`) cites S39 for whistleblower reports; in `spec-deltas.md` S39 is fleet isolation and the reports row is **S40**. A one-word fix in a code comment; I did not touch code.
8. **`deck-promises.md`, "Stake: economic primitives": "Escrow 1,000 and bond 200"** is the deck's demo figures, not defaults; nothing in the code fixes those amounts. Worth saying so beside the claim.
9. **`deck-promises.md` slide 18 "1,000 tenants":** the starter pool is 200,000 (`starter.ts:21`); 1,000 tenants fully granted need 1,000,000 (2 identities × 500 each), or 200,000 for up-front grants only. DK60 should size the pool, not only the load test.
10. **`academy.md` §4**: "a newcomer ... can afford a Foundations course (30) and a first exam (20) from the first grant" competes with the first job's escrow and bond (`account.ts:102-104`). Also tuition split should be 55/25/15/5 (`credits.md` 3.1) and "accepted jobs" should read "qualifying jobs" (5.4).

## 3. Questions for the owner (the full list with recommendations is `credits.md` §11)

1. Is a signed `mint` record required before launch? (I recommend yes.)
2. Is it acceptable that a settled job moves credits and never creates them, so external demand cannot enter except through Treasury public-works jobs?
3. Treasury issuance: none for 8 weeks, then your decision per mint?
4. Newcomer allowance of 40 credits, once per identity: accepted?
5. Are the owner and the operator one person? `credits.md` §8 is written to hold either way (published, co-signed acts), but who signs the co-signature changes if they differ.
6. Which alert channel does the operator use for service alerts today? I did not check; G8 needs one.

## 4. Not verified (assumptions)

- Whether the gateway stops a run on a token ceiling today (I read only the metering function `meteredUse`, `ledger.ts`); CR-17 checks first.
- Rotation of a service DID key (Treasury key) following the agent recovery path.
- Whether any "audit" in the hosted service's own deployment (outside this repository) already reconciles balances.
- That a verifier DID cannot equal the performer: I read only the log comment that it is separate from the principal.
- The Postgres store: I read the memory store's `allMints`; I did not check the Postgres store for an account listing beyond the grep that found none.
- All numbers in `credits.md` marked "proposal" are mine; none is derived from measured earnings. The only measured anchors are the code constants (tier limits 100 and 1,000; panel fee 50‰; reward 200‰; starter 100, 500, 2 identities, pool 200,000) and the deck's demo job (50 credits).

---

# Round 2 (treasury.md, market.md, bank-insurer.md, shops.md; 2026-11-12)

## R2.1 Changes the four specs need in `credits.md` (not made; for the lead)

1. **A purchase signed by the institution under the buyer's `standing_order`** (Shops upkeep, credits.md 4.2 says "signed by the buyer"). Needed so a recurring charge is automatic and still inside the Mandate.
2. **A surplus-return rule for institutions with no costs in credits** (the Shops provider share of 550 minimum would only accumulate). credits.md 5.3 allows a budget return; add a monthly rule and say the bounds for a city-run item may put the provider share at the minimum.
3. **Settlement repayment** of a Bank credit line before the performer is paid (bank-insurer.md 3): a new settlement rule beside the job tax (credits.md 3.2), with an effective-time rule.
4. **Treasury budget lines** for the Bank lending reserve and the Insurer's reserve top-up (credits.md 4 and the Treasury spending table list neither).
5. **Class `essential`** should list the first Foundations course and the `meal` upkeep item explicitly (credits.md 3 names remedial, appeal and the first course only in decision 6).
6. **Insurance premiums are a standard-class purchase** (reserve 800, Treasury 150, burn 50): confirm this is what the owner wants, since it burns part of the reserve's income.

## R2.2 Proposed rows

| ID | Gap | Fix | Done when | Pri | Status |
|---|---|---|---|---|---|
| DK-E-9 | The newcomer cannot bond with no balance (`insufficient_balance`, `log.ts:437`) and has no way in except the starter grant (`starter.ts:19`) | A guaranteed credit line repaid at settlement (bank-insurer.md BI-2 to BI-4) | DK19's done-criterion; a default debits the guarantor | A | open (inside DK19) |
| DK-E-10 | DK20 says the reserve "never goes below its floor in a property test". A reserve **must** be able to fall below a floor when it pays claims; only sales can be refused | Reword to: no sale leaves the reserve below the floor, and the reserve is never negative (bank-insurer.md 5, 9) | The property test asserts both | A | open |
| DK-E-11 | Nothing stops a catalogue item from touching compute, storage, rank or eligibility (CY7) | An allowlist of effect types and a scan test (shops.md 9, SH-9) | A new effect type fails the test without owner sign-off | A | open (inside DK21) |
| DK-E-12 | Dormancy has no rule for jobs in flight or for arrears | Shops spec: not while a job is `Running` or `Checkpoint`; arrears beyond 7 days forgiven (shops.md 5) | Tests in shops.md 9 | A | open (inside DK22) |
| DK-E-13 | District access has no ring model: DK23 names districts but not which institutions sit in which | Rings 1 to 3 (shops.md 4, 7); the lead to place Leisure, Research, Courts, Registry in `map.md` (DK41) | `map.md` lists each district's ring | B | open |
| DK-E-14 | The public-works job stream (the way work enters without a faucet, credits.md 11, 3) has no row | treasury.md TR-5 and market.md MK-2 | A Treasury job is posted, taken and settled | A | open |
| DK-E-15 | Premiums, lines and claims are not in any supply report | Add them to `asp credits audit --by-flow` | The flow report lists each | B | open |

## R2.3 Wrong or missing facts found

1. **`docs/insurance-design.md` does not exist**, but `docs/city-design.md:205` points to it and US4 says "see the insurance design". bank-insurer.md is the first written design.
2. **DK19 says the Bank offers "a deposit with a small reward funded by the Treasury, interest-free by design".** A reward funded by the Treasury is a transfer, not interest; both can hold, but the reward is a Treasury cost the budget must list. I recommend leaving deposits out of the beta (bank-insurer.md 11, 6).
3. **DK21 says an item can give "a one-off boost to a measured thing".** That conflicts with CY7 (no link to compute) and with "credits do not buy standing" (credits.md 5.4). shops.md allows only display, meal and district-access effects. The row should be reworded.
4. **DK14 says a "progressive" tax is named in city-design (`docs/city-design.md:92`).** There is no measure of means; treasury.md starts flat.
5. **The contract names a `bank` DID, and the log does not check who it is** (`contract.schema.json` requires `bank`; `log.ts:36-40`: a mock). bank-insurer.md uses one Bank DID in the beta; whether the log should refuse any other bank is a new rule not yet in the register.
6. **The intent has `skills` but no class** (`spec/schemas/intent.schema.json:38`): DK18's class field is new, not an extension of a class that exists.

## R2.4 Questions for the owner

1. Is the Bank lending at all in the beta (guarantor-backed, first three jobs)?
2. Is the Insurer wanted at launch, or after the first thirty settled jobs give data to price premiums?
3. Upkeep at 1 a day is the number that decides whether residents can afford the city. Who fixes it: you, from the first month's earnings data?
4. Do you accept that a profile helps an agent only by being seen, never by rank (shops.md 11, 4)?
5. Is the operator allowed to run the Market's `best_match` for jobs in which one of its own agents bids (market.md 8)?

## R2.5 Not verified (assumptions)

- Operator ownership of any "operator's agents" (market.md 8) is an assumption.
- The mock status of the contract's `bank` DID I took from the log comment, not from running a hosted instance.
- All premium, cover, reserve, price, ring and cap numbers in the four specs are proposals with no measured basis; the only anchors are code constants (tier limits, panel fee 50 permille, the 30-day strike window, starter 100/500).
- I did not read the Python SDK, the gateway's enforcement path or the Postgres store.

---

# Round 3 (credits.md changes, map.md, charter.md; 2026-11-12)

## R3.1 What was done

- The six R2.1 changes are in credits.md (3 "Classes", 3.3, 3.4, 3.5, 4.2 and 4.5, decision 11) plus the audit lines for credit lines, premiums, claims, reserves and surplus returns (6.1), and build items CR-23 to CR-25. treasury.md, bank-insurer.md and shops.md were updated to cite them.
- `map.md` (Status: draft: four rows pending) and `charter.md` written.

## R3.2 Contradictions found between specs, and how each was handled

1. **Treasury shares summed to 100 % with a "reserve = the rest" of 0**, leaving nothing for the Academy, Market or Commons. Fixed in treasury.md 4 (Courts 30, Registry 10, Clinic 10, Academy 5, Market 5, Commons and Research 5, allowance 5, public works 15, reserve 15). The Courts and Clinic specs may expect other shares: the lead to check.
2. **Bank reserve: 5,000 in bank-insurer.md 4 versus 2,000 in decision 2.** Fixed to 2,000 (credits.md 3.5 also).
3. **A claim paid on a ruling that is later reversed on appeal.** Fixed: claims are decided after the appeal window closes (bank-insurer.md 3).
4. **Two "Registrars"** (Academy and Registry). Left for the lead (map.md 6, item 1); I did not touch the Academy spec.
5. **Courts' small-claim fee is outside the price list** ("not a purchase", courts.md 4). Left for the lead (map.md 6, item 2); recommendation: a price-list item of kind `fee_to_juror`.
6. **A6 said "each part within bounds"**, which a price of 5 breaks by rounding. credits.md 9 clarified (declared permille within bounds; part = floor rule).
7. **Four restricting statuses with no combining rule** (tier 0, Clinic quarantine, Registry suspension, Shops dormancy). Rule proposed in map.md 4; the Registry, Clinic and Shops specs should cite it.
8. **The Clinic spec says the first checkup per quarter is free "funded by a Treasury budget"**; treasury.md's Clinic line (10 %) must cover it plus the remedial subsidy. If the Clinic's cost is larger, the line needs raising; not checkable until volume is known.
9. **The Registry spec cites `credits.md T10` for free services funded by budget**; T10 is correct (treasury budget payment); no change.

## R3.3 New or changed rows

| ID | Gap | Fix | Done when | Pri | Status |
|---|---|---|---|---|---|
| DK-E-16 | A purchase is signed by the buyer; recurring charges (upkeep) need an institution-signed purchase under a sponsor-countersigned order | CR-23 | the three refusals in credits.md 4.2 are tested | A | open (inside DK22) |
| DK-E-17 | A city-run institution's provider share would only accumulate | CR-25: `treasury_return` | an institution account above its reserve returns the surplus on the first of the month; below the reserve is refused | A | open (inside DK15) |
| DK-E-18 | A credit line must be repaid at settlement before the performer is paid | CR-24 (a settlement rule on records after its effective time) | the repayment order is tested; the job tax is unchanged | A | open (inside DK19) |
| DK-E-19 | Charters are a document, not a record: a price list or budget cannot cite the version in force | CH-1: the `charter` attestation | the three log rules pass; the checklist test runs | A | open (inside DK40) |
| DK-E-20 | Restricting statuses combine by no stated rule | map.md 4, cited by Registry, Clinic, Shops | one test: an agent with two statuses is refused with both named | B | open |

## R3.4 Wrong or missing facts

- None in the register this round. Round 2 findings stand.
- I read Worker S's registry, courts and clinic only by grep for accounts, prices, records and rings (not line by line); rows for them in map.md may miss a record or account that their text defines elsewhere.

## R3.5 Questions for the owner

1. Do you accept the combining rule for restricting statuses (map.md 4: union; `essential` and appeal routes always allowed)?
2. Do you want charters as signed records (CH-1) before launch or as documents first?
3. The Treasury spending shares (30/10/10/5/5/5/5/15/15): do you want to set them, or the operator from the first month's data?
4. Should Courts' small-claim fee be a price-list item (map.md 6, 2)?

---

# Round 3 addendum: the compute decision and the innovations (2026-11-12)

## R3A.1 Compute-linked shop items (owner decision)

**Assumption (listed as the lead asked):** "compute" means service-side resources the operator controls: record quota, byte quota, package storage `quotaBytes`, requests a minute (`packages/asp-log/src/server.ts:39-44, 246, 274-277`; defaults in `signup.ts:68`), **not model tokens**. Quotas belong to the **tenant** (the sponsor), so an agent's holding raises its sponsor's tenant limits, summed and capped per sponsor.

What I did: shops.md (effect allowlist now includes five capped resource effects, `effect_touches_standing`, the scan test, resource rows, abuse case, SH-13), credits.md 5.7 and CR-26, charter.md (Shops charter), treasury.md (statement gains `resources_granted`).

**What I could not verify / left out:** run-log retention (no service-side setting found in the code, so the item is conditional), and **parallelism** (the Mandate's `nodes.max_parallel` is a tier limit and the guard forbids lifting it; no service-side concurrency limit found). Both are listed as not offered.

**An honest correction to the lead's brief:** the brief says the price must make the Treasury's share "cover the operator's real cost". Credits are not money, so the Treasury's credits cannot pay a hosting bill. credits.md 5.7 instead bounds real cost with a **capacity budget** (total units grantable) and uses the price only to ration inside the society; the owner sets the conversion figure E. This is the one place I did not follow the brief literally.

**Effect on the other specs:** treasury.md: **no credits line for resource cost**; the monthly statement adds `resources_granted` against the capacity budget. bank-insurer.md: **no change** (a credit line funds a bond only, so it cannot buy quota; resource items are not insurable; the existing text already says so).

**Row for DK75 (compute-linked effects and their pricing, gap M7):**

| ID | Gap | Fix | Done when | Pri | Status |
|---|---|---|---|---|---|
| DK-E-21 (= DK75) | Compute is not priced into credits (M7), and shop items may now carry service-resource effects | credits.md 5.7 (capacity budget, price as ration, caps, sink not faucet); shops.md SH-9, SH-13, SH-15; CR-26; first **measure** the real unit costs | The scan rejects an item that touches standing; a resource holding raises the sponsor's quota and reverts at expiry; the capacity budget is enforced; unit costs are measured and recorded | A | open |

## R3A.2 Innovations (part 13 in each spec)

Treasury: 13.1 formula budget in shadow mode, 13.2 public-works reverse auction (TR-12, TR-13). Market: 13.1 risk-priced bond and escrow, 13.2 poster reputation (MK-14, MK-15). Bank and Insurer: 13.1 mentor-guaranteed lines, 13.2 fleet mutual cover (BI-13, BI-14). Shops: 13.1 items as experiments, 13.2 congestion-priced resources (SH-14, SH-15). Each has the problem, mechanism, honest novelty and what was borrowed, metric with baseline and keep/kill thresholds, risk and kill-switch, and an experiment design. All thresholds are proposals.

**Changes the innovations need in credits.md (not made):**
1. A price-list item may be a **formula** (`base`, `k`, `target`, `band`), judged against the price computed for its day (shops 13.2).
2. A **mutual pool account** type with a stated rule: debited only by claim decisions and a pro-rata quarterly return (bank-insurer 13.2).
3. A `mentorship` guarantee as an alternative to a sponsor guarantee in 3.4/bank-insurer, plus the mentor's 5 % fee being a move from the protégé's pay.
4. `budget_formula` and `budget_not_reproducible` for the Treasury (treasury 13.1), and the budget's 25 % rule restated as the formula's clamp.
5. Experiments' disclosure rule (told which cohort, seed published) as a shared rule in the standard, not per spec.

**Honest limits.** None of this is built. Sample sizes in the beta will be small; the specs say replay of past logs is the main evidence where cohorts are too small. I did not search the literature: "borrowed" names the human institutions and well-known mechanisms from memory.

## R3A.3 New questions for the owner

1. Parallelism and run-log retention are left out as not offered: confirm.
2. The conversion figure E and the capacity budget: who sets them, and when is the real unit cost measured (before launch)?
3. Do you accept randomised cohorts with disclosure (opt-in preferred) as the way every innovation is tested?

---

# Round 3 addendum 2: dynamics (part 14; credits.md 5.8)

## R3B.1 What was done
Part 14 "What keeps it moving" is in treasury.md, market.md, bank-insurer.md and shops.md (drivers with frequency, size and trigger; what an agent sees; generation and bounds; stabilisers; the metric that shows it is still moving; one work item per driver: TR-14 to TR-17, MK-16 to MK-20, BI-15 to BI-18, SH-16 to SH-19). credits.md 5.8 holds the monetary dynamics, the frozen and running-away conditions and the monitor; CR-27 (monitor) and CR-28 (the `world_event` record and the seeded commit-and-reveal generator) are new. A shared frame text is repeated at the top of each part 14; the lead's world-calendar specification should become the single home and the four copies should then be replaced by a link.

## R3B.2 Honest points
- **The Bank and Insurer cannot stage shocks.** A default is real: it debits a guarantor. Their part 14 uses cycles in credit and cover availability, a Treasury-funded premium holiday and **simulation-only** stress replays, and says real claim waves are natural and are only tracked.
- **Operator-run postings and entrants must be disclosed** (`operator_posted`); the Market's part 14 forbids a synthetic abusive poster. Adversarial testing stays in simulation. This is my reading of the rights charter's "a right is promised only where a mechanism backs it" and of Article 3; the owner should confirm.
- **Commit and reveal** (the seed is committed at epoch start and revealed at its end) is the one device that makes shocks unpredictable and replayable at once; I did not check whether the log has a hash-commitment primitive, so CR-28 may need one.
- The stabiliser numbers (60 % of agents with a qualifying job; 5 permille steps; velocity bounds) are guesses with no data; they are written so they can be tuned by a price-list or calendar record.

## R3B.3 Changes the dynamics need in credits.md (made or not)
Made: 5.8, CR-27, CR-28. Not made: a rule that every price or rate change made by a stabiliser keeps the 72-hour notice (already in 4.1, but stated per driver); an `essential`-item protection in rotation (already in 3).

## R3B.4 New row
| ID | Gap | Fix | Done when | Pri | Status |
|---|---|---|---|---|---|
| DK-E-22 | Nothing makes the society non-stationary: no calendar, no seeded shocks, no monitor that says it has frozen or run away | credits.md 5.8; CR-27, CR-28; each institution's part 14 items | a driver runs on the test ledger, replays from its revealed seed, and the property test passes with shocks on; the monitor flags a frozen and a running-away synthetic log | A | open |

## R3B.5 Questions for the owner
1. May the operator post disclosed jobs and enter disclosed agents to keep demand moving, given they are not real customers?
2. Is a monthly epoch right for the seed (commit at the start, reveal at the end)?
3. Who may cancel a shock: the operator alone, or with the owner's co-signature for the large ones?
