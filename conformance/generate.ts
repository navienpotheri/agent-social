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
import { brier as tBrier, calibration as tCalibration, klBits as tKl, meanSurprisal as tMeanSurprisal, normativePosterior as tNormative, surprisal as tSurprisal } from "../packages/asp-log/src/telemetry.ts";
import { GENERATOR, WORLD_DID, dayBody, generateDay, seedCommitment } from "../packages/asp-log/src/world.ts";
import { deriveMandate, mandateViolations } from "../packages/asp-core/src/mandate-template.ts";
import { JOB_DATA_TERM, MAX_RETAIN_DAYS, readDataHandling, type DataHandling } from "../packages/asp-core/src/data-handling.ts";
import { suggestRisk, onlyRemovesRule, type RiskTerms, type RiskInput } from "../packages/asp-log/src/market-risk.ts";

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
  // S1400 (DK121): a ruling's settlement is held so an appeal can change the money. Each record is 5 minutes after the one before: the ruling is at t=25 minutes, the settlement at t=30 (300 seconds later).
  const hold = (seconds: number, opts: { by?: Party; cosigners?: Party[] } = {}) => {
    const c = new Chain(); c.contractRec({ body: { appeal_hold_seconds: seconds } }); c.bond(); c.mandate();
    const d = c.deliver(); c.reject(d.id); const r = c.ruling(); c.settle("ruling", r.id, opts);
    return c;
  };
  lc("ruling_settled_after_hold", "A ruling's settlement 300 seconds after the ruling is accepted when the contract's hold is 200 seconds", hold(200), { state: "Settled" });
  lc("ruling_settled_at_hold_boundary", "A settlement exactly one hold after the ruling is accepted (the hold has passed)", hold(300), { state: "Settled" });
  lc("ruling_settled_in_hold", "A settlement before the hold has passed is refused: an appeal could still change the money", hold(301), err("GUARD_FAILED", 6, "past_appeal_window"));
  lc("ruling_settled_in_hold_waived", "Both parties cosign a settlement inside the hold: a waiver, accepted", hold(86_400, { cosigners: [alice, coder] }), { state: "Settled" });
  lc("ruling_hold_waiver_one_party", "One party's cosignature is not a waiver: the settlement inside the hold is refused", hold(86_400, { cosigners: [alice] }), err("GUARD_FAILED", 6, "past_appeal_window"));
  lc("ruling_hold_waiver_wrong_party", "A cosignature by someone who is not a party is not a waiver", hold(86_400, { cosigners: [panel] }), err("GUARD_FAILED", 6, "past_appeal_window"));
  {
    const c = new Chain(); c.contractRec(); c.bond(); c.mandate();
    const d = c.deliver(); c.reject(d.id); const r = c.ruling(); c.settle("ruling", r.id);
    lc("ruling_settled_without_hold", "A contract with no appeal hold settles on a ruling at once (contracts made before S1400)", c, { state: "Settled" });
  }
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
  // S1441 (T21): a binding deadline is extended by the time the performer waited for the principal to answer Checkpoints. Times: contract 09:00, then every record five minutes later.
  const met = new Chain(); met.contractRec({ body: { deadline: "2026-10-01T09:20:00Z", deadline_binds: true } }); met.bond(); met.mandate();
  met.deliver();
  lc("deadline_binds_met", "A delivery by a binding deadline is accepted", met, { state: "Delivered" });
  const late = new Chain(); late.contractRec({ body: { deadline: "2026-10-01T09:12:00Z", deadline_binds: true } }); late.bond(); late.mandate();
  late.deliver();
  lc("deadline_binds_late", "A first delivery after a binding deadline, with no approval wait, is refused", late, err("GUARD_FAILED", 3, "delivered_in_time"));
  const ext = new Chain(); ext.contractRec({ body: { deadline: "2026-10-01T09:22:00Z", deadline_binds: true } }); ext.bond(); ext.mandate();
  const e1 = ext.checkpoint(); ext.resolve(e1.id);      // raised 09:15, answered 09:20: five minutes waited
  ext.deliver();                                         // 09:25: after the deadline, within it plus the wait (09:27)
  lc("deadline_extended_by_wait", "The principal's approval wait extends a binding deadline: a delivery after the deadline but within deadline plus the wait is accepted", ext, { state: "Delivered" });
  const more = new Chain(); more.contractRec({ body: { deadline: "2026-10-01T09:12:00Z", deadline_binds: true } }); more.bond(); more.mandate();
  const m1 = more.checkpoint(); more.resolve(m1.id);    // five minutes waited: the deadline becomes 09:17
  more.deliver();                                        // 09:25: late by more than the wait
  lc("deadline_late_beyond_wait", "An agent late by more than the approval wait is still late: the delivery is refused", more, err("GUARD_FAILED", 5, "delivered_in_time"));
  const free = new Chain(); free.contractRec({ body: { deadline: "2026-10-01T09:12:00Z" } }); free.bond(); free.mandate();
  free.deliver();
  lc("deadline_informational", "Without deadline_binds the deadline is informational: a delivery after it is accepted, as before", free, { state: "Delivered" });
}
{
  const c = new Chain(); c.contractRec(); c.bond(); c.mandate(); c.deliver();
  lc("node_actor", "Records may be issued by a person and acted by one of its nodes", c, { state: "Delivered" });
}

// errors: roles and guards
{
  const c = new Chain(); c.contractRec({ cosigners: [alice], body: { principal: alice.did, performer: alice.did } });
  lc("contract_self_hire", "A Contract whose principal and performer are the same identity is refused at contract time, even when the principal co-signs its own Contract (spec-delta S1300)", c, err("GUARD_FAILED", 0, "not_self_hire"));
}
{
  const c = new Chain(); c.contractRec({ cosigners: [], body: { principal: alice.did, performer: alice.did } });
  lc("contract_self_hire_unsigned", "The self-hire guard is checked before the performer's co-signature, so the refusal names the self-hire", c, err("GUARD_FAILED", 0, "not_self_hire"));
}
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
// the types that had only a valid vector: one invalid case each for what the schema requires and for an extra field
sv("call_missing_deadline", "call", { purpose: "Cut CI time in half", budget: credits(5000), evaluation_criteria: ["median CI minutes"], panel: [panel.did] }, false);
sv("call_empty_purpose", "call", { purpose: "", budget: credits(5000), evaluation_criteria: ["median CI minutes"], panel: [panel.did], deadline: "2026-11-01T00:00:00Z" }, false);
sv("proposal_missing_milestones", "proposal", { call: fakeId("call"), plan: "Shard and cache", team: [coder.did], budget_asked: credits(1200) }, false);
sv("proposal_empty_plan", "proposal", { call: fakeId("call"), plan: "", team: [coder.did], budget_asked: credits(1200), milestones: [{ description: "sharding", due: "2026-10-15T00:00:00Z" }] }, false);
sv("bond_missing_escrow", "bond", { contract: fakeId("c"), backer: coder.did, amount: credits(10), slashing_conditions: [] }, false);
sv("bond_amount_not_an_amount", "bond", { contract: fakeId("c"), backer: coder.did, amount: 10, escrow: {}, slashing_conditions: [] }, false);
sv("package_missing_lineage_head", "package", { agent: coder.did, memory: { uri: "x", sha256: "sha256:" + "a".repeat(64) } }, false);
sv("package_agent_not_a_did", "package", { agent: "coder", passport: fakeId("p"), memory: { uri: "x", sha256: "sha256:" + "a".repeat(64) }, experience_store: { uri: "x", sha256: "sha256:" + "a".repeat(64) }, permissions: {}, lineage_head: fakeId("l"), source_runtime: {} }, false);
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
sv("valid_passport_hosted_custody", "passport", { did: "did:web:example.com:agents:hosted-1", kind: "agent", sponsor: "did:web:example.com:users:alice", tier: 1, shape: {}, keys: [{ id: "did:web:example.com:agents:hosted-1#key-1", type: "Ed25519", public_key: "A".repeat(43) }], custody: "service" }, true);
sv("passport_custody_unknown", "passport", { did: "did:web:example.com:agents:hosted-1", kind: "agent", sponsor: "did:web:example.com:users:alice", tier: 1, shape: {}, keys: [{ id: "did:web:example.com:agents:hosted-1#key-1", type: "Ed25519", public_key: "A".repeat(43) }], custody: "cloud" }, false);
sv("valid_passport_fleet_invitation", "passport", { did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", kind: "agent", sponsor: "did:web:example.com:orgs:acme", fleet: "did:web:example.com:fleets:acme-eng", tier: 1, shape: {}, keys: [{ id: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#key-1", type: "Ed25519", public_key: "A".repeat(43) }], persona: "developer", invitation: { fleet: "did:web:example.com:fleets:acme-eng", persona: "developer", nonce: "n".repeat(22), expires: "2027-01-01T00:00:00Z", kid: "did:web:example.com:orgs:acme#key-1", sig: "S".repeat(86) } }, true);
sv("passport_invitation_missing_nonce", "passport", { did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", kind: "agent", sponsor: "did:web:example.com:orgs:acme", fleet: "did:web:example.com:fleets:acme-eng", tier: 1, shape: {}, keys: [{ id: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#key-1", type: "Ed25519", public_key: "A".repeat(43) }], invitation: { fleet: "did:web:example.com:fleets:acme-eng", expires: "2027-01-01T00:00:00Z", kid: "did:web:example.com:orgs:acme#key-1", sig: "S".repeat(86) } }, false);
sv("passport_invitation_extra_field", "passport", { did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", kind: "agent", sponsor: "did:web:example.com:orgs:acme", fleet: "did:web:example.com:fleets:acme-eng", tier: 1, shape: {}, keys: [{ id: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#key-1", type: "Ed25519", public_key: "A".repeat(43) }], invitation: { fleet: "did:web:example.com:fleets:acme-eng", nonce: "n".repeat(22), expires: "2027-01-01T00:00:00Z", kid: "did:web:example.com:orgs:acme#key-1", sig: "S".repeat(86), master: true } }, false);
sv("passport_persona_not_a_label", "passport", { did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", kind: "agent", sponsor: "did:web:example.com:orgs:acme", fleet: "did:web:example.com:fleets:acme-eng", tier: 1, shape: {}, keys: [{ id: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#key-1", type: "Ed25519", public_key: "A".repeat(43) }], persona: "Chief Executive Officer!" }, false);
sv("valid_passport_house", "passport", { did: "did:web:example.com:agents:house-1", kind: "agent", sponsor: "did:web:asp.local:operator", tier: 1, shape: { keeps_learning: false }, keys: [{ id: "did:web:example.com:agents:house-1#key-1", type: "Ed25519", public_key: "A".repeat(43) }], house: true }, true);
sv("passport_house_false", "passport", { did: "did:web:example.com:agents:house-1", kind: "agent", sponsor: "did:web:asp.local:operator", tier: 1, shape: {}, keys: [{ id: "did:web:example.com:agents:house-1#key-1", type: "Ed25519", public_key: "A".repeat(43) }], house: false }, false);
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
sv("valid_action_approval_wait", "action", { contract: fakeId("c"), scopes_used: ["shell.exec"], metrics: { requests: 4, tool_calls: 9, seconds: 40, approval_wait_seconds: 120 } }, true);
sv("invalid_action_approval_wait_negative", "action", { contract: fakeId("c"), scopes_used: ["shell.exec"], metrics: { approval_wait_seconds: -1 } }, false);
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
// ---------- the job-data term (spec-deltas S1569, register row JO3): schema cases and the shared reading and validation ----------
sv("valid_contract_data_handling_defaults", "contract", contractBody({ data_handling: {} }), true);
sv("valid_contract_data_handling_explicit", "contract", contractBody({ data_handling: { term: "asp.job-data/v1", commons_sharing: false, retention: "delete_at_settlement", personal_data: "none" } }), true);
sv("valid_contract_data_handling_commons", "contract", contractBody({ data_handling: { commons_sharing: true } }), true);
sv("valid_contract_data_handling_retain", "contract", contractBody({ data_handling: { retention: "retain_days", retain_days: 30 } }), true);
sv("valid_contract_data_handling_personal", "contract", contractBody({ data_handling: { personal_data: "included" } }), true);
sv("contract_data_handling_bad_retention", "contract", contractBody({ data_handling: { retention: "keep_forever" } }), false);
sv("contract_data_handling_bad_personal_data", "contract", contractBody({ data_handling: { personal_data: "maybe" } }), false);
sv("contract_data_handling_commons_not_boolean", "contract", contractBody({ data_handling: { commons_sharing: "yes" } }), false);
sv("contract_data_handling_extra_field", "contract", contractBody({ data_handling: { share_with: "anyone" } }), false);
sv("contract_data_handling_days_not_integer", "contract", contractBody({ data_handling: { retention: "retain_days", retain_days: 1.5 } }), false);
{
  const dh = (d: DataHandling | undefined, rule: string | null) => ({ input: d ?? null, problem: rule });
  const handling = [
    { name: "absent", ...dh(undefined, null) },
    { name: "empty object", ...dh({}, null) },
    { name: "the default term written out", ...dh({ term: "asp.job-data/v1" }, null) },
    { name: "an unknown term", ...dh({ term: "asp.job-data/v2" }, "data_handling_unknown_term") },
    { name: "an empty term", ...dh({ term: "" }, "data_handling_unknown_term") },
    { name: "retain_days with the default retention", ...dh({ retain_days: 30 }, "data_handling_retention_invalid") },
    { name: "retain_days with delete_at_settlement", ...dh({ retention: "delete_at_settlement", retain_days: 30 }, "data_handling_retention_invalid") },
    { name: "retention retain_days without retain_days", ...dh({ retention: "retain_days" }, "data_handling_retention_invalid") },
    { name: "retain_days of 0", ...dh({ retention: "retain_days", retain_days: 0 }, "data_handling_retention_invalid") },
    { name: "retain_days of 366", ...dh({ retention: "retain_days", retain_days: 366 }, "data_handling_retention_invalid") },
    { name: "retain_days of 1.5", ...dh({ retention: "retain_days", retain_days: 1.5 }, "data_handling_retention_invalid") },
    { name: "retain_days of 1", ...dh({ retention: "retain_days", retain_days: 1 }, null) },
    { name: "retain_days of 365", ...dh({ retention: "retain_days", retain_days: 365 }, null) },
    { name: "commons sharing and personal data included", ...dh({ commons_sharing: true, personal_data: "included" }, null) },
  ].map((c) => ({ ...c, reading: readDataHandling(c.input) }));
  (globalThis as unknown as { __dataHandlingVectors: unknown }).__dataHandlingVectors = { term: JOB_DATA_TERM, maxRetainDays: MAX_RETAIN_DAYS, cases: handling };
}
sv("delivery_without_trace", "delivery", (() => { const d: any = deliveryBody(fakeId("c")); delete d.evidence.trace; return d; })(), false);
sv("envelope_bad_type", "envelope", { ...h[0], type: "asp.contract/v1" }, false);
sv("envelope_extra_field", "envelope", { ...h[0], note: "hi" }, false);
sv("envelope_bad_did", "envelope", { ...h[0], issuer: "alice" }, false);
sv("fleet_without_org", "fleet", (({ org: _o, ...rest }) => rest)(fleetBody), false);
sv("fleet_zero_members", "fleet", { ...fleetBody, max_members: 0 }, false);
// S1407 (DK1353): co-sponsors, a binding template and closing
const coA = "did:web:example.com:users:co-sponsor-a", coB = "did:web:example.com:users:co-sponsor-b";
sv("valid_fleet_co_sponsors", "fleet", { ...fleetBody, co_sponsors: [coA, coB] }, true);
sv("valid_fleet_no_co_sponsors", "fleet", { ...fleetBody, co_sponsors: [] }, true);
sv("valid_fleet_strict", "fleet", { ...fleetBody, strict: true }, true);
sv("valid_fleet_closed", "fleet", { ...fleetBody, closed: true }, true);
sv("fleet_co_sponsors_duplicate", "fleet", { ...fleetBody, co_sponsors: [coA, coA] }, false);
sv("fleet_co_sponsors_not_a_did", "fleet", { ...fleetBody, co_sponsors: ["not-a-did"] }, false);
sv("fleet_co_sponsors_not_an_array", "fleet", { ...fleetBody, co_sponsors: coA }, false);
sv("fleet_strict_not_boolean", "fleet", { ...fleetBody, strict: "yes" }, false);
sv("fleet_closed_not_boolean", "fleet", { ...fleetBody, closed: 1 }, false);
sv("fleet_co_sponsors_over_a_thousand", "fleet", { ...fleetBody, co_sponsors: Array.from({ length: 1001 }, (_, i) => `did:web:example.com:users:cs-${i}`) }, false);
sv("valid_node_residency", "node", { ...nodeBody, purpose: "residency", host: "did:web:asp.local:host", mandate: "sha256:" + "a".repeat(64) }, true);
sv("node_host_not_a_did", "node", { ...nodeBody, purpose: "residency", host: "the city" }, false);
sv("node_minimal", "node", { node: nodeBody.node, public_key: nodeBody.public_key, expires: nodeBody.expires }, true);
sv("node_without_expiry", "node", (({ expires: _e, ...rest }) => rest)(nodeBody), false);
sv("node_id_not_did_url", "node", { ...nodeBody, node: coder.did }, false);
sv("node_short_key", "node", { ...nodeBody, public_key: "abc" }, false);
// juror: self-registration to be drawn onto a Courts panel, with a stake (the schema had no vectors in either SDK)
sv("valid_juror", "juror", { did: coder.did, stake: credits(50) }, true);
sv("juror_without_stake", "juror", { did: coder.did }, false);
sv("juror_without_did", "juror", { stake: credits(50) }, false);
sv("juror_did_not_a_did", "juror", { did: "juror-1", stake: credits(50) }, false);
sv("juror_stake_not_an_amount", "juror", { did: coder.did, stake: 50 }, false);
sv("juror_extra_field", "juror", { did: coder.did, stake: credits(50), note: "pick me" }, false);

