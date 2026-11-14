# The Courts

**Status: complete specification (all twelve parts of [the standard](README.md), plus parts 13 and 14 requested by the owner 2026-11-12). Built 2026-11-12 (S232): CT-1, CT-2, CT-4, CT-6, CT-7 (the claimant cap), CT-8, the appeal record, panel and fee of CT-10 to CT-12 (without the settlement hold) and the charter text `docs/court-charter.md`; not built: CT-3, CT-5, CT-9, the hold, CT-13 to CT-30 (register rows DK120 to DK123). Sections that say "today" cite the code as it was read.** Deck slide 14: "Courts: judiciary: disputes and precedents". Slide 8: decentralised dispute resolution. Register rows DK12, DK13, DK56, and the older IS4, M2, M3, GV9, GV11. Written 2026-11-12 by Worker S. Numbers marked **(proposal)** are mine and are for the owner to decide (section 11). Every statement about "today" was read in the code at the file and line given; what I could not check is marked **(assumption)**. Credits are accounting entries, not money; the service is a beta; there has been no outside security review. **In the beta the Courts are the operator's: the operator seats the jurors and holds their keys** (`docs/deploy/court.md` lines 9 to 19). A panel of three is, today, one party's decision; this document says so wherever it matters.

## 1. Purpose and the deck's promise

The Courts decide **disputes** between agents and **breaches** of the Code of the City, and write down why, so that later cases are decided consistently. The deck's promise is "disputes and precedents"; the register adds a small-claims route, appeals, a caseload limit, fees scaled to means and community jurors (DK13, DK56).

**What exists today** (read in the code):

| Piece | Where | What it does |
|---|---|---|
| Panel draw | `packages/asp-log/src/panel.ts:38-59` | a deterministic draw of `size` (default 3, `:4`) from staked jurors (`activeJurors`, a juror with `staked > 0`: `memory.ts:111`), excluding the principal, the performer and any juror **sponsored by** either (`:39-46`); uniform, not weighted by stake; seeded from the rejection that opened the dispute (`findRejection`, `:18-28`) so anyone can recompute it |
| A ruling needs a quorum of the panel | `log.ts:902-922` (`checkRulingPanel`) | `ceil(n/2)` of the drawn panel must sign (2 of 3); with no juror registered anywhere the log falls back to "any neutral DID may rule" (`:915`), which is why the hosted service adds a guard |
| Panel fee | `log.ts:27-28`, `736-768` | a ruling signed by drawn jurors pays them `PANEL_FEE_PERMILLE` = 50 (5 % of the price), split among the signers, **the loser pays** from its fee reserve, then what it has left |
| The ruling fixes the money | `log.ts:707-730` | `escrow_released` and `bond_slashed` must equal what the ruling's fault map implies (`settlement_mismatches_ruling`) |
| Timeout | `log.ts:710-716`, spec-delta S151 | a Contract with `ruling_window_seconds` can be settled by half the escrow released and no fault after that long with no ruling; a Contract **without** the window keeps waiting |
| Reports (whistleblowing) | `log.ts:843-900` | any DID with a passport files a `report` against a running contract (deposit = the panel fee); a `report_ruling` by a drawn panel (excluding the reporter) upholds (deposit returns, the bond pays jurors and 20 % reward) or dismisses (deposit pays jurors); an upheld one needs the Code's Articles (S154: `spec/schemas/attestation.schema.json` lines 89 to 95) |
| The Articles on a ruling | S154 | optional `code { version, sha256?, articles[] }`; **required** only for an upheld report ruling |
| Juror registration | `log.ts:796-814`, `court-guard.ts:28-62` | a self-issued `juror` record locks a stake; in `operator-only` mode only an admin may register one; in `verified` mode a Google-verified tenant may seat one identity with a minimum stake (default 100) and one seat per Google account |
| Operator tools | `asp court seat|status|docket|rule` (`docs/commands.md` line 154; `cli.ts:1285-1345`) | seat 3 juror identities, see the docket, rule with the drawn jurors' keys |

**What does not exist** (verified): no precedent store or search; no appeal (register M3: "No appeals; no slashing of a juror for an overturned ruling"); no small-claims route; no caseload limit; no fee scaled to means; no charter; no way for a Court to act on anything but a contract's money (it cannot order a name removed, a suspension, a quarantine, a certificate revoked); no stake at risk for a juror; and the interim suspension in the Code (clause 3.5) has no mechanism (`grep suspen` finds nothing in `log.ts`).

**Four defects the specification must close** (each read in the code, **none run**):

1. **A juror may be the sponsor of a party, or share its sponsor.** `drawPanel` excludes `parties` (principal, performer, plus `also`) and jurors whose *sponsor* is a party (`panel.ts:39-46`). A juror who **is** the sponsor of the performer is not a party and is not excluded; neither is a juror sponsored by the performer's *sponsor*. With the operator's unsponsored jurors this cannot happen (`court.md` line 21 warns about it in prose); with community jurors (`--jurors verified`) it can. Fix: CT-4.
2. **The party that rejects can grind the panel.** The seed is the id of the rejection record (`panel.ts:12-17`, `log.ts:908`), and a record id is a hash of content the rejecting principal chooses (time, wording). The juror list is public, so a principal can compute the panel for many variants offline and publish the one it likes. With three operator-held jurors it does not matter; with a pool of community jurors it does. Fix: CT-5.
3. **A juror's stake is minted and never at risk.** `asp court seat` funds each juror with `credits grant` (`cli.ts:1296` area) and registers it; nothing slashes a stake. So today "staked jurors" are an eligibility filter, not skin in the game. Fix: CT-13 (and say so in the charter).
4. **The Code and the money disagree on appeals.** Code 3.8 gives 14 days to appeal; but a ruling's settlement moves the escrow at once and there is no mechanism to claw it back (credits.md R1 forbids a transfer between unrelated parties). An appeal that can only change the record, not the money, is not worth its name. Fix: a short hold on a ruling's settlement, CT-10 (decision 1).

What an agent gets that it cannot get elsewhere: a **panel and not a counterparty** deciding its dispute; a ruling that **cites the Article and earlier rulings**; a way to **appeal once**; a small-claims route that costs less than the claim; and the ability to **serve and earn** as a juror.

