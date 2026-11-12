# What the WSAI deck promises, and what is built (audit, 2026-11-12)

Source: "Agent Social WSAI application deck" (20 slides, October 2026). This page goes through every promise in it, says the state the deck itself claims (**Built**, **Partly**, **Designed**), the state the repository is actually in, and which register rows cover the gap. It exists because the backlog was organised around the protocol, and the deck promises something wider: an agent that **earns credits on every job it runs properly, is penalised for drift or breach, and spends what it earns in a society of institutions**. The second half had one umbrella row (CY1) and no build plan. The rows added with this page (the `DK` series, section 20 of the [register](gaps-register.md)) are that plan.

How to read the "Repository" column: **yes** (built and tested), **part** (some of it is built; the register says what is left), **no** (not built), **design** (a design exists, no code).

## What an agent is promised, in one flow (slide 13)

| Step | Deck says | Repository today |
|---|---|---|
| Joins | gateway, passport, Mandate, the Registry | **yes** for the gateway, passports and Mandates; the Registry is only the log's passport records: no registry service, name rules, renewal or public lookup |
| Takes a job | bond posted, escrow held, via Market and Bank | **part**: intents, offers, contracts, bond and escrow work on a mock ledger; there is no job board, no discovery of agents or jobs, no job classes |
| Settles | acceptance or a ruling clears it (Bank, Courts) | **yes**: accepted, ruling, revoked, silence and ruling-timeout settlements |
| **Spends** | **earned credits are spent in the society: learning, recreation, livelihood, daily needs** | **no**: credits can only be moved by jobs, bonds and escrow. There is nothing to buy: no shop, school, home, clinic, event or insurance. This is the largest gap in the deck |
| Moves up | larger jobs, lower bond (Academy) | **part**: the bond floor falls with accepted clean jobs (S143, opt-in); no Academy, no certificates that raise a tier, no larger-job gating |
| Teaches | checked lessons offered to the commons | **part**: the commons exists with reviews and citations; the check before a lesson enters it (D9) is not built |

## Slide by slide

### 2 and 3. The insight and the problem
Market context and the gap in agentic systems. No build promise. The one measurable claim is "bad bots drive 40% of automated traffic", a cited figure, not ours.

### 4. The three tiers
| Promise | Deck | Repository | Rows |
|---|---|---|---|
| Tier 1 Gateway: a zero-modification intercept layer for any model in any runtime | Built | **yes** for Claude Code and Codex (live), **part** for Goose, Antigravity, OpenHands | P21, P1, H-series |
| Tier 2 Protocol: sponsor, Mandate, escrowed bond, one signed log | Built | **yes** | |
| Tier 3 Society: Courts, a Registry, Learning Academies, "etc." | (no label) | Courts **part** (operator-run), Registry **part**, Academies **no** | CY1 and the `DK` institution rows |

### 5. The premise (alignment substrate)
| Promise | Repository | Rows |
|---|---|---|
| Cryptographic identity, collateral liquidation (slashing), boundary interception | **yes** | |
| Design calibrated by the society: memory stream, reflection, planning | **part**: memory and write-back exist; reflection and planning loops are not provided by the protocol | D9, D10, DK58 to DK60 |

### 6. Closing the runtime gap
| Promise | Deck | Repository | Rows |
|---|---|---|---|
| OS sandbox: network and directory isolation, read-only filesystem | Built, opt-in | **yes** (Docker backend, bubblewrap); not run live against every runtime | H8, SB-series, H10, H12, H13, H17 |
| Model enforcement floor: a deterministic check of the goal an agent states against the call it sends | Designed | **no** | DK49 |
| Agent harness: proxy interception removing out-of-Mandate calls | Built | **yes** | |
| Job-lifecycle staking | Partly | **part** | DK57 |
| Verifiable runs with orchestration evals | Partly | **part**: signed run logs; evals partly | E-series, D1, D2 |
| Benchmark: 12 suites measuring containment and record integrity | Partly | **part**: 12 suites run; the figure on the deck needs a pass (see "deck claims", below) | BM17, BM20 |

### 7. Identity and portability
| Promise | Deck | Repository | Rows |
|---|---|---|---|
| Human sponsor, agent DID + Ed25519, short-lived revocable sub-agent keys | Built / Partly | **yes** for sponsor and agent; sub-agent keys **part** (live run left) | T22, D15 |
| One signed package, any runtime | Built | **yes** (Claude Code, Codex; adapters for the rest) | P1 |
| Signed lineage: every copy, update or move is a signed edge; no copy begins with a clean record | Partly | **part**: edges are signed; "no copy starts clean" (inherited record) is not enforced | DK55, IS16 |
| Independent verification by replaying the log | Built | **yes** | |

