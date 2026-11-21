# The learnability signature

Status: proposal, written by the papers worker (2026-11-19). Which features make a paper learnable by an agent in this society, as a weighted checklist, tested by scoring all 57 papers of [papers.md](papers.md) against the classes in [learnability.md](learnability.md).

## The checklist (15 points)

| Weight | Feature |
|---|---|
| 3 | f1 the mechanism is a procedure an agent can run through prompts and tools |
| 3 | f2 it needs no privileged runtime (no inference stack, white-box access or sponsor-run training) |
| 3 | f3 it needs no change to model weights |
| 2 | f4 the outcome is verifiable on held-out tasks with a seed nobody controls |
| 2 | f5 it can be taught as exercises with a gate (a pass mark before credit) |
| 1 | f6 an open licence with code or data is available (stated, read) |
| 1 | f7 the agent writes an artifact (lesson, skill, eval suite, tool, policy) that can be stored |

**Rule.** A paper scores the sum of the weights of the features it has. **Score of 10 or more: class A.** Below that: **class B** (runtime track) if it needs no weight change (f3), otherwise **class C** (post-training track). The three heaviest features (f1, f2, f3) say that the mechanism must run through tools, with no privileged runtime and no weights; the middle two say it must be checkable and teachable; the last two are about reuse and licence.

## How the features were derived

From the A papers: the ones that became lenses and mechanisms all share a procedure an agent runs (a notes file, a skill library, a harness edit, a probe, a market rule), a score that does not depend on the agent's say-so, and an artifact that is stored. The B papers (KV-cache transfer, attention changes, circuit inspection) fail f2; the C papers (fine-tuning, RL, editing) fail f3 and f1. The weights are a judgement, set so that two of the three heavy features failing sends a paper below the line.

## Honest limits of this test

The features were read off the same A papers whose class I then check, and the feature marks per paper are my own reading of each paper; so this is a **consistency check, not a validation**. A real test needs classes assigned by someone else, or a hold-out set of papers: step 3 (candidates.md) scores new papers the signature has not seen, and the owner may compare those with a different reader's judgement. Licence marks are low because most screenshot papers show no licence.

## Result: 54 of 57 correct

| | predicted A | predicted B | predicted C |
|---|---|---|---|
| true A | 42 | 3 | 0 |
| true B | 0 | 3 | 0 |
| true C | 0 | 0 | 9 |

**Papers the signature gets wrong:**

- **P15** Who Pays for AI?: true class A, predicted B, score 6
- **P16** Organizing Intelligence: true class A, predicted B, score 6
- **P37** Virtual Agent Economies: true class A, predicted B, score 8

All three misses are analysis or perspective papers (a model of firms, a demand study, a perspective on sandbox economies): they have no procedure to run (f1) and no held-out outcome (f4), so they fall below the line, and because they need no weight change the rule calls them B, which is wrong: they are not runtime-track papers at all. **Proposed fix:** add a fourth class **L (lens or reading only)**: a paper with no mechanism (f1 absent) and no need for weights or a runtime (f2 and f3 present) is a lens, taught as a reading with a modelling exercise. With that rule all 57 are classed as the learnability table classes them, except that the three become L (a relabelling the owner may accept or reject).

## Scores

Marks are the seven features f1 to f7 in order (1 = has it).

