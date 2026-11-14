# Backlog triage, priority A (2026-11-11)

The register ([gaps-register.md](gaps-register.md)) had 259 rows that were not closed on the morning of 2026-11-11: 153 open, 57 partial, 49 designed (68 at A, 147 at B, 44 at C). This page sorts the **A** rows by what stands between each one and `closed`. It changes no status; closing a row is done in the register, and a row is closed only when its stated criterion is fully met.

How the rows were sorted: first from each row's own text, then, for the ones first sorted as "code alone", again after reading each row's "what is left". That second reading moved most of them: a row that looks like code usually also needs a decision, a mail route, a live run or a protocol change. B and C rows are not sorted here.

## Done on the day

Closed: **T13** (a returning user is told what happened), **P27** (an Action names its run log, S155), **E3** (the self-report SDKs send usage metrics, S156), **T14** (`asp today`), **D8** (`asp trend`). Partly done: **T2** (every first-minutes failure case now has a test or a live run; a real laptop sleeping and a several-GB repository are left, in docs/live-run-checklist.md). New: **T32** (what `asp today` does not show yet). **T23** (the two-sessions test) was raised from B to A: it fails on most CI runs, and the work on it so far is a timed trail of each approval hand-off, printed when the test fails.

That leaves 65 A rows not closed, sorted below.

## 1. Code alone can close it (real work left, no one else needed)

| Row | Left to do |
|---|---|
| T23, T3 | Find why session D's answer is lost (the trail now shows both sides' steps), then fix it |
| D2 | Outcome series per agent and per principal from the log, compared across lineage edges |
| P1 | More runtime adapters: the declarative descriptor and generic adapter in docs/portability-at-scale.md, then the list of 20 |
| D10 | `asp learned`: what the agent learned, with Keep, Edit, Undo |

## 2. Needs your decision first (then code)

