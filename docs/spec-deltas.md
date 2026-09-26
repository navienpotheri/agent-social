# Where the implementation interprets or extends ASP v0.2

The spec is the source of truth. This page lists every place where the code had to choose something the spec leaves open, or depart from it. Each item should either go back into the spec or be changed here.

## Envelope and signing

1. **Two envelope fields added.** `issued_at` (RFC 3339 timestamp) and optional `cosigs` sit beside the spec's `{type, id, issuer, actor, subject, body, prev, sig}`. `sig` is an object `{alg: "Ed25519", kid, value}`, where `kid` is a DID URL naming the key.
2. **What gets hashed and signed.** `id = "sha256:" + hex(sha256(JCS(unsigned view)))`. The unsigned view is `type, issuer, actor, subject, body, prev, issued_at`. Every signature and co-signature covers the same bytes. JCS is RFC 8785 canonical JSON.
3. **Integers only.** Signed records carry no fractional numbers, so every SDK produces the same bytes. Fractions are expressed in permille: forecast `p_permille`, `risk_factor_permille`, `pro_rata_permille`, `earnings_split.agent_permille`. An integral float such as `1.0` counts as the integer 1.
4. **Type strings** look like `asp.mandate/v0.2`, taken from the spec's Mandate example.
5. **Actors.** `actor` is either the issuer's DID or a DID URL under it, e.g. `did:web:…:coder-1#node-3`. Nodes sign with their person's key for now; delegated node keys come later.
6. **DIDs.** v0.1 uses `did:web`. Schemas accept any DID method, so `did:asp` can follow without a breaking change.
7. **Schema ids** are `urn:asp:v0.2:<name>`, so no web domain is claimed yet.

## Record types

8. **14 record types, not 11.** Passport, lineage edge and agent package are signed records too, following "everything is an attestation".
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
