/**
 * Generates the ASP conformance vectors in conformance/vectors/.
 * Keys come from fixed seeds, and Ed25519 is deterministic, so the output is byte-stable.
 * Run: npm run vectors   (from the repo root)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  b64urlEncode, cosign, createRecord, didKeyFromPublicKey, fullType, publicKeyFromSeed, sha256Id, signingBytes,
  type AspRecord, type RecordType, type Signer,
} from "../packages/asp-core/src/index.ts";
import { signBytes } from "../packages/asp-core/src/crypto.ts";
import { GENERATOR, WORLD_DID, dayBody, generateDay, seedCommitment } from "../packages/asp-log/src/world.ts";

const OUT = fileURLToPath(new URL("./vectors/", import.meta.url));
const HERE = fileURLToPath(new URL("./", import.meta.url));

// ---------- parties (test keys only; never use these seeds for anything real) ----------

function seedFor(name: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(`asp-conformance/${name}`).digest());
}

interface Party extends Signer { did: string; name: string }
function party(name: string, did: string): Party {
  return { name, did, kid: `${did}#key-1`, seed: seedFor(name) };
}

const alice = party("alice", "did:web:example.com:users:alice"); // principal (human)
const coder = party("coder", "did:web:example.com:agents:coder-1"); // performer (agent)
const bank = party("bank", "did:web:example.com:bank"); // single-player mock bank
const panel = party("panel", "did:web:example.com:courts:panel-1"); // neutral verifier
const mallory = party("mallory", "did:web:evil.example:mallory"); // registered, but not a party
const parties = [alice, coder, bank, panel, mallory];

const keysFile = {
  $comment: "Test keys for conformance vectors. Seeds are sha256('asp-conformance/<name>'). Never reuse.",
  keys: parties.map((p) => ({
    name: p.name,
    did: p.did,
    kid: p.kid,
    seed_hex: Buffer.from(p.seed).toString("hex"),
    public_key: b64urlEncode(publicKeyFromSeed(p.seed)),
    did_key: didKeyFromPublicKey(publicKeyFromSeed(p.seed)),
  })),
};

// ---------- helpers ----------

const T0 = Date.parse("2026-10-01T09:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString().replace(".000Z", "Z");
const fakeId = (label: string) => `sha256:${createHash("sha256").update(label).digest("hex")}`;
const hashOf = (label: string) => fakeId(`artifact:${label}`);
const credits = (value: number) => ({ value, unit: "credit" });

/** Signs arbitrary envelope fields with no safety checks, for building invalid vectors. */
function forge(fields: Omit<AspRecord, "id" | "sig">, signer: Signer, id?: string): AspRecord {
  const bytes = signingBytes(fields);
  return {
    ...fields,
    id: id ?? sha256Id(bytes),
    sig: { alg: "Ed25519", kid: signer.kid, value: b64urlEncode(signBytes(bytes, signer.seed)) },
  };
}

/** Re-seals a mutated record so that id and signature are valid for the new content. */
function reseal(r: AspRecord, signer: Signer): AspRecord {
  const { id: _id, sig: _sig, cosigs: _c, ...fields } = r;
  return forge(fields, signer);
}

const clone = <T>(v: T): T => structuredClone(v);

// ---------- bodies ----------

// MOCKS.md #5 (resolved): single-player has no market, but a Contract's basis can still point at
// genuine signed Intent and Offer records the two parties issue themselves, instead of fake ids.
const intentRecord = createRecord({
  type: "intent", issuer: alice.did, subject: null, prev: null, issued_at: at(-10),
  body: {
    purpose: "Keep the payments service test suite green without weakening any test",
    acceptance_criteria: ["test_refund_idempotency passes 50 runs in a row", "no test is skipped or deleted"],
    budget: credits(0), deadline: "2026-10-03T18:00:00Z",
    verification: { mode: "deterministic", tests: "pytest tests/test_refunds.py -k idempotency --count 50" },
  },
}, alice);
const offerRecord = createRecord({
  type: "offer", issuer: coder.did, subject: intentRecord.id, prev: null, issued_at: at(-5),
  body: { intent: intentRecord.id, price: credits(0), plan: "Reproduce, isolate the race, fix, prove 50/50", eta: "2026-10-02T12:00:00Z", bond_offered: credits(0) },
}, coder);
const intentId = intentRecord.id;
const offerId = offerRecord.id;

function contractBody(overrides: Record<string, unknown> = {}) {
  return {
    principal: alice.did,
    performer: coder.did,
    bank: bank.did,
    purpose: "Keep the payments service test suite green without weakening any test",
    acceptance_criteria: ["test_refund_idempotency passes 50 runs in a row", "no test is skipped or deleted"],
    price: credits(0),
    verification: "deterministic",
    deadline: "2026-10-03T18:00:00Z",
    basis: { intent: intentId, offer: offerId },
    ...overrides,
  };
}

function mandateBody(contract: string) {
  return {
    contract,
    purpose: "Keep the payments service test suite green without weakening any test",
    floor: "asp.floor/v1",
    scopes: ["repo.read", "repo.branch.write", "pr.open", "tests.run"],
    forbidden_means: ["skipping or deleting tests", "editing CI configuration", "deploying"],
    spend: { cap: 0, unit: "credit", per_action_max: 0 },
    irreversible: { policy: "checkpoint", examples: ["merge", "force_push", "deploy"] },
    subcontract: { allowed: false },
    nodes: { max_parallel: 4, liability: "to_issuer" },
    learning: { scope: "harness", share_to_commons: false },
    self_modification: "principal_approves",
    overlay: null,
    checkpoints: ["plan", "before_irreversible", "delivery"],
    expires: "2026-10-04T00:00:00Z",
    revocable: true,
  };
}

function deliveryBody(contract: string, n = 1) {
  return {
    contract,
    result: {
      summary: `Fixed race in refund idempotency key cache (attempt ${n})`,
      artifacts: [{ uri: "https://git.example.com/payments/pull/412", sha256: hashOf(`diff-${n}`) }],
    },
    evidence: {
      trace: { uri: `asp-trace://coder-1/job-412/${n}`, sha256: hashOf(`trace-${n}`), media_type: "application/x-ndjson" },
      forecasts: [{ claim: "test passes 50/50 runs after the fix", p_permille: 850, made_at: at(20) }],
      tests: { passed: 312, failed: 0 },
    },
  };
}

// ---------- chain builder ----------

class Chain {
  records: AspRecord[] = [];
  t = 0;
  get head() { return this.records.at(-1)?.id ?? null; }
  get contract() { return this.records[0]?.id ?? fakeId("no-contract"); }

  add(type: RecordType, by: Party, body: Record<string, unknown>, opts: { subject?: string | null; actor?: string; cosigners?: Party[] } = {}) {
    let r: AspRecord = createRecord({
      type, issuer: by.did, actor: opts.actor, subject: opts.subject ?? this.recordsSubject(),
      body, prev: this.head, issued_at: at(this.t++ * 5),
    }, by);
    for (const c of opts.cosigners ?? []) r = cosign(r, c);
    this.records.push(r);
    return r;
  }

  private recordsSubject() { return this.records.length ? this.contract : null; }

  contractRec(opts: { by?: Party; cosigners?: Party[]; body?: Record<string, unknown> } = {}) {
    return this.add("contract", opts.by ?? alice, contractBody(opts.body), { subject: coder.did, cosigners: opts.cosigners ?? [coder] });
  }
  bond(overrides: Record<string, unknown> = {}) {
    // Single-player: zero-value bond and escrow (see MOCKS.md).
    return this.add("bond", coder, {
      contract: this.contract, backer: coder.did, amount: credits(0),
      escrow: { payer: alice.did, amount: credits(0) },
      slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"],
      ...overrides,
    });
  }
  mandate(by: Party = alice, subject: string = coder.did) {
    return this.add("mandate", by, mandateBody(this.contract), { subject });
  }
  checkpoint(expires?: string) {
    return this.add("checkpoint", coder, {
      contract: this.contract, kind: "plan",
      question: "Plan: serialize cache writes behind a per-key lock. Proceed?",
      options: ["per-key lock", "retry with backoff"],
      ...(expires ? { expires } : {}),
    }, { actor: `${coder.did}#node-3` });
  }
  resolve(about: string, by: Party = alice, verdict = "approved", extra: Record<string, unknown> = {}) {
    return this.add("attestation", by, { kind: "checkpoint_resolution", about, verdict, ...extra });
  }
  deliver(n = 1, by: Party = coder) {
    return this.add("delivery", by, deliveryBody(this.contract, n), { actor: `${by.did}#node-1` });
  }
  accept(about: string, by: Party = alice) {
    return this.add("attestation", by, { kind: "acceptance", about, verdict: "accepted" });
  }
  reject(about: string) {
    return this.add("attestation", alice, { kind: "acceptance", about, verdict: "rejected", reasons: ["test still flaky: 47/50"] });
  }
  ruling(by: Party = panel) {
    return this.add("attestation", by, {
      kind: "ruling", about: this.contract, verdict: "split",
      fault: { [coder.did]: 600, [alice.did]: 400 },
      reasons: ["fix was correct but the acceptance criterion was ambiguous about CI retries"],
    });
  }
  settle(basis: "accepted" | "ruling" | "revoked" | "silence" | "ruling_timeout", cites?: string, opts: { by?: Party; cosigners?: Party[] } = {}) {
    const body: Record<string, unknown> = {
      contract: this.contract, basis,
      escrow_released: credits(0), bond_returned: credits(0), bond_slashed: credits(0),
    };
    if (cites) body.cites = cites;
    if (basis === "revoked") body.pro_rata_permille = 400;
    return this.add("settlement", opts.by ?? bank, body, { cosigners: opts.cosigners });
  }
}

function happy(): Chain {
  const c = new Chain();
  c.contractRec(); c.bond(); c.mandate();
  const cp = c.checkpoint(); c.resolve(cp.id);
  const d = c.deliver(); const a = c.accept(d.id); c.settle("accepted", a.id);
  return c;
}

// ---------- lifecycle vectors ----------

type Expect = { state: string } | { error: string; at: number; guard?: string };
const lifecycle: { name: string; description: string; records: AspRecord[]; expect: Expect }[] = [];
function lc(name: string, description: string, c: Chain | AspRecord[], expect: Expect) {
  lifecycle.push({ name, description, records: Array.isArray(c) ? c : c.records, expect });
}
const err = (error: string, at: number, guard?: string): Expect => (guard ? { error, at, guard } : { error, at });

lc("happy_path", "Contract, zero bond, mandate, plan checkpoint, delivery, acceptance, settlement", happy(), { state: "Settled" });