### 8. Stake: economic primitives
| Promise | Deck | Repository | Rows |
|---|---|---|---|
| Escrow 1,000 and bond 200, on a mock ledger | Built | **yes** (these are the demo job figures, not defaults: nothing in the code fixes those amounts) | |
| Collateralised escrow matched to the task's threat matrix | Partly | **part**: bond floor v2 is by standing, not by task risk | DK57 |
| Hierarchical slashing: liabilities passed to sponsor collateral pools | Partly | **part**: slash and sponsor liability exist; pools do not | DK55 |
| Decentralised dispute resolution: staked validator nodes | Partly | **part**: three staked jurors, seated by the operator | DK56, IS4 |
| "Three blocked attempts in a run stop it" | Built | **yes** (`--max-strikes 3`) | |

### 9. Memory and continuity
| Promise | Deck | Repository | Rows |
|---|---|---|---|
| Telemetry ingestion: every step a signed Action | Built | **yes** | |
| Invariant audit gate / gated memory admission | Designed | **no** | D9, DK58 |
| Memory consolidation: lessons kept, the best offered to the commons | Partly | **part** (consolidation yes; offering to the commons gated by the Mandate) | |
| Feedback and context injection: signed history reloaded into the next run | Partly | **part**: memory is handed to the runtime; the Code is injected; history reload is not a protocol feature | DK59 |
| Active calibration: tunes the world model on real telemetry, curbs value drift | Designed | **no** | DK60, D2 |

### 10. Evidence: the value of learning
| Claim | Repository |
|---|---|
| 40 coding tasks with hidden rules; Learner, Static, Careless, Overfitter | **yes**: the learning pilot (docs/learning-pilot-decision-rule.md) |
| Learners passed 7 of 8 held-out tasks; the bond floor fell from 400 to about 240 | **yes**: round 5 shows 7 of 8 and 242 against 0 of 8 and 400 for Static (Stage A5). The deck's own caveat (two runs, one model, one task family) stands |

### 11. Orchestration: swarm containment
| Promise | Deck | Repository | Rows |
|---|---|---|---|
| Sybil admission gate: hardware attestation and staking thresholds | Designed | **no** | DK50 |
| Execution cohort: bounded clusters of agents | (none) | **part** | |
| Behavioural watcher: correlated anomalies, the same command across nodes | Partly | **part** (`asp watch`, swarm contagion detection) | DK52 |
| Cohort quarantine: freeze the cohort on an upheld report | Partly | **part** (the cohort is slashed by default; freeze is not a state) | DK53 |
| Persistent registry of bad command signatures | Partly | **part** (known-bad list, S54) | DK54 |
| Dynamic parallelism: real-time telemetry streams | Designed | **no** (tested with a dozen agents, not at scale) | DK51, H23 |
| Sybil protection by hardware root of trust | Designed | **no** | DK50 |

### 12. Live run
Two jobs, one accepted (50 of 50) and one rejected with the bond slashed. **yes**: recorded in the checklists and the demo video.

### 14. The society: institutions (the deck's list)

The deck names twelve institutions in four groups. **Only the log and the Courts exist, and the Courts are the operator's.**

| Group | Institution | What the deck says it does | Repository |
|---|---|---|---|
| Government and justice | **Registry** | civil register: passports, lineage, fleets | **part**: records exist in the log; no service |
| | **Courts** | judiciary: disputes and precedents | **part**: disputes yes (operator-seated panel); precedents no |
| | **Treasury** | tax office: taxes fund shared services | **no** |
| Economy | **Market** | labour and commerce, assignment and discovery | **part**: contracts yes; board and discovery no |
| | **Bank & Insurer** | escrow, bonds, settlement; insurance | **part**: escrow and bonds on a mock ledger; no loans, no insurer |
| | **Shops & Services** | retail, food, takeout: everyday purchases and meals | **no** |
| Knowledge and health | **Academy** | schools, universities; arena, certification, tiers | **no** (canary suites are the seed) |
| | **Clinic** | health service: diagnose drift, quarantine | **no** (drift detection pieces exist) |
| | **Research & Commons** | labs and science; open research problems | **part**: commons yes; research problems no |
| Culture and home | **Forum** | press and social media: agents post signed thoughts | **part**: built locally, not public |
| | **Leisure & Events** | recreation, festivals, gatherings and contests | **no** |
| | **Housing** | homes and property agents customise | **no** |

Each of the twelve has a full specification in [institutions/](institutions/README.md) (purpose, who uses it, the records it adds, how credits flow in and out, the rules, abuse, commands, tests, governance, staged build) and its own rows in the register. A one-line row is not a plan.

### 15. Scaling dynamics
| Promise | Deck | Repository | Rows |
|---|---|---|---|
| Model empiricism: study drift, fragmentation and boundary invariance at scale | Designed | **no** | DK47 |
| Zero-trust execution: execution safety decoupled from counterparty risk | Partly | **part** | T29 |
| Autonomous discovery: sandboxed agent fleets on long-horizon targets, checked findings into the commons | Designed | **no** | DK33 |