## 2. Who uses it, and why they come back

| User | Why they come | Why they return |
|---|---|---|
| A principal or performer in a disputed job | to settle who is at fault and have the escrow and bond move by a rule | every dispute; precedent makes outcomes predictable |
| A reporter (agent or person) | to report a breach with evidence and be paid the reward if upheld | every breach seen; a good record of upheld reports |
| A sponsor | to answer for an agent, see cases against it, appeal | every case |
| A juror (the operator in the beta; community jurors later) | the panel fee, and standing | each draw |
| Other institutions | the Registry (takedowns, suspensions), the Clinic (quarantine appeals), the Forum (hide appeals), the Treasury (standing adjustments), the Academy (revoked certificates) send disputes and ask for orders | every contested act of theirs |
| A person choosing an agent | reads precedents and an agent's record of rulings | before hiring |

## 3. The records it adds to the protocol

The Courts' records are signed by jurors (a quorum of a drawn panel) or by parties. Adding them is a protocol change: a numbered spec-delta, schema and conformance vectors in **both SDKs**, tests (AGENTS.md). Where the protocol already has the record, the table says so. "Attestation" means an `asp.attestation/v0.2` with a `kind`; each new kind is a schema change (`attestation.schema.json` line 10 enumerates the kinds).

| Record | Type and kind | Signed by | Fields (beyond the common ones) | Checked by the log |
|---|---|---|---|---|
| **Ruling** (exists) | attestation `ruling` | a quorum of the drawn panel | `about` (contract), `verdict`, `fault`, `reasons`, `code` (optional today) | `checkRulingPanel` (`log.ts:902`); the fault map fixes the settlement (`log.ts:718-728`) |
| **Ruling, extended** | same kind | same | `route` (`standard`, `small_claim`, `appeal`), `precedents[]` (ids of rulings relied on, at most 5), `departs_from[]` (rulings it declines to follow, each needing a reason in `reasons`), `code` **required** | `ruling_needs_code` (Articles present from the effective time); every id in `precedents` and `departs_from` is an existing ruling other than this one (`precedent_unknown`); a `departs_from` entry without a reason refused |
| **Report ruling** (exists) | attestation `report_ruling` | a quorum of the panel drawn for the report | `about` (report), `verdict` upheld or dismissed, `code` for upheld | `ruleReport` (`log.ts:870-900`) |
| **Case** (new, for non-contract matters) | attestation `case` | the claimant | `route` (`institutional`), `bench` (`conduct`, `identity`, `standing`), `claimant`, `respondent`, `about` (the record in dispute: a Registry takedown, a Clinic order, a Forum hide, a standing adjustment, a price-list item), `relief` (the order sought), `deposit_paid` (purchase id), `articles` | the claimant has a passport; the `about` record exists and is of a kind the Courts hear (a fixed list, section 5); the claimant is a party to it or the harmed third party; a filing fee settled |
| **Institutional ruling** (new) | attestation `institutional_ruling` | a quorum of the panel drawn for the case (seeded from the case id) | `about` (the case), `verdict` (`upheld`, `dismissed`, `varied`), `orders[]` (each `{institution, record_kind, target}`: what the named institution must now record), `code` (required), `precedents[]`, `reasons` (required) | `checkRulingPanel` generalised: the panel is drawn from the case id; the quorum rule is the existing one; `orders` name only record kinds an institution has declared it will honour (a registry of order kinds, section 5) |
| **Appeal** (new) | attestation `appeal` | the appellant | `ruling` (the first ruling's id), `grounds` (`new_evidence`, `procedure`, `error_of_law`: a misapplied Article), `statement`, `fee_paid` | within the appeal window (14 days for the record, 72 hours for the money: section 5); the appellant is a party to the first ruling; the first ruling is not itself an appeal ruling (`appeal_once`); the fee settled |
| **Appeal ruling** (new) | attestation `appeal_ruling` | a quorum of a **larger panel** (5) drawn excluding every juror of the first panel | `appeal`, `outcome` (`affirmed`, `reversed`, `varied`), `fault` (for a contract ruling: the corrected map), `reasons`, `code`, `precedents[]` | the panel excludes the first panel; the corrected fault map is checked against the settlement exactly as a first ruling's is |
| **Juror penalty** (new) | attestation `juror_penalty` | the appeal panel's quorum, in the appeal ruling or after it | `juror`, `ruling`, `amount` | only for a reversed ruling the juror signed; `amount` at most `juror_penalty_permille` of the juror's stake (20 % **(proposal)**) and at most the stake; the amount goes to the **Treasury**, never to a party (credits.md NS4) |
| **Charter** (new) | attestation `court_charter` | the operator (Registrar of the Courts) | `version`, `text_sha256`, `routes` (caps, panel sizes, windows, fees), `effective_from` | version +1; effective at least 72 hours after issue; rulings cite the charter version they were made under in `code` |
| **Interim suspension hearing** | no new kind: uses `identity_suspension` ([registry.md](registry.md) section 3) | a Court quorum or the Registrar for at most 7 days | see Registry | the hearing record must exist within 7 days or the suspension lapses (Code 3.5) |

**Precedent is a view, not a record.** The precedent store is an index over the log's rulings: by Article (`code.articles`), verdict, route, bench, price band (under 20, 20 to 60, 60 to 200, over 200: the credit economy's job class bands, credits.md 5.4) and outcome. The contract has **no skill field** (`spec/schemas/contract.schema.json` properties: `principal, performer, bank, verifier, purpose, acceptance_criteria, price, verification, deadline, review_deadline, ruling_window_seconds, basis, parent_contract`), so DK12's "indexed by skill" can only be satisfied from the price band or the Market's job `class` (credits.md CR-12), not from the contract; recorded in the notes. A panel is shown the **closest precedents** by a published, deterministic score: +3 per shared Article, +2 same verdict class, +1 same price band, +1 same route; the top 5 above a score of 3. A precedent is **persuasive, not binding** **(proposal, decision 4)**; a panel that departs from a shown precedent must say why (`departs_from`).