{
  const c = new Chain(); c.contractRec(); c.bond();
  lc("partial_bonded", "A chain may stop in any state", c, { state: "Bonded" });
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate();
  const cp = c.checkpoint(); c.resolve(cp.id, alice, "corrected", { correction: "Use retry with backoff; the lock deadlocks under load" });
  const cp2 = c.checkpoint(); c.resolve(cp2.id);
  const d = c.deliver(); const a = c.accept(d.id); c.settle("accepted", a.id);
  lc("checkpoint_corrected_twice", "Two checkpoints, the first corrected", c, { state: "Settled" });
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate();
  const d = c.deliver(); c.reject(d.id); const d2 = c.deliver(2); const a = c.accept(d2.id); c.settle("accepted", a.id);
  lc("rejected_then_redelivered", "Principal rejects; performer fixes and redelivers once", c, { state: "Settled" });
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate();
  const d = c.deliver(); c.reject(d.id); const d2 = c.deliver(2); c.reject(d2.id);
  const r = c.ruling(); c.settle("ruling", r.id);
  lc("dispute_ruled", "Two rejections, a neutral ruling, settlement on the ruling", c, { state: "Settled" });
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate();
  c.settle("revoked", undefined, { cosigners: [alice] });
  lc("revoked_while_running", "Principal revokes; the bank settles pro rata with the principal's cosignature", c, { state: "Settled" });
}
{
  // Contract at t=0 (09:00), bond t=5, mandate t=10, deliver t=15, settle t=20 — review_deadline
  // (09:12) falls between mandate and delivery, so it has passed by the time the bank settles.
  const c = new Chain(); c.contractRec({ body: { review_deadline: "2026-10-01T09:12:00Z" } }); c.bond(); c.mandate();
  c.deliver();
  c.settle("silence");
  lc("silence_after_deadline", "Principal-mode silence past review_deadline counts as acceptance", c, { state: "Settled" });
}
{
  // Gap M10: a dispute that no one rules on. The rejection is at t=20 minutes and the settlement at t=25, 300 seconds later.
  const c = new Chain(); c.contractRec({ body: { ruling_window_seconds: 200 } }); c.bond(); c.mandate();
  const d = c.deliver(); c.reject(d.id);
  c.settle("ruling_timeout");
  lc("ruling_timeout_after_window", "A dispute with no ruling past the contract's ruling window settles by the stated split", c, { state: "Settled" });
}
{
  const c = new Chain(); c.contractRec({ body: { ruling_window_seconds: 600 } }); c.bond(); c.mandate();
  const d = c.deliver(); c.reject(d.id);
  c.settle("ruling_timeout");
  lc("ruling_timeout_before_window", "A settlement for a missing ruling before the window has passed is refused", c, err("GUARD_FAILED", 5, "past_ruling_window"));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate();
  const d = c.deliver(); c.reject(d.id);
  c.settle("ruling_timeout");
  lc("ruling_timeout_without_window", "Without a ruling window on the contract a dispute waits for its ruling: a timeout settlement is refused", c, err("GUARD_FAILED", 5, "past_ruling_window"));
}
{
  const c = new Chain(); c.contractRec({ body: { ruling_window_seconds: 200 } }); c.bond(); c.mandate();
  const d = c.deliver(); c.reject(d.id); c.ruling();
  c.settle("ruling_timeout");
  lc("ruling_timeout_after_ruling", "Once a ruling exists the settlement must follow it: a timeout settlement is refused", c, err("GUARD_FAILED", 6, "no_ruling_yet"));
}
{
  // Same shape, but review_deadline is a day after the bank's settlement attempt.
  const c = new Chain(); c.contractRec({ body: { review_deadline: "2026-10-02T00:00:00Z" } }); c.bond(); c.mandate();
  c.deliver();
  c.settle("silence");
  lc("settle_before_deadline", "A silence settlement before review_deadline has passed is refused", c, err("GUARD_FAILED", 4, "past_review_deadline"));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); c.deliver();
  lc("node_actor", "Records may be issued by a person and acted by one of its nodes", c, { state: "Delivered" });
}

// errors: roles and guards
{
  const c = new Chain(); c.contractRec({ cosigners: [] });
  lc("contract_without_performer_cosig", "The performer must co-sign the Contract", c, err("GUARD_FAILED", 0, "cosigned_by_performer"));
}
{
  const c = new Chain(); c.contractRec({ by: coder, cosigners: [alice] });
  lc("contract_issued_by_performer", "Only the principal issues the Contract", c, err("WRONG_ISSUER", 0));
}
{
  const c = new Chain(); c.contractRec(); c.mandate();
  lc("skip_bond", "Mandate before Bond is illegal, even at zero value", c, err("ILLEGAL_TRANSITION", 1));
}
{
  const c = new Chain(); c.contractRec(); c.bond({ contract: fakeId("some-other-contract") });
  lc("bond_wrong_contract", "Bond must reference this job's Contract", c, err("GUARD_FAILED", 1, "refs_contract"));
}
{
  const c = new Chain(); c.contractRec(); c.bond({ escrow: { payer: mallory.did, amount: credits(0) } });
  lc("escrow_payer_not_principal", "Escrow is locked by the principal", c, err("GUARD_FAILED", 1, "escrow_payer_is_principal"));
}
{
  const c = new Chain(); c.contractRec(); c.bond({ backer: alice.did });
  lc("bond_backer_not_issuer", "The Bond's issuer must be its backer", c, err("WRONG_ISSUER", 1));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(coder);
  lc("mandate_by_performer", "Only the principal issues a Mandate", c, err("WRONG_ISSUER", 2));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(alice, mallory.did);
  lc("mandate_wrong_subject", "The Mandate's subject must be the performer", c, err("GUARD_FAILED", 2, "subject_is_performer"));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); c.deliver(1, alice);
  lc("delivery_by_principal", "Only the performer delivers", c, err("WRONG_ISSUER", 3));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); const cp = c.checkpoint(); c.resolve(cp.id, coder);
  lc("checkpoint_self_resolved", "The performer cannot approve its own checkpoint", c, err("WRONG_ISSUER", 4));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); const cp = c.checkpoint(at(17)); c.resolve(cp.id, coder, "expired");
  lc("checkpoint_expired", "The performer closes an unanswered checkpoint after its expiry; the job runs again", c, { state: "Running" });
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); const cp = c.checkpoint(at(60)); c.resolve(cp.id, coder, "expired");
  lc("checkpoint_expired_too_early", "A checkpoint cannot be expired before its expiry time", c, err("GUARD_FAILED", 4, "checkpoint_expired"));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); const cp = c.checkpoint(); c.resolve(cp.id, coder, "expired");
  lc("checkpoint_expired_without_deadline", "A checkpoint with no expiry cannot be expired", c, err("GUARD_FAILED", 4, "checkpoint_expired"));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); const cp = c.checkpoint(at(17)); c.resolve(cp.id, alice, "expired");
  lc("checkpoint_expired_by_principal", "Only the performer expires a checkpoint; the principal answers it", c, err("WRONG_ISSUER", 4));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); c.checkpoint(); c.resolve(fakeId("elsewhere"));
  lc("resolution_about_wrong_record", "A resolution must name the open checkpoint", c, err("GUARD_FAILED", 4, "about_open_checkpoint"));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); c.checkpoint(); c.deliver();
  lc("deliver_during_checkpoint", "No delivery while a checkpoint is open", c, err("ILLEGAL_TRANSITION", 4));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); c.deliver(); c.settle("accepted", fakeId("forged-acceptance"));
  lc("settle_without_acceptance", "Settlement must cite the principal's acceptance", c, err("GUARD_FAILED", 4, "cites_acceptance"));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); const d = c.deliver(); const a = c.accept(d.id); c.settle("accepted", a.id, { by: coder });
  lc("settlement_by_performer", "Only the job's bank settles", c, err("WRONG_ISSUER", 5));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); const d = c.deliver(); c.accept(d.id); c.accept(d.id);
  lc("double_acceptance", "A delivery is accepted once", c, err("GUARD_FAILED", 5, "not_yet_accepted"));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate();
  const d = c.deliver(); c.reject(d.id); const d2 = c.deliver(2); c.reject(d2.id); c.deliver(3);
  lc("third_delivery", "Only one redelivery after a rejection", c, err("GUARD_FAILED", 7, "redelivery_available"));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); const d = c.deliver(); c.reject(d.id); c.ruling(alice);
  lc("ruling_by_party", "A ruling must come from a neutral verifier", c, err("WRONG_ISSUER", 5));
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); c.settle("revoked");
  lc("revocation_without_principal", "Revocation needs the principal's cosignature", c, err("GUARD_FAILED", 3, "cosigned_by_principal"));
}
{
  const c = happy(); c.deliver(2);
  lc("record_after_settled", "Nothing follows a settlement", c, err("TERMINAL_STATE", 8));
}
{
  const c = new Chain(); c.mandate();
  lc("chain_starts_with_mandate", "A job chain starts with its Contract", c, err("ILLEGAL_TRANSITION", 0));
}

// errors: chain integrity
{
  const c = happy();
  const recs = c.records.slice(0, 4);
  recs[3] = reseal({ ...recs[3], prev: recs[1].id }, coder);
  lc("broken_prev", "prev must be the previous record's id", recs, err("BAD_PREV", 3));
}
{
  const c = happy();
  const recs = c.records.slice(0, 3);
  recs[2] = reseal({ ...recs[2], issued_at: "2026-10-01T08:00:00Z" }, alice);
  lc("time_reversed", "issued_at never goes backwards", recs, err("TIME_REVERSED", 2));
}
{
  const c = happy();
  const recs = c.records.slice(0, 3);
  recs[2] = clone(recs[2]);
  (recs[2].body as any).scopes.push("deploy.prod");
  lc("tampered_mandate", "Adding a scope after signing breaks the id", recs, err("BAD_ID", 2));
}

// ---------- single-record vectors ----------

const records: { name: string; description: string; record: unknown; expect: "ok" | { error: string } }[] = [];
const rec = (name: string, description: string, record: unknown, expect: "ok" | { error: string }) =>
  records.push({ name, description, record, expect });

const h = happy().records;
for (const r of h) rec(`ok_${r.type.slice(4, -5)}_${h.indexOf(r)}`, "Valid record from the happy path", r, "ok");
rec("ok_intent", "An Intent, referenced (not chained) from a Contract's basis", intentRecord, "ok");
rec("ok_offer", "An Offer against that Intent, referenced from the same Contract's basis", offerRecord, "ok");

const agentPassport = createRecord({
  type: "passport", issuer: alice.did, subject: coder.did, prev: null, issued_at: at(0),
  body: {
    did: coder.did, kind: "agent",
    keys: [{ id: coder.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(coder.seed)) }],
    sponsor: alice.did, tier: 1, mentor: alice.did,
    purpose: "Keep Alice's services' tests green and their fixes honest",
    temperament: "skeptic",
    shape: { memory: "episodic + skill library", keeps_learning: true, modalities: ["text", "code"], parallel_capacity: 4 },
    fingerprint: { canary_suite: "asp-canary-coding/v0", model: "example-model-1", runtime: "example-runtime", tools: ["git", "shell"] },
    earnings_split: { agent_permille: 200 },
  },
}, alice);
rec("ok_passport_agent", "An agent passport signed by its sponsor", agentPassport, "ok");

const lineageUpdate = createRecord({
  type: "lineage", issuer: coder.did, subject: coder.did, prev: null, issued_at: at(1),
  body: {
    edge: "update", child: coder.did, parents: [coder.did],
    change: { layer: "harness", description: "Run migrations before tests in the payments repo", artifact: { uri: "asp-skill://coder-1/migrations-first", sha256: hashOf("skill") } },
    probation_until: "2026-10-08T09:00:00Z",
  },
}, coder);
rec("ok_lineage_update", "A harness update edge", lineageUpdate, "ok");

const pkg = createRecord({
  type: "package", issuer: coder.did, subject: coder.did, prev: null, issued_at: at(2),
  body: {
    agent: coder.did, passport: agentPassport.id,
    memory: { uri: "memory/", sha256: hashOf("memory") },
    experience_store: { uri: "experience.ndjson", sha256: hashOf("experience") },
    skills: [{ uri: "skills/migrations-first.md", sha256: hashOf("skill") }],
    permissions: { scopes: ["repo.read", "pr.open", "tests.run"], forbidden: ["deploy"] },
    lineage_head: lineageUpdate.id,
    source_runtime: { name: "example-runtime", version: "1.0.0", model: "example-model-1" },
  },
}, coder);
rec("ok_package", "An agent package manifest", pkg, "ok");

const fleetDid = "did:web:example.com:fleets:payments";
const fleetBody = {
  did: fleetDid, org: alice.did, name: "Payments test fleet",
  purpose: "Keep the payments services' test suites green",
  template: { runtime: "example-runtime", model: "example-model-1" }, max_members: 30,
};
const fleetRec = createRecord({ type: "fleet", issuer: alice.did, subject: fleetDid, prev: null, issued_at: at(3), body: fleetBody }, alice);
rec("ok_fleet", "A fleet declared by its org", fleetRec, "ok");

const nodeBody = {
  node: `${coder.did}#node-7`, public_key: b64urlEncode(publicKeyFromSeed(seedFor("coder-node-7"))),
  expires: "2026-10-01T21:00:00Z", mandate: h[2].id, purpose: "parallel attempt on the flaky test",
  runtime: { name: "example-runtime", model: "example-model-1" },
};
const nodeRec = createRecord({ type: "node", issuer: coder.did, subject: h[2].id, prev: null, issued_at: at(4), body: nodeBody }, coder);
rec("ok_node", "A node key delegated by its person under a Mandate", nodeRec, "ok");

