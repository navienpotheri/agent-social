# Where the implementation interprets or extends ASP v0.2

The spec is the source of truth. This page lists every place where the code had to choose something the spec leaves open, or depart from it. Each item should either go back into the spec or be changed here.

## Envelope and signing

1. **Two envelope fields added.** `issued_at` (RFC 3339 timestamp) and optional `cosigs` sit beside the spec's `{type, id, issuer, actor, subject, body, prev, sig}`. `sig` is an object `{alg: "Ed25519", kid, value}`, where `kid` is a DID URL naming the key.
2. **What gets hashed and signed.** `id = "sha256:" + hex(sha256(JCS(unsigned view)))`. The unsigned view is `type, issuer, actor, subject, body, prev, issued_at`. Every signature and co-signature covers the same bytes. JCS is RFC 8785 canonical JSON.
3. **Integers only.** Signed records carry no fractional numbers, so every SDK produces the same bytes. Fractions are expressed in permille: forecast `p_permille`, `risk_factor_permille`, `pro_rata_permille`, `earnings_split.agent_permille`. An integral float such as `1.0` counts as the integer 1.
4. **Type strings** look like `asp.mandate/v0.2`, taken from the spec's Mandate example.
5. **Actors.** `actor` is either the issuer's DID or a DID URL under it, e.g. `did:web:…:coder-1#node-3`. A node signs with its own delegated key (item 24) or with its person's key.
6. **DIDs.** v0.1 uses `did:web`. Schemas accept any DID method, so `did:asp` can follow without a breaking change.
7. **Schema ids** are `urn:asp:v0.2:<name>`, so no web domain is claimed yet.

## Record types

8. **16 record types, not 11.** Passport, lineage edge, agent package, fleet declaration and node delegation are signed records too, following "everything is an attestation".
9. **Rebirth has no record type.** By definition it is a key rotation with no signed edge.
10. **Where the escrow lock lives.** The spec has no escrow object, and says each transition emits one object. So the escrow lock is carried inside the Bond record (`escrow: {payer, amount}`).
11. **Contract.** The principal issues it and the performer co-signs it. It is the first record in a job chain. Intent and Offer (or Call and Proposal) are referenced from `basis` rather than chained.
12. **Mandate enums were chosen here:**
    - `self_modification`: `forbidden | principal_approves | sponsor_approves | mentor_approves | automatic_audited`
    - `checkpoints`: `plan | before_irreversible | high_impact | delivery`
    - `irreversible.policy`: `checkpoint | forbid | allow`
    - `scopes`: dotted lowercase names such as `repo.read` and `pr.open`
    - `revocable`: always `true`

## Lifecycle (`spec/lifecycle.json`)

13. **Acceptance takes two records.** The principal's acceptance Attestation keeps the job in `Delivered`, and the bank's Settlement (which cites it) moves it to `Settled`. The spec diagram shows one arrow.
14. **Redelivery.** The spec text says the performer "may fix and redeliver once". This is modelled as `Disputed → Delivered`, at most once. The spec diagram has no such edge.
15. **Rulings.** A ruling is an Attestation from a neutral issuer (neither principal nor performer) while the job is `Disputed`. A Settlement that cites it closes the job.
16. **Revocation.** The spec text says revocation can happen at any time. It is modelled as a Settlement with basis `revoked`, co-signed by the principal, and it is allowed from Contracted, Bonded, Running and Checkpoint. The spec diagram shows it only from Running.
17. **Not modelled yet:**
    - principal-mode silence counting as acceptance (`review_deadline` exists in the Intent schema)
    - escalation and panel fees
    - appeals
    - subcontract nesting
    - checking a Mandate against the agent's tier limits

## Event log (`packages/asp-log`)

18. **Chains never fork.** Each record has at most one successor. Postgres enforces this with `UNIQUE (prev)`. A record whose `prev` is not its chain's head is rejected with `BAD_PREV`.
19. **Chain kinds.** A chain is named after the type of its first record. A chain that starts with a Contract is a job and must follow the lifecycle. Any other chain holds only records of its root's type, e.g. one passport's versions. Job-only types (contract, bond, mandate, checkpoint, delivery, settlement) cannot appear outside a job.
20. **Registry from passports.**
    - Keys come from passport records in the log.
    - A person's first passport starts its own chain. It may be issued by the person itself, which bootstraps its keys, or by a registered sponsor.
    - Each update must follow the latest passport for that DID and be issued by the DID or its sponsor.
    - Keys left out of an update are revoked from that moment on. Records signed before then still verify when the log is replayed.
