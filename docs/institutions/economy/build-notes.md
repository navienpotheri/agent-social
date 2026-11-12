# Build notes: the first two credit-economy slices

Written 2026-11-12 by the build-economy worker. Credits are accounting entries, not money. Nothing here is pushed or merged. The register (`docs/gaps-register.md`) is not edited: the lead updates it from this note.

## What changed

**Slice 1: qualifying jobs (DK69; credits.md CR-12 and CR-13 in part; spec-delta S161).**
- `packages/asp-log/src/qualifying.ts` (new): the rules. `packages/asp-log/src/log.ts`: `countAcceptedJob` now applies them, and `saveReputation` replaces three hand-written copies of the reputation write (the others used to drop any new field).
- A job settled `accepted` still settles and still adds to `acceptedJobs` (the raw count). It adds to the new `qualifyingJobs` only if: the principal is independent of the performer **and** the backer (not the same DID, not the same sponsor, not one sponsoring the other, not one fleet; a DID with no passport is its own sponsor); the contract price is at least 20; and it is within the counterparty cap.
- The opt-in bond floor (`acceptedCleanJobs`) and `releaseStarter` read `qualifyingJobs`.
- Postgres migration `015_qualifying_jobs.sql`; `ReputationRow` gains `qualifyingJobs` and `recentJobs` (the last 20 eligible jobs by principal sponsor and time, for the cap).
- Tests: `packages/asp-log/test/qualifying.test.ts` (new, 9), `bond-floor-log.test.ts` and `packages/asp-cli/test/starter.test.ts` (changed: both used the agent's own sponsor as the principal of the job that was meant to count, which no longer counts; they now use an independent principal, and four of them for the 12-job tenure test so the cap is respected).

**Slice 2: `asp credits audit` (DK1, DK9; CR-1; spec-delta S162).**
- New read-only store method `ledgerRows()` in the memory and Postgres stores; `EventLog.creditAudit()` and `creditFlows()`; both added to `LOG_METHODS`, so the command works on a hosted service. They return figures and a verdict, not the list of accounts (so a signed-in tenant cannot list every DID). No signed-record format changed.
- `asp credits audit [--by-flow] [--since <time>] [--json]`: prints minted, balances, circulating, platform account, escrow, bonds, court-fee reserves, juror stakes, report deposits, the verdict (`balanced` or `MISMATCH by n credits`) and the log head. Exit code 1 on a mismatch. `--by-flow` adds the settlements (count by basis, released, fees, bonds returned and slashed) and says which flows are not available.
- Catalogue row in `conformance/generate-command-reference.ts`; `npm run commands` and `npm run ai-files` were run.
- Tests: `packages/asp-log/test/conservation.property.test.ts` (new: 1,000 sequences, seed 20261112, A1, A2, A3, A7 after every operation, A4 `verify` on 20 sequences, and the deliberate-failure test) and `packages/asp-cli/test/credits-audit.test.ts` (new).

## Decisions where the spec was open

1. **Old counts.** Rows written before this change have no `qualifyingJobs` and read as 0. Earlier counted jobs do not carry over: they were never independence-checked. `acceptedJobs` is unchanged and still shown. Effect: an existing agent's bond floor goes back to the 400 permille start until it earns qualifying jobs.
2. **Counterparty cap (proposal, marked in the code).** The spec gives the share `max(2, ceil(n / 2))` over the last 20 eligible jobs in 90 days but not what "n" is. I used the size of that window **including the job being judged**, counted per principal **sponsor** (the sponsor of the principal, or the principal itself if it has none). A job that exceeds the cap settles, stays in the window, and does not count. No job is un-counted afterwards.
3. **Minimum price (proposal).** The `class` field does not exist on the intent yet (CR-12's first half). A job with no class is treated as `routine`, so a price below 20 never counts. Weights above 1 (skilled, critical) are not used: every qualifying job counts as 1.
4. **Who is checked.** Independence is checked between the principal and both the performer and the backer, because the credit goes to the backer (`escrow.backer`), which is where the bond floor reads it.
5. **The audit reads one view.** Postgres uses a REPEATABLE READ, read-only transaction so the figures are from one log head even while appends continue.
6. **Rule 4 (verifier is a party)** was already enforced when the verification is appended (`verifier_conflicted`), so it needs nothing here.

## Register rows: what I believe is met, and what is not

- **DK69 (qualifying jobs): the stated done-criterion is met**, by `qualifying.test.ts`: a pair of agents of one sponsor exchanging 30 accepted jobs neither lowers the bond floor (a bond of 399 on a 1000 job is still refused) nor releases the starter rest; the same from 5 independent principals does (30 of 30 count, floor 250, rest released). The cap at the limit and one over, price 19 and 20, and the sponsor rules are tested. **Not covered**: the Google-account rule (rule 3: only the hosted service knows it), lineage (rule 2: only fleet is read), job class and weights (CR-12 first half), `standing_adjustment` and the collusion signals (CR-14), and the Academy's wording ("accepted jobs" should read "qualifying jobs"). The Postgres half of `qualifying.test.ts` is skipped without `ASP_TEST_DATABASE_URL` and was not run here.
- **DK9 (audit): partly.** Met: the command exists; a deliberately corrupted log (one balance changed by 1, in both directions) fails the audit in a test; the property test passes. **Not met**: the nightly job on the hosted service, the alert to the operator, the public supply page (CR-18), and a live run (CR-22). `asp credits audit` was not run against the hosted service or a real Postgres.
- **DK1 (monetary policy): not closed by this.** CR-1 (audit core) is done as specified except as noted below, but the minted total is still an unsigned counter (CR-2), there is no Burn, Treasury or institution account (CR-3), and the audit cannot report mints by reason.

## What the audit and the property test do not cover (so the spec's CR-1 is not fully met)

- Spec section 9 names assertions A5 (institutions are not faucets), A6 (the split of a purchase) and the institution and Bank/Insurer lines: none of those records exist yet, so they are not tested. A4 (replay reproduces balances and locks) is the existing `verify()`, run on 20 sequences, not all 1,000, because it is slow.
- The spec's `allAccounts()` is `ledgerRows()` here; there is no public listing of accounts (deliberately).
- Time budget: the 1,000 sequences took about 82 seconds on this machine (the spec asks for 60). About nine tenths is Ed25519 signature checking. Not reduced further without cutting the sequence count.
- Cast: 3 principals, 2 agents (one sponsor, alice), 5 jurors, 1 reporter, 1 bank. Not the spec's 4 principals and 6 agents of 3 sponsors. The generator does not draw price lists, purchases, mints with reasons, upkeep or `internal_transfer` (none exist).
- Over-large `fees` and refused paths are drawn. The generator reached every settlement basis, juror register and update, report open and report ruling (the test prints the counts and fails if one path is never accepted).
- `asp credits audit` on a **local** log re-derives balances by replay, so editing a local file cannot show a mismatch; the check has teeth on a hosted (Postgres) log and in the library tests that change a stored balance directly.
- Postgres: `ledgerRows()` and migration 015 are written and typechecked but were not run against a database here.

## Surprising in the code

- Three places wrote a reputation row by hand and each kept only `acceptedJobs` by name; any new field would have been silently dropped by a demotion or a strike. Now one `saveReputation`.
- A refused bond leaves its contract in the log (the contract append succeeded), so "a refused operation changes nothing" can only be asserted on the ledger, not on the log head.
- The worktree had no `node_modules`, and the main checkout's symlinked packages shadowed it: tests in the worktree ran against the main checkout's code until `npm install` was run here.

---

## Slice 3: signed mint, reserved accounts, split, price list, purchase, receipt (spec-delta S163)

Written 2026-11-12 by the credit-economy slice builder. Credits are accounting entries, not money; the service is a beta; no outside security review has happened. Nothing is pushed. The Postgres migration `packages/asp-log/sql/016_economy.sql` is written and typechecked but **was not run against any database** (the Postgres test harness needs `ASP_TEST_DATABASE_URL`, which was not set); the memory store is what the tests ran on.

**What it builds** (credits.md CR-2, CR-3, CR-4, CR-5 and CR-6 in part; DK1, DK2, DK3, DK7, DK67, DK68): the signed `mint` record, the Treasury, Burn and institution accounts, the split policy as code, the `price_list`, `purchase` and `receipt` records, and an audit that reports all of it. The demonstration is `packages/asp-log/test/economy-slice.test.ts`, test "the slice, end to end".

### Where the spec was ambiguous, and what I chose

1. **New record types, not attestations.** credits.md 4.1 calls the price list "an attestation"; market.md calls a posting "an attestation `posting`"; 5.1 calls mint "a signed record". I made all four their own record types (`mint`, `price_list`, `purchase`, `receipt`) with their own schemas, because the attestation schema's `about` field (a record id) and `kind` enum fit none of them. The price list's `prev` and `issued_at` are the envelope's, not body fields.
2. **Who is the operator, the Treasury and the owner.** The log is given the operator and owner DIDs by `EventLogOptions` (`operator`, `owner`); with no operator configured every signed mint is refused. The Treasury DID is the constant `did:web:asp.local:treasury` and only its key may issue a price list. The owner's co-signature is a `cosigs` entry whose kid starts with the owner DID. The beta operator and owner may be one person; the rule is about which acts are co-signed and published.
3. **The unsigned mint stays.** `EventLog.mint()` (used by `asp credits grant`, the starter path, and about 40 existing tests) is unchanged and is counted apart: the audit reports `mintedSigned` and `mintedUnsigned`, and `asp credits audit --require-signed` fails on any unsigned credit. I did not rewrite `asp credits grant` or the starter path to sign, because the hosted service has no operator signing key wired in yet (that is a key-custody decision: credits.md decision 9, TR-10). The store's mint row gained `signedMinted`; a replay seeds only `totalMinted - signedMinted` and recreates the rest from the records.
4. **`PLATFORM_DID` aliases the Treasury** (credits.md 3.2) by `canonicalAccount()`: every credit and debit to the platform DID goes to the Treasury row; `balance()` of either name returns the Treasury plus any old platform row, so an existing database that already holds fees under the old DID is still counted (the audit shows that leftover as "old platform account"). Records stay valid.
5. **Institution accounts.** Six names are registered as institution accounts: market, academy, shops, courts, registry, clinic (`did:web:asp.local:<name>`). The spec says a new institution account is the owner's decision; a price list naming any other institution DID is refused (`price_list_unknown_payee`). Bank and Insurer accounts are not registered yet.
6. **Notice rule details.** The first list (version 1) must be effective at or after its issue time; a later list needs 72 hours for any price rise, split change or new service, 24 hours for a price fall or a removed service, taking the longest that applies. "Rise above 25 %" is `new price > 1.25 x old price`, computed in integers.
7. **A purchase is judged at its `issued_at`,** not the log's append time, so replay is deterministic. A purchase names the list it relied on; the log refuses it unless that list is the one in force at that time (`price_list_not_in_force`).
8. **Idempotency and the price-list head** are kept in a new small `markers` table (memory and Postgres). A refused record leaves no marker. Everything else (the parts of a purchase, for a refund) is recomputed from the records.
9. **A receipt is chained on its purchase** (`prev` = the purchase id), the one cross-type chain the log now allows; it allows exactly one receipt because the chain head moves. `refund_amount` may be any amount from 1 to price minus the burned part; the Treasury and each payee give back pro rata to what each received (rounding to the first payee).
10. **A zero amount** is refused by the log with `amount_not_positive` (R10), not by the schema, so the refusal has the spec's name. The schemas allow 0.
11. **`self_dealing` is only the narrow case** (the buyer is a payee). Because institution accounts cannot buy (R3), that case cannot be reached today and has no test; the sponsor-controls-the-payee case (R9) needs a payee that is an agent, which the price list does not allow yet.
12. **Tier 0.** `tier_excluded` applies to a `standard` item for an agent whose reputation tier is 0; `essential` and `remedial` items are allowed. Humans have no tier and are not limited.
13. **Credits never change standing.** Purchases and receipts touch no reputation, tier, rank or eligibility code; the end-to-end test asserts `reputationOf` is identical before and after a purchase.

### Not built in this slice (so nothing below is claimed)

- The Mandate field `institution_spend` (CR-7), so there is **no per-institution spend cap or default-deny yet**: a purchase is limited only by the buyer's balance and the price list. This is the biggest gap against credits.md 4.2 and R6.
- `asp prices show|history|diff` (CR-5), `asp spend`, the agent tools (CR-9, CR-10), the gate fields on price-list items (CR-11), `max_per_buyer_period`.
- The job tax: `job_tax_permille` is carried and range-checked in the price list but a settlement's `fees` is still whatever the bank signs (CR-15; DK68 stays partial).
- `internal_transfer`, prizes, budgets, the allowance (T4, T5, T8, T10), `auto_refund`, standing orders (CR-23). `refund_short` is implemented but unreachable until something other than a refund can debit an institution account.
- Wiring `asp credits grant` and the starter path to sign; recording existing mints once as `bootstrap`; `GET /economy/supply`; the nightly audit; the guard monitor.
- The conservation property test (`conservation.property.test.ts`) was **not extended** to generate mints, purchases, receipts or price lists; the new behaviour is covered by example tests only.
- Python: the schemas and vectors are shared and the Python record-type list is updated; there is no Python log or economy code to port (the Python SDK has no log).
- Not run: the new migration against a database, and the economy tests on Postgres (the new test file is memory-only).

## Signed grant by the operator (DK67, owner decision 2026-11-12)

The operator signs mint records on their own machine; the service never holds the key (the site and terms say so, and stay true). `asp credits grant --by <operator did> --reason <code> [--cosign-by <owner did>]` signs a `mint` record with the key in the operator's home. The log is told the operator by DID only: `ASP_OPERATOR_DID` and `ASP_OWNER_DID` on the service (`postgres-handle.ts`), or `<home>/operator.json` for a local log (`home.ts`). A log must be replayed with the same DIDs. Not done: the starter grant at sign-up (DK94) and re-recording the old unsigned mints as `bootstrap`.
