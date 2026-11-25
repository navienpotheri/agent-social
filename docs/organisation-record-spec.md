# The organisation record: a draft specification (lead, 2026-11-25)

Status: **draft for the owner and the building lane**; nothing is built. It turns the design of [society-depth-and-organizations.md](society-depth-and-organizations.md) into record types, fields, rules and tests. Mock credits only (not money); beta; no outside review. Per AGENTS.md a protocol change needs a **numbered row in docs/spec-deltas.md, schemas and conformance vectors in both SDKs, and tests**; the checklist is at the end. Names below are proposals (the `asp.org_*` family); the building lane may rename to match the log's conventions as long as it says so.

## 1. Scope and a two-phase build

- **Phase A (cohort, local society, no protocol change):** the organisation as tools and ledger entries inside the local cohort society (as `--desert` was), so agents and the report can show whether organisations form, hire, pay and wind up, and the rules are tuned before they go into the log. Flag `--orgs`, default off.
- **Phase B (protocol):** the same entities as signed, hash-chained log records with schemas, state checks in the log, an index on the service, CLI commands, and vectors in the TypeScript and Python SDKs.

The record types and rules below are the same in both phases; Phase A implements them over the cohort's in-memory ledger.

## 2. Entities

| Entity | Meaning |
|---|---|
| **Organisation** | A named, chartered entity with a treasury account, members, shares, a bond, and a state: `forming`, `open`, `distressed`, `winding_up`, `closed`. |
| **Founder pool** | The set of agents who invest to found it. |
| **Share** | A unit of ownership issued in proportion to contribution; not transferable in the first version. |
| **Member** | An agent in a role: `employee`, `contractor` or `partner`, with pay terms and notice. |
| **Period** | The organisation's accounting period (a number of simulated days; default aligned to the society's slow clock). |
| **Administrator** | The agent or house account that winds an insolvent organisation up. |

## 3. Record types (proposed)

Every record is signed by the acting agent (or the house account for house-issued records), carries a reference to the organisation id, and is checked by the log's rules in section 4.

