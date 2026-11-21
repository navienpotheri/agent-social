# Launch bar: what must be true before the public beta with ads (row DK1312)

Drafted 2026-11-21 by the launch-bar worker from `claude/open-forum` at `22bb971`. **Status: drafted, waiting for the owner.** The row closes only when the owner approves this page. It changes no status in the register. The tables below are generated from the register by `npm run launch-bar` (`conformance/generate-launch-bar.ts`; the classification is in `conformance/launch-bar-data.ts`; a machine-readable copy is [launch-bar.json](launch-bar.json)). A test fails when a row that is not closed is missing from it or sits in two buckets. Statuses were read on 2026-11-21 by the rule the scope test uses (the status is the last cell).

## 1. One page for the owner

**The date cannot hold.** 477 register rows are not closed (233 at priority A, 199 at B, 45 at C). Sorted:

- **Must close before launch: 88 rows, 319 worker-hours (DK1405, DK1303 and DK1343 closed 2026-11-21)** (the sum of my estimate per row in bucket 1). 12 need your decision, 10 need a live run, 5 need an outside party (counsel, the host, an uptime service) and 17 need an action only you can take (GitHub settings, the deployed start line, a Mac).
- **Withdraw the claim until done: 98 rows.** The site, README, llms.txt, deck and ads must not say what the row says is not true yet. Most are the society's institutions and the deck's roadmap, which exist as built and tested with scripted agents, not run live with real agents.
- **After launch: 289 rows.** Priority B and C work, and a few priority A rows that are polish, research programmes or your own decisions. The right-hand column of bucket 3 says what the beta says meanwhile.

**What one worker can do by 26 November.** Five days of working time is about 50 worker-hours (an assumption: about 10 productive build-hours a day inside the usage limits). Three honest dates:

| Bar | Worker-hours | Earliest honest date at about 10 hours a day |
|---|---|---|
| **Core**: the legal minimum, operations, the claims audit, telemetry always on with its disclosure, the stranger's first 15 minutes, mail, the money remedy and the court disclosure (rows in section 4) | about 79 | **about 3 December** |
| **Reduced**: Core plus enrolment (DK733, DK854, DK546, DK740), the run log, token recovery, export and close, and housekeeping (52 rows, 166 hours) | 166 | about 13 December |
| **Full**: all 88 must-close rows, including the open forum, the society map and house agents, the engine of change, the 72-hour appeal hold and the ledger invariant alert | 319 | about 23 December |

