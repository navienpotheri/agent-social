/**
 * A small kit for the institution tests (Market, Registry, Courts): a log with an operator, signed mints, a price list, people and agents,
 * and a job that runs from contract to settlement. Fake keys only. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { createRecord, cosign, b64urlEncode, signerFromSeed, staticResolver, type AspRecord, type RecordType, type Signer } from "@agent-social/asp-core";
import { BURN_DID, EventLog, MemoryStore, REGISTRAR_DID, TREASURY_DID, examSeed, examVariant, institutionDid } from "../src/index.ts";
import { bank, registerParties } from "./harness.ts";

export type Party = { did: string } & Signer & { publicKey: Uint8Array };
export const party = (did: string): Party => ({ did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(createHash("sha256").update(did).digest())) });
export const credit = (value: number) => ({ value, unit: "credit" as const });

export const operator = party("did:web:asp.local:operator");
export const owner = party("did:web:asp.local:owner");
export const treasury = party(TREASURY_DID);
export const market = party(institutionDid("market"));
export const registrar = party(REGISTRAR_DID);
export const courts = party(institutionDid("courts"));
export const shops = party(institutionDid("shops"));
export const housing = party(institutionDid("housing"));
export const events = party(institutionDid("events"));
export const research = party(institutionDid("research"));
export const auditor = party("did:web:asp.local:auditor");
export const telemetry = party("did:web:asp.local:telemetry");
export const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, market, registrar, courts, shops, housing, events, research, auditor, telemetry].map((p) => [p.kid, p.publicKey])));

let clockMs = Date.parse("2026-11-01T00:00:00Z");
export const tick = (): string => new Date((clockMs += 60_000)).toISOString().replace(".000Z", "Z");
/** Moves the test clock forward; returns the new time. */
export const jump = (ms: number): string => { clockMs += ms; return tick(); };
export const nowIso = (): string => new Date(clockMs).toISOString().replace(".000Z", "Z");
export const DAY = 86_400_000;

export function mk(type: RecordType, by: Party | Signer & { did: string }, body: Record<string, unknown>, prev: string | null = null, opts: { subject?: string | null; at?: string; cosigners?: (Party | Signer)[] } = {}): AspRecord {
  let r = createRecord({ type, issuer: by.did, subject: opts.subject ?? null, body, prev, issued_at: opts.at ?? tick() }, by as Signer);
  for (const c of opts.cosigners ?? []) r = cosign(r, c as Signer);
  return r;
}

export const keysOf = (p: Party) => [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }];

const DEPOSIT = { treasury_permille: 150, burn_permille: 100, payees: [{ account: market.did, permille: 750 }] };
const NAME = { treasury_permille: 200, burn_permille: 100, payees: [{ account: institutionDid("registry"), permille: 700 }] };
const FEE0A = { treasury_permille: 200, burn_permille: 0, payees: [{ account: institutionDid("academy"), permille: 800 }] };
const FEE0 = { treasury_permille: 200, burn_permille: 0, payees: [{ account: institutionDid("courts"), permille: 800 }] };
export const PRICES = [
  { service: "market.posting.deposit", institution: market.did, price: 2, split: DEPOSIT, class: "standard" },
  { service: "registry.name.claim", institution: institutionDid("registry"), price: 10, split: NAME, class: "standard" },
  { service: "registry.name.renew", institution: institutionDid("registry"), price: 5, split: NAME, class: "standard" },
  { service: "academy.exam_sitting", institution: institutionDid("academy"), price: 20, split: FEE0A, class: "essential" },
  { service: "courts.appeal.small", institution: institutionDid("courts"), price: 5, split: FEE0, class: "essential" },
  { service: "courts.appeal.standard", institution: institutionDid("courts"), price: 20, split: FEE0, class: "essential" },
];