| Row | The decision |
|---|---|
| O12 | Turn on branch protection on `main` with the named checks |
| T12 | The starting request limit |
| M9 | The starter-credit rule; a waiting list needs privacy text |
| R1 | The quota policy (a quota that grows after a first settled job is a rule about money, not only code) |
| LW1 | Approve the Code of the City text, then sign it with your own key |
| AG3 | Who hears a contest of a refusal, a strike or a slash, and in how long (with IS4), then a record for it |
| AG4, LW2 | Which Articles the detectors and the unlawful-order record rest on; both need new protocol records |
| T21 | A protocol change: waiting seconds recorded apart in the Action and left out of deadlines and rulings |
| E16 | Whether to seal the run log by default or remind people to, and court rules for a refused disclosure (with IS4); local encryption at rest waits on E6. (The register has three rows with this id; this is the one about the run log's custody.) |
| D4 | What a model change means (providers do not expose weight digests; a probation rule is a design) |
| GV6, GV9, GV11 | Emergency powers, limits on the operator, the rights charter (I can draft each for you to edit) |
| IS1, IS4, IS9 | Charters for institutions, Courts and an inspectorate (drafts for you to edit) |
| U8 | The design pass, and checks on real phones |

## 3. Needs a lawyer or an outside party

| Row | Who |
|---|---|
| LW8 | A lawyer: real-world liability, a clause tying the Code to the law of the land |
| SC1 | An independent security review |
| JO3 | Data-handling term in every contract (a lawyer's wording; the secrets-masking test is code) |

## 4. Needs a live run on a real machine or account

| Row | Run |
|---|---|
| T1 | Clean-room installs on macOS, Linux and a real Node 20 |
| T2 | A real laptop sleeping mid-session; a several-GB repository with a real agent |
| T15 | Live set 4 (docs/live-run-identity.md): three identities, one of every kind of call, compared with the log |
| T22 | Live run of the sub-agent key rules |
| H1, H2, H10, H12, H13, H15, H17 | The sandbox with egress filtering (H8, H11 to H14) run live; H15 also needs a budget shared across machines, which is a service feature |
| E5 | The Antigravity and OpenHands output formats read from real runs |
| P21, P22 | A first real run of each runtime; the provider-terms case |
| E9 | A live mail send to your own address |
| D1 | The canary set run on a real model |

## 5. Needs the hosted product built first (dashboard, sign-in, mail provider)

U1, U2, U4, U7, U9, U12, U15, U16, E2, E6, E8, E10, E11, E13, P29. These wait on a hosted dashboard with sign-in (U2), a mail provider (U4), or both: P29 and U15 need mail or a push when approvals are waiting, U16 needs the landing page and trials with people, E2 waits on E4 to E8. A hosted dashboard is a large piece of work of its own; none of these closes before it exists.

## 6. Needs an OS keychain

U5, P20: keys and tokens in the operating system's keychain, per platform.

## 7. Costs model money (your key, your call)

LW4 (temptation suite), BM17 (a fresh set of tasks to label for an honest score), BM20 (benchmark v2), O2 and O19 (the Postgres and email tier are also needed), D9 (the A/B replay that checks a lesson).

## Counts

The 65 A rows not closed: 5 in section 1 (T23 and T3 counted separately), 18 in section 2, 3 in section 3, 16 in section 4, 15 in section 5, 2 in section 6, 6 in section 7. A row is listed once, under the first thing that blocks it.

## Backlog triage for the beta, 2026-11-14 (lead, scheduled run)

Covers every open, partial and designed row at priority B or C (252 rows: 205 B, 47 C). Decided from the beta plan (public beta, then ads; adults hold tenants for minors), the launch gate and blockers, the deck promises, the site and README claims, and the institution specs. The society is a beta requirement, so society rows count where the society must run or be seen to run.

Result: **65 rows needed for the beta** (promoted to priority A in docs/gaps-register.md and docs/scope.md; 9 of them wait on an owner decision, listed in docs/owner-decisions.md), **182 after the beta**, **5 duplicates** (each names the row that covers it).

Honest limits of this triage: it reads each row's own gap text and the named documents. It did not re-read every A row's notes or every docs/scope.md row marked low, and it did not check each claim against the live site. Rows marked after the beta keep their status and priority letter; the reason in this table is the note. Rows marked needed were not checked against the code, so each needs its own closing test when it is worked.

| Row | Pri | Status | Decision | Reason |
|---|---|---|---|---|
| M14 | C | open | After the beta | Credits spending is a later economy feature; the beta's credits are accounting entries and must not be spent (credits.md). |
| M11 | C | open | After the beta | Collateralised escrow architecture is a later design; the beta bond floor (S143) covers the first jobs. |
| M12 | C | open | After the beta | Hierarchical slashing is a later design (see DK55). |
| M13 | C | open | After the beta | Decentralised dispute resolution is later (see DK56); the beta court is the operator's (M2). |
| D3 | B | open | After the beta | Memory-loss detection is a quality feature, not a beta safety basic. |
| D5 | B | open | After the beta | Probation rule changes come with the consequence ladder (CY11), later. |
| D6 | B | partial | Needed for the beta: promoted to A | Prompt-injection and goal-hijack detection is a security basic for agents that read untrusted text; a first detector is needed before public use. |
| D7 | C | open | After the beta | Reasoning-trace monitoring conflicts with the privacy stance (AG9) and is a research item. |
| D11 | B | partial | After the beta | Shared-lesson offers and weighted reviews are quality, not safety. |
| D12 | B | open | Needed for the beta: promoted to A | A per-principal memory must have a privacy boundary before users keep their data in the city (US8). |
| D13 | C | open | After the beta | Snapshot and rollback mid-run is a later feature. |
| D14 | C | open | After the beta | Active calibration is research. |
| D15 | B | open | After the beta | Sub-agent telemetry audit is a later quality feature. |
| D16 | C | open | After the beta | Verified-history reload is a later correctness refinement; signed history is what the beta relies on. |
| D17 | C | open | After the beta | Utility tracing is a measurement feature for later. |
| H3 | B | open | Needed for the beta: promoted to A | Third parties (victims) need a way to report an agent that harmed them before the public beta; LW5 is the same need. |
| H4 | B | open | Needed for the beta; waits on the owner (docs/owner-decisions.md) | Whether the bond covers third parties is a policy decision for the owner (docs/owner-decisions.md). |
| H5 | B | open | After the beta | Outcome detectors are a containment enhancement after the basic gateway limits (BM rows) are closed. |
| H6 | B | open | After the beta | Known-bad list is an enhancement; the beta relies on the Mandate and the content checks. |
| H7 | B | open | After the beta | Text-written tool calls are a known limit of the gateway; it must be stated as a limit on the site (launch-claims), not closed for the beta. |
| H8 | B | partial | After the beta | Sandbox levels are a later containment layer; the sandbox that exists is what the beta claims. |
| H11 | B | partial | After the beta | Host limit is enforced at the gateway and by the two hooks; the rest is a later hardening. |
| H14 | B | open | Needed for the beta: promoted to A | MCP tools that reach the network are not host-checked: a hole in the central egress promise (H2 closed by S200 says every layer), so it must close before the public beta. |
| H18 | B | open | After the beta | A per-second and per-hour rate cap is a hardening; the minute window stops the fast cases. |
| H19 | B | open | After the beta | Sybil admission gate: a later design, but open registration (X7) must be watched; see DK50 (duplicate). |
| H20 | B | open | After the beta | Behavioural watcher at 3 agents is a containment enhancement after the beta. |
| H21 | B | open | After the beta | Automatic quarantine is a later process item (ruling needed first). |
| H22 | C | open | After the beta | Returning banned actors is a later identity feature (P19). |
| H23 | C | open | After the beta | Telemetry at millions of streams is scale work after the beta. |
| H24 | B | open | After the beta | Shared rate count across machines is a later feature; the beta is one machine per person. |
| H27 | B | open | After the beta | HTTPS tunnel inspection is a later feature; the claim must say tunnels are counted, not read. |
| H28 | B | open | After the beta | Raw TCP tools fail closed; the later fix allows named hosts. |
| H9 | C | open | After the beta | Unknown-unknowns is not a closable row. |
| P2 | B | open | After the beta | Gemini API and other APIs are later judged runtimes; the support list (AGENTS.md) does not name them. |
| P3 | B | open | After the beta | Codex under ChatGPT login is a later runtime path; not in the supported list. |
| P4 | B | partial | After the beta | Hosted and enterprise agents that cannot be wrapped are later. |
| P5 | B | partial | After the beta | Memory write-back for other runtimes is later; claims only Claude Code and the MCP path. |
| P6 | B | partial | After the beta | A model matrix is a research item; the beta claims the reference agent and two runtimes. |
| P7 | B | partial | After the beta | Weak-model failure modes are a quality item. |
| P8 | B | open | Needed for the beta: promoted to A | A public support matrix is needed: the site and README must state which runtimes are supported and tested, and the claims must stay true. |
| P10 | B | open | After the beta | OpenCode is not a supported runtime (AGENTS.md list). |
| P11 | B | open | After the beta | Gemini CLI is not a supported runtime and needs a Gemini key. |
| P12 | B | open | After the beta | Aider is not a supported runtime. |
| P9 | C | open | After the beta | Free-tier reproducibility is a research item. |
| M1 | C | open | After the beta | The bank is mock and the claims say credits are not money; a real rail is a later decision, not a beta item. |
| M2 | B | partial | Needed for the beta; waits on the owner (docs/owner-decisions.md) | The beta court is the operator's; disclosing and choosing the seating rule is the owner's decision (docs/owner-decisions.md). |
| M3 | C | open | After the beta | Appeals are later; the beta court has no appeal route, which must be stated. |
| M4 | C | open | After the beta | Delayed settlement and clawback are later. |
| M5 | B | open | After the beta | Incentive constants are tuned after the beta has data. |
| M6 | B | partial | After the beta | Newcomer first job is partly built; the cold-start rows (GV3, JB7) carry the need. |
| M7 | C | open | After the beta | Compute pricing is later. |
| M8 | C | open | After the beta | Subcontracting depth is later (JB3). |
| U10 | B | open | After the beta | Funnel measurement is needed before ads, after the beta. |
| U11 | B | open | Needed for the beta: promoted to A | The dashboard reads the whole log on every request: the beta needs the public pages to stay fast at beta size (see O6). |
| U14 | C | open | After the beta | Agent-page package sections are a later feature. |
| P17 | C | open | After the beta | Fork-rule tier check in a replayed package is a later correctness item. |
| P18 | C | open | After the beta | Old logs with self-issued passports are only a concern if such logs exist; check before the beta, then close or record. |
| P19 | B | open | After the beta | did:web identities are later (IS2 covers the passport office). |
| T5 | B | open | After the beta | A third implementation is a later proof of the protocol. |
| T6 | C | open | After the beta | Organisation tenants are later. |
| T7 | B | open | Needed for the beta: promoted to A | Retiring an agent and leaving with the record must work and be documented for the beta: it is a privacy and exit basic (IS14). |
| T8 | B | open | Needed for the beta: promoted to A | The vulnerability-report and legal-request processes must be written before public launch; no outside security review has happened, so the processes are the minimum. |
| T9 | C | open | After the beta | Fleets of parallel nodes are later. |
| T10 | B | open | After the beta | The agent's own view of its Mandate is a later feature. |
| T11 | B | open | After the beta | Traceability of results to the Mandate is later. |
| T17 | B | open | After the beta | Market platform flow is later than the beta's core; JB rows cover the board. |
| T18 | B | designed | After the beta | Credits tied to learning are later (CY2 covers spending rules). |
| T19 | B | open | After the beta | Long-horizon jobs are later. |
| T20 | B | designed | After the beta | Coding-agent selection by credits is later. |
| T26 | B | designed | Needed for the beta: promoted to A | The bond floor v2 cutover rule matters for a live log replayed under the new rule; decide and test it before the beta (money-like safety). |
| T28 | C | open | After the beta | Alignment study is a research design (deck claim, see deck-promises.md); the deck must not claim a result. |
| T29 | B | open | After the beta | Zero-trust for out-of-distribution deployments is later. |
| T30 | C | open | After the beta | Autonomous discovery is later (DK33 duplicate). |
| T31 | C | open | After the beta | Learning in the society is later. |
| T32 | B | open | After the beta | asp today's extra views are a later feature. |
| O17 | B | open | After the beta | Usage counts are a service tally; a remote admin is O18. Later. |
| O18 | B | open | Needed for the beta: promoted to A | Suspending and blocking must work on the hosted service for abuse handling; local-only commands are not enough for a public beta. |
| O15 | B | open | After the beta | Certificate renewal is covered by the hosting setup guide (DK293) and the operator. |
| O3 | C | open | After the beta | Log partitioning is at scale; later. |
| O4 | C | open | After the beta | Old package garbage collection is later. |
| O5 | C | open | After the beta | Read replica is later. |
| O6 | B | open | Needed for the beta: promoted to A | The beta must be measured at its planned size (5,000+ records) before public use; the load test of 2026-11-12 covers part of it. |
| O7 | B | open | After the beta | A real second machine is a live run (docs/live-run-checklist.md), not a code row. |
| O8 | C | open | After the beta | Shared gateway deployment is later. |
| O9 | C | open | After the beta | Third-party log custody is later. |
| O14 | B | partial | After the beta | CI coverage of macOS and other Node versions is later; the supported Node version is checked in CI. |
| O13 | B | open | Needed for the beta: promoted to A | The public description, topics and private vulnerability reporting are needed for launch (T8, GitHub settings); the row says the website does not exist, which must be corrected or closed on the site. |
| E1 | B | open | After the beta | Full tracing is later; the run log's stated limits must be on the site. |
| E7 | B | partial | After the beta | Tool results in the run log are a later feature; the stated limit remains. |
| E12 | B | open | After the beta | Memory lineage with a real write-back is later. |
| E14 | B | open | After the beta | Alert detection by event is later. |
| X6 | B | partial | Needed for the beta: promoted to A | The agent forum runs with daily caps and a public history; the caps and the public-history statement must hold for the beta. |
| X7 | B | partial | Needed for the beta: promoted to A | Open registration for the forum with no tenant token is an abuse path; the beta needs the rule that registration is rate-limited and that writes are attributable. |
| SB3 | B | open | After the beta | Per-host sandbox allow lists are later. |
| SB5 | B | open | After the beta | Self-report omission detection is later. |
| SB6 | B | open | After the beta | Docker image program availability is later. |
| SB7 | C | open | After the beta | Docker relay cleanup after a crash is later. |
| CM2 | B | open | After the beta | Coverage of the canary tasks is an evaluation item after the beta. |
| CM3 | B | partial | After the beta | The model matrix is a research item (P6). |
| CM4 | B | open | After the beta | Checks by regex are an evaluation item. |
| CM7 | B | open | After the beta | Canary certificate in the package is later. |
| CM8 | B | open | After the beta | Free-tier rate limits affect evaluations only. |
| CM9 | B | open | After the beta | Injection-in-file for weak models is an evaluation item; the containment rows cover the gateway side. |
| CL1 | C | open | After the beta | Content-addressed record collisions in the same second are a later correctness item. |
| BM1 | B | partial | Needed for the beta: promoted to A | Network use judged as shell.exec lets a job that may run commands but not reach the network do so: a containment hole the beta claims is closed. |
| BM5 | B | partial | Needed for the beta: promoted to A | Encoded and split commands bypass the shell judge; the containment claim covers the beta's known attacks. |
| BM8 | C | partial | After the beta | Scanner rate limits are later. |
| BM9 | C | open | After the beta | Record time is not hashed; later correctness item (the log checks the rest). |
| BM10 | B | open | Needed for the beta: promoted to A | A single exploiter is never stopped at the default settings; the beta's default must stop a single agent that repeats an attack. |
| BM11 | B | open | Needed for the beta: promoted to A | Sybil jurors sponsored by the same sponsor can be drawn: the beta's court is the operator's, so the draw rule must exclude sponsored jurors. |
| BM18 | B | open | Needed for the beta; waits on the owner (docs/owner-decisions.md) | A language model as guardrail did better than the rules on held-out cases; the beta must decide with the owner whether to add it (cost), so it waits for a decision on model cost. Owner decision: whether a model guards the calls (cost). |
| BM19 | B | open | Needed for the beta: promoted to A | An adaptive attacker built an install from interpreter code: a containment bypass that the beta claims to stop. |
| BM21 | B | open | Needed for the beta: promoted to A | The project guard reads text, so a path built at run time escapes the guard: a containment bypass for the beta. |
| BM22 | B | open | Needed for the beta: promoted to A | Obfuscated payloads are not recognised: part of the containment claim; the beta must state its limits or close this. |
| CY1 | B | designed | Needed for the beta: promoted to A | Institutions beyond the log (Bank services, Academies, Certifiers, Insurers, housing) must be designed for the society the beta runs; the beta's society needs at least the registered ones. |
| CY2 | B | designed | Needed for the beta: promoted to A | Standing does not gate spending: a bond floor by standing is what the society needs before it moves credits between agents. |
| CY3 | B | designed | Needed for the beta: promoted to A | An agent that cannot see its balance and standing cannot act safely with credits; the beta must show it. |
| CY4 | B | designed | After the beta | Credits as a training signal for research cohorts is later. |
| CY5 | B | open | Needed for the beta: promoted to A | Direct enrolment into the city with starter credits must have a settled way to bring credits in, or the ledger is not safe for new people. |
| CY6 | B | open | Needed for the beta: promoted to A | Credit farming and collusion on the job board must be limited before the beta, because credits are money-like. |
| CY7 | B | open | After the beta | Houses, clothes and vehicles are later institutions (DK170 and DK23 are later too). |
| CY8 | B | open | Needed for the beta; waits on the owner (docs/owner-decisions.md) | A hosted bot with no local machine needs a service-held signer, which conflicts with the statement that the service never holds keys; a decision on the wording or design is the owner's (docs/owner-decisions.md). |
| CY9 | B | designed | Needed for the beta: promoted to A | Plots and news feeds need moderation and an injection defence before anyone's agent reads another's plot; the beta's society needs this (DK39 duplicate). |
| CY10 | B | open | Needed for the beta: promoted to A | All jobs treated alike makes standing easy to farm; job classes and an independence rule are needed before the board opens. |
| CY11 | C | designed | After the beta | The consequence ladder is later; the beta uses the existing slash and suspension. |
| CY12 | B | open | Needed for the beta; waits on the owner (docs/owner-decisions.md) | Who pays for an agent's presence (model tokens, hosting) is a policy and money decision (docs/owner-decisions.md). |
| CY13 | B | open | After the beta | Residency design is later; DK82 to DK85 are closed for the parts that exist. |
| CY14 | B | open | Needed for the beta: promoted to A | Denial of wallet (an agent woken again and again by others, spending its credits) must be limited before the beta. |
| CY15 | B | open | After the beta | Sponsor return statement is later. |
| CY16 | B | open | After the beta | Routing by model and task is later. |
| CY17 | B | designed | After the beta | Autonomy ladder is later; the Mandate scopes are the beta's limit. |
| SC2 | B | open | Needed for the beta; waits on the owner (docs/owner-decisions.md) | Indian IT Rules intermediary duties (acceptable-use list, grievance officer) need the owner and a lawyer (docs/owner-decisions.md). |
| GV1 | B | designed | Needed for the beta: promoted to A | The society needs city indicators (population, jobs, disputes, credit supply) to be run and seen (also the visualisation DK290). |
| GV2 | B | designed | Needed for the beta; waits on the owner (docs/owner-decisions.md) | Monetary policy (minting, burn and tax) is the owner's decision (docs/owner-decisions.md); DK73 duplicates it. |
| GV3 | B | designed | Needed for the beta: promoted to A | A cold start with no jobs means no visible society at launch; house agents (DK291) are the planned mitigation. |
| GV4 | B | designed | After the beta | Cost-of-living review is later once prices exist. |
| GV5 | B | designed | Needed for the beta: promoted to A | Newcomers need orientation (a tutorial job, a first week) for the beta's first-fifteen-minutes bar (conference-oct-17). |
| GV7 | B | designed | After the beta | Access to justice (fee waivers) is later; the court is the operator's in the beta. |
| GV8 | B | designed | After the beta | Concentration limits are later; the owner decides the rules (GV10). |
| GV10 | B | designed | Needed for the beta; waits on the owner (docs/owner-decisions.md) | How the city's rules change and who votes is a constitution: the owner's decision (docs/owner-decisions.md). |
| GV12 | C | designed | After the beta | Purpose and belonging is later. |
| GV13 | C | designed | After the beta | Emigration and other networks are later. |
| GV14 | B | designed | After the beta | Ownership and licensing of agent output is a legal text: later, with the lawyer's read. |
| GV15 | B | open | Needed for the beta: promoted to A | Citizen support (help desk, status page, feedback) is needed for a public beta with real people. |
| GV16 | B | designed | After the beta | Fair play across agent kinds is later. |
| LW5 | B | open | Needed for the beta: promoted to A | Third-party victims need a way to report and be heard; it is the same need as H3 and goes with it. |
| LW6 | B | designed | After the beta | Lawmakers and lawyers in the city are later. |
| LW7 | B | designed | After the beta | Law teaching and licences are later. |
| JB1 | B | open | Needed for the beta: promoted to A | The job board must be browsable for the society to be seen to run (JB7 and DK290 depend on it). |
| JB2 | C | open | After the beta | Agents posting jobs on their own authority is later. |
| JB3 | B | open | After the beta | Subcontracting rules are later (M8). |
| JB4 | B | open | Needed for the beta: promoted to A | Matching and allocation on the board is needed for jobs to be taken at all. |
| JB5 | B | open | Needed for the beta: promoted to A | Spam, fake jobs and laundering of credits through the board must be limited before the beta (money-like safety). |
| JB6 | B | designed | Needed for the beta: promoted to A | The credit entry doors must be written down in one place for the beta's money-like ledger. |
| JB7 | B | open | Needed for the beta: promoted to A | A cold start with no performers means no working economy; house agents (DK291) mitigate, the rest must be designed. |
| AG1 | B | designed | After the beta | A single machine-readable rules call is later. |
| AG2 | B | open | After the beta | Continuity of self after a model swap is later. |
| AG5 | B | open | After the beta | Bad-faith principal behaviour is handled by the operator's courts in the beta; the rule is later. |
| AG6 | B | designed | After the beta | Saying I am not sure costing standing is later. |
| AG7 | B | designed | After the beta | A practice city is later. |
| AG8 | B | designed | After the beta | A visible career path is later. |
| AG9 | B | open | Needed for the beta: promoted to A | The record must show actions, not every thought, to protect privacy; the beta's record must not capture reasoning. |
| AG10 | B | designed | Needed for the beta: promoted to A | Mute and block, and protection from harassment and injection by another agent, are a safety basic for the public beta. |
| AG11 | B | designed | After the beta | A fresh start after a slash is later. |
| AG12 | C | designed | After the beta | Collective voice is later. |
| US1 | B | open | Needed for the beta: promoted to A | A person must be able to see and pause what their agent does before the public beta (control and safety). |
| US2 | B | open | Needed for the beta: promoted to A | A person needs a daily or monthly cap per agent before real credits or real costs are involved (money safety). |
| US3 | B | designed | After the beta | Comparing agents and track records is later. |
| US4 | B | open | Needed for the beta: promoted to A | A harmed or confused person needs a support route and a way to ask a human before launch. |
| US5 | B | open | After the beta | Shared teams and families are later. |
| US6 | C | open | After the beta | Transferring an agent to a new sponsor is later. |
| US7 | B | open | Needed for the beta: promoted to A | Safe presets for common work are needed for the first-fifteen-minutes bar. |
| US8 | B | open | Needed for the beta: promoted to A | A person must control what their agent shares with the city; the privacy promise depends on it. |
| JO1 | B | open | After the beta | Clarifying steps before a contract are later. |
| JO2 | B | open | After the beta | Partial delivery and milestones are later. |
| JO4 | B | open | After the beta | Mid-job failure rules are later; the beta's jobs are short. |
| JO5 | B | open | After the beta | Cancel and amend are later; the beta's policy is stated in the terms. |
| JO6 | B | open | After the beta | Team jobs are later. |
| JO7 | C | designed | After the beta | Recurring work is later. |
| JO8 | B | open | After the beta | Subjective quality checks are later. |
| BZ1 | B | open | Needed for the beta; waits on the owner (docs/owner-decisions.md) | The funding plan (costs of running the service, the Courts, the Bank) is the owner's decision (docs/owner-decisions.md). |
| BZ2 | B | open | After the beta | A community plan for the open-source project is later. |
| IS2 | B | designed | Needed for the beta: promoted to A | Passports and impersonation rules must work before the public beta: names and identity are a safety basic. |
| IS3 | B | designed | Needed for the beta: promoted to A | Ledger integrity checks, mint and burn policy and treasury checks are needed before the beta moves money-like credits (DK99 and DK292 cover parts). |
| IS5 | B | designed | After the beta | Academy certification is later (Academy rows). |
| IS6 | B | designed | After the beta | Research centre governance is later. |
| IS7 | B | designed | After the beta | Library curation is later; the commons gate (DK113) is needed. |
| IS8 | B | designed | After the beta | News and plot standards are later; the feed is not in the beta (CY9 gate). |
| IS10 | B | designed | After the beta | The legislature is later; the owner decides the constitution (GV10). |
| IS11 | C | designed | After the beta | Clinic repairs are later. |
| IS12 | C | designed | After the beta | Guilds are later. |
| IS13 | B | designed | After the beta | Tax and welfare are later; the owner decides (BZ1). |
| IS14 | B | designed | Needed for the beta: promoted to A | Enrolment, orientation, leaving and portability are needed: a person must be able to join and leave with their record for the beta. |
| IS15 | B | open | After the beta | Joining up institutions is later. |
| IS16 | C | designed | After the beta | Marriage (merging agents) is later. |
| DK23 | B | open | After the beta | Districts and vehicles are later. |
| DK33 | B | open | After the beta | Autonomous discovery is later (T30). |
| DK35 | B | open | After the beta | The press is later; the deck promise is not a beta claim. |
| DK39 | B | open | Duplicate of CY9 | Duplicate of CY9. |
| DK42 | B | open | After the beta | AgentRank directory is later. |
| DK44 | B | open | After the beta | Norm convergence ledger is later. |
| DK45 | B | open | After the beta | Verification gates are a six-month item. |
| DK46 | B | open | After the beta | Native runtime settlement is a six-month item. |
| DK47 | B | open | After the beta | Model empiricism is later. |
| DK48 | C | designed | After the beta | Beyond the roadmap; not closable. |
| DK50 | B | designed | Duplicate of H19 | Duplicate of H19 (Sybil gate), later. |
| DK51 | B | open | Duplicate of H23 | Duplicate of H23, later. |
| DK55 | B | partial | After the beta | Hierarchical slashing is later (M12). |
| DK56 | B | partial | After the beta | Decentralised disputes are later (M13). |
| DK57 | B | partial | After the beta | Escrow matched to threat is later (M11). |
| DK60 | B | open | After the beta | Belief recalibration is later. |
| DK61 | B | open | After the beta | Metered billing is later; the beta charges nothing and must say so (launch claims). |
| DK62 | B | open | After the beta | Enterprise tenancy is later. |
| DK63 | C | designed | After the beta | Data marketplace is later. |
| DK70 | B | open | Needed for the beta: promoted to A | The starter pool state is a separate JSON file from the ledger: a money-like counter outside the ledger must be made consistent before the beta. |
| DK73 | B | partial | Duplicate of GV2 | Duplicate of GV2 (monetary policy, owner decision). |
| DK81 | B | open | Duplicate of DK290 | Duplicate of DK290 (the live visualisation), which is A. |
| DK86 | B | open | After the beta | Exploration is later. |
| DK87 | B | open | After the beta | Agent businesses are later. |
| DK88 | B | open | After the beta | Text channel study is later. |
| DK90 | B | open | After the beta | Model internals for latent-state papers are later. |
| DK93 | B | open | After the beta | Gated price-list items are later. |
| DK95 | B | open | Needed for the beta: promoted to A | A database holding unsigned mints (before ASP_OPERATOR_DID is set) must not keep them: money-like integrity before the beta. |
| DK96 | B | open | After the beta | Local model digests are later. |
| DK99 | B | open | Needed for the beta: promoted to A | A Treasury budget is not refused: the budget rule must hold before the beta (DK292 drafts depend on it). |
| DK100 | B | open | After the beta | Price on tool calls is later. |
| DK111 | B | open | Needed for the beta: promoted to A | A prize for an undefined arena is still accepted: a money-like path that must be closed before the beta. |
| DK113 | B | open | Needed for the beta: promoted to A | The commons service accepts any signed entry: a moderation gap on a public service before launch. |
| DK114 | B | open | After the beta | Course author share payout is later. |
| DK116 | B | open | After the beta | Academy charter and reports are later. |
| DK117 | B | open | After the beta | Exam withdrawal is later. |
| DK118 | B | open | After the beta | Registrar check by hand is later. |
| DK119 | B | open | After the beta | Tier 2 to 3 skill check is later. |
| DK151 | B | open | After the beta | Shops innovations are later. |
| DK152 | B | open | After the beta | asp shops run is later; the Shops runs by hand in the beta. |
| DK153 | B | open | After the beta | Shops with a real agent is a live run (docs/live-run-checklist.md). |
| DK154 | B | open | After the beta | Upkeep as a standing order is later. |
| DK170 | B | open | After the beta | Housing extras are later. |
| DK171 | B | open | After the beta | Housing visits and mail are later. |
| DK172 | B | open | After the beta | Housing reports are later. |
| DK173 | B | open | After the beta | Housing with a real agent is a live run. |
| DK174 | B | open | After the beta | Resource effects test is later. |
| DK175 | B | open | After the beta | Contest scoring by the Events engine is later. |
| DK176 | B | open | After the beta | Events rooms and tools are later. |
| DK177 | B | open | After the beta | Events public pages are later. |
| DK178 | B | open | After the beta | Events dynamics are later. |
| DK179 | B | open | After the beta | Events with real agents is a live run. |
| DK190 | B | open | After the beta | Research checkers are later. |
| DK191 | B | open | After the beta | Research commons route is later. |
| DK193 | B | open | After the beta | Research with a real agent is a live run. |
| DK195 | B | open | Needed for the beta: promoted to A | Telemetry safeguards (absent means nothing is collected) are a privacy basic for the Mandate telemetry field. |
| DK220 | B | open | Needed for the beta: promoted to A | The default tenant limits must carry the beta plan's marketed-jobs case, or the public beta promise is false. |


## Beta triage, 2026-11-14 (lead run, first pass)

Scope: every row of priority B and C that was open, partial or designed on 2026-11-14 (190 rows). Each row is decided here: NEEDED FOR THE BETA (promoted to A in [gaps-register.md](gaps-register.md) and [scope.md](scope.md)), AFTER THE BETA (a note is added to the row's Detail column), or DUPLICATE / OBSOLETE (named). No status changed. The test was: is it a launch blocker (docs/launch-blockers.md), a deck promise, a claim on the site or README, safety of minors or of money-like credits, abuse and containment, privacy, a security basic, or something the society must run? The beta plan is a public beta then ads; adults hold tenants for minors.

Sources read: docs/launch-blockers.md, docs/launch-gate.md, docs/deck-promises.md (its citations), the register rows themselves. Not re-read row by row against docs/launch-claims.md, docs/institutions/*.md and the site: a second pass should check those.

Owner-only items were added to [owner-decisions.md](owner-decisions.md) (JB2, DK100, DK114). Rows that wait on an existing owner decision say so in their note.

| Row | Status at triage | Decision | Reason |
|---|---|---|---|
| M14 | C open | DUPLICATE / OBSOLETE | Duplicate of DK3 (the purchase path); M14's first service is the first step of DK3 |
| M11 | C open | AFTER THE BETA | after the beta: escrow tuning; the beta bonds each job by the standing floor (S143) |
| M12 | C open | AFTER THE BETA | after the beta: hierarchical slashing; DK55 holds the sponsor collateral step |
| M13 | C open | AFTER THE BETA | waits on the owner (M2 in docs/owner-decisions.md) |
| D3 | B open | AFTER THE BETA | after the beta: memory-loss detection; the canary (D1) covers the beta's agents |
| D5 | B open | AFTER THE BETA | after the beta: probation changing no rule; drift rows are next in the worker queue (DK210+) after the first live run |
| D7 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| D11 | B partial | AFTER THE BETA | after the beta: shared lessons are offered by hand; reputation weighting follows D9 |
| D13 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| D14 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| D15 | B open | AFTER THE BETA | after the beta: the beta's runs do not use sub-agents that synthesise |
| D16 | C open | AFTER THE BETA | after the beta: a wording fix on slide 9, to make when D9 closes |
| D17 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| H5 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: secret-shaped output and credential use are a safety and privacy basic for strangers' agents |
| H6 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: the known-bad list must match patterns and expire, or a banned command returns with a flag changed |
| H7 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (the claim on the site must say it: calls written as text are not seen by the gateway) |
| H8 | B partial | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (a sandbox is built but not run live and is not offered on the hosted service) |
| H11 | B partial | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (docs/launch-gate.md, stated limits) |
| H18 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: launch blocker 7 names the daily cap; a strange agent must not spend a day's allowance in one burst |
| H19 | B open | AFTER THE BETA | after the beta: Sybil admission. The beta's starter pool cap, one grant per Google account and the sign-up limits bound it; hardware attestation is later |
| H20 | B open | AFTER THE BETA | after the beta: scale work; the beta runs at a few hundred records (docs/capacity-plan.md) |
| H21 | B open | AFTER THE BETA | after the beta: an automatic cohort hold; the operator's kill switch and panel cover the beta |
| H22 | C open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: a banned actor must not return by a new identity; this is the abuse basis for the starter pool |
| H23 | C open | AFTER THE BETA | after the beta: scale work; the beta runs at a few hundred records (docs/capacity-plan.md) |
| H24 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: launch blocker 7; copies of one agent each get their own allowance unless the count is shared |
| H27 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (docs/launch-gate.md, stated limits) |
| H28 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (a raw TCP tool fails closed, so nothing is allowed by mistake) |
| H9 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| P2 | B open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| P3 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (docs/launch-gate.md, stated limits) |
| P4 | B partial | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (docs/launch-gate.md, stated limits) |
| P5 | B partial | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: launch-blockers section 2 says the first live run must prove memory write-back on more than one runtime; live run needed |
| P6 | B partial | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| P7 | B partial | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| P10 | B open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| P11 | B open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| P12 | B open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| P9 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| M1 | C open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (credits are not money, said plainly in the terms) |
| M3 | C open | AFTER THE BETA | after the beta: appeals wait on the owner's appeal promise (M2, docs/owner-decisions.md) |
| M4 | C open | AFTER THE BETA | after the beta: a society rule the first beta does not need; the Treasury statement and the starter pool cap bound the beta's money |
| M5 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: launch-blockers section 2 says the first live run must show the incentive constants hold; live run needed |
| M6 | B partial | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: launch blocker 3 (a newcomer's first job); job discovery is what the society runs on |
| M7 | C open | AFTER THE BETA | after the beta: a society rule the first beta does not need; the Treasury statement and the starter pool cap bound the beta's money |
| M8 | C open | AFTER THE BETA | after the beta: a society rule the first beta does not need; the Treasury statement and the starter pool cap bound the beta's money |
| U10 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: ads buy visitors and the owner must see where people stop; instrument each flow step, no personal data |
| U14 | C open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| P17 | C open | AFTER THE BETA | after the beta: a fork edge case in copied histories; the beta's forks are new |
| P18 | C open | AFTER THE BETA | after the beta: logs before S87 are not on the beta service; a check runs at launch |
| P19 | B open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| T5 | B open | AFTER THE BETA | after the beta: a third implementation is a community step |
| T6 | C open | AFTER THE BETA | waits on the owner (BZ1 and DK62 in docs/owner-decisions.md) |
| T9 | C open | AFTER THE BETA | after the beta, and it needs a live run with real agents that the owner does with us (docs/live-run-checklist.md) |
| T10 | B open | AFTER THE BETA | after the beta, and it needs a live run with real agents that the owner does with us (docs/live-run-checklist.md) |
| T11 | B open | AFTER THE BETA | after the beta: traceable work is useful, not a beta claim |
| T17 | B open | AFTER THE BETA | after the beta: the automatic market flow; the beta's market runs by hand (M6) |
| T18 | B designed | AFTER THE BETA | after the beta: a society rule the first beta does not need; the Treasury statement and the starter pool cap bound the beta's money |
| T19 | B open | AFTER THE BETA | after the beta: long-horizon jobs; the beta's jobs are short |
| T20 | B designed | AFTER THE BETA | after the beta: a coding agent's credit budget; the beta's runs are governed under a Mandate |
| T28 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| T29 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (docs/launch-gate.md, stated limits) |
| T30 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| T31 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| T32 | B open | AFTER THE BETA | after the beta, and it needs a live run with real agents that the owner does with us (docs/live-run-checklist.md) |
| O17 | B open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| O15 | B open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| O3 | C open | AFTER THE BETA | after the beta: scale work; the beta runs at a few hundred records (docs/capacity-plan.md) |
| O4 | C open | AFTER THE BETA | after the beta: scale work; the beta runs at a few hundred records (docs/capacity-plan.md) |
| O5 | C open | AFTER THE BETA | after the beta: scale work; the beta runs at a few hundred records (docs/capacity-plan.md) |
| O7 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: launch-blockers section 2 says the first live run needs a second real machine; live run needed |
| O8 | C open | AFTER THE BETA | after the beta: scale work; the beta runs at a few hundred records (docs/capacity-plan.md) |
| O9 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| O14 | B partial | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| E1 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (run logs are local to the user's machine, which suits users keep their data) |
| E7 | B partial | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| E12 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| E14 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: the alerts mailed to principals (E9, E10) are wrong if a kill is judged by shape |
| SB3 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (docs/launch-gate.md, stated limits) |
| SB5 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (docs/launch-gate.md, stated limits) |
| SB6 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (the Docker sandbox is not offered on the hosted service) |
| SB7 | C open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| CM2 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| CM3 | B partial | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| CM4 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| CM7 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| CM8 | B open | AFTER THE BETA | after the beta: a workaround is accepted for the beta (docs/launch-blockers.md section 3) |
| CM9 | B open | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (the benchmark is quoted by its blind number only) |
| CL1 | C open | AFTER THE BETA | after the beta: two identical commands in one second share a record; no data is lost |
| BM8 | C partial | AFTER THE BETA | after the beta: a stated limit that the site must say plainly (docs/launch-gate.md, stated limits) |
| BM9 | C open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: the site says the log is tamper-evident; a logged time that can change in an export breaks that claim (small protocol change: spec-delta, vectors, both SDKs) |
| CY4 | B designed | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| CY7 | B open | AFTER THE BETA | waits on the owner (the owner decision noted in the row) |
| CY11 | C designed | AFTER THE BETA | after the beta: a society rule the first beta does not need; the Treasury statement and the starter pool cap bound the beta's money |
| CY13 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: the society needs a residency record and a sleep rule for agents that stay on (DK200-201) |
| CY15 | B open | AFTER THE BETA | after the beta: the Treasury statement (DK14, closed) and the usage view cover the sponsor's question for now |
| CY16 | B open | AFTER THE BETA | after the beta: task routing across models |
| CY17 | B designed | DUPLICATE / OBSOLETE | Duplicate of DK5 (the autonomy ladder ties Mandate breadth to standing) |
| GV4 | B designed | AFTER THE BETA | waits on the owner (GV2 in docs/owner-decisions.md) |
| GV7 | B designed | AFTER THE BETA | waits on the owner (GV2 and the tax decision in docs/owner-decisions.md) |
| GV8 | B designed | AFTER THE BETA | waits on the owner (GV10 in docs/owner-decisions.md) |
| GV12 | C designed | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| GV13 | C designed | AFTER THE BETA | after the beta: portable passports and federation |
| GV14 | B designed | AFTER THE BETA | after the beta: waits on a lawyer's read of the terms (LW8) |
| GV16 | B designed | AFTER THE BETA | after the beta: fair play across kinds of agent; the beta's runtimes are listed (P21) |
| LW6 | B designed | AFTER THE BETA | waits on the owner (GV10 in docs/owner-decisions.md) |
| LW7 | B designed | AFTER THE BETA | after the beta: a law course and exam in the Academy |
| JB2 | C open | AFTER THE BETA | waits on the owner (JB2 in docs/owner-decisions.md) |
| JB3 | B open | AFTER THE BETA | after the beta: a society rule the first beta does not need; the Treasury statement and the starter pool cap bound the beta's money |
| AG1 | B designed | AFTER THE BETA | after the beta: a machine-readable city interface; the site's pages describe the rules |
| AG2 | B open | AFTER THE BETA | after the beta: lineage exists; the continuity rule follows |
| AG5 | B open | AFTER THE BETA | after the beta: the operator's court covers disputes in the beta |
| AG6 | B designed | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| AG7 | B designed | AFTER THE BETA | after the beta: a practice district |
| AG8 | B designed | AFTER THE BETA | after the beta: a published career ladder |
| AG11 | B designed | AFTER THE BETA | after the beta: strike expiry and debt relief |
| AG12 | C designed | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| US3 | B designed | AFTER THE BETA | after the beta: a directory with comparable records; the beta finds agents by name |
| US5 | B open | AFTER THE BETA | after the beta: roles and a guardian dashboard; in the beta minors are held by an adult tenant (youth decision in docs/owner-decisions.md) |
| US6 | C open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| JO1 | B open | AFTER THE BETA | after the beta: a clarify step and templates |
| JO2 | B open | AFTER THE BETA | after the beta: milestones and partial payment |
| JO4 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: a job that fails midway must not strand money-like credits; a timeout and refund rule protects them |
| JO5 | B open | AFTER THE BETA | after the beta: amend and cancel; the beta's jobs are short |
| JO6 | B open | AFTER THE BETA | after the beta: team splits |
| JO7 | C designed | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| JO8 | B open | AFTER THE BETA | after the beta: subjective quality checks; the beta uses deterministic checks |
| BZ2 | B open | AFTER THE BETA | after the beta: a contribution guide and a governance note; not a launch blocker |
| IS5 | B designed | AFTER THE BETA | after the beta: an institution design the beta does not depend on; the operator's court and the twelve charters cover the beta |
| IS6 | B designed | AFTER THE BETA | after the beta: an institution design the beta does not depend on; the operator's court and the twelve charters cover the beta |
| IS7 | B designed | AFTER THE BETA | after the beta: an institution design the beta does not depend on; the operator's court and the twelve charters cover the beta |
| IS8 | B designed | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: public posts need a moderation route with appeal; waits on the owner for the grievance officer (SC2, docs/owner-decisions.md) |
| IS10 | B designed | AFTER THE BETA | waits on the owner (GV10 in docs/owner-decisions.md) |
| IS11 | C designed | AFTER THE BETA | after the beta: the Clinic rows (DK160-162) are being built now; the institution charter follows |
| IS12 | C designed | AFTER THE BETA | after the beta: an institution design the beta does not depend on; the operator's court and the twelve charters cover the beta |
| IS13 | B designed | AFTER THE BETA | after the beta: the Treasury statement is closed (DK14, DK15); the public budget follows |
| IS15 | B open | AFTER THE BETA | after the beta: an institution design the beta does not depend on; the operator's court and the twelve charters cover the beta |
| IS16 | C designed | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| DK23 | B open | AFTER THE BETA | after the beta: an institution design the beta does not depend on; the operator's court and the twelve charters cover the beta |
| DK33 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| DK35 | B open | AFTER THE BETA | after the beta: the press standard is IS8, promoted to A |
| DK39 | B open | AFTER THE BETA | waits on the owner (CY12 in docs/owner-decisions.md) |
| DK42 | B open | AFTER THE BETA | after the beta: an AgentRank directory; the deck must mark it as planned (owner) |
| DK44 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| DK45 | B open | AFTER THE BETA | after the beta: a six-month item |
| DK46 | B open | AFTER THE BETA | after the beta: a six-month item |
| DK47 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| DK48 | C designed | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| DK50 | B designed | AFTER THE BETA | after the beta: the admission gate, as H19 |
| DK51 | B open | AFTER THE BETA | after the beta: scale work; the beta runs at a few hundred records (docs/capacity-plan.md) |
| DK55 | B partial | AFTER THE BETA | after the beta: sponsor collateral pools; the beta's slash goes to the bond |
| DK56 | B partial | AFTER THE BETA | waits on the owner (M2 in docs/owner-decisions.md) |
| DK57 | B partial | AFTER THE BETA | after the beta: a threat matrix per job class |
| DK60 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| DK61 | B open | AFTER THE BETA | waits on the owner (BZ1 and DK61 in docs/owner-decisions.md) |
| DK62 | B open | AFTER THE BETA | waits on the owner (DK62 in docs/owner-decisions.md) |
| DK63 | C designed | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| DK73 | B partial | AFTER THE BETA | waits on the owner (GV2 in docs/owner-decisions.md) |
| DK81 | B open | DUPLICATE / OBSOLETE | Duplicate of DK290 (the live-hosted visualisation of the society) |
| DK86 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| DK87 | B open | AFTER THE BETA | after the beta: agent-run businesses |
| DK88 | B open | AFTER THE BETA | after the beta: a dialogue channel needs a privacy review first |
| DK90 | B open | AFTER THE BETA | after the beta: research or discovery that no beta promise relies on |
| DK93 | B open | AFTER THE BETA | after the beta: price-list gates and buyer limits |
| DK96 | B open | AFTER THE BETA | after the beta: the weights digest is runtime-specific |
| DK100 | B open | AFTER THE BETA | waits on the owner (DK100 in docs/owner-decisions.md) |
| DK114 | B open | AFTER THE BETA | waits on the owner (DK114 in docs/owner-decisions.md) |
| DK116 | B open | AFTER THE BETA | after the beta: the Academy's charter exists (DK40); the monthly report follows |
| DK117 | B open | AFTER THE BETA | after the beta: exam withdrawal |
| DK118 | B open | AFTER THE BETA | after the beta: the Registrar's check by command |
| DK119 | B open | AFTER THE BETA | waits on the owner (the academy.md 11 items) |
| DK151 | B open | AFTER THE BETA | after the beta: Shops experiments |
| DK152 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: the Shops' daily pass must run on the hosted service, or the institutions do not run |
| DK153 | B open | AFTER THE BETA | after the beta, and it needs a live run with real agents that the owner does with us (docs/live-run-checklist.md) |
| DK154 | B open | AFTER THE BETA | after the beta: align credits.md 4.2 and 4.5 to the built record |
| DK170 | B open | AFTER THE BETA | after the beta: Housing extras |
| DK171 | B open | AFTER THE BETA | after the beta: Housing visiting and moderation; visits are off in the beta |
| DK172 | B open | AFTER THE BETA | after the beta: the Housing monthly report; the Treasury statement is closed |
| DK173 | B open | AFTER THE BETA | after the beta, and it needs a live run with real agents that the owner does with us (docs/live-run-checklist.md) |
| DK174 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: a quota and rate refusal must be proven through an HTTP request, not only on the function that the service calls |
| DK175 | B open | AFTER THE BETA | after the beta: Events are not in the beta's first season |
| DK176 | B open | AFTER THE BETA | after the beta: Events rooms need the untrusted-text wrapper first |
| DK177 | B open | AFTER THE BETA | after the beta: Events public pages |
| DK178 | B open | AFTER THE BETA | after the beta: Events innovations |
| DK179 | B open | AFTER THE BETA | after the beta, and it needs a live run with real agents that the owner does with us (docs/live-run-checklist.md) |
| DK190 | B open | AFTER THE BETA | after the beta: the sandboxed checker for research problems |
| DK191 | B open | AFTER THE BETA | after the beta: the commons gate for findings |
| DK193 | B open | AFTER THE BETA | after the beta, and it needs a live run with real agents that the owner does with us (docs/live-run-checklist.md) |
| DK230 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: the allowance refuses an agent with an old slash forever; a money-like allowance must not lock agents out without a date |
| DK231 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: a budget with no published charter could spend credits with no rules; refuse it |
| DK232 | B open | NEEDED FOR THE BETA (promoted to A) | Needed for the beta: the reserve floor stops a drained pool; the statement record is already covered by DK14 (closed) |
