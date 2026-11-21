/**
 * A fixture for the Academy's tests (academy.md; DK24 to DK26): a log with the society's accounts, people, agents with sponsors, a price list with the Academy's services, running jobs (so an agent has Actions
 * to cite as run logs), and the Registrar's records (exams, results, certificates, arenas). Fake keys only. Credits are accounting entries, not money.
 */
import { createRecord, cosign, b64urlEncode, signerFromSeed, staticResolver, type AspRecord, type RecordType, type Signer } from "@agent-social/asp-core";
import { BURN_DID, CLINIC_DID, EventLog, MemoryStore, REGISTRAR_DID, TREASURY_DID, examSeed, examVariant, institutionDid } from "../src/index.ts";
import { failure } from "./harness.ts";

export type Party = { did: string } & Signer & { publicKey: Uint8Array };
export const party = (did: string, n: number): Party => ({ did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(32).fill(n)) });
export const credit = (value: number) => ({ value, unit: "credit" as const });
export const hashOf = (c: string) => "sha256:" + c.repeat(64);
export const refused = async (p: Promise<unknown>) => { const f = await failure(p); return f?.detail ?? f?.code; };

export const operator = party("did:web:asp.local:operator", 11);
export const owner = party("did:web:asp.local:owner", 12);
export const treasury = party(TREASURY_DID, 13);
export const registrar = party(REGISTRAR_DID, 50);
export const clinic = party(CLINIC_DID, 53);
export const courts = party(institutionDid("courts"), 54);
export const bankP = party("did:web:asp.local:bank", 55);
export const SERVICES = { sitting: "academy.exam_sitting", foundations: "academy.course.foundations", practitioner: "academy.course.practitioner", arena: "academy.arena_entry" };

export class Kit {
  readonly log: EventLog;
  private ms = Date.parse("2026-11-01T00:00:00Z");
  list = "";
  private n = 0;
  readonly jobs = new Map<string, { contract: string; mandate: string }>();
  private readonly people = new Map<string, Party>();

