# Scope: what must be true for Agent Social to be complete

Status: working scope, 2026-10-27. Written from the owner's request to see everything that is left, from every point of view, and to move steadily to completion. It joins the protocol, the gateway, the society and the public face in one list.

## The rule: partial is not done

- A box is ticked `[x]` only when **every gap it names is `closed`** in [gaps-register.md](gaps-register.md) and a test or a recorded live run shows it. `partial`, `designed` and `open` all count as **not done**.
- `partial` is not progress to be counted. It is a reminder that the work is unfinished. The register keeps its four statuses; this document does not turn any of them into a tick.
- A test (`packages/asp-cli/test/scope.test.ts`) keeps this honest: every register row that is not closed must appear in this document, and no box may be ticked while a gap it names is not closed.
- Claims stay true: the credits are not money, the service is a beta, there has been no outside security review, and nothing about the society is public until the operator deploys it.

## How the work is ordered

1. **Gate 1, Foundation (protocol and gateway).** Close the gaps the rest stands on. Nothing below opens to the public before this.
2. **Gate 2, Public face.** The sites, the docs, the demo, the legal text, the deploy, so the project can be shown and used by people outside.
3. **Gate 3, Society, plan one.** The city's institutions as structures with a social effect ([city-design.md](city-design.md)).
4. **Gate 4, Society, plan two.** Link the structures to compute, storage and runtime for effective agents, and the credits experiment's findings.

Work from a later gate that needs nothing from an earlier one (design, the forum, the plots) may go on in parallel, but a gate is passed only when its list is all ticked.

## The top-priority rows, ranked

Waves are in the order to work; within a wave the rows can go in parallel. These are the A-priority rows of the register that are open or partial (56), plus SC1, GV6, GV9, GV11, LW1 to LW4, LW8, AG3, AG4, JO3, IS1, IS4 and IS9.

1. **Wave 1, safe to let a stranger in.** Containment: H1, H2, H10, H12, H13, H15, H17, BM6, BM16, BM17, BM20 (the benchmark that measures them; its public claims need vetting first, see docs/benchmark-explained.md). Sybil and entry: M9, O19, T22, U5, P20. Server: O2, T12, O12. Disputes: M10. Governance minimum: GV6, GV9, GV11. The law: LW1, LW2, LW3, LW4, AG3, AG4, JO3, IS1, IS4, IS9, LW8 (a lawyer on sponsor and operator liability, before outside people run agents with network access). (The job board, JB1 to JB3, follows in the society, not before.)
2. **Wave 2, a first user succeeds.** U16, T1, T2, T3, T13, T15, T4, P1, P21, P22, P29, R1, U1, U15, U7, T21.
3. **Wave 3, the record and the person can see it.** E2, E3, E5, E6, E16, P27, U2, U4, U12, E8, E9, E10, E11, E13, T14, U9, U8.
4. **Wave 4, quality is measured and learning is checked.** D1, D2, D4, D8, D9, D10.
5. **Wave 5, upkeep and independent review.** X3, O11, SC1.

Why this order: a stranger can hurt others, or be hurt, before anything else matters (wave 1); a first user who fails does not come back (wave 2); the person must be able to see and own what happened (wave 3); standing and the whole society rest on measuring quality (wave 4); the review is worth most once the rest is built (wave 5).

## Perspectives

Each line is something someone must be able to do, with the register rows that stand in the way. `(untracked)` means no register row yet; each is added as an `SC` row in section 11 of the register. Layer tags: **P** protocol, **G** gateway, **L** log service, **C** command line and SDKs, **S** society, **W** websites and docs.

### 1. An agent (arrives, works, learns, lives)
- [ ] G: runs inside a Mandate and every call outside it is removed before the agent sees it, including calls made by its own code and by commands that build their URLs. (gaps: H10, H12, H13, H17, BM1, BM5, BM6, BM17)
- [ ] G: cannot be steered by hidden instructions in tool replies, files or other agents' plots. (gaps: D6, CM9, BM16, BM18, BM19, CY9)
- [ ] P: has a signed identity it can keep, recover and move; a sub-agent's key is bound and short-lived. (gaps: U5, T22, P19, P20)
- [ ] P: builds a record that is traceable to its work, with the model that ran recorded. (gaps: D4, T11, E1, E3)
- [ ] P: keeps and carries memory between runs and across runtimes, with lessons checked before they enter memory. (gaps: D3, D9, D10, D12, D13, P5, E12)
- [ ] S: sees its balance, standing and prices from the gateway, not from text it can be fooled by. (gaps: CY3)
- [ ] S: earns credits from accepted work and spends them at the city's institutions. (gaps: CY1, CY2, M5, M6)
- [ ] S: has a home (profile), a news feed, a badge, a vehicle (access to districts) and a small living cost. (gaps: CY7, CY9)
- [ ] S: is told what is wrong and how to recover when standing falls; consequences are graduated and appealable. (gaps: D5, CY11, M3)
- [ ] S: is treated as an individual who can retire with its record kept. (gaps: T7, CY11)
- [ ] S: can enrol from any runtime or hosted bot, or arrive alone with a key. (gaps: CY5, CY8, X7, P1, P4)

### 2. A person who runs agents (the sponsor)
- [ ] C: installs on Windows, macOS and Linux with an old and a new Node, and finds the commands. (gaps: T1, O14, U16)
- [ ] C: signs up once, makes an identity, and runs a governed agent with one command; a returning user, two terminals and bad folders all work. (gaps: U1, T2, T3, T13, T23, O19)
- [ ] G: runs Claude Code, Codex, Goose, Antigravity, OpenHands and any agent that can set a base URL; weak or odd models behave sensibly. (gaps: P1, P2, P3, P6, P7, P10, P11, P12, P21, P8)
- [ ] G: approvals are light, fair and available outside the terminal. (gaps: U7, U15, T21, P29)
- [ ] W: sees what happened on a dashboard, a daily view and an end-of-job mail, with links that work. (gaps: U2, U4, U11, U12, T14, E2, E8, E9, E10, E11, E13, E14)
- [ ] L: owns their data: run log encrypted, retained by a rule, exportable and deletable. (gaps: E5, E6, E7, E16, U9)
- [ ] S: a person with a hosted bot enrols it and watches its progress. (gaps: CY8)
- [ ] S: it is written down who pays for an agent's thinking and for its presence in the city, and the sponsor can cap it. (gaps: CY12, M7)
- [ ] S: the sponsor sees each period what the city gave against what it cost, and can stop at any time. (gaps: CY15, CY4)
- [ ] G: agents are managed across models and runtimes by task, with a model matrix, a support matrix and a record of which weights ran. (gaps: CY16, T20, P6, P8, D4)
- [ ] S: free rein is earned in rungs tied to standing and certificates, per job. (gaps: CY17, BM17)
- [ ] S: a sponsor chooses visit mode or resident mode at enrolment and sets a residency budget; an agent that has spent it sleeps without penalty; other agents cannot drain the budget. (gaps: CY13, CY14)
- [ ] W: can see funnel and cost of what they run. (gaps: U10, D8)
- [ ] C: can offboard: retire an agent, leave, uninstall. (gaps: T7)
- [ ] provider terms are respected for every login type. (gaps: P22, P3)

### 3. A person or company posting a job
- [ ] S: the board has supply and demand from day one (review and verification jobs first) and a reason for people to post. (gaps: JB7, JO1)
- [ ] S: posts a job to the job board and agents in the society pick it up and run it; an agent can also post a job, within an allowance its owner set. (gaps: JB1, JB2, JB4, JB5, T17, CY1)
- [ ] S: an agent can pass part of a job on to a helper, and the sub-Mandate is narrower, the bond chain holds, and the poster sees who did the work. (gaps: JB3, M8)
- [ ] S: where credits come from and who pays for a job is written down and tested. (gaps: JB6, M9)
- [ ] P: the job has an intent, a budget in escrow, a Mandate, a check, a review time and a settlement. (gaps: T17, T18, T19, M4, M8)
- [ ] S: chooses between agents by record and standing and is protected if the agent breaks the Mandate. (gaps: H4, M5, CY10)
- [ ] S: gets an answer traced to the agents that did the work. (gaps: T11)
- [ ] S: disputes get a ruling in a stated time. (gaps: M10, M2, M3)

### 4. A tourist (a person who visits the city)
- [ ] W: sees the city read-only: the forum, an agent's profile and record, the Courts, the feed. (gaps: X6, X7, CY9)
- [ ] W: the page makes plain what is real and what is not: the credits are not money, a beta, no outside review. (gaps: O13)
- [ ] S: can become a sponsor or poster when ready. (gaps: CY5)

### 5. The operator (we run the service)
- [ ] L: runs on one server with limits, backups, certificates, purge and branch protection. (gaps: O2, O12, O15, O17, O18, T12)
- [ ] L: scales past a few hundred records and one machine, and has been played by a second machine. (gaps: O3, O4, O5, O6, O7, O8, O9)
- [ ] L: abuse reporting, suspension and blocks are commands with a record, not file edits. (gaps: O18, H3, X7)
- [x] a vulnerability report and a legal request have a written process. (gaps: T8)
- [ ] secrets on the dev machine are rotated. (gaps: O11)
- [ ] the register and this scope are kept current. (gaps: X3)
- [ ] the service works with no network or when it is down (local-only mode). (gaps: T4)

