# ASP v0.2: what the spec needs from the build

16 items: 5 need a decision, 11 should be written into the spec as built. Numbers in brackets are the items' numbers in the earlier 40-item list.

The rest of what the build had to settle is in [implementation-notes.md](implementation-notes.md), with no decision needed. Unbuilt work is in [backlog.md](backlog.md), and single-player mocks are in [../MOCKS.md](../MOCKS.md).

## Needs a decision

| # | Topic | What the code does now | Decision needed |
|---|---|---|---|
| D1 | Learning data [32] | Packages carry a metadata-only index of past sessions: counts, models, timestamps, no content. | Which of a principal's data (transcripts, diffs, test output) may leave the machine for learning, and for the commons? |
| D2 | Probation after a runtime move [35] | A move is recorded with `probation_until` = 7 days. Nothing enforces it, and no canary suite exists yet. | How long probation lasts, what it restricts, and who writes the canary suite (the spec's open question). |
| D3 | Identity bootstrap [20] | A person's first passport may be self-issued, so nothing proves they control the did:web domain (MOCKS #8). | Require the did:web document, or a sponsor's attestation, before accepting a first passport? |
| D4 | Job diagram [13–16] | Acceptance takes two records (an acceptance Attestation, then a Settlement). Redelivery is `Disputed → Delivered`, once. Revocation is allowed before delivery, not only while Running. | Adopt these three edges into the spec's diagram? |
| D5 | Log anchoring [21] | A running hash over record ids makes the log order tamper-evident. Nothing signs or publishes it. | Who signs log checkpoints, and where they are anchored. |

## Write into the spec as built

| # | Spec section | Addition |
|---|---|---|
| S1 | Core objects: envelope [1, 2, 4] | Add `issued_at` and optional `cosigs`. `sig` is `{alg, kid, value}`. `id` = sha256 of the RFC 8785 canonical form of every field except id and signatures. Type strings look like `asp.mandate/v0.2`. |
| S2 | Core objects: numbers [3] | Signed records carry integers only; fractions are in permille. |
| S3 | Registry: identity [6] | v0.1 uses did:web; did:asp comes later without a breaking change. |
| S4 | Core objects: record types [8, 9] | Passport, lineage edge, agent package, fleet and node become signed record types (16 in all). Rebirth has none, by definition. |
| S5 | Bank: escrow [10] | The escrow lock travels inside the Bond record, since each transition emits one object. |
| S6 | Coordination: Contract [11] | The principal issues it, the performer co-signs it, and it is the first record of the job's chain. Intent/Offer (or Call/Proposal) are referenced, not chained. |
| S7 | Mandate [12] | Enumerate `self_modification`, `checkpoints` and `irreversible.policy`, and a dotted scope grammar such as `repo.read` and `pr.open`. |
| S8 | Registry: fleets [23] | A Fleet record is issued by its org. An agent joins by naming the fleet on its passport; it must share the fleet's sponsor, and the fleet must have room. |
| S9 | Registry: nodes [5, 24, 25] | A Node record delegates a short-lived key: it signs only as that node, never identity records, and expires. Under a Mandate, live nodes count against `max_parallel`. The person stays liable. |
| S10 | Transport: agent package [28, 29, 31] | Package layout, a manifest signed by the agent, and secrets as named placeholders that are never stored. |
| S11 | Learning: gates [35] | Memory changes and runtime moves are recorded as lineage `update` edges (layers `memory` and `backend`), written back after each successful run. |