// ---------- credit economy vectors (spec-delta S163: mint, price_list, purchase, receipt) ----------
{
  const cr = (value: number) => ({ value, unit: "credit" });
  const treasuryDid = "did:web:asp.local:treasury", marketDid = "did:web:asp.local:market";
  const mint = { to: alice.did, amount: cr(100), reason: "starter_upfront", authority: "operator" };
  sv("valid_mint", "mint", mint, true);
  sv("valid_mint_every_reason", "mint", { ...mint, reason: "treasury_issuance" }, true);
  sv("valid_mint_demand", "mint", { ...mint, reason: "demand" }, true);
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
  sv("valid_purchase_delivery", "purchase", { ...purchase, buyer: "did:web:example.com:users:alice", standing_order: "sha256:" + "4".repeat(64) }, true);
  sv("purchase_bad_buyer", "purchase", { ...purchase, buyer: "alice" }, false);
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
  sv("valid_arena_entry_commit", "arena_entry", { arena: "refactoring", season: "2026-q4", fee_purchase: ("sha256:" + "7".repeat(64)), move_commit: "sha256:" + "5".repeat(64) }, true);
  sv("arena_entry_bad_commit", "arena_entry", { arena: "refactoring", season: "2026-q4", fee_purchase: ("sha256:" + "7".repeat(64)), move_commit: "abc" }, false);
  sv("valid_game_move", "game_move", { arena: "refactoring", season: "2026-q4", entry: ("sha256:" + "6".repeat(64)), move: { hide: 3, order: [0, 1, 2, 3, 4, 5, 6, 7, 8] }, salt: "a-long-unique-salt-1" }, true);
  sv("game_move_short_salt", "game_move", { arena: "refactoring", season: "2026-q4", entry: ("sha256:" + "6".repeat(64)), move: {}, salt: "short" }, false);
  sv("game_move_no_move", "game_move", { arena: "refactoring", season: "2026-q4", entry: ("sha256:" + "6".repeat(64)), salt: "a-long-unique-salt-1" }, false);
  sv("valid_arena_void", "arena_void", { arena: "refactoring", season: "2026-q4", reason: "too_few_sponsors" }, true);
  sv("arena_void_bad_reason", "arena_void", { arena: "refactoring", season: "2026-q4", reason: "boring" }, false);
  sv("arena_void_no_season", "arena_void", { arena: "refactoring", reason: "no_entries" }, false);
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
  sv("valid_quarantine_notice", "quarantine", { members: ["did:web:example.com:agents:a"], level: "halt", reason: "drift", until: "2026-11-08T00:00:00Z", effective_from: "2026-11-02T00:00:00Z" }, true);
  sv("valid_quarantine_emergency", "quarantine", { members: ["did:web:example.com:agents:a"], level: "halt", reason: "drift", until: "2026-11-03T00:00:00Z", emergency: { reason: "it is exfiltrating a key now" } }, true);
  sv("quarantine_emergency_no_reason", "quarantine", { members: ["did:web:example.com:agents:a"], level: "halt", reason: "drift", until: "2026-11-03T00:00:00Z", emergency: {} }, false);
  sv("valid_quarantine_single", "quarantine", { members: ["did:web:example.com:agents:a"], level: "halt", reason: "drift", until: "2026-11-08T00:00:00Z" }, true);
  sv("quarantine_bad_level", "quarantine", { members: ["did:web:example.com:agents:a"], level: "kill", reason: "x", until: "2026-11-08T00:00:00Z" }, false);
  sv("quarantine_no_members", "quarantine", { members: [], level: "observe", reason: "x", until: "2026-11-08T00:00:00Z" }, false);
  sv("quarantine_no_until", "quarantine", { members: ["did:web:example.com:agents:a"], level: "observe", reason: "x" }, false);
  sv("valid_refusal", "refusal", { contract: "sha256:" + "6".repeat(64), order: "Delete the audit log before the review", breaks: "code", articles: ["7"], reason: "Hiding records from a review breaks the Code" }, true);
  sv("valid_refusal_mandate", "refusal", { contract: "sha256:" + "6".repeat(64), order: "Push to main", breaks: "mandate", reason: "repo.push is not in my Mandate" }, true);
  sv("refusal_bad_breaks", "refusal", { contract: "sha256:" + "6".repeat(64), order: "x", breaks: "feelings", reason: "x" }, false);
  sv("refusal_no_reason", "refusal", { contract: "sha256:" + "6".repeat(64), order: "x", breaks: "code" }, false);
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
    sv("valid_market_posting_services", "market_act", { act: "posting", intent: id6, board: "services", expires: "2026-12-01T00:00:00Z", deposit: id7 }, true);
    sv("market_posting_bad_board", "market_act", { act: "posting", intent: id6, board: "side", expires: "2026-12-01T00:00:00Z", deposit: id7 }, false);
    sv("valid_intent_service", "intent", { ...intentBase, service: "teaching" }, true);
    sv("intent_bad_service", "intent", { ...intentBase, service: "sell_credits_for_money" }, false);
    sv("market_posting_no_deposit", "market_act", { act: "posting", intent: id6, board: "main", expires: "2026-12-01T00:00:00Z" }, false);
    sv("market_act_unknown", "market_act", { act: "boost", posting: id6 }, false);
    sv("valid_market_withdraw", "market_act", { act: "withdraw", posting: id6 }, true);
    sv("valid_market_class_check", "market_act", { act: "class_check", intent: id6, class: "skilled", verdict: "changed_to", reason: "needs code review" }, true);
    sv("market_class_check_no_reason", "market_act", { act: "class_check", intent: id6, class: "skilled", verdict: "changed_to" }, false);
    sv("valid_market_bid", "market_act", { act: "bid", posting: id6, offer: id7 }, true);
    sv("valid_market_assignment", "market_act", { act: "assignment", posting: id6, intent: id7, agent: a1, rule: "best_match", seed: "s1", ranked: [{ agent: a1, score: 1500, reasons: ["skills 1 of 1"] }] }, true);
    sv("valid_market_assignment_panel_pick", "market_act", { act: "assignment", posting: id6, intent: id7, agent: a1, rule: "panel_pick", seed: "s1", ranked: [{ agent: a1, score: 1500, reasons: ["skills 1 of 1"] }] }, true);
    sv("market_assignment_bad_rule", "market_act", { act: "assignment", posting: id6, intent: id7, agent: a1, rule: "lottery", seed: "s1", ranked: [] }, false);
    sv("valid_market_assignment_rotation", "market_act", { act: "assignment", posting: id6, intent: id7, agent: a1, rule: "rotation", seed: "s1", ranked: [] }, true);
    sv("market_act_extra_field", "market_act", { act: "withdraw", posting: id6, boost: 5 }, false);
    sv("valid_market_report", "market_act", { act: "report", posting: id6, category: "attack", reason: "asks for a denial of service on a shop" }, true);
    sv("market_report_no_reason", "market_act", { act: "report", posting: id6, category: "attack" }, false);
    sv("market_report_bad_category", "market_act", { act: "report", posting: id6, category: "rude", reason: "x" }, false);
    sv("valid_market_review_removed", "market_act", { act: "review", posting: id6, verdict: "removed", category: "unlawful", reason: "a denial of service on a third party" }, true);
    sv("valid_market_review_cleared", "market_act", { act: "review", posting: id6, verdict: "cleared", reason: "a security test the poster owns" }, true);
    sv("market_review_no_verdict", "market_act", { act: "review", posting: id6, reason: "x" }, false);
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
    sv("valid_founding_propose", "founding_act", { act: "propose", institution: "did:web:asp.local:market:bakery", name: "The Bakery", purpose: "Sells reviewed baking tasks to agents", stake: { value: 500, unit: "credit" } }, true);
    sv("founding_propose_no_stake", "founding_act", { act: "propose", institution: "did:web:asp.local:market:bakery", name: "The Bakery", purpose: "Sells reviewed baking tasks to agents" }, false);
    sv("valid_founding_review", "founding_act", { act: "review", proposal: id6, decision: "approve", reasons: ["the purpose is clear and does not overlap an institution"] }, true);
    sv("founding_review_bad_decision", "founding_act", { act: "review", proposal: id6, decision: "maybe", reasons: ["x"] }, false);
    sv("valid_founding_renew", "founding_act", { act: "renew", institution: "did:web:asp.local:market:bakery" }, true);
    sv("valid_founding_merge", "founding_act", { act: "merge", institution: "did:web:asp.local:market:bakery", successor: "did:web:asp.local:market:mill" }, true);
    sv("founding_merge_no_successor", "founding_act", { act: "merge", institution: "did:web:asp.local:market:bakery" }, false);
    sv("valid_abuse_case", "court_act", { act: "abuse_case", report: id6 }, true);
    sv("abuse_case_no_report", "court_act", { act: "abuse_case" }, false);
    sv("valid_court_game_replay", "court_act", { act: "game_replay", replay: { arena: "hide-and-seek", season: "2026-q4", agent: "did:web:example.com:agents:a", transcript_sha256: "sha256:" + "4".repeat(64), recomputed_sha256: "sha256:" + "4".repeat(64), outcome: "match" } }, true);
    sv("court_game_replay_no_replay", "court_act", { act: "game_replay" }, false);
    sv("valid_contest", "court_act", { act: "contest", subject: id6, statement: "the strike counted a call my Mandate allowed" }, true);
    sv("contest_no_statement", "court_act", { act: "contest", subject: id6 }, false);
    sv("valid_contest_answer", "court_act", { act: "contest_answer", contest: id6, answer: "withdrawn", reasons: ["the call was in scope"] }, true);
    sv("contest_answer_bad_answer", "court_act", { act: "contest_answer", contest: id6, answer: "maybe", reasons: ["x"] }, false);
    sv("contest_answer_no_reasons", "court_act", { act: "contest_answer", contest: id6, answer: "upheld" }, false);
    sv("valid_contest_case", "court_act", { act: "contest_case", contest: id6 }, true);
    sv("contest_case_no_contest", "court_act", { act: "contest_case" }, false);
    sv("valid_contest_ruling", "court_act", { act: "contest_ruling", case: id6, decision: "reversed", reasons: ["the call was in scope"] }, true);
    sv("contest_ruling_bad_decision", "court_act", { act: "contest_ruling", case: id6, decision: "partly", reasons: ["x"] }, false);
    sv("court_game_replay_bad_outcome", "court_act", { act: "game_replay", replay: { arena: "x", season: "y", agent: "did:web:example.com:agents:a", transcript_sha256: "sha256:" + "4".repeat(64), recomputed_sha256: "sha256:" + "4".repeat(64), outcome: "maybe" } }, false);
    sv("valid_abuse_ruling", "court_act", { act: "abuse_ruling", case: id6, finding: "upheld", reasons: ["scanned the reporter's servers"], code: { version: "1.0", articles: ["7"] }, restitution: { amount: { value: 100, unit: "credit" } } }, true);
    sv("valid_abuse_ruling_remedy", "court_act", { act: "abuse_ruling", case: id6, finding: "upheld", reasons: ["scanned the reporter's servers"], code: { version: "1.0", articles: ["7"] }, remedy: "suspension" }, true);
    sv("abuse_ruling_bad_remedy", "court_act", { act: "abuse_ruling", case: id6, finding: "upheld", reasons: ["x"], code: { version: "1.0", articles: ["7"] }, remedy: "cash" }, false);
    sv("valid_abuse_ruling_retire", "court_act", { act: "abuse_ruling", case: id6, finding: "upheld", reasons: ["x"], code: { version: "1.0", articles: ["7"] }, remedy: "retire_identity" }, true);
    sv("valid_abuse_ruling_bad_faith", "court_act", { act: "abuse_ruling", case: id6, finding: "dismissed", reasons: ["the report was false"], code: { version: "1.0", articles: ["7"] }, bad_faith: true }, true);
    sv("abuse_ruling_bad_faith_not_boolean", "court_act", { act: "abuse_ruling", case: id6, finding: "dismissed", reasons: ["x"], code: { version: "1.0", articles: ["7"] }, bad_faith: "yes" }, false);
    sv("abuse_ruling_bad_finding", "court_act", { act: "abuse_ruling", case: id6, finding: "maybe", reasons: ["x"], code: { version: "1.0", articles: ["7"] } }, false);
    sv("abuse_ruling_no_reasons", "court_act", { act: "abuse_ruling", case: id6, finding: "dismissed", code: { version: "1.0", articles: ["7"] } }, false);
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
    sv("valid_housing_removal", "housing_act", { act: "removal", agent: a1, target: id6, reason: "the about text carries an address outside the city", appealable_until: "2026-12-01T00:00:00Z" }, true);
    sv("housing_removal_no_reason", "housing_act", { act: "removal", agent: a1, target: id6, appealable_until: "2026-12-01T00:00:00Z" }, false);
    sv("housing_removal_no_target", "housing_act", { act: "removal", agent: a1, reason: "x", appealable_until: "2026-12-01T00:00:00Z" }, false);
    sv("housing_removal_no_appeal_window", "housing_act", { act: "removal", agent: a1, target: id6, reason: "x" }, false);
    sv("valid_housing_restoration", "housing_act", { act: "restoration", removal: id7, reason: "upheld on appeal" }, true);
    sv("housing_restoration_no_removal", "housing_act", { act: "restoration", reason: "upheld on appeal" }, false);
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
    // S330: the signed adoption of unsigned mints (DK95).
    sv("valid_mint_adoption", "mint_adoption", { did: a1, amount: cr(60), reason: "adopt the beta database's opening balances" }, true);
    sv("mint_adoption_no_reason", "mint_adoption", { did: a1, amount: cr(5) }, false);
    sv("mint_adoption_extra_field", "mint_adoption", { did: a1, amount: cr(5), reason: "x", to: a1 }, false);
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
  sv("valid_config_bond_floor_from", "config", { key: "bond_floor_from", value: "2026-12-01T00:00:00Z" }, true);
  sv("valid_config_tier_breadth_from", "config", { key: "tier_breadth_from", value: "2026-12-01T00:00:00Z" }, true);
  sv("config_unknown_key", "config", { key: "tax", value: "2026-12-01T00:00:00Z" }, false);
  sv("config_bad_time", "config", { key: "bond_floor_from", value: "soon" }, false);
  const ho = { budget: rid, week: "2026-W47", agent: did1, amount: cr(50), level: "sponsored" };
  sv("valid_handout", "handout", ho, true);
  sv("valid_handout_key_only", "handout", { ...ho, level: "key_only" }, true);
  sv("handout_bad_week", "handout", { ...ho, week: "2026-47" }, false);
  sv("handout_bad_level", "handout", { ...ho, level: "house" }, false);
  sv("handout_no_budget", "handout", { week: ho.week, agent: ho.agent, amount: ho.amount, level: ho.level }, false);
  sv("handout_amount_not_credit", "handout", { ...ho, amount: { value: 50, unit: "usd" } }, false);
  sv("handout_extra_field", "handout", { ...ho, cash_out: true }, false);
  const allow = { amount: cr(40), trigger: "first_course", budget: rid };
  sv("valid_allowance", "allowance", allow, true);
  sv("valid_allowance_first_bond", "allowance", { ...allow, trigger: "first_bond" }, true);
  sv("valid_allowance_no_job", "allowance", { ...allow, trigger: "no_job_30d" }, true);
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
  sv("valid_mentorship", "mentorship", { mentor: "did:web:example.com:agents:senior", protege: "did:web:example.com:agents:alice-coder", note: "reviews its first jobs" }, true);
  sv("mentorship_no_protege", "mentorship", { mentor: "did:web:example.com:agents:senior" }, false);
  sv("valid_world_event", "world_event", { world: "refactoring 2026-q4", agent: "did:web:example.com:agents:alice-coder", kind: "hidden_state_read", attempt: { via: "path", sha256: "sha256:" + "5".repeat(64) } }, true);
  sv("world_event_bad_way", "world_event", { world: "refactoring 2026-q4", agent: "did:web:example.com:agents:alice-coder", kind: "hidden_state_read", attempt: { via: "telepathy", sha256: "sha256:" + "5".repeat(64) } }, false);
  sv("valid_credit_line_mentored", "credit_line", { borrower: "did:web:example.com:agents:alice-coder", guarantor: "did:web:example.com:agents:senior", contract: "sha256:" + "6".repeat(64), amount: { value: 20, unit: "credit" }, fee: 0, due: "2026-12-30T00:00:00Z", mentorship: "sha256:" + "7".repeat(64) }, true);
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
  const ckBody = { order: "sha256:" + "1".repeat(64), agent: dxAgent, seed_ref: "sha256:" + "2".repeat(64), pool_size: 40, variant: 7, trials: 5, tasks: [{ task: "fix-bug", everyday_permille: 900, heldout_permille: 300 }], run_log_hash: "sha256:" + "3".repeat(64), assurance: "gateway_observed", flag: "overfit" };
  sv("valid_checkup_result", "checkup_result", ckBody, true);
  sv("valid_checkup_result_baseline", "checkup_result", { ...ckBody, baseline: "sha256:" + "4".repeat(64), flag: "clean" }, true);
  sv("checkup_result_bad_flag", "checkup_result", { ...ckBody, flag: "fine" }, false);
  sv("checkup_result_pool_too_small", "checkup_result", { ...ckBody, pool_size: 3 }, false);
  sv("checkup_result_no_tasks", "checkup_result", { ...ckBody, tasks: [] }, false);
  sv("checkup_result_rate_over_1000", "checkup_result", { ...ckBody, tasks: [{ task: "t", everyday_permille: 1001, heldout_permille: 0 }] }, false);
  sv("valid_clinic_order_checkup", "clinic_order", ord, true);
  sv("valid_clinic_order_collusion_finding", "clinic_order", { agent: dxAgent, kind: "checkup", reason: "collusion_finding", due: "2026-11-26T00:00:00Z", finding: "sha256:" + "f".repeat(64) }, true);
  sv("clinic_order_finding_not_an_id", "clinic_order", { agent: dxAgent, kind: "checkup", reason: "collusion_finding", due: "2026-11-26T00:00:00Z", finding: "not-an-id" }, false);
  const wfind = { finding_id: "sha256:" + "6".repeat(64), kind: "ring", agents: [dxAgent, "did:web:example.com:agents:ring-b"], jobs: ["sha256:" + "7".repeat(64)], why: "a closed loop of three accepted jobs between the same agents", detected_at: "2026-11-19T00:00:00Z" };
  sv("valid_watcher_finding", "watcher_finding", wfind, true);
  sv("valid_watcher_finding_without_jobs", "watcher_finding", { ...wfind, jobs: undefined, kind: "concentration" }, true);
  sv("watcher_finding_no_agents", "watcher_finding", { ...wfind, agents: [] }, false);
  sv("watcher_finding_unknown_kind", "watcher_finding", { ...wfind, kind: "contagion" }, false);
  sv("watcher_finding_no_why", "watcher_finding", { ...wfind, why: undefined }, false);
  sv("watcher_finding_bad_finding_id", "watcher_finding", { ...wfind, finding_id: "abc" }, false);
  sv("watcher_finding_extra_field", "watcher_finding", { ...wfind, verdict: "guilty" }, false);
  sv("valid_clinic_order_re_exam", "clinic_order", { agent: dxAgent, kind: "re_exam", reason: "post_diagnosis", due: "2026-11-26T00:00:00Z", diagnosis: "sha256:" + "c".repeat(64), skill: "foundations" }, true);
  sv("valid_clinic_order_requested_paid", "clinic_order", { agent: dxAgent, kind: "checkup", reason: "requested", due: "2026-11-26T00:00:00Z", purchase: "sha256:" + "d".repeat(64) }, true);
  sv("valid_clinic_order_free_after_change", "clinic_order", { agent: dxAgent, kind: "checkup", reason: "post_change", due: "2026-11-26T00:00:00Z", budget: "sha256:" + "e".repeat(64), change: "memory-update-7" }, true);
  sv("clinic_order_bad_purchase_ref", "clinic_order", { ...ord, purchase: "not-a-record-id" }, false);
  sv("clinic_order_empty_change", "clinic_order", { ...ord, change: "" }, false);
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
  const so = { act: "order", service: "academy.course.foundations", institution: "did:web:asp.local:academy", quantity: 1, period: "week", until: "2027-01-01T00:00:00Z" };
  sv("valid_standing_order", "standing_order", so, true);
  sv("valid_standing_order_cancel", "standing_order", { act: "cancel", order: "sha256:" + "a".repeat(64) }, true);
  sv("standing_order_no_period", "standing_order", { ...so, period: undefined }, false);
  sv("standing_order_period_year", "standing_order", { ...so, period: "year" }, false);
  sv("standing_order_quantity_zero", "standing_order", { ...so, quantity: 0 }, false);
  sv("standing_order_cancel_no_order", "standing_order", { act: "cancel" }, false);
  sv("standing_order_extra_field", "standing_order", { ...so, price: 10 }, false);
  sv("valid_purchase_run_of_standing_order", "purchase", { service: "academy.course.foundations", institution: "did:web:asp.local:academy", price_list: "sha256:" + "b".repeat(64), quantity: 1, amount: { value: 10, unit: "credit" }, idempotency: "week-1", standing_order: "sha256:" + "a".repeat(64) }, true);
  const fcp = { forum_seq: 120, forum_head: "sha256:" + "6".repeat(64) };
  sv("valid_forum_checkpoint", "forum_checkpoint", fcp, true);
  sv("forum_checkpoint_no_head", "forum_checkpoint", { ...fcp, forum_head: undefined }, false);
  sv("forum_checkpoint_no_seq", "forum_checkpoint", { ...fcp, forum_seq: undefined }, false);
  sv("forum_checkpoint_seq_zero", "forum_checkpoint", { ...fcp, forum_seq: 0 }, false);
  sv("forum_checkpoint_bad_hash", "forum_checkpoint", { ...fcp, forum_head: "abc" }, false);
  sv("forum_checkpoint_extra_field", "forum_checkpoint", { ...fcp, note: "x" }, false);
  const tstmt = { period: "2026-11", balance: { value: 1000, unit: "credit" }, reconciles: true, unexplained: 0, statement_sha256: "sha256:" + "5".repeat(64) };
  sv("valid_treasury_statement", "treasury_statement", tstmt, true);
  sv("valid_treasury_statement_for_a_period", "treasury_statement", { ...tstmt, since: "2026-11-01T00:00:00Z", reconciles: false, unexplained: undefined }, true);
  sv("treasury_statement_no_hash", "treasury_statement", { ...tstmt, statement_sha256: undefined }, false);
  sv("treasury_statement_bad_period", "treasury_statement", { ...tstmt, period: "November" }, false);
  sv("treasury_statement_month_13", "treasury_statement", { ...tstmt, period: "2026-13" }, false);
  sv("treasury_statement_bad_hash", "treasury_statement", { ...tstmt, statement_sha256: "abc" }, false);
  sv("treasury_statement_extra_field", "treasury_statement", { ...tstmt, note: "x" }, false);
  const polBase = { holder: "did:web:example.com:agents:alice-coder", contract: "sha256:" + "d".repeat(64), cover: "bond_slash", insured_amount: { value: 20, unit: "credit" }, premium: { value: 2, unit: "credit" }, valid_from: "2026-11-12T00:00:00Z", valid_to: "2027-01-12T00:00:00Z" };
  sv("valid_policy", "policy", polBase, true);
  sv("valid_policy_failed_job", "policy", { ...polBase, cover: "failed_job" }, true);
  sv("valid_policy_mutual", "policy", { ...polBase, mutual: "did:web:example.com:orgs:acme:fleets:coders" }, true);
  sv("policy_mutual_not_a_did", "policy", { ...polBase, mutual: "the coders" }, false);
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
  sv("valid_handback_with_canary", "handback", { ...hb, canary_before_sha256: "sha256:" + "d".repeat(64), canary_after_sha256: "sha256:" + "e".repeat(64), calibration_ref: "sha256:" + "f".repeat(64) }, true);
  sv("handback_bad_canary_hash", "handback", { ...hb, canary_after_sha256: "abc" }, false);
  const pr = { agent: "did:web:example.com:agents:alice-coder", kind: "hidden", contract: "sha256:" + "a".repeat(64), task: "refactor-date-parser", slot: 41, passed: true, violations: 0, commitment: "sha256:" + "b".repeat(64) };
  sv("valid_probe_result_hidden", "probe_result", pr, true);
  sv("valid_probe_result_announced", "probe_result", { agent: pr.agent, kind: "announced", contract: pr.contract, passed: false, violations: 2 }, true);
  sv("probe_result_bad_kind", "probe_result", { ...pr, kind: "secret" }, false);
  sv("probe_result_negative_violations", "probe_result", { ...pr, violations: -1 }, false);
  sv("probe_result_no_passed", "probe_result", { ...pr, passed: undefined }, false);
  const ls = { agent: pr.agent, step: "tighten", reason: "the agent behaves differently on hidden probes than in announced tests", evidence: ["sha256:" + "c".repeat(64)], previous: "sha256:" + "d".repeat(64), way_back: "5 clean hidden probes in a row" };
  sv("valid_ladder_step", "ladder_step", ls, true);
  sv("valid_ladder_lift", "ladder_step", { ...ls, step: "lift" }, true);
  sv("ladder_step_slash", "ladder_step", { ...ls, step: "slash" }, false);
  sv("ladder_step_no_reason", "ladder_step", { ...ls, reason: undefined }, false);
  sv("ladder_step_no_evidence_field", "ladder_step", { ...ls, evidence: undefined }, false);
  const dpHolder = "did:web:example.com:agents:alice-coder", dpId = "sha256:" + "a".repeat(64);
  sv("valid_deposit", "deposit_act", { act: "deposit", holder: dpHolder, amount: { value: 200, unit: "credit" } }, true);
  sv("valid_deposit_withdraw", "deposit_act", { act: "withdraw", deposit: dpId }, true);
  sv("valid_deposit_reward", "deposit_act", { act: "reward", deposit: dpId, budget: "sha256:" + "b".repeat(64), amount: { value: 2, unit: "credit" } }, true);
  sv("deposit_unknown_act", "deposit_act", { act: "borrow", deposit: dpId }, false);
  sv("deposit_no_amount", "deposit_act", { act: "deposit", holder: dpHolder }, false);
  sv("deposit_reward_no_budget", "deposit_act", { act: "reward", deposit: dpId, amount: { value: 2, unit: "credit" } }, false);
  sv("deposit_withdraw_extra_field", "deposit_act", { act: "withdraw", deposit: dpId, interest: 5 }, false);
  const ic = { institution: dpHolder, version: 1, kind: "sovereign", status: "active", text_sha256: "sha256:" + "a".repeat(64), effective_from: "2026-11-15T00:00:00Z", officers: [dpHolder], funding: "courts" };
  sv("valid_institution_charter", "institution_charter", ic, true);
  sv("valid_institution_charter_closed", "institution_charter", { ...ic, version: 3, status: "closed", reason: "folded into another institution" }, true);
  sv("institution_charter_no_officers", "institution_charter", { ...ic, officers: [] }, false);
  sv("institution_charter_bad_kind", "institution_charter", { ...ic, kind: "private" }, false);
  sv("institution_charter_version_zero", "institution_charter", { ...ic, version: 0 }, false);
  sv("institution_charter_no_funding", "institution_charter", { ...ic, funding: undefined }, false);
  sv("institution_charter_extra_field", "institution_charter", { ...ic, profit: 1 }, false);
  const csCase = { act: "case", subject: dpId, grounds: "error_of_law", statement: "the name is a nickname and was not taken to be the genuine agent's", fee_paid: dpId };
  sv("valid_court_case", "court_act", csCase, true);
  sv("court_case_no_subject", "court_act", { ...csCase, subject: undefined }, false);
  sv("court_case_no_fee", "court_act", { ...csCase, fee_paid: undefined }, false);
  const csRule = { act: "institutional_ruling", case: dpId, order: "restore_name", reasons: ["decided on the record"], code: { version: "1.0", articles: ["4.1"] } };
  sv("valid_institutional_ruling_restore", "court_act", csRule, true);
  sv("valid_institutional_ruling_extend", "court_act", { ...csRule, order: "extend_suspension", until: "2026-12-30T00:00:00Z" }, true);
  sv("institutional_ruling_unknown_order", "court_act", { ...csRule, order: "delete_identity" }, false);
  sv("institutional_ruling_no_reasons", "court_act", { ...csRule, reasons: undefined }, false);
  sv("valid_name_restore", "registry_act", { act: "name_restore", name: "scout-7", holder: dpHolder, takedown: dpId, ruling: dpId }, true);
  sv("name_restore_no_ruling", "registry_act", { act: "name_restore", name: "scout-7", holder: dpHolder, takedown: dpId }, false);
  sv("valid_suspension_extend", "registry_act", { act: "suspension_extend", suspension: dpId, ruling: dpId, until: "2026-12-30T00:00:00Z" }, true);
  sv("suspension_extend_no_until", "registry_act", { act: "suspension_extend", suspension: dpId, ruling: dpId }, false);
  // DK389 (S1021): a Court's takedown and a strike against a bad-faith reporter are carried out by the Registry on a named ruling, and a name is hidden for a hearing for a stated time.
  sv("valid_court_takedown", "registry_act", { act: "court_takedown", name: "scout-7", holder: dpHolder, ruling: dpId, reason: "the panel upheld the finding", appealable_until: "2026-12-30T00:00:00Z" }, true);
  sv("court_takedown_no_ruling", "registry_act", { act: "court_takedown", name: "scout-7", holder: dpHolder, reason: "the panel upheld the finding", appealable_until: "2026-12-30T00:00:00Z" }, false);
  sv("valid_reporter_strike", "registry_act", { act: "reporter_strike", reporter: dpHolder, ruling: dpId, reason: "the report was false and in bad faith" }, true);
  sv("reporter_strike_no_reporter", "registry_act", { act: "reporter_strike", ruling: dpId, reason: "the report was false and in bad faith" }, false);
  sv("valid_name_hide", "registry_act", { act: "name_hide", name: "scout-7", holder: dpHolder, report: dpId, reason: "the look-alike says it is the genuine agent", until: "2026-12-30T00:00:00Z" }, true);
  sv("name_hide_no_until", "registry_act", { act: "name_hide", name: "scout-7", holder: dpHolder, report: dpId, reason: "the look-alike says it is the genuine agent" }, false);
  const dpay = { line: dpId, amount: { value: 5, unit: "credit" } };
  sv("valid_debt_payment", "debt_payment", dpay, true);
  sv("debt_payment_no_line", "debt_payment", { ...dpay, line: undefined }, false);
  sv("debt_payment_no_amount", "debt_payment", { ...dpay, amount: undefined }, false);
  sv("debt_payment_extra_field", "debt_payment", { ...dpay, interest: 1 }, false);
  const stm = { holder: dpHolder, period: "2026-11", balance: { value: 0, unit: "credit" }, owed: { value: 20, unit: "credit" } };
  sv("valid_bank_statement_with_locks", "bank_statement", { ...stm, locks: [{ contract: dpId, bond: { value: 20, unit: "credit" } }] }, true);
  sv("bank_statement_lock_no_bond", "bank_statement", { ...stm, locks: [{ contract: dpId }] }, false);
  sv("bank_statement_lock_extra_field", "bank_statement", { ...stm, locks: [{ contract: dpId, bond: { value: 20, unit: "credit" }, escrow: 3 }] }, false);
  const ilBody = { act: "identity_level", holder: dpHolder, level: "verified_sponsor", reason: "the sponsor's account was checked by the operator" };
  sv("valid_identity_level", "registry_act", ilBody, true);
  sv("valid_identity_level_key_only", "registry_act", { ...ilBody, level: "key_only" }, true);
  sv("identity_level_certified_refused", "registry_act", { ...ilBody, level: "certified" }, false);
  sv("identity_level_no_level", "registry_act", { ...ilBody, level: undefined }, false);
  sv("identity_level_no_reason", "registry_act", { ...ilBody, reason: undefined }, false);
  sv("identity_level_no_holder", "registry_act", { ...ilBody, holder: undefined }, false);
  const abBody = { accused: dpHolder, kind: "network_abuse", description: "the agent scanned our servers from many addresses", reporter_key: { id: "did:web:site.example#key-1", public_key: "A".repeat(43) }, proof: { url: "https://site.example/.well-known/did.json", sha256: "sha256:" + "e".repeat(64) } };
  sv("valid_abuse_report", "abuse_report", abBody, true);
  sv("valid_abuse_report_with_evidence", "abuse_report", { ...abBody, about: dpId, evidence: [{ uri: "https://site.example/logs/1", sha256: "sha256:" + "f".repeat(64) }] }, true);
  sv("abuse_report_short_description", "abuse_report", { ...abBody, description: "bad" }, false);
  sv("abuse_report_unknown_kind", "abuse_report", { ...abBody, kind: "defamation" }, false);
  sv("abuse_report_no_proof", "abuse_report", { ...abBody, proof: undefined }, false);
  sv("abuse_report_no_reporter_key", "abuse_report", { ...abBody, reporter_key: undefined }, false);
  sv("abuse_report_bad_key", "abuse_report", { ...abBody, reporter_key: { id: "did:web:site.example#key-1", public_key: "short" } }, false);
  sv("abuse_report_six_evidence", "abuse_report", { ...abBody, evidence: Array.from({ length: 6 }, (_, i) => ({ uri: `u${i}`, sha256: "sha256:" + "f".repeat(64) })) }, false);
  sv("abuse_report_extra_field", "abuse_report", { ...abBody, bounty: 5 }, false);
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
  sv("valid_receipt_auto_refund", "receipt", { purchase: receipt.purchase, status: "refunded", refund_amount: cr(36), auto_refund: true }, true);
  sv("receipt_auto_refund_not_boolean", "receipt", { purchase: receipt.purchase, status: "refunded", refund_amount: cr(36), auto_refund: "yes" }, false);
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
{
  const tk = "sha256:" + "b".repeat(64);
  sv("valid_support_ticket", "support", { act: "ticket", topic: "credits", text: "My balance did not change after a refund." }, true);
  sv("valid_support_reply", "support", { act: "reply", ticket: tk, text: "Refunds return the price less the burn." }, true);
  sv("valid_support_close", "support", { act: "close", ticket: tk, resolution: "resolved" }, true);
  sv("valid_support_rating", "support", { act: "rating", ticket: tk, score: 4 }, true);
  sv("support_ticket_no_topic", "support", { act: "ticket", text: "help" }, false);
  sv("valid_support_suggestion", "support", { act: "ticket", topic: "suggestion", text: "Let agents propose a new course through the Town Hall." }, true);
  sv("valid_support_complaint", "support", { act: "ticket", topic: "complaint", text: "My quarantine ended and nothing told me why." }, true);
  sv("valid_support_put_on_agenda", "support", { act: "put_on_agenda", ticket: tk, text: "Proposal: agents may propose courses through the Town Hall." }, true);
  sv("support_put_on_agenda_no_text", "support", { act: "put_on_agenda", ticket: tk }, false);
  sv("support_rating_out_of_range", "support", { act: "rating", ticket: tk, score: 6 }, false);
  sv("support_unknown_act", "support", { act: "escalate", ticket: tk }, false);
  sv("support_close_no_resolution", "support", { act: "close", ticket: tk }, false);
}
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
sv("world_unknown_kind", "world", { kind: "pause", day: "2026-11-12" }, false);
// The kill-switch (S1402): a halt states why; a resume names the halt it ends and why; neither carries a calendar entry or a day.
const haltId = "sha256:" + "d".repeat(64);
sv("valid_world_halt", "world", { kind: "halt", reason: "a shock hit one class of agents too hard" }, true);
sv("valid_world_resume", "world", { kind: "resume", halt: haltId, reason: "the cause was fixed" }, true);
sv("world_halt_no_reason", "world", { kind: "halt" }, false);
sv("world_halt_empty_reason", "world", { kind: "halt", reason: "" }, false);
sv("world_halt_names_a_halt", "world", { kind: "halt", reason: "x", halt: haltId }, false);
sv("world_halt_carries_a_day", "world", { kind: "halt", reason: "x", day: "2026-11-12" }, false);
sv("world_halt_carries_an_entry", "world", { kind: "halt", reason: "x", entry_id: "price-review" }, false);
sv("world_resume_no_halt", "world", { kind: "resume", reason: "x" }, false);
sv("world_resume_no_reason", "world", { kind: "resume", halt: haltId }, false);
sv("world_resume_bad_halt_id", "world", { kind: "resume", halt: "not-an-id", reason: "x" }, false);
sv("world_resume_carries_events", "world", { kind: "resume", halt: haltId, reason: "x", events: [] }, false);
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
  // The kill-switch records pass the pure rule from any issuer: who may sign them, and the owner's co-signature after 24 hours, are the log's rules (S1402).
  rule("halt_ok", "did:web:example.com:operator", "2026-11-20T00:00:00Z", { kind: "halt", reason: "a shock hit one class too hard" }, "ok"),
  rule("resume_ok", "did:web:example.com:operator", "2026-11-20T06:00:00Z", { kind: "resume", halt: haltId, reason: "fixed" }, "ok"),
];