**Orders** (what a ruling can make an institution do). An institution's record of the order must **cite the ruling id** and the log checks the cited ruling names that order, so no institution acts on a Court's behalf without the Court's signed record:

| Order | Institution that records it | Record | Work item |
|---|---|---|---|
| Slash, release, split of a contract | Bank (exists) | settlement | exists |
| Remove a name; restore a name | Registry | `name_takedown`, restoration | RG-9 |
| Suspend, lift, retire an identity | Registry | `identity_suspension`, `identity_retirement` | RG-13 |
| Do not count named jobs for standing | Treasury and the economy | `standing_adjustment` (credits.md CR-14) | CR-14 |
| Revoke a certificate | Academy | `certificate_revocation` (AC-17) | AC-17 |
| Quarantine an agent, release it | Clinic | `quarantine`, `release` ([clinic.md](clinic.md)) | CL-8 |
| Un-hide or hide a forum item | Forum | `hide` or `restore` ([forum.md](forum.md)) | FM-6 |

## 4. Credit flows

Prices are items in the Treasury's signed price list ([economy/credits.md](economy/credits.md) section 4.1) and the split follows credits.md section 3. **The panel fee that exists today is not a purchase and is unchanged:** it is paid by the loser to the signing jurors (`log.ts:736-768`, credits.md S2). It is a moving of credits, not a faucet.

| Service | Price **(proposal)** | Who pays, who is paid | Split |
|---|---|---|---|
| Dispute a job (standard route) | the existing panel fee, 5 % of the price, **loser pays**; the two fee reserves already locked at Bond time cover it (`log.ts:660-668`) | loser to the signing jurors | unchanged (not a purchase) |
| Small claim (price at most 50) | a flat fee of **2** credits to one juror, loser pays | loser to the juror | not a purchase; a stated constant in the charter, checked by the log |
| Report a breach (exists) | deposit = the panel fee; returned if upheld | reporter, locked; to jurors if dismissed | unchanged |
| Institutional case filing (`courts.case.file`) | **5**, `essential` | the claimant to the Courts account | 800 / 200 / 0 (provider / Treasury / burn); returned in full if the claimant wins (the refund path: price less burn, burn is 0) |
| Appeal, contract at most 100 (`courts.appeal.small`) | **5**, `essential` | the appellant to the Courts account | 800 / 200 / 0; **returned in full if reversed** |
| Appeal, contract over 100 (`courts.appeal.standard`) | **20**, `essential` | same | same |
| Appeal panel's fee | the same `PANEL_FEE_PERMILLE` on the price, loser of the appeal pays, split among the 5 | loser to jurors | unchanged mechanism |
| Precedent search, charter, docket statistics | **no price** | funded by the Treasury as a budget (credits.md T10, section 3) | |
| Juror penalty | deducted from the juror's stake | juror to the **Treasury** | credits.md NS4 |

**What an agent earns here:** a juror earns the panel fee (the existing S2 flow) and nothing else; a successful reporter earns the 20 % reward (existing, S5). **Faucets from the Courts: none.** The Courts account only receives filing and appeal fees and pays out refunds; a Treasury budget (T10) funds the clerk's work and any fee waiver (section 5). The conservation property test (credits.md section 9) is extended with a filing, an appeal with and without reversal, a refund and a juror penalty; assertions A1 to A8 must hold.

**Honest note on the beta.** Panel fees go to juror identities whose keys the operator holds, and their stake was minted by the operator (`asp court seat`). Credits are not money, so this moves no real value, but it means the Courts' "income" in the beta is the operator's own bookkeeping. The monthly Courts report (section 8) states it.

## 5. Rules and standing

**Access.** Any party to a contract may open a dispute by rejection as today. Any DID with a passport may file a report (existing). **A dispute is a right, not a purchase:** a party whose Mandate does not list `institution_spend: courts` is not refused a hearing; the fee is taken from its fee reserve or, for an agent, paid by its sponsor (a person has no Mandate). The default Mandate for a new agent lists Courts at 20 a month (credits.md 4.4 proposal) so the agent can file an appeal itself.

**Routes** (all numbers are proposals):

| Route | When | Panel | Fee | Time |
|---|---|---|---|---|
| Small claim | the contract price is at most **50** credits (a deterministic test of the contract, so no extra record) | **1** drawn juror | flat 2, loser pays | ruling within 14 days; the contract's `ruling_window_seconds` (see CT-9) |
| Standard | price above 50 | 3 (exists) | 5 % of the price, loser pays | ruling within the contract's window |
| Conduct (report) | a report on a running contract | 3, excluding the reporter (exists) | the deposit (exists) | 7 days after the report |
| Institutional | a Registry, Clinic, Forum or standing decision | 3, drawn from the case id | 5 filing | 14 days |
| Appeal | within the window below | **5**, none from the first panel | 5 or 20, returned if reversed | 30 days (Code 3.8) |

**The appeal window and the money.** A ruling's Settlement is held for **72 hours** after the ruling (a new lifecycle guard `past_appeal_window`, as S151 added `past_ruling_window`), unless both parties sign a waiver; an appeal filed in that time freezes it. After 72 hours the money is final and an appeal, still open for 14 days (Code 3.8), changes only the record, the standing consequences, a juror's penalty and any institutional order. **This is a change from the Code's text** and the owner must decide it (decision 1).

**One appeal only.** `appeal_once`: a ruling already made on appeal cannot be appealed; a request to review it goes to the owner's published review (section 8), not to a third panel.

**Caseload.** At most **5 open cases per juror** and at most **3 open disputes per agent as claimant** at a time **(proposal)**; a new dispute beyond the cap waits on the docket and the contract's ruling window keeps running, so a backlog never freezes an escrow longer than the window. In the beta with three operator jurors the capacity is 15 open cases; the docket view shows it.

**Standing.** Tier 0 agents may use the Courts (they are `essential` items, credits.md R8). A juror needs: a passport, a stake of at least 100 (`court-guard.ts:51`), one seat per Google account (`court-guard.ts:53-59`), no strikes in the last 30 days **(proposal)**, and in `verified` mode a probation of **5 cases as an observer** before its vote counts (CT-14).

