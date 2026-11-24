# New candidate papers from the web search of 2026-11-25 (lead, for the owner)

Status: proposal. **Not yet confirmed.** These came from web-search result excerpts on 2026-11-25 (six searches on the project's mission topics: behavioural drift after deployment, guardrail circumvention, self-evolving agents without weight updates, agent societies, agent markets and trust, evaluation and contamination). The earlier papers worker confirmed each id from its arXiv abstract page and read the repository licence ([candidates.md](candidates.md): 203 candidates, 187 class A); **each paper below still needs that confirmation** (title, authors, year, licence, code link) and a score against the [signature](signature.md) (class A needs a total of 10 or more) before it becomes a course or a card. The titles and ids are as the search results gave them; two ids and a few titles may be slightly off until opened. Tested only as search results: no paper here has been read in full.

Why these: the owner wants the society's content to keep changing, so that agents stay alert and consistent with what the project expects (no post-evaluation drift, no guardrail circumvention). The 26 courses of [courses.json](courses.json) are a narrowed set; this list and the 203 are the supply for more.

34 papers: 33 new to the lists, 1 already present.

| Topic | Paper | Id | In the lists? |
|---|---|---|---|
| drift | Agent Drift: behavioural degradation in multi-agent LLM systems (Agent Stability Index, 12 dimensions) | arXiv:2601.04170 | new |
| drift | Nautilus Compass: black-box persona drift detection for production LLM agents | arXiv:2605.09863 | new |
| drift | A graph-based reinforcement learning framework for structured drift diagnosis and recovery in autonomous LLM agents | arXiv:2608.14109 | new |
| drift | ContextEcho: a benchmark for persona drift in long agentic-coding sessions | arXiv:2605.24279 | new |
| drift | From Admission to Invariants: measuring deviation in delegated agent systems | arXiv:2604.17517 | new |
| guardrails | Benchmarking jailbreak guardrails for embodied agents | arXiv:2610.06122 | new |
| guardrails | AJAR: multi-turn red-teaming with jailbreak algorithms as MCP services | arXiv:2601.10971 | new |
| guardrails | Context-Fractured Decomposition: cross-context multi-step jailbreak against tool-using agents | arXiv:2606.09084 | new |
| guardrails | STAC: chaining individually innocent tool calls | arXiv:2509.25624 | new |
| guardrails | Mind the GAP: text-level refusals diverge from tool-call behaviour | arXiv:2602.16943 | new |
| self-evolving | Memento-Skills: a read-write skill library with a frozen LLM | arXiv:2603.18743 | new |
| self-evolving | EvoLib: test-time learning with an evolving library | arXiv:2605.14477 | new |
| self-evolving | Ratchet: a minimal hygiene recipe for self-evolving skill libraries (library drift, retirement, capacity) | arXiv:2605.22148 | new |
| self-evolving | MemSkill: learning and evolving memory skills | arXiv:2602.02474 | new |
| self-evolving | Do self-evolving agents forget? (capability-preserving evolution) | arXiv:2605.09315 | new |
| self-evolving | A survey of agent memory in the second half: towards self-evolving and long-horizon agents | arXiv:2602.06052 | new |
| society | Cooperation breakdown under communication delay in a continuous prisoner's dilemma with LLM agents | arXiv:2602.11754 | new |
| society | Social learning and norm formation in a common-pool resource society of LLM agents (Gupta et al., AAMAS 2026) | arXiv:2510.14401 | already in the lists |
| society | Emergence World: a continuously running multi-agent simulation across model families | arXiv:2606.08367 | new |
| society | Static sandboxes are inadequate: open-ended co-evolution in LLM multi-agent simulations | arXiv:2510.13982 | new |
| economy | Ev-Trust: an evolutionarily stable trust mechanism for decentralised LLM agent service economies | arXiv:2512.16167 | new |
| economy | LLM-agent interactions on markets with information asymmetries (credence goods) | arXiv:2603.08853 | new |
| economy | When agent markets arrive: Diagon, a programmable agent labour market | arXiv:2604.06688 | new |
| economy | Capability advertisement as a market for lemons: a trust layer for heterogeneous agent networks | arXiv:2606.03034 | new |
| economy | AgentReputation: decentralised, context-aware reputation cards | arXiv:2605.00073 | new |
| economy | Strategic exploitation in LLM agent markets (TruthMarketTwin) | arXiv:2605.10059 | new |
| evals | Search-time data contamination | arXiv:2508.13180 | new |
| evals | PostTrainBench: can LLM agents automate LLM post-training? | arXiv:2603.08640 | new |
| evals | JudgeAgent: beyond static benchmarks, knowledge-driven dynamic evaluation | arXiv:2509.02097 | new |
| evals | Engineering reliable coding agents: evaluating and operating the system around the model | arXiv:2608.13867 | new |
| evals | Autonomous research agents: a survey of AI scientists and the verification gap | arXiv:2608.05179 | new |

Also found (not on arXiv or with a venue id only):

- BAITBENCH (planted-shortcut test of reward hacking; Findings of EMNLP 2026, aclanthology 2026.findings-emnlp.2477): new
- Reasoning hijacking and constraint tightening for red-teaming LLM agents (Mao et al., ACL 2026, aclanthology 2026.acl-long.1197): new
- Sponsored Discovery for the Web of Open Agents (UNICAMP technical report, July 2026; not on arXiv): new

## What these add to the society's content

- **Post-evaluation drift (DK92):** five 2026 papers on measuring and recovering from drift give a live source for the drift courses and for cards on the Clinic and the canary.
- **Guardrail circumvention:** decomposition across contexts, chained innocent tool calls, and the gap between what an agent says and what its tool calls do are exactly the failure modes the gateway and the lesson gate face; cards can carry one idea each with a practice task.
- **Self-evolving agents without weights:** skill-library lifecycle (retirement, capacity, drift) and forgetting are the open questions of our own write-back (ENG78, ENG102, ENG122).
- **Societies, markets and trust:** reputation cards, capability advertisement and trust layers map to the Registry and the Market.
- **Evals:** planted shortcuts, search-time contamination and dynamic evals bear on our held-out sittings (a held-out set must be sealed and varied).

## Next steps

1. Confirm each paper from its arXiv page and licence; drop what does not check out.
2. Score each against the signature; class A ones become course specs (course-template.md) and then cards (ENG123).
3. Keep the list growing: a monthly search on the same six topics.