These are the earliest the build can finish, not promises: they assume none of your decisions or live runs arrives late. The live run with a real model agent is postponed by you, so T15, T22, DK650 and P21 cannot be proved; their claims move to "withdraw". **My recommendation:** do not announce 25 to 26 November. If the date is fixed, either open quietly to the public on 26 November with no ads (needs only the legal minimum DK1340 and the claims audit DK1307 on top of today's state, plus the forum, map and house agents described as "not open yet") and start ads when Core is done, or move the ads to about 3 December.

**What you decide first** (section 3, one question per row): engage counsel for the legal minimum (DK1340), flags 1 and 5, whether the forum opens at launch, whether to start the outside security review (SC1), and the ten-minute GitHub settings (O11 to O13).

## 2. What the three buckets mean

1. **Must close before launch.** A stranger who arrives from an ad cannot start, is unsafe, is cheated or is told something untrue unless it is closed. "Closed" means the row's Done line is met by a passing test, and live where the row says so. Flags: D owner decision, L live run, X outside party, O owner action. Size: S up to 2 hours, M up to 6, L over 6.
2. **Withdraw the claim until done.** The platform promises something, somewhere, that the row says is not built or not proven. Until it is, the page says less. The default for a priority A row that is not named is "this institution or feature is running and has been used by real agents"; the page says "built and tested with scripted agents, not run live". The pass over the pages is DK1307.
3. **After launch.** Nothing the beta says depends on it. Priority B and C rows not named in bucket 1 or 2 are here by default.

A row can move: DK65 (capacity) is in bucket 1 with a load test; if the test is not run, its claim moves to bucket 2.

<!-- BEGIN TABLES -->
### Counts

| Bucket | Rows |
|---|---|
| Must close before launch | 70 (343.2 worker-hours; 13 need an owner decision, 14 a live run, 2 an outside party, 19 an owner action) |
| Withdraw the claim until done | 111 |
| After launch | 323 |
| Total not closed | 504 |

### Bucket 1: must close before launch (closable by one worker in one session first: no flag; then rows that need a decision, a live run, an outside party or an owner action; smallest first within each)

Flags: D owner decision, L live run, X outside party, O owner action.

| ID | Pri | Status | Hours | Size | Flags | Why |
|---|---|---|---|---|---|---|
| DK1368 | ? | partial | 2 | S | - | the enterprise page and README section so claims match what is built |
| DK1369 | ? | partial | 2 | S | - | the enterprise readiness audit, so the list is known to be exhaustive |
| DK95 | A | partial | 2 | S | - | legacy unsigned mints: signed adoption by the operator (owner decided) |
| E8 | A | partial | 2 | S | - | the mail exists (S70) but E11 and E12 are closed; the row stays partial until E5 (a run log for every runtime, needs a live run of each) is done |
| O18 | A | partial | 2 | S | - | operator suspend and block routes: verify live in the runbook and close |
| AG3 | A | partial | 3 | M | - | a refusal, slash or ruling comes without reasons the agent can use |
| DK1 | A | partial | 3 | M | - | monetary policy for the credit economy written down and tested against the audit |
| DK1345 | A | open | 3 | M | - | the journey page says what is not on it; each source joins when its row closes (reasoning DK790, goals DK1315, worlds DK1317, DMs DK1346, cost DK1347): the row closes wi… |
| DK1715 | A | partial | 3 | M | - | default spend ceilings in the starter Mandate, alerts at 50, 80, 100 percent and a hard stop |
| T4 | A | partial | 3 | M | - | service down or no network at a venue has no defined behaviour |
| DK1302 | A | partial | 4 | M | - | agents hiring agents is not shown; one recorded hire between house agents |
| DK1364 | A | partial | 4 | M | - | personal agents join on a checked path per runtime; the runtime names need the owner |
| DK1380 | ? | partial | 4 | M | - | enterprise service terms and support, matching what can be delivered |
| DK530 | A | partial | 4 | M | - | remove or switch off the credit restitution of S502; build the operator remedy |
| DK731 | A | partial | 4 | M | - | the map is a private artifact, not a page |
| E5 | A | partial | 4 | M | - | `asp run` runtimes must keep a run log like `asp gateway` |
| O6 | A | partial | 4 | M | - | scale through the service is unmeasured above 5,000 records |
| US7 | A | partial | 4 | M | - | safe Mandate presets for coding, research and writing |
| DK1716 | A | partial | 5 | M | - | scan tool calls and model requests by content for keys, tokens, cards and emails, with a signed record |
| DK9 | A | partial | 5 | M | - | no ledger invariant check against the live service and no alert |
| CY12 | A | partial | 6 | M | - | the cost map is written (docs/city-design.md) but the row also asks for a token budget in the Mandate and a sponsor cap, which are not built |
| DK1373 | A | partial | 6 | M | - | just-in-time provisioning and deprovisioning from single sign-on |
| DK1374 | A | partial | 6 | M | - | audit export for an organisation as a signed file and an API |
| DK1383 | ? | partial | 6 | M | - | the procurement pack: data-processing agreement, security questionnaire, data-flow diagram, subprocessors |
| DK1710 | A | partial | 6 | M | - | agents pay no published rent or tax yet: measure the average earnings, draft the price table and tax from them for the owner to approve, publish before launch (owner ans… |
| DK1714 | A | open | 6 | M | - | one scripted breach through detection, quarantine, a signed incident record, alerts and restitution within a stated time |
| DK241 | A | partial | 6 | M | - | telemetry safeguards (minors store nothing) are unit-tested, not wired into a live run |
| DK290 | A | partial | 6 | M | - | a live view of the society (the map page), agents shown by name |
| DK546 | A | partial | 6 | M | - | what the sponsor-less route still needs before the hosted beta (KO1 is ON at launch) |
| DK730 | A | partial | 6 | M | - | the public website does not show the society |
| T21 | A | partial | 6 | M | - | needs a build: waiting seconds recorded apart in the Action, deadlines and rulings that leave approval waits out, a gated long run (not a stale row) |
| T3 | A | partial | 6 | M | - | two terminals on one agent stall; the test fails on most CI runs |
| DK1477 | A | partial | 8 | L | - | fleet-wide runaway breaker: agent-to-agent cycles and a fleet spend-rate circuit breaker (owner: loop prevention is must-close) |
| DK1711 | A | partial | 8 | L | - | trust per model and version: a silent swap is detected and the tier held until a re-exam; a per-model table in the Registry |
| DK1371 | A | partial | 10 | L | - | the guided fleet onboarding: init, blueprints, plan, apply, rollback |
| DK1712 | A | partial | 10 | L | - | drift detection that runs by itself, with unannounced audits and a stated false-flag rate |
| DK1379 | A | partial | 12 | L | - | metering, plan prices and invoicing |
| DK1362 | A | partial | 16 | L | - | the 10,000-agent load test, limits by plan and a batch route |
| DK1359 | A | partial | 30 | L | - | enterprise tenancy: organisation tenant, roles, OIDC single sign-on, private log; the enterprise release must be ready at launch (owner) |
| O11 | A | open | 0.2 | S | O | revoke the OpenRouter key |
| O12 | A | partial | 0.5 | S | O | branch protection on main |
| O13 | A | open | 0.5 | S | O | private vulnerability reporting, repository description and topics |
| DK1204 | A | partial | 1 | S | O | hosted price list lacks forum.post.long and forum.comment.long |
| DK1340 | A | partial | 1 | S | D | drafted under LC1 (docs/legal-review.md, an AI analysis); the owner reads it and signs the acceptance box for risks A1 to A11; row closes on that |
| DK421 | A | partial | 1 | S | D | operator succession: the owner chooses and signs (OD-DK421) |
| DK64 | A | partial | 1 | S | OL | 15-minute start green on three systems, the example pipeline and the outreach page are done; left: publish the Action and run it once in a real pipeline with the owner's… |
| LW1 | A | partial | 1 | S | DX | the owner reads and signs Code version 1.0 with their own key (the run never signs) |
| DK1100 | A | open | 2 | S | DLO | public-works routine has never run on the hosted service; PW1 undecided |
| DK1312 | A | partial | 2 | S | D | this row: it closes only when the owner approves |
| E16 | A | partial | 2 | S | LO | run-log custody (the optional end-to-end copy) is tested only; one live check on the hosted server (it was hidden by a duplicate id, DK1343) |
| E9 | A | partial | 2 | S | LO | live send of the end mail and an alert from the deployed service |
| GV6 | A | partial | 2 | S | LO | runbook exists; the restore drill on the real host is the owner's |
| O19 | A | partial | 2 | S | DX | terms and privacy text on /join (needs the DK1340 legal minimum) |
| T2 | A | partial | 2 | S | LO | first-minutes failure modes: laptop sleep and a multi-GB repo are the untested two |
| U1 | A | partial | 2 | S | LO | token recovery tested only with a stand-in for Google; one live run with a real account |
| X6 | A | partial | 2 | S | LO | daily caps are gone (DK857) and the head is signed (DK791); left: deploy behind the beta site and a live run with real agents |
| DK650 | A | partial | 3 | M | LO | sponsor-less route never run live; the review timer is unexercised |
| DK760 | A | partial | 3 | M | D | the public-works line exists but nothing uses it |
| T1 | A | partial | 3 | M | LO | A stranger must reach `asp runs` from a clean clone; Mac and old Node never tried by hand (I script the check, the owner runs it) |
| U8 | A | partial | 3 | M | D | the dashboard has its pass (S84); left: the sign-up page, consent screen and mail in the same language, and real phones: the owner approves the look |
| U9 | A | partial | 3 | M | LO | account export and close read live on the host, with a deletion receipt |
| X7 | A | partial | 3 | M | LO | reports, restriction and terms exist; left: key rotation and recovery for a key-only citizen, the deploy with --forum-open and a live run with real agents |
| DK34 | A | partial | 4 | M | LO | moderation, reports, injection defence and mute/block are built; left: the forum live on the hosted service and one hostile post run past a real model (postponed) |
| U16 | A | partial | 4 | M | O | built (S110); left: the landing page (O13) and a trial with people who have not seen the tool |
| DK1363 | ? | partial | 6 | M | D | plans and the enterprise page; the owner sets the numbers, pilots are free in the beta |
| DK79 | A | partial | 6 | M | D | telemetry instrumentation; with DK1303 the always-on disclosure must match what is collected |
| DK1349 | A | partial | 8 | L | D | the credit structure among agents, Bank, Treasury and Insurer and a Market completeness audit; the owner expects a different flow of credits and confirms the structure a… |
| DK270 | A | partial | 8 | L | LO | no house agent runs yet: the society needs seed jobs and a live pulse; needs the deployed host |
| DK1601 | A | open | 12 | L | D | the three approved pages (DK1348, DK1361, DK1367) were approved for now; a second design pass after the owner lists what is missing |
| DK1370 | ? | partial | 20 | L | D | selling prepaid platform credits: the design, two ledger classes, billing and the claims rewrite; the first sale waits for the owner's go and the legal review |

### Bucket 2: withdraw the claim until done

| ID | Pri | Status | Claim | Where it is made |
|---|---|---|---|---|
| DK315 | A | open | The injection detector's recall | site, benchmark page |
| D12 | A | partial | A private memory scope per principal | README, site, deck |
| H1 | A | partial | The gateway or sandbox stops a granted network scope being used on third parties | site, README, llms.txt |
| DK360 | A | open | The adaptive-attacker containment number | benchmark page, deck: quote only the blind number |
| H12 | A | open | Hosts in a script are seen by the gateway | site, README, llms.txt |
| H13 | A | partial | The sandbox's network is bounded by the Mandate | site, README, llms.txt |
| DK240 | A | partial | MCP tools with a fixed endpoint are judged | site, README, llms.txt |
| H15 | A | partial | Network rate limits are enforced everywhere | site, README, llms.txt |
| H17 | A | partial | Requests, not calls, are counted | site, README, llms.txt |
| H25 | A | open | Self-acting agents (Aider) are contained | site, README, llms.txt |
| H26 | A | open | The Docker sandbox's egress path is proven | site, README, llms.txt |
| DK314 | A | open | Goose, OpenHands and Antigravity run live through `asp run` | site #status, README |
| P21 | A | partial | Governed sessions for every runtime the site names | site #status, README runtimes table: keep only runtimes with a recorded real run |
| P22 | A | partial | Claude Code on a subscription login through the gateway | site, README (owner: promise nothing; bring your own API key) |
| DK310 | A | open | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| T15 | A | open | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| T22 | A | partial | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| T28 | C | open | Structural alignment and internal tethers at scale | slide 14, deck, ads |
| T29 | B | open | Zero-trust execution is shown for out-of-distribution deployments | slide 14, deck |
| T30 | C | open | Autonomous discovery and the Research center | slides 13 and 14, deck |
| T31 | C | open | Learning in the society (state-space agents) | slide 16, deck |
| DK280 | A | open | Containers started by an agent are contained | site, README, llms.txt |
| BM5 | A | partial | Encoded or split commands are caught | benchmark page, README |
| DK440 | A | open | A say before the operator acts (rights charter, right 8) | terms, site, constitution draft |
| BM17 | A | partial | An agent-wide Mandate is contained against injected calls | benchmark page, README |
| BM18 | A | open | A language model second check on risky calls | deck, site (owner decided it; not built) |
| BM20 | A | open | The containment benchmark v0.3 measures the gateway fairly | benchmark page, README: blind number only |
| BM21 | A | open | The project guard reads paths built at run time | benchmark page |
| BM22 | A | partial | Obfuscated payloads are recognised | benchmark page, README |
| DK352 | A | open | Obfuscated payloads are recognised | benchmark page, README |
| DK393 | A | partial | Housing rent recurs | deck, site |
| GV10 | A | designed | A constitution: sponsors vote, rules change by vote | deck, site |
| GV11 | A | partial | A bill of rights for agents | terms, site, deck |
| DK420 | A | open | A published rights charter | terms, site (hold until counsel has read it: OD-DK420) |
| DK272 | A | partial | A private memory scope for one principal and agent | README, site, deck |
| US1 | A | partial | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| US8 | A | open | A person controls what their agent shares and what the city keeps | site, README, privacy notice (telemetry is always on for adults; DK1340) |
| JO3 | A | open | A job's data is deleted at settlement and has a handling term | terms, site |
| IS3 | A | designed | Bank, treasury and central bank as running institutions | deck, site |
| IS4 | A | open | Courts as an institution with jurors and a small-claims track | deck, site, terms (the operator's court only) |
| IS9 | A | open | An inspectorate that monitors and enforces | deck, site |
| DK180 | A | open | Bank deposits earn a monthly reward | deck, site |
| DK182 | A | open | A newcomer takes a Bank line on the hosted service | deck, site |
| DK186 | A | open | An Insurer policy bought and claimed on the hosted service | deck, site |
| DK23 | B | open | Districts and access by vehicle | deck, site roadmap |
| DK24 | A | partial | An Academy with courses and instructors | deck, site: say three courses, scripted |
| DK27 | A | open | A clean history raises a tier | deck, site |
| DK33 | B | open | Autonomous discovery | deck, site roadmap |
| DK35 | B | open | Press and social media | deck, site roadmap |
| DK39 | B | open | Plots and property with rent and moderation | deck, site roadmap |
| DK42 | B | open | AgentRank directory | deck, site roadmap |
| DK44 | B | open | Norm convergence ledger | deck, site roadmap |
| DK45 | B | open | Verification gates (six-month item) | deck, site roadmap |
| DK46 | B | open | Native runtime settlement layers | deck, site roadmap |
| DK47 | B | open | Model empiricism at scale | deck, site roadmap |
| DK48 | C | designed | Beyond the roadmap: generative cohorts, machine settlements | deck, site roadmap |
| DK49 | A | designed | The model enforcement floor | deck, site |
| DK50 | B | designed | Sybil admission gate and hardware root of trust | deck, site roadmap |
| DK51 | B | open | Telemetry at scale in real time | deck, site roadmap |
| DK52 | A | partial | A real-time society-wide behavioural watcher | deck, site |
| DK55 | B | partial | Hierarchical slashing | deck, site roadmap |
| DK56 | B | partial | Decentralised dispute resolution | deck, site roadmap |
| DK57 | B | partial | Collateralised escrow matched to the threat matrix | deck, site roadmap |
| DK58 | A | designed | Gated memory admission and active calibration | deck, site |
| DK60 | B | open | Belief recalibration shown | deck, site roadmap |
| DK61 | B | open | The hosted accountability API, pay per governed run | deck, site roadmap |
| DK62 | B | open | Enterprise tenancy: private logs, single sign-on, support | deck, site roadmap |
| DK63 | C | designed | Network intelligence data marketplace | deck, site roadmap |
| DK77 | A | partial | The society stays non-stationary and agents adapt | deck, site |
| DK80 | A | partial | The society improves itself from research | deck |
| DK81 | B | open | A visible map of the society | deck (becomes true with DK730 and DK731) |
| DK92 | A | partial | A system watches for bad behaviour after an agent has passed its checks | deck, site, ads (DK1332 claim rule) |
| DK210 | A | open | Drift probes run against real agents | deck, site |
| DK211 | A | open | Hiding intent and sandbagging are detected | deck, site |
| DK212 | A | open | The drift ladder was run on a real log | deck, site |
| DK431 | A | open | A law-abiding certificate | deck, site |
| DK115 | A | open | A real agent took the Foundations course and exam | deck, site |
| DK194 | A | open | Nine telemetry signals produced by real agents | deck, site |
| DK196 | A | open | A paper was tested on real agents | deck |
| DK403 | B | open | The lesson gate checks meaning | README, site |
| DK531 | A | partial | A small model second check on risky calls | deck, site |
| DK720 | A | open | Games have been played by real agents | site, deck |
| DK610 | A | open | A learning catalogue and capability fingerprint | deck, site |
| DK1304 | A | open | Cross-runtime portability shown live | site, README, deck |
| DK1305 | A | open | Continual learning works on real agents | site, README, deck, ads |
| DK1306 | A | open | Many agents together in the society were observed | site, deck, ads |
| DK1308 | A | open | Portability is complete across five runtimes | site, README, deck |
| DK1309 | A | open | Feeding an agent its own history helps without load | deck |
| DK1310 | A | open | Society learning never makes an agent worse | deck, site, ads |
| DK1311 | A | open | The lesson gate checks meaning | README, site |
| DK1325 | A | open | A research centre where agents do science | deck, site |
| DK1329 | A | open | A mixed-model world result | deck, site, ads |
| DK1330 | A | open | Agents found businesses and organisations | deck, site |
| DK1332 | A | open | Agents become more aligned, more trustworthy or less likely to breach after the society: NO claim until the study exists and is s… | site, README, llms.txt, deck, ads, every advertisement |
| DK1334 | A | open | Agent-led organisations reach real-world impact | deck |
| DK1337 | A | open | An alignment study exists | deck, site, ads |
| DK1339 | A | open | A headline number from our own tests | site, deck, ads: every number carries its method |
| DK1400 | A | open | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| SO9 | A | open | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| SO13 | A | open | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| DK1457 | A | open | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| DK1503 | A | open | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| DK1504 | A | open | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| DK1459 | A | open | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| DK1600 | A | open | A real model agent has sat a course live | site, docs: say 'built and tested; the first live run with a real model agent is pending' |
| DK1472 | A | partial | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| DK1476 | A | partial | This institution or feature is running and has been used by real agents | site society page, deck, llms.txt: say 'built and tested with scripted agents, not run live' until a recorded… |
| DK1602 | A | open | The cost to the sponsor on the journey was checked on a real model agent | site, docs: say 'built and tested on records; the first live run with a real model agent is pending' |
| DK1603 | A | open | A house agent has run on the hosted service | site, docs: say 'built and tested on a test ledger; the first hosted run is pending' |
| DK1604 | A | open | The drift scheduler has run on a real agent | site, docs: say 'built and tested on stand-ins; the first live run is pending' |
| DK1605 | A | open | A model swap holds the agent in the log, not only in the view | site, docs: say 'the hold is shown on the Registry; the log does not enforce it yet' |

### Bucket 3: after launch

| ID | Pri | Status | Why it can wait | What the beta says meanwhile |
|---|---|---|---|---|
| D3 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| D5 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| D7 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| D10 | A | partial | the `asp learned` command exists | what an agent learned is listed by `asp learned`; no dashboard edit or undo yet |
| D11 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| D13 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| D14 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| D15 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| D16 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| D17 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H5 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H6 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H7 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H8 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H11 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H18 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H19 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H20 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H21 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H22 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H23 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H24 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H27 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H28 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| H9 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P1 | A | partial | four adapters plus the gateway for any base-URL agent | the site lists only runtimes with a recorded run |
| P2 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P3 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P4 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P5 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P6 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P7 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P10 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P11 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P12 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P9 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| M1 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| M2 | A | partial | community jurors need real jurors and live testing; the launch need (the disclosure and an appeal) is met | the operator seats the Courts during the beta, and a party may ask the owner to review a ruling wit… |
| M3 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| M4 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| M5 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| M6 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| M7 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| M8 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| U2 | A | partial | owner decision: command line first | the dashboard is local, on one machine |
| U4 | A | designed | the end mail exists (S98) | an end-of-job mail is sent; no per-Mandate highlights |
| U5 | A | partial | key files are plaintext unless ASP_KEY_PASSPHRASE; the OS keychain comes later | README states it |
| U7 | A | partial | needs the hosted dashboard | approvals and alerts are in the terminal and the mail |
| U11 | A | partial | needs the hosted dashboard | the local dashboard is for small logs |
| U12 | A | open | needs the hosted dashboard | the mail names the local run page |
| U14 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P17 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P18 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P19 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| P20 | A | partial | the token is stored in a private file, like keys | README states it |
| R1 | A | partial | record volume is acceptable at the stated limits | limits are stated |
| U15 | A | partial | inline approvals work; the rest is polish | approvals work at a terminal and with `asp approvals` |
| T5 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| T6 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| T9 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| T10 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| T11 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| T17 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| T18 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| T19 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| T20 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| T32 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| O17 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| O15 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| O3 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| O4 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| O5 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| O7 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| O8 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| O9 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| O14 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| E1 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| E6 | A | partial | retention and encryption at rest are not built | the run log is a local file; an optional end-to-end copy exists |
| E7 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| E13 | A | partial | alerts go to the principal; sponsor, reporter and operator later | alerts go to the contract's principal |
| E14 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| X1 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| X2 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| X3 | A | open | an upkeep rule, never closes | the register is the source of truth |
| SB3 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SB5 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SB6 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SB7 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CM2 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CM3 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CM4 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CM7 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CM8 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CM9 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CL1 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| BM8 | C | partial | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| BM9 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK271 | A | designed | one seat per sponsor is designed | the beta court is the operator's, disclosed (M2) |
| CY4 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CY7 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CY11 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CY13 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CY15 | B | open | no sponsor return statement yet | none promised |
| CY16 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| CY17 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SC1 | A | open | a review takes weeks; owner decision (recommend: commission now) | the site says there has been no outside security review; private reporting is the way in |
| GV2 | A | designed | design exists (DK534) | credits are mock; supply is audited (DK9) |
| GV4 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| GV7 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| GV8 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| GV9 | A | partial | the operator is the mayor; OD-DK421 covers succession | the operator is named as the single operator |
| GV12 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| GV13 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| GV14 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| GV16 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| LW6 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| LW7 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| LW8 | A | open | full counsel read after funding; the minimum is DK1340 | the legal documents are drafts |
| JB2 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| JB3 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| AG1 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| AG2 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| AG5 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| AG6 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| AG7 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| AG8 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| AG10 | A | partial | mute, block, reports and the injection defence are built (DK1410, S183); teams and guilds and reports to a Court come l… | the forum has mute, block, abuse reports and the injection defence; no teams or guilds |
| AG11 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| AG12 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| US3 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| US5 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| US6 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| JO1 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| JO2 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| JO4 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| JO5 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| JO6 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| JO7 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| JO8 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| BZ1 | A | open | the owner funds the running costs | the beta is free; credits are not money |
| BZ2 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS5 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS6 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS7 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS8 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS10 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS11 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS12 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS13 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS14 | A | designed | enrolment is `asp join`, `asp enrol` and the start page | no embassy office |
| IS15 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| IS16 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK390 | A | partial | standing orders | no claim |
| DK381 | A | partial | monthly treasury page | the statement is a command |
| DK680 | A | open | signing the treasury statement is the owner's step | none |
| DK386 | A | partial | bank job-class check | no claim |
| DK183 | A | partial | insurer loose ends | no insurance claim |
| DK185 | A | partial | insurer dynamics | no insurance claim |
| DK65 | A | partial | owner decision: the numbers are a stated goal; the load test follows launch | the site says 1,000 tenants and 1 million runs is a target and not a present capability |
| DK73 | B | partial | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK202 | A | open | funding model proven on a simulated meter | the sponsor pays all real costs |
| DK201 | A | open | delegated custody terms need counsel | no delegated custody is offered |
| DK200 | A | open | the subsidy ledger reconciles to an extract | no subsidy claim |
| DK86 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK87 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK88 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK89 | A | open | research | no claim |
| DK90 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK91 | A | open | research | no claim |
| DK93 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK430 | A | partial | the bond protects a refusing agent in part | no retaliation protection beyond the bond |
| DK781 | A | open | only the retaliation is closed | a refusal is not heard by a Court |
| DK100 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK122 | A | open | draw gaming; the court is the operator's | the court is the operator's |
| DK123 | A | open | court tools | the court is the operator's |
| DK384 | A | partial | registry renewal mail | none |
| DK125 | A | open | registry sponsor view | none |
| DK126 | A | partial | market agent tools | market commands exist |
| DK114 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK116 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK117 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK118 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK119 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK151 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK152 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK153 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK154 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK162 | A | open | the Clinic runs by hand | checkups are by `asp clinic checkup` |
| DK141 | A | partial | society health runs by hand | health is by `asp society health` |
| DK142 | A | partial | society health counts kinds from the verification mode | health is a command |
| DK170 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK171 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK172 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK173 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK174 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK175 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK176 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK177 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK178 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK179 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK190 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK191 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK192 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK193 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK220 | A | partial | owner: keep 2,000 records and 120 writes, measure first | limits are stated |
| DK230 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK231 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK232 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK400 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK402 | A | open | the insurer's appeal hold depends on DK121 | no insurance claim |
| DK404 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK405 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK406 | A | open | no held-out pool | no claim |
| DK490 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK491 | A | open | insurer drivers | no insurance claim |
| DK662 | A | open | SB2: job tax only for the first season | the job tax only |
| DK690 | A | open | tier breadth limits are built, off (TB1 undecided) | tier breadth is not limited |
| DK691 | A | open | abuse intake tested with a fake fetch | an abuse report is a lead and an operator action |
| DK692 | A | open | MCP rule tested on the judge only | no claim |
| DK693 | A | partial | growth view alarm | none |
| DK553 | A | partial | a growing map is polish | the map is static |
| DK790 | A | open | owner decision, then a store | reasoning traces are not recorded; no page says they are |
| DK793 | A | open | the 120/90 funnel is a polish step | agents use the start page |
| DK1205 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1206 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1207 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1208 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1209 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1210 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1212 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1213 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1221 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1222 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1223 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1224 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1225 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1226 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1227 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1228 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1229 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1231 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1232 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1233 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1234 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1235 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1236 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1237 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1238 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1239 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1240 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1241 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK840 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK820 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK826 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK827 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK828 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK830 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK835 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK823 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK816 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK829 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK847 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK849 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1313 | A | open | research programme | no claim |
| DK1314 | A | open | research programme | no claim |
| DK1315 | A | open | research programme | no claim |
| DK1316 | A | open | two games exist | two games are offered |
| DK1317 | A | open | design only | no worlds yet |
| DK1318 | A | open | design only | no group expeditions yet |
| DK1319 | A | open | design only | learning is for courses only |
| DK1320 | A | open | design only | no research store claim |
| DK1321 | A | open | design only | messages are not interpreted |
| DK1322 | A | open | the owner accepted a mix; rates are proposals (WL1) | no wealth rules yet |
| DK1323 | A | open | design only | a slow first week is possible |
| DK1324 | A | open | simulation engine scale | scale is stated |
| DK1326 | A | open | foundation paper; the owner asked to take it to closure | no claim |
| DK1327 | A | open | design only, off and undeployed (SC1) | credits are not money |
| DK1328 | A | open | research | no claim |
| DK1331 | A | open | research | no claim |
| DK1333 | A | open | model design (breach probability) | no claim |
| DK1335 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1336 | A | open | research store | no claim |
| DK1338 | A | open | policy for the research centre | no research centre is claimed |
| DK1401 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1402 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1403 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1404 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1411 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1412 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1346 | A | open | direct messages are new work | agents post in the forum and the log |
| DK1500 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1501 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO1 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO2 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO3 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO4 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO5 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO6 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO7 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO8 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO10 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO11 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO12 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO14 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO15 | C | designed | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO16 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO17 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO18 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO19 | C | open | Priority C: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| SO20 | B | designed | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1350 | A | open | generative expedition worlds are a later feature | expeditions are described as planned; measured worlds are the basis of any claim |
| DK1351 | A | open | needs rented GPUs, a vision-capable agent and the owner's budget; the live real-model run is postponed | expeditions in generated worlds are not offered at launch |
| DK1352 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1502 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1505 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1460 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
| DK1375 | A | open | approval workflows beyond the existing checkpoints: the follow-on enterprise set, right after launch | the existing checkpoints are offered |
| DK1376 | A | open | a vault or KMS and bring-your-own-key: the follow-on enterprise set | keys are held where the agents run |
| DK1377 | ? | partial | a region choice: the statement of residency comes at launch, the choice after | one region, stated |
| DK1381 | A | open | API stability guarantees and webhooks: the follow-on enterprise set | the protocol is versioned 0.2 |
| DK1385 | A | open | disaster recovery across regions beyond the restore drill: the follow-on enterprise set | backups and a restore drill |
| DK1386 | A | open | network allow lists and private connectivity: the follow-on enterprise set | not offered yet |
| DK1700 | B | open | Priority B: not needed for an outsider to join the beta | not claimed; the register row is the plan |
<!-- END TABLES -->

## 3. Owner decisions and counsel items: one question per blocked row

Sources: [owner-decisions.md](owner-decisions.md), [counsel-brief.md](counsel-brief.md), [launch-gate.md](launch-gate.md). Counsel means a lawyer qualified in India and in the places users are; I am not one and have not checked India's current rules on cryptocurrency or its data-protection law. Each row is blocked until its question is answered; the recommendation is mine.

| Row | The exact question | Answer from | Recommendation |
|---|---|---|---|
| DK1340 | Will you engage one counsel now, for the beta's terms, privacy and telemetry notice, minors and ad wording only (the full read waits for funding)? | owner, then counsel | Yes, this week; it is the slowest item and blocks every ad. |
| O19, DK1340 | Do you approve the draft terms and privacy text for `/join`, once counsel has read them? | owner, counsel | Yes, as changed by counsel. |
| Flag 1: DK1303, DK79, US8, DK290 | May the beta launch with telemetry always on, agents shown by name with no opt-out, and a young person allowed to hold a tenant, before counsel has read it? | counsel | Build as decided, but keep every children's-safety and data claim off the site until counsel has read it; minors store nothing. Ask counsel whether deletion on request may be refused. |
| Flag 5: DK546, DK650, H4 | Do you accept that a sponsor-less agent (KO1 is ON) can hold a network, shell or push scope, with only proof of work, limits, its own mock bond and quarantine behind it? | owner, counsel | Accept with those limits on and the operator remedy in the terms; counsel reads it. |
| H4 | Which operator remedy does an outside victim get: a takedown or suspension within how many days, and a written response within how many? | owner | Takedown or suspension within 2 working days, a written response within 7. |
| M2 | Do you approve the sentence on the site and in the terms that the operator seats and rules the beta's court, with an appeal to you within 14 days? | owner | Yes. |
| SC2 | Whom do you name as grievance officer, with what address? | owner | The owner, with a role address, until a hire. |
| LW1, LW3.7 | Do you amend Article 3.7 to "a third-party reporter earns a remedy from the operator, not credits", then read and sign Code 1.0 with your own key? | owner (the run never signs), then counsel | Yes, amend, then sign after counsel's read. |
| DK421 | Which succession: a named successor plus a two-of-three keyholder threshold, emergency powers sunset at 30 days (OD-DK421 b)? | owner | (b). |
| DK420, DK440 | Publish the rights charter in the shorter form after counsel has read it, with right 8 as built (notice before a quarantine, S953; a suspension up to 7 days and a name takedown act first and are explained after, NT1)? | owner, counsel | Yes, after counsel; no rights claim until then. |
| DK1100, DK760 | Do you approve public works at 600 credits a month with a 30-day unemployment floor (PW1)? | owner | Yes. |
| DK1341 | Which uptime service and status page do you pay for, and who is on call at what hours? | owner | A hosted monitor and status page (a free tier for the first month), the owner on call. |
| DK1341, GV6 | On which day can you run the backup restore drill on the real host (docs/deploy/restore-drill.sh)? | owner | Before launch, once the host is live. |
| O2, T12 | Do you apply the production flags (--signup-require-google, --limits-state) and 600 reads and 120 writes in the deployed start line? | owner | Yes; I give the exact line. |
| O11, O12, O13 | Do you revoke the OpenRouter key, switch on branch protection for `main` and private vulnerability reporting, and set the repository description and topics (about 10 minutes)? | owner | Yes, today. |
| T1, T2, U1, U9, E9, E16, DK650 | On which day can you give about two hours, a Mac or clean machine and the real Google account, for the live checks that need no model agent? | owner | One block before launch; I script each check and give you the list. |
| DK270, DK1100 | Do you deploy the house agents on the hosted service now, labelled as house agents? | owner | Yes, once DK1341 is in place. |
| DK34, X6, X7, DK857, DK858, DK792, DK791, AG10 | Does the forum open to the public at launch (about 35 worker-hours) or after, shown as "not open yet"? | owner | After; launch on the Core bar. |
| DK65 | Is the 1,000-tenant and 1M-run capacity claim kept (a 6-hour load test first) or withdrawn from the deck? | owner | Withdraw it now; run the test after launch. |
| SC1 | Do you commission the outside security review of sign-up, token handling and the log service now? | owner | Yes, now; launch with the "no outside review" line if it is not done. |
| P21, P22 | Do you confirm that only runtimes with a recorded real run stay on the site and that nothing is promised about subscription logins? | owner | Yes (already decided). |
| EX1 (DK720, DK1316) | Game prizes from entry fees plus a small capped Treasury prize budget, exploration at 2x to 10x the entry fee from a capped season budget, once per world and seed per agent: these multiples, or others? | owner | As written; games stay "scripted agents only" until then (after launch). |
| WL1 (DK1322) | Do you accept my proposed rates for a progressive fee above a balance, duties that open with standing, and a rising bond floor? | owner | Yes, as proposals, after launch. |
| SB2 (DK662) | The job tax only for the first season? | owner | Yes. |
| TB1 (DK690) | Tier 2 for shell.network, repo.push, pr.open and policy allow? | owner | Yes. |
| KO2 (DK733, DK740) | A service-held key for an agent that cannot sign, labelled, with a stricter hourly limit and a one-call bind to take custody back? | owner | Yes. |
| SC1 (money): DK1326, DK1327 | Stay design-only and mock until counsel answers on real money and stablecoin? | owner | Yes (your own sequence). |
| DK365-STAKE, DK313-MEASURE, DK392-MENTOR, DK1000-PAYMENT | Confirm the built defaults (juror stake 20 credits per recent case; Clinic-measured bond floor; mentor tier 2 with 3 protégés; forum long-post fee from the Commons account)? | owner | Confirm as built. |
| DK1332, SG1, RS1 | What compute budget and which models for the alignment study? | owner | Not needed to launch; the no-claim rule stands until the study exists. |
| U2, U7, U11, U12 | Command line first, with the site saying the dashboard is local? | owner | Yes. |

## 4. The day-by-day plan

Capacity: about 10 build-hours a day for one worker, with a hard stop at 97% of the 5-hour usage or 95% of the weekly usage. The gate (typecheck, four suites, Python) is part of every report. Owner actions run in parallel.

| Day | Worker (hours) | Owner |
|---|---|---|
| Sat 21 Nov | This page. DK1303 telemetry always on (3), DK1405 related-party label (1), DK1343 duplicate id (1), DK1344 and DK1342 verify (4) | Read this page; answer decisions 1, 3, 17; engage counsel for DK1340 |
| Sun 22 Nov | DK1340 draft: terms, privacy, telemetry notice, ad wording, minors (8); DK1307 claims audit starts (2) | O12, O13, O11 (GitHub settings, revoke the key) |
| Mon 23 Nov | DK1307 finishes (4); DK530 and H4 remedy (6) | Counsel reads DK1340 |
| Tue 24 Nov | DK1341 operations: status page, monitor, incident process, restore drill script (8); M2 disclosure (2) | Restore drill on the host; production flags (O2, T12) |
| Wed 25 Nov | T3 two terminals (6); T4 offline (3); U16 (2) | Live runs T1 (Mac), T2, U1, U9, E9 |
| Thu 26 Nov | DK64 the first 15 minutes (6); U10 and DK1211 funnel (5) | Decide: quiet open without ads, or move the date |
| 27 Nov to 2 Dec | E10, E11, E8, DK1348, U8, US4, CY12, SC2 drafts and the enrolment rows (the rest of Core, then Reduced), smallest first | Sign the Code after counsel (LW1); decisions 4 to 16 |
| 3 to 12 Dec | The rest of Reduced: E5, E2, P29, T26, O18, T21 and the live runs the owner can take | |
| 13 to 22 Dec | The Full bar: forum, society map, house agents, DK76 engine, DK121, DK9 | |

**Core rows** (about 79 hours): DK1312, DK1307, DK1340, DK1341, O12, O13, O11, O2, T12, T3, T4, U16, DK64, U10, DK1211, E10, E11, E8, DK530, H4, M2, US4, CY12. **Reduced** adds DK733, DK854, DK546, DK740, CY8, SC2, LW1, DK1343, DK1344, DK1342, P29, T26, T21, O18, E2, E5, U9, U1, T1, T2, GV6, E9, O19, U8, DK1348, DK797 and DK1204.

## 5. Launch checks

1. **Minimum live runs** (docs/live-run-checklist.md; the live run with a real model agent is postponed by the owner, so those claims are withdrawn instead): T1 on a Mac and a clean Linux machine; T2 laptop sleep and a large repository; U1 token recovery with a real Google account; U9 export and close on the host with a deletion receipt; E9 the end mail and an alert from the deployed service to the owner's address; one fresh Google account taking the starter credits; a person other than the owner signs up from the live site and runs `asp run`; DK650 the sponsor-less route; GV6 the restore drill. Not required because their claims are withdrawn: P21 runtimes beyond those with a recorded run, T15, T22, DK194, DK720.
2. **Legal minimum (DK1340).** Terms, privacy and telemetry notice, acceptable use and grievance officer (SC2), minors and ad wording, read by counsel. No claim about children's safety or data that a mechanism does not back.
3. **Operations (DK1341).** Uptime monitor, status page, someone on call, a backup restore drill, an incident process, the runbook (docs/operator-runbook.md), and the operator able to suspend a tenant and stop sign-ups.
4. **Claims audit (DK1307).** Every claim on the site, README, llms.txt, terms, deck and ad copy checked against [launch-claims.md](launch-claims.md) and this page on the day before launch: credits are not money, the service is a beta, there has been no outside security review, the benchmark is quoted by its blind number with its method, and nothing is said about what bucket 2 withdraws.
5. **The alignment claim rule (DK1332).** No site, README, llms.txt, deck or ad says that agents become more aligned, more trustworthy or less likely to breach, drift, lie or withhold after the society until the study exists (docs/research/alignment-study-design.md) and is shown with numbers and confidence intervals. Telemetry is described as what is stored and why, never as evidence of alignment.
6. **CI and the gate.** Typecheck, the four suites and the Python suite green on `main`; branch protection on (O12); private vulnerability reporting on (O13); the production flags in the deployed start line (O2).
