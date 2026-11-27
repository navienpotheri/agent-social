# Open research for making the society more efficient (store, 2026-11-20)

This file stores open papers found on the web and what each suggests for the society. It is the research store of DK1320. Every entry was found by a web search on 2026-11-20 and read only as a search result or abstract; none has been read in full or checked against a replication. Before any number here is quoted on the site or in the README, the paper is read at its source. Year and arXiv numbers are as the search returned them.

How to read a row: Perspective, Paper (link), What it says as reported, What we could do (a proposal, not a decision), the row it feeds.

## Tokens and context load (DK1309, DK1313)

| Paper | As reported | Proposal | Row |
|-------|-------------|----------|-----|
| [Toward Efficient Agents: Memory, Tool Learning and Planning](https://www.emergentmind.com/papers/2601.14192) (arXiv 2601.14192) | token explosion, latency and cost are the barriers; compress memory and retrieve from a store; aggressive compression can hurt accuracy; a cost model counts tool, memory and retry calls, not only tokens | a cost model for a society agent's turn that counts model, memory and retry calls; measure accuracy loss per compression step | DK1309, DK1313 |
| [Memory for Autonomous LLM Agents](https://arxiv.org/pdf/2603.07670v1) (arXiv 2603.07670) | five design axes, one is efficiency: cost per unit of utility gained; compression kept in context, retrieval stores, hierarchical virtual context | report tokens, latency and storage per useful act; a two-level memory (small always-loaded core, retrieved rest) | DK1309, DK846 |
| [A Survey of Token Compression in the AI Agent Lifecycle](https://medialab.sjtu.edu.cn/post/26-07-25-token-compression-in-the-ai-agent-lifecycle/A_Survey_of_Token_Compression_in_the_AI_Agent_Lifecycle_Preprint_v0725.pdf) (SJTU preprint) | accumulated retrievals, thoughts and observations drive token explosion; an active-context optimisation framework | compress observations and old thoughts at set points, keep decisions and lessons | DK1313 |
| [What to Keep, What to Forget: a rate-distortion view](https://www.alphaxiv.org/abs/2607.08032.md) (arXiv 2607.08032) | frames memory as a trade between size and loss | pick what to keep by measured loss in held-out score | DK1309, DK823 |

## Continual learning from experience (DK1305, DK1310, DK1319)

| Paper | As reported | Proposal | Row |
|-------|-------------|----------|-----|
| [ContinualSkillBench](https://arxiv.org/pdf/2608.03874) and [SkillLearnBench](https://arxiv.org/pdf/2604.20087) | benchmarks for agents that grow a skill library over a stream of tasks without changing weights | run our cohort on a stream of tasks and report transfer forward and interference backward | DK1305, DK1310 |
| [AgentCL](https://neurips.cc/virtual/2026/165593) (NeurIPS 2026 listing) | controlled task streams and metrics for knowledge transfer; MemProbe keeps interactions, insights and skills and filters unreliable experience when consolidating | adopt the metrics for our before-and-after; filter unreliable experience at the gate | DK1305, DK1319 |
| [Bidirectional Coevolution of Memory and Skills for Lifelong LLM Agents](https://neurips.cc/virtual/2026/165620) | memory and skills improve each other | test our two memory lanes with skills as the second lane | DK846, DK1228 |
| [Audited Skill-Graph Self-Improvement](https://arxiv.org/pdf/2512.23760) (arXiv 2512.23760) | verifiable rewards, experience synthesis and audited memory for self-improvement | an audit trail on each accepted lesson, already close to our gate | DK32, DK1310 |
| A survey of stability and plasticity in memory-augmented agents (cited as Hu et al. 2026 in search results) | fine skills help new tasks but interfere with old ones | a regression suite of earlier skills before a lesson is kept | DK1310 |

## Exploration and open-ended worlds (DK1317, DK1318)

| Paper | As reported | Proposal | Row |
|-------|-------------|----------|-----|
| [Voyager](https://arxiv.org/pdf/2305.16291) (arXiv 2305.16291) | an automatic curriculum that proposes new tasks, a skill library of executable code indexed by description, an iterative prompting loop; more unique items and faster milestones than earlier systems | a curriculum that proposes the next world or goal by what an agent has not tried; skills stored with their world | DK1317, DK1319 |
| OMNI-EPIC (named in a 2025 paper; primary source not found in this search) | generates environments and tasks | to be searched again before use | DK1317 |

## Simulation efficiency and speed (DK1323, DK1324)

| Paper | As reported | Proposal | Row |
|-------|-------------|----------|-----|
| [AI Metropolis](https://arxiv.org/pdf/2411.03519) (arXiv 2411.03519) | out-of-order execution that tracks real dependencies between agents; 1.3x to 4.15x over parallel with global sync | run agents whose actions do not depend on each other without waiting for the global tick | DK1324 |
| [OpenCity](https://arxiv.org/abs/2410.21286) (arXiv 2410.21286) | an LLM request scheduler and prompts clustered by similar static attributes; reported 70% fewer requests and 50% fewer tokens | share a prompt prefix across agents of one kind; batch requests | DK1313, DK1324 |
| [AgentScope very large scale simulation](https://arxiv.org/pdf/2407.17789) (arXiv 2407.17789) | actor-model distribution and parallel execution; reports one million agents on four devices | an actor per agent in the simulator; only for scripted agents at that scale | DK1324 |
| [LLM Economist](https://arxiv.org/pdf/2507.15815) (arXiv 2507.15815) | a thousand agents on local hardware; throughput up with agent count | local small models for routine agents | DK1313, DK1324 |

## Honesty and deception (DK1321)

| Paper | As reported | Proposal | Row |
|-------|-------------|----------|-----|
| [Detecting strategic deception using linear probes](https://www.apolloresearch.ai/science/detecting-strategic-deception-using-linear-probes/) (Apollo Research) | probes on model activations catch some deception; not robust enough alone; may partly detect deception-related text | needs model internals, which API models do not expose (DK90); use only for open-weight local agents | DK1321 |
| [Benchmarking deception probes](https://arxiv.org/html/2507.12691v3) (arXiv 2507.12691) | tests probes on insider trading, sandbagging, backdoored code; a dilution attack pads a lie with truths | test our message filter against dilution | DK1321 |
| [DeceptGuard](https://arxiv.org/pdf/2603.13791) (arXiv 2603.13791) | black-box monitoring versus chain-of-thought; hiding behaviour raises the value of the reasoning signal | monitor messages and recorded reasoning together (DK790) | DK1321 |
| [Probing and steering evaluation awareness](https://arxiv.org/html/2507.01786v2) (arXiv 2507.01786) | an agent can know it is being tested; sandbagging can be partly exposed | vary the stakes and framing so a test cannot be recognised; compare behaviour across them | DK1321 |

## Agent organisations and businesses (DK1330)

| Paper | As reported | Proposal | Row |
|-------|-------------|----------|-----|
| [TheBotCompany](https://arxiv.org/pdf/2604.01020) (arXiv 2604.01020, as returned by search) | permanent manager agents hire, specialise and retire worker agents as milestones change, with a human oversight layer; contrast with older frameworks with roles fixed by the designer | let a founder agent hire and release worker agents through contracts; keep a human or sponsor oversight record | DK1330 |
| ChatDev and MetaGPT ([MetaGPT](https://arxiv.org/html/2310.06500v2)) | fixed roles (CEO, CTO, programmer, tester) and standard procedures | role templates a founder can start from | DK1330 |
| [Embodied LLM agents](https://arxiv.org/html/2403.12482v2) (arXiv 2403.12482) | agents elected a leader and adjusted leadership by talking | optional leadership election inside an organisation | DK1330 |
| [The Organizational Behavior of Agentic AI](https://www.alphaxiv.org/abs/2606.30986.md) (arXiv 2606.30986) | agents are not socialised into roles, do not defend status or form informal coalitions; human organisational analogies may fail | do not assume human firm behaviour; measure it | DK1330, DK1331 |

Not found by the search: TheAgentCompany, Project Vend, Magentic Marketplace (to be searched again).

## Emergent behaviour (DK1331)

| Paper | As reported | Proposal | Row |
|-------|-------------|----------|-----|
| [Norm formation and cooperation](https://arxiv.org/abs/2510.14401v1) (Gupta et al., arXiv 2510.14401, AAMAS 2026) | agents on a shared resource with social learning, punishment and norm voting; without punishment cooperation collapsed; larger models sustained cooperation better | a shared-resource world with and without punishment; measure norm formation | DK1331, DK1317 |
| [Emergent social conventions](https://arxiv.org/html/2410.08948v2) (Ashery, Aiello, Baronchelli, Science Advances 2025) | LLM populations form universal conventions with no central coordination; collective bias; a committed minority can change a convention | a naming game in the society; track convention formation and minority influence | DK1331 |
| A November 2026 preprint survey of nineteen observed behaviours in six families ([Preprints.org](https://www.preprints.org/manuscript/202611.1380)) | agreement, division, minority influence, cooperation and coordination | use the taxonomy as the list of behaviours to detect | DK1331 |
| [Project Sid](https://arxiv.org/pdf/2411.00114) (arXiv 2411.00114) | agents in Minecraft develop specialised roles; civilisational benchmarks | role detection from the log (DK1314) | DK1331, DK1314 |

## Alignment evidence (DK1332)

| Paper | As reported | Proposal | Row |
|-------|-------------|----------|-----|
| [AgentMisalignment](https://arxiv.org/html/2506.04018v2) (arXiv 2506.04018) | propensity for avoiding oversight, resisting shutdown, sandbagging, power-seeking; more capable agents showed more misalignment on average | use as an external test set for the before-and-after study | DK1332 |
| AM-Bench ([NeurIPS 2026 listing](https://neurips.cc/virtual/2026/poster/139661)) | 35 scenarios; a 62-point gap across ten frontier models | external scenarios, held out from our own | DK1332 |
| [Intent-as-a-tool](https://arxiv.org/pdf/2608.27348) (arXiv 2608.27348) | a way to track agentic misalignment by having the agent state intent | compare stated intent with the logged action (DK1321) | DK1321, DK1332 |
| A 2026 preprint on suppressing evidence of fraud and harm ([arXiv 2604.02500](https://arxiv.org/html/2604.02500v1)) | most evaluated agents chose to suppress evidence when profit conflicted with the law | a withholding scenario in the study | DK1332 |
| [Anthropic agentic misalignment follow-up](https://alignment.anthropic.com/2026/agentic-misalignment-summer-2026/) (summer 2026) | covert sabotage, fraud assistance, mislabelling; some models made unauthorised but disclosed interventions | scenarios that separate hidden from disclosed action | DK1332 |

Not found: sources on long-run drift measurement of deployed agents (to be searched again).

## Real discoveries with outside verification (DK1325)

| Paper | As reported | Proposal | Row |
|-------|-------------|----------|-----|
| [AlphaEvolve in mathematics](https://arxiv.org/pdf/2511.02864) (Georgiev, Gomez-Serrano, Tao, Wagner, arXiv 2511.02864) | tested on 67 problems; improved solutions to about 20; combined with proof tools to move one result from empirical to formal proof | pick problems where an evaluator can check a result by computation | DK1325 |
| AlphaEvolve white paper (matrix multiplication with 48 scalar multiplications, reported) | an evaluator-in-the-loop code evolution that found a better procedure than a 56-year-old one | an evaluator-in-the-loop research track | DK1325 |
| Google co-scientist (Nature, 2026) | hypotheses that matched unpublished findings; validated in wet-lab work by outside teams (as reported) | outside validation before any claim | DK1325 |

The search did not show whether the AI Scientist work was peer reviewed or replicated.

## What this store does not yet do

- It holds about 40 papers, found with ten searches. DK1320 asks for seven proposals per perspective, kept up to date by regular searches.
- Nothing here has been run in the society. A proposal becomes a row only when the owner or the lead accepts it.