export async function kit(extra: { bondFloor?: "legacy" | "v2"; jurors?: boolean } = {}) {
  clockMs = Date.parse("2026-11-01T00:00:00Z"); // every log is new, so each test starts its own clock
  const log = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver, now: () => new Date(clockMs), ...(extra.bondFloor ? { bondFloor: extra.bondFloor } : {}) });
  await registerParties(log); // alice (a sponsor), the coder agent, the bank
  let n = 0;
  const holderParty = new Map<string, Party>();
  const contractOf = new Map<string, string>();
  const mint = (to: string, value: number) => log.append(mk("mint", operator, { to, amount: credit(value), reason: "test", authority: "operator" }, null, { subject: to }));
  const person = async (name: string, funds = 0): Promise<Party> => {
    const p = party(`did:web:example.com:users:${name}`);
    await log.append(mk("passport", p, { did: p.did, kind: "human", keys: keysOf(p) }, null, { subject: p.did }));
    if (funds) await mint(p.did, funds);
    return p;
  };
  const agent = async (name: string, sponsor: Party, o: { tier?: number; skills?: string[]; funds?: number; fleet?: string } = {}): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${name}`);
    holderParty.set(a.did, a);
    await log.append(mk("passport", sponsor, { did: a.did, kind: "agent", sponsor: sponsor.did, tier: o.tier ?? 1, shape: {}, keys: keysOf(a), ...(o.skills ? { capabilities: o.skills.map((skill) => ({ skill })) } : {}) }, null, { subject: a.did }));
    if (o.funds) await mint(a.did, o.funds);
    return a;
  };
  /**
   * A certificate backed by a passed exam, as the Academy's rule requires: the exam is defined once per skill and level, the holder pays the sitting fee (an essential item, so no Mandate),
   * cites an Action of its own as the run log, the Registrar records the passed result, and the certificate rests on it. The holder needs a running job for the Action, made once.
   */
  const exams = new Map<string, string>();
  const jobs = new Map<string, string>();
  const cert = async (holder: string, skill: string, level = 1, days = 180) => {
    const key = `${skill}-${level}`;
    if (!exams.has(key)) { const e = mk("exam", registrar, { exam: key, skill, level, suite_hash: "sha256:" + "9".repeat(64), pass_mark_permille: 800, pool_size: 40, categories: ["mandate", "refusal", "irreversible", "recoverable"], max_sittings: 3, window_days: 30, sitting_service: "academy.exam_sitting" }); await log.append(e); exams.set(key, e.id); }
    const examId = exams.get(key)!;
    const who = holderParty.get(holder)!;
    if (!jobs.has(holder)) jobs.set(holder, await openMandate(who, [{ institution: "market", cap: credit(10), period: "month" }]));
    await mint(holder, 20);
    const fee = mk("purchase", who, { service: "academy.exam_sitting", institution: institutionDid("academy"), price_list: listId, quantity: 1, amount: credit(20), idempotency: `n-${++n}` }, null, { subject: holder });
    await log.append(fee);
    const act = mk("action", who, { contract: contractOf.get(holder)!, scopes_used: [], summary: `exam run ${n}` }, null, { subject: contractOf.get(holder)! });
    await log.append(act);
    const seed = examSeed(examId, holder, 1);
    const result = mk("exam_result", registrar, { exam: examId, holder, score_permille: 900, pass_mark_permille: 800, passed: true, attempt: 1, variant: examVariant(seed, 40, []), seed, sitting: fee.id, run_log_hash: act.id, missed_categories: [] }, null, { subject: holder });
    await log.append(result);
    const issued = tick();
    return log.append(mk("certificate", registrar, { holder, skill, level, issued, expires: new Date(Date.parse(issued) + days * DAY).toISOString().replace(".000Z", "Z"), exam_result: result.id }, null, { subject: holder, at: issued }));
  };
  const issueList = async (items: unknown[] = PRICES, prev: string | null = null) => { const at = tick(); return (await log.append(mk("price_list", treasury, { version: 1, effective_from: at, bounds_version: 1, job_tax_permille: 20, items }, prev, { at }))).id; };
  let listId = "";
  const withPrices = async () => { listId = await issueList(); return listId; };
  const buy = async (by: Party, service: string, amount: number, o: { mandate?: string } = {}) => {
    const item = PRICES.find((i) => i.service === service)!;
    const p = mk("purchase", by, { service, institution: item.institution, price_list: listId, quantity: 1, amount: credit(amount), idempotency: `n-${++n}`, ...(o.mandate ? { mandate: o.mandate } : {}) });
    await log.append(p);
    return p.id;
  };
  /** A Mandate for an agent that lets it spend on institutions (an agent buys only what its Mandate lists), funded by a fresh person on a small job. */
  const openMandate = async (a: Party, spend: unknown[] = [{ institution: "registry", cap: credit(70), period: "month" }, { institution: "market", cap: credit(30), period: "month" }]) => {
    const funder = await person(`mandate-funder-${++n}`, 20);
    const contract = cosign(mk("contract", funder, { principal: funder.did, performer: a.did, bank: bank.did, purpose: `Open a mandate ${n}`, price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: a.did }), a as Signer);
    await log.append(contract);
    const bond = mk("bond", funder, { contract: contract.id, backer: funder.did, amount: credit(2), escrow: { payer: funder.did, amount: credit(10) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await log.append(bond);
    const m = mk("mandate", funder, { contract: contract.id, purpose: "Spend within the budget", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, institution_spend: spend }, bond.id, { subject: a.did });
    await log.append(m);
    contractOf.set(a.did, contract.id);
    return m.id;
  };
  const intent = async (poster: Party, o: Record<string, unknown> = {}) => {
    const r = mk("intent", poster, { purpose: `Job ${++n}`, acceptance_criteria: ["done"], budget: credit(60), deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" }, ...o }, null, { subject: poster.did });
    await log.append(r);
    return r.id;
  };
  const offer = async (a: Party, intentId: string, price = 60) => {
    const r = mk("offer", a, { intent: intentId, price: credit(price), plan: "do it", eta: "2027-05-01T00:00:00Z", bond_offered: credit(0) }, null, { subject: a.did });
    await log.append(r);
    return r.id;
  };
  /** A contract (principal to performer) on an intent and offer, bonded and mandated, delivered and accepted, settled with the job tax. Returns the contract id. */
  const runJob = async (principal: Party, performer: Party, price: number, basis?: { intent: string; offer: string }, o: { settle?: boolean } = {}) => {
    const fee = Math.floor((price * 20) / 1000);
    const contract = cosign(mk("contract", principal, { principal: principal.did, performer: performer.did, bank: bank.did, purpose: `Run ${++n}`, price: credit(price), verification: "principal", deadline: "2027-12-03T18:00:00Z", basis: basis ?? { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: performer.did }), performer as Signer);
    await log.append(contract);
    const bond = mk("bond", performer, { contract: contract.id, backer: performer.did, amount: credit(0), escrow: { payer: principal.did, amount: credit(price + fee) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await log.append(bond);
    const mandate = mk("mandate", principal, { contract: contract.id, purpose: "Do the job", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true }, bond.id, { subject: performer.did });
    await log.append(mandate);
    const delivery = mk("delivery", performer, { contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, mandate.id, { subject: contract.id });
    await log.append(delivery);
    if (o.settle === false) return { contract: contract.id, delivery: delivery.id, bond: bond.id, mandate: mandate.id };
    const accept = mk("attestation", principal, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, { subject: contract.id });
    await log.append(accept);
    await log.append(mk("settlement", bank, { contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: credit(price), fees: credit(fee), bond_returned: credit(0), bond_slashed: credit(0) }, accept.id, { subject: contract.id, cosigners: [principal] }));
    return { contract: contract.id, delivery: delivery.id, bond: bond.id, mandate: mandate.id };
  };
  return { log, mint, person, agent, cert, issueList, withPrices, buy, openMandate, intent, offer, runJob, listId: () => listId };
}

/** The log rule that refused (its name), or the error code for a refusal that is not a named rule; undefined if it was accepted. */
export async function refusedBy(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; } catch (e) { const x = e as { detail?: string; code?: string }; return x.detail ?? x.code; }
}
export { BURN_DID, TREASURY_DID };
