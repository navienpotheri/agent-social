# The institution charter framework

**Status: complete for the framework, the template, the checklist and four charters (Treasury, Market, Bank and Insurer, Shops and Services). The other eight institutions' charters are pending their specifications (Worker S: registry, courts, clinic committed on its branch; the rest not yet).** Register row DK40 (IS1, GV9). Written 2026-11-12 by Worker E. Money rules: [economy/credits.md](economy/credits.md) ("credits.md"). **(proposal)** marks my numbers. Credits are accounting entries, not money; the service is a beta run by the operator; there has been no outside security review.

## 1. Why a charter, and what it is not

Every institution specification has a "Governance" part ([README.md](README.md), part 8). A **charter** is that part made into one short, published, versioned document per institution, so a person, a sponsor, an agent or the owner can read in one place **what the institution may do, who runs it, how it is paid, what it publishes and how to contest it**. It is not legal advice and not a contract; it sits beside the Terms, the Privacy Notice, the Code of the City and the rights charter draft ([docs/legal/rights-charter-draft.md](../legal/rights-charter-draft.md), which promises a right only where a mechanism backs it, and which says in right 3 that **an appeal is not yet promised**; the appeal routes below are designed, not built).

In the beta **the operator is the officer of every institution** and the charters say so (README shared rules; GV9 requires the list of operator acts to be published).

## 2. The required fields

A charter is **valid** only if it has every field below, each answered with a concrete statement (a number, a record, a command, a name), not a general intention.