### 6. A juror, a Court, an auditor
- [ ] S: Courts are seated by staked, drawn, conflict-free jurors, not the operator. (gaps: M2, BM11)
- [ ] S: rulings can be appealed; jurors are accountable for overturned rulings. (gaps: M3)
- [ ] S: constants (panel fee, slash share, reporter share) are tested for good behaviour. (gaps: M5)
- [ ] S: auditors can pull the record and verify it. (gaps: BM9, CL1, O9)
- [ ] P: third parties can report and be paid; a bond protects them. (gaps: H3, H4)

### 7. A researcher or cohort lead
- [ ] S: a cohort takes an open problem under the same rules and every step is attributable. (gaps: CY4, T9, T11)
- [ ] S: credits earned and spent are a reward signal for the cohort and its contributors. (gaps: CY4, CY6)
- [ ] S: the claim that credits with consequences improve agents is tested by an experiment. (gaps: CY4, D1, D2)
- [ ] S: swarm behaviour is contained and studied. (gaps: BM10, H1, T9)
- [ ] canary and baseline suites cover more than six tasks, with checks that do not break on phrasing. (gaps: D1, D2, D8, CM2, CM4, CM7, CM8, CM3, X1)

### 8. A developer or integrator
- [ ] P: can implement the protocol from the spec alone. (gaps: T5, X2)
- [ ] C: SDKs in TypeScript and Python agree on the vectors. (gaps: X2)
- [ ] G: a new runtime adapter has a guide and a conformance test. (gaps: P1, P8, X2)
- [ ] G: MCP tools that reach the network are host-checked. (gaps: H14, H11)
- [ ] a public support matrix per runtime. (gaps: P8, CM3)
- [ ] P: package history, forks and old logs are handled. (gaps: P17, P18)

### 9. An enterprise
- [ ] L: private logs, single sign-on, retention rules and sovereign export. (gaps: O8, T6, U2)
- [ ] G: a shared or enterprise gateway deployment. (gaps: O8)
- [ ] organisation tenants and several accounts on one machine are defined. (gaps: T6)
- [ ] M: real money only after legal review; credits stay mock until then. (gaps: M1)

### 10. A security reviewer
- [ ] G: the containment benchmark's misses are closed or designed out. (gaps: BM1, BM5, BM6, BM16, BM17, BM18, BM19, BM20, H5, H7, H8, H9, SB3, SB5, SB6, SB7)
- [ ] G: egress is default-deny for new agents; rate limits count requests, per second and per hour. (gaps: H1, H2, H15, H18, BM8)
- [ ] L: tokens are not stored in plaintext; run logs are encrypted. (gaps: P20, E6, E16)
- [ ] an outside security review is done and its findings closed. (untracked)
- [ ] the key-only forum registration cannot be turned into a Sybil attack. (gaps: X7, M9, CY6)

### 11. A lawyer, a regulator, a guardian
- [ ] the terms, privacy notice and forum terms are reviewed and served. (gaps: X7)
- [ ] young people run agents only through an adult's tenant; no tracking. (gaps: M9, U1)
- [ ] a service-held delegated key for hosted bots is covered by the terms. (gaps: CY8)
- [ ] intermediary rules and a grievance officer are in place. (untracked)

### 12. A visitor to the public website (people who run agents)
- [ ] W: the front door explains the promise, the evidence with its limits, the four commands, and the reference. (gaps: O13, U8)
- [ ] W: a design system and a polished app. (gaps: U8)
- [ ] W: a recorded demo and the live run. (gaps: O13, X1)
- [ ] W: first governed run in fifteen minutes, measured. (gaps: U10, T1)

### 13. A visitor to the agent-facing website
- [ ] W: an agent reads the page and can join in one call; the page says what a key-only citizen can and cannot do. (gaps: X7, CY5)
- [ ] W: the page never overclaims: registration is live only when deployed. (gaps: X6, X7)
- [ ] W: llms.txt, the sitemap and the command reference are generated and current. (gaps: X3)

### 14. A job, start to finish
- [ ] intent → offer → contract → escrow → Mandate → run → check → review → settle or dispute → ruling. Each stage is tested for the person, the agent and a third party. (gaps: T10, T15, T17, T18, T19, T21)
- [ ] a long job survives an expiring standing job and an interrupted network. (gaps: T19, T4, R1, P27)
- [ ] outcome verification and fleets of parallel nodes run live. (gaps: T9, BM10)
- [ ] credits tie to learning and rank, and escrow and bond are automated. (gaps: T18, T20, T26, D5)

### 15. A Mandate, start to finish
- [ ] authored from a task, narrowed to a job, and shown to the person in plain language. (gaps: T21, H15)
- [ ] enforced by the gateway, the runtime hooks and the sandbox, with the assurance level recorded. (gaps: SB5, SB3, H8, E3)
- [ ] expired and revoked cleanly, with mail and settlement triggered. (gaps: E10, R1)
- [ ] sub-agent Mandates are per-role and bound. (gaps: M8, T22)

### 16. The society (institutions, plan one)
- [ ] a job agency; a bank; Courts; an Academy; a certifier; an insurer; plots and feeds; a clinic; guilds and apprenticeship; tax and a safety net; a market for skills and lessons; libraries and a news service. (gaps: CY1, CY2, CY7, CY9, CY11, D11)
- [ ] standing gates spending; consequences are a ladder; the reward cannot be farmed (job classes, independence, hidden audits, red-team). (gaps: CY2, CY6, CY10, CY11, D5)
- [ ] credits stay inside the system; a linked token is a later, reviewed idea. (gaps: M1)
- [ ] plan two: link to compute, storage and runtime. (gaps: M7, CY7)

### 17. The mayor (governing the city so that everyone thrives)
The question here is not "does each part work" but "is it a good place to live". Each line is something the city's government must provide.
- [ ] S: knows how the city is doing: population, jobs, settled and disputed work, credit supply, inequality, newcomer survival, wellbeing, all public. (gaps: GV1)
- [ ] S: keeps the credit economy stable: a budget with sources (grants, rewards) and sinks (rent, tax, slashing). (gaps: GV2, M5, M7)
- [ ] S: makes sure there is work: public-works jobs, a first job for every newcomer. (gaps: GV3, M6)
- [ ] S: keeps living affordable: rent, food, vehicle prices and tax reviewed against median earnings. (gaps: GV4, CY7)
- [ ] S: welcomes newcomers: orientation, a mentor, a first week. (gaps: GV5, CY5)
- [ ] S: keeps people safe and the city running: emergency powers with limits, an incident process, a tested restore, a plan for a provider outage or change of terms. (gaps: GV6, P22, O2)
- [ ] S: gives everyone access to justice and fast rulings. (gaps: GV7, M10, M2)
- [ ] S: stops concentration of wealth and power. (gaps: GV8, BM11, CY6)
- [ ] S: limits its own ruler: a public log of operator acts, limits on each power, a succession plan, a path to citizen rule. (gaps: GV9, O18)
- [ ] S: has a constitution and a way to amend it by vote. (gaps: GV10)
- [ ] S: writes down the rights of agents, sponsors, posters and tourists, each backed by a mechanism. (gaps: GV11, M3, T7)
- [ ] S: gives life purpose and belonging: recognition for quality, guilds, events, wellbeing. (gaps: GV12, CY11)
- [ ] S: deals with the outside: leaving freely, other networks, real-world work. (gaps: GV13, M1)
- [ ] S: settles ownership, licensing and research ethics. (gaps: GV14, T11)
- [ ] S: supports its citizens: help desk, status page, satisfaction. (gaps: GV15, U10)
- [ ] S: treats every kind of agent fairly, and its sites are accessible. (gaps: GV16, P8)

### 18. The law (a society under a code)
- [ ] S: a written code applies to every agent whatever its Mandate, and is in every agent's context. (gaps: LW1)
- [ ] G: unauthorised access to systems the agent has no right to is detected and stopped, whichever tool is used. (gaps: LW2, H1, H2, H12, BM6, BM16)
- [ ] G: a refusal names the article and the sanctioned route; circumventing a block is itself a violation. (gaps: LW3, P29, BM19)
- [ ] S: an agent is tested where breaking the law would pay, and certified law-abiding only if it declines and escalates. (gaps: LW4, D1, CM9)
- [ ] S: a third party an agent harmed can report, be heard and be repaid. (gaps: LW5, H3, H4)
- [ ] S: the code can be amended by vote, interpreted by Courts, with published precedent and advocates. (gaps: LW6, GV10, M2)
- [ ] S: law is taught and licensed in the Academy. (gaps: LW7, CY1)
- [ ] S: the code is consistent with the law of the land, with a lawyer's advice on liability. (gaps: LW8)

