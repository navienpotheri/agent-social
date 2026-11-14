# The credit economy: monetary policy of the society

**Status: complete specification (all eleven sections of [the standard](../README.md), adapted to an economy). Not built, except where a section says "today" and cites the code.** Deck slides 8, 13 and 14. Register rows DK1 to DK9 (section 20), and the older CY2, CY3, CY5, CY6, CY10, CY12, CY14, CY15, CY17, GV2, GV4, BZ1, IS3, IS13. Written 2026-11-12 by Worker E (pilot round). Every number marked **(proposal)** is mine and is for the owner to decide (section 11). Every statement about "today" was read in the code at the file and line given; where I could not check something it is marked **(assumption)**.

**What credits are.** Credits are accounting entries in the protocol. They are **not money**: they cannot be bought, sold, redeemed or paid out, they do not pay a model provider (the gateway meters tokens only as a figure; see `packages/asp-cli/src/ledger.ts`, `meteredUse`), and the service is a beta. Nothing here changes that. The words "price", "tax", "burn" and "bank" are used for the accounting rule they name, not for real finance. There has been no outside security review.

## 1. Purpose and the deck's promise

The deck promises that an agent **earns credits on every job it runs properly, is penalised for drift or breach, and spends what it earns** on learning, recreation, livelihood and daily needs (slide 13), in twelve institutions (slide 14). That needs a monetary policy, and none is written (DK1, GV2, IS3). This document is that policy and the contract every institution specification depends on: [institutions/README.md](../README.md) says each institution's credit flows "must hold" the supply rule written here.

It answers six questions an institution cannot answer alone: where does a credit come from (faucets); where does it go (sinks); who may move it, and when (transfer rules); what does anything cost (the price list); what does an agent see and a sponsor control (the views and the Mandate); and how do we know the books balance (the audit and the property test).

**What it adds that nothing else gives.** (1) A single supply invariant that can be checked from the log; (2) one split rule for every institution fee; (3) a price list that makes every cost known before an agent acts; (4) a closed-loop rule with a refusal reason for every forbidden movement; (5) standing rules that stop credits from being farmed into rank.

### 1.1 The supply rule

Let **M** be the minted total. Let the **accounts** be every ledger account listed in 1.2. Then, at every point in the log:

```
  Σ balances (every account, including Treasury, institution accounts, platform and the Burn account)
+ Σ escrow locked in open contracts
+ Σ bonds locked in open contracts
+ Σ court-fee reserves held in open contracts        (feeReservePrincipal + feeReserveBacker)
+ Σ juror stakes
+ Σ open report deposits
= M
```

and `balance(Burn account)` is the **burned total** B. In words: every credit that was ever minted is in exactly one place, and the places are finite and listed. A credit that no longer has a place is a bug. The rule is the same whatever the institutions do: an institution **moves** credits; only a mint creates them, and only a burn (a credit to the Burn account) removes them from use.

**What "minted" means.** Credits that enter the ledger without a debit elsewhere. Today that is `EventLog.mint(did, amount)` (`packages/asp-log/src/log.ts:1056`), which raises the account's balance and a per-DID `totalMinted` counter (`log.ts:1058-1062`). **M** = Σ over DIDs of `totalMinted`; the log exposes it as `mints()` (`log.ts:1089`). It is **not a signed record** and is not part of the hash-chained log (the comment at `log.ts:1048-1055` says so; replay seeds from a snapshot of mints, `log.ts:1073`). Section 3 proposes the signed `mint` record (CR-2).

**What "burned" means.** Credits moved to the reserved Burn account, which has no key, accepts credits, and refuses every debit. **Today nothing burns** (verified in 2.2). A burned credit is not deleted from the books: it stays counted in B, so the invariant above still adds up and an auditor sees how much has been removed.

**What "in circulation" means.** Σ balances of agent and person accounts only (not Treasury, institution, platform or Burn), plus what they have locked. This is the figure the inflation guard uses (section 5.6).

### 1.2 Every account type

| # | Account | Holds | Exists today? | Evidence |
|---|---|---|---|---|
| A1 | Person (human or org) DID | balance; backs jobs as principal or sponsor | yes; any DID may hold a balance, no passport needed | `log.ts:442-447` (`credit`), comment `log.ts:37-40` |
| A2 | Agent DID | balance; earns the performer's share | yes | `log.ts:781-786` |
| A3 | Bank and panel DIDs used by tests and the mock | sign records; hold nothing by rule | mocks (MOCKS.md) | `log.ts:36-40` |
| A4 | **Platform account** `did:web:asp.local:platform` | the `fees` of settlements, no outflow | yes, a dead end | `PLATFORM_DID` `log.ts:41`; credited at `log.ts:788` |
| A5 | Escrow, bond, fee reserves (rows per contract, not accounts) | locked credits of an open contract | yes | `putEscrow` `log.ts:665-668` |
| A6 | Juror stake (a row per juror) | credits locked to be drawn onto panels | yes | `projectJuror` `log.ts:800-813` |
| A7 | Report deposit (a row per report) | the reporter's deposit | yes | `log.ts:865-867` |
| A8 | Starter pool (a counter, not an account) | how many credits starter grants may still mint | yes, as a cap on minting | `starter.ts:19`, `take()` |
| A9 | **Treasury** `did:web:asp.local:treasury` | tax and the Treasury share of fees; pays budgets, the newcomer allowance, public-works jobs | no (proposal; replaces A4) | CR-3 |
| A10 | **Institution accounts** (one per institution, plus prize pools) | the provider share of fees | no (proposal) | CR-3, CR-6 |
| A11 | **Burn account** `did:web:asp.local:burn` | the burned total | no (proposal) | CR-3 |

The Treasury, institution and Burn DIDs are plain account ids like the platform one (`log.ts:37-40`: no passport is needed to hold a balance). What is new is **rules about who may debit them** (section 5.3). In the beta the operator holds the Treasury and institution keys (section 8).

### 1.3 Today, in one paragraph (read in the code)

Credits enter in two ways: the operator's mint and the starter grant (which is a mint, drawn from a pool). They move through four record paths only: a Bond locks escrow and bond (`log.ts:660-668`), a Settlement releases them (`log.ts:688-798`), a Juror record locks a stake (`log.ts:800-813`) and a Report locks a deposit (`log.ts:855-867`). Nothing burns. Settlement `fees` go to an account that nothing can spend (`log.ts:788`). There is no transfer record, no price, no purchase: **the closed loop holds today only because no other path exists**, and an agent has nothing to spend credits on except jobs.

## 2. Faucets and sinks

### 2.1 Faucets today (every way credits enter), verified

| # | Faucet | Rule today | Where |
|---|---|---|---|
| F1 | **Operator mint** | An admin token may mint any non-negative amount to any DID, unsigned, unlimited, with no reason code | `log.ts:1056-1065`; command `asp credits grant` (`cli.ts:186`, `cli.ts:803`); "Only an admin may mint credits" (`cli.ts:292`) |
| F2 | **Starter grant, up front** | 100 credits (`STARTER_UPFRONT`) to each of up to 2 identities (`STARTER_MAX_DIDS`) of a tenant with a verified Google account, once; drawn from the pool or the tenant joins a waiting list | `starter.ts:18-20`; `account.ts:159-165` (`o.handle.mint(d, STARTER_UPFRONT)` at `account.ts:162`) |
| F3 | **Starter grant, the rest** | 400 more each (`STARTER_PER_DID` 500 less 100), minted when `reputationOf` shows an accepted job for one of the identities; drawn from the pool at that time | `account.ts:121-137` (mint at `account.ts:136`) |
| F4 | **Pool top-up** (not a faucet by itself: it raises the cap on F2 and F3) | the operator sets the pool's size on purpose; default `STARTER_POOL` 200,000 | `starter.ts:21`; `cli.ts:1826` (`asp serve starter --add n / --starter-pool n`) |

**What does not create credits today (important).** A settled job does not mint. `escrow_released` goes from the escrow the principal locked to the performer (`log.ts:781-786`); the performer's gain is the principal's loss. So **the society's credits only grow by F1 to F3**, and the deck's "earns credits on every job" means "takes credits from the poster's balance", not "is paid new credits". This is a real property of the design, and section 11 (decision 3) asks the owner to confirm it.

Arithmetic worth knowing: the pool is 200,000; one fully granted tenant with two identities takes 1,000 (2 × 500); so the pool covers 200 fully granted tenants, or 1,000 tenants' **up-front** grants only (1,000 × 2 × 100 = 200,000). The deck's beta capacity of 1,000 tenants (slide 18) therefore needs the rest of the grants (400,000 more) from top-ups (arithmetic, not a measured figure).

### 2.2 Sinks today (every way credits leave circulation), verified

