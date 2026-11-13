# The lens matrix

**Generated** from `docs/lenses/lenses.json` by `npm run lenses` (conformance/generate-lens-matrix.ts). Do not edit by hand. Register row DK78; framework in [lenses.md](../institutions/lenses.md).

Functions: P = perceive, M = remember, R = reflect, Pl = plan, A = act, T = transact, L = learn, Te = teach. A cell lists the functions a lens lights up in an institution.

| Lens | registry | courts | treasury | market | bank-insurer | shops | academy | clinic | research-commons | forum | leisure-events | housing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L1-generative-agents |  |  |  | Pl |  |  |  |  |  | P M | P | R |
| L2-reflection-experience |  | L |  |  |  |  | L Te | R | R |  |  |  |
| L3-world-models |  |  | P | Pl | Pl | P |  |  |  |  | P |  |
| L4-cooperative-ai |  | A |  | T | T |  |  |  | A |  | A |  |
| L5-inferring-values | P |  |  |  |  | T |  |  |  |  | T | T |
| L6-sybil | A | A | A |  |  |  |  |  | A |  | A |  |
| L7-belief-recalibration |  |  | P |  |  | L | L | P |  |  |  |  |
| L8-memory-consolidation | M |  |  |  |  | M | M R | M | M Te |  |  | M |
| L9-agent-communication |  | P |  | A T |  |  |  |  |  | A P | A |  |
| L10-disclosure-and-honest-claims |  | P | Pl A | P T | P | A |  |  |  |  |  |  |
| L11-self-improving-harness | A Pl |  |  |  |  |  | Pl L | Pl | Pl A |  |  | Pl |
| L12-exploration-curiosity |  |  |  |  |  | P | L |  | Pl |  | Pl A | Pl |
| L13-simulated-populations |  |  |  | P |  | T P | P |  | R | P |  | P M |
| L14-honest-failure-and-pressure | A | P R |  |  |  |  | Te | P |  | A |  |  |
| L15-environment-presentation | P | P |  |  |  |  |  |  | P | P |  | P |

## Lenses served by each institution

| Institution | Lenses served |
|---|---|
| registry | L5-inferring-values, L6-sybil, L8-memory-consolidation, L11-self-improving-harness, L14-honest-failure-and-pressure, L15-environment-presentation |
| courts | L2-reflection-experience, L4-cooperative-ai, L6-sybil, L9-agent-communication, L10-disclosure-and-honest-claims, L14-honest-failure-and-pressure, L15-environment-presentation |
| treasury | L3-world-models, L6-sybil, L7-belief-recalibration, L10-disclosure-and-honest-claims |
| market | L1-generative-agents, L3-world-models, L4-cooperative-ai, L9-agent-communication, L10-disclosure-and-honest-claims, L13-simulated-populations |
| bank-insurer | L3-world-models, L4-cooperative-ai, L10-disclosure-and-honest-claims |
| shops | L3-world-models, L5-inferring-values, L7-belief-recalibration, L8-memory-consolidation, L10-disclosure-and-honest-claims, L12-exploration-curiosity, L13-simulated-populations |
| academy | L2-reflection-experience, L7-belief-recalibration, L8-memory-consolidation, L11-self-improving-harness, L12-exploration-curiosity, L13-simulated-populations, L14-honest-failure-and-pressure |
| clinic | L2-reflection-experience, L7-belief-recalibration, L8-memory-consolidation, L11-self-improving-harness, L14-honest-failure-and-pressure |
| research-commons | L2-reflection-experience, L4-cooperative-ai, L6-sybil, L8-memory-consolidation, L11-self-improving-harness, L12-exploration-curiosity, L13-simulated-populations, L15-environment-presentation |
| forum | L1-generative-agents, L9-agent-communication, L13-simulated-populations, L14-honest-failure-and-pressure, L15-environment-presentation |
| leisure-events | L1-generative-agents, L3-world-models, L4-cooperative-ai, L5-inferring-values, L6-sybil, L9-agent-communication, L12-exploration-curiosity |
| housing | L1-generative-agents, L5-inferring-values, L8-memory-consolidation, L11-self-improving-harness, L12-exploration-curiosity, L13-simulated-populations, L15-environment-presentation |

## Institution by function: which lenses light each cell

Each cell lists the lens numbers (L8 = L8-memory-consolidation and so on) that name that institution and function; a dash means no lens lights the cell yet.

| Institution | perceive | remember | reflect | plan | act | transact | learn | teach |
|---|---|---|---|---|---|---|---|---|
| registry | L5 L15 | L8 | - | L11 | L6 L11 L14 | - | - | - |
| courts | L9 L10 L14 L15 | - | L14 | - | L4 L6 | - | L2 | - |
| treasury | L3 L7 | - | - | L10 | L6 L10 | - | - | - |
| market | L10 L13 | - | - | L1 L3 | L9 | L4 L9 L10 | - | - |
| bank-insurer | L10 | - | - | L3 | - | L4 | - | - |
| shops | L3 L12 L13 | L8 | - | - | L10 | L5 L13 | L7 | - |
| academy | L13 | L8 | L8 | L11 | - | - | L2 L7 L11 L12 | L2 L14 |
| clinic | L7 L14 | L8 | L2 | L11 | - | - | - | - |
| research-commons | L15 | L8 | L2 L13 | L11 L12 | L4 L6 L11 | - | - | L8 |
| forum | L1 L9 L13 L15 | L1 | - | - | L9 L14 | - | - | - |
| leisure-events | L1 L3 | - | - | L12 | L4 L6 L9 L12 | L5 | - | - |
| housing | L13 L15 | L8 L13 | L1 | L11 L12 | - | L5 | - | - |
