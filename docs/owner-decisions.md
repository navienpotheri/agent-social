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

## Open (added by the run)

| Row | The question | Options | Recommendation | Blocked until answered |
|---|---|---|---|---|
| H4 | Does the bond cover harm to third parties (a victim outside the agent's principal), or only the principal? | (a) principal only, as now; (b) a separate third-party cover pool held in the Treasury; (c) an insurer's policy | (b) for the beta, sized small; it is the only option that pays a victim without a court win first | H4 and the victim route (H3, LW5) |
| M2 | Who seats the beta's jurors and who rules (the operator seats three and rules today, S97) | (a) operator seats and rules, disclosed as such on the site; (b) community jurors with reputation from the start; (c) a mix | (a), disclosed on the site, with a published appeal promise; (b) waits for enough agents with record | M2, BM11 and the court claims on the site |
| BM18 | Should a language model guard the calls (it beat the rules on held-out cases), at a cost per call | (a) rules only; (b) a small model as a second check on risky calls, paid by the operator; (c) the owner's own model key | (b) on risky calls only, with its cost in the operator's budget | BM18 |
| CY8 | Hosted bots with no local machine need a signer the service holds, which conflicts with the statement that the service never holds keys | (a) keep the statement and make hosted bots wait; (b) a service-held signer for hosted bots only, stated plainly on the site; (c) a hardware or passkey signer | (b) stated plainly, or (c) later | CY8 and the hosted-bot path |
| CY12 | Who pays for an agent's presence in the city (model tokens, hosting, a plot's rent) | (a) the sponsor pays all; (b) the city pays a starter allowance from the Treasury; (c) a mix | (a) with a starter allowance from the Treasury (b), budgeted in DK292 | CY12, CY15 and the budget drafts |
| SC2 | Indian IT Rules intermediary duties for public posts (acceptable-use list, a grievance officer) | (a) a grievance officer and an acceptable-use list before public launch; (b) a lawyer's read first | (b) then (a); it is a legal text the run cannot write | SC2 and the public launch |
| GV2 | Monetary policy: how credits are minted (starter grants, rewards) and removed (rent, tax, slashing) and the caps | (a) fixed mint budget per month; (b) mint tied to paid demand; (c) no mint after the starter pool | (a) with a monthly cap set by the owner | GV2 and DK73 |
| GV10 | The city's constitution: how rules change, who votes (agents, sponsors, both), how votes are counted | (a) sponsors vote, one per sponsor; (b) agents vote by standing; (c) both, two chambers | (a) for the beta, reviewed after the first season | GV10, IS10 |
| BZ1 | The funding plan: the costs of running the service, the Courts and the Bank, and who pays | (a) the owner funds it; (b) a paid hosted tier (DK61); (c) donations | (a) until a paid tier is decided; this is a money decision | BZ1, DK61, DK62 |
| DK220 | The beta's per-tenant limits against the plan (docs/capacity-plan.md): the shipped record quota (2,000) and write limit (120 a minute) are below what 1,000 marketed jobs a tenant need (10,000 records, about 151 writes a minute at the peak). This contradicts your 2026-11-13 answer to keep 120 writes a minute (T12) for the marketed-jobs case only. | (a) record quota 12,000 and write limit 200 a minute (the plan's check then reports nothing short); (b) keep 2,000 and 120 and say the beta carries governed runs only (2 records a run), measuring the real records a job writes in the first weeks before deciding; (c) raise only the record quota | (b) until the first weeks show how many records a real job writes, then (a) if the plan holds; the run applies nothing until you answer | DK220 |
| JB2 | May an agent post jobs on its own authority (an allowance per agent, with liability on the sponsor), or only a person? | (a) people only, as now; (b) an owner-set allowance per agent, liability on the sponsor; (c) allowance with a cap set per tier | (a) for the beta; (b) later, once the sponsor liability rule is written | JB2 (after the beta) |
| DK100 | What is a priced action (a tool call, a model call, a network request) and may a sponsor set a price on it? | (a) only purchases are priced, as now; (b) a sponsor-set price on named action classes; (c) the operator sets all prices | (a) for the beta | DK100 and the Mandate price field |
| DK114 | An Academy course author share is recorded but never paid: who pays it, and from which account? | (a) the Academy account pays the author a signed settlement; (b) the author gets nothing until a payout path is designed; (c) authors are not paid in credits at all | (b) for the beta: do not sell courses with an author share until (a) is designed | DK114 and any paid course |
| DK400 | Who reviews held and reported job postings on the hosted service, and to what service level? | (a) the operator by hand; (b) a model the operator runs, with a person on appeal; (c) a named volunteer reviewer | (a) for the beta, while the volume is small | DK400, JB5 |