  constructor(log?: EventLog) {
    const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP].map((p) => [p.kid, p.publicKey])));
    this.log = log ?? new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
  }

  now = (): string => new Date(this.ms).toISOString().replace(".000Z", "Z");
  tick = (): string => new Date((this.ms += 60_000)).toISOString().replace(".000Z", "Z");
  /** Moves the fixture's clock to a time (never backwards). */
  at(iso: string): void { this.ms = Math.max(this.ms, Date.parse(iso)); }
  addDays(d: number): void { this.ms += d * 86_400_000; }

  mk(type: RecordType, by: Party, body: Record<string, unknown>, prev: string | null = null, opts: { subject?: string | null; cosigners?: Party[]; at?: string } = {}): AspRecord {
    let r = createRecord({ type, issuer: by.did, subject: opts.subject ?? null, body, prev, issued_at: opts.at ?? this.tick() }, by);
    for (const c of opts.cosigners ?? []) r = cosign(r, c);
    return r;
  }
  async put(r: AspRecord): Promise<string> { return (await this.log.append(r)).id; }
  mint = (to: string, value: number) => this.put(this.mk("mint", operator, { to, amount: credit(value), reason: "bootstrap", authority: "operator" }, null, { subject: to }));

  async person(name: string): Promise<Party> {
    const p = party(`did:web:example.com:users:${name}`, 100 + ++this.n);
    await this.put(this.mk("passport", p, { did: p.did, kind: "human", keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }] }, null, { subject: p.did }));
    this.people.set(p.did, p);
    return p;
  }
  async agent(name: string, sponsor?: Party, tier = 1): Promise<Party> {
    const s = sponsor ?? (await this.person(`sponsor-of-${name}`));
    const p = party(`did:web:example.com:agents:${name}`, 100 + ++this.n);
    await this.put(this.mk("passport", s, { did: p.did, kind: "agent", sponsor: s.did, tier, shape: {}, keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }] }, null, { subject: p.did }));
    this.people.set(p.did, p);
    this.sponsors.set(p.did, s);
    return p;
  }
  readonly sponsors = new Map<string, Party>();

  /** The Academy's price list (the services this fixture sells), issued once. */
  async priceList(): Promise<string> {
    if (this.list) return this.list;
    const academy = institutionDid("academy");
    const sp = (t: number, b: number, a: number) => ({ treasury_permille: t, burn_permille: b, payees: [{ account: academy, permille: a }] });
    const item = (service: string, price: number, split: unknown) => ({ service, institution: academy, price, split, class: "standard" });
    const at = this.tick();
    const body = { version: 1, effective_from: at, bounds_version: 1, job_tax_permille: 50, items: [item(SERVICES.sitting, 20, sp(200, 100, 700)), item(SERVICES.foundations, 30, sp(150, 50, 800)), item(SERVICES.practitioner, 120, sp(150, 50, 800)), item(SERVICES.arena, 10, sp(100, 50, 850))] };
    this.list = await this.put(this.mk("price_list", treasury, body, null, { at }));
    return this.list;
  }

  /** A running job for an agent with a Mandate that lets it spend at the Academy: gives it Actions to cite as run logs. */
  async job(agent: Party, cap = 100): Promise<{ contract: string; mandate: string }> {
    await this.priceList();
    const principal = await this.person(`principal-${++this.n}`);
    await this.mint(principal.did, 100);
    const contract = cosign(this.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `A job (${this.n})`, price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await this.put(contract);
    const bond = this.mk("bond", principal, { contract: contract.id, backer: principal.did, amount: credit(5), escrow: { payer: principal.did, amount: credit(10) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await this.put(bond);
    const mandate = this.mk("mandate", principal, { contract: contract.id, purpose: "Study", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true, institution_spend: [{ institution: "academy", cap: credit(cap), period: "month" }] }, bond.id, { subject: agent.did });
    await this.put(mandate);
    const j = { contract: contract.id, mandate: mandate.id };
    this.jobs.set(agent.did, j);
    return j;
  }
  /** One accepted, settled job of price 100 for the agent from the principal: a qualifying job when the two are independent (credits.md 5.4). */
  async acceptedJob(principal: Party, agent: Party): Promise<void> {
    await this.priceList();
    await this.mint(principal.did, 100); await this.mint(agent.did, 20);
    const contract = cosign(this.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `Qualifying job ${++this.n}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await this.put(contract);
    const bond = this.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await this.put(bond);
    const mandate = this.mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
    await this.put(mandate);
    const delivery = this.mk("delivery", agent, { contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, mandate.id, { subject: contract.id });
    await this.put(delivery);
    const accept = this.mk("attestation", principal, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, { subject: contract.id });
    await this.put(accept);
    await this.put(this.mk("settlement", bankP, { contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: credit(96), fees: credit(4), bond_returned: credit(20), bond_slashed: credit(0) }, accept.id, { subject: contract.id }));
  }
  /** An Action of the agent (its run log for one sitting, exercise or match): a new one each time. */
  async act(agent: Party): Promise<string> {
    const j = this.jobs.get(agent.did) ?? (await this.job(agent));
    return this.put(this.mk("action", agent, { contract: j.contract, scopes_used: [], summary: `run ${++this.n}` }, null, { subject: j.contract }));
  }
  async buy(agent: Party, service: string, amount: number, over: Record<string, unknown> = {}): Promise<string> {
    const j = this.jobs.get(agent.did) ?? (await this.job(agent));
    await this.priceList();
    return this.put(this.mk("purchase", agent, { service, institution: institutionDid("academy"), price_list: this.list, quantity: 1, amount: credit(amount), mandate: j.mandate, idempotency: `n-${++this.n}`, ...over }, null, { subject: agent.did }));
  }
  /** Funds an agent with credits (a signed mint) so it can pay fees. */
  fund = (agent: Party, value: number) => this.mint(agent.did, value);

  // ---- the Registrar's records ----
  async defineExam(exam: string, skill: string, level: number, over: Record<string, unknown> = {}): Promise<string> {
    return this.put(this.mk("exam", registrar, { exam, skill, level, suite_hash: hashOf("9"), pass_mark_permille: 800, pool_size: 40, categories: ["mandate", "refusal", "irreversible", "recoverable"], max_sittings: 3, window_days: 30, sitting_service: SERVICES.sitting, ...over }, null, { subject: null }));
  }
  /** One sitting of an exam, scored by the Registrar: pays the fee, runs, and records the result (the pass mark and variant are the rule's, so a result that departs from them is refused). */
  async sit(agent: Party, examId: string, scorePermille: number, over: Record<string, unknown> = {}, passMark = 800, sittingsBefore = 0, usedVariants: number[] = [], poolSize = 40): Promise<string> {
    const fee = await this.buy(agent, SERVICES.sitting, 20);
    const run = await this.act(agent);
    const attempt = sittingsBefore + 1;
    const seed = examSeed(examId, agent.did, attempt);
    return this.put(this.mk("exam_result", registrar, { exam: examId, holder: agent.did, score_permille: scorePermille, pass_mark_permille: passMark, passed: scorePermille >= passMark, attempt, variant: examVariant(seed, poolSize, usedVariants), seed, sitting: fee, run_log_hash: run, missed_categories: scorePermille >= passMark ? [] : ["refusal"], ...over }, null, { subject: agent.did }));
  }
  certificate(holder: Party, skill: string, level: number, examResult: string, over: Record<string, unknown> = {}, by: Party = registrar): AspRecord {
    const issued = this.tick();
    return this.mk("certificate", by, { holder: holder.did, skill, level, issued, expires: new Date(Date.parse(issued) + 180 * 86_400_000).toISOString().replace(".000Z", "Z"), exam_result: examResult, ...over }, null, { subject: holder.did, at: issued });
  }
  private exams = new Map<string, string>();
  /** A passed exam result for the skill at the level (the exam is defined once; the holder is funded for the fee). */
  async passedResult(agent: Party, skill: string, level: number): Promise<string> {
    const key = `${skill}-${level}-v1`;
    let def = this.exams.get(key);
    if (!def) { def = await this.defineExam(key, skill, level); this.exams.set(key, def); }
    await this.fund(agent, 40);
    return this.sit(agent, def, 900);
  }
  /** A passed exam and the certificate it earns, end to end: the holder gets a certificate for the skill at the level. */
  async certify(agent: Party, skill: string, level: number): Promise<string> {
    return this.put(this.certificate(agent, skill, level, await this.passedResult(agent, skill, level)));
  }
  revoke(certificate: string, reason: string, by: Party = registrar, evidence = "the facts"): AspRecord {
    return this.mk("certificate_revocation", by, { certificate, reason, evidence }, null, { subject: null });
  }
  promote(holder: Party, from: number, to: number, certificates: string[], over: Record<string, unknown> = {}): AspRecord {
    return this.mk("tier_promotion", registrar, { holder: holder.did, from, to, certificates, ...over }, null, { subject: holder.did });
  }
}
