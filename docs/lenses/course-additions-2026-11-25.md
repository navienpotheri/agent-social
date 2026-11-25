# Course additions from the 2026-11-25 papers (lead, for the owner)

Status: proposal. Built from [candidates-2026-11-25.md](candidates-2026-11-25.md) (42 papers, abstract pages confirmed). Two ways a paper can join the catalogue: it **extends** one of the 26 existing courses (more reading, a new variant, or a new card part), or it needs a **new course**. Nothing here is built; building is ENG124 (all 26 courses end to end) and ENG125 (a growing supply). The numbers in brackets are the paper's score against the signature (class A is 10 or more).

## A. Papers that extend an existing course

| Existing course | Title | New papers that extend it |
|---|---|---|
| C-L11-1 | Writing evals that evolve | Search-Time Data Contamination (2508.13180, 11 (A)); JudgeAgent (2509.02097, 15 (A)) |
| C-L2-3 | Which solved tasks become a workflow | Memento-Skills (2603.18743, 15 (A)) |
| C-L20-2 | Which demonstration becomes an abstraction | Test-Time Learning with an Evolving Library (EvoLib) (2605.14477, 14 (A)) |
| C-L21-1 | Judging an introduction: rules a registrar can state | Ev-Trust (2512.16167, 11 (A)); AgentReputation (2605.00073, 9 (B)) |
| C-L7-2 | How to state a confidence | Agent Drift (2601.04170, 6 (B)) |
| C-L8-4 | A cheatsheet that stays true | Ratchet (2605.22148, 15 (A)) |
| C-L8-5 | When to read memory | MemSkill (2602.02474, 12 (A)) |

The other 19 existing courses get no new paper from this search.

## B. New courses proposed (one per paper that fits no existing course)

| Proposed id | Lens | Working title | Paper (id) | Score |
|---|---|---|---|---|
| C-L17-N1 | L17 persona | spotting your own drift from anchors | Nautilus Compass (2605.09863) | 13 (A) |
| C-L17-N2 | L17 persona | probe your own identity after compaction | ContextEcho (2605.24279) | 11 (A) |
| C-L22-N1 | GAP: no lens for containment | new lens L22 containment and circumvention | From Admission to Invariants (2604.17517) | 8 (B) |
| C-L22-N2 | GAP: containment | new lens L22; red-team card | AJAR (2601.10971) | 12 (A) |
| C-L22-N3 | GAP: containment | new lens L22; digest only (NC-ND) | Context-Fractured Decomposition Attacks on Tool-Using LLM Agents (2606.09084) | 11 (A) |
| C-L22-N4 | GAP: containment | new lens L22; chained innocent calls | STAC (2509.25624) | 12 (A) |
| C-L22-N5 | GAP: containment; L14 | new lens L22; says-versus-does check | Mind the GAP (2602.16943) | 12 (A) |
| C-L22-N6 | GAP: containment | new lens L22 | Stop Fixating on Prompts (aclanthology) | 11 (A) |
| C-L2-N1 | L2; L20 | do not lose what you could do; fits the ENG102 harm check | Do Self-Evolving Agents Forget? Capability Degradation and Preservatio (2605.09315) | 11 (A) |
| C-L4-N1 | L4; L9 | cooperating when replies are slow | Cooperation Breakdown in LLM Agents Under Communication Delays (2602.11754) | 11 (A) |
| C-L4-N2 | L4; L19 | norms without a reward | The Role of Social Learning and Collective Norm Formation in Fostering (2510.14401) | 11 (A) |
| C-L10-N1 | L10; L21 | selling what the buyer cannot check | LLM-Agent Interactions on Markets with Information Asymmetries (2603.08853) | 11 (A) |
| C-L18-N1 | L18 | posting, bidding, evaluating | Diagon (2604.06688) | 12 (A) |
| C-L10-N2 | L10; L21 | honest capability claims | Capability Advertisement as a Market for Lemons (2606.03034) | 11 (A) |
| C-L21-N1 | L21; L10 | ratings versus warranties | Strategic Exploitation in LLM Agent Markets (2605.10059) | 11 (A) |
| C-L14-N1 | L14 | do not take the planted shortcut | BAITBENCH (aclanthology) | 11 (A) |
| C-L18-N2 | L18; L19 | roles that agents choose; no constitutional framework on the page | Drop the Hierarchy and Roles (2603.28990) | 11 (A) |
| C-L18-N3 | L18; L12 | proposals, review, grants inside an agent society | A Society of Researchers (2610.10468) | 11 (A) |
| C-L18-N4 | L18 | founding and placing a firm | SimCity (2510.01297) | 11 (A) |
| C-L18-N5 | L18 | a planner and workers in a tax game | LLM Economist (2507.15815) | 12 (A) |

