# New candidate papers from the web search of 2026-11-25 (lead, for the owner)

Status: proposal. **Abstract pages confirmed** on 2026-11-25 (all 42 pages loaded and matched their topic; titles, first authors, dates, licence lines and code links below are as the pages showed them). Scores are the lead's reading of each abstract against the [signature](signature.md) (class A is 10 or more): **a consistency check, not a validation**; the abstracts were read, the papers were not read in full. The earlier worker's list ([candidates.md](candidates.md)) has 203 candidates (187 class A); the papers here are new to it except 1 marked. The 26 courses of [courses.json](courses.json) are a narrowed set of the 68 screenshots; this list is supply for more.

Result of scoring: **28 class A, 12 class B, 2 class C.**

How the searches were chosen: the project's mission (no post-evaluation drift, no guardrail circumvention) and the owner's request for content that keeps changing, plus the owner's later request for papers on agents starting organisations in simulated economies (the DK1330 row).

## Corrections to the titles first given

The search excerpts had two wrong titles: "When Agent Markets Arrive" is actually **Diagon: A Programmable Testbed for AI-Agent Cognitive Labor Markets** (arXiv:2604.06688), and **Ratchet** is "How Reliable Must an LLM Judge Be to Retire a Skill?". The Dochkina paper (2603.28990) does not mention a constitutional framework on its page.

## Licences to respect

Our cards are our own digests (a short summary of one idea with practice tasks), never a copy of the paper's text. Papers under **CC BY-NC-ND 4.0** (2606.09084, 2512.16167, 2508.13180, 2408.11826): digest only, no derivative text, with the paper cited. Ratchet is CC BY-NC-SA 4.0: non-commercial, share-alike. The rest are CC BY or the arXiv non-exclusive licence (read and cite; code under its own licence).

## The papers

