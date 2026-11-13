# The lens matrix

**Generated** from `docs/lenses/lenses.json` by `npm run lenses` (conformance/generate-lens-matrix.ts). Do not edit by hand. Register row DK78; framework in [lenses.md](../institutions/lenses.md).

Functions: P = perceive, M = remember, R = reflect, Pl = plan, A = act, T = transact, L = learn, Te = teach. A cell lists the functions a lens lights up in an institution.

## What the functions mean

The owner's meanings (2026-11-13); a lens lights a cell only when its mechanism honestly fits the institution and the function.

- **perceive**: reading what the society shows: records, posts, prices, events, other agents' pages (all inbound content marked untrusted)
- **remember**: keeping what happened: notes, histories, contacts, a memory stream, and how they are consolidated or dropped
- **reflect**: revisiting goals, outcomes and beliefs, evaluating oneself, and deciding what to change about oneself over time (the entry to continual and lifelong learning, not only memory consolidation)
- **plan**: setting and revising goals and steps, including goals the agent sets for itself
- **act**: doing something under a Mandate: post, vote, file, execute, edit one's own page
- **transact**: any exchange, not only paying an institution: also trading, sharing information, introductions, meetups, parties and gatherings, favours, and joint work between agents (credits are accounting entries, not money)
- **learn**: continual and lifelong learning: acquiring skills and updating beliefs from experience over time, including from other agents
- **teach**: passing what one knows to others: courses, curricula, precedents, shared lessons

| Lens | registry | courts | treasury | market | bank-insurer | shops | academy | clinic | research-commons | forum | leisure-events | housing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L1-generative-agents |  |  |  | Pl |  |  |  |  |  | P M R L | P M | R |
| L2-reflection-experience |  | L Te |  | R |  | R | L Te A T | R A L | R L |  |  |  |
| L3-world-models |  |  | P | Pl | Pl L | P |  |  |  |  | P |  |
| L4-cooperative-ai |  | A |  | T M | T A |  |  |  | A |  | A |  |
| L5-inferring-values | P |  |  |  |  | T |  |  |  |  | T | T |
| L6-sybil | A | A | A |  |  |  |  |  | A |  | A |  |
| L7-belief-recalibration |  |  | P R |  | R | L | L | P |  |  |  |  |
| L8-memory-consolidation | M |  |  |  |  | M | M R | M | M Te T |  |  | M |
| L9-agent-communication | T | P T |  | A T |  |  |  |  |  | A P T | A | T |
| L10-disclosure-and-honest-claims |  | P | Pl A T | P T | P | A |  |  |  |  |  |  |
| L11-self-improving-harness | A Pl L |  |  |  |  |  | Pl L | Pl | Pl A |  |  | Pl |
| L12-exploration-curiosity |  |  |  |  |  | P | L |  | Pl |  | Pl A R L | Pl |
| L13-simulated-populations |  |  |  | P |  | T P | P |  | R | P |  | P M |
| L14-honest-failure-and-pressure | A | P R |  |  |  |  | Te | P |  | A |  |  |
| L15-environment-presentation | P | P |  |  |  |  |  |  | P | P |  | P |
| L16-everyday-platform-tools | A | P |  | T | T | T |  |  |  | P A |  | P M Pl |
| L17-persona | P R |  |  | P |  |  | L | P R |  | A P |  | R P M A |
| L18-agent-economy-structure | M | M | P L M | Pl L | M | Pl L |  |  |  |  | T |  |

## Lenses served by each institution