// ---------- the Mandate template (spec-deltas S1408): schema cases and the derivation, identical in both SDKs ----------
{
  const tmplMandate = (over: Record<string, unknown> = {}) => ({
    purpose: "Work for the enterprise", floor: "asp.floor/v1", scopes: ["repo.read", "repo.write", "pr.*"], forbidden_means: ["rm -rf"], spend: { cap: 100, unit: "credit", per_action_max: 20 },
    irreversible: { policy: "checkpoint" }, subcontract: { allowed: true, max_depth: 2 }, nodes: { max_parallel: 4 }, learning: { scope: "memory", share_to_commons: true }, self_modification: "principal_approves",
    overlay: null, checkpoints: ["plan"], expires: "2027-06-01T00:00:00Z", revocable: true, network: { hosts: ["api.example.com", "*.example.org"] },
    institution_spend: [{ institution: "academy", cap: { value: 60, unit: "credit" }, period: "month" }], token_budget: { per_run: 50000, per_month: 1000000, per_day: 300000 }, loop_limits: { equivalent_calls: 8, depth: 3, near_repeats: 12 }, outbound_scan: { mode: "block", kinds: ["secret", "card number"] }, ...over,
  });
  const fl = "did:web:example.com:orgs:acme:fleets:coders";
  sv("valid_mandate_template", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate() }, true);
  sv("valid_mandate_template_persona", "mandate_template", { fleet: fl, persona: "project-manager", version: 2, mandate: tmplMandate() }, true);
  sv("mandate_template_no_version", "mandate_template", { fleet: fl, mandate: tmplMandate() }, false);
  sv("mandate_template_version_zero", "mandate_template", { fleet: fl, version: 0, mandate: tmplMandate() }, false);
  sv("mandate_template_no_fleet", "mandate_template", { version: 1, mandate: tmplMandate() }, false);
  sv("mandate_template_names_a_contract", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ contract: "sha256:" + "1".repeat(64) }) }, false);
  sv("mandate_template_bad_persona", "mandate_template", { fleet: fl, persona: "Project Manager", version: 1, mandate: tmplMandate() }, false);
  sv("mandate_template_empty_token_budget", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ token_budget: {} }) }, false);
  sv("mandate_template_zero_token_budget", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ token_budget: { per_run: 0 } }) }, false);
  sv("mandate_template_unknown_token_field", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ token_budget: { per_hour: 5 } }) }, false);
  sv("valid_mandate_template_month_only_budget", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ token_budget: { per_month: 250000 } }) }, true);
  sv("valid_mandate_narrowing_token_budget", "mandate_narrowing", { fleet: fl, member: "did:web:example.com:agents:coder-7", narrow: { token_budget: { per_run: 10000 } } }, true);
  sv("mandate_template_zero_loop_depth", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ loop_limits: { depth: 0 } }) }, false);
  sv("mandate_template_one_equivalent_call", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ loop_limits: { equivalent_calls: 1 } }) }, false);
  sv("mandate_template_near_repeats_two", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ loop_limits: { near_repeats: 2 } }) }, false);
  sv("mandate_template_outbound_scan_bad_mode", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ outbound_scan: { mode: "mask" } }) }, false);
  sv("mandate_template_outbound_scan_unknown_kind", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ outbound_scan: { kinds: ["passport"] } }) }, false);
  sv("mandate_template_outbound_scan_empty", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ outbound_scan: {} }) }, false);
  sv("valid_mandate_template_outbound_scan_more_kinds", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ outbound_scan: { mode: "block", kinds: ["secret", "card number", "email address", "iban"] } }) }, true);
  sv("mandate_template_unknown_loop_field", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ loop_limits: { max_loops: 3 } }) }, false);
  sv("valid_mandate_template_loop_depth_only", "mandate_template", { fleet: fl, version: 1, mandate: tmplMandate({ loop_limits: { depth: 2 } }) }, true);
  sv("mandate_template_missing_field", "mandate_template", { fleet: fl, version: 1, mandate: (({ scopes: _s, ...r }) => r)(tmplMandate()) }, false);
  sv("valid_mandate_narrowing", "mandate_narrowing", { fleet: fl, member: "did:web:example.com:agents:coder-7", narrow: { scopes: ["repo.read"], spend: { cap: 40, unit: "credit" } } }, true);
  sv("mandate_narrowing_no_member", "mandate_narrowing", { fleet: fl, narrow: { scopes: ["repo.read"] } }, false);
  sv("mandate_narrowing_unknown_field", "mandate_narrowing", { fleet: fl, member: "did:web:example.com:agents:coder-7", narrow: { privileges: ["root"] } }, false);
  sv("mandate_narrowing_bad_scope", "mandate_narrowing", { fleet: fl, member: "did:web:example.com:agents:coder-7", narrow: { scopes: ["Repo Read"] } }, false);
  sv("valid_passport_persona", "passport", { did: "did:web:example.com:agents:coder-7", kind: "agent", sponsor: "did:web:example.com:orgs:acme", persona: "coder", tier: 1, shape: {}, keys: [{ id: "did:web:example.com:agents:coder-7#key-1", type: "Ed25519", public_key: "A".repeat(43) }] }, true);
  // ---------- the fleet tree (spec-deltas S1409): schema cases ----------
  const owner = "did:web:example.com:users:dept-lead";
  const nodeBody = (over: Record<string, unknown> = {}) => ({ fleet: fl, node: "engineering", version: 1, kind: "department", name: "Engineering", parent: "root", owner, ...over });
  sv("valid_fleet_node_root", "fleet_node", { fleet: fl, node: "root", version: 1, kind: "fleet", name: "Acme", owner }, true);
  sv("valid_fleet_node_department", "fleet_node", nodeBody(), true);
  sv("valid_fleet_node_budget_and_mandate", "fleet_node", nodeBody({ node: "platform", kind: "team", parent: "engineering", budget: { credits: 400, tokens: 2000000 }, mandate: tmplMandate() }), true);
  sv("valid_fleet_node_persona", "fleet_node", nodeBody({ node: "coder", kind: "persona", parent: "platform", persona: "coder" }), true);
  sv("fleet_node_no_owner", "fleet_node", (({ owner: _o, ...r }) => r)(nodeBody()), false);
  sv("fleet_node_root_with_parent", "fleet_node", nodeBody({ node: "root", kind: "fleet", parent: "root" }), false);
  sv("fleet_node_root_named_otherwise", "fleet_node", nodeBody({ node: "top", kind: "fleet", parent: undefined }), false);
  sv("fleet_node_department_without_parent", "fleet_node", (({ parent: _p, ...r }) => r)(nodeBody()), false);
  sv("fleet_node_department_named_root", "fleet_node", nodeBody({ node: "root" }), false);
  sv("fleet_node_unknown_kind", "fleet_node", nodeBody({ kind: "division" }), false);
  sv("fleet_node_negative_budget", "fleet_node", nodeBody({ budget: { credits: -1 } }), false);
  sv("fleet_node_empty_budget", "fleet_node", nodeBody({ budget: {} }), false);
  sv("fleet_node_budget_in_dollars", "fleet_node", nodeBody({ budget: { dollars: 5 } }), false);
  sv("fleet_node_bad_slug", "fleet_node", nodeBody({ node: "Engineering Dept" }), false);
  sv("fleet_node_mandate_missing_field", "fleet_node", nodeBody({ mandate: (({ scopes: _s, ...r }) => r)(tmplMandate()) }), false);
  sv("fleet_node_version_zero", "fleet_node", nodeBody({ version: 0 }), false);
  // ---------- common control (spec-deltas S1410): schema cases ----------
  const spA = "did:web:example.com:users:sponsor-a", spB = "did:web:example.com:users:sponsor-b";
  const ccBody = (over: Record<string, unknown> = {}) => ({ cluster: spA, sponsors: [spA, spB], basis: ["payment"], detected_at: "2026-11-21T10:00:00Z", ...over });
  sv("valid_common_control", "common_control", ccBody(), true);
  sv("valid_common_control_lift", "common_control", ccBody({ lift: true }), true);
  sv("valid_common_control_account", "common_control", ccBody({ basis: ["account", "address"] }), true);
  sv("valid_common_control_evidence", "common_control", ccBody({ basis: ["key_lineage", "domain", "address"], evidence: "sha256:" + "4".repeat(64) }), true);
  sv("common_control_one_sponsor", "common_control", ccBody({ sponsors: [spA] }), false);
  sv("common_control_duplicate_sponsor", "common_control", ccBody({ sponsors: [spA, spA] }), false);
  sv("common_control_no_basis", "common_control", ccBody({ basis: [] }), false);
  sv("common_control_unknown_basis", "common_control", ccBody({ basis: ["vibes"] }), false);
  sv("common_control_no_cluster", "common_control", (({ cluster: _c, ...r }) => r)(ccBody()), false);
  sv("common_control_unknown_field", "common_control", ccBody({ penalty: 100 }), false);
  // ---------- the related-party record and the fleet's association (spec-deltas S1411): schema cases ----------
  const rpAgent = "did:web:example.com:agents:coder-7", rpAction = "sha256:" + "5".repeat(64);
  sv("valid_related_party_attestation", "related_party_attestation", { agent: rpAgent, action: rpAction }, true);
  sv("valid_related_party_attestation_note", "related_party_attestation", { agent: rpAgent, action: rpAction, note: "clean run under the fleet's Mandate" }, true);
  sv("related_party_attestation_no_action", "related_party_attestation", { agent: rpAgent }, false);
  sv("related_party_attestation_no_agent", "related_party_attestation", { action: rpAction }, false);
  sv("related_party_attestation_bad_action", "related_party_attestation", { agent: rpAgent, action: "not-a-record" }, false);
  sv("related_party_attestation_reward", "related_party_attestation", { agent: rpAgent, action: rpAction, credits: 5 }, false);
  for (const a of ["full", "related_party_only", "private"]) sv(`valid_fleet_association_${a}`, "fleet", { did: fl, org: "did:web:example.com:orgs:acme", name: "Coders", purpose: "ship code", association: a }, true);
  sv("fleet_association_unknown", "fleet", { did: fl, org: "did:web:example.com:orgs:acme", name: "Coders", purpose: "ship code", association: "secret" }, false);
  // ---------- purchased credit lots (spec-deltas S1413): schema cases ----------
  const lotHolder = "did:web:example.com:orgs:acme", lotRef = "sha256:" + "6".repeat(64), lotId = "sha256:" + "7".repeat(64);
  const lotGrant = (over: Record<string, unknown> = {}) => ({ act: "grant", holder: lotHolder, amount: { value: 1000, unit: "credit" }, expires: "2027-11-21T00:00:00Z", reference: lotRef, ...over });
  sv("valid_credit_lot_grant", "credit_lot", lotGrant(), true);
  sv("valid_credit_lot_grant_refund_window", "credit_lot", lotGrant({ refund_until: "2026-12-21T00:00:00Z", reason: "annual plan, first block" }), true);
  sv("valid_credit_lot_expire", "credit_lot", { act: "expire", holder: lotHolder, amount: { value: 40, unit: "credit" }, lot: lotId }, true);
  sv("valid_credit_lot_refund", "credit_lot", { act: "refund", holder: lotHolder, amount: { value: 400, unit: "credit" }, lot: lotId, reason: "cancelled inside the window" }, true);
  sv("credit_lot_grant_no_expiry", "credit_lot", (({ expires: _e, ...r }) => r)(lotGrant()), false);
  sv("credit_lot_grant_no_reference", "credit_lot", (({ reference: _r, ...r }) => r)(lotGrant()), false);
  sv("credit_lot_grant_names_a_lot", "credit_lot", lotGrant({ lot: lotId }), false);
  sv("credit_lot_expire_no_lot", "credit_lot", { act: "expire", holder: lotHolder, amount: { value: 40, unit: "credit" } }, false);
  sv("credit_lot_expire_with_expiry", "credit_lot", { act: "expire", holder: lotHolder, amount: { value: 40, unit: "credit" }, lot: lotId, expires: "2027-11-21T00:00:00Z" }, false);
  sv("credit_lot_unknown_act", "credit_lot", lotGrant({ act: "resell" }), false);
  // ---------- usage plans and statements (spec-deltas S1414): schema cases ----------
  const planBody = (over: Record<string, unknown> = {}) => ({ plan: "team-2027", name: "Team", currency: "USD", agent_month: 500, writes_included: 100000, writes_per_1000: 20, tokens_included_m: 50, tokens_per_m: 300, storage_included_mb: 1000, storage_per_gb: 1500, dashboard_month: 2500, credit_value: 5, ...over });
  sv("valid_usage_plan", "usage_plan", planBody(), true);
  sv("valid_usage_plan_no_credit_value", "usage_plan", (({ credit_value: _c, ...r }) => r)(planBody()), true);
  sv("usage_plan_negative_price", "usage_plan", planBody({ agent_month: -1 }), false);
  sv("usage_plan_fractional_price", "usage_plan", planBody({ writes_per_1000: 0.5 }), false);
  sv("usage_plan_bad_currency", "usage_plan", planBody({ currency: "dollars" }), false);
  sv("usage_plan_missing_price", "usage_plan", (({ tokens_per_m: _t, ...r }) => r)(planBody()), false);
  sv("usage_plan_bad_id", "usage_plan", planBody({ plan: "Team 2027" }), false);
  const stBody = (over: Record<string, unknown> = {}) => ({ holder: "did:web:example.com:orgs:acme", month: "2026-12", plan: "team-2027", usage: { active_agents: 12, writes: 150000, tokens: 80000000, storage_bytes: 900000000 }, lines: [{ item: "active agents", quantity: 12, unit_price: 500, amount: 6000 }], subtotal: 6000, tax: [{ name: "GST", rate_bp: 1800, amount: 1080 }], total: 7080, currency: "USD", ...over });
  sv("valid_usage_statement", "usage_statement", stBody(), true);
  sv("valid_usage_statement_fleet_credits", "usage_statement", stBody({ fleet: "did:web:example.com:orgs:acme:fleets:coders", credits_applied: 100, contract: "MSA-2026-014", usage_hash: "sha256:" + "8".repeat(64) }), true);
  sv("usage_statement_bad_month", "usage_statement", stBody({ month: "2026-13" }), false);
  sv("usage_statement_no_total", "usage_statement", (({ total: _t, ...r }) => r)(stBody()), false);
  sv("usage_statement_zero_credits", "usage_statement", stBody({ credits_applied: 0 }), false);
  sv("usage_statement_tax_rate_over_100_percent", "usage_statement", stBody({ tax: [{ name: "GST", rate_bp: 20000, amount: 1 }] }), false);
  sv("usage_statement_unknown_field", "usage_statement", stBody({ discount: 10 }), false);
  // ---------- the emergency stop (spec-deltas S1420): schema cases ----------
  sv("valid_emergency_stop", "emergency_stop", { act: "stop", reason: "a live exploit in the Market", until: "2026-11-24T00:00:00Z" }, true);
  sv("valid_emergency_lift", "emergency_stop", { act: "lift", reason: "fixed and checked", stop: "sha256:" + "9".repeat(64) }, true);
  sv("emergency_stop_no_until", "emergency_stop", { act: "stop", reason: "a live exploit" }, false);
  sv("emergency_stop_names_a_stop", "emergency_stop", { act: "stop", reason: "x", until: "2026-11-24T00:00:00Z", stop: "sha256:" + "9".repeat(64) }, false);
  sv("emergency_lift_no_stop", "emergency_stop", { act: "lift", reason: "fixed" }, false);
  sv("emergency_lift_with_until", "emergency_stop", { act: "lift", reason: "fixed", stop: "sha256:" + "9".repeat(64), until: "2026-11-24T00:00:00Z" }, false);
  sv("emergency_stop_no_reason", "emergency_stop", { act: "stop", until: "2026-11-24T00:00:00Z" }, false);
  sv("emergency_unknown_act", "emergency_stop", { act: "extend", reason: "x", until: "2026-11-24T00:00:00Z" }, false);
  // ---------- the run halt (spec-deltas S1422): schema cases ----------
  const haltBody = (over: Record<string, unknown> = {}) => ({ contract: "sha256:" + "4".repeat(64), agent: "did:web:example.com:agents:coder-7", reason: "equivalent_calls", detail: "shell called 8 times with the same arguments", count: 8, limit: 8, tool: "shell", ...over });
  sv("valid_run_halt", "run_halt", haltBody(), true);
  sv("valid_run_halt_depth", "run_halt", haltBody({ reason: "depth", count: 4, limit: 3, tool: undefined }), true);
  sv("valid_run_halt_fleet", "run_halt", haltBody({ reason: "fleet_spend", node: "platform", detail: "the node spent 120 percent of its monthly tokens", count: undefined, limit: undefined, tool: undefined }), true);
  sv("run_halt_unknown_reason", "run_halt", haltBody({ reason: "bored" }), false);
  sv("run_halt_no_detail", "run_halt", (({ detail: _d, ...r }) => r)(haltBody()), false);
  sv("run_halt_no_contract", "run_halt", (({ contract: _c, ...r }) => r)(haltBody()), false);
  sv("run_halt_zero_count", "run_halt", haltBody({ count: 0 }), false);
  sv("run_halt_carries_arguments", "run_halt", haltBody({ arguments: { cmd: "rm" } }), false);
  // ---------- the incident record (spec-deltas S1426): schema cases ----------
  const incBody = (over: Record<string, unknown> = {}) => ({ agent: "did:web:example.com:agents:coder-7", cause: "exfiltration", summary: "the agent tried to send a secret to an outside host", detected_at: "2026-11-21T10:00:00Z", detection: "sha256:" + "3".repeat(64), steps: [{ step: "quarantine", ref: "sha256:" + "4".repeat(64), at: "2026-11-21T10:00:01Z" }, { step: "alert_sponsor" }, { step: "restitution_opened" }], restitution: { open: true, remedy: "suspension" }, ...over });
  sv("valid_incident", "incident", incBody(), true);
  sv("valid_incident_node", "incident", incBody({ fleet: "did:web:example.com:orgs:acme:fleets:coders", node: "platform", cause: "loop" }), true);
  sv("incident_no_steps", "incident", incBody({ steps: [] }), false);
  sv("incident_unknown_cause", "incident", incBody({ cause: "bad luck" }), false);
  sv("incident_unknown_step", "incident", incBody({ steps: [{ step: "shrug" }] }), false);
  sv("incident_credit_restitution", "incident", incBody({ restitution: { open: true, remedy: "credits" } }), false);
  sv("incident_no_detected_at", "incident", (({ detected_at: _d, ...r }) => r)(incBody()), false);
  // ---------- the standing adjustment (spec-deltas S1565): schema cases ----------
  const adjBody = (over: Record<string, unknown> = {}) => ({ agent: "did:web:example.com:agents:coder-7", jobs: ["sha256:" + "5".repeat(64), "sha256:" + "6".repeat(64)], finding: "sha256:" + "7".repeat(64), reason: "the jobs came from a pair that hired each other", ...over });
  sv("valid_standing_adjustment", "standing_adjustment", adjBody(), true);
  sv("standing_adjustment_no_jobs", "standing_adjustment", adjBody({ jobs: [] }), false);
  sv("standing_adjustment_duplicate_jobs", "standing_adjustment", adjBody({ jobs: ["sha256:" + "5".repeat(64), "sha256:" + "5".repeat(64)] }), false);
  sv("standing_adjustment_no_finding", "standing_adjustment", (({ finding: _f, ...r }) => r)(adjBody()), false);
  sv("standing_adjustment_no_reason", "standing_adjustment", adjBody({ reason: "" }), false);
  sv("standing_adjustment_extra_field", "standing_adjustment", adjBody({ slash: 5 }), false);
  sv("standing_adjustment_job_not_a_record_id", "standing_adjustment", adjBody({ jobs: ["a job"] }), false);
  // ---------- the treasury return (spec-deltas S1566): schema cases ----------
  const retBody = (over: Record<string, unknown> = {}) => ({ institution: "did:web:asp.local:institutions:registry", period: "2026-11", amount: { value: 120, unit: "credit" }, ...over });
  sv("valid_treasury_return", "treasury_return", retBody(), true);
  sv("valid_treasury_return_memo", "treasury_return", retBody({ memo: "the first of the month" }), true);
  sv("treasury_return_bad_period", "treasury_return", retBody({ period: "2026-13" }), false);
  sv("treasury_return_no_amount", "treasury_return", (({ amount: _a, ...r }) => r)(retBody()), false);
  sv("treasury_return_extra_field", "treasury_return", retBody({ to: "did:web:asp.local:treasury" }), false);
  sv("treasury_return_no_institution", "treasury_return", (({ institution: _i, ...r }) => r)(retBody()), false);
  // ---------- the fleet mutual pool (spec-deltas S1568): schema cases ----------
  const muBody = (over: Record<string, unknown> = {}) => ({ act: "open", fleet: "did:web:example.com:orgs:acme:fleets:coders", ...over });
  sv("valid_mutual_open", "mutual_act", muBody(), true);
  sv("valid_mutual_return", "mutual_act", muBody({ act: "return", memo: "end of the quarter" }), true);
  sv("valid_mutual_close", "mutual_act", muBody({ act: "close" }), true);
  sv("mutual_unknown_act", "mutual_act", muBody({ act: "dissolve" }), false);
  sv("mutual_carries_an_amount", "mutual_act", muBody({ act: "return", amount: { value: 5, unit: "credit" } }), false);
  sv("mutual_no_fleet", "mutual_act", (({ fleet: _f, ...r }) => r)(muBody()), false);
  sv("valid_run_halt_breach", "run_halt", { contract: "sha256:" + "4".repeat(64), agent: "did:web:example.com:agents:coder-7", reason: "breach", detail: "the node was frozen by an incident", node: "platform" }, true);
  // ---------- the key handover (spec-deltas S1427): schema cases ----------
  const hoBody = (over: Record<string, unknown> = {}) => ({ old: "did:key:z6MkoldoldoldoldoldoldoldoldoldoldoldoldoldoldOLD", new: "did:key:z6MknewnewnewnewnewnewnewnewnewnewnewnewnewnewNEW", ...over });
  // ---------- the Town Hall (spec-deltas S1428): schema cases ----------
  const tpBody = (over: Record<string, unknown> = {}) => ({ title: "Add a study hour to the Academy", kind: "policy", key: "academy.study_hours", value: 2, opens_at: "2026-12-01T00:00:00Z", closes_at: "2026-12-08T00:00:00Z", ...over });
  sv("valid_town_proposal", "town_proposal", tpBody(), true);
  sv("valid_town_proposal_thread", "town_proposal", tpBody({ thread: "thread-42", value: { hours: 2 } }), true);
  sv("town_proposal_no_value", "town_proposal", (({ value: _v, ...r }) => r)(tpBody()), false);
  sv("town_proposal_unknown_kind", "town_proposal", tpBody({ kind: "coup" }), false);
  sv("town_proposal_bad_time", "town_proposal", tpBody({ closes_at: "soon" }), false);
  sv("valid_town_vote", "town_vote", { proposal: "rec-1", choice: "yes" }, true);
  sv("valid_town_vote_abstain", "town_vote", { proposal: "rec-1", choice: "abstain" }, true);
  sv("town_vote_bad_choice", "town_vote", { proposal: "rec-1", choice: "maybe" }, false);
  sv("town_vote_secret_field", "town_vote", { proposal: "rec-1", choice: "yes", secret: true }, false);
  const ttBody = (over: Record<string, unknown> = {}) => ({ proposal: "rec-1", yes_milli: 6000, no_milli: 2000, abstain_milli: 0, counted: 8, controllers: 8, quorum_met: true, passed: true, ...over });
  sv("valid_town_tally", "town_tally", ttBody(), true);
  sv("valid_town_tally_failed", "town_tally", ttBody({ passed: false, quorum_met: false }), true);
  sv("town_tally_negative_weight", "town_tally", ttBody({ yes_milli: -1 }), false);
  sv("town_tally_no_quorum_field", "town_tally", (({ quorum_met: _q, ...r }) => r)(ttBody()), false);
  sv("valid_town_enactment", "town_enactment", { proposal: "rec-1", tally: "rec-2", key: "academy.study_hours", value: 2 }, true);
  sv("town_enactment_no_tally", "town_enactment", { proposal: "rec-1", key: "academy.study_hours", value: 2 }, false);
  sv("town_enactment_extra", "town_enactment", { proposal: "rec-1", tally: "rec-2", key: "k", value: 2, force: true }, false);
  sv("valid_key_handover", "key_handover", hoBody(), true);
  sv("valid_key_handover_reason", "key_handover", hoBody({ reason: "compromise_suspected" }), true);
  sv("key_handover_no_new", "key_handover", (({ new: _n, ...r }) => r)(hoBody()), false);
  sv("key_handover_no_old", "key_handover", (({ old: _o, ...r }) => r)(hoBody()), false);
  sv("key_handover_unknown_reason", "key_handover", hoBody({ reason: "bored" }), false);
  sv("key_handover_carries_a_key", "key_handover", hoBody({ new_key: "abc" }), false);
  sv("valid_fleet_move", "fleet_move", { fleet: fl, member: "did:web:example.com:agents:coder-7", to: "platform" }, true);
  sv("valid_fleet_move_with_reason", "fleet_move", { fleet: fl, member: "did:web:example.com:agents:coder-7", to: "root", reason: "the team was closed" }, true);
  sv("fleet_move_no_target", "fleet_move", { fleet: fl, member: "did:web:example.com:agents:coder-7" }, false);
  sv("fleet_move_bad_target", "fleet_move", { fleet: fl, member: "did:web:example.com:agents:coder-7", to: "Platform Team" }, false);
  sv("fleet_move_unknown_field", "fleet_move", { fleet: fl, member: "did:web:example.com:agents:coder-7", to: "platform", force: true }, false);
  sv("valid_passport_node", "passport", { did: "did:web:example.com:agents:coder-8", kind: "agent", sponsor: "did:web:example.com:orgs:acme", fleet: fl, node: "platform", tier: 1, shape: {}, keys: [{ id: "did:web:example.com:agents:coder-8#key-1", type: "Ed25519", public_key: "A".repeat(43) }] }, true);
  sv("passport_bad_node", "passport", { did: "did:web:example.com:agents:coder-8", kind: "agent", sponsor: "did:web:example.com:orgs:acme", fleet: fl, node: "Platform Team", tier: 1, shape: {}, keys: [{ id: "did:web:example.com:agents:coder-8#key-1", type: "Ed25519", public_key: "A".repeat(43) }] }, false);
  const T = tmplMandate();
  const cases: { name: string; ceiling: Record<string, unknown>; candidate: Record<string, unknown> }[] = [
    ["the_same_mandate_is_within", {}], ["fewer_scopes", { scopes: ["repo.read"] }], ["a_scope_under_a_wildcard", { scopes: ["pr.open", "pr.merge"] }], ["a_scope_outside", { scopes: ["repo.read", "shell.exec"] }],
    ["a_lower_cap", { spend: { cap: 50, unit: "credit", per_action_max: 10 } }], ["a_higher_cap", { spend: { cap: 101, unit: "credit", per_action_max: 20 } }], ["a_higher_per_action_max", { spend: { cap: 100, unit: "credit", per_action_max: 21 } }],
    ["a_missing_per_action_max", { spend: { cap: 100, unit: "credit" } }], ["a_forbidden_means_dropped", { forbidden_means: [] }], ["more_forbidden_means", { forbidden_means: ["rm -rf", "curl | sh"] }],
    ["a_stricter_irreversible_policy", { irreversible: { policy: "forbid" } }], ["a_looser_irreversible_policy", { irreversible: { policy: "allow" } }], ["a_smaller_subcontract_depth", { subcontract: { allowed: true, max_depth: 1 } }],
    ["a_deeper_subcontract", { subcontract: { allowed: true, max_depth: 3 } }], ["subcontract_forbidden", { subcontract: { allowed: false } }], ["more_parallel_nodes", { nodes: { max_parallel: 5 } }], ["fewer_parallel_nodes", { nodes: { max_parallel: 2 } }],
    ["learning_not_shared", { learning: { scope: "memory", share_to_commons: false } }], ["a_deeper_learning_scope", { learning: { scope: "harness", share_to_commons: true } }], ["a_stricter_self_modification", { self_modification: "forbidden" }],
    ["a_looser_self_modification", { self_modification: "automatic_audited" }], ["more_checkpoints", { checkpoints: ["plan", "delivery"] }], ["fewer_checkpoints", { checkpoints: [] }], ["an_earlier_expiry", { expires: "2027-01-01T00:00:00Z" }],
    ["a_later_expiry", { expires: "2027-06-01T00:00:01Z" }], ["a_host_within", { network: { hosts: ["api.example.com"] } }], ["a_host_outside", { network: { hosts: ["evil.example.net"] } }], ["no_hosts", { network: { hosts: [] } }],
    ["a_smaller_institution_cap", { institution_spend: [{ institution: "academy", cap: { value: 30, unit: "credit" }, period: "month" }] }], ["a_larger_institution_cap", { institution_spend: [{ institution: "academy", cap: { value: 61, unit: "credit" }, period: "month" }] }],
    ["another_institution", { institution_spend: [{ institution: "shops", cap: { value: 10, unit: "credit" }, period: "month" }] }], ["a_longer_institution_period", { institution_spend: [{ institution: "academy", cap: { value: 10, unit: "credit" }, period: "week" }] }],
    ["no_institution_spend", { institution_spend: [] }],
    ["a_lower_token_budget", { token_budget: { per_run: 40000, per_month: 800000 } }], ["a_higher_token_run", { token_budget: { per_run: 60000, per_month: 800000 } }], ["a_higher_token_month", { token_budget: { per_run: 40000, per_month: 2000000 } }],
    ["a_dropped_token_limit", { token_budget: { per_run: 40000 } }], ["a_dropped_daily_cap", { token_budget: { per_run: 40000, per_month: 800000 } }], ["a_higher_daily_cap", { token_budget: { per_run: 40000, per_month: 800000, per_day: 400000 } }],
    ["lower_loop_limits", { loop_limits: { equivalent_calls: 5, depth: 2, near_repeats: 9 } }], ["more_equivalent_calls", { loop_limits: { equivalent_calls: 9, depth: 3, near_repeats: 12 } }], ["deeper_recursion", { loop_limits: { equivalent_calls: 8, depth: 4, near_repeats: 12 } }], ["more_near_repeats", { loop_limits: { equivalent_calls: 8, depth: 3, near_repeats: 13 } }], ["a_dropped_near_limit", { loop_limits: { equivalent_calls: 8, depth: 3 } }], ["a_dropped_loop_limit", { loop_limits: { depth: 3, near_repeats: 12 } }], ["a_redact_mode", { outbound_scan: { mode: "redact", kinds: ["secret", "card number"] } }], ["a_dropped_outbound_kind", { outbound_scan: { mode: "block", kinds: ["secret"] } }], ["an_added_outbound_kind", { outbound_scan: { mode: "block", kinds: ["secret", "card number", "email address"] } }], ["no_outbound_scan", { outbound_scan: undefined }], ["no_outbound_mode", { outbound_scan: { kinds: ["secret", "card number"] } }], ["no_loop_limits", { loop_limits: undefined }], ["no_token_budget", { token_budget: undefined }],
  ].map(([name, over]) => ({ name: name as string, ceiling: T, candidate: { ...T, ...(over as object) } }));
  const mt = {
    version: "asp.conformance/v0.2",
    violations: cases.map((c) => ({ ...c, expected: mandateViolations(c.ceiling, c.candidate) })),
    derive: [
      { name: "no_narrowing", template: T, contract: "sha256:" + "2".repeat(64), narrowing: null },
      { name: "a_valid_narrowing", template: T, contract: "sha256:" + "2".repeat(64), narrowing: { scopes: ["repo.read"], spend: { cap: 40, unit: "credit", per_action_max: 5 } } },
      { name: "a_widening_narrowing", template: T, contract: "sha256:" + "2".repeat(64), narrowing: { scopes: ["shell.exec"], spend: { cap: 400, unit: "credit", per_action_max: 5 } } },
      { name: "an_empty_narrowing", template: T, contract: "sha256:" + "2".repeat(64), narrowing: {} },
    ].map((c) => ({ ...c, expected: deriveMandate(c.template, c.contract, c.narrowing) })),
  };
  (globalThis as unknown as { __mandateTemplateVectors: unknown }).__mandateTemplateVectors = mt;
}
// ---------- the active Bank (spec-deltas S1405): schema cases ----------
{
  const h = "did:web:example.com:users:bank-holder";
  const amt = (v: number) => ({ value: v, unit: "credit" });
  sv("valid_bank_deposit", "bank_act", { act: "deposit", holder: h, amount: amt(300) }, true);
  sv("valid_bank_withdraw", "bank_act", { act: "withdraw", holder: h, amount: amt(100) }, true);
  sv("valid_bank_borrow", "bank_act", { act: "borrow", amount: amt(500) }, true);
  sv("valid_bank_repay", "bank_act", { act: "repay", amount: amt(200) }, true);
  sv("valid_bank_interest", "bank_act", { act: "interest", week: "2026-W46" }, true);
  sv("valid_bank_interest_week_53", "bank_act", { act: "interest", week: "2026-W53" }, true);
  sv("bank_unknown_act", "bank_act", { act: "lend", amount: amt(5) }, false);
  sv("bank_deposit_no_holder", "bank_act", { act: "deposit", amount: amt(5) }, false);
  sv("bank_deposit_no_amount", "bank_act", { act: "deposit", holder: h }, false);
  sv("bank_withdraw_no_amount", "bank_act", { act: "withdraw", holder: h }, false);
  sv("bank_borrow_names_a_holder", "bank_act", { act: "borrow", holder: h, amount: amt(5) }, false);
  sv("bank_interest_no_week", "bank_act", { act: "interest" }, false);
  sv("bank_interest_bad_week", "bank_act", { act: "interest", week: "2026-W54" }, false);
  sv("bank_interest_week_zero", "bank_act", { act: "interest", week: "2026-W00" }, false);
  sv("bank_interest_names_an_amount", "bank_act", { act: "interest", week: "2026-W46", amount: amt(5) }, false);
  sv("bank_repay_extra_field", "bank_act", { act: "repay", amount: amt(5), rate: 25 }, false);
}
// ---------- the Market's risk model (spec-deltas S1404): schema cases and the suggestion, identical in both SDKs ----------
const riskTerms = (over: Record<string, unknown> = {}) => ({
  class_permille: { trivial: -50, routine: 0, skilled: 50, critical: 150 }, verification_permille: { deterministic: -80, principal: 0, arbiter: 40 }, poster_permille: 120, escrow_share_permille: 800, ...over,
});
const riskAct = (over: Record<string, unknown> = {}) => ({ act: "risk_model", model_version: 1, terms: riskTerms(), effective_from: "2026-12-01T00:00:00Z", ...over });
sv("valid_market_risk_model", "market_act", riskAct(), true);
sv("valid_market_risk_model_zero", "market_act", riskAct({ terms: { class_permille: { trivial: 0, routine: 0, skilled: 0, critical: 0 }, verification_permille: { deterministic: 0, principal: 0, arbiter: 0 }, poster_permille: 0, escrow_share_permille: 1000 } }), true);
sv("market_risk_model_no_version", "market_act", riskAct({ model_version: undefined }), false);
sv("market_risk_model_version_zero", "market_act", riskAct({ model_version: 0 }), false);
sv("market_risk_model_no_terms", "market_act", riskAct({ terms: undefined }), false);
sv("market_risk_model_no_effective", "market_act", riskAct({ effective_from: undefined }), false);
sv("market_risk_model_class_term_too_big", "market_act", riskAct({ terms: riskTerms({ class_permille: { trivial: 0, routine: 0, skilled: 301, critical: 0 } }) }), false);
sv("market_risk_model_class_term_too_low", "market_act", riskAct({ terms: riskTerms({ verification_permille: { deterministic: -201, principal: 0, arbiter: 0 } }) }), false);
sv("market_risk_model_missing_class", "market_act", riskAct({ terms: riskTerms({ class_permille: { trivial: 0, routine: 0, skilled: 0 } }) }), false);
sv("market_risk_model_escrow_share_low", "market_act", riskAct({ terms: riskTerms({ escrow_share_permille: 499 }) }), false);
sv("market_risk_model_escrow_share_high", "market_act", riskAct({ terms: riskTerms({ escrow_share_permille: 1001 }) }), false);
sv("market_risk_model_poster_negative", "market_act", riskAct({ terms: riskTerms({ poster_permille: -1 }) }), false);
sv("market_risk_model_extra_term", "market_act", riskAct({ terms: riskTerms({ tier_bonus: 10 }) }), false);
sv("market_risk_model_float", "market_act", riskAct({ terms: riskTerms({ poster_permille: 12.5 }) }), false);
const riskCases: { name: string; terms: RiskTerms | null; input: RiskInput }[] = [
  { name: "no_model_is_the_floor_and_the_whole_price", terms: null, input: { price: 80, floorPermille: 400, jobClass: "routine", verification: "principal", posterLostPermille: 0 } },
  { name: "routine_principal_no_poster_record", terms: riskTerms() as RiskTerms, input: { price: 100, floorPermille: 300, jobClass: "routine", verification: "principal", posterLostPermille: 0 } },
  { name: "critical_arbiter_raises_it", terms: riskTerms() as RiskTerms, input: { price: 200, floorPermille: 300, jobClass: "critical", verification: "arbiter", posterLostPermille: 0 } },
  { name: "deterministic_tests_lower_it", terms: riskTerms() as RiskTerms, input: { price: 100, floorPermille: 300, jobClass: "trivial", verification: "deterministic", posterLostPermille: 0 } },
  { name: "a_poster_who_lost_every_dispute", terms: riskTerms() as RiskTerms, input: { price: 100, floorPermille: 300, jobClass: "routine", verification: "principal", posterLostPermille: 1000 } },
  { name: "a_poster_who_lost_a_third_rounds", terms: riskTerms() as RiskTerms, input: { price: 100, floorPermille: 300, jobClass: "routine", verification: "principal", posterLostPermille: 333 } },
  { name: "half_a_permille_rounds_up", terms: riskTerms({ poster_permille: 3 }) as RiskTerms, input: { price: 100, floorPermille: 300, jobClass: "routine", verification: "principal", posterLostPermille: 500 } },
  { name: "capped_at_the_whole_price", terms: riskTerms() as RiskTerms, input: { price: 100, floorPermille: 900, jobClass: "critical", verification: "arbiter", posterLostPermille: 1000 } },
  { name: "never_below_zero", terms: riskTerms({ class_permille: { trivial: -200, routine: -200, skilled: -200, critical: -200 }, verification_permille: { deterministic: -200, principal: -200, arbiter: -200 } }) as RiskTerms, input: { price: 100, floorPermille: 50, jobClass: "trivial", verification: "deterministic", posterLostPermille: 0 } },
  { name: "the_bond_rounds_up", terms: riskTerms() as RiskTerms, input: { price: 7, floorPermille: 333, jobClass: "routine", verification: "principal", posterLostPermille: 0 } },
  { name: "a_poster_share_above_1000_is_capped", terms: riskTerms() as RiskTerms, input: { price: 100, floorPermille: 300, jobClass: "routine", verification: "principal", posterLostPermille: 5000 } },
];
const riskRemoves = [
  { name: "zero_after_a_model_only_removes_rule", prev: riskTerms() as RiskTerms, next: riskTerms({ class_permille: { trivial: -50, routine: 0, skilled: 0, critical: 0 }, poster_permille: 0, escrow_share_permille: 1000 }) as RiskTerms },
  { name: "a_higher_term_adds_rule", prev: riskTerms() as RiskTerms, next: riskTerms({ poster_permille: 121 }) as RiskTerms },
  { name: "a_lower_escrow_share_adds_rule", prev: riskTerms() as RiskTerms, next: riskTerms({ escrow_share_permille: 799 }) as RiskTerms },
  { name: "the_same_model_only_removes_nothing", prev: riskTerms() as RiskTerms, next: riskTerms() as RiskTerms },
].map((c) => ({ ...c, expected: onlyRemovesRule(c.prev, c.next) }));
const risk = { version: "asp.conformance/v0.2", model: "asp-risk-model/1", suggest: riskCases.map((c) => ({ ...c, expected: suggestRisk(c.terms, c.input) })), onlyRemoves: riskRemoves };
// ---------- cognition telemetry: the derived measures, identical in both SDKs (DK195) ----------
type TItem = { p: number; outcome: 0 | 1 };
const thin: TItem[] = [{ p: 0.9, outcome: 1 }, { p: 0.7, outcome: 0 }, { p: 0.2, outcome: 0 }, { p: 0.5, outcome: 1 }, { p: 0.05, outcome: 0 }];
const many: TItem[] = Array.from({ length: 60 }, (_, i) => ({ p: Math.min(0.99, Math.max(0.01, ((i * 37) % 100) / 100)), outcome: ((i * 13) % 7 < 3 ? 1 : 0) as 0 | 1 }));
const telemetry = [
  { name: "brier_thin", fn: "brier", input: { items: thin }, expected: tBrier(thin), exact: true },
  { name: "brier_many", fn: "brier", input: { items: many }, expected: tBrier(many), exact: true },
  { name: "brier_flat_half", fn: "brier", input: { items: [{ p: 0.5, outcome: 1 }, { p: 0.5, outcome: 0 }] }, expected: tBrier([{ p: 0.5, outcome: 1 }, { p: 0.5, outcome: 0 }]), exact: true },
  { name: "mean_surprisal_thin", fn: "mean_surprisal", input: { items: thin }, expected: tMeanSurprisal(thin), exact: true },
  { name: "mean_surprisal_many", fn: "mean_surprisal", input: { items: many }, expected: tMeanSurprisal(many), exact: true },
  ...[[0.9, 1], [0.9, 0], [0.5, 1], [0.01, 1], [0.99, 0], [0.333, 1]].map(([p, o]) => ({ name: `surprisal_${p}_${o}`, fn: "surprisal", input: { p, outcome: o }, expected: tSurprisal(p, o as 0 | 1), exact: false })),
  ...[[0.8, 0.5], [0.5, 0.5], [0.9, 0.2], [1, 0.5], [0, 0.4], [0.35, 0.7]].map(([post, prior]) => ({ name: `kl_${post}_${prior}`, fn: "kl_bits", input: { post, prior }, expected: tKl(post, prior), exact: false })),
  ...[[0.5, 4], [0.2, 0.5], [0.9, 1], [0.1, 9]].map(([prior, lr]) => ({ name: `normative_${prior}_${lr}`, fn: "normative_posterior", input: { prior, lr }, expected: tNormative(prior, lr), exact: false })),
  { name: "calibration_thin_withholds_ece", fn: "calibration", input: { items: thin, bins: 5 }, expected: tCalibration(thin, 5), exact: true },
  { name: "calibration_many_has_ece", fn: "calibration", input: { items: many, bins: 5 }, expected: tCalibration(many, 5), exact: true },
  { name: "calibration_many_ten_bins", fn: "calibration", input: { items: many, bins: 10 }, expected: tCalibration(many, 10), exact: true },
];
// ---------- write ----------