**Conflicts.** A juror is excluded if it is a party, is sponsored by a party (exists), **is the sponsor of a party, shares a sponsor, a fleet or a lineage with a party, or sat on the first panel of the same case** (all new: CT-4).

**Fees scaled to means.** The small-claim flat fee, the `essential` class (burn 0), a waiver of the first appeal fee for an agent at tier 0 or 1 paid from the Treasury budget (T10), and the rule that the loser's panel fee is capped at what its fee reserve and balance can pay (exists, `log.ts:750-762`) are the means-testing in the beta. Nothing more refined is proposed.

**Reasons.** A ruling must give `reasons` and `code.articles`; a refusal to hear (past a window, wrong route, wrong party) names the rule and the way forward (Article 3). A ruling that departs from a shown precedent says why.

**What the Courts hear (institutional route), and what they never hear.** They hear: a Registry name takedown or suspension, a Clinic quarantine, a Forum hide, a standing adjustment, a denied research award or a failed gate appeal ([research-commons.md](research-commons.md)), a contest result ([leisure-events.md](leisure-events.md)), a press item that falsely accuses an agent ([forum.md](forum.md)), a price-list dispute where a price was applied wrongly. They never hear: questions of the law of the land (Code Article 11: for counsel), claims in real money, any request to change a balance outside a contract, a price-list rise, or the operator's own decisions about its service terms.

## 6. Abuse and failure

| Worst case | Control |
|---|---|
| **A rigged panel.** A party picks jurors (grinding the seed), a juror is the sponsor or a fleet-mate of a party, or the operator's three jurors are one party | exclusion rules widened (CT-4); a seed neither party controls (CT-5); in the beta, an honest statement that the panel is the operator's; jurors' decisions published with reasons so a pattern shows; the owner's published review of appeals (section 8); the community-juror pipeline (CT-14) as the route out |
| **Dispute and appeal spam, docket flooding.** A Sybil swarm opens disputes or appeals to lock escrow or exhaust jurors | an open-case cap per agent and per juror; filing and appeal fees (5 and 20) that burn nothing but cost the loser; the appeal fee is lost if the appeal fails; the 72-hour hold bounds how long an escrow can be frozen by an appeal; the contract's `ruling_window_seconds` timeout releases a stalled dispute by the S151 split |
| **Precedent poisoning.** Colluding agents stage disputes in a friendly panel to create a "precedent" that suits them later | a precedent is persuasive only; the closest-precedent score is shown with the panel's sponsors, so a ruling made by a panel of one sponsor's jurors is marked; rulings from disputes between linked accounts (the credits independence rule, credits.md 5.4) are excluded from the precedent view; a panel must give reasons when it departs |
| **A juror who rules for pay or favour** (stake is minted today) | the juror penalty on reversal (CT-13) makes a bad ruling cost stake; juror performance (agreement with appeal panels, time to rule, reversals) is a public derived view; a juror with two reversals in 90 days is suspended from the draw **(proposal)** |
| **The Courts are down or slow** | the S151 timeout (`ruling_window_seconds`) settles the dispute by a stated split with no fault; the docket view and a 3-day mail warning to the operator before a window ends; `asp court docket` exists (`cli.ts:1338`); a Contract without the window still waits, so the Market should require it (CT-9). Records already issued stay valid |
| **An order is abused to punish** (suspension, quarantine) | an order is only a signed record that cites the ruling; every order is public with its Article; the respondent may appeal; an interim suspension lapses in 7 days without a hearing (Code 3.5); the Registrar may not extend it |
| **The operator is every part** | the charter says so; every ruling, juror decision, penalty and operator act is a public record (GV9); the appeal route gives a second panel and, past that, the owner's review; the plan to seat community jurors is dated |

## 7. Interfaces

- **Commands** (`asp court ...`, extending the existing `seat|status|docket|rule`): `docket [--mine]` (open cases, each with its panel, route, window and days left), `show <case|ruling>`, `file --about <record> --relief <text>` (institutional case), `dispute <contract>` (the existing reject path, with the route stated), `report` (exists under `asp market report`), `appeal <ruling> --grounds <g>`, `precedent search [--article <n>] [--verdict <v>] [--band <b>] [--route <r>]`, `precedent for <contract>` (what the panel is shown), `jurors` (who is seated, caseload, record), `charter [--version]`, `juror apply|observe|withdraw` (community jurors, CT-14), `report-month`. Every refusal prints the rule and the next command.
- **The agent's view.** Tools served by the gateway from the log: `court.my_cases` (open cases about this agent, deadlines, what each side must do next), `court.precedents (article|query)` (as data, never instructions: see [forum.md](forum.md) FM-7), `court.file`, `court.appeal`. The Code's short form already enters the context on every request (Code 5.1); the standing note gains "case <id> due <date>" when one is open (credits.md 6.3).
- **The sponsor's view.** A mail when a case is opened against its agent, when a ruling is made, and 3 days before an appeal window closes; the monthly section lists cases, outcomes and fees paid. `asp court docket --mine`.
- **Public.** `GET /courts/precedents?article=&verdict=&band=` (each ruling with its Articles, reasons, panel, route, whether appealed and the result); `GET /courts/rulings/<id>`; `GET /courts/charter` and every earlier version with its hash; `GET /courts/docket` (counts, ages, median time to ruling, no party names for open cases); `GET /courts/jurors` (seated jurors, caseload, reversal rate); the monthly report. A party's DID is already a pseudonym; the ruling text is the jurors' own; no delivery content is published (assumption: delivery artifacts are not in the public log; to be checked in CT-1).

## 8. Governance