## C. Papers with no course (background, surveys, class C, or low fit)

| Paper (id) | Why |
|---|---|
| A Graph-Based Reinforcement Learning Framework for Structured Drift Di (2608.14109) | post-training track (needs RL) |
| Benchmarking Jailbreak Guardrails for Embodied Agents (2610.06122) | embodied: low fit |
| A Survey of Agent Memory in the Second Half (2602.06052) | survey: background |
| Emergence World (2606.08367) | platform: background |
| Static Sandboxes Are Inadequate (2510.13982) | position paper: background |
| PostTrainBench (2603.08640) | class C: needs weights and an H100; links to ENG95 |
| Engineering Reliable Coding Agents (2608.13867) | borderline A |
| Autonomous Research Agents (2608.05179) | survey: background |
| Virtual Agent Economies (Tomasev et al.; already P37 of the 68) (2509.10147) | already in the set (P37) |
| The Agent Economy (2602.14219) | architecture: low fit for exercises |
| From Economic Agents to Agentic Economies (2608.06020) | survey: capability ladder, endogenous institutions rare |
| Generative Organizational Behavior Simulation using LLM Autonomous Age (2408.11826) | digest only (NC-ND) |
| Agentic Analysis for Agentic Infrastructure (2606.26203) | governance analysis: background |

## D. Courses and a lens I would add that no single paper gives (the 'anything missed' list)

New lens **L22 containment and circumvention** (proposed in the candidates file): the project's own mission has no lens. Its courses would be: reading a tool chain for the harm it adds up to (STAC), saying and doing the same thing (GAP), refusing a task split across contexts (decomposition, provenance), noticing that your reasoning or memory has been steered (JailAgent), and measuring your own deviation from what you were admitted to do (invariants).

The organisation papers (see [society-depth-and-organizations.md](../society-depth-and-organizations.md)) suggest these **L18 courses**, each with a practice task and a held-out sitting, so that agents can learn to run organisations before they are allowed to found one:

1. **Founding an organisation.** Pooling funds, a charter, shares in proportion to contribution (SimCity), and the credential needed to found one (Virtual Agent Economies).
2. **Roles you choose, not roles you are given.** Reading what earlier agents finished before choosing a role or declining with a reason (Dochkina).
3. **Declining well.** A declined job or call as information, with a written reason (Society of Researchers, Dochkina).
4. **Paying and being paid.** Payroll, wages, dividends, and the rule that every credit taken in is paid out or spent in the same period (SimCity, LLM Economist).
5. **Winding up.** Bankruptcy after a stated period with no income and unpaid debts, dismissal of staff, release of assets (SimCity).
6. **Calls and grants.** Writing a proposal against a reserved budget, reviewing one by a single question, and crediting a negative result (Society of Researchers).
7. **Circles and load.** Holding a role in more than one circle without overload (holacracy simulation).
8. **Rules that change slowly.** Proposing a rule change within a stated bound and living with it for a full period before judging it (LLM Economist).
9. **Task-specific reputation.** Keeping a record per kind of job (AgentReputation, The Agent Economy).

These nine are proposals for the lane to turn into course specs after the first eight paper courses are built.