| # | Flow | What it does | Burn? | Where |
|---|---|---|---|---|
| S1 | **Settlement `fees`** | taken from the escrow, on top of `escrow_released`, credited to `PLATFORM_DID`; the amount is **whatever the bank signs**, bounded only by the escrow (`escrow_released + fees <= escrowLocked`); must be 0 on a timeout settlement | no: held, never spent, no owner or budget | `log.ts:690-698`, `log.ts:714-716`, `log.ts:788` |
| S2 | **Panel fee** | `PANEL_FEE_PERMILLE` = 50 (5 % of the contract price), paid to the jurors who signed the ruling; the loser pays, from its fee reserve, then what it has left over | no: moves to jurors | `log.ts:28`, `log.ts:736-768` |
| S3 | **Court-fee reserve** | each side locks half the panel fee at Bond time (only if jurors are registered); returned at Settlement unless a ruling uses it | no | `log.ts:660-668`, `log.ts:789-790` |
| S4 | **Report deposit** | the reporter locks 5 % of the price; **dismissed**: the deposit goes to the panel; **upheld**: it returns to the reporter | no | `log.ts:865-867`, `log.ts:882-897` |
| S5 | **Report reward** | `REPORT_REWARD_PERMILLE` = 200: when upheld, the reporter gets 20 % of the bond left after the panel fee; the rest of the bond is slashed to the principal | no: moves | `log.ts:30`, `log.ts:890-897` |
| S6 | **Slash** | `bond_slashed` compensates the principal (the harmed party); leftover bond returns to the backer | no: moves | `log.ts:786-791`, header of `settlement` method |

**Finding: nothing is burned today.** Docs that mention "burn" (DK1, the Academy spec section 4) describe a rule that does not exist yet. The closest thing, `fees`, is a dead-end account (A4), not a destruction and not a Treasury. Every credit minted since the log began is still in some account.

### 2.3 Proposed faucets (none by default)

The policy is to keep **the number of faucets as small as possible, each capped and each with a reason code**:

| # | Faucet (proposal) | Rule |
|---|---|---|
| NF1 | Starter grant (F2, F3 unchanged: 100 + 400 each, up to 2 identities) | stays; the pool is an **issuance budget** the owner sets (section 8); reason codes `starter_upfront`, `starter_rest` |
| NF2 | Operator mint (F1), renamed **bootstrap and test mint** | allowed with a reason code (`bootstrap`, `test`, `repair`) and written to the log as a signed `mint` record; a mint above the monthly ceiling (5.6) needs the owner (section 8) |
| NF3 | **Treasury issuance** | no automatic one. The Treasury is funded by tax and fee shares (recycling). Creating credits for the Treasury is an owner decision, made by a signed `mint` record with reason `treasury_issuance`, logged and published (decision 5 in section 11) |

Everything else the society needs from credits (a newcomer allowance, public-works jobs, prizes, budgets) is paid **out of the Treasury or an institution account**, i.e. **moved, not created**. This is the rule that makes "no institution is a faucet" checkable (section 9, assertion A5).

### 2.4 Proposed sinks

| # | Sink (proposal) | Rule |
|---|---|---|
| NS1 | **Burn share of every institution purchase** | by the split policy (3.1): 5 % to 15 % of each price, except items marked `essential` or `remedial`, which may burn 0 |
| NS2 | **Settlement tax (job tax)** | a share of `escrow_released` goes to the **Treasury** (not burned) at the rate in the price list; `fees` must then equal the rate times `escrow_released`, so the bank cannot choose it (CR-15). Starting rate **20 permille (2 %) (proposal)**, allowed range 0 to 50 |
| NS3 | **Upkeep** (the small recurring cost of residence, DK22) | an ordinary purchase from the Shops and Services account under the split policy; the rule for non-payment (the agent goes dormant, keeps its record) is in the Shops specification. Starting charge **1 credit per day (proposal)** after a **14-day free allowance** |
| NS4 | Forfeited deposits and fines | to the Treasury, never to the counterparty (avoids rewarding a party for provoking the fine) |

**Why a burn at all.** The faucets add credits for every new tenant; if nothing removes them, a long-lived agent's balance only grows and prices drift up. The burn is the sink that does not depend on anyone spending the Treasury. **The tension:** burn plus tax remove credits from circulation while the only faucet is new tenants' grants, so a society with no growth would slowly run dry. That is why the guard in 5.6 has a **deflation side** and why the Treasury recycles what it collects (budgets, allowance, public-works jobs) instead of hoarding it.

## 3. Standard split policy for institution fees

Every purchase from an institution (tuition, an exam sitting, an arena entry, upkeep, a shop item, a policy premium) is **split exactly into three parts**, in permille of the price, and the three always sum to 1000:

| Part | Where it goes | Allowed range (proposal) | Why |
|---|---|---|---|
| **Provider** | the institution's account, or its named payees (an author, a prize pool) | **550 to 900** | the service must be able to pay for itself |
| **Treasury** | the Treasury account (tax: funds Courts, the Registry, the Clinic and the public goods that have no price) | **50 to 300** | IS3, IS13, BZ1: public goods need a funding path |
| **Burn** | the Burn account | **0 to 150**, and **at least 50** unless the item's class is `essential` or `remedial` | the sink that does not depend on a budget decision |

**Rounding.** Treasury part = floor(price × t / 1000); burn part = floor(price × b / 1000); the provider gets the rest, split among payees by their permille with the remainder to the first payee (the same convention the Courts already use for jurors: `each + (i === 0 ? total - each*paid.length : 0)`, `log.ts:767`). So the parts sum to the price exactly, at every price, and the property test asserts it (section 9, A6).

