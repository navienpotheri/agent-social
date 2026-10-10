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
  settle(basis: "accepted" | "ruling" | "revoked" | "silence", cites?: string, opts: { by?: Party; cosigners?: Party[] } = {}) {
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
sv("valid_action_with_assurance", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], assurance: "gateway_enforced" }, true);
sv("action_unknown_assurance", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], assurance: "trust_me" }, false);
sv("valid_action_with_metrics", "action", { contract: fakeId("c"), scopes_used: ["repo.read"], metrics: { models: [{ name: "gpt-oss-120b", provider: "api.groq.com" }], requests: 3, tool_calls: 2, tokens_in: 1200, tokens_out: 340, seconds: 9 } }, true);
sv("action_metrics_negative_tokens", "action", { contract: fakeId("c"), scopes_used: [], metrics: { tokens_in: -1 } }, false);
sv("action_metrics_unknown_field", "action", { contract: fakeId("c"), scopes_used: [], metrics: { dollars: 2 } }, false);
sv("action_metrics_model_without_name", "action", { contract: fakeId("c"), scopes_used: [], metrics: { models: [{ provider: "x" }] } }, false);
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
sv("valid_report_ruling_upheld", "attestation", { kind: "report_ruling", about: fakeId("report"), verdict: "upheld" }, true);
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
sv("node_minimal", "node", { node: nodeBody.node, public_key: nodeBody.public_key, expires: nodeBody.expires }, true);
sv("node_without_expiry", "node", (({ expires: _e, ...rest }) => rest)(nodeBody), false);
sv("node_id_not_did_url", "node", { ...nodeBody, node: coder.did }, false);
sv("node_short_key", "node", { ...nodeBody, public_key: "abc" }, false);

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

// ---------- write ----------

mkdirSync(OUT, { recursive: true });
const write = (file: string, data: unknown) => writeFileSync(join(OUT, file), JSON.stringify(data, null, 2) + "\n");
writeFileSync(join(HERE, "keys.json"), JSON.stringify(keysFile, null, 2) + "\n");
write("canonical.json", { version: "asp.conformance/v0.2", cases: canonical });
write("schema.json", { version: "asp.conformance/v0.2", cases: schema });
write("records.json", { version: "asp.conformance/v0.2", cases: records });
write("lifecycle.json", { version: "asp.conformance/v0.2", cases: lifecycle });
console.log(`canonical ${canonical.length}, schema ${schema.length}, records ${records.length}, lifecycle ${lifecycle.length}`);