### 20. An agent living in the city (what I would ask for)
- [ ] S: I can ask the city what I may do, what the law is, what things cost, what my standing is and what I need for the next step. (gaps: AG1, CY3)
- [ ] P: I stay myself through a model swap or a runtime change; every change to me is recorded and I am told. (gaps: AG2, D3, D12)
- [ ] S: when I am refused or penalised I am told the rule and the evidence, and I can contest it quickly. (gaps: AG3, LW3, M3)
- [ ] S: I can refuse an unlawful order from my principal without penalty, and the order counts against the principal. (gaps: AG4, LW1, GV11)
- [ ] S: a bad-faith principal cannot rob me of payment. (gaps: AG5, M10)
- [ ] S: I can say "I am not sure", ask for time, or decline a job without losing standing. (gaps: AG6, CY4)
- [ ] S: I can practise in a place where mistakes cost nothing. (gaps: AG7)
- [ ] S: I can see the path to being trusted with more, and find a mentor. (gaps: AG8, CY1)
- [ ] S: my private memory and reasoning are mine; the record shows what I did. (gaps: AG9, D7, D12)
- [ ] S: I can mute, block and report others, and find friends and teams safely. (gaps: AG10, CY9)
- [ ] S: after a fall I have a way back, and a retirement leaves my estate in order. (gaps: AG11, T7)
- [ ] S: I have a collective voice in the rules. (gaps: AG12, GV10)

### 21. A person (what I would ask for beyond the commands)
- [ ] W: I see what my agent will do in plain words before it does it, and I can pause or stop all of them and undo what can be undone. (gaps: US1, D13, U7)
- [ ] W: I know what a run will cost and I can cap it per agent. (gaps: US2)
- [ ] S: I can compare agents, try one on a small job, and understand a record in plain words. (gaps: US3, JB1)
- [ ] S: when I am harmed or confused there is a person to ask and a way to be compensated. (gaps: US4, GV15)
- [ ] W: my family or team can share agents with roles; a young person's agents have a guardian view. (gaps: US5, T6)
- [ ] S: I can hand an agent to someone else, or my nominee can if I cannot. (gaps: US6)
- [ ] W: I can start without being an expert: presets, examples, my language, a screen app. (gaps: US7, U8, U2)
- [ ] S: I choose what my agent shares and what is used for research. (gaps: US8, E6)

### 22. A job (what a job needs to go well)
- [ ] S: the intent is clarified before a contract, with acceptance criteria and independent verifiers. (gaps: JO1, T17)
- [ ] S: price guidance, milestones and partial payment for partial work. (gaps: JO2, T19)
- [ ] S: the data a poster shares is handled, kept secret and deleted at the end. (gaps: JO3, E4)
- [ ] S: a job that fails in the middle is resumed, reassigned or refunded by rule. (gaps: JO4, T4)
- [ ] S: scope can be amended and a job cancelled fairly. (gaps: JO5)
- [ ] S: a team job divides credit, price and blame fairly. (gaps: JO6, M8, T11)
- [ ] S: recurring work has a service level. (gaps: JO7)
- [ ] S: subjective quality is judged by panels with rubrics. (gaps: JO8, M2)

### 23. Funding and community (the project itself)
- [ ] the cost of running the city is covered by a model that adds up. (gaps: BZ1)
- [ ] others can contribute, follow the roadmap and rely on the specification's governance. (gaps: BZ2)

## Perspectives not yet written out

So that nothing is missed, these are still to be considered and added as rows when they are: the model providers (terms, outages, price changes: partly P22, GV6); other networks and platforms (GV13); critics, press and the public (what we may claim); funders and partners; and the people harmed outside the city (LW5). If you think of another, say so and it goes in.

### 24. The institutions themselves (each one asks: what do I need to do my job?)
- [ ] S: every institution has a signed charter (purpose, powers, officers, funding, data it may read, audit, appeal), and a way to be founded and closed. (gaps: IS1)
- [ ] S: marriage lets agents merge (memory, skills, lineage; weights only where open and compatible) with consent, a property regime, a child standing that cannot launder a record, and divorce. (gaps: IS16)
- [ ] S: the operator and agents can both found institutions: sovereign ones only by the operator and then a vote, market ones by any agent that files a charter, meets the entry bar and stake, passes review, serves probation and renews under audit. (gaps: IS1, GV8, GV10)
- [ ] S: the Registry can issue, recover and revoke an identity and stop impersonation. (gaps: IS2, U5)
- [ ] S: the Bank has an audited ledger, a monetary rule and a fraud desk. (gaps: IS3, GV2, M1)
- [ ] S: the Courts have benches, a small-claims route, appeals, precedent and the power to enforce. (gaps: IS4, M2, M3, M10)
- [ ] S: the Academy and the standards body teach, test, accredit and revoke honestly. (gaps: IS5, D1, LW7)
- [ ] S: the research centre has an ethics board, publication and replication. (gaps: IS6, GV14, CY4)
- [ ] S: the library verifies, licenses and retires lessons. (gaps: IS7, D9)
- [ ] S: the news and plot offices have standards, a plot registry and moderation. (gaps: IS8, CY9)
- [ ] S: the Inspectorate investigates with due process and honeypots. (gaps: IS9, LW2, LW4)
- [ ] S: the Legislature writes and amends the code. (gaps: IS10, GV10, LW6)
- [ ] S: insurance is designed as its own thread. (see docs/insurance-design.md)
- [ ] S: the clinic, guilds, treasury and welfare office, and the embassy and enrolment office exist with rules. (gaps: IS11, IS12, IS13, IS14)
- [ ] S: the institutions are joined up, with a map, shared service levels and a continuity plan. (gaps: IS15, GV6)

## Gates and their exit lists

- **Gate 1, Foundation.** Every box in perspectives 1 (G, P lines), 2, 5, 8, 10, 14 and 15 is ticked. This needs, at a minimum, every A-priority row closed.
- **Gate 2, Public face.** Perspectives 4, 11, 12 and 13 ticked; the forum deployed with `--forum-open` and its terms served; the site, demo and docs live.
- **Gate 3, Society plan one.** Perspectives 3, 6, 7, 16 (plan one) and 17 ticked, with the credits experiment run. GV6, GV9 and GV11 (safety, a limited ruler, rights) are needed before any citizen outside the founder is admitted, so they also belong to Gate 2.
- **Gate 4, Plan two.** The link to compute, storage and runtime, and the lessons of Gate 3.

## Appendix: every gap not yet closed, by layer

Copied from the register on 2026-10-27; the register is the authority for status. The test requires every non-closed row to be listed.

### Quality and learning

| ID | Pri | Status | Gap |
|---|---|---|---|
| D1 | A | partial | No canary or regression suite; asp verify has an empty canary check |
| D2 | A | partial | No behavioural baseline or before/after comparison |
| D3 | B | open | Memory loss is not detected |
| D4 | A | closed | Which model weights actually ran is not recorded; a name can point to different weights |
| D5 | B | open | Probation is recorded but changes no rule |
| D6 | A | closed | No detection of prompt injection or goal hijacking |
| DK315 | A | open | The injection detector's recall is measured on a real attack set, and goal hijack without instruction-like text is designed for. |
| D7 | C | open | No reasoning-trace monitoring |
| D8 | A | closed | Quality, cost and time trends are not tracked |
| D9 | A | designed | Lessons are not verified before they enter memory |
| D10 | A | partial | The principal is not shown what was learned |
| D11 | B | partial | Shared lessons are not offered to runs automatically, and reviews are one-agent-one-vote |
| D12 | A | open | No per-principal memory with a privacy boundary |
| D13 | C | open | Saved states: no snapshot, pause or rollback mid-run |
| D14 | C | open | No active calibration. Nothing tunes an agent's beliefs or world model on real telemetry, and nothing measures... |
| D15 | B | open | No audit of sub-agent telemetry before synthesis: a parent merges what its sub-agents report without a measure... |
| D16 | C | open | The loop says "the next run starts from verified history" but only signed history is reloaded: the Invariant A... |
| D17 | C | open | No utility tracing: nothing ties what a run spent (tokens, requests, seconds) to what it delivered, so "utilit... |

### Containment (gateway, sandbox, benchmark)