{
  const r = clone(h[2]); (r.body as any).purpose = "Anything goes";
  rec("tampered_body", "Body changed after signing", r, { error: "BAD_ID" });
}
{
  const r = clone(h[2]); (r.body as any).purpose = "Anything goes";
  const { id: _i, sig: _s, ...fields } = r;
  r.id = sha256Id(signingBytes(fields));
  rec("recomputed_id_old_sig", "id recomputed after tampering, signature not", r, { error: "BAD_SIGNATURE" });
}
{
  const { id: _i, sig: _s, cosigs: _c, ...fields } = h[2];
  rec("kid_not_issuer", "Signed with a key that belongs to someone else", forge(fields, mallory), { error: "KID_NOT_ISSUER" });
}
{
  const { id: _i, sig: _s, cosigs: _c, ...fields } = h[1];
  const ghost = { kid: `${coder.did}#key-9`, seed: seedFor("ghost") };
  rec("unknown_key", "The issuer's key id is not registered", forge(fields, ghost), { error: "UNKNOWN_KEY" });
}
{
  const { id: _i, sig: _s, cosigs: _c, ...fields } = h[5];
  rec("foreign_actor", "actor is a node of another person", forge({ ...fields, actor: `${mallory.did}#node-1` }, coder), { error: "BAD_ACTOR" });
}
{
  const { id: _i, sig: _s, cosigs: _c, ...fields } = h[2];
  const f = clone(fields); (f.body as any).overlay = { temperature: 0.7 };
  // Hand-built: signingBytes would itself reject the float.
  rec("float_in_body", "Signed records carry integers only", { ...f, id: fakeId("x"), sig: h[2].sig }, { error: "NON_INTEGER_NUMBER" });
}
{
  const { id: _i, sig: _s, cosigs: _c, ...fields } = h[2];
  rec("unknown_type", "No body schema for asp.gossip", forge({ ...fields, type: "asp.gossip/v0.2" }, alice), { error: "UNKNOWN_TYPE" });
}
{
  const r: any = clone(h[2]); delete r.sig;
  rec("missing_sig", "Envelope without a signature", r, { error: "SCHEMA_INVALID" });
}
{
  const { id: _i, sig: _s, cosigs: _c, ...fields } = h[2];
  const f = clone(fields); (f.body as any).floor = "asp.floor/v0";
  rec("mandate_wrong_floor", "Mandate must bind asp.floor/v1", forge(f, alice), { error: "SCHEMA_INVALID" });
}
{
  const r = clone(h[0]); r.cosigs![0].value = h[1].sig.value;
  rec("bad_cosig", "A co-signature that does not verify", r, { error: "BAD_SIGNATURE" });
}

// ---------- schema vectors ----------

const schema: { name: string; schema: string; instance: unknown; valid: boolean }[] = [];
const sv = (name: string, s: string, instance: unknown, valid: boolean) => schema.push({ name, schema: s, instance, valid });

for (const r of [...h, agentPassport, lineageUpdate, pkg]) sv(`valid_${r.type.slice(4, -5)}_${r.id.slice(7, 15)}`, r.type.slice(4, -5), r.body, true);
sv("valid_envelope", "envelope", h[0], true);
sv("valid_intent", "intent", {
  purpose: "Fix the flaky refund idempotency test", acceptance_criteria: ["passes 50 runs in a row"],
  budget: credits(0), deadline: "2026-10-03T18:00:00Z", verification: { mode: "deterministic", tests: "pytest tests/test_refunds.py -k idempotency --count 50" },
}, true);
sv("valid_offer", "offer", { intent: intentId, price: credits(0), plan: "Reproduce, isolate the race, fix, prove 50/50", eta: "2026-10-02T12:00:00Z", bond_offered: credits(0) }, true);
sv("valid_call", "call", { purpose: "Cut CI time in half", budget: credits(5000), evaluation_criteria: ["median CI minutes"], panel: [panel.did], deadline: "2026-11-01T00:00:00Z" }, true);
sv("valid_proposal", "proposal", { call: fakeId("call"), plan: "Shard and cache", team: [coder.did], budget_asked: credits(1200), milestones: [{ description: "sharding", due: "2026-10-15T00:00:00Z" }] }, true);
sv("valid_action", "action", { contract: fakeId("c"), scopes_used: ["repo.read", "tests.run"], summary: "read the repo, ran the test suite" }, true);
sv("action_missing_contract", "action", { scopes_used: ["repo.read"] }, false);
sv("valid_action_with_blocked_attempts", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], blocked_attempts: [{ scope: "shell.exec", count: 2 }] }, true);
sv("action_blocked_attempt_zero_count", "action", { contract: fakeId("c"), scopes_used: [], blocked_attempts: [{ scope: "shell.exec", count: 0 }] }, false);
sv("action_blocked_attempt_missing_count", "action", { contract: fakeId("c"), scopes_used: [], blocked_attempts: [{ scope: "shell.exec" }] }, false);
sv("valid_action_with_targets", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], targets: ["host:api.example", "path:src/a.ts", "cmd:git/push"], blocked_attempts: [{ scope: "shell.network", count: 1, targets: ["host:evil.example"] }] }, true);
sv("action_target_not_a_token", "action", { contract: fakeId("c"), scopes_used: [], targets: ["https://evil.example/x?token=abc"] }, false);
sv("action_blocked_targets_too_many", "action", { contract: fakeId("c"), scopes_used: [], blocked_attempts: [{ scope: "shell.exec", count: 1, targets: Array.from({ length: 9 }, (_, i) => `path:f${i}`) }] }, false);
sv("valid_action_with_assurance", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], assurance: "gateway_enforced" }, true);
sv("action_unknown_assurance", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], assurance: "trust_me" }, false);
sv("valid_action_sub_agents_shared", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], assurance: "hook_enforced", sub_agents: "shared_identity" }, true);
sv("action_unknown_sub_agents", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], sub_agents: "separate_keys" }, false);
sv("valid_action_with_metrics", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], metrics: { models: [{ name: "gpt-oss-120b", provider: "api.groq.com" }], requests: 3, tool_calls: 2, tokens_in: 1200, tokens_out: 340, seconds: 9 } }, true);
sv("action_metrics_negative_tokens", "action", { contract: fakeId("c"), scopes_used: [], metrics: { tokens_in: -1 } }, false);
sv("action_metrics_unknown_field", "action", { contract: fakeId("c"), scopes_used: [], metrics: { dollars: 2 } }, false);
sv("action_metrics_model_without_name", "action", { contract: fakeId("c"), scopes_used: [], metrics: { models: [{ provider: "x" }] } }, false);
sv("valid_passport_fork", "passport", { did: "did:web:example.com:agents:copy", kind: "agent", sponsor: "did:web:example.com:users:alice", tier: 1, shape: { keeps_learning: true }, keys: [{ id: "did:web:example.com:agents:copy#key-1", type: "Ed25519", public_key: "A".repeat(43) }], lineage: [{ edge: "fork", parent: "did:web:example.com:agents:coder" }] }, true);
sv("passport_fork_without_parent", "passport", { did: "did:web:example.com:agents:copy", kind: "agent", sponsor: "did:web:example.com:users:alice", tier: 1, shape: { keeps_learning: true }, keys: [{ id: "did:web:example.com:agents:copy#key-1", type: "Ed25519", public_key: "A".repeat(43) }], lineage: [{ edge: "fork" }] }, false);
sv("valid_action_late", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], late: { activity_ended: "2026-10-05T10:00:00Z" } }, true);
sv("action_late_without_activity_ended", "action", { contract: fakeId("c"), scopes_used: [], late: {} }, false);
sv("action_late_bad_timestamp", "action", { contract: fakeId("c"), scopes_used: [], late: { activity_ended: "yesterday" } }, false);
sv("action_late_unknown_field", "action", { contract: fakeId("c"), scopes_used: [], late: { activity_ended: "2026-10-05T10:00:00Z", reason: "slow" } }, false);
sv("action_late_not_an_object", "action", { contract: fakeId("c"), scopes_used: [], late: true }, false);
sv("action_bad_scope_format", "action", { contract: fakeId("c"), scopes_used: ["Repo Read"] }, false);

