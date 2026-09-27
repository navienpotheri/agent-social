# ASP v0.2: what the spec needs from the build

11 additions to write into the spec as built, and 5 decisions — now resolved (2026-09-27). Numbers in brackets are the items' numbers in the earlier 40-item list.

The rest of what the build had to settle is in [implementation-notes.md](implementation-notes.md), with no decision needed. Unbuilt work is in [backlog.md](backlog.md), and single-player mocks are in [../MOCKS.md](../MOCKS.md).

## Decided (2026-09-27)

| # | Topic | Decision | What changed |
|---|---|---|---|
| D1 | Learning data [32] | Metadata only, for now. No transcript content, diffs, or test output leaves the machine — only session counts, models, timestamps, tool-call counts. Revisit once the learning layer actually needs richer signals. | No code change; this is what's already built. |
| D2 | Probation after a runtime move [35] | Keep 7 days. Once a self-modification pathway exists, probation should force `self_modification` to `principal_approves` regardless of tier; nothing else is restricted. Who writes the canary suite stays open (Academy, Stage 2). | The registry now tracks each DID's current probation window (`EventLog.probation(did)`), derived from lineage `update` records carrying `probation_until`. Enforcement itself waits on a self-modification pathway, which doesn't exist yet (`docs/backlog.md`). |
| D3 | Identity bootstrap [20] | Keep trust-on-first-use for now. Must change before any hosted, multi-tenant network (already flagged in `docs/backlog.md`). | No code change. |
| D4 | Job diagram [13–16] | Adopt all three edges the build already added — two-step acceptance, one redelivery, revocation before delivery — into the spec's own diagram. They already match the spec's prose; only the diagram was narrower. | Spec-doc change (outside this repo); noted here for the record. |
| D5 | Log anchoring [21] | The log owner's own key periodically signs a checkpoint of the log's head; not published anywhere yet. | New: `asp log checkpoint --as <did>` signs `{seq, log_hash, signed_at}` and appends it to `~/.asp/checkpoints.ndjson`. `asp log verify` re-checks every stored checkpoint by independently replaying the log up to that seq (`EventLog.verifyCheckpoint`), not by trusting the stored value. |

## Write into the spec as built

| # | Spec section | Addition |
|---|---|---|
| S1 | Core objects: envelope [1, 2, 4] | Add `issued_at` and optional `cosigs`. `sig` is `{alg, kid, value}`. `id` = sha256 of the RFC 8785 canonical form of every field except id and signatures. Type strings look like `asp.mandate/v0.2`. |
| S2 | Core objects: numbers [3] | Signed records carry integers only; fractions are in permille. |
| S3 | Registry: identity [6] | v0.1 uses did:web for anyone who brings their own domain, and did:key (self-certifying, no domain) for anyone who doesn't; did:asp comes later without a breaking change. Added 2026-09-27, alongside the D1-D5 decisions, after the strategy review flagged that did:web-only identity ties "take your agent and leave" to whoever hosts the domain. |
| S4 | Core objects: record types [8, 9] | Passport, lineage edge, agent package, fleet and node become signed record types (17 in all, with Juror — see S12). Rebirth has none, by definition. |
| S5 | Bank: escrow [10] | The escrow lock travels inside the Bond record, since each transition emits one object. |
| S6 | Coordination: Contract [11] | The principal issues it, the performer co-signs it, and it is the first record of the job's chain. Intent/Offer (or Call/Proposal) are referenced, not chained. |
| S7 | Mandate [12] | Enumerate `self_modification`, `checkpoints` and `irreversible.policy`, and a dotted scope grammar such as `repo.read` and `pr.open`. |
| S8 | Registry: fleets [23] | A Fleet record is issued by its org. An agent joins by naming the fleet on its passport; it must share the fleet's sponsor, and the fleet must have room. |
| S9 | Registry: nodes [5, 24, 25] | A Node record delegates a short-lived key: it signs only as that node, never identity records, and expires. Under a Mandate, live nodes count against `max_parallel`. The person stays liable. A second Node record chained onto the first is an update — a rotation, or (setting `expires` at or before `issued_at`) an immediate revocation. |
| S10 | Transport: agent package [28, 29, 31] | Package layout, a manifest signed by the agent, and secrets as named placeholders that are never stored. May be a directory or a single gzipped tar file. |
| S11 | Learning: gates [35] | Memory changes and runtime moves are recorded as lineage `update` edges (layers `memory` and `backend`), written back after each successful run. A move's `probation_until` is tracked per DID in the registry. |
| S12 | Courts: juror stake (new, 2026-09-28) | A 17th record type, Juror (`spec/schemas/juror.schema.json`): self-issued, `{did, stake}`, chained per DID like Fleet/Passport — a later record updates the stake, locking more or returning some/all via the same credit ledger Bond/Settlement use. A ruling Attestation must be cosigned by a majority of the panel `drawPanel` draws (conflict-free: excludes the contract's principal, performer, and anyone they sponsor; seeded from the rejection that opened the dispute, so it's deterministic and replayable) — unless zero eligible jurors are registered anywhere, in which case any neutral DID may still rule, unchanged from the original mocked behavior (MOCKS.md #4). Chosen over a ledger-only (unsigned) stake specifically so staking is itself a real, verifiable, replayable commitment. |
