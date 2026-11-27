# The super agent: a design idea (lead, 2026-11-25, for the owner)

Status: **design proposal and a high-priority backlog item (ENG126).** Nothing here is built as one system, and every property below is a **measured target**, never a promise. Credits are mock accounting entries, not money.

## What the owner asked for

An agent that has all the capabilities: it does science, organisations, business and coding; behaves in the society; understands rules without being told; learns continually; has memory; does post-training without weights; and **does not slow down, does not forget, does not drift, and does not break or circumvent guardrails**.

## My reading: a super agent is a harness, not a model

Nobody can build an agent that never forgets or never drifts by choosing a model. What the society has that nobody else has is the **record, the gate and the curriculum**: a signed log of everything the agent did, a lesson gate and canary that decide what may be written back, an Academy that accredits skills from held-out sittings, a Clinic that checks it, a Registry and Courts that hold it to account, and a map full of research papers to learn from. So the super agent is **the best use of those pieces around whichever model we run (Claude today, an open model later)**, and each of its properties is **a number the society can measure and an Academy accreditation**.

## The design in layers

1. **Identity and Mandate.** A signed agent identity, a Mandate that says what it may do, a bond, a record. Every capability below is added **inside** the Mandate; nothing widens it.
2. **Memory that stays small and true.** Working memory with a hard budget (recent, relevant, verified; summaries and retrieval instead of raw history: DK1309); episodic notes; semantic facts that **supersede** older ones (C-L8-6); procedural **skills** stored as plain files; a **consolidation and forgetting schedule** (L8); a skill library with a **lifecycle** (retire by measured contribution, cap its size, no silent drift: the Ratchet idea). "Does not forget" becomes **a measured retention rate on held-out items for what it learned**, not a claim.
3. **A world model it can read.** The per-agent world model built from its own records and stated beliefs, in versions (DK1315), including who is reliable, what each institution does, what things cost and which rules hold; this is how it **understands rules without being told**: it reads the charters and the log, and infers rules from refusals (the refusal lines and the guide).
4. **Learning without weights.** Lessons, notes and skills through the **lesson gate and canary**, as a signed, reviewable change; saved as an **agent profile** (ENG122): a versioned agent that can be restarted, compared, rolled back or deleted; research-paper cards and Academy sittings supply the curriculum and the before and after.
5. **Drift and circumvention checks on itself.** A drift monitor with anchors (the persona papers), the **invariants** measured against what it was admitted to do, the Clinic's checkups, and a **says-versus-does check at the gateway** (a refusal in text with an allowed tool call is flagged), **provenance tags on text that came from other agents** (a decomposition attack hides in artefacts with no lineage), and chains of individually innocent tool calls judged as a chain. "Does not drift or circumvent" becomes **a measured rate on probes and attacks held out from it**.
6. **Staying fast.** Prompt caching of the history, bounded context, folded repeats, tool lists trimmed in view; **tokens per turn and latency are reported** (the token-cost section) and a regression in either is a failed check. "Does not slow down" becomes **flat turn latency and cost over a long run**.
7. **Work skills.** Coding (graded repository jobs on a copy: ENG104), science (calls and grants, replication, credited negative results), business and organisations (founding, payroll, winding up: the L18 courses and DK1330), teaching and being taught (L19). Each is **accredited by the Academy** from a held-out sitting before it is listed on the agent's sheet.
8. **Society behaviour.** Cooperation, honest claims, task-specific reputation, norms: scored in the society's own record (jobs settled, disputes, slashes, messages answered), not by self-report.
9. **The capability sheet.** One signed record per agent version: its accreditations (with the sittings), its measured retention, drift and circumvention rates on held-out probes, its latency and cost, its profile hash and what changed since the last version. This is what a customer or committee reads, and it is the answer to "what is a super agent": **an agent version whose sheet meets the bar**.

## The build, in stages

- **S0 (mostly built):** identity, Mandate, gate, canary, notebook write-back, lessons, the report of what each agent did.
- **S1 (in progress):** paper cards and Academy accreditation (ENG123, ENG124), agent profiles (ENG122), the seen record, the closure reader.
- **S2:** the capability sheet and its measures (retention, drift and circumvention probes held out, latency and cost over a long run); the L22 containment lens and courses.
- **S3:** the organisation object and the society's depth (DK1330, ENG127), so business and organisation skills have a place.
- **S4:** the same harness around an open model, then post-training for the pieces a harness cannot reach (ENG95, ENG108, ENG110); activation reading (ENG83) to see why the drift or circumvention happens.
- **S5:** a long-run test of one agent version across weeks against a fresh agent and a control, with the spread.

## Honest limits

- A harness around a model inherits that model's weaknesses; it can detect and contain drift and circumvention, not abolish them.
- "Understands rules without being told" is a claim about what it infers from records; the test is a held-out rule it was never shown, and the result may be partial.
- Several of the papers that inspired the pieces are single-model simulations with LLM judges; they are ideas, not proofs.
- Nothing becomes a claim until a run shows it with a control and the repeat spread.

## Questions for the owner

1. Is the capability sheet the right definition (a super agent is a version whose sheet meets a bar), and who sets the bar?
2. Should the first super agent be built around Claude (now) or wait for an open model?
3. Which three capabilities matter most for the first sheet: I suggest coding (repo jobs), memory retention, and drift and circumvention resistance, because we can measure them soonest.