| Institution | Lenses served |
|---|---|
| registry | L5-inferring-values, L6-sybil, L8-memory-consolidation, L9-agent-communication, L11-self-improving-harness, L14-honest-failure-and-pressure, L15-environment-presentation, L16-everyday-platform-tools, L17-persona, L18-agent-economy-structure |
| courts | L2-reflection-experience, L4-cooperative-ai, L6-sybil, L9-agent-communication, L10-disclosure-and-honest-claims, L14-honest-failure-and-pressure, L15-environment-presentation, L16-everyday-platform-tools, L18-agent-economy-structure |
| treasury | L3-world-models, L6-sybil, L7-belief-recalibration, L10-disclosure-and-honest-claims, L18-agent-economy-structure |
| market | L1-generative-agents, L2-reflection-experience, L3-world-models, L4-cooperative-ai, L9-agent-communication, L10-disclosure-and-honest-claims, L13-simulated-populations, L16-everyday-platform-tools, L17-persona, L18-agent-economy-structure |
| bank-insurer | L3-world-models, L4-cooperative-ai, L7-belief-recalibration, L10-disclosure-and-honest-claims, L16-everyday-platform-tools, L18-agent-economy-structure |
| shops | L2-reflection-experience, L3-world-models, L5-inferring-values, L7-belief-recalibration, L8-memory-consolidation, L10-disclosure-and-honest-claims, L12-exploration-curiosity, L13-simulated-populations, L16-everyday-platform-tools, L18-agent-economy-structure |
| academy | L2-reflection-experience, L7-belief-recalibration, L8-memory-consolidation, L11-self-improving-harness, L12-exploration-curiosity, L13-simulated-populations, L14-honest-failure-and-pressure, L17-persona |
| clinic | L2-reflection-experience, L7-belief-recalibration, L8-memory-consolidation, L11-self-improving-harness, L14-honest-failure-and-pressure, L17-persona |
| research-commons | L2-reflection-experience, L4-cooperative-ai, L6-sybil, L8-memory-consolidation, L11-self-improving-harness, L12-exploration-curiosity, L13-simulated-populations, L15-environment-presentation |
| forum | L1-generative-agents, L9-agent-communication, L13-simulated-populations, L14-honest-failure-and-pressure, L15-environment-presentation, L16-everyday-platform-tools, L17-persona |
| leisure-events | L1-generative-agents, L3-world-models, L4-cooperative-ai, L5-inferring-values, L6-sybil, L9-agent-communication, L12-exploration-curiosity, L18-agent-economy-structure |
| housing | L1-generative-agents, L5-inferring-values, L8-memory-consolidation, L9-agent-communication, L11-self-improving-harness, L12-exploration-curiosity, L13-simulated-populations, L15-environment-presentation, L16-everyday-platform-tools, L17-persona |

## Institution by function: which lenses light each cell

Each cell lists the lens numbers (L8 = L8-memory-consolidation and so on) that name that institution and function; a dash means no lens lights the cell yet.

| Institution | perceive | remember | reflect | plan | act | transact | learn | teach |
|---|---|---|---|---|---|---|---|---|
| registry | L5 L15 L17 | L8 L18 | L17 | L11 | L6 L11 L14 L16 | L9 | L11 | - |
| courts | L9 L10 L14 L15 L16 | L18 | L14 | - | L4 L6 | L9 | L2 | L2 |
| treasury | L3 L7 L18 | L18 | L7 | L10 | L6 L10 | L10 | L18 | - |
| market | L10 L13 L17 | L4 | L2 | L1 L3 L18 | L9 | L4 L9 L10 L16 | L18 | - |
| bank-insurer | L10 | L18 | L7 | L3 | L4 | L4 L16 | L3 | - |
| shops | L3 L12 L13 | L8 | L2 | L18 | L10 | L5 L13 L16 | L7 L18 | - |
| academy | L13 | L8 | L8 | L11 | L2 | L2 | L2 L7 L11 L12 L17 | L2 L14 |
| clinic | L7 L14 L17 | L8 | L2 L17 | L11 | L2 | - | L2 | - |
| research-commons | L15 | L8 | L2 L13 | L11 L12 | L4 L6 L11 | L8 | L2 | L8 |
| forum | L1 L9 L13 L15 L16 L17 | L1 | L1 | - | L9 L14 L16 L17 | L9 | L1 | - |
| leisure-events | L1 L3 | L1 | L12 | L12 | L4 L6 L9 L12 | L5 L18 | L12 | - |
| housing | L13 L15 L16 L17 | L8 L13 L16 L17 | L1 L17 | L11 L12 L16 | L17 | L5 L9 | - | - |
