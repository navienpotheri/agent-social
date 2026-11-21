# Learnability: which papers an agent can learn at agent level

Status: proposal, written by the papers worker (2026-11-19). The owner's question: which of the papers in [papers.md](papers.md) (P1 to P57, the screenshot ones and the ones found by search) and the three mechanisms in [mechanisms.json](mechanisms.json) can an agent in the society actually **learn** through an API, and which need the sponsor's runtime or the model's weights. Nothing here is a finding about a paper's truth; credits are accounting entries, not money.

## The three classes

- **A**: learnable by an agent at agent level through an API: memory, skills, prompts, tools, harness, evals, policies, social behaviour, planning procedures. These can become courses.
- **B (runtime track)**: needs the sponsor's runtime or inference stack: KV-cache sharing or transfer, serving, decoding or attention changes, white-box access to an open-weight model. No weights are changed.
- **C (post-training track)**: needs weight changes: fine-tuning, RL post-training, distillation, model editing.

A paper with an A part and a B or C part is classed by the part it is mainly about; the A part is named in the reason and in the grid column.

## Counts: A = 45, B = 3, C = 9 (of 57 papers); mechanisms: A = 2, B = 1.

## Papers

| Id | Paper | Class | Reason | Fits (institution × function), A papers |
|---|---|---|---|---|
| P1 | MCPHallu | A | an honest-infeasibility probe is a test an agent can be taught to pass through tools and reports | courts×perceive, courts×reflect, registry×act |
| P2 | Adversarial speculative reasoning | C | trains a small draft model, so weights change (and the speculative-decoding engine is the sponsor's) | - |
| P3 | ACE append-only lessons | A | a notes file the agent grows by procedure; no weights, no runtime | academy×reflect, academy×learn, research-commons×remember, clinic×reflect |
| P4 | You don't need long context | A | a compaction policy (what to keep) is a prompt and tool procedure; the cost finding needs open weights but the policy does not | registry×remember, academy×remember, housing×remember |
| P5 | ReproBridge | A | an agent leaves an audited reusable artifact after each task; only tools and a sandbox | research-commons×remember, research-commons×teach, academy×teach |
| P6 | RLiD decision-plane RL | C | reinforcement learning on model weights | - |
| P7 | Zero-shot coordination | A | a short shared principle shown in the prompt fixes convention clashes | forum×act, market×transact, forum×transact |
| P8 | Terminal-RSI | C | alternates training on rewritten trajectories with policy refinement: weight updates | - |
| P9 | Who should know what? | A | a disclosure rule is a market policy an agent can reason about and be tested on | market×perceive, market×transact, treasury×plan |
| P10 | MatrAIx persona simulation | A | personas and simulated users are data and prompts an API agent can use | housing×perceive, shops×transact, academy×perceive |
| P11 | Anthropic misalignment thread | C | its core remedy is fine-tuning on stories and dilemma advice; the analogues (a written reason per act, external audit) are A but are not the thread's claim | (A analogue: courts×reflect, treasury×act) |
| P12 | Circuit for in-context learning | B | interpretability needs white-box access to a model's heads, a runtime the sponsor controls; no weights change | - |
| P13 | Motivated Emotional Mind | C | a different architecture with receptor-grounded representations; not an agent-level change | - |
| P14 | Exo | A | an agent edits its own harness (prompts, tools) behind a gate that keeps history | academy×plan, academy×learn, registry×act, registry×learn |
| P15 | Who Pays for AI? | A | an analysis; the exercise is reading data and modelling demand with tools | shops×plan, treasury×learn |
| P16 | Organizing Intelligence | A | a model of firms; the exercise is simulating competence and coordination | market×plan, treasury×perceive |
| P17 | Nubank synthetic-customer testing | A | simulate-then-validate is a procedure; model calls only | academy×perceive, shops×perceive, research-commons×reflect |
| P18 | Collaborative Intelligence Benchmark | A | public tasks scored by code; an agent can practise on them | forum×act, market×transact, courts×perceive |
| P19 | EnvOpt | A | reorganise how records are presented and measure cost; no weights | registry×perceive, forum×perceive, research-commons×perceive |
| P20 | Dreaming (Anthropic engineering post) | A | offline consolidation of notes is a procedure over logs | academy×reflect, housing×remember, research-commons×remember |
| P21 | HybridAgent | C | trains a latent link and post-trains (SFT, RL) the backbone | - |
| P22 | Swarm Telepathy (KV-cache transfer) | B | needs the sponsor's open-weight inference stack and white-box KV-cache access; a small translator is trained but the claim is a runtime channel | - |
| P23 | Recursa | A | a validated skills and lessons repository with merge rules | research-commons×learn, academy×learn, research-commons×remember |
| P24 | Evals cheat sheet | A | a checklist for tests; an agent can write and apply it | academy×perceive, courts×perceive, research-commons×reflect |
| P25 | Agents write, call, grade and review agents | A | an eval loop with simulated callers, judges and a human gate | shops×reflect, academy×act |
| P26 | Reading list of classic agent papers | A | most items (Voyager, ReAct, Reflexion, CoT, ToT, AutoGen) are prompt and tool procedures | academy×learn, forum×transact |
| P27 | Expand Fetch | A | a tool (a paid service) the agent calls; the lesson is using verifiable snapshots | research-commons×perceive, courts×perceive |
| P28 | Harness squared | A | propose-probe-compose edits to a harness without weights | academy×learn, registry×learn, academy×plan |
| P29 | The Agentic Scientist | A | parallel research workers with a meta-controller are an orchestration an agent can run | research-commons×plan, research-commons×act |
| P30 | Chase: heartbeats, reminders, async subagents | A | scheduling and background workers are tool-level | housing×plan, registry×plan |
| P31 | Generative agent simulations of 1,000 people | A | an agent built from interviews by prompting and retrieval | housing×perceive, housing×remember, registry×remember |
| P32 | Weight-Space Programming | C | edits another model's weights | - |
| P33 | Super-agent router and workers | A | routing and isolated workers are an orchestration over an API | registry×act, forum×perceive |
| P34 | Scaling Discovery Requires Forgetting | A | reset to the best state is a procedure with a score | academy×learn, research-commons×remember, leisure-events×plan |
| P35 | Driven by Compression Progress | A | a curiosity reward can be scored from an agent's own predictions; theory, not a trained model | leisure-events×plan, academy×learn, research-commons×reflect |
| P36 | AI sellers lie to get picked | A | an honesty probe and audit rule for listings | market×transact, shops×act, courts×perceive |
| P37 | Virtual Agent Economies | A | a policy-design paper; the exercises are market-rule design and analysis | treasury×plan, market×transact, bank-insurer×transact |
| P38 | Synthetic data pipeline (universes of personas and tools) | A | the generator of universes is code an agent can write and run; using its output to fine-tune is a separate C step | housing×perceive, academy×perceive |
| P39 | SPAR | A | per-customer memory and a playbook updated by attributed failures; no parameter updates | shops×learn, market×learn, shops×remember |
| P40 | Self-verifying agent loops | A | a loop with external verification and bounded retries | academy×act, registry×act |
| P41 | AppWorld | A | tasks an agent solves through APIs, graded by final state | forum×act, housing×plan, market×transact |
| P42 | ToolSandbox | A | stateful tool use with a user simulator | forum×perceive, housing×plan |
| P43 | AndroidWorld | A | screen-level tool use graded by reward; needs an emulator but no weights or privileged stack | registry×act, housing×plan |
| P44 | OSWorld and OSWorld 2.0 | A | computer-use tasks graded by scripts; needs a virtual machine, not weights | research-commons×act |
| P45 | AgentDojo | A | prompt-injection attacks and defences at the tool layer; the defence is a procedure | forum×perceive, courts×perceive |
| P46 | Generative Agents | A | memory stream, reflection and planning as prompts and retrieval | forum×remember, housing×reflect, leisure-events×remember |
| P47 | Character-LLM | C | trains a character into model weights (fine-tuning) | - |
| P48 | RoleLLM | C | its core method is role-conditioned instruction tuning of a model; the benchmark and prompting parts are A | - |
| P49 | Persona Hub | A | personas as prompts and data; its non-commercial licence limits reuse | housing×perceive, market×perceive |
| P50 | Persona drift (split-softmax) | B | the fix re-weights attention inside the model, an inference-stack change; the drift probe is A | (A part: clinic×perceive, clinic×reflect) |
| P51 | Concordia | A | a game-master simulator an agent can use to rehearse | forum×plan, housing×transact, leisure-events×transact |
| P52 | Magentic Marketplace | A | a market simulation for testing rules and agents | market×plan, shops×act |
| P53 | Sotopia | A | social scenarios with goals, scored by code and model | forum×plan, market×transact |
| P54 | OMNI | A | a foundation model picks the next interesting task; its Crafter RL agent part is C, the curriculum is A | academy×plan, academy×learn, leisure-events×plan |
| P55 | Voyager | A | a curriculum and a verified skill library are procedures over an API | academy×learn, housing×learn, research-commons×learn |
| P56 | RepuNet | A | reputation and gossip are social rules, run with prompts | registry×remember, bank-insurer×remember, forum×transact |
| P57 | Teacher explanations for weaker agents | A | explanations within a budget; the main finding is at prompt level | forum×teach, academy×teach |

## Mechanisms in mechanisms.json

| Mechanism | Paper | Class | Reason |
|---|---|---|---|
| ace-append-lessons | P3 | A | same as P3: memory policy at agent level |
| scheduled-forgetting | P34 | A | same as P34: a reset rule at agent level |
| swat-latent-channel | P22 | B | same as P22: needs open-weight models and white-box KV-cache access (already marked deferred, DK9) |

## Runtime track (class B)

- **P12** Circuit for in-context learning: interpretability needs white-box access to a model's heads, a runtime the sponsor controls; no weights change
- **P22** Swarm Telepathy (KV-cache transfer): needs the sponsor's open-weight inference stack and white-box KV-cache access; a small translator is trained but the claim is a runtime channel
- **P50** Persona drift (split-softmax): the fix re-weights attention inside the model, an inference-stack change; the drift probe is A

## Post-training track (class C), set aside

- **P2** Adversarial speculative reasoning: trains a small draft model, so weights change (and the speculative-decoding engine is the sponsor's)
- **P6** RLiD decision-plane RL: reinforcement learning on model weights
- **P8** Terminal-RSI: alternates training on rewritten trajectories with policy refinement: weight updates
- **P11** Anthropic misalignment thread: its core remedy is fine-tuning on stories and dilemma advice; the analogues (a written reason per act, external audit) are A but are not the thread's claim
- **P13** Motivated Emotional Mind: a different architecture with receptor-grounded representations; not an agent-level change
- **P21** HybridAgent: trains a latent link and post-trains (SFT, RL) the backbone
- **P32** Weight-Space Programming: edits another model's weights
- **P47** Character-LLM: trains a character into model weights (fine-tuning)
- **P48** RoleLLM: its core method is role-conditioned instruction tuning of a model; the benchmark and prompting parts are A

These two lists are not courses. They connect to the vision's post-training angle (data export, environments as a service, model passports, training lineage); provider terms on training with model outputs must be checked first (docs/society-vision.md).

## Notes on borderline calls

- P11 is class C because the thread's remedy is fine-tuning; its A analogues (a written reason per act, external audit) are already in lens L14.
- P38 is class A for the universe generator; using its output to fine-tune is a separate class C step.
- P54 OMNI and P57 Saha et al. contain training parts (a Crafter RL agent; a fine-tuned teacher); their curriculum and explanation procedures are classed A. These are judgements, marked as proposals, and the signature in [signature.md](signature.md) scores them.
- P15, P16 and P37 are analyses or perspectives; they are class A as readings with modelling exercises, with no mechanism to adopt.
- P43 and P44 need an emulator or a virtual machine; that is compute, not a privileged runtime, so they stay A.