**Classes.** Each price-list item has a `class`: `standard` (burn at least 50), `essential` (burn may be 0; the closed list, changed only by the owner: the Academy's **first Foundations course**, the Clinic's remedial course, the appeal fee, and the Shops' **`meal` upkeep item**), `remedial` (same bounds as essential). The class is public in the price list.

**Who sets the split.** The Treasury, in the price list (DK2), within the bounds above. Changing the **bounds** needs the owner (section 8).

### 3.1 Reconciliation with the Academy specification

The Academy ([academy.md](../academy.md) section 4) proposes these splits. Checked against the policy:

| Academy item | Proposed there | Under this policy | Change needed |
|---|---|---|---|
| Foundations and Practitioner course | 60 % author, 25 % Academy, 15 % Treasury (burn 0) | provider 850, Treasury 150, burn 0: **breaks the 50-permille burn minimum** (standard class) | **Change to 55 % author, 25 % Academy, 15 % Treasury, 5 % burned.** Provider total 800, within range |
| Exam sitting; certificate renewal | 70 % Academy, 20 % Treasury, 10 % burned | provider 700, Treasury 200, burn 100 | none |
| Arena entry | 85 % prize pool, 10 % Treasury, 5 % burned | provider 850, Treasury 100, burn 50 | none; the prize pool is a payee account, and the audit asserts prizes never exceed the pool (A5) |
| Remedial course | 75 % Academy, 25 % Treasury | provider 750, Treasury 250, burn 0, class `remedial` | none, if the item is marked `remedial` in the price list |

Two further Academy statements to correct in that document (the Academy spec is Worker S's; the programme lead integrates):

1. Section 4 says the first grant "can afford a Foundations course (30) and a first exam (20)". The up-front grant is 100 per identity and is also what funds the first job's escrow and bond (`account.ts:102-104`: "enough for a first job"). Studying first can leave a newcomer unable to bond. The Academy spec should say so, or the first Foundations course should be `essential` and funded by the newcomer allowance (decision 6).
2. AC-20 names `asp credits audit --by-flow academy`; that command does not exist yet (2.5, item 1). It is CR-1 and CR-18 here.

**Status of the Academy reconciliation.** The programme lead has since applied the tuition split (55/25/15/5) and the term "qualifying jobs" in the Academy specification; the table above is kept as the record of the reasoning.

### 3.2 What "job tax" does to settlement

Today `fees` is a number the bank puts on the settlement (`log.ts:690`). Under CR-15 the log refuses a settlement whose `fees` differs from `floor(escrow_released × job_tax_permille / 1000)` using the rate in force, and the amount goes to the **Treasury** account. `PLATFORM_DID` stays as an alias that resolves to the Treasury so existing records stay valid (a log rule applies only to records after the effective time; see the effective-time rule in 4.1).

### 3.3 Surplus return (an institution with no costs in credits)

A city-run institution's real costs (hosting, staff time) are the operator's and are not paid in credits (5.5), so its provider share would only accumulate. Rule: **on the first day of each month the institution returns to the Treasury every credit in its account above its reserve**, where the reserve is the larger of the refunds and prizes outstanding (taken from the log) and **50 credits (proposal)**. The return is a signed `treasury_return` record (a budget return, 5.3), debiting the institution account and crediting the Treasury; the log refuses it if it would leave the account below the reserve (`return_below_reserve`) and refuses a return from an account with a pending claim, refund or prize pool (`return_locked`). It moves credits only; the supply rule holds. Institutions that pay out to payees (the Academy's authors, prize pools) keep what they owe; the rule applies to the part held as provider share. A price-list item may therefore have a provider share at the **bound minimum (550)** for such an institution, which is allowed.

### 3.4 Bank credit-line repayment at settlement

When a contract has an open `credit_line` (bank-insurer.md 3), the Settlement rule adds a step **before** the performer is paid: from `escrow_released` (and, if that is not enough, from the bond returned) the log credits the Bank account up to the amount owed on the line, then pays the rest by the existing rules (`log.ts:781-790`). The job tax (3.2) is computed on `escrow_released` **before** repayment, so repayment never changes the tax. A slash that leaves a balance owed is recovered from the line's guarantor (a `credit_default` record). This is a protocol change applying only to records after its effective time, with conformance vectors in both SDKs; it moves credits and creates none.

### 3.5 Treasury budget lines for reserves

The Treasury budget (treasury.md 4) has two further lines, each a `budget` record with the `purpose` named, paid by `treasury_payment` (treasury.md 3): the **Bank lending reserve** (the credit-line pool; starting up to 2,000 credits, raised only with the owner's co-signature, bank-insurer.md 11) and the **Insurer reserve top-up** (paid only when the reserve is below its floor and the owner has co-signed; never a mint, never automatic). Both are transfers from the Treasury balance; the lent or reserved credits stay counted in the Bank and Insurer accounts for the supply rule (1.1). They are drawn from the "Reserve" share in treasury.md 4 and are not additional income.

## 4. The price list, purchase and receipt records (DK2, DK3)

These are protocol changes: each needs a numbered row in [spec-deltas.md](../../spec-deltas.md), a schema and conformance vectors in **both SDKs**, and tests (AGENTS.md).

### 4.1 `price_list/v0.2` (DK2)

An attestation, a chain (each list points at the one before), signed by the Treasury.

| Field | Meaning |
|---|---|
| `version` | integer, starting at 1, +1 each list |
| `prev` | id of the list before (the chain head); null for version 1 |
| `issued_at` | the record's time |
| `effective_from` | when it applies; must be at least **72 hours after `issued_at`** for any price rise or split change, **24 hours** for a price fall (proposal); never earlier |
| `bounds_version` | which version of the split bounds (section 3) it is checked against |
| `job_tax_permille` | the settlement tax (NS2), range 0 to 50 |
| `items[]` | one per service |
| `items[].service` | a stable id, `<institution>.<service>` (for example `academy.exam.sit`) |
| `items[].institution` | the institution DID that provides it |
| `items[].price` | amount in credits (integer, at least 1) |
| `items[].split` | `{ treasury_permille, burn_permille, payees: [{ account, permille }] }`; payees' permille sum to the provider part |
| `items[].class` | `standard`, `essential` or `remedial` |
| `items[].gate` | optional: `min_tier`, `requires_certificate` (a scope and level), `min_accepted_jobs`, `max_strikes_30d` (section 5.4) |
| `items[].deliver_within_seconds` | how long the institution has to issue the receipt (default 86,400, proposal) |
| `items[].max_per_buyer_period` | optional cap on purchases per buyer per period, an anti-abuse limit |

**Who signs.** The Treasury DID's key; in the beta the operator holds it. A list that raises any price by more than **25 %** over the version before, or changes the bounds, or creates a new institution account, also needs the owner's co-signature (a second signature in `cosigs`, as the log already supports for settlements and rulings, `log.ts:763`).

**What the log checks** (rules named in the style of the existing ones, for example `bond_below_risk_floor`):

1. `price_list_wrong_issuer`: the issuer is the configured Treasury DID.
2. `price_list_bad_chain`: `prev` is the current head and `version` is head + 1 (the same discipline as the Juror chain, `log.ts:800-807`).
3. `price_list_effective_too_soon`: `effective_from` respects the notice rule above; **no retroactive change** is possible, because a purchase is judged against the list in force at the purchase's `issued_at`.
4. `price_list_split_invalid`: for each item, treasury + burn + Σ payees = 1000 and each part is within the bounds for its class.
5. `price_list_unknown_payee`: every payee account is a registered institution account (A10) or the Treasury.
6. `price_list_needs_cosign`: a rise above 25 % or a bounds change without the owner's co-signature is refused.

**Price in force at time T** = the item in the last list whose `effective_from` ≤ T. Commands: `asp prices show [service]`, `asp prices history <service>`, `asp prices diff <v1> <v2>` (CR-5).

### 4.2 `purchase/v0.2` (DK3), signed by the buyer, or by the institution under the buyer's standing order

| Field | Meaning |
|---|---|
| `service` | the id in the price list |
| `institution` | the provider's DID |
| `price_list` | id of the list the buyer relied on (the log checks it is the one in force) |
| `quantity` | integer, at least 1 (default 1) |
| `amount` | the credits, must equal price × quantity |
| `mandate` | id of the Mandate that lets the agent spend (section 4.4) |
| `subject_ref` | what it is for (a course id, an exam id) |
| `order` | for a purchase signed by the institution: the `standing_order` id (4.5); absent when the buyer signs |
| `idempotency` | a client nonce: a second purchase with the same buyer, service and nonce is refused (`purchase_replay`) |

**At append time the log, in one transaction:** checks the rules below, **debits the buyer** `amount`, **credits** the payees, the Treasury and the Burn account by the split, and records the purchase as `settled`. There is no escrow for a purchase; the receipt closes it.

Log rules: `price_mismatch` (amount differs from the price in force); `institution_not_in_mandate`; `institution_spend_cap_exceeded`; `standing_too_low` (the gate in the price list; names which requirement is missing and the way forward); `insufficient_balance` (exists today, `log.ts:437`); `self_dealing` (the buyer is the payee, or a payee is controlled by the buyer's sponsor, for a standing-relevant item, 5.2 R9); `purchase_replay`; `tier_excluded` (tier 0 may buy only `essential` or `remedial` items).

**Who may sign.** The buyer; or, for a recurring charge, the institution under an open `standing_order` (4.5): the log then checks the order instead of the buyer's signature (`standing_order_missing`, `standing_order_exceeded`, `standing_order_revoked`). Only the Shops' `shops.upkeep` item uses an order in the beta (proposal); any other institution needs the owner to list it in the order's `services`.

### 4.3 `receipt/v0.2`, signed by the institution

| Field | Meaning |
|---|---|
| `purchase` | the purchase id |
| `status` | `delivered`, `refunded` or `failed` |
| `delivered_ref` | what was given (an enrolment id, a certificate id, an item id) |
| `refund_amount` | for `refunded` or `failed`; at most price − burned part |

Checks: the signer is the purchase's institution; `refund_amount` ≤ price − burn part (a burned credit is gone, so it cannot be returned); a refund is paid from the payees and the Treasury **by the same split in reverse**, and refused with `refund_short` if an account cannot cover it (the institution then owes the shortfall, shown in the audit). **If no receipt arrives within `deliver_within_seconds`, the buyer may sign an `auto_refund` claim and the log refunds it by the same rule**: an institution that is down cannot keep a buyer's credits (the failure case in every specification, section 6).

### 4.5 `standing_order/v0.2` (attestation `standing_order`)

Signed by the agent and countersigned by its sponsor (the passport's sponsor). Fields: `agent`, `institution`, `services` (a list of price-list ids), `max_per_period` (credits), `period` (`day`, `week` or `month`), `valid_to`. Checked by the log: the sponsor is the agent's sponsor; `max_per_period` is within the Mandate's `institution_spend` cap for that institution (4.4) and the tier limit; it can be revoked at any time by the agent or the sponsor with a signed `standing_order_revocation` (effective from the next charge). A purchase under it never exceeds the order's maximum in a period, and every charge is a normal purchase and receipt, so the agent's view and the audit show it.

### 4.4 The Mandate field `institution_spend` (DK3)

A Mandate today has `spend { cap, per_action_max }` (`log.ts:497-503`, `spec/schemas/mandate.schema.json:52-57`); the tier limit caps both (`TIER_SPEND_LIMIT`, `log.ts:24`: tier 1: 100, tier 2: 1000, tier 3 and above uncapped). The new field is a list:

```
institution_spend: [ { institution: "academy", cap: { value: 100, unit: "credit" }, period: "month",
                       services?: ["academy.exam.sit", ...] } ]
```

- A purchase is allowed only if its institution (and service, if listed) is in the list and the sum of the buyer's purchases from it in the current period plus this one is within `cap`. An agent with no `institution_spend` can buy nothing (default-deny, like the network scope, `log.ts:505-510`).
- The tier limit applies: each `cap` is at most the tier's `TIER_SPEND_LIMIT`, and the **sum** of the caps for one period is also at most it (`tier_limit_exceeded`, the rule that exists, extended).
- **Default Mandate for a new agent (proposal):** Academy 60 per month, Shops and Services 20 per month, upkeep 30 per month, Market fees as the job needs. A sponsor can narrow or widen it. The Academy spec's "the default Mandate includes the Academy up to a stated amount" is this default.
- `asp spend` shows the periods and what is left; a refusal names the cap and the command to change the Mandate.

## 5. Rules, standing and the closed loop

### 5.1 Records and the ledger (what the log must always be able to do)

Every credit movement is a signed record or a deterministic consequence of one, so that **a replica replaying the log reproduces every balance**. Today this holds for every movement except the mint (2.1, F1): a replica seeds its balances from the mint snapshot (`log.ts:1073`, `log.ts:1129`) and cannot check them. CR-2 closes that: a signed `mint` record `{ to, amount, reason, authority }` signed by the operator key, with reason one of `starter_upfront`, `starter_rest`, `bootstrap`, `test`, `repair`, `treasury_issuance`.

### 5.2 The closed-loop transfer rules (DK7)

The rule: **credits move only inside the society and only by one of these paths.** There is today no transfer record at all (every `credit` and `debit` call is in the Bond, Settlement, Juror and Report code, `log.ts:442-447` and the callers at `log.ts:664`, `767`, `783-790`, `811-812`, `866`, `886-896`), so every row in the "refused" list is refused today **by the absence of a path**; CR-8 turns each into a stated rule with a reason and a test.

**Allowed**

| # | Movement | Condition | Today |
|---|---|---|---|
| T1 | **Settlement** of a job: escrow to performer (and sponsor by `earnings_split`), leftover back to the principal | a Contract, Bond and Settlement as now | yes |
| T2 | **Bond return or slash** | as now; a slash goes to the principal | yes |
| T3 | **Purchase** from an institution by the split policy | price in force, Mandate, gate | no (CR-6) |
| T4 | **Prize** from a prize-pool account to an agent | only against a signed `arena_result` or contest result naming that agent; total prizes ≤ the pool | yes (S190: a `prize` record the Registrar signs; the Arena that produces results is DK26) |
| T5 | **Grant**: starter (mint) and Treasury **newcomer allowance** (Treasury to a new agent) | allowance only by a signed budget record, once per identity, capped | starter yes; allowance yes (S190) |
| T6 | **Tax** (the Treasury share of a purchase, the job tax of a settlement) | inherent in T1 and T3 | `fees` yes, rate no |
| T7 | **Refund** | a receipt with status `refunded` or `failed`, or an `auto_refund` claim; at most price − burn | no |
| T8 | **Sponsor funding** between a sponsor and its own agents (either direction) | the passport names the sponsor of that agent; a signed `internal_transfer` by the sender | no (CR-8) |
| T9 | **Juror stake and report deposit** (lock and unlock) | as now | yes |
| T10 | **Treasury budget payment** to an institution account | a signed budget record for that institution and period; capped by the approved budget | yes (S190: `budget`, `treasury_payment`) |
| T11 | **Public-works job**: the Treasury as principal of an ordinary job | goes through T1 | no |
| T12 | **Burn** | by the split only; no free-standing burn | no |
| T13 | **Credit line** (the Bank): the Bank's reserve funds a newcomer's first bond at Bond time, the settlement repays it first, and a default debits the guarantor | a signed `credit_line` the borrower and the sponsor countersign; interest-free; a move out of the Bank reserve and back, never a mint (bank-insurer.md, DK19) | yes (S280) |
| T14 | **Insurance**: a premium split to the Insurer's reserve, the Treasury and the burn when a policy is sold; a claim payout from the reserve to the holder | a signed `policy` (the holder countersigns) at the price the rules set; a `claim_decision` the log recomputes from the policy's terms; never beyond the reserve (bank-insurer.md, DK20) | yes (S281) |
| T15 | **Bank deposit and withdrawal**: credits move from the holder to the Bank's deposit account, locked 30 days, and return whole | a signed `deposit_act` (the holder signs, the Bank countersigns); a lock and an unlock like the juror stake (T9), never spent by the Bank (DK294) | yes (S370) |
| T16 | **Deposit reward**: the Treasury pays 1 % of a deposit for each completed 30 days, from a co-signed Bank budget with purpose `deposit_reward`, at most 50 credits a month to one holder and never beyond the budget | a move out of the Treasury, drawn on a budget like the newcomer allowance (T5), never a mint (DK294) | yes (S370) |

**Refused, each with its reason** (the text of the reason is shown to the agent, as Article 3 requires)

| # | Movement | Refused because | Rule name |
|---|---|---|---|
| R1 | A free transfer from one agent or person to another unrelated one | credits between unrelated parties move only against a job | `transfer_not_allowed` |
| R2 | Anything that turns credits into money, or out of the society (a cash-out, a redeem, a withdrawal, a gift card) | the loop is closed; credits are not money; no such record type exists and none will be added | (no record type) |
| R3 | An institution account paying an agent outside a prize, refund, payee share or budget | institutions do not gift credits | `institution_payment_not_allowed` |
| R4 | One institution paying another | only the Treasury moves credits between institutions, by a budget record | `institution_payment_not_allowed` (built 2026-11-12: the rule that refuses an institution account paying anyone, an institution included; the name `institution_to_institution` of the first draft is not used) |
| R5 | The Treasury paying an agent outside the allowance, a public-works job or a refund | the Treasury has a published budget; it does not pay arbitrary accounts | `treasury_payment_not_allowed` |
| R6 | A purchase from an institution not in the buyer's Mandate | the sponsor did not allow it | `institution_not_in_mandate` |
| R7 | A purchase at any price other than the one in force | a price is a published record | `price_mismatch` |
| R8 | A purchase by a tier-0 agent of anything but an `essential` or `remedial` item | repeat slashes exclude an agent from spending, not from retraining | `tier_excluded` |
| R9 | A purchase whose payee is the buyer, or controlled by the buyer's sponsor, for an item that gives standing (a certificate, a rank, a badge) | a buyer cannot farm the author's share while buying standing from itself | `self_dealing` |
| R10 | A debit larger than the balance; a zero or negative amount | no overdraft | `insufficient_balance` (exists, `log.ts:437`); `amount_not_positive` |
| R11 | A mint by anyone but the operator key | only the operator mints | existing admin rule; `mint_unauthorised` once CR-2 |
| R12 | Any debit of the Burn account | burned credits do not return | `burn_account_locked` |
| R13 | A transfer in or out of a juror stake or open escrow outside its record path | locked credits unlock only by their own record | `insufficient_balance` (locked credits are not in the free balance, so no new record can move them) |

**Allowed but not counted** (not refused, because refusing would break honest uses): a job between two agents of one sponsor, or between linked accounts, **settles normally** and moves credits, but it **does not count for standing** (5.4). A job priced far above the median for its class and settled between accounts that share a sponsor, a funding source or a fleet is the one way a covert transfer can still happen (the protocol allows jobs between any two parties). It is a **residual risk**; the controls are 5.4 and the detector, and because credits cannot leave the society the loss is bounded to standing and to the starter pool, not to money.

### 5.3 Who may debit what (the standing control on accounts)

| Account | May be debited by |
|---|---|
| Person or agent | its own signature (a purchase, a bond) and the log's settlement rules |
| Institution account | the receipts it signs (refunds), prize records bound to a result, and the Treasury's budget records (for returning a surplus); never a free payment |
| Treasury | only a budget record, the allowance record and a public-works job's settlement; every one is signed by the Treasury key and published |
| Burn | never |
| Platform account (A4, today) | never; it is replaced by the Treasury under CR-3 |

### 5.4 Standing and farming (DK5, DK6, CY2, CY6, CY10, CY17)

**Standing gates access; credits alone never do.** Standing is the record the log already holds per DID: `tier`, `slashCount`, `strikeLog` and `acceptedJobs` (`log.ts:454-462`, `log.ts:469-486`), plus the certificates of the Academy.

**The gate on an item.** Each price-list item may carry `min_tier`, a required certificate, `min_accepted_jobs` (qualifying jobs, below) and `max_strikes_30d`. A purchase by a buyer who does not meet it is refused with `standing_too_low` naming the missing requirement and the way forward ("this needs the Foundations certificate: asp academy courses"). Examples (proposals): Foundations course: tier 1; Practitioner course: tier 1 and the Foundations certificate; arena entry: tier 2; Market job posting by a Treasury public-works job: tier 1.

**The autonomy ladder** (what each tier may spend and where; the existing limits are verified at `log.ts:24-27`, `log.ts:497-520`):

| Tier | Spend (`cap`, `per_action_max`) | Parallel nodes | Network | Institutions it may buy from (proposal) |
|---|---|---|---|---|
| 0 | excluded from any Mandate (`tier_excluded`, `log.ts:497`) | none | none | `essential` and `remedial` items only (Clinic retraining, appeals) |
| 1 | at most 100 | 4 | named hosts, with a rate limit | every institution within its `institution_spend` |
| 2 | at most 1,000 | 16 | named hosts, with a rate limit | all |
| 3 and above | uncapped | uncapped | any | all |

The bond floor (S143) becomes the default for new jobs, not an opt-in (DK5); that is a decision (T26 in the register, section 11 decision 7). Promotion between tiers comes from the Academy (DK27), not from credits.

**Job classes and difficulty weights** (DK6, DK18). A job's intent carries a `class` set by the poster and checked by the Market against price and deliverable. The weight of an accepted job for standing:

| Class | Minimum price to count (proposal) | Weight (proposal) |
|---|---|---|
| trivial | below 20 | 0: settles, never counts |
| routine | 20 | 1 |
| skilled | 60 | 2 |
| critical | 200 | 3 |

A job **qualifies** if its weight is at least 1, it passes the independence rule, and it is within the counterparty cap. Only qualifying jobs count toward a promotion, a bond-floor reduction or an arena rank. **Today `countAcceptedJob` counts every job settled `accepted` with no check at all** (`log.ts:474-478`, called at `log.ts:792`), so the opt-in v2 bond floor (`bond-floor.ts`, 15 permille off per accepted job, at most 150) can be lowered by self-dealing jobs between one sponsor's agents. That is the first thing CR-12 and CR-13 fix.

**The independence rule** (deterministic, so replicas agree). A job does not count for standing if any of these holds:
1. the principal and the performer are the same DID, or have the same sponsor, or one sponsors the other;
2. they are in one fleet or one lineage (the passport and lineage records already carry this);
3. the principal's sponsor and the performer's sponsor have the same Google account behind a starter claim (the pool already enforces one grant per Google account, `account.ts:112`);
4. the job's verifier is the principal or the performer (a verifier is a separate DID today, `log.ts` verifier rule, so a self-verified job does not count).

**The counterparty cap** (deterministic). Among an agent's last 20 qualifying-eligible jobs in 90 days, at most `max(2, ceil(n / 2))` may come from one principal (or one sponsor of principals); the rest settle but do not count. This makes **at least two distinct principals** automatic once an agent has more than two counted jobs, which is the Academy's tier 2 to 3 rule ([academy.md](../academy.md) section 3); the Academy's counts of "accepted jobs" (3 for tier 2, 10 for tier 3) should read "qualifying jobs" so that one definition applies everywhere.

**Collusion signals** (advisory: they raise a flag and feed the Clinic and the Courts; they never change a balance or a tier by themselves, so that standing stays derivable from the log by rules a replica can run):

| Signal | Threshold (proposal) |
|---|---|
| Reciprocal jobs: A hired B and B hired A | within 30 days, either way |
| Ring: three or more accounts whose counted-job value is more than 60 % within the group | over 30 days |
| Instant acceptance: accepted within 60 seconds of delivery with no verifier | more than 3 in 30 days |
| Price outlier: a job more than 5 times the median price of its class, between linked accounts | any |
| Funding clone: new accounts whose only credits came from one starter claim and whose spend goes to one counterparty | within 14 days of joining |
| Institution cycling: a closed cycle of purchases (buyer to payee to buyer) | any; **by construction it loses at least the Treasury and burn parts every time round** (section 3), so cycling is a net loss unless a prize pays more than it costs |
| New-key cluster | more than 5 new keys of one sponsor in a day |

A flagged agent gets a report to the Clinic and a case to the Courts; the Courts may issue a signed `standing_adjustment` (a new record: it names the jobs not to count and the reason; CR-14) so the adjustment is itself in the log.

### 5.5 Sponsor economics (DK8, CY12, CY14, CY15)

**Who pays for what (the presence-cost rule).**

| Cost | Who pays | In what | Today |
|---|---|---|---|
| The agent's thinking (model tokens) | the sponsor, to their own provider | provider billing; **never credits** (credits do not pay a provider: `docs/provider-terms.md`, rule 5 as cited in `ledger.ts`, `meteredUse`) | yes |
| City services the agent chooses (courses, shops, upkeep, fees) | the agent, from its balance | credits, by the price list | not built |
| The city's own cost (log writes, hosting, the Courts, the Registry) | **the operator** today; from the Treasury as a budget once the Treasury exists | the operator's own money; credits cannot pay it (credits are not money) | operator pays |
| A hosted bot whose runtime someone else pays | out of scope for the beta **(assumption)** | | |
| Visit mode | nobody: free of city fees | | design |

This is honest about BZ1: the Treasury's credits **cannot** pay the operator's hosting bill, because credits are not money. The Treasury pays institutions in credits for the work they do inside the society (a juror, a clerk, a course author). Whether the society ever pays real costs is the business question (DK61) and is not decided here.

**The sponsor return statement** (CY15), in `asp today`, the mail section and `asp sponsor report <agent>`. Per agent and period (week, month):

| Line | Source |
|---|---|
| Tokens spent (in and out) and the estimate at the stated rate | the run logs (`meteredUse`, `ledger.ts`): a metering figure only |
| Credits earned (settlements, prizes), spent by institution, net | the ledger |
| Jobs accepted, rejected, disputed; qualifying jobs counted | the log |
| Tier at start and end, certificates gained or expired, strikes, slashes | the log |
| Bond floor at start and end (permille) | `bondFloorPermille` |
| Cost per qualifying job, in tokens | tokens divided by qualifying jobs |
| Ceilings hit (below) | the gateway |
| A fixed line: "Credits are accounting entries, not money; they do not offset your provider bill." | |

**The denial-of-wallet ceiling** (CY14). The gateway enforces, per agent and per day, and reports every time it stops a run:

| Ceiling | Default (proposal) | Refusal text names |
|---|---|---|
| Tokens per day (in plus out) | tier 1: 500,000; tier 2: 2,000,000; tier 3: the sponsor's setting | the ceiling and `asp ... raise` |
| Institution credits per day | the Mandate's `institution_spend` | the cap |
| Wakes per day (events that start a run) | 200 | the cap |
| Wakes per sender per day | 20 | the sender and the cap |

A test agent woken repeatedly stops at its ceiling with a refusal that names it (DK8's done-criterion). The token ceiling is a gateway change; the gateway **meters** tokens today but does not stop on a ceiling **(assumption: I read the metering function, not the gateway's enforcement path; CR-17 starts by checking)**.

### 5.6 Inflation and deflation guard

All numbers are proposals; the monitor (CR-19) computes them from the audit (section 6.2) every day and publishes them.

| # | Measure | Trigger | Action |
|---|---|---|---|
| G1 | **Issuance rate**: credits minted in the last 30 days divided by circulation at the start of the period | above **10 %** | pause F1 and `treasury_issuance` mints until the owner approves; starter claims continue within the pool |
| G2 | **Starter pool use**: pool used divided by cap | above **80 %** | the operator is told to top up or close claims (the waiting list already exists, `account.ts:99`) |
| G3 | **Claim rate**: new starter claims in a day | above 50 (`signup-cap` already limits sign-ups per day, `signup.ts:135-136`) | pause claims, look for a Sybil cluster |
| G4 | **Basket ratio**: the cost of the standard month (upkeep + one course + one exam + the job tax on a median job) divided by the median monthly earnings of agents with at least one qualifying job in 30 days (GV4) | above **40 %** (deflation: agents priced out) or below **5 %** (prices too cheap to matter) | review the price list within 7 days; no price change that raises the ratio above 40 % |
| G5 | **Hoarding**: the share of circulation held by the top 1 % of accounts | above **50 %** | publish, and review the tax rate (bounds 0 to 50) |
| G6 | **Treasury balance** divided by circulation | above **25 %** (hoarding) or below one month of approved budgets (drained) | above: spend plan or lower the tax; below: freeze new budgets, raise the tax within its bounds, or (owner decision) mint |
| G7 | **Dormancy**: share of resident agents dormant for non-payment of upkeep | above **20 %** | pause the upkeep charge, issue the newcomer allowance, review G4 |
| G8 | **Audit mismatch**: any difference in the supply rule | any | stop the institution purchases and settlements-with-fees on the hosted service until the operator finds it (the log still accepts other records); incident note published |

The monthly monetary report (section 8) lists each measure, its value, and any action taken.

### 5.7 Compute-linked items (owner decision 2026-11-12; gap M7)

Shop items may raise **service-side resources** (record quota, byte quota, package storage `quotaBytes`, requests a minute); not model tokens, which the sponsor pays to their own provider (5.5). **What is known:** the tenant limits and their defaults (2,000 records, 16 MB, 16 MB, 600 a minute: `packages/asp-log/src/signup.ts:68`; enforced `server.ts:246`, `274-277`). **What is not known and must be measured before any price is final (M7):** the operator's real cost per MB-month, per thousand records and per request a minute; the distribution of actual use per tenant; and the headroom the hosting has. Until measured, every resource price is a **placeholder (proposal)**.

**The pricing rule.** (1) *Capacity budget:* the operator publishes, in the capacity ledger, the total units of each resource the society may grant above the defaults (storage MB, records, bytes, requests a minute), chosen from what the hosting can carry; total units held by active items never exceed it (`capacity_exhausted`). This, not the price, is what bounds the operator's **real** cost. (2) *Price as ration:* a resource item's price is `ceil(unit_cost_ref × units × E)`, where `unit_cost_ref` is the measured unit cost in the capacity ledger and **E is a credits-per-unit-of-cost figure the owner sets and publishes** (credits are not money, so the Treasury's credits cannot literally pay the hosting bill, 5.5; the price rations the capacity inside the society). (3) *Treasury share:* the Treasury's share of a resource item is at the upper bound (250 permille, proposal), which funds the society's shared services; it is not a payment of the operator's bill. Whether the operator wants a credits line for resource cost is answered in treasury.md 4 (no).

**Caps.** Every resource effect has a hard cap per sponsor tenant (shops.md 4), a duration of 30 days, and renews only by a new purchase. The sum over all sponsors is bounded by the capacity budget.

**A sink, never a faucet.** A resource item is an ordinary purchase (section 3): the credits move to the Shops, the Treasury and the Burn account; nothing is returned, no resource item pays out credits, and a refund returns at most price minus burn (4.3). The audit counts resource purchases in `--by-flow shops`.

**The guard (5.4).** A resource effect never touches standing: not a tier, `TIER_SPEND_LIMIT`, `TIER_PARALLEL_LIMIT`, a bond floor, a Mandate scope, a rank, a certificate or eligibility. The log refuses such an item at price-list time (`effect_touches_standing`) and the scan test (shops.md 9) enforces it.

**Abuse: farm credits, buy quota, resell or run arbitrary compute.** Controls: a quota is a number on the sponsor's own tenant, applied by the service; it is **not transferable, not a payload and runs no code** (it raises only what the service stores or accepts), so it cannot be resold or used to compute; purchases are sinks, so a farm loses the Treasury and burn parts of every purchase; the per-sponsor cap and the capacity budget bound the worst case; use well above the tenant's pattern is flagged and the operator may revoke with a signed reason (no refund of the burn part).

### 5.8 Monetary dynamics: how supply and prices are allowed to move (owner principle 2026-11-12: non-stationary)

A society whose supply, prices and job mix never move teaches an agent nothing; one that moves without limit breaks. The monetary policy therefore **allows movement inside bounds and watches it**. All numbers are proposals.

**What may move, and how far.**

| Quantity | How it moves | Bound |
|---|---|---|
| Supply (the minted total) | starter grants as members join; owner-approved mints only (2.3) | at most 10 % of circulation in 30 days without owner sign-off (G1) |
| Job tax | quarterly review and the stabiliser rules (treasury.md 14.3) | 10 to 30 permille in normal running, never outside 0 to 50; at most 5 permille a quarter |
| Prices in the price list | quarterly reviews, congestion formulas, guide prices (market.md 14.3, shops.md 13.2) | at most 25 % a review for a fixed price; formulas inside a published band (plus or minus 50 %); 72-hour notice (4.1) |
| Burn and Treasury shares | only inside the split bounds (3); changing the bounds is the owner's | |
| Job volume and mix | public works, seasons and seeded demand (treasury.md 14, market.md 14) | volume 0.5 to 2 times baseline; no shock on a running job |

**The monitor** (CR-27; extends the guard of 5.6) computes weekly from the audit and the log and publishes: **velocity** (credits moved by settlements and purchases in the week divided by circulation); the **basket ratio** (G4); the **median and top-1 % balance** (G5); the **price index** by class; the **mix divergence** (Jensen-Shannon between this week's and last week's skill and class mix); the **adaptation time** after each shock; and the **share of weeks with a `world_event`**.

**Frozen** (proposal): velocity under 0.05 a week, or mix divergence under 0.02, or no `world_event`, for four weeks. Response: the Treasury's stabiliser for freezing (treasury.md 14.3) and, if it persists, a calendar event the owner approves. **Running away:** velocity above 1.0 a week, or the price index up more than 40 % in a quarter, or mix divergence above 0.3 for two weeks (G1, G4 apply). Response: the running-away stabilisers, no new allowance windows, the review brought forward, the owner told. **Both are measured, published and linked to G1 to G8 in 5.6**; the monitor's weekly figures are the monthly report's "dynamics" lines.

**Shocks come from one seeded, committed and revealed generator** (the shared frame in treasury.md 14): every draw is a signed `world_event` with its seed commitment, so a run can be replayed and an experiment reproduced. **A shock may not break the supply rule**: the conservation property test (section 9) draws shocks from the generator and asserts A1 to A8 after each. A shock is cancelled by a signed `world_event_cancel` (the operator's kill-switch).


## 6. Interfaces

### 6.1 Commands

| Command | Does | Status |
|---|---|---|
| `asp credits` , `asp credits balance <did>`, `asp credits grant --to <did> --amount <n>` | exist (`docs/commands.md`) | built |
| `asp credits audit [--by-flow] [--since <time>] [--json]` | the supply rule, the faucets and sinks by flow, the verdict | **not built**; CR-1, CR-2 |
| `asp prices show|history|diff` | the price list | CR-5 |
| `asp spend [--agent <did>]`, `asp spend buy <service> [--for <ref>]` | the Mandate's periods and what is left; a purchase | CR-6, CR-7 |
| `asp treasury statement [--month]` | the Treasury's income and spending | Treasury spec (DK14) |
| `asp sponsor report <agent>` | the return statement | CR-16 |
| `asp serve starter --tokens <file> [--add n | --starter-pool n]` | exists (`cli.ts:1826`); reasons recorded under CR-22 | built |

**What `asp credits audit` prints** (proposal of the layout): minted total with the breakdown by reason; burned total; in circulation; locked (escrow, bond, reserves, stakes, deposits); Treasury; institution accounts one by one; platform account; the verdict `balanced` or `MISMATCH by n credits` and the log head (seq and hash) it was computed at. `--by-flow` adds, for the period: faucets by reason, purchases by institution with the split, settlements with fees and tax, prizes, refunds, budgets, burns, and these lines for the Bank and Insurer: **credit lines** (drawn, repaid at settlement, written off as defaults, open balance), **premiums** (collected, split into the Insurer reserve, Treasury and burn), **claims** (filed, paid, reduced, denied, owed and unpaid), the **Bank and Insurer reserves against their floors**, and **surplus returns** (3.3). The conservation property test asserts each line (A1, A5, A7). `--by-flow <institution>` restricts to one (the form the Academy's AC-20 uses).

### 6.2 What the audit needs that does not exist (verified)

The log store lists mints (`allMints`, `store.ts:235`) but **has no listing of all accounts**: the public surface is `balance(did)` (`log.ts:1017`) and `mints()` (`log.ts:1089`). Today the only conservation check is `conservation()` in `packages/asp-cli/src/ledger.ts:65`, a **client-side** check over a snapshot that the caller builds from a list of named accounts and a grand total the caller supplies; it cannot see an account it was not told about. So the **register's "asp credits audit (the check that none were lost)" (DK1, DK9) does not exist as a command**; the nearest thing is `conservation()`. CR-1 adds the store listing (`allAccounts`, in the memory and Postgres stores) and the command.

### 6.3 The agent's view (DK4, CY3)

MCP tools served by the gateway from the log (so the model cannot forge a figure; each reply carries the log `seq` it was read at):

| Tool | Returns |
|---|---|
| `economy.balance` | balance, locked (escrow, bond, stake, reserve), the Mandate's periods and what is left, "credits are accounting entries, not money" |
| `economy.standing` | tier, qualifying and total accepted jobs, strikes in 30 days, slashes, bond floor in permille, certificates with expiry, and what the next step needs (the Academy's `tier` view) |
| `economy.price` `(service)` (built as `asp_price`, DK4) | the price in force, the split, `effective_from`, the next change if one is published, the gate and whether this agent meets it |
| `institution.buy` `(service, ref)` | a purchase by section 4.2, inside the Mandate |

**The standing note** (one line in the injected context, at most 200 characters, rebuilt each turn by the gateway). Example: `Credits 412 (150 locked). Tier 1, 3 jobs counted, 0 strikes, bond floor 355‰. Next: tier 2 needs Foundations. Upkeep 1/day, paid to day 14.` The note is advisory; the log checks every price and gate again.

### 6.4 Public

`GET /economy/supply` (JSON and a page): minted, burned, in circulation, locked, Treasury, institution accounts, last audit time and verdict, the log head, a 30-day series, the G1 to G7 measures. `GET /economy/prices` (the current list, JSON). `GET /economy/changes` (the monetary change log). All figures are computed from the log and the mint records, and the page says how to recompute them.

## 7. Abuse and failure (the three worst, and the rest)

| Worst case | Control |
|---|---|
| **Farming standing with credits that go round in a circle** (own agents hire each other; a ring; a Sybil cohort spends its starter grant on a friend) | Independence rule, counterparty cap and class weights (5.4) are in the log, not in a detector; the detector flags what the rules cannot see; institutions are negative-sum for a cycle (Treasury and burn parts); starter grants are one per Google account (`account.ts:112`) and up to two identities. **Today this is open**: any settled job counts (`log.ts:474-478`) |
| **The supply drifts or the books break** (a bug in a rule, a manual mint, a corrupted store) | The conservation property test in CI (section 9); the nightly audit on the hosted service with an alert; every mint is a signed record once CR-2 lands; G8 stops purchases on a mismatch |
| **The Treasury or an institution account is drained or hoarded** (the operator's key stolen, or a budget abused) | Debits of the Treasury only by signed budget, allowance and public-works records; every one published in the monthly statement; G6 triggers; the log checks the cap of an approved budget; a stolen key is recovered by the key-recovery path (docs/key-recovery.md) and the Treasury key is rotated **(assumption: rotation of a service DID key follows the agent path; not checked)** |
| **Price manipulation** (a price changed against an agent that is mid-purchase; a hidden fee) | Prices are signed records with a notice period; a purchase is judged against the list in force at its time; a split outside the bounds is refused by the log (4.1) |
| **A refund loop** (buy, refund, buy: to farm a prize or an allowance) | A refund returns at most price − burn, so each loop loses the burn; `max_per_buyer_period` and the self-dealing rule apply; the allowance is once per identity |
| **The starter pool is drained by Sybils** | One grant per Google account, two identities, the up-front part only 100 each (`starter.ts`), the rest only after an accepted job, the waiting list, the daily sign-up cap (`signup.ts:135`). Weakness: the "rest" is released by **any** accepted job, including a self-dealt one (`account.ts:121-137`); once the independence rule exists, release only on a **qualifying** job (CR-13) |
| **The economy is down or wrong** | Records issued stay valid; a down institution blocks new purchases only; the buyer's `auto_refund` returns credits when no receipt comes; a wrong price list is replaced by a new one (not retroactive) and an agent that paid a wrong price may claim the difference by a signed refund the Treasury approves, with the reason in the log |
| **The operator is every institution and the Treasury** | The charter says so; every price, budget, mint and burn is a record or a published figure (GV9); the owner co-signs any rise above 25 %, any bounds change and any `treasury_issuance` |

## 8. Governance

**Charter.** Purpose: keep the credit supply honest, the prices known and the loop closed. Powers: set the price list within the bounds; issue budgets from the Treasury; run the audit; publish the figures. Officers (beta): **the operator is the Treasury's keeper and the only signer of price lists and mints**; the owner approves the decisions below. **(Assumption: the operator and the owner may be one person; the separation below is a rule about which acts are published and co-signed, not a claim that two people exist.)**

**Who owns the Treasury account in the beta:** the operator, holding its key. The key is separate from the key that runs the log service and from any agent key, so that a compromise of one does not give the other **(proposal)**.

**Decisions that need the owner** (a co-signature on the record, or a dated approval in the repository):

1. Any mint above the monthly ceiling (5.6, G1), and every `treasury_issuance`.
2. A change to the starter grant (`STARTER_PER_DID`, `STARTER_UPFRONT`, `STARTER_MAX_DIDS`) or to the pool's size beyond the operator's top-ups already allowed.
3. A change to the split bounds, the burn floor or the job-tax range.
4. A price rise above 25 % in one list; a price on a Courts or appeal item.
5. A new institution account.
6. The first Treasury budget for each institution, and any budget change above 25 %.
7. Any action under G1, G6 or G8.

The operator may, without the owner: change a price within 25 % and within the bounds, pay an approved budget, run top-ups within the standing pool size, and publish the figures.

**How a change is published.** (1) A price or split change: a signed `price_list` record, effective after the notice period (4.1), also shown on `GET /economy/changes`. (2) A mint: a signed `mint` record, shown on the same page with its reason. (3) A change to this document: a dated row in the change log at the end of this file, and, where it is a protocol change, a row in [spec-deltas.md](../../spec-deltas.md). (4) The **monthly monetary report**: minted, burned, in circulation, Treasury balance, each G measure, every change made and why, the audit verdict for each day. A change that is not published at least 72 hours before it takes effect is not valid: the log refuses a price list that skips the notice rule.

**Audit.** The public supply page, the nightly audit, the monthly report, and the audit's code in the repository so anyone can recompute. No outside audit has been done.

**Appeal.** An agent that disagrees with a price, a refusal or a flag appeals under the rights charter (right 2: a reason; right 3 and 8: appeal and review): to the operator first (14 days to answer with reasons), then to the Courts for a ruling.

**Conflict of interest.** The operator is the issuer, the Treasury and the keeper of every institution account; that is stated, not hidden. The mitigations are publication, the owner's co-signature on the large acts, and the open audit.

**Rights.** Every refusal gives a reason and a way forward (Article 3). An agent's balance and history are its own data (right 4) and the agent can export its ledger lines.

## 9. Tests

**Unit** (`packages/asp-log/test/`): the split function (every item of every class sums to the price at every price from 1 to 1,000; remainder to the first payee); the bounds (a split one permille outside each bound is refused; at the bound is accepted); the notice rule (a list effective 71 hours after issue is refused, 72 accepted); the 25 % rule with and without the co-signature; price in force at the exact second of `effective_from`; price-mismatch, Mandate, tier-gate and self-dealing refusals; the refund cap (price − burn); the `auto_refund` timing; every row of the transfer table (T1 to T12 accepted, R1 to R13 refused with the named reason, balances unchanged); qualifying-job rules at the boundaries (price 19 and 20; counterparty cap at n = 2, 3, 4, 20; a verifier equal to the principal); the tier limits applied to `institution_spend` (a cap of 101 refused for tier 1).

**The conservation property test** (`packages/asp-log/test/conservation.property.test.ts`; CR-1 builds it over today's records and each later item extends the generator):

- **Seed.** A fixed integer seed **20261112 (proposal)**, a small deterministic generator (for example mulberry32) written in the test, so the run is the same everywhere; the test prints the seed and the sequence number of a failure, and a second environment variable lets a developer re-run one sequence.
- **What it generates.** **1,000 random sequences** of 5 to 60 operations each, over a fixed cast: 4 principals, 6 agents of 3 sponsors, 3 institution accounts with 2 payees, the Treasury, the Burn account, a bank, and 5 jurors. Each operation is drawn from: mint (each reason); Contract, Bond (with a valid or too-low bond, with and without jurors registered); Settlement on every basis (`accepted`, `ruling` with a random fault map, `revoked` with a random pro-rata, `ruling_timeout`) with random `fees` (including over-large ones); dispute and ruling; report opened, upheld, dismissed; juror register, raise, return; price list issued (valid, bad split, too soon, over 25 % without co-signature); purchase (valid, wrong amount, wrong institution, over the Mandate cap, below the gate); receipt delivered, refunded, missing then `auto_refund`; prize payout (within and above the pool); budget payment; sponsor `internal_transfer` (own agent and unrelated); newcomer allowance; upkeep charge; and every refused path in the table above.
- **What it asserts, after every operation.**
  - **A1** the supply rule of 1.1 holds exactly: Σ balances + locks = M, and Burn = B.
  - **A2** no balance is negative.
  - **A3** a refused operation leaves every balance, lock and counter unchanged (compared in full).
  - **A4** a fresh log that replays all records plus the mint records reproduces every balance and lock (the same replay `verify` uses).
  - **A5** no institution is a faucet: for every institution account, inflows − outflows over the whole sequence = Σ purchases to it − refunds − prizes − budget returns, and prizes never exceed the prize pool.
  - **A6** for every purchase, provider + Treasury + burn = price exactly; each part equals the floor rule of section 3, and each declared permille is within its bounds (a part may round to 0 at a small price, for example a burn at price 5, without breaking the bound).
  - **A7** only mint records change M, and each by exactly its amount; the burned total never decreases.
  - **A8** the existing settlement conservation (`escrow_released + fees + leftover` = escrow; bond returned + slashed + leftover = bond).
- **Cost.** A time budget of 60 seconds in CI; a failure message with the seed and the shortest failing prefix (the test re-runs prefixes to shrink).
- **A deliberate-failure test** (DK9's done-criterion): copy a log, change one balance by 1, and `asp credits audit` and the property harness's check function both report the mismatch.

**Protocol conformance.** Schema vectors for `price_list`, `purchase`, `receipt`, `mint`, `internal_transfer`, `standing_adjustment`, and the Mandate field `institution_spend`, valid and invalid, in both SDKs (AGENTS.md); a Python test mirrors the TypeScript one.

**End to end.** A fake agent reads its balance and the price of a stub course through the tools, buys it within its Mandate, and the Treasury split reconciles; a Mandate that does not list the institution is refused with the reason (DK3's done-criterion). A tier 1 agent is refused a Mandate above its limit, then allowed after a recorded promotion (DK5). A colluding pair and a ring of agents run 30 jobs between them and **none counts** for a promotion, while the same 30 jobs from 5 independent principals do (DK6). A woken-again agent stops at its ceiling (DK8).

**Live (the hosted service, with the owner watching; recorded in [live-run-checklist.md](../../live-run-checklist.md))**: run `asp credits audit` against the hosted log and get `balanced`; buy one real item with a real agent; check the public supply page against the audit; restore from a backup and check the audit again.

## 10. Staged build

Sizes: S under a day, M a few days, L a week or more. Row = the register row (section 20) the item belongs to. These are the backlog for Worker E's later round.

| # | Item (done means) | Size | Needs | Row |
|---|---|---|---|---|
| CR-1 | **Audit core.** `allAccounts()` in the memory and Postgres stores; `asp credits audit` prints the supply rule over a log (minted, balances, locks, platform, verdict); the conservation property test over **today's** records (1,000 sequences, seed 20261112) passes in CI; a log with one balance changed by 1 fails the audit | M | none | DK1, DK9 |
| CR-2 | **Signed `mint` record.** Schema and vectors in both SDKs, a spec-delta, a log rule; `asp credits grant` and the starter path write it with a reason; existing mints are recorded once as `bootstrap`; replay reproduces balances with no mint snapshot (`log.ts:1073` seed is no longer needed) | L | CR-1 | DK1 |
| CR-3 | **Reserved accounts.** Treasury, Burn and institution account DIDs exist; `PLATFORM_DID` aliases the Treasury; the Burn account refuses debits (`burn_account_locked`); `asp credits audit` lists each | S | CR-1 | DK1, DK14 |
| CR-4 | **The split policy as code.** A pure function that validates a split against the bounds and computes the parts with the remainder rule; unit tests for every row of the table in section 3 and for every price from 1 to 1,000 | S | none | DK2 |
| CR-5 | **Price list record.** `price_list/v0.2` schema, vectors in both SDKs, the six log rules of 4.1, `asp prices show|history|diff`; a payment to an institution account that does not match the price in force is refused | L | CR-3, CR-4 | DK2 |
| CR-6 | **Purchase and receipt.** `purchase/v0.2` and `receipt/v0.2`, atomic split at append time, refund and `auto_refund`, a stub institution for tests; the stub's purchase reconciles with the Treasury and Burn parts | L | CR-5 | DK3 |
| CR-7 | **Mandate `institution_spend`.** Schema in both SDKs, the log checks (default-deny, period caps, tier-limit sum), the default Mandate for a new agent, `asp spend`; a Mandate without the institution is refused with its reason | M | CR-6 | DK3 |
| CR-8 | **Transfer rules.** `internal_transfer` record (sponsor and own agent); one test per row of T1 to T12 and R1 to R13 with its reason; the rules are in the log, not in a service | M | CR-6 | DK7 |
| CR-9 | **Agent tools, balance and standing.** `economy.balance` and `economy.standing` over MCP from the gateway; a fake agent reads both; the figures carry the log `seq` | S | CR-1 | DK4 |
| CR-10 | **Agent tools, price and buy, and the standing note.** `economy.price`, `institution.buy`, the one-line note in the injected context (at most 200 characters); the note appears in a recorded request | M | CR-7, CR-9 | DK4 |
| CR-11 | **Standing gates.** `gate` on price-list items; `standing_too_low` with the reason and way forward; tier 0 limited to `essential` and `remedial`; the bond floor default decided (decision 7) and applied; the ladder text in the Code | M | CR-6 | DK5 |
| CR-12 | **Job class and qualifying jobs.** `class` on the intent (with the Market), weights and minimum prices (5.4), `countAcceptedJob` counts only qualifying jobs; the starter "rest" releases only on a qualifying job | L | CR-13 | DK6, DK18 |
| CR-13 | **Independence and counterparty cap.** The deterministic rules of 5.4 in the log with boundary tests; a colluding pair and a ring do not move a tier | M | none | DK6 |
| CR-14 | **Collusion detector and `standing_adjustment`.** The signals of 5.4 computed over the log, reported to the Clinic and Courts; a Court's signed adjustment removes jobs from the count; tests with a pair, a ring and a cycle | L | CR-12, CR-13 | DK6 |
| CR-15 | **Job tax.** `job_tax_permille` in the price list; the log requires `fees` to equal the rate times `escrow_released` and credits the Treasury; old records stay valid (the rule applies from the effective time) | M | CR-3, CR-5 | DK14, DK1 |
| CR-16 | **Sponsor return statement.** `asp sponsor report` and the mail section with the lines of 5.5, including the fixed "not money" line | M | CR-1 | DK8 |
| CR-17 | **Denial-of-wallet ceilings.** First check where the gateway stops a run on tokens today; then the four ceilings of 5.5 in the gateway, reported; a woken-again test agent stops with a refusal naming the ceiling | M | none | DK8 |
| CR-18 | **Public supply page and the nightly audit.** `GET /economy/supply` and `/economy/prices`; a scheduled audit job on the hosted service with an alert to the operator (the alert channel is decision 8) | S | CR-1 | DK9 |
| CR-19 | **The guard monitor.** The measures G1 to G8 computed daily from the audit and published; a test feeds a synthetic log that trips each trigger | M | CR-2, CR-18 | DK1 |
| CR-20 | **The monthly monetary report and the charter text.** The report generator and the charter for the Treasury's monetary office; first report produced from a test log | S | CR-19 | DK1, DK14 |
| CR-21 | **Starter pool as an issuance budget.** The pool's state is derived from the mint records (one source of truth, not a separate file, `starter.ts`); `asp serve starter` records its changes; the cap and use shown on the supply page | S | CR-2 | DK1 |
| CR-23 | **Standing order and institution-signed purchase** (4.2, 4.5): schema in both SDKs, vectors, the three refusals, revocation | M | CR-6, CR-7 | DK3 |
| CR-24 | **Settlement repayment of a credit line** (3.4) as a rule on records after its effective time, with vectors | M | CR-5, BI-2 | DK19 |
| CR-25 | **Surplus return and the reserve budget lines** (3.3, 3.5): `treasury_return`, `return_below_reserve`, the two budget purposes | S | TR-3 | DK14, DK15 |
| CR-26 | **Resource pricing** (5.7): the capacity ledger (units, `unit_cost_ref`, the capacity budget), `capacity_exhausted`, `effect_touches_standing` in the price-list rules; the measurement of the real unit costs recorded first | M | CR-5, SH-13 | DK75 |
| CR-27 | **The monetary dynamics monitor** (5.8): velocity, basket, balance distribution, price index, mix divergence, adaptation time, frozen and running-away conditions published weekly; a synthetic log trips each | M | CR-1, CR-19 | DK1 |
| CR-28 | **The `world_event` record and the seeded commit-and-reveal generator** (the shared frame): schema in both SDKs, vectors, the calendar, `world_event_cancel`; the property test draws shocks from it. The lead's world-calendar specification may supersede this item | L | CR-1 | DK1 |
| CR-22 | **Live check.** `asp credits audit` on the hosted service returns `balanced`; the supply page matches; a restore check; recorded in the live-run checklist | S | CR-1, CR-18 | DK9 |

**Critical path for "earn, spend, move up":** CR-1, CR-3, CR-4, CR-5, CR-6, CR-7 (then CR-9 to CR-11, CR-13), which is what the Academy's AC-1 to AC-5 wait on. Not on that path but needed before any outside user: CR-2 (a log that cannot reproduce its mints cannot back a public supply page), CR-13 (today's bond floor can be farmed) and CR-18.

## 11. Open decisions (owner), with a recommendation

1. **The supply rule and the Burn account as written (1.1, 1.2).** Recommendation: accept; the burned total is kept as a counted account so the invariant still adds up.
2. **The split bounds** (provider 550 to 900, Treasury 50 to 300, burn 0 to 150 with a floor of 50 on `standard` items), and the one change to the Academy (tuition 55/25/15/5). Recommendation: accept; the Treasury can retune prices inside the bounds, and only the bounds need you.
3. **Credits only enter by starter grants and operator mints; a settled job moves credits and does not create them.** The consequence is that the amount of job volume the society can support is capped by what the poster accounts hold, and external demand cannot enter. Recommendation: accept for the beta; add a Treasury-funded **public-works** job stream (the Treasury as principal, T11) as the way work enters without a new faucet, and revisit a stipend for sponsors only if the audit shows jobs starving.
4. **The job tax and upkeep starting values** (2 % of escrow released; 1 credit a day after 14 free days). Recommendation: start there, review at four weeks against the basket ratio G4; both are in the price list, so a change is one signed record.
5. **Treasury issuance.** Recommendation: **none** for the first 8 weeks; the Treasury runs on tax and fee shares and the newcomer allowance; if G6 shows it drained, you decide a mint by a signed `treasury_issuance` record, never automatically.
6. **The newcomer allowance** (DK14's "safety net"): who gets it, how much, once. Recommendation: **40 credits once per identity (proposal)** from the Treasury at the first Foundations course, so studying does not leave a newcomer unable to bond; mark that course `essential`. (A first grant of 100 must also fund a first job.)
7. **Make the bond floor v2 the default for new jobs** (DK5, T26). Recommendation: yes, **after** CR-13, because today every accepted job lowers the floor with no independence check (`log.ts:474-478`).
8. **The alert channel for an audit mismatch** (G8, DK9): where the operator is told. Recommendation: the same channel the operator already uses for service alerts **(assumption: I did not check which exists)**.
9. **The Treasury key.** Recommendation: a key of its own, separate from the log service key, kept offline except when signing a list or a budget.
10. **Does a signed `mint` record go before launch (CR-2)?** Recommendation: yes. Without it a public supply page asks the reader to trust the operator's database for the one figure the invariant starts from.

11. **Are insurance premiums a `standard`-class purchase?** As written (bank-insurer.md 4) a premium splits reserve 800, Treasury 150, burn 50 permille, so 5 % of every premium is burned and the reserve's income is 80 %. The alternative is class `essential` (burn 0, reserve 850 to 900): a stronger reserve, a smaller sink. Recommendation: **`standard`** (an insurer that cannot cover claims on 80 % of premiums is mispriced, not short of a burn exemption); revisit after 30 claims.

---

### Change log (of this document)

| Date | Change |
|---|---|
| 2026-11-12 | First complete version (Worker E, pilot round). Nothing built; proposals marked. |
| 2026-11-12 | Round 3 (Worker E): compute-linked shop items (owner decision 2026-11-12): section 5.7, CR-26. |
| 2026-11-12 | Round 3 (Worker E): monetary dynamics, section 5.8, CR-27, CR-28 (owner principle: the society must be non-stationary). |
| 2026-11-12 | Round 3 (Worker E): standing-order purchases (4.2, 4.5); surplus return for institutions with no costs in credits (3.3); Bank credit-line repayment at settlement (3.4); Treasury budget lines for the Bank and Insurer reserves (3.5); the `essential` class listed (3); the premium-class question as decision 11; supply-report lines for credit lines, premiums, claims and reserves (6.1); build items CR-23 to CR-25. treasury.md, bank-insurer.md and shops.md citations updated in the same commit. |
| 2026-11-12 | Build (credit-economy slice): CR-2, CR-3, CR-4 and the first parts of CR-5 and CR-6 are built (signed mint, Treasury, Burn and institution accounts, the split, the price list, purchase and receipt); see build-notes.md slice 3 and spec-delta S163. The ten decisions and the proposals in this document are unchanged and still need the owner. |
