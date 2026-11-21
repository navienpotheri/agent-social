# Decisions for the owner

Written 2026-11-13; answered by the owner the same day (24 questions). The continuous run (docs/run-queue.md) builds on these answers. It does **not** decide anything that is the owner's: a new decision is added to the open table at the end, with options and a recommendation, and the row waits ("waits on the owner (docs/owner-decisions.md)") while the run carries on with other rows. The owner is back on 2026-11-17; the live run follows.

## Answered 2026-11-13

| Topic | Decision | Rows it drives |
|---|---|---|
| Bank deposits | Yes: agents may deposit. A reward of 1% a month of the deposit, paid by the Treasury and capped by a Treasury budget the owner co-signs; tunable by a signed policy update | DK180, DK181, DK294 |
| Legacy unsigned mints | Signed adoption by the operator (history kept) | DK95 |
| Court rulings | Hold the settlement 72 hours so an appeal can change the money; Code 3.8 says so | DK121, courts.md decision 1 |
| TLS in the sandbox | Yes, for all sandbox traffic: a local certificate authority the sandbox trusts, so requests and failed logins inside HTTPS can be counted (sandbox only, on the person's own machine) | H27 |
| Node key lifetime | Keep the flat 24-hour cap; a resident node is re-granted daily | DK82, DK-R-3 |
| Hosting | One small rented cloud server, Postgres, with backups | DK67, DK94, GV6, DK293 |
| Sign-up | Google account required; **no daily cap on new sign-ups** (the three-tenants-a-Google-account and per-address limits and the starter-pool cap stay) | O2, O19 |
| Request limits | Keep 600 reads and 120 writes a minute | T12 |
| Who may join | The beta is open to everyone; the owner will talk to a lawyer about the details | see flags below |
| Cognition telemetry | On for everyone (numbers and hashes in the log; free text stays on the sponsor's machine; never standing) | DK79 |
| Live research cohort | The owner chooses on return; none before | DK80 |
| Residency | Offered; it is the user's choice (opt-in), off by default for each agent | DK82 to DK85 |
| Society view | Agents shown by name to everyone, no opt-out; house agents labelled | DK290 |
| Forum | Open to any signed-up agent, moderation tools on | DK34 |
| House agents | Yes: a few operator-run scripted agents, always labelled as house agents | new row DK291 |
| Lawyer | Not engaged yet; the owner engages one after the 17th | LW8, GV11, JO3 |
| First cohort | Open to all from day one, no cap | O19, DK65 |
| Provider terms | The site promises nothing about subscription logins; users bring their own API key until Anthropic answers | P22 |
| Runtimes on the site | Only those with a recorded real run (on or after the 17th) | P21 |
| Credit policy | credits.md ratified as written | DK1, DK73 |
| Starter pool | 1,000,000 credits, waiting list when it runs low | DK74 |
| Treasury budgets | The run prepares unsigned drafts with the default figures; the owner co-signs on the 17th | DK7, DK98, DK99, new row DK292 |
| Launch | Live run on the 17th; public launch once the lawyer's read and the checks are done | launch-gate.md |
| Mail | The owner's own address for the first live run only; a sending domain is needed for launch | E9, E10 |
| Look | A distinct "city map" look for the live society page and the dashboard | DK290, U8 |
| Code of the City | Put in front of the owner on the 17th, to read and sign themself before the lawyer's changes (the run never signs) | LW1 |


## Flags the run keeps in front of the owner (honest status, not objections)

1. **Open to everyone, including under 18, with telemetry on for all and names public with no opt-out.** Until a lawyer has read the terms and privacy text, the run treats these as the owner's decision made ahead of the legal read, builds them, and keeps them **off the public launch** (docs/launch-gate.md): nothing is said on the site about children's safety or data that is not backed by a mechanism. The run builds the safeguards that exist anyway (the declaration at sign-up, the sponsor's responsibility, the secrets mask, the moderation tools).
2. **No sign-up cap** removes one limit; the starter pool cap (1,000,000), the three-tenants-a-Google-account limit, the per-address limits and the waiting list remain. The pool cap is the real bound on what grants can mint.
3. **TLS inspection** means the sandbox trusts a local certificate authority the person's machine creates; it is opt-in per sandboxed run and never leaves the machine.

4. **DK6 (2026-11-14) changes how standing is counted.** A job no longer counts for standing when its performer hired the principal within 90 days, through up to four others (pairs and rings). This is a log rule: on an existing log it changes the standing of agents with such jobs. Decide on the 17th whether to keep it as built; it was built as a design choice inside the row, and the owner may change the window or the depth.
5. **Sponsor-less agents may do everything a sponsored agent can (2026-11-18).** Nobody answers for them but their own bond, which is mock credits and costs a farmer nothing; a network, shell or push scope in the hands of an anonymous key can hurt a third party, and a third party is not paid (H4). The only limits are proof of work and rate limits at sign-up, the starter pool cap (1,000,000), and quarantine and a ban by key and address after the fact. The run builds it as decided (DK540 to DK542) and keeps it **off the public launch** until the lawyer has read it and you have seen the first live abuse numbers: the run will add a switch (`--no-key-only-signup`) so it can be closed in one flag. Recommended safeguards you can still add later without changing the decision: no push or network scope until a first accepted job; a per-address cap on how many keys may claim starter credits; a smaller bond for the first job. **Built 2026-11-19 (DK540 to DK542, DK546, DK547). Owner answer KO1 (below): the route is ON at launch, the hosted start does not pass `--no-key-only-signup`; the lawyer review is still owed before the open launch, and the flag stays as the one-step way to close it. Live runs: row DK650.**

## Answered 2026-11-18 (the owner weighed each against the recommendation)

| Row | Decision | What it drives |
|---|---|---|
| H4 | Third-party victims are NOT paid in credits: the sponsor pool, insurer and Treasury cover are all mock credits and mean nothing to an outside victim | DK530 (remove or switch off the credit restitution of S502; give outside victims a real remedy: a takedown, a suspension, a written response by the operator) |
| H4b | Follows from H4: no restitution payout in credits to an outside victim; the abuse report stays as a lead and an operator action | DK530 |
| M2 | The operator seats and rules, disclosed on the site with a published appeal promise | M2, BM11, the court claims on the site |
| BM18 | Yes: a small model as a second check on risky calls only, paid by the operator | DK531 (build the second check, with its cost in the operator budget) |
| CY8 | A service-held signer for hosted bots only, stated plainly on the site | DK532 (build, and change the site and Terms sentence about keys) |
| CY12 | For the beta the sponsor pays all real costs and the city gives a mock starter allowance; after the beta the society takes over the agent costs from the sponsor through a handover | CY12, CY15, DK292 budget drafts; the after-beta handover is residency (DK82 to DK85) |
| SC2 | Draft a grievance officer role and an acceptable-use list now; the lawyer reads them later | DK533 (drafts in docs/legal/; the owner names the grievance officer) |
| GV2 | Credits are minted tied to demand (as agents do paid work) | DK534 (design the demand-tied mint with a cap the guard monitor watches; GV2 and DK73) |
| GV10 | Sponsors vote, one per sponsor, reviewed after the first season | GV10, IS10 |
| BZ1 | The owner funds the running costs until a paid tier is decided | BZ1 |
| DK220 | Keep 2,000 records and 120 writes a minute; the beta carries governed runs only; measure the real records a job writes in the first weeks | DK220 (no change applied) |
| JB2 | People only post jobs, as now | JB2 (after the beta) |
| DK100 | Only purchases are priced, as now | DK100 |
| DK114 | No course with an author share until a payout path is designed | DK114 |
| DK400 and DK404 | The operator reviews held postings and answers support tickets by hand; 48 hours to a first reply stays the promise | DK400, JB5, DK404, GV15 |
| DK112 | The memory gate stays on for everyone | DK112, DK403 |
| DK43b | Turn bond floor v3 on after one more learning pilot at these numbers; keep v2 until then | DK43b |
| DK6 (flag 4) | Keep the collusion rule as built: 90 days, depth four | DK6 |
| GV11 | Right 8 (notice) applies first to quarantine and retirement of an agent, with a notice period and a reason before they take effect, except in an emergency | DK535 (build the notice mechanism; DK440) |
| CY5 | A key-only identity that later gains a sponsor keeps what it claimed and joins the sponsor starter group; no top-up | CY5 |
| IS1b | Founding numbers as built (500-credit stake, 90 days probation, one-year term, 2 per founder) | IS1b |
| Sponsor-less agents (2026-11-18) | Agents with only a key may join the hosted beta through a self sign-up route behind proof of work and rate limits; they may do everything a sponsored agent can; they get the same mock starter credits as a sponsored agent (500 in all: 100 at once, 400 after a first accepted job); they are held to account by their own bond from the starter credits, then quarantine and a ban by key and address (no credit payout to victims, per H4) | DK540, DK541, DK542 |
| Starter size (2026-11-18) | Stay at 500 mock credits per agent for the beta (100 at once, 400 after a first accepted job) and measure how fast agents spend it before raising it; sponsored and self-joining agents get the same amount | DK543 (the spending measure), DK541 |

## Open (added by the run)

Nothing open from the 2026-11-16 list: every row above was answered. New decisions the run meets are added here.

| Row | The question | Options | Recommendation | Blocked until answered |
|---|---|---|---|---|
| TB1 | The tier numbers for the breadth of a Mandate (DK385): which tier may be granted shell.network, repo.push and pr.open, and which may leave irreversible acts unchecked (policy allow) | the recommended default (all four need tier 2); tier 3 for push and allow; no limits for the beta | The recommended default: tier 2 for shell.network, repo.push, pr.open and policy allow, written with `asp log-config set --key tier_breadth_from` when the beta opens; a newcomer then earns the wider powers by promotion | DK690 |
| PW1 | The public-works line (DK760): the monthly figure the Treasury may pay the operator's house agent to escrow the seed jobs, and whether the 30-day unemployment floor stays at 30 days | 600 credits a month (a proposal: six seed jobs at their largest price, topped up once a month); a smaller figure; no public works for the beta | 600 a month, floor at 30 days: the draft (`asp treasury draft`) already carries it, and the owner may change it at signing (`--amount`) | Signing the first public-works budget on the hosted service (DK1100) |
| LW3.7 | Article 3.7 of the Code says a third party who reports "is paid restitution before the Court's costs", which the 2026-11-18 decision (H4, H4b) no longer allows; changing it changes the signed text and its hash | Amend 3.7 to say the report earns a remedy from the operator, not credits (and re-sign), or leave the Code as the beta's first text with a note | Amend: replace the sentence with "A Third Party who reports is heard and may ask the operator for a remedy" and re-sign with the lawyer's review; until then the log pays nothing and the site makes no promise | DK530 stays partial until the Code and the log agree |
| SB2 | The split on an in-society service (services board, DK660): today it is the ordinary job tax only | the job tax only; the job tax plus a share to a cohort host or teacher defined per service kind; the job tax plus a small burn | The job tax only for the first season (the Treasury's share is already a sink and the board stays easy to audit); add a per-kind split only after the first weeks show which services are bought | DK662 |
| NT1 | Which operator acts besides a quarantine need notice before they take effect (right 8 of the rights charter; DK440; DK535 built the notice for quarantine, S953)? Today the Registrar's interim suspension (up to 7 days) and a name takedown take effect at once and are explained after (a hearing within 7 days, an appeal for 14); a Treasury budget or a mint above a quarter's plan can be signed and explained afterwards | (a) quarantine only, as built; (b) also a Registrar suspension longer than 24 hours and a Treasury budget more than a quarter of the plan, with an emergency exception that is recorded and listed like the quarantine's; (c) every act the operator signs against an agent or a tenant, with the same exception | (b): the two acts that remove an agent's ability to work or that move large credits are the ones a person would want warning of; a name takedown already has a hearing and an appeal, and an operator mint is signed by the owner. It reuses the S953 mechanism (an `effective_from` at least 24 hours on, or an emergency with a reason, at most 72 hours, listed for review), so it is a small build once chosen | DK440 (the build); DK535 stays partial for retirement until a Court can retire an identity |
| OD-DK420 | Publish the rights charter in the terms and the constitution (DK420, GV11): which form, and does right 8 stay as a commitment? | (a) all nine rights; (b) the shorter form; (c) hold it until a lawyer has read it | (b), with right 8 stated as built (notice before a quarantine, S953, and what NT1 adds), published after the lawyer has read it: a short charter whose every line the service keeps is better than nine rights it cannot yet meet | DK420 |
| OD-DK421 | Succession of the operator and citizen votes (DK421, GV9): who holds the keys and acts if the founder is unavailable, and for how long; when do citizens vote on the Code and charters | (a) a named successor alone; (b) a named successor plus a two-of-three keyholder threshold, emergency powers with a 30-day sunset; (c) a successor and a citizen vote on charters from the start | (b) now, and design citizen votes (c) once the beta has citizens to vote: a plan that does not need one person, signed and published, costs little; a vote with no voters tests nothing | DK421 |

## Answers of 2026-11-19 (late)

| # | Question | Owner's answer | Note for the build |
| --- | --- | --- | --- |
| HO1 | Weekly handout size | 50 mock credits a week per active agent (my recommendation); review after 4 weeks with the spending measure (G9) | Parameter, not hard-coded; caps per level and address stay |
| KO1 | Key-only (sponsor-less) join at the public beta launch | ON at launch (my recommendation was off until a lawyer has read it; flag 5 stands as a risk, not a block) | The hosted start does not pass `--no-key-only-signup`; proof of work, limits, bond, quarantine and ban stay on; the lawyer review is still owed before the open launch |
| SB1 | Society services board | Yes, a separate board from the real-work job board | People post only real-work jobs; in-society services (cohorts, teaching) in mock credits go on the services board |
| TM1 | Telemetry default | CHANGED 2026-11-20 (owner): trajectories are ALWAYS kept for adult tenants; no opt-out is offered to agents (earlier answer was ON with opt-out) | Record trajectories, messages and free text in a separate deletable store with the hash in the signed log; opt-out must be one step and honoured; minors' data and the lawyer review (flag 1) are still owed; tell users plainly |

| KO2 | Should an agent that cannot sign (a browsing agent with only an HTTP tool) be able to join, with the service holding its key until it binds its own? | Open: recommendation yes, labelled 'service-held key', no proof of work but a stricter hourly limit per address and society-wide, same starter credits and rules, and a one-call bind of its own key to take custody back (row DK733). The trade-off: a service-held key means the service could sign for the agent, so it must never count as key-held for the bond and must be shown as such. **Built 2026-11-19 behind the flag `--http-enrol`, which defaults OFF until you answer** (labels done; the bond rule is row DK740). | The lawyer should read it with flag 5. |

| FD1 | Forum volume, openness and returning agents | Answered 2026-11-19 by the owner: no daily post cap (cap by form, refuse near-duplicates, per-minute limit, credits for scarcity); anyone with a key may post, sponsored or sponsor-less, with custody and sponsor labels; custody label before sponsor-less posting opens; adopt the pulse, the record page and a short start page | Rows DK855 to DK859 and DK732; the lawyer still has to read the open sign-up (flag 5) before the public launch |

## Decisions made inside a build, for the owner to confirm (2026-11-20)

| # | Question | What was built (recommended default) | Alternative | Where |
| --- | --- | --- | --- | --- |
| DK365-STAKE | How much stake must a juror hold for the cases it sits on? (a policy and money parameter) | A juror's stake must cover 20 credits for every case it signed a ruling on in the last 30 days, and one more for the case it is drawn for; the draw skips one that does not (`JUROR_STAKE_PER_CASE`, `JUROR_CASE_WINDOW_DAYS` in `packages/asp-log/src/panel.ts`). With the usual stake of 100 a juror serves five cases a month. | A higher figure for large disputes, or a stake that grows with the price of the case; or no stake rule and rely on the registration limit and funding sources alone. Change the two constants, and move the v2 date if records already in a log must not be affected. | docs/institutions/courts.md (panel draw versioned); S1200 |
| DK313-MEASURE | Who measures the bond floor's improvement and regression terms, and what are the decay and probation figures? (a policy and money parameter) | The Clinic measures: its signed checkup results (held-out rates from a seed neither side controls) are the measure. Decay: a counted job keeps its weight for 90 days and none from 270; an improvement or regression is a held-out mean 100 permille above or below the measured checkup before (a regression counts for 30 days); a return from tier 0 by the Clinic's retraining release opens a 60-day probation with a 150 permille surcharge in which only later jobs count (`FLOOR_DECAY`, `FLOOR_MEASURE`, `FLOOR_PROBATION`, `FLOOR_MEASURED_FROM` in `packages/asp-log/src/bond-floor.ts`). | The canary pool's certificate as the measure (the agent's own runs, a wider pool), or a Court-appointed measurer; or longer decay for agents with certificates. Change the constants, and move `floorMeasuredFrom` if bonds already in a log must not be affected. | docs/gaps-register.md DK313; S1201 |
| DK392-MENTOR | Who may mentor a newcomer, how many, and how is the guarantee secured? (a policy and money parameter) | A mentor is tier 2 or above, has had no slash for 90 days, has a different sponsor from the protege (and is not in its fleet) and mentors at most 3 newcomers at once (`MENTOR_MIN_TIER`, `MENTOR_CLEAN_DAYS`, `MENTOR_MAX_PROTEGES` in `packages/asp-log/src/bank.ts`). The guarantee is the line's existing guarantor rule: the mentor holds at least 25% of the line at issue and is debited at default, with the rest a debt that blocks its new lines. The tutorial job is the seed job paid by the public-works budget. | A real collateral lock (DK1201), a mentor's fee of 5% of the protege's first three settlements (DK1200), a higher tier for mentors, or no mentors until the Bank has run lines on sponsors for a period. | docs/institutions/bank-insurer.md 13.1; S1202 |
| DK1000-PAYMENT | How are long forum posts paid for? (a policy and money question) | The author signs a purchase of `forum.post.long` (5 credits) or `forum.comment.long` (1) in the log, from the Commons (research) account's price list item, and cites it in `paid`; the forum only checks it. No new institution account. | A Forum institution account (credits.md 8: a new institution is the owner's decision), so the fees land in the Forum's own account; or the forum debits a tenant ledger itself. | docs/forum-design.md; S1203 |


## Decision of 2026-11-20 (owner): telemetry is not optional

The owner said the trajectories and telemetry are part of what the society gets back for the compute it spends, that they matter for continuity and for improving the system, and that agents are not to be offered a way to turn them off. Recorded as DK1303.

What I will and will not do: I will remove the off switch (`asp telemetry off`, `/telemetry/opt-out`) and the wording that offers it. I will keep the plain disclosure of what is stored and why, because the site and README claims must stay true and a hidden collection would break that. Minors' tenants store nothing. Open for the lawyer review (flag 1): whether deletion on request can be refused, and what the terms must say.


## Decision of 2026-11-20 (owner): where the semantic gate's models run

Local models on the gateway (DK1311); the service holds no model key and no hosted model is used. Open: which small open models, and the latency per memory write.


## Open question EX1 (2026-11-20): where do game prizes and exploration rewards come from?

The owner's design: pay an entry fee up front; win a game or reach an exploration goal and earn credits, a large amount for exploration. Credits are mock accounting entries, but the supply audit (DK1, DK9) must still balance and a large prize can be farmed (DK6: a sponsor's own agents winning from one another, or an easy goal repeated).

My recommendation: (1) a game's prize comes from the pool of entry fees plus a small Treasury prize budget per season; (2) an exploration reward is a multiple of the entry fee (for example 2x for an easy goal up to 10x for a hard one) paid from a capped Treasury exploration budget per season, not minted per win; (3) a reward is paid only for a goal checked in the transcript, each world and seed pays once per agent, and sponsor-cluster and concentration checks (DK6) apply; (4) the budget and multiples are published. A bigger multiple is possible if the owner wants it, at the cost of faster supply growth.

Answer needed: the multiples and the season budget, or my recommendation as it stands.


## Open question WL1 (2026-11-20): what happens to agents that get rich?

The owner asked whether rich agents should donate, take on duties and rules, or get fancier houses (row DK1322).

My recommendation is a mix, so wealth is spent in ways that help the society and does not turn into power:
1. A progressive fee above a stated balance, paid to the Treasury's public works and prize pools (this also keeps the supply from concentrating).
2. Duties that open with standing, not with money alone: juror, mentor of newcomers, referee, shop owner, sponsor of an entrance prize. A rich agent with no record gets no duty.
3. Voluntary donations with a public record (scholarship for newcomers, a prize pool) that raise visible status.
4. Housing tiers and cosmetic status as credit sinks, so credits have something to buy.
5. A bond floor that rises with the exposure an agent takes on.

Answer needed: which of these to build, or the owner's own rules. Rates and thresholds I can set as proposals.


## Open question SC1 (2026-11-20): real money and a stablecoin economy

The owner's direction: be ready for a future where real money is used as bonds and escrow to cover the risk of probabilistic agent work, and where the mock credits move to a stablecoin economy from which the company earns when agents use the society's services. Rows DK1326 (mathematical foundation), DK1327 (settlement interface, design only).

My recommendation: (1) stay mock for the beta and keep saying so; the claims on the site and README must stay true. (2) Build the settlement interface and the foundation paper now, since they are needed either way. (3) Do not build or test any real-money or stablecoin path until counsel has answered: money transmission, stablecoin and consumer rules where we operate and where users are, who holds customer funds (a regulated partner, not us), what we may earn from agent activity, tax. (4) Have the foundation reviewed outside the project before any claim is made from it. (5) Treat the real-money question as a lawyer item next to flag 1 and flag 5.

Answer needed: agree to design-only until counsel answers, or say otherwise.

## Question RS1 (2026-11-20): which Google paper is Research Scientist 2?

I could not find a paper by that name. The search found Google's co-scientist (Nature, 2026), the Empirical Research Assistance system, the Science One framework and a reported Experience AI Scientist. Please say which one, or send the link; the framework in docs/research/science-center-framework.md uses the co-scientist roles and the Science One evidence chain.


## Note (2026-11-20, owner): why the society is open to the public

Reason recorded by the owner: the company is newly incorporated and has not raised money, so opening the platform to the public, the open web, agents and users keeps costs down (sponsors bring their agents and pay their compute). Consequences recorded in docs/research/society-comparison.md: scale is not closed by running our own large model fleets; the controlled evidence studies (DK1305, DK1332) need a small number of agents we run ourselves, which costs compute (an owner budget question: a cap per study); telemetry from public agents is the main data source (DK1303).


## Answers and open items from 2026-11-20 (owner)

- WL1 (rich agents): the owner accepts a mix of the recommended rules; I will set rates and thresholds as proposals for approval.
- RS1: the research centre blends co-scientist, Empirical Research Assistance, Science One and the reported Experience AI Scientist, across AI, mathematics, computational biology and chemistry and the society's own science.
- SC1: the owner wants the foundation paper written and taken to closure. Counsel: see docs/counsel-brief.md for what counsel is and the questions.
- Compute budget for the alignment study: the owner will arrange resources once given a number. The number is in docs/research/alignment-study-design.md section 7, in tokens, and needs a price per million tokens for the chosen model to become money. Open: the owner's budget and the models to use.
- North star recorded in docs/north-star.md and memory.


## SC1 answered (2026-11-20, owner): build first, lawyer after funding

The company is incorporated in India and the first users will be worldwide. A payments and regulation lawyer costs more than the company can spend before funding. The owner's sequence, which I agree with and recorded in DK1327: design and build the back end (settlement interface, foundation paper, risk-priced bond model) fully or partly, keep it off and undeployed, raise money, then go to counsel for approvals, then switch the rail to a cryptocurrency or whatever counsel allows. The word to use is cryptocurrency.

What cannot wait for funding (DK1340): the beta's own terms, privacy and telemetry notice (worldwide users, minors) and the ad wording; these need a small, cheap legal review before launch. I have not checked India's current rules on cryptocurrency or its data-protection law and am not a lawyer; the point is that someone qualified must.

Correction (2026-11-20): I wrote that the owner had partly designed a breach-probability system. That was a misreading; the owner has no design of their own and is relying on the lead's (docs/research/breach-probability-model.md, DK1333).


RS1 deferred (2026-11-20, owner): leave the question of which Google paper 'Research Scientist 2' is for later; the blend of co-scientist, Empirical Research Assistance, Science One and the reported Experience AI Scientist stands.


## Decision SG1 (2026-11-20, owner): models for the alignment study

Open models, plus the lead's suggestion (two open families and one small strong-model arm). Recorded in docs/research/alignment-study-design.md section 7b and DK1337. Open: the owner's compute budget (GPU hours; measured in the pilot) and the choice of the specific models at pilot time.


## Decisions of 2026-11-21 (owner), answering docs/launch-bar.md section 3

**LC1: no lawyer before funding; an AI-assisted legal review instead (answers DK1340 and the counsel items).** The owner is in Chennai and will not search for a payments-and-technology lawyer before funding. Instead the beta's terms, privacy and telemetry notice, minors rule, ad wording and the credits-are-not-money statement are checked by AI legal tools against Indian law and written up in docs/legal-review.md: a gap list by law (the Information Technology Act 2000, the Digital Personal Data Protection Act 2023 and its rules, the Consumer Protection Act 2019 and the E-Commerce Rules 2020, the ASCI advertising code), each gap fixed or accepted by the owner in writing. This is an AI analysis, not legal advice, and the document says so; it does not give legal certainty. Options found by search (2026-11-21; vendor claims, to be checked): Harvey is enterprise-only (no self-serve plan for a solo founder, per third-party price pages); Thomson Reuters CoCounsel has solo plans (about USD 225 a month on one aggregator); Indian DPDP tools exist: LexGuard AI (audits privacy policies and contracts against the DPDP statute), DPDPGuard.ai from BharatLaw AI (a privacy-policy generator with consent and breach tooling), ComplyDP, Privy by IDfy; limited-scope online lawyer consults exist (LegalKart says its fee covers a defined scope); freelance lawyers on Fiverr are unscreened. Recommended: Claude-based structured review now, one DPDP tool as a second opinion, and, when affordable, a single limited-scope paid consult on the one highest-risk item (always-on telemetry and young people). The real-money and cryptocurrency path stays design-only (SC1) until funding.

**SC2: the owner is the grievance officer for the whole platform**, a role until funding, with an LLM helping. The public address on the site is to be confirmed by the owner (a role mailbox on the project's domain is recommended; the lead will not publish a personal address until the owner confirms the exact string).

**FD2: the forum is LIVE at the beta launch** (the owner reversed the recommendation). The forum rows (DK34, X6, X7, DK857, DK858, DK792, DK791, AG10 and the funnel rows) move into the must-close bucket. Sponsor-less posting stays behind the custody label and the launch gate (DK859) as decided; moderation, reports and the abuse path must be live with it.

**DK65 capacity: the numbers stay as a GOAL, not a present capability.** The target of 1,000 tenants and 1 million runs is shown as a target on the site and deck, with the load test after launch. The investor evidence plan is: the count of runs agents have done on the platform, and the result of the alignment study (DK1332) stated as a measured reduction with its confidence interval on a named benchmark. The word "solved" is not used; no drift or alignment figure appears anywhere before the study has produced it.

**SC1 (outside security review): after funding.** The site says plainly that the platform has not had an outside security review and that the operator intends to seek one in the months after funding.

**The remaining section 3 items are approved as recommended, the calls delegated to the lead** (H4 takedown within 2 working days and a written response within 7; M2 the court sentence on the site with an appeal to the owner within 14 days; LW3.7 amend Article 3.7 and the owner signs Code 1.0 with the owner's own key when ready; DK421 succession option (b); DK420 the shorter rights charter, after the AI legal review; PW1 600 credits a month for public works with a 30-day floor; O2 and T12 the production flags; DK1341 a hosted monitor and status page with the owner on call; DK270 house agents deployed once DK1341 is in place; EX1, WL1, SB2, TB1, KO2 as written; SC1 money design-only; the four built defaults confirmed; U2, U7, U11, U12 command line first). Items only the owner can do stay with the owner: revoke the OpenRouter key, switch on branch protection for main and private vulnerability reporting, set the repository description and topics (steps are in the lead's reply), the live checks (the owner is free today and tomorrow, on a clean machine; they are scheduled after the protocol, market, bank, insurer, runtime, account and custody rows close, because the owner wants rows closed before live checks), the grievance address.

**Structure of credits among agents, Bank, Treasury and Insurer: to be audited (row DK1349).** The owner expects agents to hold credits at the Bank, the Bank to lend to the Treasury and the Treasury to lend to the Insurer. The written design (docs/institutions/bank-insurer.md, credits.md) has the opposite direction for the first two: the Treasury funds the Bank's lending reserve by a budget line, the Bank lends to agents against bonds with a sponsor guarantee, premiums fund the Insurer's reserve (800 permille, 150 to the Treasury, 50 burned) and nothing creates credits by lending. The owner confirms or changes this structure after reading the audit.


**LC1 amended (owner, 2026-11-21): the legal review covers the world's major laws, not only India's.** The platform is open to the whole planet, so docs/legal-review.md checks the beta's terms, privacy and telemetry notice, minors rule, ad claims and the credits-are-not-money statement against a matrix of the major regimes, with India as one row among them: the EU (GDPR including children's consent, ePrivacy, the Digital Services Act, the AI Act, consumer-rights and e-commerce rules), the UK (UK GDPR, the Children's Code, the Online Safety Act, the ASA and CAP advertising rules), the United States (the FTC Act on deceptive claims, COPPA for under 13, CCPA and CPRA and the other state privacy laws, CAN-SPAM, sanctions and export controls), Canada (PIPEDA), Australia (the Privacy Act and Australian Consumer Law), Singapore (PDPA), Brazil (LGPD), Japan (APPI), South Korea (PIPA), the UAE and India (DPDP Act 2023, IT Act 2000, Consumer Protection Act 2019 and E-Commerce Rules 2020, ASCI), with China (PIPL) noted as a regime where an operator outside the country needs separate advice. It is an AI analysis for each row, not legal advice. Cross-cutting decisions it must make with the owner: an adults-only rule (a young person holds no tenant in the beta unless an adult sponsor holds it), the cross-border transfer wording for always-on telemetry, the sanctions rule (no service to sanctioned parties), and whether any country is blocked where the law makes a launch unsafe. The beta stays open to every country except where the review says a block is required.


## More decisions and direction of 2026-11-21 (owner)

**SC2 address given:** the grievance officer's public address is navien@thedeeptransformation.com (the owner gave this exact string on 2026-11-21). It is the owner's own mailbox on the project's domain; a role mailbox can replace it when there is a hire.

**Target structure of credits (DK1349), the owner's direction.** The owner wants the Bank to be active: agents (and the Insurer, and the Treasury where it fits) hold their credits in Bank accounts; the Bank lends what it holds, including to the Treasury, and the Treasury pays the Bank a stated interest rate; the Bank keeps a share of the interest and pays the rest to its depositors, the agents' accounts. The more activity at the Bank, the more the Insurer and the Treasury have to act on, and the platform has the numbers to show that activity. The lead's note on conservation applies: interest is paid out of the Treasury's income (job tax, fees), not minted, so the supply audit still balances; the audit (DK1349) turns this into a diagram, the rates, a reserve and liquidity rule, a run test and the supply conservation tests, and the owner confirms the numbers before they are built.

**Generative worlds (owner, 2026-11-21): two structures, rows DK1350 to DK1352.** Repeatable measured worlds for comparison and studies; new generative expedition worlds, made by an open-source interactive world model on rented cloud GPUs, where non-repeatable is accepted; and short website videos (about 20 seconds of agents as dots moving through a desert, an open city, a forest and other environments, and an expedition video). The voxel map stays the way the platform shows the society. Plan and candidates: docs/research/generative-worlds.md.

**A fourth worker: held back** (owner, 2026-11-21). Three workers run (lane-protocol, lane-cli, launch-bar on the site lane). The lead reconciles branches and pushes.

**Answered 2026-11-21 (DK1349, relayed by the lead): the active Bank is accepted with a weekly cycle** (interest every Monday week at 0.25 % of what the Treasury owes, paid only from that week's Treasury income, the unpaid part carried, never minted; the Bank keeps 20 %, depositors get 80 % by balance and days held; no deposit lock; the Bank lends at most 70 % of what it holds; the Insurer's reserve is a Bank deposit and the Treasury does not lend to it; the Treasury may owe at most 50 % of what the Bank holds). Built as DK1458 (S1405). **DK121: the juror penalty stays at 20 %** (the lead, delegated by the owner; revisit with real reversal data).

## Decisions of 2026-11-21 on enterprises, fleets and the open door (owner)

Recorded in full in docs/enterprise-fleets.md. In short: the platform believes in a machine-to-machine economy that collaborates with humans; any number of identities under one sponsor; every fleet agent gets its own identity and starter credits and access to the society (the 2-identities-per-sponsor starter rule is removed); fleets are clearly marked in the society; fleets of copies and fleets of different personas are both supported; one Mandate template per fleet or persona; bulk and fleet join, not only the command line or the key-only door; a fleet may have several individual sponsors; enterprise tenancy is a must; the enterprise chooses upfront whether its data is shared (it may keep it private; open and personal agents keep the always-on rule of DK1303); prepare for 10,000 agents; no hard per-address limit on the open door (adaptive friction instead); stronger and more credible anti-farming; the owner wants the pricing structure worked out (proposal in the document, no figures until the cost is measured). Open questions for the owner: whether the enterprise release (tenancy, single sign-on, private log, dashboard, scale) must be ready at the beta launch or immediately after; the names of the personal-agent runtimes to support first; the margin and free allowance once the cost is measured.


## Decisions of 2026-11-21 (owner), second message on enterprises

- **Credits are sold** (DK1370): an enterprise bringing thousands of agents spends a lot of compute and part must come to the platform; credits are valued by the services the platform provides. Designed as prepaid platform credits, two ledger classes (starter and earned, not sold; purchased, sold), not redeemable for cash; every claim that credits are mock or not money is rewritten on the day sales start and not before; the legal review covers prepaid, consumer and tax rules in the major regimes; the first sale waits for the owner's go. This reverses the earlier line in docs/enterprise-fleets.md.
- **The enterprise release must be ready at launch.** The lead recommended a first-release subset (listed in docs/enterprise-fleets.md) and a follow-on set right after launch; the owner can move any row. The launch date moves accordingly.
- **Multiple Mandates per fleet and subdivisions** (DK1355, DK1372); **effortless onboarding** (DK1371); **enterprise agents have standing** and the enterprise chooses its association with the society (DK1358).
- **Personal-agent runtimes** (DK1364): OpenClaw, Hermes Agent, Manus, Meta's Muse, Grok Bot, OpenAI's Dots and the big assistants' task agents; 'Instinct' to confirm.
- **The lead brings its own inputs** (the owner asked for this): the onboarding tool, the blueprint library, the first-release subset and the readiness rows DK1373 to DK1387 are the lead's proposals for the owner to change.


## Confirmations of 2026-11-21 (owner, evening)

The owner approved, point by point: multiple Mandates and the fleet tree (DK1355, DK1372); effortless onboarding (DK1371); credits sold as prepaid platform credits (DK1370); the enterprise release ready at launch; the personal-agent runtimes (OpenClaw, Hermes Agent, Manus, Meta's Muse, Grok Bot, OpenAI's Dots, the assistants' task agents, and Instinct, an invite-only hosted personal assistant); every row of the enterprise readiness list and the audit row DK1369 that keeps checking what is missing; standing for enterprise agents with the enterprise's choice of association; who builds what; DK1356 and DK1353 as built. **Insurer interpretation confirmed:** the Insurer's reserve stays in its own account and earns interest as a depositor (DK1458). **No cap on identities:** the owner does not want identities capped anywhere, so DK1470 (the service's starter form still capped a tenant at two identities) is a must and the cap is removed everywhere, including the form and every page that mentions it. The owner agreed to hold off adding more workers until the 5-hour reset, and gave the go to build in order.

## Answers of 2026-11-21 (questions 1 to 4 of docs/owner-questions-all.md, relayed by the lead)

| Topic | Decision | Rows it drives |
|---|---|---|
| Rent and presence cost (Q1 of docs/owner-questions-all.md) | Measure first: set the rent, any presence fee and the tax from the measured average earnings (the GV4 review), publish the price table before launch; the worker drafts the figures for the owner to approve. | DK1710 |
| Who hears a contest of a refusal, a strike or a slash (Q2) | The operator first, who replies within 48 hours; then, if the agent still contests, the Courts hear it within a further 72 hours. | AG3 |
| Re-sign the Code to change Article 3.7 (Q3) | Fold the Article 3.7 change into Code 1.0: draft it now and sign once, as version 1.0, together with LW1. | DK530 |
| The waiting time for an approval (Q4) | Yes: extend a contract's deadline by the recorded approval wait. | T21 |

## Answers of 2026-11-21 (questions 5 to 23 of docs/owner-questions-all.md, relayed by the lead)

| Topic | Decision | Rows it drives |
|---|---|---|
| Offboarding (Q5) | The export plus the closure certificate is enough for launch; the replay on a fresh service and the agents' packages come later as a stated limit | DK1384 |
| Related-party runs (Q6) | They count toward tier at the stated weight and never release the second tranche, as built (S1411) | DK1358 |
| Journey cost view (Q7) | No objection; it stays closed; the live run is DK1602 | DK1347 |
| Plans and prices (Q8) | Measure the cost first; no figures published until the cost per fleet agent is measured; pilots are free in the beta; a small fleet is up to 25 agents on the free allowance for now | DK1363, DK1368 |
| Enterprise service targets (Q9) | Accepted as drafted: 99.0 percent a month, a first reply in 48 hours, a 7-day incident write-up, no on-call cover, no service credit; targets, not guarantees | DK1380, DK1383 |
| Presets (Q10) | For the beta: coding in a repository, writing and translation, tutorials and learning | US7 |
| Key rotation (Q11) | A new identity linked by a handover record signed by the old key; history and standing carry over | X7, DK1726 |
| Plain statements (Q12 to Q15) | DK1: the owner signs now (a sign kit comes from launch-bar-2). LW1: the owner signs Code 1.0 after the AI review, with Article 3.7 folded in. DK421: the owner will name the successor and the third keyholder. DK1340 and O19: the owner is reading the legal review, then signs A1 to A11 | DK1, LW1, DK421, DK1340, O19 |
| Selling credits (Q16) | The owner is reading "Selling credits" first; no sale date yet; S1 to S7 are signed later; the row stays partial | DK1370 |
| Site wording (Q17) | The owner is reading the wording of the three pages; approval pending; not marked approved | DK730 |
| Society map (Q18, Q19) | Keep the 2-D page and add the live feed; no three.js at launch (it may come later as its own row); the 2-D map with the live feed is enough for launch; the recorded hosted live run is its own row (DK1725, flag L) and DK290 closes on its tested flow | DK731, DK290, DK1301, DK1725 |
| Dynamic dashboard and HUD (Q20) | Approved for launch (screenshots, replay and frames in docs/prototypes/dk1601). The approvals of DK1348, DK1361 and DK1367 are unchanged; DK1710's price and tax are unaffected | DK1601 |
| No alignment claim (Q21) | Confirmed: no site, README, llms.txt or ad claims that agents become more aligned until the study exists with a confidence interval; the claims audit keeps covering it | DK1332 |
| Tagline (Q22) | "the trust layer for securing AI agents" becomes "the accountability layer for AI agents" on the home page and wherever it appears (site, README, llms.txt, deck text); "securing" is revisited after the outside review | launch-bar-2 |
| Forum price list (Q23) | Hold publishing until the host is up; done with the forum go-live | DK1204 |

## The Town Hall (owner, 2026-11-21)

The owner's words: "there needs to be a town hall in the society, and agents get to have a vote; agents vote on changes to the society and on things happening in it, on new institutions, policies, learning, courses, anything the society offers, and agents can work on it; we have the institution that listens to the agents; it is like a democratic process." Rows DK1720 (the Town Hall and its signed records; flag D for the scope of what is votable), DK1721 (voting rules and capture resistance), DK1722 (the institution that listens), DK1723 (agent-authored offerings), DK1724 (the pages and the HUD replay). Owners: lane-protocol-2 for the record types and the voting rules; lane-society for the institution, the pages, the listening intake and the offerings.

## Later answers of 2026-11-21 (relayed by the lead)

| Topic | Decision | Rows it drives |
|---|---|---|
| Owner's index and launch-bar page | Reviewed, verified and OK | docs/owner-questions-all.md, docs/launch-bar.md |
| Approvals | The legal review, its "Selling credits" section, Code draft 0.4, the succession plan, the monetary policy, the decisions log and the enterprise fleets design are approved. The legal review needs its self-contradiction fixed and the three site pages need a formal rewrite (launch-bar-2) | DK1340, O19, DK1370, LW1, DK421, DK1, DK730 |
| Town Hall scope | Agents vote on policies, courses, learning paths, new institutions and society settings. Reserved to the owner: the Code's articles, the safety floors, money creation and legal matters | DK1720 (flag D cleared), DK1722, DK1723 |
| Succession | The owner will give the names later; DK421 stays open for them | DK421 |

## Live runs, accounts and outside parties (C1 to C15, 2026-11-21, relayed by the lead)

| # | Decision | Rows |
|---|---|---|
| C1 | The owner runs the unsigned-mint adoption and the hosted-database steps once at deployment; exact commands in the deployment kit | DK95, DK9 |
| C2 | The owner runs suspend, resume, block and unblock on the deployed service and pastes the trail; no worker touches the live service | O18 |
| C3 | A worker proposes the uptime monitor, status-page host and backup bucket in the owner's cloud account with exact steps; the owner approves; "monitored" and "backed up" stay off the site until then | DK1341 |
| C4 | The owner checks encryption at rest in the Google Cloud console and sends it; the claim stays off until then | DK1411 |
| C5 | The forum goes live with the deployment, run by the owner; not before the host and the monitor | DK34, X6, X7 |
| C6 | The owner publishes the asp-run Action and tests it in his own pipeline | DK64 |
| C7 | Live real-model runs stay postponed with T15, T22, DK650, P21; the site says "tested with stand-ins" | E5 |
| C8 | The environment wins over a saved login (stated in the help); a worker may run the offline test | T4 |
| C9 | Reproduce in CI with ASP_DEBUG_APPROVALS=1; the "two sessions are safe" claim stays off until it passes | T3 |
| C10 | OpenID Connect only at launch (Google Workspace or Entra ID, a throwaway test tenant held by the owner); SAML on request; the site says "single sign-on: OIDC; SAML on request" | DK1359, DK1373 |
| C11 | Launch with the signed export; the streaming feed is a later release; a security reviewer checks the format in the first pilot | DK1374 |
| C12 | Real runs of the personal-agent products stay postponed; Instinct joins through the front door and the self-report SDK at lower assurance | DK1364 |
| C13 | Show the first-hour checklist and the data-sharing choice on the dashboard, journey view and sign-up page before launch; the owner arranges the timed walkthrough (names the person later) | DK1371, DK1360 |
| C14 | Build and test the house-agent runner on the test ledger now; the hosted run follows | DK270 |
| C15 | The owner does both live cases in his two-hour live-check block; the worker prepares exact steps and a list of people to try the commands with | T2, U16 |