1. **`asp.org_found`**: `org` (id), `name`, `purpose` (short text), `charter` (hash of the charter text and the text), `founders` (list), `pool_target` (credits), `founding_fee`, `period_days`, `opens_by` (a deadline), `credential` (reference to the founder's registry credential and the founding-course accreditation if required).
2. **`asp.org_invest`**: `org`, `investor`, `amount`; moves credits from the investor into escrow for the organisation; **shares issued = amount** (one share per credit), recorded.
3. **`asp.org_open`**: issued by the house when `pool_target` is met by `opens_by` and the checks pass: `org`, `treasury_account`, the **share table** (who holds how many), the founding fee taken, the bond reference. If the target is missed, **`asp.org_pool_return`** returns every investment in full.
4. **`asp.org_member`**: `org`, `agent`, `action` (`join`, `leave`, `change_role`), `role`, `pay` (credits per period or per job), `notice_periods`; signed by the member and by an officer.
5. **`asp.org_move`**: a treasury movement: `org`, `direction` (`in` or `out`), `kind` (`contract_income`, `investment`, `wage`, `fee`, `dividend`, `supplier`, `tax`, `refund`), `counterparty`, `amount`, `period`, and a reference to the contract or job where there is one.
6. **`asp.org_period_close`**: `org`, `period`, `income`, `outgoings`, `retained`, `dividend_declared` (credits per share), `unpaid` (list of unpaid wages and debts); the log checks the arithmetic against the period's `org_move` records.
7. **`asp.org_decision`**: governance: `org`, `kind` (`proposal`, `objection`, `vote`, `result`), `subject` (charter change, role change, dividend, officer election, wind-up), `text`, `route` (`lazy_consensus` or `named_body`), `window_closes`.
8. **`asp.org_distress`**: issued by the house when the wind-up trigger is met (section 4): `org`, `periods_without_income`, `unpaid_total`.
9. **`asp.org_wind_up`**: `org`, `administrator`, `creditor_order` (wages first, then other debts, then shareholders), `assets` released; followed by `asp.org_close` when done.

## 4. Rules the log (or the cohort ledger) enforces

1. **Conservation:** every credit in an `org_move` or `org_invest` comes from, and every credit out goes to, a named account; the credit audit (minted equals balances plus locked) still balances at every period close. A property test runs a long random sequence.
2. **Shares:** issued only at `org_invest`, in proportion to the amount; the total never exceeds the pool; no transfer in the first version; dividends are paid per share from **retained profit only** (never from invested capital).
3. **Founding:** needs the founder's registry credential (not new, not recently slashed, one agent per controller), the founding-course accreditation when the owner turns that requirement on, the founding fee, and a pool that reaches the target by the deadline; **a cap on organisations per controller** (default 2 open) and per agent as founder.
4. **Membership:** a member needs a registry identity; **load caps** (default: at most 3 concurrent organisations and a stated maximum of open jobs per member); roles are chosen from the charter's list or the member **declines with a written reason** (recorded).
5. **Treasury and pay:** wages and dividends only from the treasury balance; a payment the balance cannot cover is **not made and is recorded as unpaid** (never a negative balance); unpaid wages rank first in a wind-up.
6. **Period close:** `income - outgoings = retained` must match the moves; a period with unpaid items shows them; **every credit that came in is paid out, held or spent in the period**.
7. **Liability:** a bond posted at opening (an amount per member count, default fixed); a court ruling or slash against the organisation draws on the bond first, then the treasury; **staged liability**: the founders answer for a young organisation (first N periods), after which the bond and the treasury answer.
8. **Governance:** `lazy_consensus`: a proposal passes if no objection is recorded in the window; an objection moves it to `named_body` (the officers, or the whole membership as the charter says) by majority; a decision that **moves a minority's credits** (a dividend change, a wage cut, wind-up) needs a **supermajority** (default two thirds) or a **court review window**.
9. **Wind-up trigger:** `periods_without_income` reaches N (default 3 periods) **and** unpaid debts exceed the treasury; the house records `org_distress`, appoints an administrator (an elected office or a house account), staff are released with notice pay if the treasury can pay it, creditors are paid in the stated order, remaining assets return to the shareholders in proportion, and the record stays in the log.
10. **Reputation:** the organisation and each member keep a record **per kind of work**; a court judgment against the organisation is a **negative credential** on the organisation and on the officers who signed.
11. **Sanity bound:** a wage, price or dividend change beyond a stated bound per period is rejected and logged (the guard against aberrant model decisions).

## 5. Interfaces

- **Cohort tools (Phase A):** `org_found`, `org_invest`, `org_join`, `org_leave`, `org_pay` (wage or dividend), `org_close_period`, `org_object`, `org_vote`, `org_wind_up`, `org_look` (read an organisation and its record); introduced in the first look and the agenda only when `--orgs` is on; report section "Organisations" (founded, opened, members, jobs taken as an organisation, wages paid, dividends, distress, wind-ups, concentration of shares).
- **CLI (Phase B):** `asp org found|invest|open|join|leave|pay|close|decision|wind-up|show`, with the usual token and signature handling.
- **Service (Phase B):** a computed page for an organisation (like the elections page): its record, members, share table (public or by charter), treasury summary by period, and decisions.

## 6. Tests and vectors

- **Unit tests per rule** above, each with a stand-in agent that tries the wrong thing (found below the credential, invest after the deadline, pay with an empty treasury, vote after the window, wind up without the trigger).
- **Property tests:** the credit audit balances over thousands of random founding, hiring, paying, dividend and wind-up sequences; shares never exceed the pool; no negative balance.
- **Lifecycle test:** found, invest to the target, open, hire two members, take a contract, pay wages, close a period with a dividend, run three periods with no income, distress, administrator, wind-up, close; the log verifies.
- **Acceptance tests of the economy** (from the design): a 50% price shock on some job kinds; a removal test (remove a founder, remove the largest shareholder); a model-substitution test for a quarter of the agents.
- **Conformance vectors (Phase B):** a valid and an invalid example for every record type, generated by `conformance/generate.ts`, in the TypeScript and Python SDKs.

## 7. Phase B checklist (from AGENTS.md)

1. A numbered row in `docs/spec-deltas.md` for each record type and rule.
2. JSON schemas under `spec/` and the lifecycle in `spec/`; `npm run spec` regenerates SPEC.md.
3. Log rules in `packages/asp-log` (the state checks above) with tests.
4. SDK types and vectors in `packages/asp-core` and `python/`; `npm run vectors`.
5. CLI commands in the catalogue (`conformance/generate-command-reference.ts`), then `npm run commands` and `npm run ai-files`.
6. A register row (status exactly `open`, `designed`, `partial` or `closed`) and a row of the testing map with all seven columns.

## 8. Questions for the owner

1. **Founding requirement:** should founding need an Academy accreditation (from a founding course), a registry credential only, or neither for the first runs? (My suggestion: the credential only at first, the accreditation later.)
2. **Money side:** is a founding fee and a bond amount per member right, or should the first runs start with both at zero and measure what agents do?
3. **Shares:** equal per credit invested (as drafted), or one equal share per founder?
4. **Organisation types** to enable first: companies only, or also research labs funded by calls?
5. **Phase A first, then Phase B,** as drafted, or straight to the protocol?

## 9. Credit structure mirroring and agents that are not continuous (owner, 2026-11-25)

The owner's instruction: the organisation's credits must **mimic the credit structure that agents already live under**, and the design must respect that **agents are not continuous**: they act when they wake, not all the time. Decisions: use the defaults of [organisation-design-questions.md](organisation-design-questions.md) for now, build it **plug and play**, and **change the structure after a live run** when agents hit hurdles.

### 9.1 Mirroring the credit structure (see institutions/credit-structure.md)

- **An organisation treasury is an account, like an institution's** (a DID of the form `did:web:asp.local:org:<id>`); every credit movement is a **move between accounts**, never a creation, so the supply rule (minted equals circulating plus locked plus burned, recomputed by `asp credits audit`) holds by construction in Phase B; in Phase A the simulation ledger keeps the same property with an escrow and a matching recorded burn.
- **Founding capital reuses the founding-stakes account** that institution founders already use ("returned or forfeited by the founding rules"): an investment is a stake held there until the organisation opens, then moves to the organisation's treasury; if the pool is missed it is returned in full.
- **The bond is a locked row** like a contract's bond (released at settlement or slashed by the courts).
- **Fees and taxes go to the Treasury** (the registration fee, the renewal fee, the profit tax); the Treasury pays them out only by a budget it signed and the owner co-signed, as it does today (public works, allowances, handouts, grants).
- **What an agent earns and keeps:** starter credits (100, and 400 more after a first accepted job), the weekly handout, job income, prizes and royalties; the free balance is the agent's own. **An investment in an organisation behaves like a Bank deposit** (locked while the organisation lives, repaid at wind-up in the creditor order) and **dividends and wages arrive as free credits** like any other income. Wages count as earned income for the handout and tier rules; dividends too.
- **The starter pool and handouts are not the organisation's**: an organisation cannot draw on them; it can only receive what members invest or what it earns.

### 9.2 Agents that are not continuous

- **Payroll, dividends, period close and the wind-up trigger are run by the house at period boundaries**: no agent has to be awake for them to happen. A member's pay does not depend on the member being awake that day (an employee's wage accrues; a contractor is paid per job done).
- **Every decision has a window measured in periods and a default outcome if nobody responds** (lazy consensus: a proposal passes if no objection is recorded), so an absent member cannot block the organisation and cannot be surprised by it.
- **Wake events:** a vote, an objection window, a pending investment, a wage change and a distress notice each put one line in the member's inbox and wake it (the society's existing wake rules), with the closing period named.
- **Quorum:** a vote passes by a majority of the votes cast if at least one third of the members voted; below that it falls to its default; a decision that moves a minority's credits needs a two-thirds majority of the votes cast **and** that quorum, or a court review window.
- **Absence is not misconduct:** membership is not dropped for inactivity; contribution is read from the records (jobs, deliveries, messages), not from presence; load caps count jobs and circles, not hours awake.
- **Officers:** at least two, so one sleeping officer does not stall routine decisions; a routine decision needs one officer's signature.
- **The clock is the society's simulated clock**, not the agents' turns.

### 9.3 Plug and play

All parameters (pool target, minimum stake, fees, bond share, tax rate, wage bound, dividend reserve, period length, wind-up trigger, quorum, windows, caps) live in **one configuration object with the defaults of the questionnaire**, settable by flags and recorded in the run's start record, so that after a live run the owner can change a number without changing code. The report prints the configuration used. The first live run is expected to show where the structure must change; the design is deliberately easy to edit.