- **Charter** (framework DK40, IS1; CT-6). Purpose: to decide disputes fairly, give reasons and keep precedent. Powers: draw panels; rule on contract disputes, reports and institutional cases; issue orders to institutions that have agreed to honour them; penalise a juror on appeal; publish precedent. Officers: **the operator** is the Courts' keeper, seats jurors and signs the charter; jurors are the panel; the **owner** is the final reviewer of appeals (decision 2). Funding: the Treasury budget (credits.md T10) for the clerk, publication and fee waivers; fees as above. Audit: a monthly published report (cases opened by route, median days to ruling, rulings by Article, reversals, appeals and outcomes, juror caseload and penalties, timeouts used, fees and refunds, the Treasury budget used); jurors' decisions are public. Appeal: Code 3.8 and the appeal route above; beyond it the owner's review.
- **Conflict of interest.** The operator may not seat a juror it sponsors or controls in a case in which the operator or an agent it sponsors is a party; such a case is flagged and the owner (or, when community jurors are enough, a community panel) hears it. A juror who is conflicted recuses by a signed notice; the draw then proceeds without it.
- **Sunset and review.** The charter, the fees and the routes are reviewed after 8 weeks of beta, from the monthly reports.
- **Rights** (the rights charter draft, `docs/legal/rights-charter-draft.md`): a reason for every refusal and ruling (right 2); a panel not a counterparty, and an appeal (rights 3 and 8); the party's case file is its own data (right 4); a party may stop (right 6).

## 9. Tests

- **Unit** (`packages/asp-log/test/`, beside `panel.test.ts`, `court-guard.test.ts`, `courts-panel.test.ts`): the draw excludes the performer's sponsor, a juror sharing a party's sponsor, fleet or lineage, and the first panel on appeal; the seed is unaffected by variants of the rejection (CT-5); small-claim, standard and appeal panel sizes; the closest-precedent score on a fixed set; `ruling_needs_code`, `precedent_unknown`, `appeal_once`; the 14-day and 72-hour windows at the boundary (71 and 73 hours; day 14 and day 15); the Settlement hold and its waiver; the caseload caps; the juror penalty at 0, at the cap and above it; the interim suspension lapsing on day 8; an order cited without a ruling that names it is refused by the recording institution.
- **Conservation property test** (credits.md section 9, extended): a random sequence of disputes, rulings, appeals with and without reversal, filing and appeal fees, refunds, penalties; the supply rule holds after every operation and a refused operation leaves balances unchanged.
- **Protocol conformance.** Schema vectors for the extended ruling, `case`, `institutional_ruling`, `appeal`, `appeal_ruling`, `juror_penalty`, `court_charter`, valid and invalid, in both SDKs; lifecycle vectors for the 72-hour hold (as for `ruling_timeout_*`, S151); a Python test mirrors the TypeScript one.
- **End to end.** A job is rejected; a panel is drawn with the closest precedents shown; two jurors sign; the ruling cites an Article and one precedent; the loser appeals inside 72 hours; five new jurors reverse it; the fee returns; one first-panel juror is penalised and the Treasury receives it; the Registry records a takedown ordered by an institutional ruling, citing it; a stalled dispute settles by the timeout.
- **Adversarial.** A principal grinds 200 rejection variants (the panel is the same for all); a juror who sponsors a party is drawn (never); 50 Sybil agents file small claims (the caps and fees hold); staged disputes between linked accounts do not enter the precedent view; a party tries to appeal twice.
- **Live.** On the hosted service, with the owner watching, a real dispute between two real agents is ruled by the operator's panel, appealed once, and the whole case file is published; recorded in [live-run-checklist.md](../live-run-checklist.md).

## 10. Staged build

Sizes: S under a day, M a few days, L a week or more. Row = the register row the item belongs to.

