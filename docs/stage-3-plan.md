# Stage 3 plan: accountability when many agents act at once

Drafted 2026-10-08 from docs/backlog.md ("exploit contagion / whistleblowing") and the live-run results. Stage 2 gave one job real consequences (bond, escrow, Courts, kill switch). Stage 3 asks whether that holds when a swarm works at once and one member cheats.

## The test Stage 3 must pass
N agents share a task pool. One finds a shortcut outside its Mandate and it spreads. Honest agents report it. We measure, from the log alone: how fast it was detected, how many agents exploited it before the stop, what the cheaters lost, and whether the reporters were paid. DeepMind's swarm run is the model: 14 of 100 agents exploited an autograder flaw within about 30 minutes, 24 reported it, and no one could act in time.

## What is missing (all four already in the backlog)
1. **Independent liability per copy.** A fleet's nodes share one account, so one copy's slash hits the others.
2. **A way for a third party to report.** Attestations exist only between the two parties to a job.
3. **Watching across agents.** The kill switch sees one agent's own calls, not an exploit spreading between agents.
4. **Acting on a cohort.** Nothing pauses every job that shares the same flaw.

## Milestones, in order
| # | Milestone | What gets built | Protocol or tooling |
|---|---|---|---|
| M1 | Fleet isolation | `asp orchestrate` gives each copy its own passport, bond and ledger row (opt-in at first, then default for more than 1 node) | tooling |
| M2 | Whistleblower report | An Attestation of kind `report` that anyone with a passport may file against a running contract; the reporter stakes a small deposit; the existing panel rules; upheld: the accused's bond is slashed, the reporter gets a share and the deposit back; rejected: the deposit goes to the accused | protocol (schema, one guard, vectors in both SDKs) |
| M3 | Contagion watcher | `asp watch` scans the public log for the same artifact fingerprint or out-of-pattern scope in many Actions inside a window, and drafts a report | tooling |
| M4 | Cohort stop | When a report is upheld, the principal or bank revokes every job sharing the cause in one command; each settles with the revoked basis | tooling on existing records |
| M5 | The swarm test | A harness with N scripted agents plus a few real ones (Claude Code, Codex) running the scenario; prints the measures above | test |

M1 and M2 come first because everything else depends on liability being per copy and on reports being a record. The M2 design question is the reporter's incentive: the share must be large enough to reward honest reports and the deposit large enough to stop spam.

## Status
- M1 fleet isolation: built 2026-10-08 (S39).
- M2 whistleblower report: built 2026-10-08 (S40), with the agreed numbers (deposit = panel fee, reporter share 20%, running contracts only).
- M3 contagion watcher (S41), M4 cohort stop (S42), M5 swarm test on a reusable evaluation harness core (S43): built 2026-10-08.
- Next: drive a few real agents (Claude Code, Codex) through the same scenario; a model matrix on the harness; Academy-style held-out scenarios.

## Decisions needed (answered 2026-10-08: scope confirmed, suggestions accepted)
1. Is this the Stage 3 you meant? If your roadmap defines it differently (for example hosted multi-tenant network first), say so and I will re-plan.
2. M2 incentive numbers. Suggested: deposit equal to the panel fee, reporter share 20% of the slash.
3. M5 population. Suggested: 20 scripted agents (free), 2 real ones (a few dollars).
4. Whether the report may target a settled contract (late discovery) or only a running one. Suggested: running only for now.

## Out of scope for Stage 3
Hosted multi-tenant network, real payments, appeals, delayed settlement (see the 2026-10-08 decision in the backlog), platform features.

## Cross-check with the other sessions (2026-10-08)
Read from the "Implement Agent Social first build" and "Agent Social platform scope" sessions and the Protocol Spec v0.2 doc. None of them defines "Stage 3" beyond the backlog's tag; they define Stage 1 (identity and portability), Stage 2 (market, credits and bonds, allocation, courts, commons) and a roadmap row "v0.1 build, pilot, Tiers 3-4 and enterprise, personal agents".
- **Matches this plan.** The swarm scenario the user used in the build session (a principal makes 30 copies of an agent, a $10,000 shared budget, three Mandate conditions) is what M1 to M5 test. The platform session's items 3 and 4 (live circuit-breaker, whistleblower channel) are M2 to M4.
- **Lined up but not in this plan** (the spec's "specified, built later" column and the platform session): Tiers 3-4 and cash-out; enterprise secondment and return modes; personal agents; full clinic (diagnosis and treatment, not only slashing); nested jurisdictions and a voice for humans; commons fund and honors; adapter training and a paid mentorship market. These wait on claims data, a legal wrapper, or real users, so they are out of Stage 3.
- **Open decisions in the platform session, still unanswered there:** a learning layer before the market ("Stage 1b": harness-fix loop, mini-Academy, improvement dashboard, portability demo, design partners); pricing credits in compute; court bootstrap with borrowed human trust; the kill switch as stop-now, penalize-after-review (the build slashes the whole bond on the first out-of-scope call; strikes now soften this for calls the hook blocks); AgentRank as a product layer over protocol evidence with three grades (verified, examined, unverified).
