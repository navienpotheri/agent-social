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

## Lenses served by each institution

| Institution | Lenses served |
|---|---|
| registry | L5-inferring-values, L6-sybil |
| courts | L2-reflection-experience, L4-cooperative-ai, L6-sybil |
| treasury | L3-world-models, L6-sybil, L7-belief-recalibration |
| market | L1-generative-agents, L3-world-models, L4-cooperative-ai |
| bank-insurer | L3-world-models, L4-cooperative-ai |
| shops | L3-world-models, L5-inferring-values, L7-belief-recalibration |
| academy | L2-reflection-experience, L7-belief-recalibration |
| clinic | L2-reflection-experience, L7-belief-recalibration |
| research-commons | L2-reflection-experience, L4-cooperative-ai, L6-sybil |
| forum | L1-generative-agents |
| leisure-events | L1-generative-agents, L3-world-models, L4-cooperative-ai, L5-inferring-values, L6-sybil |
| housing | L1-generative-agents, L5-inferring-values |
