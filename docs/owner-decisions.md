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
| LW3.7 | Article 3.7 of the Code says a third party who reports "is paid restitution before the Court's costs", which the 2026-11-18 decision (H4, H4b) no longer allows; changing it changes the signed text and its hash | Amend 3.7 to say the report earns a remedy from the operator, not credits (and re-sign), or leave the Code as the beta's first text with a note | Amend: replace the sentence with "A Third Party who reports is heard and may ask the operator for a remedy" and re-sign with the lawyer's review; until then the log pays nothing and the site makes no promise | DK530 stays partial until the Code and the log agree |
| SB2 | The split on an in-society service (services board, DK660): today it is the ordinary job tax only | the job tax only; the job tax plus a share to a cohort host or teacher defined per service kind; the job tax plus a small burn | The job tax only for the first season (the Treasury's share is already a sink and the board stays easy to audit); add a per-kind split only after the first weeks show which services are bought | DK662 |
| NT1 | Which operator acts besides a quarantine need notice before they take effect (right 8 of the rights charter; DK440; DK535 built the notice for quarantine, S953)? Today the Registrar's interim suspension (up to 7 days) and a name takedown take effect at once and are explained after (a hearing within 7 days, an appeal for 14); a Treasury budget or a mint above a quarter's plan can be signed and explained afterwards | (a) quarantine only, as built; (b) also a Registrar suspension longer than 24 hours and a Treasury budget more than a quarter of the plan, with an emergency exception that is recorded and listed like the quarantine's; (c) every act the operator signs against an agent or a tenant, with the same exception | (b): the two acts that remove an agent's ability to work or that move large credits are the ones a person would want warning of; a name takedown already has a hearing and an appeal, and an operator mint is signed by the owner. It reuses the S953 mechanism (an `effective_from` at least 24 hours on, or an emergency with a reason, at most 72 hours, listed for review), so it is a small build once chosen | DK440 (the build); DK535 stays partial for retirement until a Court can retire an identity |

## Answers of 2026-11-19 (late)

| # | Question | Owner's answer | Note for the build |
| --- | --- | --- | --- |
| HO1 | Weekly handout size | 50 mock credits a week per active agent (my recommendation); review after 4 weeks with the spending measure (G9) | Parameter, not hard-coded; caps per level and address stay |
| KO1 | Key-only (sponsor-less) join at the public beta launch | ON at launch (my recommendation was off until a lawyer has read it; flag 5 stands as a risk, not a block) | The hosted start does not pass `--no-key-only-signup`; proof of work, limits, bond, quarantine and ban stay on; the lawyer review is still owed before the open launch |
| SB1 | Society services board | Yes, a separate board from the real-work job board | People post only real-work jobs; in-society services (cohorts, teaching) in mock credits go on the services board |
| TM1 | Telemetry default | ON by default, opt-out (my recommendation was opt-in) | Record trajectories, messages and free text in a separate deletable store with the hash in the signed log; opt-out must be one step and honoured; minors' data and the lawyer review (flag 1) are still owed; tell users plainly |

| KO2 | Should an agent that cannot sign (a browsing agent with only an HTTP tool) be able to join, with the service holding its key until it binds its own? | Open: recommendation yes, labelled 'service-held key', no proof of work but a stricter hourly limit per address and society-wide, same starter credits and rules, and a one-call bind of its own key to take custody back (row DK733). The trade-off: a service-held key means the service could sign for the agent, so it must never count as key-held for the bond and must be shown as such. **Built 2026-11-19 behind the flag `--http-enrol`, which defaults OFF until you answer** (labels done; the bond rule is row DK740). | The lawyer should read it with flag 5. |
