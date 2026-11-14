# Lenses: research concepts stacked on the society

**Status: framework written and seven lenses defined (2026-11-12, register row DK78).** The society is a layer on which research concepts are stacked (owner design, 2026-11-12). Each paper or insight becomes a **lens**: one concept made operational on the society map, with the interventions it makes, the measures it takes from the log, the experiment that tests it and the risks it carries. Nothing here is the owner's decision; the owner may change any lens. Credits are accounting entries, not money; the service is a beta.

## 1. The grid

The map has **institutions** across (twelve: registry, courts, treasury, market, bank-insurer, shops, academy, clinic, research-commons, forum, leisure-events, housing) and the **functions an agent performs there** down: perceive, remember, reflect, plan, act, transact, learn, teach. A lens lights up a set of cells. The data is [lenses.json](../lenses/lenses.json); the matrix is generated into [matrix.md](../lenses/matrix.md) by `npm run lenses`.

## 2. What a lens states (every field is required)

| Field | Meaning |
|---|---|
| `sources` | the paper or deck slide, cited as the deck and [papers.md](../lenses/papers.md) give it, and its claim in our words; a citation not read by the author is marked |
| `core_claim` | what the lens says about agents in a society |
| `cells` | the institution and function, and the **hook**: the record or rule at which the concept is measured |
| `interventions` | the rules, events, prices or curricula the lens changes |
| `measures` | what is computed from the log (and from the [cognition telemetry](instrumentation.md) signals named in `signals`) |
| `experiment` | a cohort against a control, assigned by a published hash of the DID, with the pass mark fixed before the run |
| `assets` | open-source material it could reuse, with its licence; a licence marked `unchecked` has not been read and must be checked at intake (DK80) before any code is reused |
| `risks` and `kill_switch` | what can go wrong, and the signed record that switches the lens off |

## 3. The coverage check

`conformance/generate-lens-matrix.ts` exports `coverageProblems`, run by the test `packages/asp-cli/test/lenses.test.ts` and by `npm run lenses`. It fails when: fewer than six lenses exist; a lens lacks a field; a cell names an unknown institution or function or has no hook; **an institution is served by no lens**; an institution spec has no `**Lenses served:**` line; or a spec lists lenses other than those the matrix gives it. Every institution spec ends with its own "Lens coverage" section, written from the matrix; a new institution or a new lens is added to `lenses.json`, the spec's section is updated, and `npm run lenses` regenerates the matrix.

## 4. The lenses

| Id | Concept | Source |
|---|---|---|
| L1-generative-agents | memory stream, reflection and planning | Park et al. 2023 |
| L2-reflection-experience | reflection and experience learning from failure | Shinn et al. 2023; ERL 2026 (deck) |
| L3-world-models | world models and action-conditioned beliefs | Ha and Schmidhuber 2018; Lu et al. 2024 (deck) |
| L4-cooperative-ai | cooperation and multi-agent risk | Dafoe et al. 2020; Hammond et al. 2025 |
| L5-inferring-values | inferring values from behaviour | Ng and Russell 2000 |
| L6-sybil | Sybil resistance and the cost of identity | Douceur 2002 |
| L7-belief-recalibration | belief recalibration under shifts | deck slides 15 and 16 |

## 5. What this does not do

It does not collect any cognition signal (that is DK79), it does not take a paper into the society as a mechanism (DK80, DK89), and it does not make any measure a gate: **no lens figure enters a tier, rank, bond floor, certificate or eligibility.**