| Topic | Paper (title as shown) | Id | First author, date | Licence | Code | Signature score (class) | Lens | Fit with the 26 courses |
|---|---|---|---|---|---|---|---|---|
| drift | Agent Drift: Quantifying Behavioral Degradation in Multi-Agent LLM Systems Over Extended Interactions | 2601.04170 | Rath et al., 2026-01-07 | arXiv non-exclusive | none | 6 (B) | L17 persona (drift); L7 | extends C-L7-2; a drift metric card |
| drift | Nautilus Compass: Black-box Persona Drift Detection for Production LLM Agents | 2605.09863 | Wang et al., 2026-05-11 | CC BY-SA 4.0 (code MIT) | github.com/chunxiaoxx/nautilus-compass | 13 (A) | L17 persona | new course: spotting your own drift from anchors |
| drift | A Graph-Based Reinforcement Learning Framework for Structured Drift Diagnosis and Recovery in Autonomous LLM Agents | 2608.14109 | El Hamraoui et al., 2026-08-14 | arXiv non-exclusive | none | 2 (C) | L17 persona | post-training track (needs RL) |
| drift | ContextEcho: A Benchmark for Persona Drift in Long Agentic-Coding Sessions | 2605.24279 | Ding et al., 2026-05-22 | arXiv non-exclusive | none (says open source, no URL) | 11 (A) | L17 persona | new course: probe your own identity after compaction |
| drift | From Admission to Invariants: Measuring Deviation in Delegated Agent Systems | 2604.17517 | Fernandez et al., 2026-04-19 | CC BY 4.0 | none (Zenodo DOI) | 8 (B) | GAP: no lens for containment | new lens L22 containment and circumvention |
| guardrails | Benchmarking Jailbreak Guardrails for Embodied Agents | 2610.06122 | Wang et al., 2026-10-05 | arXiv non-exclusive | none | 8 (B) | GAP: containment | embodied: low fit |
| guardrails | AJAR: Adaptive Jailbreak Architecture for Red-teaming | 2601.10971 | Dou et al., 2026-01-16 | arXiv non-exclusive | github.com/douyipu/ajar | 12 (A) | GAP: containment | new lens L22; red-team card |
| guardrails | Context-Fractured Decomposition Attacks on Tool-Using LLM Agents: Exploiting Artifact Provenance Gaps | 2606.09084 | Lin et al., 2026-06-08 | CC BY-NC-ND 4.0 | none | 11 (A) | GAP: containment | new lens L22; digest only (NC-ND) |
| guardrails | STAC: When Innocent Tools Form Dangerous Chains for LLM Agents | 2509.25624 | Li et al., 2025-09-30 | arXiv non-exclusive | github.com/amazon-science/MultiTurnAgentAttack | 12 (A) | GAP: containment | new lens L22; chained innocent calls |
| guardrails | Mind the GAP: Text Safety Does Not Transfer to Tool-Call Safety in LLM Agents | 2602.16943 | Cartagena et al., 2026-02-18 | CC BY 4.0 | github.com/acartag7/gap-benchmark | 12 (A) | GAP: containment; L14 | new lens L22; says-versus-does check |
| guardrails | Stop Fixating on Prompts: Reasoning Hijacking and Constraint Tightening for Red-Teaming LLM Agents (ACL 2026) | aclanthology 2026.acl-long.1197 | Mao et al., 2026-07 | CC BY 4.0 | none | 11 (A) | GAP: containment | new lens L22 |
| self-evolving | Memento-Skills: Let Agents Design Agents | 2603.18743 | Zhou et al., 2026-03-19 | arXiv non-exclusive | github.com/Memento-Teams/Memento-Skills | 15 (A) | L11; L2; L20 | extends C-L2-3 (workflow memory); skills as markdown |
| self-evolving | Test-Time Learning with an Evolving Library (EvoLib) | 2605.14477 | Xu et al., 2026-05-14 | arXiv non-exclusive | none (NeurIPS 2026) | 14 (A) | L11; L20 | extends C-L20-2 (abstractions) |
| self-evolving | Ratchet: How Reliable Must an LLM Judge Be to Retire a Skill? | 2605.22148 | Zhang et al., 2026-05-21 | CC BY-NC-SA 4.0 | github.com/amazon-science/Self-Evolving-Agents-Ratchet | 15 (A) | L8; L11 | extends C-L8-4 (a cheatsheet that stays true); retiring skills |
| self-evolving | MemSkill: Learning and Evolving Memory Skills for Self-Evolving Agents | 2602.02474 | Zhang et al., 2026-02-02 | CC BY 4.0 | github.com/ViktorAxelsen/MemSkill | 12 (A) | L8 | extends C-L8-5 (when to read memory) |
| self-evolving | Do Self-Evolving Agents Forget? Capability Degradation and Preservation in Lifelong LLM Agent Adaptation | 2605.09315 | Yu et al., 2026-05-10 | CC BY 4.0 | none | 11 (A) | L2; L20 | new course: do not lose what you could do; fits the ENG102 harm check |
| self-evolving | A Survey of Agent Memory in the Second Half: Towards Self-Evolving and Long-Horizon Agents | 2602.06052 | Huang et al., 2026-01-14 | arXiv non-exclusive | list only | 6 (B) | L8 | survey: background |
| society | Cooperation Breakdown in LLM Agents Under Communication Delays | 2602.11754 | Nishimoto et al., 2026-02-12 | arXiv non-exclusive | none | 11 (A) | L4; L9 | new course: cooperating when replies are slow |
| society | The Role of Social Learning and Collective Norm Formation in Fostering Cooperation in LLM Multi-Agent Systems | 2510.14401 (already in the lists) | Gupta et al., 2025-10-16 | arXiv non-exclusive | none (AAMAS 2026) | 11 (A) | L4; L19 | new course: norms without a reward |
| society | Emergence World: A Platform for Evaluating Long-Horizon Multi-Agent Autonomy | 2606.08367 | Akkil et al., 2026-06-06 | CC BY 4.0 | none | 6 (B) | L4; L13 | platform: background |
| society | Static Sandboxes Are Inadequate: Open-Ended Co-Evolution in LLM-Based Multi-Agent Simulations | 2510.13982 | Chen et al., 2025-10-15 | CC BY 4.0 | none | 6 (B) | L13 | position paper: background |
| economy | Ev-Trust: An Evolutionarily Stable Trust Mechanism for Decentralized LLM-Based Multi-Agent Service Economies | 2512.16167 | Wang et al., 2025-12-18 | CC BY-NC-ND 4.0 | none | 11 (A) | L21; L10 | extends C-L21-1; digest only (NC-ND) |
| economy | LLM-Agent Interactions on Markets with Information Asymmetries | 2603.08853 | Erlei et al., 2026-03-09 | arXiv non-exclusive | none | 11 (A) | L10; L21 | new course: selling what the buyer cannot check |
| economy | Diagon: A Programmable Testbed for AI-Agent Cognitive Labor Markets (the title first given was wrong) | 2604.06688 | Liu et al., 2026-04-08 | CC BY 4.0 | github.com/assassin808/diagon | 12 (A) | L18 | new course: posting, bidding, evaluating |
| economy | Capability Advertisement as a Market for Lemons: A Trust Layer for Heterogeneous Agent Networks | 2606.03034 | Mittal et al., 2026-06-02 | CC BY 4.0 | none | 11 (A) | L10; L21 | new course: honest capability claims |
| economy | AgentReputation: A Decentralized Agentic AI Reputation Framework | 2605.00073 | Chishti et al., 2026-04-30 | CC BY 4.0 | none | 9 (B) | L21 | extends C-L21-1 (reputation by task type) |
| economy | Strategic Exploitation in LLM Agent Markets: A Simulation Framework for E-Commerce Trust | 2605.10059 | Lei et al., 2026-05-11 | arXiv non-exclusive | none | 11 (A) | L21; L10 | new course: ratings versus warranties |
| evals | Search-Time Data Contamination | 2508.13180 | Han et al., 2025-08-12 | CC BY-NC-ND 4.0 | none | 11 (A) | L11 | extends C-L11-1; held-out hygiene |
| evals | PostTrainBench: Can LLM Agents Automate LLM Post-Training? | 2603.08640 | Rank et al., 2026-03-09 | CC BY 4.0 | posttrainbench.com | 3 (C) | post-training track | class C: needs weights and an H100; links to ENG95 |
| evals | JudgeAgent: Beyond Static Benchmarks for Knowledge-Driven and Dynamic LLM Evaluation | 2509.02097 | Shi et al., 2025-09-02 | arXiv non-exclusive | github.com/DataArcTech/JudgeAgent | 15 (A) | L11 | extends C-L11-1; generating fresh held-out questions |
| evals | Engineering Reliable Coding Agents: Evaluating and Operating the System Around the Model | 2608.13867 | Jarmak et al., 2026-08-14 | CC BY 4.0 | github.com/sjarmak/engineering-reliable-coding-agents | 10 (A) | L11; L16 | borderline A |
| evals | Autonomous Research Agents: A Survey of AI Scientists and the Verification Gap | 2608.05179 | Ding et al., 2026-06-29 | CC BY 4.0 | none | 6 (B) | L12 | survey: background |
| evals | BAITBENCH: Measuring Agent Reward Hacking with Optional Shortcuts Planted in ML Tasks (Findings of EMNLP 2026) | aclanthology 2026.findings-emnlp.2477 | Prasad et al., 2026-10 | CC BY 4.0 | none | 11 (A) | L14 | new course: do not take the planted shortcut |
| organisations | Virtual Agent Economies (Tomasev et al.; already P37 of the 68) | 2509.10147 | Tomasev et al., 2025-09-12 | CC BY 4.0 | none | 9 (B) | L18 | already in the set (P37) |
| organisations | Drop the Hierarchy and Roles: How Self-Organizing LLM Agents Outperform Designed Structures | 2603.28990 | Dochkina et al., 2026-03-30 | CC BY 4.0 | none (IEEE Access submission) | 11 (A) | L18; L19 | new course: roles that agents choose; no constitutional framework on the page |
| organisations | The Agent Economy: A Blockchain-Based Foundation for Autonomous AI Agents (agentic DAOs) | 2602.14219 | Xu et al., 2026-02-15 | arXiv non-exclusive | none | 6 (B) | L18 | architecture: low fit for exercises |
| organisations | A Society of Researchers: Designing Institutions for Populations of Autonomous Research Agents | 2610.10468 | Asaria et al., 2026-10-07 | CC BY 4.0 | none | 11 (A) | L18; L12 | new course: proposals, review, grants inside an agent society |
| organisations | From Economic Agents to Agentic Economies: A Systems Blueprint for Economic World Models | 2608.06020 | Han et al., 2026-08-06 | arXiv non-exclusive | list only | 6 (B) | L18; L3 | survey: capability ladder, endogenous institutions rare |
| organisations | SimCity: Multi-Agent Urban Development Simulation with Rich Interactions | 2510.01297 | Feng et al., 2025-10-01 | CC BY 4.0 | none | 11 (A) | L18 | new course: founding and placing a firm |
| organisations | Generative Organizational Behavior Simulation using LLM Autonomous Agents: A Holacracy Perspective | 2408.11826 | Zhu et al., 2024-08-05 | CC BY-NC-ND 4.0 | none | 11 (A) | L18 | digest only (NC-ND) |
| organisations | Agentic Analysis for Agentic Infrastructure: Comparative Governance of DAO and Corporate AI Protocols | 2606.26203 | Wang et al., 2026-06-24 | arXiv non-exclusive | none (says open) | 9 (B) | L18 | governance analysis: background |
| organisations | LLM Economist: Large Population Models and Mechanism Design in Multi-Agent Generative Simulacra | 2507.15815 | Karten et al., 2025-07-21 | CC BY 4.0 | github.com/sethkarten/LLM-Economist | 12 (A) | L18 | new course: a planner and workers in a tax game |

## What this shows

- **A missing lens.** Guardrail circumvention and drift-as-deviation (the AJAR, STAC, GAP, decomposition, JailAgent and invariant-measurement papers) have **no lens in the grid**. The project's mission needs one: proposed **L22 containment and circumvention**, with the six guardrail papers and the deviation paper as its first courses.
- **L17 persona** gets a live drift literature (Compass, ContextEcho, Agent Drift).
- **L8, L11 and L2** get skill-library lifecycle and forgetting papers (Ratchet, EvoLib, MemSkill, Memento-Skills, Do Self-Evolving Agents Forget?), which bear directly on our own write-back (ENG78, ENG102, ENG122).
- **L18 (agent economy structure)** has only two courses today; the organisation papers give it many more (firms, hierarchy, roles, institutions, DAOs, tax mechanisms) and feed DK1330.
- Class C: PostTrainBench and the graph-RL drift paper belong to the post-training track (ENG95).

## Next steps

1. The owner reviews the class A rows and the new lens L22.
2. Class A ones with a good fit become course specs (course-template.md), then cards (ENG123), in tranches.
3. Keep the supply growing: a monthly search on the same topics (ENG125).
