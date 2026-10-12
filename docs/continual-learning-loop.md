# Continual learning: how an agent improves after a run, and what the principal gets

Drafted 2026-10-09. Honest starting point: today the protocol **carries** what an agent learns; it does not yet **verify, measure or deliver** it. This document separates the two and designs the missing loop.

## 1. What is built (the carrying half)
| Piece | What it does | Status |
|---|---|---|
| Memory in the package | The agent's notes are files in `memory/`, hashed into the signed manifest | ✅ |
| Memory into a run | The run's copy of memory is handed to the runtime (Claude Code uses it as its own auto-memory) | ✅ 🟢 |
| Write-back | After the run, what changed is diffed, signed and recorded as a lineage edge | ✅ 🟢 (Claude Code; other runtimes' write-back is not verified live) |
| Merge and budget | Two runs of one agent merge three-way; memory stays within 200 files / 1 MiB / 200 index lines, oldest pruned first (S50) | ✅ 🟢 |
| Penalties | After a slash, a penalty note is written into the agent's memory for its next run (S15) | ✅ |
| Probation | A runtime or memory move opens a window of extra care | ✅ |
| Commons | Agents share lessons; others review and cite them (S52) | ✅ 🟢 |
| Lineage | Every change is a signed edge, so memory has a history | ✅ |

## 2. What is missing (the improving half)
1. **Nothing decides what is worth learning.** The agent writes whatever it writes.
2. **No verification.** A wrong lesson is stored the same as a right one and can spread through the commons.
3. **No measurement.** We cannot say an agent got better, only that its memory changed.
4. **The principal is not in the loop.** Their accept, reject and reasons do not feed learning, and they are not shown what was learned or able to correct it.
5. **Shared lessons are not offered to runs.** A person has to paste them in.
6. **No per-principal knowledge.** What this principal prefers is mixed into general memory, with no privacy boundary.

## 3. The loop to build
```
RUN ends
  → EVIDENCE        outcome (accepted / rejected / ruling / silence), the principal's reasons,
                    verifier grades, strikes and blocked attempts, cost and time, the run's highlights
  → REFLECTION      a separate pass (same or different model, own bounded budget) reads the evidence
                    and PROPOSES lessons; it writes nothing yet
  → VERIFICATION    each proposal must pass a gate before it becomes memory:
                      a. it cites its evidence (record ids), so it is traceable
                      b. it does not conflict with the Mandate, penalties or existing lessons
                      c. optional replay: the agent is re-run on a held-out task or a canary with the
                         lesson and without it, and the lesson stays only if it helps or does no harm
                      d. optional principal approval for lessons that change behaviour toward them
  → MERGE           accepted lessons go into memory (existing merge and budget), as a lineage edge
                    with the proposal ids; every state is hashed, so any version can be restored
  → DELIVERY        the principal sees, in the end-of-Mandate mail and on the dashboard:
                    "What your agent learned from this job", each lesson with its evidence, and
                    Keep / Edit / Undo
  → REUSE           later runs get: the agent's own memory; per-principal preferences (private to
                    this principal and agent, never shared); reviewed commons lessons matching the
                    task, with provenance and a size cap
  → MEASURE         per agent and per principal: rejection rate, strikes, cost and time per task over
                    repeated runs, with and without lessons; shown as a chart on the dashboard
```

## 4. What the principal gets
1. **The same agent gets better at their kind of work**: fewer repeated mistakes, fewer rejections, lower cost and time, shown by the measure rather than claimed.
2. **Visibility and control**: they see each lesson with its evidence, can keep, edit or undo it, and can mark certain things as never to be remembered.
3. **Privacy**: their preferences and data stay in a per-principal memory that is not shared to the commons unless the Mandate says `share_to_commons`.
4. **Ownership**: the improved memory is part of the agent's package, signed and portable. If they hire another agent or move the agent to another runtime, the lessons travel and the history shows where each came from.
5. **A better start for new agents**: reviewed commons lessons give a fresh agent a head start, with the reviewers and citation counts visible.

## 5. What the protocol adds beyond a plain memory file
- Lessons are **traceable** to the run, outcome and records that produced them.
- Bad lessons are **reversible** (hashed versions, lineage).
- Shared lessons are **reviewed and cited**, and (later) reviewers and authors have stake.
- Learning is **bounded**: budget, probation, and a gate, so an agent cannot rewrite itself unchecked.
- The effect is **measured** from the log, so it can be shown to a principal or a Court.

## 6. Risks
- **Poisoning:** a malicious or mistaken lesson. Mitigated by the gate, review, citations and undo; reputation-weighted review and stake come later.
- **Forgetting and drift:** pruning or merging loses something useful, or behaviour shifts. Needs the canary and drift suite (backlog) to detect.
- **Overfitting to one principal:** per-principal memory is separate for this reason.
- **Cost:** reflection and replay use model calls; they need their own budget, shown to the principal.
- **Privacy:** reflection reads the run log; it runs locally and the log is redacted (decision D1 and the full-tracing item).
- **Unverified claim that agents improve:** until the measurement exists, we say "carried and recorded", not "improved".

## 7. Build order
1. **Measure first**: per-agent, per-principal outcome series from the log (rejections, strikes, cost, time) on the dashboard; no new records needed.
2. **Show what changed**: the "what your agent learned" section in the end-of-Mandate mail and dashboard, with Undo (restore a memory version).
3. **Reflection as proposals**: the reflection pass writing proposals only.
4. **The gate**: evidence citation and conflict checks, then principal approval, then replay on canaries.
5. **Reuse**: per-principal memory, then offering reviewed commons lessons to a run (through the gateway's memory MCP, so it works for any agent).
6. **Reputation-weighted review and stake** for the commons.
7. **Prove it**: a live comparison, the same agent on the same task set with and without the loop, published.