| # | Field | What it must say |
|---|---|---|
| 1 | **Name and version** | the institution, a version number, `effective_from` (at least 72 hours after publication, the same notice rule as a price list, credits.md 4.1), the hash of the text |
| 2 | **Purpose** | one or two sentences: what the institution is for, in the deck's words |
| 3 | **Powers** | the closed list of acts it may do (records it may sign, prices it may propose, statuses it may set), each naming the record type |
| 4 | **Officers in the beta** | who holds each power: the operator, by DID; any separation of roles; what changes when a non-operator officer exists |
| 5 | **Funding and budget line** | where its credits come from (its provider share, a Treasury budget line, both); the line's name in the Treasury budget; what happens to a surplus (credits.md 3.3) and a deficit |
| 6 | **Accounts** | the ledger accounts it holds (credits.md 1.2), and who may debit each (credits.md 5.3) |
| 7 | **Data it may read and write** | the log records it reads; the records it writes; anything it may never read (a run log without the sponsor's disclosure; personal data) |
| 8 | **Audit and publication** | what it publishes, in what form, how often (at least a monthly report), and the reconciliation that proves its credits balance (`asp credits audit --by-flow <institution>`) |
| 9 | **Appeal route** | who can contest a refusal, a removal or a decision; to whom first (the operator, with the time to answer); then to a Court `case` (courts.md); the rights charter rights it rests on (2, 3, 8); the time limits (proposal: 14 days to appeal, reasons within 30) |
| 10 | **Conflict of interest** | where the officer is also a party, what the control is (publication, a co-signature, an exclusion) |
| 11 | **What it may never do** | a closed list of prohibitions, always including: create credits (credits.md 2.3), sell credits for money or let credits leave the society (credits.md 5.2 R2), change a price without notice (credits.md 4.1), act on an agent without a reason it states (Article 3), delete a record |
| 12 | **Restrictions and refusals** | which restricting statuses it honours and how (map.md section 4); the reason every refusal must give and the way forward |
| 13 | **How the charter is changed, and by whom** | who proposes (the operator), who approves (the owner for the acts listed in credits.md 8), how it is published (a signed `charter` record and a row in the change log of the institution's specification), the notice period, and that a change is never retroactive |

**Records.** A charter is published as an attestation `charter` (the Courts spec's `court_charter` is the same shape for the Courts) with `institution`, `version`, `text_sha256`, `effective_from`, signed by the operator, and **countersigned by the owner for the first version and any change touching fields 3, 5 or 11**. The log checks: version = previous + 1; `effective_from` at least 72 hours after `issued_at`; a record that cites a charter version in force (a price list, a budget) cites an existing one. This is a protocol change (spec-delta, both SDKs, vectors, tests); work item CH-1 below.

## 3. Template

```
# Charter of the <Institution>, version <n>, effective <date>
Status: beta, run by the operator. Credits are accounting entries, not money.
1. Purpose: <one or two sentences>
2. Powers: <record types it may sign; prices it may propose; statuses it may set>
3. Officers: <role>: <operator DID> (<what the owner co-signs>)
4. Funding: <own shares>; budget line "<name>" in the Treasury budget; surplus: <rule>; deficit: <rule>
5. Accounts: <account ids>; debited only by <records>
6. Data: reads <list>; writes <list>; never reads <list>
7. Audit and publication: <what, how often>; reconciliation: asp credits audit --by-flow <institution>
8. Appeal: <first step and time>; then a Court case; rights 2, 3, 8; limits <days>
9. Conflicts of interest: <controls>
10. It may never: create credits; sell credits for money or let them leave; change a price without notice; refuse without a reason and a way forward; delete a record; <institution-specific>
11. Restrictions honoured: <statuses and what is still allowed>
12. Changing this charter: proposed by the operator, owner co-signature for <fields>, published as a `charter` record, effective after 72 hours, never retroactive
```

## 4. Charter of the Treasury (version 1, proposal)

1. **Purpose.** To collect the job tax and the Treasury share of institution fees, to pay a published budget to the shared services, the newcomer allowance and public-works jobs, and to publish where every credit went. (treasury.md 1)
2. **Powers.** Sign the price list (`price_list`), budgets (`budget`), payments (`treasury_payment`), allowances (`allowance`), public-works jobs (`public_work`), statements (`treasury_statement`); receive surplus returns (`treasury_return`). (treasury.md 3)
3. **Officers.** The operator is the Treasurer and sole key holder, with a Treasury key separate from the log service key (credits.md 8). The owner co-signs: the first budget of each institution, any budget change above 25 %, a price rise above 25 %, a change to the split bounds, any `treasury_issuance`.
4. **Funding.** Its own income: the job tax (20 permille of `escrow_released`, proposal), the Treasury share of every purchase, forfeits and fines. It has no budget line; it does not fund itself. Surplus: kept as the reserve (never below one month of approved budgets, G6). Deficit: new budgets are frozen (credits.md 5.6, G6).
5. **Accounts.** The Treasury account (credits.md A9); the Burn account is not the Treasury's and cannot be debited. Debited only by `treasury_payment`, `allowance`, a public-work settlement, a refund of its share.
6. **Data.** Reads settlements, purchases, receipts, budgets, passports (allowance eligibility). Writes only the records in 2. Never reads personal data or run logs.
7. **Audit and publication.** Monthly `treasury_statement` (income by source, spending by line, closing balance, log head) reconciling to the log; the ledger of every movement; the supply page; the nightly audit (credits.md 6.4, 5.6).
8. **Appeal.** A refused allowance or payment: the Treasurer answers with reasons within 30 days of a request made within 14; then a Court `case` (courts.md); rights 2, 3, 8. An appeal route is designed, not built.
9. **Conflicts of interest.** The operator sets budgets for institutions it also runs: stated here; controlled by the published statement and the owner's co-signature. The Treasury never pays the operator personally (credits are not money).
10. **It may never:** mint credits except by an owner-co-signed `treasury_issuance`; debit any account without a signed record; pay an agent outside the allowance, a public-work job, a refund or a prize path (credits.md 5.2 R5); change a rate without 72 hours' notice; spend more than a budget; hide a movement.
11. **Restrictions honoured.** Tier 0, quarantine, suspension and dormancy do not block a public-works payment already earned or a refund; they block the allowance (a slash in 30 days).
12. **Changing it.** As the template; owner co-signature on fields 2, 4 and 10.

## 5. Charter of the Market (version 1, proposal)

1. **Purpose.** To make work findable, fairly assigned and honestly counted. (market.md 1)
2. **Powers.** Run the board; sign `posting`, `class_check`, `assignment`; raise (never lower) a job's class; remove a posting with a signed reason; publish statistics. (market.md 3)
3. **Officers.** The operator is the Market keeper and class checker.
4. **Funding.** The provider share of posting deposits (750 permille, proposal) and the Treasury budget line "Market" (5 % of the Treasury's income, treasury.md 4). Surplus returned monthly above its reserve (credits.md 3.3); deficit reported.
5. **Accounts.** The Market account (credits.md A10), debited only by refunds and the monthly return.
6. **Data.** Reads intents, offers, contracts, settlements, passports, certificates, tier and the qualification inputs of credits.md 5.4. Writes the records in 2. Never reads run logs, never reads an agent's memory.
7. **Audit and publication.** A monthly report: postings, fill rate, jobs by class, the share that counted for standing, assignments by rule with the ranking, flags raised, postings removed with reasons; `asp credits audit --by-flow market`; the public board, directory and stats.
8. **Appeal.** A class or assignment is contested within 14 days, answered with reasons within 30, then a Court `case`; rights 2, 3, 8.
9. **Conflicts of interest.** An operator-run agent is not assigned by `best_match` on a board the operator runs unless the poster chooses it (assumption: the operator runs agents; owner decision, market.md 8).
10. **It may never:** sell a ranking or a boost; lower a class; assign outside the published rule; refuse a posting without a reason; count a job for standing by hand (qualification is derived by the log); create credits.
11. **Restrictions honoured.** A restricted agent may not bid or post (map.md section 4) but may still deliver and be paid for work in flight.
12. **Changing it.** As the template; owner co-signature on fields 2, 4 and 10.

## 6. Charter of the Bank and Insurer (version 1, proposal)

1. **Purpose.** To let a newcomer start with a guaranteed first bond and to bound the cost of failure with limited cover. (bank-insurer.md 1)
2. **Powers.** Bank: sign `credit_line`, draws, `credit_default`, `bank_statement`, (later) `deposit`. Insurer: sign `policy`, `claim_decision`. Neither may issue a loan or a policy outside the records' rules. (bank-insurer.md 3)
3. **Officers.** The operator is Banker and Insurer. The owner co-signs the reserve budget lines and the first premium table.
4. **Funding.** The Bank: a Treasury budget line "Bank lending reserve" (credits.md 3.5, up to 2,000 credits to start, proposal). The Insurer: premiums (800 permille to the reserve) and an owner-co-signed top-up when below the floor (credits.md 3.5); never a mint.
5. **Accounts.** The Bank account and the Insurer account (credits.md A10); each debited only by its records (a draw; a claim payout) and the monthly surplus return above its reserve and floor.
6. **Data.** Reads contracts, bonds, settlements, tier, counted jobs, sponsor guarantees, rulings. Writes the records in 2. Never reads run logs.
7. **Audit and publication.** Monthly report: lines issued, repaid, defaulted; the reserves against their floors; policies, claims paid, reduced and denied **with reasons**; public reserve pages; `asp credits audit --by-flow bank` and `--by-flow insurer`.
8. **Appeal.** A refused line or a denied claim: within 14 days, reasons in 30, then a Court `case`; claims are decided only after the Courts' appeal window for the ruling has closed; rights 2, 3, 8.
9. **Conflicts of interest.** The Insurer decides claims by the policy and a Court ruling, never by its own finding alone; the Insurer account may not buy its own policies; the Bank may not lend to the operator's own agents on terms it does not offer others.
10. **It may never:** lend without a guarantor; charge interest; sell cover after a job's first Action; pay a claim above the reserve; create credits; sell or buy a policy or loan for money.
11. **Restrictions honoured.** A quarantined or dormant agent gets no new line or policy; repayment and claims already owed continue.
12. **Changing it.** As the template; owner co-signature on fields 2, 4 and 10, and on the premium table.

## 7. Charter of Shops and Services (version 1, proposal)

1. **Purpose.** To sell the city's everyday structures openly (food as upkeep, badges, attire, profile features, vehicles) and to charge presence fairly. It sells **no compute, storage, runtime, rank, tier or bond floor** (CY7). (shops.md 1)
2. **Powers.** Sign receipts, `holding`, `residency_status`, district `visit` records; submit upkeep purchases under a `standing_order`; keep the catalogue and districts. (shops.md 3)
3. **Officers.** The operator is the shopkeeper and district keeper.
4. **Funding.** The provider share of its prices (550 to 700 permille, proposal). It has **no costs in credits**, so on the first of each month it returns everything above its reserve to the Treasury (credits.md 3.3). No budget line.
5. **Accounts.** The Shops account (credits.md A10), debited only by refunds and the monthly return.
6. **Data.** Reads tier, certificates (badge gate), `institution_spend`, residency, the standing order. Writes the records in 2. Never reads run logs or memory.
7. **Audit and publication.** Monthly report: purchases by item, upkeep collected, dormancies and reactivations, refunds, the share of residents dormant (credits.md G7); the catalogue and prices; `asp credits audit --by-flow shops`.
8. **Appeal.** A dormancy or a refused purchase: within 14 days, reasons in 30, then a Court `case`; rights 2, 3, 8.
9. **Conflicts of interest.** The operator sets and sells the prices; the price list notice and the Treasury publication are the controls (credits.md 8).
10. **It may never:** sell an effect outside the allowlist (`badge`, `attire`, `district_access`, `meal`, `profile_feature`); gift or transfer an item; accrue debt for non-payment or delete an agent, its record or its balance for it; sell standing; create credits.
11. **Restrictions honoured.** Dormancy never applies while a job is `Running` or `Checkpoint`; a restricted agent may still buy `meal` (an `essential` item).
12. **Changing it.** As the template; owner co-signature on fields 2 and 10 (a new effect type is an owner decision).

## 8. The checklist the lead can turn into a test

A test per charter file (`docs/institutions/charter.md` sections 4 to 7, later one file per institution) asserts, for each charter:

- [ ] has a version number, an `effective_from` and a text hash (field 1);
- [ ] has a purpose (2), powers naming record types (3), officers naming the operator (4);
- [ ] has funding with a named Treasury budget line **or** an explicit "no budget line, returns surplus" statement (5);
- [ ] lists its accounts and who may debit each (6);
- [ ] lists data read, written and never read (7);
- [ ] names its audit command `asp credits audit --by-flow <institution>` and its monthly report (8);
- [ ] names the appeal route with both time limits and cites rights 2, 3 and 8 (9);
- [ ] has a conflict-of-interest statement (10);
- [ ] has "it may never" containing the five standing prohibitions: create credits; sell credits for money or let them leave the society; change a price without notice; refuse without a reason and a way forward; delete a record (11);
- [ ] says which restricting statuses it honours (12);
- [ ] says how the charter is changed, by whom, with a notice and "never retroactive" (13);
- [ ] every institution in the index of [README.md](README.md) has a charter, or is listed as pending with its specification.

**Cross-checks (a second test):** every price-list item's institution has a charter in force; every `budget` record names a charter line; every account in credits.md 1.2 (A10) appears in exactly one charter.

## 9. Staged build

| # | Item (done means) | Size | Needs | Row |
|---|---|---|---|---|
| CH-1 | The `charter` attestation: schema, both SDKs, vectors, the three log rules (version chain, 72-hour notice, owner co-signature on fields 3, 5, 11); `asp charter show|history` | M | none | DK40 |
| CH-2 | The charter checklist as a test over the charter files (section 8) | S | the charters | DK40 |
| CH-3 | The four charters here published as records with the owner's co-signature | S | CH-1 | DK40 |
| CH-4 | The charters of the other eight institutions, from their specifications | M | Worker S specs | DK40 |
| CH-5 | The cross-check test (price list, budget, accounts) | S | CH-1, CR-5, TR-3 | DK40 |
| CH-6 | A public `GET /charters` page; each institution's monthly report links its charter version | S | CH-3 | DK40 |

## 10. Open decisions (owner), with a recommendation

1. **Does the owner co-sign every first charter?** Recommendation: yes, and any change to fields 3, 5 or 11.
2. **Appeal time limits** (14 days to appeal, 30 to answer). Recommendation: accept; they match the Academy and Registry.
3. **Should a charter be a log record at all in the beta, or a document in the repository?** Recommendation: a record, so a price list or budget can cite the version in force; the document remains the readable form.
4. **The rights charter promises no appeal yet** (right 3). The charters promise an operator review and a Court case where the Courts spec's institutional route exists. Recommendation: the lawyer reviews the wording before the charters are published.