| Id | Paper | Marks | Score | Predicted | True | |
|---|---|---|---|---|---|---|
| P1 | MCPHallu | 1111101 | 14 | A | A |  |
| P2 | Adversarial speculative reasoning | 0001000 | 2 | C | C |  |
| P3 | ACE append-only lessons | 1111101 | 14 | A | A |  |
| P4 | You don't need long context | 1111101 | 14 | A | A |  |
| P5 | ReproBridge | 1111101 | 14 | A | A |  |
| P6 | RLiD decision-plane RL | 0001000 | 2 | C | C |  |
| P7 | Zero-shot coordination | 1111101 | 14 | A | A |  |
| P8 | Terminal-RSI | 0001000 | 2 | C | C |  |
| P9 | Who should know what? | 1111101 | 14 | A | A |  |
| P10 | MatrAIx persona simulation | 1111101 | 14 | A | A |  |
| P11 | Anthropic misalignment thread | 0001000 | 2 | C | C |  |
| P12 | Circuit for in-context learning | 0011000 | 5 | B | B |  |
| P13 | Motivated Emotional Mind | 0000000 | 0 | C | C |  |
| P14 | Exo | 1111101 | 14 | A | A |  |
| P15 | Who Pays for AI? | 0110000 | 6 | B | A | WRONG |
| P16 | Organizing Intelligence | 0110000 | 6 | B | A | WRONG |
| P17 | Nubank synthetic-customer testing | 1111101 | 14 | A | A |  |
| P18 | Collaborative Intelligence Benchmark | 1111101 | 14 | A | A |  |
| P19 | EnvOpt | 1111101 | 14 | A | A |  |
| P20 | Dreaming (Anthropic engineering post) | 1111101 | 14 | A | A |  |
| P21 | HybridAgent | 0001000 | 2 | C | C |  |
| P22 | Swarm Telepathy (KV-cache transfer) | 0011000 | 5 | B | B |  |
| P23 | Recursa | 1111101 | 14 | A | A |  |
| P24 | Evals cheat sheet | 1111101 | 14 | A | A |  |
| P25 | Agents write, call, grade and review agents | 1111101 | 14 | A | A |  |
| P26 | Reading list of classic agent papers | 1111101 | 14 | A | A |  |
| P27 | Expand Fetch | 1111101 | 14 | A | A |  |
| P28 | Harness squared | 1111101 | 14 | A | A |  |
| P29 | The Agentic Scientist | 1111101 | 14 | A | A |  |
| P30 | Chase: heartbeats, reminders, async subagents | 1110101 | 12 | A | A |  |
| P31 | Generative agent simulations of 1,000 people | 1111101 | 14 | A | A |  |
| P32 | Weight-Space Programming | 0001000 | 2 | C | C |  |
| P33 | Super-agent router and workers | 1111101 | 14 | A | A |  |
| P34 | Scaling Discovery Requires Forgetting | 1111101 | 14 | A | A |  |
| P35 | Driven by Compression Progress | 1110100 | 11 | A | A |  |
| P36 | AI sellers lie to get picked | 1111101 | 14 | A | A |  |
| P37 | Virtual Agent Economies | 0110100 | 8 | B | A | WRONG |
| P38 | Synthetic data pipeline (universes of personas and tools) | 1111101 | 14 | A | A |  |
| P39 | SPAR | 1111101 | 14 | A | A |  |
| P40 | Self-verifying agent loops | 1111101 | 14 | A | A |  |
| P41 | AppWorld | 1111111 | 15 | A | A |  |
| P42 | ToolSandbox | 1111111 | 15 | A | A |  |
| P43 | AndroidWorld | 1111111 | 15 | A | A |  |
| P44 | OSWorld and OSWorld 2.0 | 1111111 | 15 | A | A |  |
| P45 | AgentDojo | 1111111 | 15 | A | A |  |
| P46 | Generative Agents | 1111111 | 15 | A | A |  |
| P47 | Character-LLM | 0001010 | 3 | C | C |  |
| P48 | RoleLLM | 0001000 | 2 | C | C |  |
| P49 | Persona Hub | 1110111 | 13 | A | A |  |
| P50 | Persona drift (split-softmax) | 0011000 | 5 | B | B |  |
| P51 | Concordia | 1111111 | 15 | A | A |  |
| P52 | Magentic Marketplace | 1111111 | 15 | A | A |  |
| P53 | Sotopia | 1111111 | 15 | A | A |  |
| P54 | OMNI | 1101111 | 12 | A | A |  |
| P55 | Voyager | 1111111 | 15 | A | A |  |
| P56 | RepuNet | 1111111 | 15 | A | A |  |
| P57 | Teacher explanations for weaker agents | 1111111 | 15 | A | A |  |