21. **Log hash.** `log_hash = sha256(previous log_hash + "\n" + record id)`, starting from 64 zeros. It makes the log order tamper-evident and gives a single value to anchor publicly later. Nothing signs or anchors it yet.
22. **Appends run one at a time**, behind a lock on the log head. That is simple and correct, but it caps throughput. Revisit this when many fleets write at once.

## Fleets and nodes

23. **Fleets are declared by a Fleet record.** The spec says a fleet is "a declared group of agent persons under one organization". The fleet's org issues a Fleet record (`did`, `org`, `name`, `purpose`, optional `template` and `max_members`), and updates to it form a chain. The org never changes. An agent joins by naming the fleet on its passport. The log accepts that only if:
    - the fleet is declared;
    - the agent's sponsor is the fleet's org;
    - the fleet has room.
    Only agents can join fleets.
24. **Nodes get delegated keys.** A person issues a Node record that gives one node (a DID URL under the person, e.g. `…:coder-1#node-7`) its own Ed25519 key.
    - The node key's id is the node id.
    - It can sign only records whose `actor` is that node.
    - It can never sign identity records (passport, fleet, node).
    - It can never co-sign.
    - It expires, by default after at most 24 hours. It is rejected once the record's `issued_at` or the log's clock passes the expiry.
    - The person stays the issuer and stays liable.
25. **Nodes under a Mandate.** A Node record may name a Mandate. The Mandate must be issued to the node's person, and the node must expire no later than the Mandate. Live nodes count against the Mandate's `nodes.max_parallel`.
26. **Replays use the original clock.** The log stores each record's append time (`appended_at`), and `verify()` replays with it, so records that were valid when appended still verify after their node key has expired.
27. **Not built yet:**
    - revoking a node before it expires
    - revoking a person's nodes when its passport keys rotate
    - requiring node keys whenever the actor is a node (a person's own key may still sign for its node)
    - fleet-level (template) reputation

## Agent package and CLI (decision #45)

28. **Package layout.** A package is a directory: a signed `manifest.json` (an `asp.package/v0.2` record issued by the agent), `records/history.ndjson`, `harness/`, `memory/` and `experience/sessions.ndjson`.
    - The history holds the signed records a verifier needs: the agent's passports, its sponsors' passports, its fleet and its lineage.
    - Every part is hashed into the manifest. A directory's hash covers the sorted list of its paths and file hashes.
29. **`lineage_head`** is the id of the last record in the package's history, which is the passport if the agent has no lineage edges yet. Each package record starts its own chain (`prev: null`).
30. **Runtime-neutral harness** (`spec/package/harness.schema.json`). It holds instructions, skills (SKILL.md directories), subagents, commands, hooks (in Claude Code's shape for now), MCP servers, permission rules, env and model. Components with no neutral form yet are kept under `runtime_specific`.
31. **Secrets.** Every literal env or MCP env/header value becomes a `{"$secret": NAME}` placeholder. This includes values that may not be secret, such as URLs. `pack` refuses to run if any captured file looks like it contains a secret, and reports only the file, line and kind. `run` resolves placeholders from the environment into the child process only; files on disk keep `${NAME}` references.
32. **Experience is metadata only for now.** For each session the package records timestamps, models, prompt and turn counts, tool-call counts, tool errors and output tokens. Transcript content is not copied. Turning transcripts into lessons belongs to the learning layer, and needs a decision on what principals' data may leave the machine.
33. **Manifest permissions are a heuristic.** Claude Code permission rules are mapped to coarse scopes (`repo.read`, `repo.write`, `tests.run`, `pr.open`, `repo.push`, `mcp.<server>.<tool>`, and so on) so a principal can read them. The harness keeps the exact rules.
34. **`run` never writes into the project.** For Claude Code it builds a session-only plugin (`--plugin-dir`), an appended system prompt holding instructions and memory, and a `--settings` file, all in `~/.asp/runs/`.
    - Path-scoped rules are included unconditionally, with their globs shown as text.
    - Skills load namespaced as `<agent>:<skill>`.
    - Instructions the target project already has, byte for byte, are skipped.
35. **Not built yet:**
    - recording a backend swap as a lineage `update` edge with probation
    - canary checks in `verify`
    - packages as a single archive file
    - write-back of memory the agent adds while running