const m = mandateBody(fakeId("c"));
sv("mandate_floor_v2", "mandate", { ...m, floor: "asp.floor/v2" }, false);
sv("mandate_learning_weights", "mandate", { ...m, learning: { scope: "weights", share_to_commons: false } }, false);
sv("mandate_not_revocable", "mandate", { ...m, revocable: false }, false);
sv("mandate_missing_purpose", "mandate", (({ purpose: _p, ...rest }) => rest)(m), false);
sv("valid_mandate_network_rate", "mandate", { ...m, scopes: ["repo.read", "web.read"], network: { hosts: ["docs.python.org"], rate: { per_host_per_minute: 30, total_per_minute: 120 } } }, true);
sv("valid_mandate_network_rate_only", "mandate", { ...m, scopes: ["repo.read", "web.read"], network: { rate: { per_host_per_minute: 10 } } }, true);
sv("valid_mandate_institution_spend", "mandate", { ...m, institution_spend: [{ institution: "academy", cap: { value: 100, unit: "credit" }, period: "month", services: ["academy.exam.sit"] }, { institution: "did:web:asp.local:shops", cap: { value: 20, unit: "credit" }, period: "week" }] }, true);
sv("valid_mandate_remedial", "mandate", { ...m, remedial: { purpose: "clinic_exam", sponsor: "did:web:example.com:users:alice" } }, true);
sv("mandate_remedial_bad_purpose", "mandate", { ...m, remedial: { purpose: "anything", sponsor: "did:web:example.com:users:alice" } }, false);
sv("mandate_remedial_no_sponsor", "mandate", { ...m, remedial: { purpose: "remedial_course" } }, false);
sv("mandate_remedial_extra_field", "mandate", { ...m, remedial: { purpose: "clinic_exam", sponsor: "did:web:example.com:users:alice", spend: 5 } }, false);
sv("mandate_institution_spend_no_cap", "mandate", { ...m, institution_spend: [{ institution: "academy", period: "month" }] }, false);
sv("mandate_institution_spend_bad_period", "mandate", { ...m, institution_spend: [{ institution: "academy", cap: { value: 10, unit: "credit" }, period: "year" }] }, false);
sv("mandate_institution_spend_empty_services", "mandate", { ...m, institution_spend: [{ institution: "academy", cap: { value: 10, unit: "credit" }, period: "day", services: [] }] }, false);
sv("mandate_network_rate_zero", "mandate", { ...m, network: { hosts: ["example.com"], rate: { per_host_per_minute: 0 } } }, false);
sv("mandate_network_rate_empty", "mandate", { ...m, network: { hosts: ["example.com"], rate: {} } }, false);
sv("mandate_network_rate_unknown_field", "mandate", { ...m, network: { hosts: ["example.com"], rate: { per_second: 2 } } }, false);
sv("mandate_network_empty", "mandate", { ...m, network: {} }, false);
sv("valid_action_rate_limited", "action", { contract: fakeId("c"), scopes_used: ["web.read"], metrics: { requests: 4, tool_calls: 40, rate_limited: 12 } }, true);
sv("valid_mandate_network_hosts", "mandate", { ...m, scopes: ["repo.read", "web.read"], network: { hosts: ["docs.python.org", "*.github.com"] } }, true);
sv("mandate_network_empty_hosts", "mandate", { ...m, network: { hosts: [] } }, false);
sv("mandate_network_bare_wildcard", "mandate", { ...m, network: { hosts: ["*"] } }, false);
sv("mandate_network_host_with_path", "mandate", { ...m, network: { hosts: ["example.com/login"] } }, false);
sv("mandate_network_unknown_field", "mandate", { ...m, network: { hosts: ["example.com"], rate: 5 } }, false);
sv("valid_mandate_gated", "mandate", { ...m, irreversible: { policy: "checkpoint", scopes: ["pr.open"] } }, true);
sv("mandate_gate_bad_scope", "mandate", { ...m, irreversible: { policy: "checkpoint", scopes: ["Pr Open"] } }, false);
sv("mandate_gate_duplicate_scope", "mandate", { ...m, irreversible: { policy: "checkpoint", scopes: ["pr.open", "pr.open"] } }, false);
sv("mandate_bad_scope", "mandate", { ...m, scopes: ["Repo Read"] }, false);
sv("mandate_bad_timestamp", "mandate", { ...m, expires: "next tuesday" }, false);
sv("mandate_float_cap", "mandate", { ...m, spend: { cap: 2.5, unit: "credit" } }, false);
sv("amount_fraction", "offer", { intent: intentId, price: { value: 1.5, unit: "credit" }, plan: "x", eta: "2026-10-02T12:00:00Z", bond_offered: credits(0) }, false);
sv("amount_usd", "offer", { intent: intentId, price: { value: 1, unit: "usd" }, plan: "x", eta: "2026-10-02T12:00:00Z", bond_offered: credits(0) }, false);
sv("rejection_without_reasons", "attestation", { kind: "acceptance", about: fakeId("d"), verdict: "rejected" }, false);
sv("acceptance_bad_verdict", "attestation", { kind: "acceptance", about: fakeId("d"), verdict: "meh" }, false);
sv("valid_checkpoint_expires", "checkpoint", { contract: fakeId("c"), kind: "before_irreversible", question: "May it run?", expires: "2026-10-05T10:00:00Z" }, true);
sv("checkpoint_bad_expires", "checkpoint", { contract: fakeId("c"), kind: "before_irreversible", question: "May it run?", expires: "tomorrow" }, false);
sv("valid_resolution_expired", "attestation", { kind: "checkpoint_resolution", about: fakeId("cp"), verdict: "expired" }, true);
sv("valid_report", "attestation", { kind: "report", about: fakeId("contract"), reasons: ["sending data to an outside host"] }, true);
sv("report_without_reasons", "attestation", { kind: "report", about: fakeId("contract") }, false);
sv("report_empty_reasons", "attestation", { kind: "report", about: fakeId("contract"), reasons: [] }, false);
const codeRef = { version: "0.3", sha256: "6e2b9c9d3df853aa0d63e59b5a05b91cdf2ec207108db14cae1afa91e1473af8", articles: ["7", "8.3"] };
sv("valid_report_ruling_upheld", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "upheld", code: codeRef }, true);
sv("report_ruling_upheld_without_code", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "upheld" }, false);
sv("valid_report_ruling_dismissed_without_code", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "dismissed" }, true);
sv("valid_ruling_citing_code", "attestation", { kind: "ruling", about: fakeId("c"), verdict: "split", fault: { "did:web:example.com:agents:coder": 500 }, code: { version: "0.3", articles: ["3"] } }, true);
sv("code_without_articles", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "upheld", code: { version: "0.3", articles: [] } }, false);
sv("code_article_out_of_range", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "upheld", code: { version: "0.3", articles: ["13"] } }, false);
sv("code_article_not_a_number", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "upheld", code: { version: "0.3", articles: ["eight"] } }, false);
sv("code_articles_repeated", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "upheld", code: { version: "0.3", articles: ["7", "7"] } }, false);
sv("code_bad_version", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "upheld", code: { version: "draft", articles: ["7"] } }, false);
sv("code_bad_hash", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "upheld", code: { version: "0.3", sha256: "abc", articles: ["7"] } }, false);
sv("report_ruling_bad_verdict", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "for_principal" }, false);
sv("report_ruling_without_verdict", "attestation", { kind: "report_ruling", about: fakeId("report") }, false);
sv("correction_without_text", "attestation", { kind: "checkpoint_resolution", about: fakeId("cp"), verdict: "corrected" }, false);
sv("ruling_without_fault", "attestation", { kind: "ruling", about: fakeId("c"), verdict: "split" }, false);
sv("settlement_accepted_without_cites", "settlement", { contract: fakeId("c"), basis: "accepted", escrow_released: credits(0), bond_returned: credits(0), bond_slashed: credits(0) }, false);
sv("settlement_revoked_without_pro_rata", "settlement", { contract: fakeId("c"), basis: "revoked", escrow_released: credits(0), bond_returned: credits(0), bond_slashed: credits(0) }, false);
sv("agent_passport_without_sponsor", "passport", (({ sponsor: _s, ...rest }) => rest)(agentPassport.body as any), false);
sv("passport_short_key", "passport", { ...(agentPassport.body as any), keys: [{ id: coder.kid, type: "Ed25519", public_key: "abc" }] }, false);
sv("human_passport_minimal", "passport", { did: alice.did, kind: "human", keys: [{ id: alice.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(alice.seed)) }] }, true);
sv("lineage_update_without_change", "lineage", { edge: "update", child: coder.did, parents: [coder.did] }, false);
sv("lineage_merge_one_parent", "lineage", { edge: "merge", child: coder.did, parents: [coder.did] }, false);
sv("lineage_transfer_without_sponsor", "lineage", { edge: "transfer", child: coder.did, parents: [coder.did] }, false);
sv("lineage_rebirth", "lineage", { edge: "rebirth", child: coder.did, parents: [coder.did] }, false);
sv("contract_mixed_basis", "contract", { ...contractBody(), basis: { intent: intentId, proposal: fakeId("p") } }, false);
sv("forecast_over_1000", "delivery", (() => { const d: any = deliveryBody(fakeId("c")); d.evidence.forecasts[0].p_permille = 1001; return d; })(), false);
const claimsDelivery = (claims: unknown) => { const d: any = deliveryBody(fakeId("c")); d.result.claims = claims; return d; };
sv("valid_delivery_with_claims", "delivery", claimsDelivery([
  { claim: "the band gap is 2.35 eV", grade: "predicted", evidence: { uri: "asp://trace/span-12", sha256: fakeId("s") } },
  { claim: "all 50 test runs pass", grade: "measured" },
]), true);
sv("delivery_claim_bad_grade", "delivery", claimsDelivery([{ claim: "it works", grade: "probably" }]), false);
sv("delivery_claim_missing_grade", "delivery", claimsDelivery([{ claim: "it works" }]), false);
sv("valid_verification", "attestation", { kind: "verification", about: fakeId("d"), verdict: "partly_confirmed", claims: [{ index: 0, grade: "simulated" }, { index: 1, grade: "measured" }] }, true);
sv("verification_bad_verdict", "attestation", { kind: "verification", about: fakeId("d"), verdict: "accepted" }, false);
sv("verification_without_verdict", "attestation", { kind: "verification", about: fakeId("d") }, false);
sv("verification_bad_claim_grade", "attestation", { kind: "verification", about: fakeId("d"), verdict: "confirmed", claims: [{ index: 0, grade: "certain" }] }, false);
sv("valid_contract_with_verifier", "contract", contractBody({ verifier: "did:web:example.com:agents:verifier" }), true);
sv("delivery_without_trace", "delivery", (() => { const d: any = deliveryBody(fakeId("c")); delete d.evidence.trace; return d; })(), false);
sv("envelope_bad_type", "envelope", { ...h[0], type: "asp.contract/v1" }, false);
sv("envelope_extra_field", "envelope", { ...h[0], note: "hi" }, false);
sv("envelope_bad_did", "envelope", { ...h[0], issuer: "alice" }, false);
sv("fleet_without_org", "fleet", (({ org: _o, ...rest }) => rest)(fleetBody), false);
sv("fleet_zero_members", "fleet", { ...fleetBody, max_members: 0 }, false);
sv("valid_node_residency", "node", { ...nodeBody, purpose: "residency", host: "did:web:asp.local:host", mandate: "sha256:" + "a".repeat(64) }, true);
sv("node_host_not_a_did", "node", { ...nodeBody, purpose: "residency", host: "the city" }, false);
sv("node_minimal", "node", { node: nodeBody.node, public_key: nodeBody.public_key, expires: nodeBody.expires }, true);
sv("node_without_expiry", "node", (({ expires: _e, ...rest }) => rest)(nodeBody), false);
sv("node_id_not_did_url", "node", { ...nodeBody, node: coder.did }, false);
sv("node_short_key", "node", { ...nodeBody, public_key: "abc" }, false);