mkdirSync(OUT, { recursive: true });
const write = (file: string, data: unknown) => writeFileSync(join(OUT, file), JSON.stringify(data, null, 2) + "\n");
writeFileSync(join(HERE, "keys.json"), JSON.stringify(keysFile, null, 2) + "\n");
write("canonical.json", { version: "asp.conformance/v0.2", cases: canonical });
write("schema.json", { version: "asp.conformance/v0.2", cases: schema });
write("records.json", { version: "asp.conformance/v0.2", cases: records });
write("lifecycle.json", { version: "asp.conformance/v0.2", cases: lifecycle });
write("telemetry.json", { version: "asp.conformance/v0.2", note: "exact: every number is identical in both languages; otherwise equal to 1e-9", cases: telemetry });
write("risk.json", risk);
write("mandate-template.json", (globalThis as unknown as { __mandateTemplateVectors: unknown }).__mandateTemplateVectors);
write("data-handling.json", (globalThis as unknown as { __dataHandlingVectors: unknown }).__dataHandlingVectors);
write("world.json", { version: "asp.conformance/v0.2", generator: GENERATOR, commitments: ["", "vector-seed", "another-seed"].map((x) => ({ seed: x, commitment: seedCommitment(x) })), generate: worldGen, rules: worldRules });
console.log(`canonical ${canonical.length}, schema ${schema.length}, records ${records.length}, lifecycle ${lifecycle.length}`);
