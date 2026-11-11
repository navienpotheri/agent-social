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