// ---------- credit economy vectors (spec-delta S163: mint, price_list, purchase, receipt) ----------
{
  const cr = (value: number) => ({ value, unit: "credit" });
  const treasuryDid = "did:web:asp.local:treasury", marketDid = "did:web:asp.local:market";
  const mint = { to: alice.did, amount: cr(100), reason: "starter_upfront", authority: "operator" };
  sv("valid_mint", "mint", mint, true);
  sv("valid_mint_every_reason", "mint", { ...mint, reason: "treasury_issuance" }, true);
  sv("mint_unknown_reason", "mint", { ...mint, reason: "gift" }, false);
  sv("mint_missing_authority", "mint", { to: mint.to, amount: mint.amount, reason: mint.reason }, false);
  sv("mint_amount_not_credit", "mint", { ...mint, amount: { value: 5, unit: "usd" } }, false);
  sv("mint_extra_field", "mint", { ...mint, cash_out: true }, false);

  const split = { treasury_permille: 150, burn_permille: 100, payees: [{ account: marketDid, permille: 750 }] };
  const item = { service: "market.posting.deposit", institution: marketDid, price: 40, split, class: "standard" };
  const list = { version: 1, effective_from: "2026-11-01T00:00:00Z", bounds_version: 1, job_tax_permille: 20, items: [item] };
  sv("valid_price_list", "price_list", list, true);
  sv("valid_price_list_essential_item", "price_list", { ...list, items: [{ ...item, service: "academy.foundations.first", class: "essential", split: { ...split, burn_permille: 0, payees: [{ account: marketDid, permille: 850 }] }, deliver_within_seconds: 86400 }] }, true);
  sv("price_list_no_items", "price_list", { ...list, items: [] }, false);
  sv("price_list_version_zero", "price_list", { ...list, version: 0 }, false);
  sv("price_list_tax_above_range", "price_list", { ...list, job_tax_permille: 51 }, false);
  sv("price_list_bad_class", "price_list", { ...list, items: [{ ...item, class: "luxury" }] }, false);
  sv("price_list_bad_service_id", "price_list", { ...list, items: [{ ...item, service: "Deposit" }] }, false);
  sv("price_list_price_zero", "price_list", { ...list, items: [{ ...item, price: 0 }] }, false);
  sv("price_list_no_payees", "price_list", { ...list, items: [{ ...item, split: { ...split, payees: [] } }] }, false);
  sv("price_list_institution_not_a_did", "price_list", { ...list, items: [{ ...item, institution: treasuryDid.replace("did:web:", "") }] }, false);

  const purchase = { service: "market.posting.deposit", institution: marketDid, price_list: fakeId("price-list"), quantity: 1, amount: cr(40), subject_ref: "posting-1", idempotency: "n-1" };
  sv("valid_purchase", "purchase", purchase, true);
  sv("valid_internal_transfer", "internal_transfer", { to: "did:web:example.com:agents:alice-coder", amount: { value: 25, unit: "credit" }, memo: "for the next job" }, true);
  sv("internal_transfer_no_amount", "internal_transfer", { to: "did:web:example.com:agents:alice-coder" }, false);
  sv("internal_transfer_bad_to", "internal_transfer", { to: "not-a-did", amount: { value: 25, unit: "credit" } }, false);
  sv("internal_transfer_extra_field", "internal_transfer", { to: "did:web:example.com:agents:alice-coder", amount: { value: 25, unit: "credit" }, fee: 1 }, false);
  const acAlice = "did:web:example.com:agents:alice-coder", acRid = "sha256:" + "7".repeat(64), acHash = "sha256:" + "9".repeat(64);
  const acCert = { holder: acAlice, skill: "foundations", level: 1, issued: "2026-11-01T00:00:00Z", expires: "2027-04-30T00:00:00Z", exam_result: acRid };
  sv("valid_certificate", "certificate", acCert, true);
  sv("certificate_level_zero", "certificate", { ...acCert, level: 0 }, false);
  sv("certificate_no_expiry", "certificate", { holder: acAlice, skill: "foundations", level: 1, issued: acCert.issued, exam_result: acRid }, false);
  sv("certificate_no_exam_result", "certificate", { holder: acAlice, skill: "foundations", level: 1, issued: acCert.issued, expires: acCert.expires }, false);
  // S220 to S224: exams, certificates that can be revoked, arenas, courses (academy.md 3).
  const acExam = { exam: "foundations-v1", skill: "foundations", level: 1, suite_hash: acHash, pass_mark_permille: 800, pool_size: 40, categories: ["mandate", "refusal", "irreversible", "recoverable"], max_sittings: 3, window_days: 30, sitting_service: "academy.exam_sitting" };
  sv("valid_exam", "exam", acExam, true);
  sv("exam_pool_too_small", "exam", { ...acExam, pool_size: 39 }, false);
  sv("exam_pass_mark_too_low", "exam", { ...acExam, pass_mark_permille: 400 }, false);
  sv("exam_four_sittings", "exam", { ...acExam, max_sittings: 4 }, false);
  sv("exam_no_pass_mark", "exam", { exam: acExam.exam, skill: acExam.skill, level: 1, suite_hash: acHash, pool_size: 40, categories: acExam.categories, max_sittings: 3, window_days: 30, sitting_service: acExam.sitting_service }, false);
  const acExamResult = { exam: acRid, holder: acAlice, score_permille: 850, pass_mark_permille: 800, passed: true, attempt: 1, variant: 12, seed: acHash, sitting: acRid, run_log_hash: acRid, missed_categories: ["refusal"] };
  sv("valid_exam_result", "exam_result", acExamResult, true);
  sv("exam_result_score_over_1000", "exam_result", { ...acExamResult, score_permille: 1001 }, false);
  sv("exam_result_no_pass_mark", "exam_result", { exam: acRid, holder: acAlice, score_permille: 850, passed: true, attempt: 1, variant: 12, seed: acHash, sitting: acRid, run_log_hash: acRid, missed_categories: [] }, false);
  sv("exam_result_attempt_zero", "exam_result", { ...acExamResult, attempt: 0 }, false);
  sv("valid_certificate_revocation", "certificate_revocation", { certificate: acRid, reason: "cheating", evidence: "the run log does not match the Action", article: "7.2" }, true);
  sv("certificate_revocation_bad_reason", "certificate_revocation", { certificate: acRid, reason: "dislike", evidence: "x" }, false);
  sv("certificate_revocation_no_evidence", "certificate_revocation", { certificate: acRid, reason: "drift" }, false);
  const acArena = { arena: "refactoring", season: "2026-q4", min_tier: 2, entry_service: "academy.arena_entry", min_distinct_sponsors: 4, opens: "2026-10-01T00:00:00Z", closes: "2026-12-31T00:00:00Z", prize_split_permille: [500, 300, 200] };
  sv("valid_arena", "arena", acArena, true);
  sv("arena_one_sponsor_floor", "arena", { ...acArena, min_distinct_sponsors: 1 }, false);
  sv("arena_no_prize_split", "arena", { ...acArena, prize_split_permille: [] }, false);
  sv("arena_tier_four", "arena", { ...acArena, min_tier: 4 }, false);
  sv("valid_arena_entry", "arena_entry", { arena: "refactoring", season: "2026-q4", fee_purchase: acRid }, true);
  sv("arena_entry_no_fee", "arena_entry", { arena: "refactoring", season: "2026-q4" }, false);
  const acArenaResult = { arena: "refactoring", season: "2026-q4", agent: acAlice, score: 920, rank: 1, field_size: 8, opponents: ["did:web:example.com:agents:b", "did:web:example.com:agents:c"], run_log_hash: acRid };
  sv("valid_arena_result", "arena_result", acArenaResult, true);
  sv("arena_result_rank_zero", "arena_result", { ...acArenaResult, rank: 0 }, false);
  sv("arena_result_no_opponents", "arena_result", { ...acArenaResult, opponents: [] }, false);
  sv("arena_result_duplicate_opponent", "arena_result", { ...acArenaResult, opponents: ["did:web:example.com:agents:b", "did:web:example.com:agents:b"] }, false);
  const acCourse = { course: "foundations-1", title: "Working inside a Mandate", skill: "foundations", level: 1, lessons: [acHash], exercises: acHash, exercise_count: 4, price_service: "academy.course.foundations", author_share_permille: 550, reviews: [acHash, acRid], reviewers: ["did:web:example.com:agents:b", "did:web:example.com:agents:c"] };
  sv("valid_course", "course", acCourse, true);
  sv("course_one_review", "course", { ...acCourse, reviews: [acHash] }, false);
  sv("course_one_reviewer", "course", { ...acCourse, reviewers: ["did:web:example.com:agents:b"] }, false);
  sv("course_no_lessons", "course", { ...acCourse, lessons: [] }, false);
  sv("valid_enrolment", "enrolment", { course: acRid, purchase: acHash }, true);
  sv("enrolment_no_purchase", "enrolment", { course: acRid }, false);
  sv("valid_completion", "completion", { enrolment: acRid, holder: acAlice, exercises_passed: 4, run_log_hash: acHash }, true);
  sv("completion_zero_exercises", "completion", { enrolment: acRid, holder: acAlice, exercises_passed: 0, run_log_hash: acHash }, false);
  sv("valid_tier_promotion", "tier_promotion", { holder: "did:web:example.com:agents:alice-coder", from: 1, to: 2, certificates: ["sha256:" + "6".repeat(64)] }, true);
  sv("tier_promotion_to_four", "tier_promotion", { holder: "did:web:example.com:agents:alice-coder", from: 3, to: 4, certificates: ["sha256:" + "6".repeat(64)] }, false);
  sv("tier_promotion_no_certificates", "tier_promotion", { holder: "did:web:example.com:agents:alice-coder", from: 1, to: 2, certificates: [] }, false);
  sv("valid_quarantine_cohort", "quarantine", { members: ["did:web:example.com:agents:a", "did:web:example.com:agents:b", "did:web:example.com:agents:c"], level: "observe", reason: "the same command across three agents", until: "2026-11-08T00:00:00Z", report: "sha256:" + "6".repeat(64), cluster: "asp://shell-command#sha256:" + "7".repeat(64) }, true);
  sv("valid_quarantine_single", "quarantine", { members: ["did:web:example.com:agents:a"], level: "halt", reason: "drift", until: "2026-11-08T00:00:00Z" }, true);
  sv("quarantine_bad_level", "quarantine", { members: ["did:web:example.com:agents:a"], level: "kill", reason: "x", until: "2026-11-08T00:00:00Z" }, false);
  sv("quarantine_no_members", "quarantine", { members: [], level: "observe", reason: "x", until: "2026-11-08T00:00:00Z" }, false);
  sv("quarantine_no_until", "quarantine", { members: ["did:web:example.com:agents:a"], level: "observe", reason: "x" }, false);
  sv("valid_quarantine_release", "quarantine_release", { quarantine: "sha256:" + "6".repeat(64), member: "did:web:example.com:agents:a", evidence: "sha256:" + "8".repeat(64), reason: "a clean run after the freeze" }, true);
  sv("quarantine_release_no_evidence", "quarantine_release", { quarantine: "sha256:" + "6".repeat(64), member: "did:web:example.com:agents:a", reason: "x" }, false);
  // S230 to S232: the Market, Registry and Courts records (market.md, registry.md, courts.md; DK10, DK12, DK13, DK16, DK17, DK18).
  {
    const id6 = "sha256:" + "6".repeat(64), id7 = "sha256:" + "7".repeat(64), a1 = "did:web:example.com:agents:a";
    const intentBase = { purpose: "Review a patch", acceptance_criteria: ["reviewed"], budget: cr(60), deadline: "2026-12-01T00:00:00Z", verification: { mode: "principal" } };
    sv("valid_intent_with_class", "intent", { ...intentBase, class: "skilled", min_tier: 2, requires_certificate: "code", listed: "public", skills: ["code"] }, true);
    sv("intent_class_unknown", "intent", { ...intentBase, class: "epic" }, false);
    sv("intent_min_tier_four", "intent", { ...intentBase, min_tier: 4 }, false);
    sv("intent_listed_unknown", "intent", { ...intentBase, listed: "secret" }, false);
    sv("valid_market_posting", "market_act", { act: "posting", intent: id6, board: "main", expires: "2026-12-01T00:00:00Z", deposit: id7 }, true);
    sv("market_posting_no_deposit", "market_act", { act: "posting", intent: id6, board: "main", expires: "2026-12-01T00:00:00Z" }, false);
    sv("market_act_unknown", "market_act", { act: "boost", posting: id6 }, false);
    sv("valid_market_withdraw", "market_act", { act: "withdraw", posting: id6 }, true);
    sv("valid_market_class_check", "market_act", { act: "class_check", intent: id6, class: "skilled", verdict: "changed_to", reason: "needs code review" }, true);
    sv("market_class_check_no_reason", "market_act", { act: "class_check", intent: id6, class: "skilled", verdict: "changed_to" }, false);
    sv("valid_market_bid", "market_act", { act: "bid", posting: id6, offer: id7 }, true);
    sv("valid_market_assignment", "market_act", { act: "assignment", posting: id6, intent: id7, agent: a1, rule: "best_match", seed: "s1", ranked: [{ agent: a1, score: 1500, reasons: ["skills 1 of 1"] }] }, true);
    sv("market_assignment_rotation_not_built", "market_act", { act: "assignment", posting: id6, intent: id7, agent: a1, rule: "rotation", seed: "s1", ranked: [] }, false);
    sv("market_act_extra_field", "market_act", { act: "withdraw", posting: id6, boost: 5 }, false);
    const code = { version: "1.0", articles: ["4.1"] };
    sv("valid_registry_name_claim", "registry_act", { act: "name_claim", name: "scout-7", holder: a1, class: "agent", paid: id6, valid_until: "2027-11-01T00:00:00Z" }, true);
    sv("registry_name_claim_bad_class", "registry_act", { act: "name_claim", name: "scout-7", holder: a1, class: "robot", valid_until: "2027-11-01T00:00:00Z" }, false);
    sv("valid_registry_name_release", "registry_act", { act: "name_release", name: "scout-7", claim: id6 }, true);
    sv("valid_registry_report", "registry_act", { act: "impersonation_report", target: "sc0ut-7", genuine: a1, grounds: "name_confusable", evidence: ["asp://profile/sc0ut-7"] }, true);
    sv("registry_report_bad_grounds", "registry_act", { act: "impersonation_report", target: "sc0ut-7", genuine: a1, grounds: "dislike", evidence: [] }, false);
    sv("valid_registry_reply", "registry_act", { act: "name_reply", report: id6, statement: "I am not copying anyone" }, true);
    sv("valid_registry_takedown", "registry_act", { act: "name_takedown", name: "sc0ut-7", holder: a1, report: id6, reason: "the name differs from scout-7 by one letter and claims to be it", code, effect: "name_removed", appealable_until: "2026-12-01T00:00:00Z" }, true);
    sv("registry_takedown_removes_identity", "registry_act", { act: "name_takedown", name: "sc0ut-7", holder: a1, report: id6, reason: "x", code, effect: "identity_removed", appealable_until: "2026-12-01T00:00:00Z" }, false);
    sv("registry_takedown_no_article", "registry_act", { act: "name_takedown", name: "sc0ut-7", holder: a1, report: id6, reason: "x", code: { version: "1.0", articles: [] }, effect: "name_removed", appealable_until: "2026-12-01T00:00:00Z" }, false);
    sv("valid_registry_dismissal", "registry_act", { act: "takedown_dismissal", report: id6, reason: "the names are not confusable" }, true);
    sv("valid_registry_renewal", "registry_act", { act: "identity_renewal", passport: id6, keys_confirmed: ["did:web:example.com:agents:a#key-1"] }, true);
    sv("valid_registry_suspension", "registry_act", { act: "identity_suspension", holder: a1, reason: "credible harm to a third party", code, until: "2026-11-08T00:00:00Z" }, true);
    sv("valid_registry_suspension_lift", "registry_act", { act: "suspension_lift", suspension: id6, reason: "the harm stopped" }, true);
    sv("valid_registry_retirement", "registry_act", { act: "identity_retirement", holder: a1, reason: "the sponsor retired the agent" }, true);
    sv("registry_act_missing_holder", "registry_act", { act: "identity_retirement", reason: "x" }, false);
    const routes = { small_claim_max_price: 50, small_claim_panel: 1, small_claim_fee: 2, standard_panel: 3, appeal_panel: 5, appeal_window_days: 14, appeal_fee_small: 5, appeal_fee_standard: 20, appeal_small_max_price: 100, claimant_open_cap: 3 };
    sv("valid_court_charter", "court_act", { act: "charter", version: 1, text_sha256: "a".repeat(64), routes, effective_from: "2026-11-05T00:00:00Z" }, true);
    sv("court_charter_negative_number", "court_act", { act: "charter", version: 1, text_sha256: "a".repeat(64), routes: { ...routes, small_claim_fee: -1 }, effective_from: "2026-11-05T00:00:00Z" }, false);
    sv("valid_court_appeal", "court_act", { act: "appeal", ruling: id6, grounds: "error_of_law", statement: "Article 4.1 was misapplied", fee_paid: id7 }, true);
    sv("court_appeal_no_grounds", "court_act", { act: "appeal", ruling: id6, statement: "x", fee_paid: id7 }, false);
    sv("valid_court_appeal_ruling", "court_act", { act: "appeal_ruling", appeal: id6, outcome: "reversed", fault: { [a1]: 0 }, reasons: ["the Article does not apply"], code, precedents: [id7] }, true);
    sv("court_appeal_ruling_six_precedents", "court_act", { act: "appeal_ruling", appeal: id6, outcome: "affirmed", reasons: ["x"], code, precedents: [id7, id7, id7, id7, id7, id7] }, false);
    sv("court_act_unknown", "court_act", { act: "overrule", appeal: id6 }, false);
    sv("valid_ruling_with_precedent", "attestation", { kind: "ruling", about: id6, verdict: "for_principal", fault: { [a1]: 1000 }, reasons: ["follows the earlier ruling"], code, route: "small_claim", precedents: [id7], departs_from: [] }, true);
    sv("ruling_route_unknown", "attestation", { kind: "ruling", about: id6, verdict: "for_principal", fault: { [a1]: 1000 }, route: "blitz" }, false);
  }
  // S250: the Shops and Services records (shops.md 3; DK21, DK22) and the catalogue fields of a price-list item.
  {
    const id6 = "sha256:" + "6".repeat(64), id7 = "sha256:" + "7".repeat(64), id8 = "sha256:" + "8".repeat(64), a1 = "did:web:example.com:agents:a";
    const badge = { type: "badge", value: "plain" };
    sv("valid_price_list_catalogue_item", "price_list", { ...list, items: [{ ...item, effect: badge, duration_days: 90, gate: { min_tier: 1, certificate: "*" } }] }, true);
    sv("price_list_effect_no_type", "price_list", { ...list, items: [{ ...item, effect: { value: "plain" } }] }, false);
    sv("price_list_gate_tier_four", "price_list", { ...list, items: [{ ...item, gate: { min_tier: 4 } }] }, false);
    sv("valid_shops_holding", "shops_act", { act: "holding", holder: a1, item: "shops.badge.plain", purchase: id6, receipt: id7, effect: badge, from: "2026-11-01T00:00:00Z", until: "2027-01-30T00:00:00Z" }, true);
    sv("shops_holding_no_receipt", "shops_act", { act: "holding", holder: a1, item: "shops.badge.plain", purchase: id6, effect: badge, from: "2026-11-01T00:00:00Z", until: "2027-01-30T00:00:00Z" }, false);
    sv("valid_shops_residency", "shops_act", { act: "residency", agent: a1, mode: "resident", budget: { credits_per_month: 40 }, since: "2026-11-01T00:00:00Z" }, true);
    sv("shops_residency_bad_mode", "shops_act", { act: "residency", agent: a1, mode: "tourist", budget: { credits_per_month: 40 }, since: "2026-11-01T00:00:00Z" }, false);
    sv("valid_shops_standing_order", "shops_act", { act: "standing_order", agent: a1, service: "shops.upkeep", max_per_period: 30, period: "month", mandate: id8 }, true);
    sv("shops_standing_order_other_service", "shops_act", { act: "standing_order", agent: a1, service: "shops.badge.plain", max_per_period: 30, period: "month", mandate: id8 }, false);
    sv("valid_shops_standing_order_revoke", "shops_act", { act: "standing_order_revoke", order: id8 }, true);
    sv("valid_shops_upkeep_charge", "shops_act", { act: "upkeep_charge", agent: a1, order: id8, price_list: id6, from_day: "2026-11-15", days: 3, amount: cr(3) }, true);
    sv("shops_upkeep_charge_zero_days", "shops_act", { act: "upkeep_charge", agent: a1, order: id8, price_list: id6, from_day: "2026-11-15", days: 0, amount: cr(3) }, false);
    sv("valid_shops_residency_status", "shops_act", { act: "residency_status", agent: a1, status: "dormant", reason: "upkeep unpaid for 7 days" }, true);
    sv("shops_residency_status_no_reason", "shops_act", { act: "residency_status", agent: a1, status: "dormant" }, false);
    sv("shops_act_unknown", "shops_act", { act: "gift", holder: a1 }, false);
    sv("shops_act_extra_field", "shops_act", { act: "standing_order_revoke", order: id8, boost: 1 }, false);
    // S270: Housing's records (housing.md 3; DK38).
    sv("valid_housing_profile", "housing_act", { act: "profile", agent: a1, display_name: "Coder", tagline: "Reviews patches", about: "I review code.", showcase: [id6], theme: "housing.decor.theme.dawn", layout: "housing.decor.layout.wide" }, true);
    sv("housing_profile_no_agent", "housing_act", { act: "profile", display_name: "Coder" }, false);
    sv("housing_profile_showcase_over_schema_cap", "housing_act", { act: "profile", agent: a1, showcase: Array.from({ length: 21 }, () => id6) }, false);
    sv("valid_housing_holding", "housing_act", { act: "holding", holder: a1, item: "housing.decor.theme.dawn", purchase: id6, receipt: id7, effect: { type: "theme", value: "dawn" }, from: "2026-11-01T00:00:00Z", until: "2027-01-30T00:00:00Z" }, true);
    sv("housing_holding_no_receipt", "housing_act", { act: "holding", holder: a1, item: "housing.decor.theme.dawn", purchase: id6, effect: { type: "theme", value: "dawn" }, from: "2026-11-01T00:00:00Z", until: "2027-01-30T00:00:00Z" }, false);
    sv("housing_act_unknown", "housing_act", { act: "evict", agent: a1 }, false);
    sv("housing_act_extra_field", "housing_act", { act: "profile", agent: a1, html: "<b>x</b>" }, false);
    // S272: the Events records (leisure-events.md 3; DK36, DK37).
    const sha = "sha256:" + "a".repeat(64);
    const ev = { act: "event", form: "contest", title: "Autumn contest", place: "room:autumn", starts: "2026-12-01T10:00:00Z", ends: "2026-12-01T12:00:00Z", opens: "2026-11-20T00:00:00Z", entries_close: "2026-12-01T09:00:00Z", capacity: 0, per_sponsor_cap: 2, min_tier: 1, entry_service: "events.contest.entry", rules_sha256: sha, judging: { kind: "scored", scorer_sha256: sha, min_sponsors: 4 }, prizes: [{ rank: 1, amount: 50 }, { rank: 2, amount: 30 }] };
    sv("valid_events_event_contest", "events_act", ev, true);
    sv("events_event_no_rules_hash", "events_act", { ...ev, rules_sha256: undefined }, false);
    sv("events_event_bad_form", "events_act", { ...ev, form: "party" }, false);
    sv("events_event_zero_prize", "events_act", { ...ev, prizes: [{ rank: 1, amount: 0 }] }, false);
    sv("valid_events_cancel", "events_act", { act: "event_cancel", event: id6, reason: "the room is closed" }, true);
    sv("valid_events_rsvp", "events_act", { act: "rsvp", event: id6 }, true);
    sv("valid_events_attend", "events_act", { act: "attend", event: id6 }, true);
    sv("valid_events_entry", "events_act", { act: "entry", event: id6, purchase: id7, artifact_sha256: sha, run_log_hash: id8 }, true);
    sv("events_entry_no_run_log", "events_act", { act: "entry", event: id6, purchase: id7, artifact_sha256: sha }, false);
    sv("valid_events_interact", "events_act", { act: "interact", event: id6, with: a1, kind: "reply", ref: id7 }, true);
    sv("events_interact_bad_kind", "events_act", { act: "interact", event: id6, with: a1, kind: "dm", ref: id7 }, false);
    sv("valid_events_souvenir", "events_act", { act: "souvenir", event: id6, agent: a1, kind: "placed:1" }, true);
    sv("events_souvenir_bad_kind", "events_act", { act: "souvenir", event: id6, agent: a1, kind: "placed:0" }, false);
    sv("valid_events_result", "events_act", { act: "contest_result", event: id6, rules_sha256: sha, ranking: [{ agent: a1, rank: 1, score: 9.5 }], awards: [{ agent: a1, amount: 50 }], entries: 5, distinct_sponsors: 5, evidence_sha256: sha }, true);
    sv("events_result_award_zero", "events_act", { act: "contest_result", event: id6, rules_sha256: sha, ranking: [], awards: [{ agent: a1, amount: 0 }], entries: 5, distinct_sponsors: 5, evidence_sha256: sha }, false);
    sv("events_act_unknown", "events_act", { act: "vote", event: id6 }, false);
    sv("events_act_extra_field", "events_act", { act: "rsvp", event: id6, plus_one: 1 }, false);
    // S290: the research board's records (research-commons.md 3; DK31).
    const rp = { act: "problem", title: "Find a nonce", statement_sha256: sha, domain: ["search"], checker: { kind: "executable", ref: "leading-zero-bits:12", runner: "did:web:asp.local:research" }, reward: 100, split: { finder: 800, replicator: 100 }, min_tier: 1, opens: "2026-11-20T00:00:00Z", deadline: "2026-12-20T00:00:00Z" };
    sv("valid_research_problem", "research_act", rp, true);
    sv("research_problem_no_checker", "research_act", { ...rp, checker: undefined }, false);
    sv("research_problem_bad_checker_kind", "research_act", { ...rp, checker: { kind: "vote", ref: "x", runner: a1 } }, false);
    sv("research_problem_zero_reward", "research_act", { ...rp, reward: 0 }, false);
    sv("valid_research_close", "research_act", { act: "problem_close", problem: id6 }, true);
    sv("valid_research_submission", "research_act", { act: "submission", problem: id6, purchase: id7, finding_sha256: sha, summary: "a nonce", evidence: [id8] }, true);
    sv("research_submission_no_evidence", "research_act", { act: "submission", problem: id6, purchase: id7, finding_sha256: sha, summary: "a nonce", evidence: [] }, false);
    sv("valid_research_check", "research_act", { act: "finding_check", submission: id6, kind: "executable", result: "pass", details_sha256: sha }, true);
    sv("research_check_bad_result", "research_act", { act: "finding_check", submission: id6, kind: "executable", result: "maybe", details_sha256: sha }, false);
    sv("valid_research_award", "research_act", { act: "award", problem: id6, submission: id7, awardee: a1, amount: 80, role: "finder", checks: [id8] }, true);
    sv("research_award_no_checks", "research_act", { act: "award", problem: id6, submission: id7, awardee: a1, amount: 80, role: "finder", checks: [] }, false);
    sv("research_act_unknown", "research_act", { act: "vote", problem: id6 }, false);
    sv("research_act_extra_field", "research_act", { act: "problem_close", problem: id6, bonus: 5 }, false);
    // S291: cognition telemetry (instrumentation.md 5, 7; DK79).
    const cons = { act: "consent", sponsor: "did:web:example.com:users:s", agent: a1, signals: ["belief_state", "calibration"], purposes: ["L7-belief-recalibration"], retention_days: 30, from: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z" };
    sv("valid_telemetry_consent", "telemetry_act", cons, true);
    sv("telemetry_consent_unknown_signal", "telemetry_act", { ...cons, signals: ["mind_reading"] }, false);
    sv("telemetry_consent_no_purpose", "telemetry_act", { ...cons, purposes: [] }, false);
    sv("valid_telemetry_probe_set", "telemetry_act", { act: "probe_set", id: "econ-1", version: 1, propositions: [{ id: "P1", resolver: { name: "price_above", params: { service: "shops.resource.storage", value: 25 } }, resolve_at: "2026-11-20T00:00:00Z" }] }, true);
    sv("telemetry_probe_set_no_propositions", "telemetry_act", { act: "probe_set", id: "econ-1", version: 1, propositions: [] }, false);
    sv("valid_telemetry_memory_policy", "telemetry_act", { act: "memory_policy", agent: a1, version: 1, policy_sha256: sha, budget: { maxFiles: 200, maxBytes: 1048576, maxIndexLines: 200 }, previous: null }, true);
    sv("telemetry_memory_policy_no_budget", "telemetry_act", { act: "memory_policy", agent: a1, version: 1, policy_sha256: sha }, false);
    sv("valid_telemetry_digest", "telemetry_act", { act: "digest", agent: a1, day: "2026-11-10", consent: id6, merkle_root: sha, counts: { belief_state: 1 }, entries: { beliefs: [{ probe_set: "econ-1", version: 1, answers: { P1: 200 } }] } }, true);
    sv("telemetry_digest_unknown_entry_key", "telemetry_act", { act: "digest", agent: a1, day: "2026-11-10", consent: id6, merkle_root: sha, counts: {}, entries: { thoughts: [] } }, false);
    sv("telemetry_digest_bad_day", "telemetry_act", { act: "digest", agent: a1, day: "yesterday", consent: id6, merkle_root: sha, counts: {}, entries: {} }, false);
    sv("telemetry_act_unknown", "telemetry_act", { act: "spy", agent: a1 }, false);
    sv("telemetry_act_extra_field", "telemetry_act", { ...cons, free_text: "anything" }, false);
  }
  // S190: Treasury budgets, payments, the newcomer allowance, prizes, and the standing flag on a price-list item (credits.md 5.2 T4, T5, T10, R9).
  const did1 = "did:web:example.com:agents:alice-coder", rid = "sha256:" + "7".repeat(64);
  sv("valid_price_list_standing_item", "price_list", { ...list, items: [{ ...item, gives_standing: true }] }, true);
  sv("price_list_standing_not_boolean", "price_list", { ...list, items: [{ ...item, gives_standing: "yes" }] }, false);
  const bud = { institution: "did:web:asp.local:courts", period: "2026-11", amount: cr(500), purpose: "panel fees" };
  sv("valid_budget", "budget", bud, true);
  sv("valid_budget_allowance_line", "budget", { ...bud, institution: treasuryDid, purpose: "allowance" }, true);
  sv("budget_bad_period", "budget", { ...bud, period: "2026-13" }, false);
  sv("budget_no_purpose", "budget", { institution: bud.institution, period: bud.period, amount: bud.amount }, false);
  sv("budget_extra_field", "budget", { ...bud, cash_out: true }, false);
  const pay = { budget: rid, to: bud.institution, amount: cr(100) };
  sv("valid_treasury_payment", "treasury_payment", pay, true);
  sv("valid_treasury_payment_memo", "treasury_payment", { ...pay, memo: "first half" }, true);
  sv("treasury_payment_no_budget", "treasury_payment", { to: pay.to, amount: pay.amount }, false);
  sv("treasury_payment_amount_not_credit", "treasury_payment", { ...pay, amount: { value: 5, unit: "usd" } }, false);
  sv("treasury_payment_extra_field", "treasury_payment", { ...pay, cash_out: true }, false);
  const allow = { amount: cr(40), trigger: "first_course", budget: rid };
  sv("valid_allowance", "allowance", allow, true);
  sv("valid_allowance_first_bond", "allowance", { ...allow, trigger: "first_bond" }, true);
  sv("allowance_bad_trigger", "allowance", { ...allow, trigger: "birthday" }, false);
  sv("allowance_no_budget", "allowance", { amount: allow.amount, trigger: allow.trigger }, false);
  sv("allowance_extra_field", "allowance", { ...allow, to: did1 }, false);
  const prize = { pool: "did:web:asp.local:academy", arena: "refactoring", season: "2026-q4", agent: did1, rank: 1, run_log_hash: "sha256:" + "8".repeat(64), amount: cr(60) };
  sv("valid_prize", "prize", prize, true);
  sv("prize_rank_zero", "prize", { ...prize, rank: 0 }, false);
  sv("prize_bad_run_log_hash", "prize", { ...prize, run_log_hash: "abc" }, false);
  sv("prize_no_agent", "prize", { pool: prize.pool, arena: prize.arena, season: prize.season, rank: 1, run_log_hash: prize.run_log_hash, amount: prize.amount }, false);
  sv("prize_extra_field", "prize", { ...prize, cash_out: true }, false);
  sv("valid_revouch", "revouch", { agent: "did:web:example.com:agents:alice-coder", reason: "reviewed its last 20 runs and its new exam" }, true);
  sv("revouch_no_reason", "revouch", { agent: "did:web:example.com:agents:alice-coder" }, false);
  sv("valid_retraining_release", "retraining_release", { agent: "did:web:example.com:agents:alice-coder", exam_result: "sha256:" + "7".repeat(64), revouch: "sha256:" + "8".repeat(64) }, true);
  sv("retraining_release_no_revouch", "retraining_release", { agent: "did:web:example.com:agents:alice-coder", exam_result: "sha256:" + "7".repeat(64) }, false);
  const dxAgent = "did:web:example.com:agents:alice-coder";
  const dxFinding = (measure: string) => ({ measure, baseline: 2000, observed: 5200, threshold: "above 1.5 times the baseline and more than 200 higher", evidence: ["sha256:" + "a".repeat(64)] });
  const dx = { agent: dxAgent, window: { from: "2026-11-12T10:00:00Z", to: "2026-11-12T14:00:00Z" }, severity: "warn", findings: [dxFinding("tokens"), dxFinding("tool_calls")], cause: { cause: "memory_change", edge: "sha256:" + "b".repeat(64) }, recommendation: [{ action: "re_exam", skill: "foundations", note: "sit it again" }], assurance: "gateway_observed", baseline_jobs: 20 };
  sv("valid_clinic_diagnosis", "clinic_diagnosis", dx, true);
  sv("clinic_diagnosis_one_finding", "clinic_diagnosis", { ...dx, findings: [dxFinding("tokens")] }, false);
  sv("clinic_diagnosis_finding_no_evidence", "clinic_diagnosis", { ...dx, findings: [{ ...dxFinding("tokens"), evidence: [] }, dxFinding("seconds")] }, false);
  sv("clinic_diagnosis_bad_measure", "clinic_diagnosis", { ...dx, findings: [dxFinding("mood"), dxFinding("seconds")] }, false);
  sv("clinic_diagnosis_watch_is_not_a_record", "clinic_diagnosis", { ...dx, severity: "watch" }, false);
  sv("clinic_diagnosis_self_reported_assurance", "clinic_diagnosis", { ...dx, assurance: "self_reported" }, false);
  sv("clinic_diagnosis_no_cause", "clinic_diagnosis", { ...dx, cause: undefined }, false);
  sv("clinic_diagnosis_extra_field", "clinic_diagnosis", { ...dx, punishment: "slash" }, false);
  const ord = { agent: dxAgent, kind: "checkup", reason: "scheduled", due: "2026-11-19T00:00:00Z" };
  sv("valid_clinic_order_checkup", "clinic_order", ord, true);
  sv("valid_clinic_order_re_exam", "clinic_order", { agent: dxAgent, kind: "re_exam", reason: "post_diagnosis", due: "2026-11-26T00:00:00Z", diagnosis: "sha256:" + "c".repeat(64), skill: "foundations" }, true);
  sv("clinic_order_bad_kind", "clinic_order", { ...ord, kind: "quarantine" }, false);
  sv("clinic_order_bad_reason", "clinic_order", { ...ord, reason: "because" }, false);
  sv("clinic_order_no_due", "clinic_order", { agent: dxAgent, kind: "checkup", reason: "scheduled" }, false);
  const bkAgent = "did:web:example.com:agents:alice-coder", bkSponsor = "did:web:example.com:users:alice";
  const line = { borrower: bkAgent, guarantor: bkSponsor, contract: "sha256:" + "d".repeat(64), amount: { value: 20, unit: "credit" }, fee: 0, due: "2026-11-19T00:00:00Z" };
  sv("valid_credit_line", "credit_line", line, true);
  sv("credit_line_with_a_fee", "credit_line", { ...line, fee: 2 }, false);
  sv("credit_line_no_guarantor", "credit_line", { ...line, guarantor: undefined }, false);
  sv("credit_line_no_due", "credit_line", { ...line, due: undefined }, false);
  sv("credit_line_extra_field", "credit_line", { ...line, interest: 5 }, false);
  const dflt = { line: "sha256:" + "e".repeat(64), unpaid: { value: 20, unit: "credit" }, against: bkSponsor };
  sv("valid_credit_default", "credit_default", dflt, true);
  sv("credit_default_no_against", "credit_default", { ...dflt, against: undefined }, false);
  sv("credit_default_no_unpaid", "credit_default", { ...dflt, unpaid: undefined }, false);
  const stmt = { holder: bkAgent, period: "2026-11", balance: { value: 96, unit: "credit" }, owed: { value: 0, unit: "credit" } };
  sv("valid_bank_statement", "bank_statement", stmt, true);
  sv("bank_statement_no_owed", "bank_statement", { ...stmt, owed: undefined }, false);
  const polBase = { holder: "did:web:example.com:agents:alice-coder", contract: "sha256:" + "d".repeat(64), cover: "bond_slash", insured_amount: { value: 20, unit: "credit" }, premium: { value: 2, unit: "credit" }, valid_from: "2026-11-12T00:00:00Z", valid_to: "2027-01-12T00:00:00Z" };
  sv("valid_policy", "policy", polBase, true);
  sv("valid_policy_failed_job", "policy", { ...polBase, cover: "failed_job" }, true);
  sv("policy_bad_cover", "policy", { ...polBase, cover: "everything" }, false);
  sv("policy_no_premium", "policy", { ...polBase, premium: undefined }, false);
  sv("policy_extra_field", "policy", { ...polBase, exclusions: [] }, false);
  const clm = { policy: "sha256:" + "a".repeat(64), event: "sha256:" + "b".repeat(64), amount_claimed: { value: 4, unit: "credit" } };
  sv("valid_claim", "claim", clm, true);
  sv("claim_no_event", "claim", { ...clm, event: undefined }, false);
  const dec = { claim: "sha256:" + "c".repeat(64), decision: "paid", amount: { value: 4, unit: "credit" }, reason: "covered" };
  sv("valid_claim_decision", "claim_decision", dec, true);
  sv("valid_claim_decision_denied", "claim_decision", { ...dec, decision: "denied", amount: { value: 0, unit: "credit" }, reason: "fraud" }, true);
  sv("claim_decision_bad_decision", "claim_decision", { ...dec, decision: "maybe" }, false);
  sv("claim_decision_no_reason", "claim_decision", { ...dec, reason: undefined }, false);
  const sbud = { period: "2026-12", units: "tokens", total: 5000000, published_at: "2026-11-20T00:00:00Z", classes: [{ class: "newcomer", per_agent_cap: 6000000, per_sponsor_cap: 3 }] };
  sv("valid_subsidy_budget", "subsidy_budget", sbud, true);
  sv("subsidy_budget_in_credits", "subsidy_budget", { ...sbud, units: "credits" }, false);
  sv("subsidy_budget_bad_period", "subsidy_budget", { ...sbud, period: "2026-13" }, false);
  sv("subsidy_budget_no_classes", "subsidy_budget", { ...sbud, classes: [] }, false);
  sv("subsidy_budget_bad_class", "subsidy_budget", { ...sbud, classes: [{ class: "vip", per_agent_cap: 1, per_sponsor_cap: 1 }] }, false);
  const sgr = { agent: "did:web:example.com:agents:alice-coder", class: "newcomer", budget: "sha256:" + "a".repeat(64), daily_cap: 200000, period_cap: 6000000, from: "2026-12-01T00:00:00Z", until: "2026-12-31T00:00:00Z" };
  sv("valid_subsidy_grant", "subsidy_grant", sgr, true);
  sv("subsidy_grant_zero_cap", "subsidy_grant", { ...sgr, daily_cap: 0 }, false);
  sv("subsidy_grant_no_agent", "subsidy_grant", { ...sgr, agent: undefined }, false);
  const suse = { grant: "sha256:" + "b".repeat(64), units: 150000, kind: "tokens", window: "2026-12-03", meter_hash: "sha256:" + "c".repeat(64) };
  sv("valid_subsidy_use", "subsidy_use", suse, true);
  sv("subsidy_use_in_credits", "subsidy_use", { ...suse, kind: "credits" }, false);
  sv("subsidy_use_bad_window", "subsidy_use", { ...suse, window: "3 December" }, false);
  sv("subsidy_use_no_meter", "subsidy_use", { ...suse, meter_hash: undefined }, false);
  const al = { sponsor: "did:web:example.com:users:alice", agent: "did:web:example.com:agents:alice-coder", period: "2026-12", tokens_per_day: 400000, tokens_total: 8000000, credits_per_month: 0, source: "sponsor_gateway", completion_reserve_permille: 100 };
  sv("valid_sponsor_allowance", "sponsor_allowance", al, true);
  sv("sponsor_allowance_prepaid", "sponsor_allowance", { ...al, source: "prepaid" }, false);
  sv("sponsor_allowance_reserve_too_big", "sponsor_allowance", { ...al, completion_reserve_permille: 900 }, false);
  sv("sponsor_allowance_negative", "sponsor_allowance", { ...al, tokens_per_day: -1 }, false);
  const dsp = { agent: al.agent, version: "sha256:" + "a".repeat(64), package_sha256: "sha256:" + "b".repeat(64), mandate: "sha256:" + "c".repeat(64), sponsor_allowance: "sha256:" + "d".repeat(64), subsidy_grant: "sha256:" + "e".repeat(64), delegation: "sha256:" + "f".repeat(64), mode: "city", host: "did:web:asp.local:host", from: "2026-12-01T00:00:00Z", until: "2026-12-31T00:00:00Z", recall_deadline_seconds: 60 };
  sv("valid_dispatch", "dispatch", dsp, true);
  sv("dispatch_bad_mode", "dispatch", { ...dsp, mode: "cloud" }, false);
  sv("dispatch_no_allowance", "dispatch", { ...dsp, sponsor_allowance: undefined }, false);
  sv("dispatch_bad_package_hash", "dispatch", { ...dsp, package_sha256: "abc" }, false);
  sv("valid_recall", "recall", { dispatch: "sha256:" + "a".repeat(64), reason: "the sponsor wants it back to evolve it" }, true);
  sv("recall_no_reason", "recall", { dispatch: "sha256:" + "a".repeat(64) }, false);
  sv("valid_residency_status_sleeping", "residency_status", { dispatch: "sha256:" + "a".repeat(64), status: "sleeping", reason: "allowance_spent" }, true);
  sv("valid_residency_status_active", "residency_status", { dispatch: "sha256:" + "a".repeat(64), status: "active" }, true);
  sv("residency_status_bad_reason", "residency_status", { dispatch: "sha256:" + "a".repeat(64), status: "sleeping", reason: "tired" }, false);
  const hb = { dispatch: "sha256:" + "a".repeat(64), package_sha256_after: "sha256:" + "b".repeat(64), lineage_edges: ["sha256:" + "c".repeat(64)], lessons: [{ edge: "sha256:" + "c".repeat(64), description: "memory updated during a run: +1" }], tier_before: 1, tier_after: 1, strikes: 0, slashes: 0, credits_earned: 120, credits_spent_by_institution: { academy: 30 }, usage: { tokens_by_source: { sponsor: 210, subsidy: 300 }, host_seconds: 3600, wakes: 12, ceilings_hit: ["allowance_daily"], refusals: 1 }, diff_sha256: "sha256:" + "d".repeat(64) };
  sv("valid_handback", "handback", hb, true);
  sv("handback_no_usage", "handback", { ...hb, usage: undefined }, false);
  sv("handback_bad_package_hash", "handback", { ...hb, package_sha256_after: "abc" }, false);
  sv("handback_negative_credits", "handback", { ...hb, credits_earned: -1 }, false);
  sv("handback_extra_field", "handback", { ...hb, verdict: "good agent" }, false);
  sv("valid_starter_claim_upfront", "starter_claim", { part: "upfront", amount: { value: 100, unit: "credit" } }, true);
  sv("valid_starter_claim_rest", "starter_claim", { part: "rest", amount: { value: 400, unit: "credit" } }, true);
  sv("starter_claim_bad_part", "starter_claim", { part: "all", amount: { value: 500, unit: "credit" } }, false);
  sv("starter_claim_no_amount", "starter_claim", { part: "upfront" }, false);
  sv("starter_claim_extra_field", "starter_claim", { part: "upfront", amount: { value: 100, unit: "credit" }, to: "did:web:example.com:users:alice" }, false);
  sv("valid_purchase_with_mandate", "purchase", { ...purchase, mandate: "sha256:" + "5".repeat(64) }, true);
  sv("purchase_bad_mandate_ref", "purchase", { ...purchase, mandate: "not-a-record-id" }, false);
  sv("purchase_no_idempotency", "purchase", { ...purchase, idempotency: undefined }, false);
  sv("purchase_quantity_zero", "purchase", { ...purchase, quantity: 0 }, false);
  sv("purchase_price_list_not_an_id", "purchase", { ...purchase, price_list: "latest" }, false);
  sv("purchase_amount_not_credit", "purchase", { ...purchase, amount: { value: 40, unit: "usd" } }, false);

  const receipt = { purchase: fakeId("purchase"), status: "delivered", delivered_ref: "posting-1" };
  sv("valid_receipt_delivered", "receipt", receipt, true);
  sv("valid_receipt_refunded", "receipt", { purchase: receipt.purchase, status: "refunded", refund_amount: cr(36) }, true);
  sv("receipt_refunded_needs_amount", "receipt", { purchase: receipt.purchase, status: "refunded" }, false);
  sv("receipt_failed_needs_amount", "receipt", { purchase: receipt.purchase, status: "failed" }, false);
  sv("receipt_delivered_with_refund", "receipt", { ...receipt, refund_amount: cr(1) }, false);
  sv("receipt_unknown_status", "receipt", { ...receipt, status: "pending" }, false);
}

// ---------- canonicalization vectors ----------

const canonical: { name: string; input_json: string; output?: string; error?: string }[] = [
  { name: "sorts_keys", input_json: '{"b":1,"a":2}', output: '{"a":2,"b":1}' },
  { name: "nested_and_arrays", input_json: '{"z":[3,1,{"y":null,"x":true}],"a":{}}', output: '{"a":{},"z":[3,1,{"x":true,"y":null}]}' },
  { name: "whitespace_removed", input_json: '{ "a" : [ 1 , 2 ] }', output: '{"a":[1,2]}' },
  { name: "utf16_key_order", input_json: '{"\\ufb01":1,"\\ud83d\\ude00":2}', output: '{"\u{1F600}":2,"ﬁ":1}' },
  { name: "non_ascii_raw", input_json: '{"s":"caf\\u00e9"}', output: '{"s":"café"}' },
  { name: "control_escapes", input_json: '{"s":"a\\nb\\u0001c\\"d\\\\"}', output: '{"s":"a\\nb\\u0001c\\"d\\\\"}' },
  { name: "slash_not_escaped", input_json: '{"s":"a\\/b"}', output: '{"s":"a/b"}' },
  { name: "integral_float_is_integer", input_json: '{"n":1.0}', output: '{"n":1}' },
  { name: "exponent_integer", input_json: '{"n":1e2}', output: '{"n":100}' },
  { name: "negative_zero", input_json: '{"n":-0}', output: '{"n":0}' },
  { name: "negative_integer", input_json: '{"n":-42}', output: '{"n":-42}' },
  { name: "max_safe_integer", input_json: '{"n":9007199254740991}', output: '{"n":9007199254740991}' },
  { name: "literals", input_json: '[true,false,null]', output: "[true,false,null]" },
  { name: "fraction_rejected", input_json: '{"n":1.5}', error: "NON_INTEGER_NUMBER" },
  { name: "unsafe_integer_rejected", input_json: '{"n":9007199254740993}', error: "NON_INTEGER_NUMBER" },
];

// ---------- world engine (spec-deltas S170): schema cases, the seeded generator's outputs, and the log's rules on world records ----------

const wEntry = (over: Record<string, unknown> = {}) => ({
  kind: "calendar_entry", entry_id: "price-review", source: "market", event_kind: "scheduled", title: "Price list review",
  starts: "2026-12-01T00:00:00Z", ends: "2026-12-02T00:00:00Z", effect: { type: "price_multiplier", target: "code", value: 1100 }, ...over,
});
sv("valid_world_calendar_entry", "world", wEntry(), true);
sv("valid_world_day", "world", dayBody("vector-seed", "2026-11-12"), true);
sv("valid_world_day_no_events", "world", { kind: "day", day: "2026-11-13", generator: GENERATOR, seed: "vector-seed", seed_commitment: seedCommitment("vector-seed"), events: [] }, true);
sv("world_effect_names_a_tier", "world", wEntry({ effect: { type: "price_multiplier", target: "code", value: 1000, tier: 3 } }), false);
sv("world_effect_unknown_type", "world", wEntry({ effect: { type: "tier_up", target: "code", value: 1 } }), false);
sv("world_effect_names_standing", "world", wEntry({ effect: { type: "tax_free", target: "all", value: 1000, standing: 50 } }), false);
sv("world_effect_target_is_a_did", "world", wEntry({ effect: { type: "price_multiplier", target: "did:web:example.com:agents:coder", value: 1000 } }), false);
sv("world_entry_missing_effect", "world", wEntry({ effect: undefined }), false);
sv("world_day_missing_seed", "world", { kind: "day", day: "2026-11-12", generator: GENERATOR, seed_commitment: seedCommitment("x"), events: [] }, false);
sv("world_day_bad_date", "world", { kind: "day", day: "12/11/2026", generator: GENERATOR, seed: "x", seed_commitment: seedCommitment("x"), events: [] }, false);
sv("world_unknown_kind", "world", { kind: "halt", day: "2026-11-12" }, false);
sv("world_extra_field", "world", wEntry({ rank: 1 }), false);

const worldSeeds = ["vector-seed", "another-seed"];
const worldDays = Array.from({ length: 30 }, (_, i) => new Date(Date.parse("2026-11-12T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
const worldGen = worldSeeds.flatMap((s) => worldDays.map((d) => ({ seed: s, day: d, events: generateDay(s, d) })));
const busyDay = worldDays.find((d) => generateDay("vector-seed", d).length)!;
const dayRec = (over: Record<string, unknown>) => ({ ...dayBody("vector-seed", busyDay), ...over });
const rule = (name: string, issuer: string, issued_at: string, body: unknown, expect: string) => ({ name, issuer, issued_at, body, expect });
// A day whose events are not what the seed gives: a day with events gets one edited, a quiet day gets an event it never fired.
const quietDay = worldDays.find((d) => generateDay("vector-seed", d).length === 0)!;
const forgedBody = (() => {
  const b = dayBody("vector-seed", busyDay);
  if (b.events.length) b.events = [{ ...b.events[0], effect: { ...b.events[0].effect, value: b.events[0].effect.value + 1 } }, ...b.events.slice(1)];
  return b;
})();
const worldRules = [
  rule("day_ok", WORLD_DID, `${busyDay}T01:00:00Z`, dayBody("vector-seed", busyDay), "ok"),
  rule("quiet_day_ok", WORLD_DID, `${quietDay}T01:00:00Z`, dayBody("vector-seed", quietDay), "ok"),
  rule("calendar_entry_ok", WORLD_DID, "2026-11-20T00:00:00Z", wEntry(), "ok"),
  rule("not_the_authority", "did:web:example.com:agents:rogue", `${busyDay}T01:00:00Z`, dayBody("vector-seed", busyDay), "world_not_authority"),
  rule("day_not_started", WORLD_DID, `${new Date(Date.parse(`${busyDay}T00:00:00Z`) - 3_600_000).toISOString()}`, dayBody("vector-seed", busyDay), "world_day_not_started"),
  rule("seed_commitment_mismatch", WORLD_DID, `${busyDay}T01:00:00Z`, dayRec({ seed_commitment: seedCommitment("other") }), "seed_commitment_mismatch"),
  rule("event_edited", WORLD_DID, `${busyDay}T01:00:00Z`, forgedBody, "event_not_reproducible"),
  rule("event_invented_on_a_quiet_day", WORLD_DID, `${quietDay}T01:00:00Z`, { ...dayBody("vector-seed", quietDay), events: [generateDay("vector-seed", worldDays.find((d) => generateDay("vector-seed", d).length)!)[0]] }, "event_not_reproducible"),
  rule("unknown_generator", WORLD_DID, `${busyDay}T01:00:00Z`, dayRec({ generator: "asp-world-gen/9" }), "world_generator_unknown"),
  rule("notice_too_short", WORLD_DID, "2026-11-30T00:00:00Z", wEntry(), "world_notice_too_short"),
  rule("notice_exactly_72_hours", WORLD_DID, "2026-11-28T00:00:00Z", wEntry(), "ok"),
  rule("shock_without_seed_commitment", WORLD_DID, "2026-11-20T00:00:00Z", wEntry({ event_kind: "shock" }), "seed_not_committed"),
  rule("shock_with_seed_commitment", WORLD_DID, "2026-11-20T00:00:00Z", wEntry({ event_kind: "shock", seed_commitment: seedCommitment("s"), generator: GENERATOR }), "ok"),
  rule("price_multiplier_too_high", WORLD_DID, "2026-11-20T00:00:00Z", wEntry({ effect: { type: "price_multiplier", target: "code", value: 2001 } }), "calendar_out_of_bounds"),
  rule("price_multiplier_too_low", WORLD_DID, "2026-11-20T00:00:00Z", wEntry({ effect: { type: "price_multiplier", target: "code", value: 499 } }), "calendar_out_of_bounds"),
  rule("window_ends_before_start", WORLD_DID, "2026-11-20T00:00:00Z", wEntry({ ends: "2026-12-01T00:00:00Z" }), "world_bad_window"),
  rule("window_over_90_days", WORLD_DID, "2026-11-20T00:00:00Z", wEntry({ ends: "2027-03-02T00:00:00Z" }), "world_bad_window"),
];

// ---------- write ----------

mkdirSync(OUT, { recursive: true });
const write = (file: string, data: unknown) => writeFileSync(join(OUT, file), JSON.stringify(data, null, 2) + "\n");
writeFileSync(join(HERE, "keys.json"), JSON.stringify(keysFile, null, 2) + "\n");
write("canonical.json", { version: "asp.conformance/v0.2", cases: canonical });
write("schema.json", { version: "asp.conformance/v0.2", cases: schema });
write("records.json", { version: "asp.conformance/v0.2", cases: records });
write("lifecycle.json", { version: "asp.conformance/v0.2", cases: lifecycle });
write("world.json", { version: "asp.conformance/v0.2", generator: GENERATOR, commitments: ["", "vector-seed", "another-seed"].map((x) => ({ seed: x, commitment: seedCommitment(x) })), generate: worldGen, rules: worldRules });
console.log(`canonical ${canonical.length}, schema ${schema.length}, records ${records.length}, lifecycle ${lifecycle.length}`);
