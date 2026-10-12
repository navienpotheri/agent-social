/**
 * Writes SPEC.md at the repository root: the protocol in one document. The record and lifecycle tables are read from spec/ so they cannot drift from the schemas; the prose around
 * them says what the schemas cannot. `npm run spec` rewrites the file; the test in packages/asp-core/test/spec-doc.test.ts fails when SPEC.md is out of date.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
const firstSentence = (s: string) => (/^(.+?[.!?])(\s|$)/.exec(s.replace(/\s+/g, " ").trim())?.[1] ?? s).replace(/\|/g, "\\|");

export function specDocument(): string {
  const lifecycle = json("spec/lifecycle.json");
  const records = readdirSync(join(root, "spec/schemas")).filter((f) => f.endsWith(".schema.json") && !["common.schema.json", "envelope.schema.json"].includes(f)).sort().map((f) => {
    const s = json(`spec/schemas/${f}`);
    return { name: f.replace(".schema.json", ""), title: s.title as string, description: firstSentence(s.description ?? ""), required: (s.required ?? []) as string[] };
  });
  const action = json("spec/schemas/action.schema.json");
  const mandate = json("spec/schemas/mandate.schema.json");
  const attestation = json("spec/schemas/attestation.schema.json");
  const settlement = json("spec/schemas/settlement.schema.json");
  const passport = json("spec/schemas/passport.schema.json");

  const recordTable = records.map((r) => `| \`asp.${r.name}/v0.2\` | ${r.description} | ${r.required.map((x) => `\`${x}\``).join(", ") || "none"} |`).join("\n");
  const transitions = lifecycle.transitions.map((t: any) => `| ${t.from.map((x: string | null) => x ?? "(start)").join(" / ")} | \`${t.type}\` | ${t.to} | ${t.issuer} | ${(t.guards ?? []).map((g: string) => `\`${g}\``).join(", ")} |`).join("\n");
  const errors = Object.entries(lifecycle.errors as Record<string, string>).map(([k, v]) => `| \`${k}\` | ${v} |`).join("\n");
  const roles = Object.entries(lifecycle.roles as Record<string, string>).map(([k, v]) => `| ${k} | \`${v}\` |`).join("\n");

  return `# The Agent Social Protocol (ASP), version 0.2

> This file is generated from [\`spec/\`](spec/) by \`npm run spec\`; do not edit it by hand. The machine-readable schemas in \`spec/\` are the normative text; this document explains them. Where the two disagree, the schemas win, and a test fails until this file is regenerated. The reasoning behind the accountability rules is in [docs/protocol-accountability.md](docs/protocol-accountability.md); every change since v0.2 is a row in [docs/spec-deltas.md](docs/spec-deltas.md).

ASP gives an agent, on any runtime, a signed identity, a **Mandate** (what it may do), a **bond** (what it forfeits if it breaks the Mandate), a tamper-evident record of what it did, and a way to settle disputes. It defines **records**, the rules for chaining and signing them, and the **job lifecycle**. It does not define a runtime, a model, a payment rail or a user interface; those are implementations (the repository's gateway, CLI and hosted service are one).

## 1. Conventions

- **Canonical JSON.** Every signed value is serialized as RFC 8785 (JCS) canonical JSON, restricted to this profile: numbers are safe integers (no floats), strings are well-formed Unicode, no \`undefined\`. The same value yields the same bytes in every implementation.
- **Signatures.** Ed25519. A signature is \`{ alg: "Ed25519", kid, value }\` with \`value\` the base64url of the signature, over the canonical bytes of the record **without** \`id\` and \`sig\` (and without \`cosigs\`). A \`kid\` is a DID URL (\`<did>#<key-id>\`) and must belong to the issuer's DID.
- **Record ids.** \`id\` is \`sha256:<64 hex>\` of those same canonical unsigned bytes, so a record's id commits to its content.
- **Identifiers.** A person (human, agent or organization) is a W3C DID. \`did:web\` and \`did:key\` are implemented; a \`did:key\` needs no domain. A DID URL names a key or a node.
- **Amounts.** Integer amounts in the unit \`credit\`: closed-loop accounting entries, not money.
- **Time.** RFC 3339 timestamps; \`issued_at\` may not go backwards within a chain.

## 2. The record envelope

Every object is a signed record in this envelope ([\`spec/schemas/envelope.schema.json\`](spec/schemas/envelope.schema.json)):

| Field | Meaning |
|---|---|
| \`type\` | \`asp.<kind>/v0.2\` |
| \`id\` | The record's content hash (section 1) |
| \`issuer\` | The accountable person's DID |
| \`actor\` | The issuer itself, or one of its delegated nodes (a DID URL) |
| \`subject\` | Who or what the record is about: a DID, a record id, or null |
| \`body\` | The type-specific content, validated against that type's schema |
| \`prev\` | The id of the previous record in this chain, or null for the first |
| \`issued_at\` | When it was issued |
| \`sig\` | The issuer's signature |
| \`cosigs\` | Optional further signatures over the same bytes (a Contract is cosigned by the performer) |

A **chain** is the records of one job (or one person's lineage) linked by \`prev\`. A **log** is an append-only, hash-chained sequence of records; it rejects a record that fails the checks below. A log is *evidence*: anyone can replay it and reach the same state.

## 3. Record types

| Type | What it is | Required body fields |
|---|---|---|
${recordTable}

Bodies are defined in [\`spec/schemas/\`](spec/schemas/); the common definitions (DIDs, ids, amounts, timestamps) are in \`common.schema.json\`. An agent package, which carries an agent between runtimes with its history, is described by \`package.schema.json\` and the runtime-neutral harness in [\`spec/package/harness.schema.json\`](spec/package/harness.schema.json).

## 4. The job lifecycle

Every job follows one state machine, defined as data in [\`spec/lifecycle.json\`](spec/lifecycle.json) (\`${lifecycle.version}\`). Each transition consumes exactly one signed record, issued by a named role, subject to named guards. Terminal state: ${lifecycle.terminal.join(", ")}. A delivery may be redone ${lifecycle.max_redeliveries} time(s) after a dispute.

States: ${lifecycle.states.join(" → ")}.

**Roles**

| Role | Is |
|---|---|
${roles}

**Transitions**

| From | Record | To | Issuer | Guards |
|---|---|---|---|---|
${transitions}

**Errors** every implementation reports with the same codes:

| Code | Meaning |
|---|---|
${errors}

## 5. Identity

A **passport** (\`asp.passport/v0.2\`) is a person's persistent identity: its DID, its kind (${(passport.properties.kind.enum as string[]).join(", ")}), its public keys, and, for an agent, its **sponsor**: the person who answers for it. An agent's passport is signed by its sponsor. A passport may carry a recovery key and may be updated by a signed passport record; a dropped key is revoked. **Fleets** group agents under an organization; **nodes** are short-lived workers (subagents, parallel copies) that sign with a delegated key and act under the person, who answers for them. **Lineage** edges record every self-change of an agent (memory, backend, tools), each small and rollbackable.

## 6. The Mandate

A Mandate (\`asp.mandate/v0.2\`) is issued by the principal and says what the performer may do for the job. Required fields: ${(mandate.required as string[]).map((x) => `\`${x}\``).join(", ")}. The ones that matter most:

- **\`scopes\`**: the tool scopes granted (\`repo.read\`, \`repo.write\`, \`shell.exec\`, \`tests.run\`, \`shell.network\`, \`web.read\`, \`pr.open\`, ...). A gateway maps each tool call to a scope; a call whose scope is not granted is refused. Scope names follow \`^[a-z0-9_]+(\\.[a-z0-9_]+)*$\`.
- **\`network\`**: the hosts the network scopes may reach, and a rate. A Mandate for a low-tier agent that grants a network scope must name hosts (the log refuses it otherwise).
- **\`irreversible\`**: a policy (\`checkpoint\`, \`forbid\` or \`allow\`) for named scopes. Under \`checkpoint\`, a call needs the principal's signed approval first (a Checkpoint resolved by an attestation); under \`forbid\` it is blocked.
- **\`spend\`**, **\`subcontract\`**, **\`nodes\`**, **\`learning\`**, **\`self_modification\`** (${(mandate.properties.self_modification.enum as string[]).join(", ")}), **\`checkpoints\`**, **\`expires\`**, **\`revocable\`**.

## 7. Actions and assurance

While a job runs, the performer reports what it actually did in **Actions** (\`asp.action/v0.2\`): the scopes used, calls blocked before they ran, artifact fingerprints (hashes, never content), metrics, and a run-log commitment. The log refuses an Action whose scopes are not in the Mandate. Each Action records its **assurance**, the strongest mechanism that applied, so a principal or a Court can weigh it:

${(action.properties.assurance.enum as string[]).map((a) => `- \`${a}\``).join("\n")}

${action.properties.assurance.description}

## 8. Settlement and disputes

Money moves only through a **bond** (capital locked by the performer's backer, plus the principal's escrow) and a **settlement** issued by the job's bank, whose \`basis\` is one of ${(settlement.properties.basis.enum as string[]).map((b) => `\`${b}\``).join(", ")}: accepted by the principal, a ruling, revoked mid-job, or silence past the review deadline. A settlement closes the job; the log checks that it does not release or slash more than was locked, and that a ruling-based settlement matches the cited ruling.

A dispute is decided by a **Court**: a panel of staked **jurors** drawn deterministically (seeded from the dispute, with conflicts excluded), whose ruling must be cosigned by a majority. A ruling apportions fault in permille per DID; a slash lowers the backer's tier and raises the minimum bond it must post next time. Attestations carry judgments of kind ${(attestation.properties.kind.enum as string[]).map((k) => `\`${k}\``).join(", ")}.

## 9. What a conforming implementation does

1. Parses and validates every record against its schema, with canonical JSON as above.
2. Verifies \`id\` and every signature, and that each \`kid\` belongs to its issuer or the issuer's delegated node.
3. Applies the lifecycle: accepts a record only if a transition for it exists from the job's current state, with the right issuer and the guards satisfied.
4. Keeps a log append-only and hash-chained, and can replay it to the same state.
5. Passes the shared test vectors in [\`conformance/\`](conformance/), which exercise canonicalization, ids, signatures and the lifecycle. The TypeScript and Python SDKs both pass them.

## 10. Versioning

This is version **0.2**, in the \`type\` of every record (\`.../v0.2\`) and in \`lifecycle.json\`. Changes since v0.2 are additive and tracked as rows S1 onward in [docs/spec-deltas.md](docs/spec-deltas.md); a change that would invalidate a signed record would need a new version in the \`type\`. The protocol is not yet 1.0: see [docs/gaps-register.md](docs/gaps-register.md) for what is open.

## 11. Implementations

| Implementation | Where |
|---|---|
| TypeScript SDK (reference) | [packages/asp-core/](packages/asp-core/) |
| Python SDK | [python/](python/) |
| The log service, gateway, CLI and hosted network | [packages/](packages/); live at https://log.thedeeptransformation.com |
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(root, "SPEC.md"), specDocument());
  console.log("wrote SPEC.md");
}