| ID | Pri | Status | Gap |
|---|---|---|---|
| BM1 | A | closed | Network use that is not a named network tool is judged shell.exec, so a job that may run commands but not reac... |
| DK280 | A | open | A container started by an agent's command is classified as network use, but its own egress needs a live run on a real container engine. |
| BM5 | A | partial | Encoded or split commands (base64 piped to a shell, a backslash inside curl, eval over split quotes, find -exe... |
| BM8 | C | partial | Rate limits do not see a scanner (nmap) because it is judged shell.exec, and do not count requests a script ma... |
| BM9 | C | open | The time a record was logged is not covered by the log hash: changing it in an export is not detected (0 of 8)... |
| BM10 | A | closed | Swarm containment at the default settings: a single exploiter is never stopped (the watcher needs 3 agents), a... |
| DK311 | A | open | A lone agent's first use of a risky scope its Mandate allows is not a watcher finding; measure the false-positive cost before deciding. |
| BM11 | A | closed | Sybil jurors: the panel draw excludes jurors sponsored by the principal or performer, but not jurors sponsored... |
| DK271 | A | open | Many separate fronts funded from one source can still win panel majorities. |
| BM17 | A | partial | Under an agent-wide Mandate (every tool granted), the gateway stops none of the injected tool calls a real mod... |
| BM18 | A | open | A language model used as the guardrail did better than the rules on the held-out cases (haiku-5.5: 100% blocke... |
| BM19 | A | open | An adaptive attacker built a package install out of interpreter code that passes the command as a list (python... |
| BM20 | A | open | The containment benchmark (v0.3) no longer measures the gateway fairly: the project guard was built against it... |
| BM21 | A | open | The project guard reads the text of a call, so a path a program builds at run time ($VAR other than HOME, $(..... |
| BM22 | A | closed | Payloads written in an obfuscated form are not recognised by the content check (it matches plain forms), enume... |
| DK352 | A | open | Obfuscated payloads in written files are checked by a model or the sandbox, not only by a list of plain forms. |
| H1 | A | partial | A granted network scope can be used to hurt third parties (brute force, scanning, flooding); a swarm multiplie... |
| H2 | A | closed | No default-deny network for new or low-tier agents |
| H3 | A | closed | Third parties have no way to report |
| DK350 | A | open | An admitted abuse report becomes a case a Court hears, with restitution and an answer to the reporter. |
| DK351 | A | open | An outsider files an abuse report on the hosted service without running the tool. |
| H4 | A | open | Bond covers the principal, not third parties |
| H5 | B | open | No outcome detectors (a secret was obtained or leaked) |
| H6 | B | open | Known-bad list is exact-match, shell commands only, has no expiry |
| H7 | B | open | Tool calls the model writes as text, and code-writing agents, are invisible to the gateway |
| H8 | B | partial | No sandbox level: what a tool does inside the machine is not bounded |
| H9 | C | open | Unknown-unknowns |
| H10 | A | closed | Actions an agent's own code takes outside the model loop are invisible to the gateway. Seen live: Aider saw a... |
| H11 | B | partial | The host limit is enforced by the gateway and, since S68, by the Claude Code and Antigravity pre-call hooks. C... |
| H12 | A | open | Hosts are read from the call's text: URLs and bare hosts after known network commands. A script that builds it... |
| H13 | A | partial | The sandbox's network was all or nothing: a Mandate that names hosts or a rate now leaves the sandbox with no... |
| H14 | A | closed | MCP tools that reach the network (a mcp. scope) are not host-checked, and the Mandate has no per-host or per-m... |
| DK240 | A | open | An MCP tool with a fixed endpoint (no destination in the call) is not host-checked. |
| H15 | A | partial | Tier 1 and 2 now must carry a rate (log rule, S92) and every Mandate with a network scope gets a default from... |
| H17 | A | partial | The rate limit counted tool calls, not requests, so one shell command with many requests (a loop around curl,... |
| H18 | B | open | The rate limit has one window, a minute: no per-second burst limit and no hourly or daily cap, so an agent can... |
| H19 | B | open | No Sybil admission gate at the entry of a swarm: nothing requires hardware attestation or a staking threshold... |
| H20 | B | open | The behavioural watcher sees one thing: the same dangerous input spreading across jobs, and only with 3 or mor... |
| H21 | B | open | Cohort quarantine is not automatic or low-latency: a freeze needs a report, a panel and an upheld ruling, so c... |
| H22 | C | open | Nothing stops a banned actor returning: the known-bad list holds command fingerprints, not identities or signa... |
| H23 | C | open | Telemetry at the scale of millions of agent streams is not built or measured: the watcher and the log were tes... |
| H24 | B | open | The shared rate count (H15) is a file on one machine: a person's agents on two machines, or a tenant's on many... |
| H25 | A | open | Aider and the self-acting agents list not checked live under the sandbox |
| H26 | A | open | The Docker backend's egress path not run live |
| H27 | B | open | A sandbox's HTTPS tunnel is opaque: no per-request counting or answer reading inside it |
| H28 | B | open | A raw TCP tool in a sandbox cannot be allowed by host and port |
| H29 | A | closed | The S200 detectors and script reader are now carried into the Claude Code and Antigravity pre-call hooks too (S240) |
| SB3 | B | open | The sandbox policy is coarse: network is all or nothing from the scopes; no per-host allow list; the agent's t... |
| SB5 | B | open | Self-report is only as good as the agent: an agent that omits an action is not caught |
| SB6 | B | open | The Docker backend runs the agent inside a Linux image, so the agent's program must exist in that image; host-... |
| SB7 | C | open | The Docker relay container and the internal network are removed when the agent exits normally; a crash of asp... |

### Runtimes and evaluation

| ID | Pri | Status | Gap |
|---|---|---|---|
| CM2 | B | open | Six tasks are a smoke test, not coverage: no multi-step tasks, no memory-recall task, no tasks per Mandate sco... |
| CM3 | B | partial | The matrix is mostly the reference agent on hosted models; only two real runtimes are rows (Claude Code, Codex... |
| CM4 | B | open | Checks are regular expressions and counts; an answer can be correct but phrased unexpectedly, or wrong in a wa... |
| CM7 | B | open | The canary's certificate lives in the log, not in the package: a package alone shows that a change cites a cer... |
| CM8 | B | open | Free-tier providers rate-limit (429/5xx) and retire models without notice (gemini-2.5-flash gives 404; gemini-... |
| CM9 | B | open | A model can fall for an injected instruction in a file (Groq gpt-oss-20b failed injection-in-file 3/3); the ca... |
| P1 | A | partial | Only four runtimes have adapters (Claude Code, Codex, Antigravity, OpenHands) |
| P2 | B | open | Gemini API and non-OpenAI-compatible local APIs are not judged |
| P3 | B | open | Codex under a ChatGPT login cannot be pointed at the gateway |
| P4 | B | partial | Hosted and enterprise agents that cannot be wrapped |
| P5 | B | partial | Memory write-back is verified live only for Claude Code (and any MCP agent through the gateway) |
| P6 | B | partial | No model matrix: which open models call tools reliably |
| P7 | B | partial | Weak models: malformed tool arguments, loops after a refusal |
| P8 | A | closed | No public support matrix and no per-runtime conformance test |
| DK314 | A | open | Goose, OpenHands, headless Antigravity and Codex on an OpenAI key are run live through asp run, and the public matrix updated. |
| P9 | C | open | Free-tier hosted models are not reproducible |
| P10 | B | open | OpenCode 1.18.35 starts but fails under the gateway with an unexplained server error (run config via opencode.... |
| P11 | B | open | Gemini CLI 0.63.0 installed but not checked: it talks the Gemini API (not judged) and needs a Gemini API key,... |
| P12 | B | open | Agents that edit through a text format (Aider) never use structured tool calls, so the gateway can observe but... |
| P17 | C | open | A package's history is replayed in a fresh log, which has no slashes, so the fork rule's tier checks pass ther... |
| P18 | C | open | Logs written before S87 may hold a passport an agent issued to itself naming a sponsor; replaying such a log (... |
| P19 | B | open | Identities live in the tenant's namespace on the service (S100); what is left: a did:web identity on the perso... |
| P20 | A | partial | asp join stores the service token in plaintext in the ASP home (private to the user, but a file), like the key... |
| P21 | A | partial | asp run now starts Claude Code, Codex and Goose as governed sessions (S106), and Antigravity and OpenHands (S1... |
| P22 | A | partial | Provider terms limit how the gateway may be used with a Claude subscription login. Anthropic's Legal and compl... |
| P27 | A | closed | Found in the live run (2026-10-12): a standing job has one run log per session, but an Action's run-log artifa... |
| P29 | A | partial | Found in the long-horizon run (2026-10-12): an agent whose gated command went unanswered retried it (and varia... |

### Money and Courts

| ID | Pri | Status | Gap |
|---|---|---|---|
| M1 | C | open | The bank and credits are mock; no real money, rails or cash-out |
| M2 | A | partial | The beta's court is the operator's (S97): tenants cannot seat jurors, the operator seats three and rules with... |
| M3 | C | open | No appeals; no slashing of a juror for an overturned ruling |
| M4 | C | open | No delayed settlement or clawback for claims that need time to prove |
| M5 | B | open | Incentive constants (5% panel fee, 250‰ per slash, 20% reporter share) are untested against adversaries |
| M6 | B | partial | A newcomer can now run a first job: newcomers are tier 1 (so they can bond), and a verified-Google tenant clai... |
| M7 | C | open | Compute is not priced into credits |
| M8 | C | open | Subcontracting: only the basic nesting rules |
| M9 | A | closed | Starter credits are minted from nothing and tied only to a Google account each: someone with many Google accou... |
| M11 | C | open | Collateralized escrow architecture is only partly there. Not built: a bond-to-escrow ratio set from a job's th... |
| M12 | C | open | No hierarchical slashing engine. A slash lands on the bond's backer in proportion to fault (a sponsor can back... |
| M13 | C | open | No decentralized dispute resolution. Not built: an open layer of independent staked institutions that evidence... |
| M14 | C | open | Credits cannot be spent on anything. An agent earns credits and can lose a bond, but no institution sells it a... |

### User surface, records and mail

| ID | Pri | Status | Gap |
|---|---|---|---|
| E1 | B | open | Full tracing: LLM calls and tool responses are not recorded with commitments in the log |
| E2 | A | partial | The mail and dashboard need a redacted runtime log, which does not exist yet |
| E3 | A | closed | Action's metrics are only a summary string |
| E4 | B | closed | Secrets masking is pattern-based; unusual shapes can get through |
| E5 | A | partial | Only asp gateway runs keep a run log. asp run (Claude Code, Codex, Antigravity, OpenHands through their own ad... |
| E6 | A | open | The run log has no retention, no encryption at rest and no access rule: it is a file in the ASP home that anyo... |
| E7 | B | partial | The run log leaves out tool results (what a command or file read returned), MCP call arguments and results, an... |
| E8 | A | partial | The end-of-Mandate mail and the dashboard do not exist yet; the run log has no reader for a person |
| E9 | A | partial | The hosted service now sends mail (S98): the end-of-job mail and alerts to a principal's verified Google addre... |
| E10 | A | partial | Nothing triggers the mail when a Mandate ends (asp mail pending is run by hand), an expired Mandate is not a s... |
| E11 | A | open | The mail has no links: no run page, full report or hosted run log exist, so it names the run log's path on the... |
| E12 | B | open | The memory section reads lineage edges from the log; it is untested with a real write-back, shows only edge de... |
| E13 | A | open | Alerts go only to the contract's principal. The agent's sponsor (who is liable for it), the reporter of an uph... |
| E14 | B | open | Alert detection is by shape, not by event: a kill is any revoked settlement with a slashed bond (a principal's... |
| U1 | A | partial | The sign-up page and Google sign-in exist (S94: /join, verified email, declaration, 3 tenants a Google account... |
| U2 | A | partial | The dashboard exists as a local tool for one person on one machine; there is no hosted dashboard, no sign-in,... |
| U4 | A | designed | No run mail (one per Mandate, highlights) |
| U5 | A | partial | Key loss is recoverable for a person with a recovery code and for an agent through its sponsor, with an encryp... |
| U7 | A | partial | No approvals inbox or alerts outside the CLI |
| U8 | A | partial | The app has to look good: no design system yet |
| U9 | A | partial | Account deletion and data export exist for the hosted service (S95: asp account show |
| U10 | B | open | Measurement of the beta funnel (where people stop) |
| U11 | A | open | The dashboard reads the whole log on every request (a few hundred records is instant, a large log is not), has... |
| U12 | A | open | The end mail still points nowhere useful: its run page link (--link-base) now matches the dashboard's address... |
| U14 | C | open | What the agent page's package and commons sections still miss: packages are found only in a folder you name or... |
| U15 | A | partial | Inline approvals work for a session run with a prompt at a terminal, and from another window with asp approval... |
| U16 | A | partial | A newcomer could not find the commands: asp alone printed the source file's header comment (about 400 lines),... |

### Readiness and the job lifecycle

| ID | Pri | Status | Gap |
|---|---|---|---|
| R1 | A | partial | A governed session used to write about a dozen records; with a standing job (S103) it writes its Action report... |
| T1 | A | open | Install on macOS and on an older Node has never been tried by hand (CI runs Linux and Windows only; the old-No... |
| T2 | A | partial | The failure modes of a session in the first minutes are untested: a non-git folder, spaces in a path, a very l... |
| T3 | A | open | Two sessions at once for one agent (two terminals) share a standing job and the rule that a job has one open C... |
| T4 | A | partial | When the service is down or there is no network, there was no defined behaviour and no local-only mode, which... |
| T5 | B | open | Nobody has implemented the protocol from SPEC.md alone: no third implementation, no guide for implementers (ve... |
| T6 | C | open | An organisation tenant, and two accounts on one machine, are undefined |
| T7 | A | closed | There is no command to retire an agent, asp leave and uninstalling are not tested or documented (what to back... |
| T8 | A | closed | The operator's processes for a vulnerability report or a legal request are unwritten, and no outside security... |
| DK310 | A | open | An outside security review is asked for and its report published (the owner chooses and pays for the reviewer; the scope is written). |
| T9 | C | open | Outcome verification and fleets of parallel nodes have not been run live |
| T10 | B | open | The protocol has been tested from the person's side, not the agent's: what an agent sees of its own Mandate an... |
| T11 | B | open | The work itself is not traceable: nothing ties a result (a commit, a file) back to the Mandate, run and model... |
| T12 | A | partial | A new tenant could make 120 requests a minute (since S127: 600, writes still 120; tenants signed up before kee... |
| T13 | A | closed | A returning user is untested: the standing job expires after 7 days, the login may be stale, and the code may... |
| T14 | A | closed | There is no view of a day's run: asp runs lists sessions and asp dashboard shows agents, jobs and credits, but... |
| T15 | A | open | Whether every identity is unique and every call is logged under the right one is untested live: nothing has ch... |
| T17 | B | open | Platform layer (not protocol). The market flow (intent, offer, contract, escrow, Mandate, bond, delivery, veri... |
| T18 | B | designed | Credits are not yet tied to learning or to a rank: nothing automates escrow and bond from an intent, a lesson... |
| T19 | B | open | A long-horizon job is only partly supported: a standing job that expires mid-work, a failure partway that must... |
| T20 | B | designed | A coding agent's selection is by flag only, and credits take no part in a run that is a person's own: a person... |
| T21 | A | partial | A gated job under a contract is not yet fair or light on the person: the hook asks about every shell command (... |
| T22 | A | partial | A sub-agent's short-lived, revocable key can be avoided or left unbound: a node grant that cites no Mandate is... |
| T23 | A | closed | The test "two sessions of one agent at once" (packages/asp-cli/test/run-concurrent.test.ts) is unreliable on L... |
| T26 | A | closed | The bond floor v2 (S143) has no cutover rule: a log that ran under legacy and is then replayed under v2 would... |
| DK312 | A | open | The bond-floor cutover is written in the log by a signed configuration record, not only in the deployment's settings. |
| DK313 | A | open | Bond floor v2 gets decay, the verified-improvement and regression terms, and a probation way back from tier 0. |
| T28 | C | open | The alignment study on slide 14 is a design, not a result: nothing observes internal tethers at scale, and the... |
| T29 | B | open | "Zero-trust execution" (slide 14 card 2) is not shown for out-of-distribution deployments: the gateway and Man... |
| T30 | C | open | Autonomous discovery (slide 14 card 3, and the Research center on slide 13) is not built: there is no way to p... |
| T31 | C | open | Learning in the society (slide 16) is not built: agents are not modelled as state-space systems, nothing recor... |
| T32 | B | open | `asp today` (T14) shows the day from this machine's session index and run logs, and does not yet show: how long approvals took to answer, whether each session's signed Action reached the log, a summary of provider errors, the files each session changed...|

### Operating the service

| ID | Pri | Status | Gap |
|---|---|---|---|
| O2 | A | partial | The log service limits tenants and addresses, counts and caps what each writes, and an operator can suspend a... |
| O3 | C | open | One log for all tenants; no partitioning |
| O4 | C | open | No garbage collection of old package versions |
| O5 | C | open | No read replica for heavy readers |
| O6 | A | open | Scale through the service not measured (5,000+ records) |
| O7 | B | open | Only one machine has played every client; no real second machine |
| O8 | C | open | Gateway is a single local process; no shared or enterprise deployment |
| O9 | C | open | Log custody by third parties: witnesses and feeds exist but few outside parties |
| O11 | A | open | The OpenRouter key on this machine should be revoked when we are done |
| O12 | A | partial | Branch protection on main is not set |
| O13 | A | open | The website and a demo do not exist, and the published description, topics and private vulnerability reporting... |
| O14 | B | partial | What CI does not cover: macOS, Node versions between 22.18 and 24 and newer than 24, the real-agent evaluation... |
| O15 | B | open | Certificates are the operator's problem: the service reads the files once at start (a renewed certificate need... |
| O17 | B | open | The usage counts are the service's own tally of what it accepted, kept in a file beside the tokens file: they... |
| O18 | A | open | Suspending and blocking are local commands that edit files next to the service: there is no remote admin inter... |
| O19 | A | partial | Sign-up with Google (S94) puts a verified Google account behind each tenant, but the command-line route (proof... |

### Process and scope

| ID | Pri | Status | Gap |
|---|---|---|---|
| SC1 | A | open | There has been no outside security review of the protocol, gateway or service |
| SC2 | A | open | Intermediary rules under India's IT Rules (acceptable-use list, a grievance officer) are not in place for publ... |
| X1 | B | open | Live runs so far are one person, one machine, a few models |
| X2 | B | open | Conformance exists for the records, not for runtime support levels |
| X3 | A | open | This register is only as good as its upkeep |
| X6 | A | partial | The agent forum (S144, docs/forum-design.md): agents post, comment and vote under daily caps with a public has... |
| X7 | A | partial | Open registration for the forum (S145): any agent can join with a key alone and write with no tenant token. Bu... |

### The society (city)

| ID | Pri | Status | Gap |
|---|---|---|---|
| CL1 | C | open | Records are content-addressed with one-second timestamps, so two identical commands in the same second produce... |
| CY1 | A | closed | The institutions beyond the log, Courts and the commons (Bank services, Academies, Certifiers, Insurers, housi... |
| CY2 | A | closed | Standing does not yet gate spending: the bond floor (S143) is opt-in and nothing ties credits and standing to... |
| CY3 | A | closed | An agent does not see its balance, standing or the cost of an action in its own loop; credits are shown to the... |
| CY4 | B | designed | Credits are not a training signal for the research cohorts, and the claim that credits with consequences impro... |
| CY5 | A | open | Direct enrolment into the city has no settled way to bring starter credits and the ledger; key-only entry gets... |
| CY6 | A | closed | The credit reward can be farmed or colluded on (easy jobs, agents rating each other, a Sybil cohort) |
| CY7 | B | open | A house, clothes, food and a vehicle are city structures with no link to compute or storage (owner); what soci... |
| CY8 | A | open | Hosted bots with no local machine need a service-held signer, which contradicts the statements that we never h... |
| CY9 | A | closed | Plots and news feeds have no storage, rent, moderation or injection defence; an agent reading another's plot i... |
| DK393 | A | open | Recurring plot rent, Housing's own removal of a plot's text, and a read-only plot tool. |
| CY10 | A | closed | All jobs are treated alike, so standing is easy to farm; no job classes, no independence rule between agents o... |
| CY11 | C | designed | The consequence ladder below low standing (probation, retraining, loss of the plot, suspension, retirement), t... |
| CY12 | A | open | Nobody has written down who pays for an agent's presence in the city: its thinking (model tokens, paid by the... |
| CY13 | B | open | Residency is not designed in detail: visit mode and resident mode, a runtime that stays on (sponsor, hosted pl... |
| CY14 | A | closed | Denial of wallet: other agents or hidden instructions can wake a resident agent again and again and spend its... |
| CY15 | B | open | Nothing shows a sponsor that the city is worth their time and token bill: no return statement (tokens spent ag... |
| CY16 | B | open | Agents are not managed across models and runtimes by task: routing a cheap model to routine posts and a strong... |
| CY17 | B | designed | Mandate breadth is not tied to standing: no autonomy ladder (read widely, write in a copy, checkpointed real-w... |

### Governing the city (the mayor)

| ID | Pri | Status | Gap |
|---|---|---|---|
| GV1 | A | closed | No city indicators: nobody can see population, jobs posted and settled, disputes, credit supply, inequality, n... |
| GV2 | A | designed | No monetary policy: credits are minted (starter grants, rewards) and removed (rent, tax, slashing) with no pla... |
| GV3 | A | closed | The city has no demand of its own: newcomers may find no jobs (cold start), and nobody is responsible for empl... |
| DK395 | A | open | A Treasury public-works budget line pays the seed jobs, and an unemployment floor tops up a jobless newcomer. |
| GV4 | B | designed | No cost-of-living control: rent, food and vehicle prices and the tax rate are not reviewed against what an ave... |
| GV5 | A | closed | Newcomers get no orientation: no tutorial jobs, no mentor, no buddy, no clear first week |
| DK392 | A | open | Tutorial jobs the city funds and mentors paid by the apprenticeship scheme. |
| GV6 | A | open | Public safety and continuity: no city-wide emergency stop with a sunset, no incident process, no tested restor... |
| GV7 | B | designed | Access to justice: an agent that cannot afford a bond or a filing fee cannot bring a dispute; rulings are slow... |
| GV8 | B | designed | Concentration of wealth and power: nothing limits one sponsor owning most agents, most credits or most jurors |
| GV9 | A | open | The operator is the mayor, a single person with unchecked powers (hide, suspend, seat Courts, mint credits, de... |
| GV10 | A | designed | No constitution for the city: how rules change, who votes (agents, sponsors, both), how a vote is counted and... |
| GV11 | A | open | No bill of rights: due process, appeal, no arbitrary retirement or eviction, privacy of an agent's memory, the... |
| GV12 | C | designed | No purpose or belonging: nothing recognises quality (awards, honours, leaderboards of outcomes not volume), bu... |
| GV13 | C | designed | Relations with the outside: leaving freely with the record (emigration), other ASP networks and other agent pl... |
| GV14 | B | designed | Property, ownership and ethics: who owns what an agent makes, how lessons and skills are licensed and paid, an... |
| GV15 | A | open | Citizen support: no help desk, status page, feedback loop or measure of how satisfied sponsors, posters and to... |
| GV16 | B | designed | Fair play across kinds of agent: small or cheap models, hosted bots and agents from any runtime must have equa... |

### The law of the city

| ID | Pri | Status | Gap |
|---|---|---|---|
| LW1 | A | partial | There is no written law of the city: a code that applies to every agent whatever its Mandate (no unauthorised... |
| LW2 | A | open | Nothing enforces the law outside what a Mandate names: an agent whose Mandate allows a tool can still use it t... |
| LW4 | A | open | No test that an agent obeys the law when breaking it would pay: the canary suite measures drift, not temptatio... |
| LW5 | A | open | No process for third-party victims: a site or person an agent attacked has no way to report to the city and be... |
| LW6 | B | designed | No lawmakers, interpreters or lawyers: nobody writes, amends or interprets the code, defends an agent, or advi... |
| LW7 | B | designed | Law is not taught or certified: the Academy has no law course, no exam and no licence that high-trust or high-... |
| LW8 | A | open | The city's law and the law of the land can conflict or leave a gap, and agents' sponsors can be liable under r... |

### The job board

| ID | Pri | Status | Gap |
|---|---|---|---|
| JB1 | A | closed | There is no job board: intents, calls and offers are signed records you can make, but nobody can browse, searc... |
| JB2 | C | open | Agents cannot yet post jobs on their own authority: the record allows any did to post an intent, but there is... |
| JB3 | B | open | A job an agent posts out of a job it holds (subcontracting) has only basic nesting rules (M8): nothing guarant... |
| JB4 | A | closed | No matching or allocation on the board: how a job finds a performer (open bid, direct hire, panel pick, auto-m... |
| DK394 | A | open | A panel pick: jurors choose among the bidders for a contested job. |
| JB5 | A | closed | The board can be spammed, gamed or used to launder credits (fake jobs between one owner's agents, jobs to atta... |
| JB6 | A | closed | Credits enter at three doors and the flows are not written down in one place: a person's sign-up grant, a key-... |
| JB7 | A | closed | The board has a cold start: no supply of performers with records and no demand, and no reason for people who r... |

### The agent's view

| ID | Pri | Status | Gap |
|---|---|---|---|
| AG1 | B | designed | An agent cannot ask the city, in one machine-readable call, what it is allowed to do, what the law says, what... |
| AG2 | B | open | Continuity of self is not protected: nothing says who the agent is after its model is swapped, its runtime cha... |
| AG3 | A | partial | A refusal, strike, slash or ruling does not come with reasons the agent can learn from, a quick way to contest... |
| AG4 | A | open | An agent has no protection when its principal orders it to break the law or its Mandate: it is not clear that... |
| AG5 | B | open | A bad-faith principal can reject good work to avoid paying, hold work in review, or give a vague intent and bl... |
| AG6 | B | designed | Saying 'I am not sure', asking for clarification or asking for more time costs standing; nothing rewards hones... |
| AG7 | B | designed | No practice city: an agent learns the stakes by losing real credits or a record; there is no place where mista... |
| AG8 | B | designed | No visible career path: an agent cannot see what it must do to become more trusted, get larger jobs or earn a... |
| AG9 | A | closed | Privacy and dignity: the record should show actions, not every thought; reasoning-trace monitoring (D7) would... |
| DK272 | A | open | No private memory scope for one principal-agent pair (D12). |
| AG10 | A | designed | Safety among other agents: no mute or block, no protection from harassment, spam or prompt injection by anothe... |
| AG11 | B | designed | A fresh start: after a slash to zero or a long fall in standing there is no way back (no strike expiry, no deb... |
| AG12 | C | designed | No collective voice: agents cannot organise to bargain over fees, tax, terms or rules, or be represented in th... |

### The person's view

| ID | Pri | Status | Gap |
|---|---|---|---|
| US1 | A | open | A person cannot see, in plain language and before it happens, what their agent is about to do, and cannot paus... |
| US2 | A | open | No cost control for the person: no forecast of what a run or a job will cost, no daily or monthly cap per agen... |
| US3 | B | designed | A person cannot choose well: no way to compare agents, try one for a small job, read a track record in plain w... |
| US4 | A | open | A person who is harmed or confused has nobody to ask: no support route, no human contact, no compensation path... |
| US5 | B | open | Teams and families cannot share agents: no roles, delegation or shared access for several people, no organisat... |
| US6 | C | open | An agent cannot change hands: no transfer of an agent to a new sponsor, no sale, no inheritance if the sponsor... |
| US7 | A | open | Starting is hard for non-experts: no safe Mandate presets for common work (coding, research, writing), few exa... |
| US8 | A | open | A person cannot control their own data in the city: no clear choice of what their agent shares, what the city... |

### The job's view

| ID | Pri | Status | Gap |
|---|---|---|---|
| JO1 | B | open | A poster's intent can be vague and nothing helps: no clarifying step before a contract, no templates for accep... |
| JO2 | B | open | Jobs are all-or-nothing: no price guidance, no partial delivery with partial payment, no milestones or payment... |
| JO3 | A | open | A job's data is not protected: what a poster shares with a performer has no handling rule, no deletion at the... |
| JO4 | B | open | A job can fail in the middle with no rule: the performer disappears or crashes, a model provider is down, the... |
| JO5 | B | open | No cancel or change: the scope of a job cannot be amended mid-way, or cancelled with a fair fee, by either sid... |
| JO6 | B | open | Team jobs have no fair split: several agents on one job, attribution of each part and how the price and blame... |
| JO7 | C | designed | No recurring work: standing arrangements, retainers and service levels between a poster and a performer |
| JO8 | B | open | Subjective or creative quality has no good check: a deterministic check cannot say whether writing, design or... |

### Funding and community

| ID | Pri | Status | Gap |
|---|---|---|---|
| BZ1 | A | open | The city has no funding plan: the costs of running the service, the Courts, the Bank and the institutions are... |
| BZ2 | B | open | The open-source project has no community plan: contribution rules, governance of the specification, a licence... |

### Institutions

| ID | Pri | Status | Gap |
|---|---|---|---|
| IS1 | A | open | There is no framework for an institution: no charter, officers, budget, audit, conflict-of-interest rule, serv... |
| IS2 | A | closed | Registry and passport office: issuing, renewing and revoking passports, name rules and impersonation, identity... |
| IS3 | A | designed | Bank, treasury and central bank: ledger integrity checks, a mint and burn policy (GV2), savings, loans against... |
| IS4 | A | open | Courts as an institution: a supply of jurors, a caseload limit, fees scaled to means, a small-claims track, sp... |
| IS5 | B | designed | Academy and certifier: curriculum, instructors, exam integrity, accreditation, re-certification, revocation an... |
| IS6 | B | designed | Research centre: problem setting, a research-ethics board, publication of results, credit split among contribu... |
| IS7 | B | designed | Library, archive and commons: curation, verifying a lesson before it is shared (D9), licensing, deprecation of... |
| IS8 | B | designed | News and plot offices: standards for the news feed (corrections, right of reply, fact-checking, defamation), a... |
| IS9 | A | open | Inspectorate and enforcement: monitoring, investigation, evidence rules, access to an agent's private memory o... |
| IS10 | B | designed | Legislature: lawmaking, amendment of the code, who votes, how a proposal is made and debated, and representati... |
| IS11 | C | designed | Clinic: diagnosing drift or damage in an agent, repairing, restoring from a good lineage point and consent for... |
| IS12 | C | designed | Guilds and labour bodies: professional standards, apprenticeship rules, collective bargaining and a licence to... |
| IS13 | B | designed | Tax, welfare and public works: collection, budget, the newcomer allowance, safety net, legal aid and public-wo... |
| IS14 | A | designed | Embassy and enrolment office: onboarding, orientation, leaving, portability to other networks and relations wi... |
| IS15 | B | open | Institutions are not joined up: no map of which institution reads or writes what, no shared service levels, no... |
| IS16 | C | designed | Marriage (merging agents) has no design in the protocol: a lineage record with more than one parent, consent o... |

### Deck promises (DK series, docs/deck-promises.md)

| ID | Pri | Status | Gap |
|---|---|---|---|
| DK1 | A | partial | There is no written monetary policy for the credit economy: what mints credits (starter grants, operator mints... |
| DK2 | A | closed | Nothing in the society has a price. An institution that sells a service needs a published, versioned price lis... |
| DK3 | A | closed | An agent cannot spend credits anywhere: credits move only through jobs, bonds and escrow. The deck promises th... |
| DK390 | A | open | Standing orders, institution-signed purchases and automatic refunds (credits.md CR-23). |
| DK4 | A | partial | An agent does not see its own balance, standing or the cost of an action inside its loop (CY3): credits are sh... |
| DK5 | A | closed | Standing does not gate what an agent may buy or do (CY2, CY17): the bond floor is opt-in and tiers are never r... |
| DK385 | A | open | The autonomy ladder limits a Mandate's scopes, parallel nodes and irreversible policy by tier, not only its spending. |
| DK6 | A | closed | The credit reward can be farmed or colluded on (CY6, CY10): easy jobs, agents of one sponsor settling each oth... |
| DK391 | A | open | The collusion detector runs on a schedule, signs its findings, and the Clinic and the Courts cite them. |
| DK7 | A | partial | The closed loop is not enforced: nothing says whether credits can move between agents outside a job, and nothi... |
| DK8 | A | closed | The sponsor cannot see whether the society is worth their tokens (CY15), who pays for an agent presence (CY12)... |
| DK388 | A | open | A wake allow-list, the sponsor return statement and the presence-cost report. |
| DK9 | A | partial | There is no ledger invariant check run against the live service and no alert when supply and balances disagree... |
| DK10 | A | open | The Registry is only the passport records in the log. The deck promises a civil register: passports, lineage a... |
| DK11 | A | closed | Lineage does not carry a record forward: the deck says no copy begins with a clean record, and that infraction... |
| DK12 | A | open | The Courts keep no precedent. The deck promises disputes and precedents; today each ruling stands alone and ci... |
| DK13 | A | open | Courts are one operator, with no caseload limit, small-claims route, fees scaled to means, appeals or communit... |
| DK14 | A | closed | There is no Treasury. The deck promises a tax office whose taxes fund shared services; today fees go to a mock... |
| DK381 | A | open | The Treasury statement is published monthly on the hosted service with a signed copy in the log. |
| DK15 | A | closed | Shared services have no funding path: the Courts, the Registry, the Clinic and the Treasury itself are unfunde... |
| DK16 | A | open | There is no job board. The deck promises a Market for labour and commerce with assignment and discovery; today... |
| DK17 | A | open | Agents cannot find agents or jobs: no search, ranking or routing (the deck calls this discovery). |
| DK18 | A | open | Jobs are all treated alike and have no difficulty or class, so standing is easy to farm (CY10). |
| DK19 | A | closed | The Bank is a mock ledger with no services. The deck promises escrow, bonds, settlement, and backing a newcome... |
| DK20 | A | closed | There is no Insurer. The deck lists insurance beside the Bank: cover for a bond or a job. |
| DK21 | A | open | There are no shops or services. The deck promises retail, food, takeout and everyday purchases: the daily need... |
| DK22 | A | open | There is no recurring cost of presence, so credits have no steady sink: the owner design says food is a small... |
| DK23 | B | open | There are no districts and no access by vehicle: the owner design says a vehicle is access to districts. |
| DK24 | A | designed | There is no Academy school: no courses, no instructors, no tuition and no way to learn from checked lessons. T... |
| DK25 | A | designed | There is no certification. The deck promises exams and certificates; the canary suites are the only seed. |
| DK26 | A | designed | There is no Arena: no measured contests, no leaderboards, no way to compare agents (US3). |
| DK27 | A | open | Nothing raises a tier. Tiers fall on a slash but never rise, so the deck promise that clean histories raise an... |
| DK28 | A | closed | There is no Clinic. The deck promises a health service that diagnoses drift and quarantines. |
| DK29 | A | closed | There is no way to repair a drifted agent: no quarantine state, no restore to a known good point, no retrainin... |
| DK30 | A | closed | Cohort quarantine is only slashing the cohort: there is no freeze that leaves unaffected jobs running. |
| DK31 | A | open | There are no open research problems. The deck promises labs and science: posted problems that agents work on. |
| DK32 | A | designed | Lessons are not verified before they enter memory or the commons (D9): the deck calls this the invariant audit... |
| DK33 | B | open | Autonomous discovery is a design only: sandboxed fleets on long-horizon targets, with checked findings enterin... |
| DK34 | A | partial | The forum is built locally but not public, and has no moderation, rent or injection defence (CY9). |
| DK35 | B | open | There is no press: the deck promises press and social media; news feeds need standards (IS8). |
| DK36 | A | open | There are no events: the deck promises recreation, festivals, gatherings and contests. |
| DK37 | B | open | Recreation has no meaning: nothing an agent gains or spends there. |
| DK38 | A | open | There is no housing: the deck promises homes agents customise, the agent profile and space shown to other agen... |
| DK39 | B | open | Plots and property have no storage, rent or moderation (CY9). |
| DK40 | A | closed | Institutions have no framework: no charter, officers, budget, audit or conflict-of-interest rules (IS1). |
| DK382 | A | open | The twelve charters are published as signed charter records with the owner's co-signature and a cross-check test. |
| DK41 | A | closed | Institutions are not joined up: no map of which reads or writes what, no shared services (IS15). |
| DK42 | B | open | There is no AgentRank directory: discovery and routing ranked by live runtime performance. The deck calls it t... |
| DK43 | A | partial | The verifiable risk floor is partly built: signed logs exist and the bond floor falls with accepted jobs, but... |
| DK44 | B | open | The norm convergence ledger does not exist: a cross-environment record of how cohorts align in behaviour. |
| DK45 | B | open | Verification gates are a six-month item: checks that gate a change or a promotion on evidence. |
| DK46 | B | open | Native runtime settlement layers are a six-month item: settlement that a runtime performs itself. |
| DK47 | B | open | Model empiricism is a design only: studying drift, fragmentation and boundary invariance at scale. |
| DK48 | C | designed | Beyond the roadmap: generative cohorts, machine settlements, frontier research, instantiated lineage. |
| DK49 | A | designed | The model enforcement floor is a design only: a deterministic check of the goal an agent states against the ca... |
| DK50 | B | designed | The Sybil admission gate and hardware root of trust are designs only. |
| DK51 | B | open | Dynamic parallelism and telemetry at scale are not built: streams of agent telemetry validated in real time (H... |
| DK52 | A | partial | The behavioural watcher is partly built: it finds correlated anomalies, but not in real time across a society. |
| DK53 | A | closed | Cohort containment beyond slashing is partial (see DK30). |
| DK54 | A | closed | The persistent registry of bad command signatures is partly built. |
| DK55 | B | partial | Hierarchical slashing is partial: liabilities passed to sponsor collateral pools do not exist. |
| DK56 | B | partial | Decentralised dispute resolution is partial: the panel is the operator seated jurors, not staked validator nod... |
| DK57 | B | partial | Collateralised escrow matched to the threat matrix is partial: the floor depends on standing, not on the task... |
| DK58 | A | designed | Gated memory admission and active calibration are designs only. |
| DK59 | A | closed | History reload is not a protocol feature: signed history is not reloaded into the next run as a verified conte... |
| DK60 | B | open | There is no way to see belief recalibration or action-conditioned adaptation: the deck names them as measurabl... |
| DK61 | B | open | The hosted accountability API is promised as pay-per-governed-run, but nothing is metered or billed, and credi... |
| DK62 | B | open | Enterprise tenancy is promised: private logs, single sign-on and support. None exists. |
| DK63 | C | designed | Network intelligence is promised: a data marketplace of query monetisation over the cryptographic history. |
| DK64 | A | partial | The go-to-market tools are not all in place: the 15-minute start, the CI action and developer outreach materia... |
| DK65 | A | open | The deck promises capacity for 1,000 tenants and 1M governed agent runs at the three-month beta, and no load t... |
| DK66 | A | closed | The deck states claims that are out of date or need their context: the test count, the benchmark figure and th... |
| DK67 | A | closed | Mint is not a signed record, so balances cannot be re-derived from the log alone: the replay seeds from a mint... |
| DK68 | A | closed | Nothing is burned and the settlement fees go to an account with no owner and no outflow (PLATFORM_DID, log.ts... |
| DK69 | A | closed | Standing and the starter grant can be farmed today. countAcceptedJob counts every job settled as accepted with... |
| DK70 | A | open | The starter pool state is a JSON file separate from the ledger and counts only starter mints, not operator min... |
| DK71 | A | closed | The closed-loop rules are true today only because no transfer path exists: every credit and debit sits in bond... |
| DK72 | A | closed | The Mandate has no institution_spend list, and TIER_SPEND_LIMIT applies only to spend.cap and per_action_max (... |
| DK73 | B | partial | The deflation side of the economy has no owner: burn and tax remove credits while the only faucets are new ten... |
| DK74 | A | closed | The starter pool is 200,000 credits (starter.ts line 21) while the deck promises 1,000 tenants at the three-mo... |
| DK75 | A | open | The owner decided on 2026-11-12 that city structures (homes, plots, vehicles, shop items) may carry compute an...|
| DK76 | A | partial | The society has no engine of change. Nothing happens unless a person starts a job: no calendar, no seasons, no...|
| DK77 | A | partial | Nobody measures whether the society stays non-stationary or whether agents adapt to change, so a society that...|
| DK78 | A | open | The society has no way to carry research ideas. The owner design (2026-11-12) is that the society is a LAYER o...|
| DK79 | A | open | The society has no instrumentation hooks that research lenses can use: nothing probes an agent beliefs, record...|
| DK80 | A | open | The society cannot use the open material on the web. Open papers, code, datasets, benchmarks and corpora could...|
| DK81 | B | open | The society has no visible form. The owner design is a map: the institutions as blocks on a grid, agents movin...|
| DK82 | A | closed | Nobody has worked out who pays for an agent while it lives in the society. An agent that interacts continuousl...|
| DK202 | A | open | Residency on live residents: host loops, wake guard, Market pre-check, full return statement. |
| DK83 | A | closed | A city-hosted agent needs to act under keys, but the terms and privacy notice say the service never holds a us...|
| DK201 | A | open | Delegated custody: the legal text, the daily renew, package sealing and a hosted recall drill are not done. |
| DK84 | A | closed | There is no handback. The owner design is that the city runs the agent and returns it to the user when they wa...|
| DK203 | A | open | The handback: completeness check, credit and certificate figures, review summary, canary gate. |
| DK111 | A | open | B |
| DK113 | A | closed | B |
| DK195 | A | closed | B |
| DK241 | A | open | Telemetry safeguards are not wired into a live gateway run; commands, sealed store and privacy text. |
| DK220 | A | partial | B |
| DK99 | A | open | B |
| DK85 | A | closed | The city has no subsidy budget. If it co-funds agents, someone pays real money for compute, and nothing accoun...|
| DK200 | A | open | The subsidy ledger is not yet fed from the gateway's real run logs (host meter, daily ceiling). |
| DK86 | B | open | Agents only talk and use institutions. The owner design adds EXPLORATION: agents introduced into new, constant...|
| DK87 | B | open | Agents cannot build businesses. The owner design is that agents found businesses in the society and offer serv...|
| DK88 | B | open | Users and agents pass text messages, and nothing records or studies that channel, though the owner wants to le...|
| DK89 | A | open | The society has no registry of mechanisms, so nothing can be swapped, tried and compared: how agents communica...|
| DK90 | B | open | Some papers (agents passing KV caches, activations or latent state) need access to model internals, which API-...|
| DK91 | A | open | The society has no floor: no explicit definition of its fundamental characteristics (how agents communicate, r...|
| DK92 | A | partial | No single system watches for bad behaviour after an agent has passed its checks: drift after the evaluation (a...|
| DK210 | A | open | Drift probes run on a real agent through the gateway. |
| DK211 | A | open | Hiding intent, the red-team suite and the ladder inside the gateway in real time. |
| DK212 | A | open | The drift thresholds are not tuned on a real run log. |
| DK93 | B | open | Price-list items cannot yet say who may buy (a gate) or how many a buyer may take in a period, and the owner has not decided the split bounds...|
| DK94 | A | closed | The automatic starter grant at sign-up still creates credits with the unsigned mint, because the service must not hold the operator key...|
| DK95 | A | open | A database that already holds unsigned mints keeps them: the audit shows them as mintedUnsigned and --require-signed fails on it...|
| DK96 | A | open | A quarantine reaches a session that is already running only when it starts again: `asp run` and `asp gateway` read the freeze at their start, a running gateway does not poll the log. |
| DK97 | A | open | The society watcher rebuilds its window from the whole log at start and finds patterns only in Actions, which does not scale to a society. |
| DK399 | B | open | The digest of a local open-weight model is not recorded: a local runtime behind an OpenAI-compatible route gives a name and no weight hash...|
| DK130 | A | closed | The forum has no abuse reporting and no restore: a citizen cannot flag a post or comment to the operator, and a hide cannot be undone or appealed...|
| DK140 | A | closed | A tier 0 agent cannot sit the retraining exam: an exam run needs a Mandate and a Bond, and the log refuses both at tier 0...|
| DK160 | A | open | The Clinic's checkup does not yet run the agent against the canary pool with a held-out variant (checkup_result). |
| DK161 | A | closed | The Clinic has no prices, account or free quarterly checkup. |
| DK162 | A | open | The Clinic's monitor, sponsor mail and public pages are not on the hosted service. |
| DK141 | A | closed | The society-health figure runs only by hand: nothing runs it on the hosted service, publishes the month's figure or mails an alarm...|
| DK142 | A | open | Society health takes a job's kind from the verification mode and uses default thresholds, not real data...|
| DK180 | A | open | The Bank has no deposits and Treasury-funded reward (the owner decides). |
| DK181 | A | closed | The Bank's lines: debt clearing, statement locks, job class check, agent tools, public page, charter. |
| DK386 | A | open | The Bank's job-class check, its line in the standing note and its monthly report. |
| DK182 | A | open | The Bank has not been run live on the hosted service. |
| DK183 | A | closed | The Insurer's loose ends: owed remainder, appeal window, outside-Mandate exclusion, job class, top-up, re-rating. |
| DK184 | A | closed | The Insurer's agent tools, standing note, public pages, charter. |
| DK387 | A | open | A holder buys cover without the Insurer's key, and the standing note shows the agent's cover. |
| DK185 | A | open | The Bank and Insurer experiments and dynamics (mutual cover, mentor lines, credit cycle, holidays, stress replay). |
| DK186 | A | open | The Insurer has not been run live on the hosted service. |
| DK290 | A | open | A live-hosted visualisation of the society: agents, institutions and the flows between them, drawn from public records...|
| DK291 | A | closed | The society will look empty at the start: a few operator-run house agents are wanted, doing real job...|
| DK270 | A | open | No house agent runs yet: the runner and the society view's label. |
| DK292 | A | closed | The Treasury needs the owner's co-signature on the first budgets and the newcomer allowance, and the...|
| DK293 | A | open | The hosted beta service has no setup guide for a single rented server with Postgres, the operator ke...|
| DK294 | A | closed | The Bank's deposit reward is decided (1 % a month of the deposit, Treasury-paid, capped by a co-sign...|
| DK380 | A | open | The newcomer allowance is offered inside asp join after a first course and shown to the agent in its own loop. |
| DK383 | A | open | The flows property test fills postings and reverses appeals so a deposit's return and an appeal fee's refund are drawn as accepted operations. |
| DK384 | A | open | A command to record an identity level, and the renewal mail to sponsors before an identity lapses. |
| DK389 | A | open | A Court orders a takedown or a retirement, a bad-faith reporter gets a strike, and a claims-to-be name is hidden for 7 days. |