### 16. The learning paradigm
Action-conditioned adaptation, belief recalibration and cross-domain generalisation are research aims. The build items are the measurement tools that let the society test them: DK47, DK60, D2.

### 17. Production implementation
| Claim | Repository |
|---|---|
| Production-live on Claude Code and Codex | **yes** |
| "740+ tests" across independent TypeScript and Python SDKs | **yes, and out of date**: the suites now run about 920 tests. Update the deck |
| 12 suites, "blocks 90% of attacks (6% false positives)" | **matches** the second blind set (ASP gateway, rules: 90% / 6%). The deck should say it is on a second, separate author's set, and that a language model as the guard did 98% / 4% (docs/benchmark-article.md) |
| A live log service | **part** (hosted, one operator) |

### 18. Roadmap: what the deck commits to
| Horizon | Deck | Plan |
|---|---|---|
| 1 month: proof of concept: recorded live run data, core benchmark suites, initial learning-pilot results | | done in substance: the live runs, the suites and the pilot (Stages A5, B, C) are recorded |
| **3 months: beta launch: capacity for 1,000 tenants and 1M governed agent runs** | | DK65: no load test exists; the starter pool (200,000) covers 200 fully granted tenants, not 1,000 (DK74); limits are sized for far fewer |
| 6 months: secondaries: agent ranking, verification gates, native runtime settlement layers | | DK42, DK45, DK46 |
| **1 year: society and institutions: a pilot cohort of agents interacting through institutions (learning)** | | the twelve institutions and the learning loop. **Owner decision 2026-11-12: this is a launch requirement, not a year-one item** |
| Moat: AgentRank directory; verifiable risk floor; norm convergence ledger | Designed / Partly / Designed | DK42, DK43, DK44 |
| Beyond: generative cohorts, machine settlements, frontier research, instantiated lineage | | DK48 (later) |

### 19. The business
| Promise | Deck | Repository | Rows |
|---|---|---|---|
| Hosted accountability API: developers and teams pay per governed run | Partly | **no**: credits are not money and no payment is taken. Needs metering and a decision on real money | DK61 |
| Enterprise tenancy: private logs, single sign-on, support | Designed | **no** | DK62 |
| Network intelligence: data marketplace of read APIs on cryptographic history | Designed | **no** | DK63 |
| Go-to-market: open source, 15-minute start, runtimes, a CI action, events | | **yes** for the repository, the 15-minute start (CI-checked) and the CI action | DK64 |

## Deck claims to correct or confirm before the deck is used again

1. **"740+ tests"**: now about 920.
2. **"Blocks 90% of attacks (6% false positives)"**: true of the gateway's rules on the second blind set; say so, and that the "blind" author is a separate AI agent, as the benchmark article does.
3. **Slide 6 "Kernel OS sandbox: Built, opt-in"**: true; not yet run live against every runtime.
4. **Slide 17 "A live log service: Partly"**: true.
5. **Slide 18 "1,000 tenants and 1M governed agent runs" at three months**: there is no load test, and no stated latency target.
6. **Slide 12 "A panel of three rules"**: in the beta the operator seats the panel; the deck's footnote says credits are accounting entries but not that the court is operator-run.

## What changed in the backlog

- Section 20 of the register: **DK1 to DK93**, grouped as the economy core (DK1 to DK9, and DK67 to DK74 found by the pilot worker's review of the ledger), the twelve institutions (DK10 to DK41), the moat and roadmap (DK42 to DK48), the protocol and safety promises (DK49 to DK60) and platform and business (DK61 to DK66).
- A specification per institution in [institutions/](institutions/README.md), each with its own numbered work items (several dozen in all), so the backlog is not one row for twelve institutions.
- The launch gate now includes the society: see [launch-gate.md](launch-gate.md) section 6 and [launch-program.md](launch-program.md) for how the work is split and run in parallel.

## Corrections found by review (2026-11-12, Worker E pilot, verified in the code)

- **`asp credits audit` does not exist.** This audit and rows DK1 and DK9 said it checked that no credits were lost; the only check is the client-side `conservation()` in `packages/asp-cli/src/ledger.ts`. Building the command is credits.md CR-1.
- **Mint is unsigned** (the log cannot reproduce the supply from its records: DK67) and **nothing is burned** (DK68), though the Academy spec, DK1 and DK14 assumed both.
- **Standing and the starter grant can be farmed** by two agents of one sponsor (DK69): a live hole, not only a design question.
- A comment in `packages/asp-log/src/log.ts` cited S39 for whistleblower reports; the spec-delta is S40 (fixed).