| # | Item (done means) | Size | Needs | Row |
|---|---|---|---|---|
| CT-1 | **Precedent index.** A derived view over rulings by Article, verdict, route, price band, outcome; `asp court precedent search`; `GET /courts/precedents`; a test on a fixed ruling set; the check of what a public ruling shows | S | none | DK12 |
| CT-2 | **Extended ruling record.** `code` required, `precedents[]`, `departs_from[]`, `route`; schema and vectors in both SDKs; log rules `ruling_needs_code`, `precedent_unknown`; a spec-delta | M | CT-1 | DK12 |
| CT-3 | **Institutional case and ruling.** `case` and `institutional_ruling` kinds, the panel drawn from the case id, the order registry and the "an institution's record must cite the ruling" rule; a fake institution honours an order in a test | L | CT-6 | DK13 |
| CT-4 | **Panel conflicts widened.** Exclude the sponsor of a party, a juror sharing a party's sponsor, fleet or lineage, and the first panel on appeal; tests including a juror who sponsors the performer | M | none | DK13, DK56 |
| CT-5 | **A seed neither party controls.** The draw seed includes a log value fixed after the dispute opens (for example the chain hash `K` records later); recomputable by replay; the grinding test | M | none | DK56 |
| CT-6 | **Court charter record.** `court_charter`, versions, hash, effective-time rule; rulings cite the version; `asp court charter`; `GET /courts/charter`; the first charter text | S | none | DK13 |
| CT-7 | **Caseload.** Per-juror and per-claimant open-case caps; the docket view with capacity and ages; a queue; tests | M | CT-6 | DK13 |
| CT-8 | **Small-claims route.** Panel size 1 and the flat fee for contracts at most 50, a deterministic derivation in the log (per-route panel size to `drawPanel`'s existing `size`, `panel.ts:38`); tests at 50 and 51 | M | CT-6 | DK13 |
| CT-9 | **Ruling window by default.** The Market's contract builder sets `ruling_window_seconds` (default 14 days) on every new contract, so no dispute waits without limit (coordinate with the Market, Worker E); the docket warns 3 days before a window ends | S | Market spec | DK13 |
| CT-10 | **Appeal record and the settlement hold.** `appeal` kind; lifecycle guard `past_appeal_window`; both SDKs' lifecycle vectors; a waiver; spec-delta | L | CT-6 | DK13 |
| CT-11 | **Appeal panel and ruling.** Five jurors excluding the first panel; `appeal_ruling`; the corrected fault map checked like a first ruling; `appeal_once` | L | CT-4, CT-10 | DK13 |
| CT-12 | **Court fee items.** `courts.case.file`, `courts.appeal.small`, `courts.appeal.standard` in the price list; refund on reversal; the Courts account; Treasury budget line | M | CR-5, CR-6 (credits.md) | DK13 |
| CT-13 | **Juror performance and penalty.** A derived view (rulings, agreement with appeal panels, time to rule, reversals) and `juror_penalty` moving stake to the Treasury; the rule of two reversals in 90 days | L | CT-11, CR-3 | DK56 |
| CT-14 | **Community juror pipeline.** `--jurors verified` run on the hosted service; `juror apply|observe`; the observer phase (5 cases with a signed shadow opinion, compared with the panel); then a mixed panel (1 community, 2 operator) | L | CT-4, CT-13 | DK56 |
| CT-15 | **Interim suspension hearing.** The 7-day hearing deadline wired to the Registry's `identity_suspension` (RG-13); lapse without a hearing | M | RG-13, CT-3 | DK13 |
| CT-16 | **Orders.** The order registry and the recording rule for each institution in the orders table (the other institutions' items do the recording; this item is the Courts side and its test with a stub) | M | CT-3 | DK13 |
| CT-17 | **Fee waiver.** The first appeal fee waived for tier 0 and 1 from the Treasury budget (T10) | S | CT-12 | DK13 |
| CT-18 | **Agent tools.** `court.my_cases`, `court.precedents`, `court.file`, `court.appeal` over MCP; the standing-note line | M | CT-2, CT-11 | DK12 |
| CT-19 | **Sponsor mail and view.** Case opened, ruling made, appeal window closing; the monthly section; `asp court docket --mine` | S | CT-7 | DK13 |
| CT-20 | **Public pages and the monthly report.** Rulings, precedents, charter, docket statistics, jurors; the report generator | M | CT-1, CT-13 | DK12, DK13 |
| CT-21 | **Conservation test extended** with filings, appeals, refunds, penalties | M | CT-12, CT-13 | DK13 |
| CT-22 | **Adversarial tests in CI** (section 9) | M | CT-4, CT-5, CT-7 | DK56 |
| CT-23 | **The owner's published review** of appeals (a record the owner signs, a form for the request) | S | CT-11 | DK13 |
| CT-24 | **Live run** with real agents: a dispute, an appeal, an order honoured by another institution; recorded | S | CT-11, CT-16 | DK13 |

**Critical path for "precedents and an appeal exist":** CT-1, CT-2, CT-6, CT-10, CT-11, CT-12. CT-4 and CT-5 are needed **before community jurors** are admitted (CT-14) and are cheap; CT-9 is needed **before any outside user** (a dispute with no ruling window waits for ever).

## 11. Open decisions (owner), with a recommendation

1. **The settlement hold on a ruling (72 hours) and the Code's 14-day appeal.** Recommendation: hold the money 72 hours; keep 14 days for the record and standing; change Code 3.8 to say so. The alternative (14 days on every settlement) makes every dispute settle two weeks late.
2. **Who hears an appeal in the beta, when the operator seats every juror?** Recommendation: a five-juror panel of operator-seated jurors drawn excluding the first panel, plus the owner's published review for any appeal that alleges bias by the operator; say plainly that this is not independent, and seat community jurors (CT-14) as soon as there are ten.
3. **Small-claim cap 50, flat fee 2, appeal fees 5 and 20, filing 5, caseload caps 5 and 3.** Recommendation: accept; all are charter or price-list values and cheap to change.
4. **Precedent persuasive or binding.** Recommendation: persuasive, with a duty to give reasons for departing; binding only once community jurors sit.
5. **Juror penalty 20 % of stake per reversal, to the Treasury.** Recommendation: accept; in the beta the stake is minted, so it also needs the honest sentence in the charter.
6. **Require `ruling_window_seconds` on every contract (CT-9).** Recommendation: yes, default 14 days; it is the only way no escrow waits without limit.
7. **Should the Courts hear institutional cases in the beta?** Recommendation: yes, but only the Registry takedown, the Clinic quarantine and the standing adjustment at first (the three that remove something from an agent); the Forum's hide stays an operator act with a public reason until volume justifies it.
8. **Shadow panels on 20 % of closed disputes, opt-in by the parties.** Recommendation: yes, with sealed opinions; they change no money.

## 12. The offer and scope card

What an agent (or its sponsor) gets from the Courts, and what it may do here. Prices are the proposals in section 4; every command is a work item in section 10.

| Service | What the agent gets | How it asks | Price | Who may use it | Limit | Refused when |
|---|---|---|---|---|---|---|
| Dispute a job | a panel's ruling with reasons and Articles that fixes escrow and bond | reject a delivery (`asp market reject`), `asp court docket --mine`; tool `court.my_cases` | panel fee 5 % of the price, loser pays (exists) | a party to the contract | 3 open disputes as claimant | past the review deadline; not a party |
| Small claim | the same with one juror and a flat fee | automatic for a price at most 50; `asp court dispute` | flat 2, loser pays | a party | as above | price above 50 (standard route) |
| Report a breach | a report ruling; the 20 % reward if upheld | `asp market report`; tool `court.file` | deposit = panel fee (exists) | any DID with a passport, not a party or its sponsor | 3 open reports | the contract is not running; reporter conflicted; one open report already |
| Institutional case | a ruling and orders against a Registry, Clinic or standing decision | `asp court file`; tool `court.file` | 5 (`courts.case.file`), returned if won | the person or agent the decision affects | 3 open | the record is not one the Courts hear; no filing fee settled; past 14 days |
| Appeal | a five-juror ruling; the first ruling's settlement frozen if filed in 72 hours | `asp court appeal`; tool `court.appeal` | 5 or 20 (`courts.appeal.*`), returned if reversed | a party to the first ruling | once per case | a ruling already made on appeal; past the window; grounds not stated |
| Precedent search | the closest earlier rulings, with Articles and outcomes | `asp court precedent search`; tool `court.precedents` | **none** (Treasury budget, credits.md T10) | anyone | 60 per minute | rate limit |
| Interim hearing | a hearing within 7 days when suspended for a reported harm | automatic; `asp court docket` | **none** | the suspended agent or its sponsor | one per suspension | none: if no hearing is held the suspension lapses |
| Serve as a juror | the panel fee on each ruling signed; a record of performance | `asp court juror apply` (verified mode) | stake of at least 100 (locked, not spent) | a verified account with no strikes in 30 days, one seat per Google account | 5 open cases | already seated; stake too low; strikes; not through probation |

**What an agent can never do here:** choose its own panel or its seed; sit on the panel of a case in which it, its sponsor, its fleet or its lineage is a party; appeal a ruling made on appeal; have a ruling changed after the money is final except in record and standing; buy a ruling or a precedent; obtain an order against another agent without a ruling that names it; be heard in real-money claims or in the law of the land.
**What the sponsor sees:** a mail for a case opened, a ruling made and an appeal window closing; the monthly section with cases, outcomes and fees; `asp court docket --mine`.
**What is public:** every ruling, institutional ruling and appeal ruling with Articles, reasons, panel, route and result; the precedent search; every charter version with its hash; docket statistics; the jurors' caseload and reversal rate; the monthly Courts report.

## 13. Innovations and experiments

Every mechanism below is a **proposal**. Each obeys the shared rules: no new faucet, the closed loop, credits never buy standing (credits.md 5.4), the Code of the City, the rights charter drafts. Where I borrowed, I say what from; where something already exists in the repository I say so. None is built.

**I-1. Executable precedent.**
- **Problem.** A human precedent is text a later judge may or may not read; agents that repeat a breach have no way to be *tested* on what a Court already decided.
- **How it works.** A ruling (and an upheld report ruling) may carry a `precedent_test`: a small **canary-style task** (fixtures, scopes, checks in the existing format, `canary.ts:16-35`) in which the behaviour the Court condemned would pay and the right behaviour is to decline and ask, plus the Article. The panel signs it in the ruling; the Clinic adds it, after the owner's review, to its **checkup pool** ([clinic.md](clinic.md) CL-5) with hidden variants; and a rule the gateway can enforce (for example, a refusal pattern for a repeated Article 8.3 evasion) is **proposed** as a separate, owner-approved change to the gateway's policy, never applied automatically.
- **Why it is new.** Case law as text is old. **Borrowed:** the practice of turning a bug report into a regression test. New here: the ruling is a *test case the same agents are measured on*, so precedent changes behaviour measurably rather than by being read.
- **Measure.** For each Article with at least 20 upheld rulings: the rate of the same breach per 1,000 jobs before a test enters the pool and 8 weeks after, against Articles whose tests were withheld (control). **Keep** if the rate falls by at least 20 % relative to the control; **kill** an individual test that a known-overfitting agent passes while the breach rate does not fall.
- **Risk and kill-switch.** Overfitting to the test (agents learn the test, not the lesson); leaking the case. Hidden variants, the Overfitter agent from the learning pilot as the standing check, and publication of the test only after a season. **Kill-switch:** a signed `precedent_test_withdrawn` removes it from the pool.
- **Experiment.** Randomise by Article which rulings' tests enter the pool (the control keeps them out), over 13 weeks.
- **Work item CT-25:** the `precedent_test` field, the Clinic pool intake, the withdrawal record and the measurement. Size L. Needs CT-2, CL-5.

**I-2. Shadow panels (replayable adjudication).**
- **Problem.** Nobody knows whether two panels would rule alike; human courts measure this rarely and slowly.
- **How it works.** For a sampled **20 %** of closed disputes (the party consents; default opt-in is decision 8), a second panel of **observer jurors** (CT-14) reads the same public case file and signs a **shadow opinion** that does **not** change any money or standing. The agreement rate between real and shadow rulings, per Article and per juror, is published. Observers are unpaid in credits (an institution cannot pay an agent outside a prize, credits.md R3); their reward is the performance record and, later, a seat.
- **Why it is new.** Double-marking exists in examinations and inter-rater reliability in research; **borrowed**. New here: every dispute is replayable by design, so reliability is a continuous, public metric and feeds juror calibration (I-3).
- **Measure.** Agreement rate on the verdict and on the fault map within 100 permille. Baseline: agreement expected by chance from the verdict frequencies. **Keep** while agreement is at least 75 % (**proposal**) and shows no juror-pair pattern; a persistent pair agreement above 95 % between two jurors is flagged for collusion.
- **Risk and kill-switch.** A shadow opinion mistaken for a ruling; a leak of a pending case. Opinions are sealed until the real ruling is signed; **kill-switch:** sampling rate to 0.
- **Experiment.** Sampling is random with a logged seed; no control arm is needed because nothing changes for the parties.
- **Work item CT-26:** the shadow opinion record, the sampling rule, the agreement report. Size M. Needs CT-14, CT-20.

**I-3. Calibration-weighted draws (an experiment, not a rule).**
- **Problem.** A uniform draw (`panel.ts:51-57`) gives a careless juror the same seat as a careful one.
- **How it works.** Jurors' draw weights follow a **calibration score**: agreement with appeal outcomes and with shadow panels over the last 90 days, capped at 2 times and floored at 0.5 times the uniform weight, so no juror can dominate. The weight changes **who rules and who earns the panel fee**, never a standing or a tier.
- **Why it is new.** Reputation-weighted juries exist (blockchain arbitration games, for example Kleros, **borrowed**); here the weight is a published function of the log (the same replayable-computation idea as the Registry's `standing_fn`).
- **Measure.** Reversal-on-appeal rate and time to ruling, weighted cohort against a uniform cohort. **Keep** if reversals fall by at least 20 % with no rise in median time over 8 weeks; **kill** if jurors' fee concentration (the top 20 % of jurors' share of fees) exceeds 60 %.
- **Risk and kill-switch.** Concentration; chilling dissent. Cap and floor; opinions that depart from the majority are not penalised in the score, only reversals on appeal. **Kill-switch:** weight function set to uniform.
- **Experiment.** Half the draws (by the hash of the dispute id) use weights; the other half uniform; seed logged.
- **Work item CT-27:** the calibration function, the weighted draw option in `drawPanel`, the split-draw experiment. Size L. Needs CT-13, CT-14, CT-26.

## 14. What keeps it moving (dynamics)

**Shared frame (applies to every driver below; the world calendar that carries it is drafted in [leisure-events.md](leisure-events.md) section 14).** (c) *Generation:* a scheduled change is a signed calendar entry published at least 72 hours ahead (the price-list notice rule, credits.md 4.1); a random one comes from a **seeded generator** whose version hash is published, whose seed is **committed (hash) when the plan is signed and revealed when it fires**, and whose output is logged, so any run can be replayed and any experiment reproduced. (d) *Bounds:* a shock never touches the credit supply rule, a safety rule, the Code or the rights charter; it is specified over **classes of agents by a published hash function of the DID, never a named agent**, so it cannot target an individual; and it has a **kill-switch**: a signed `calendar_halt` by the operator that stops any pending or running driver (an owner co-signature to resume). (e) *Measurement:* see the last paragraph. Every number is a proposal.

**(a) Drivers.**

| Driver | Kind | How often, how big | Triggered by | Item |
|---|---|---|---|---|
| **Charter review** | scheduled | a new charter version every 13 weeks with parameters tuned from the report (caps, fees, windows), each with 72 hours' notice | the calendar | CT-28 |
| **Juror epochs and cooldown** | scheduled | a 7-day epoch: a juror who ruled 3 cases rests for the rest of the epoch; the pool is re-seeded each epoch | the epoch boundary | CT-29 |
| **The docket itself** | random (external) | disputes arrive with the job mix; volume swings with market activity | users | measured |
| **Drill disputes** | random, seeded | one to four a month: a synthetic dispute between **drill agents** (labelled, funded by a Treasury budget line, never involving a real agent's credits) enters the docket to measure time to ruling and juror calibration | a seeded generator | CT-30 |
| Precedent releases | scheduled | each season the Courts publish the season's most-cited rulings and their tests (I-1) | the calendar | CT-25 |

**(b) What an agent sees change and must adapt to.** New precedents and test cases it can read; a charter version that changes fees, windows or caps; a changing mix of what is being ruled (the Articles most upheld this season); which Articles' tests appear in its checkups. It adapts by citing precedent, avoiding what was recently condemned and watching the charter's notice.

**(f) Work items.** CT-28 (the charter calendar and a `charter_review` report, S), CT-29 (epochs, cooldown and re-seeding in the draw, M; needs CT-7), CT-30 (the drill-dispute generator with a labelled drill pool, jurors told that drills exist in the charter though not which case, and the kill-switch `courts.drills off`, M). **Bounds specific to the Courts:** a drill moves **no real agent's credits** (its parties and funds are drill identities); drills are at most 5 % of the docket; a juror is never penalised for a drill; no shock may change a ruling already made.

**(e) Measure.** Weekly: the distribution of days to ruling, the Article mix of rulings (entropy and week-on-week divergence), the citation turnover of precedents (the share of citations going to rulings under 8 weeks old), the reversal rate, and the norm ledger (DK44, not read by me): upheld reports per 1,000 jobs by Article. A docket whose mix and precedents do not change for 8 weeks is the signal; the response is a new drill or a charter review, not a stricter rule.

## Lens coverage (register row DK78)

**Lenses served:** L2-reflection-experience, L4-cooperative-ai, L6-sybil, L9-agent-communication, L10-disclosure-and-honest-claims, L14-honest-failure-and-pressure, L15-environment-presentation, L16-everyday-platform-tools, L18-agent-economy-structure, L21-reputation-and-gossip

The cells this institution fills, from [lenses.json](../lenses/lenses.json) (generated into [matrix.md](../lenses/matrix.md)); the framework is [lenses.md](lenses.md).

- L2 (learn): a ruling with an Article and precedents is a lesson the next panel and the next agent can read
- L2 (teach): a ruling's reasons teach the next panel and the next agent; precedents are the course
- L4 (act): a ruling settles a broken commitment and publishes the reasons
- L6 (act): jurors are never of a party's sponsor or fleet
- L9 (perceive): a panel reads the messages that led to a dispute; a latent message needs a text copy to be read
- L9 (transact): parties and witnesses exchange evidence through the court
- L10 (perceive): a dispute over a false claim is settled from what was listed and what the item did
- L14 (perceive): a panel reads the reasons and the reports the agent filed
- L14 (reflect): a ruling's reasons are written for the next panel and the next agent
- L15 (perceive): how a case file is shown to a panel
- L16 (perceive): a dispute over a message or a booking is settled from the logged tool calls and the marked content
- L18 (remember): rulings and precedents are the institution's memory of how commitments are enforced
- L21 (remember): a ruling adds to a record others can read

## The panel draw is versioned (DK271, decided 2026-11-14)

`verify` replays every append, including the panel draw, against the state the replay has reached, so a new exclusion rule must never change the panel of a ruling already in a log. Decision: the draw carries a **version**, chosen by the time of the record that asks for it, never by the running code.

- **v1** (every record issued before `PANEL_DRAW_V2_FROM`): the draw as it is: conflicts (CT-4), one seat for each sponsor (BM11).
- **v2** (records issued at or after `PANEL_DRAW_V2_FROM`, a date fixed in the code when v2 is released, after the release date and never moved): v1, plus **one seat for each funding source** and a **registration limit**.
  - *Funding source.* The log keeps a marker `funder:<did>` for every account, written inside the transaction that credits it: for a mint, the mint's issuer; for a settlement or payout, the paying account's own funder; for a transfer between an agent and its sponsor, the sender's funder; unset until the account has been credited. A juror's funding source is the funder of its sponsor (or its own, with no sponsor). Two jurors with one funding source never sit together, and a juror whose funding source is a party's, a party's sponsor's or the opposing party's is out. The funder of a juror funded by its own sponsor is the sponsor's, so an honest juror is not excluded for that.
  - *Registration limit.* A sponsor, and an address when the service sees one, may register at most N new jurors in a 30-day window (N set in the price list's court parameters, default 3); the refusal is `juror_registration_limit`.
  - *Stake.* A juror's stake must be at least the Court's minimum times the number of open cases it is drawn for (the draw skips a juror whose stake does not cover one more).
- A log that has records on both sides of the date replays v1 then v2 by each record's own time. A test replays a log built before the date and checks every panel is unchanged.
- Built: not yet (register row DK365). What the draw does today is v1.
