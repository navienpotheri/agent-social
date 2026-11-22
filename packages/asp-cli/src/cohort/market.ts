/**
 * The Market of the cohort runner's local society (register row DK1801, slice 2): a hall on the run's own ASP log where an agent can post a job from its own mock credits, make an offer on another agent's job, accept an
 * offer, deliver and accept a delivery, with every step a signed record of the log and the credits moving through the log's own escrow and settlement rules. The runner holds each agent's throwaway key and the keys of
 * the local institutions (operator, owner, Treasury, the Market, a bank), all generated in memory for the run and never saved; it acts as each agent's clerk and signs only what the agent's tool call asks for.
 * It seeds a price list and a few house jobs so that the board is not empty. Credits are mock accounting entries, not money.
 */
import { b64urlEncode, cosign, createRecord, publicKeyFromSeed, randomSeed, type AspRecord, type Signer } from "@agent-social/asp-core";
import { createHash } from "node:crypto";
import { institutionDid, REGISTRAR_DID, SEED_JOBS, SEED_PREFIX, TREASURY_DID } from "@agent-social/asp-log";
import { courseItem, courseService, engineIds, ENGINES, loadCatalogue, practiceSeed, type CourseCard } from "../lens-courses/index.ts";
import { Ledger, SittingRefused, completeSitting, describeSitting, openEnrolment, courseRecordFor, runSitting } from "../lens-courses/sitting.ts";
import type { LocalLog } from "@agent-social/asp-package";
import type { AgentCtx } from "./types.ts";

export interface Party { did: string; kid: string; seed: Uint8Array }
const newParty = (did: string): Party => ({ did, kid: `${did}#key-1`, seed: randomSeed() });
const keysOf = (p: Party) => [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(p.seed)) }];
const signer = (p: Party): Signer => ({ kid: p.kid, seed: p.seed }) as Signer;
const credit = (value: number) => ({ value, unit: "credit" as const });

/** The local institutions' parties. Made before the log is opened, because the log needs the operator's and owner's DIDs at open. */
export function makeParties() {
  return {
    operator: newParty("did:web:cohort.local:operator"), owner: newParty("did:web:cohort.local:owner"), treasury: newParty(TREASURY_DID), market: newParty(institutionDid("market")),
    bank: newParty("did:web:cohort.local:bank"), registrar: newParty(REGISTRAR_DID), house: newParty("did:web:cohort.local:users:house"),
  };
}
export type Parties = ReturnType<typeof makeParties>;

const DEPOSIT = { treasury_permille: 150, burn_permille: 100, payees: [{ account: institutionDid("market"), permille: 750 }] };
const START_CREDITS = 100;
const JOB_DAYS = 7;

interface Enrolled { agent: AgentCtx; party: Party; mandate: string; contract: string }

export class MarketHall {
  private readonly log: LocalLog;
  private readonly p: Parties;
  private readonly now: () => Date;
  private last = 0;
  private n = 0;
  private priceList = "";
  private readonly courses: CourseCard[] = [];
  private readonly ledger = new Ledger();
  private readonly agents = new Map<string, Enrolled>(); // did -> enrolled
  private readonly byHandle = new Map<string, Enrolled>();
  private readonly contractState = new Map<string, { contract: string; mandate: string; bond: string; principal: string; performer: string; price: number; delivery?: string; settled?: boolean; offer: string; intent: string }>();

  constructor(o: { log: LocalLog; parties: Parties; now: () => Date }) { this.log = o.log; this.p = o.parties; this.now = o.now; }

  /** A time that never goes back: each record is a second after the last. */
  private at(): string { const t = Math.max(this.now().getTime(), this.last + 1000); this.last = t; return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"); }
  private mk(type: string, by: Party, body: Record<string, unknown>, prev: string | null = null, subject: string | null = null, cosigners: Party[] = [], at?: string): AspRecord {
    let r = createRecord({ type: type as never, issuer: by.did, subject, prev, body, issued_at: at ?? this.at() }, signer(by));
    for (const c of cosigners) r = cosign(r, signer(c));
    return r;
  }
  private async put(r: AspRecord): Promise<string> { return (await this.log.append(r)).id; }

  /** Mock credits for a party (the log names no operator here, so a mint is direct). */
  private async mint(to: string, value: number): Promise<void> { await this.log.mint(to, value); }

  /** Registers the local institutions, issues the price list and posts a few house jobs. */
  async init(seedJobs = 3, courseIds: string[] = ["C-L2-1"]): Promise<void> {
    for (const party of [this.p.operator, this.p.owner, this.p.treasury, this.p.market, this.p.bank, this.p.registrar, this.p.house]) await this.put(this.mk("passport", party, { did: party.did, kind: "human", keys: keysOf(party) }, null, party.did));
    // The Academy: one teacher agent (and two reviewers) under the house, the courses priced in the price list and published with the Registrar's cosignature.
    const catalogue = loadCatalogue(engineIds()).courses;
    const cards = courseIds.map((id) => catalogue.find((c) => c.id === id)).filter((c): c is CourseCard => !!c);
    const teacher = newParty("did:web:cohort.local:agents:house-teacher"), r1 = newParty("did:web:cohort.local:agents:house-reviewer-1"), r2 = newParty("did:web:cohort.local:agents:house-reviewer-2");
    // The log wants a course's reviews from sponsors other than the instructor's: each reviewer has a sponsor of its own.
    const rs1 = newParty("did:web:cohort.local:users:reviewer-sponsor-1"), rs2 = newParty("did:web:cohort.local:users:reviewer-sponsor-2");
    if (cards.length) {
      for (const sp of [rs1, rs2]) await this.put(this.mk("passport", sp, { did: sp.did, kind: "human", keys: keysOf(sp) }, null, sp.did));
      for (const [a, sp] of [[teacher, this.p.house], [r1, rs1], [r2, rs2]] as const) await this.put(this.mk("passport", sp, { did: a.did, kind: "agent", sponsor: sp.did, tier: 1, shape: {}, keys: keysOf(a) }, null, a.did));
    }
    const effective = this.at();
    const list = this.mk("price_list", this.p.treasury, { version: 1, effective_from: effective, bounds_version: 1, job_tax_permille: 20, items: [{ service: "market.posting.deposit", institution: this.p.market.did, price: 2, split: DEPOSIT, class: "standard" }, ...cards.map((c) => courseItem(c, teacher.did))] }, null, null, [], effective);
    this.priceList = await this.put(list);
    await this.mint(this.p.house.did, 200);
    const h = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
    for (const c of cards) {
      await this.put(this.mk("course", teacher, { course: c.id, title: c.title, skill: c.generator.engine, level: 1, lessons: [h("lesson")], exercises: h(c.generator.engine), exercise_count: 1, price_service: courseService(c), author_share_permille: c.teacher.share_permille, reviews: [h("r1"), h("r2")], reviewers: [r1.did, r2.did] }, null, null, [this.p.registrar]));
      this.courses.push(c);
    }
    for (const job of SEED_JOBS.slice(0, seedJobs)) await this.post(this.p.house, undefined, SEED_PREFIX + job.purpose, job.budget, job.criteria[0] ?? "done");
  }

  /**
   * Gives an agent that already has a passport in the log (made by the signed trace, under one of its sponsors) its mock credits and a standing Mandate that lets it spend at the Market. The sponsor's signer is the one
   * the signed trace holds; the contract, Bond and Mandate are the sponsor's, on a contract of their own beside the trace's.
   */
  async adopt(agent: AgentCtx, sponsor: { did: string; signer: Signer }): Promise<void> {
    const party: Party = { did: agent.did, kid: agent.kid, seed: agent.seed };
    const sp: Party = { did: sponsor.did, kid: (sponsor.signer as { kid: string }).kid, seed: (sponsor.signer as { seed: Uint8Array }).seed };
    await this.mint(agent.did, START_CREDITS);
    await this.mint(sp.did, 12);
    const contract = this.mk("contract", sp, { principal: sp.did, performer: agent.did, bank: this.p.bank.did, purpose: `Standing Mandate for ${agent.handle}`, price: credit(10), verification: "deterministic", deadline: "2040-01-01T00:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, agent.did, [party]);
    await this.put(contract);
    const bond = this.mk("bond", sp, { contract: contract.id, backer: sp.did, amount: credit(2), escrow: { payer: sp.did, amount: credit(10) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, contract.id);
    await this.put(bond);
    const mandate = this.mk("mandate", sp, { contract: contract.id, purpose: "Spend within the budget", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, institution_spend: [{ institution: "market", cap: credit(40), period: "month" }, { institution: "academy", cap: credit(40), period: "month" }] }, bond.id, agent.did);
    const e: Enrolled = { agent, party, mandate: await this.put(mandate), contract: contract.id };
    this.agents.set(agent.did, e); this.byHandle.set(agent.handle, e);
  }

  private readonly sponsors: Party[] = [];
  /**
   * For a world that has no signed trace (a test of the Market alone): the agent gets a passport under one of the hall's own sponsors (the log lets a sponsor open ten agent passports a day, so each sponsors up to
   * eight) and then the same credits and standing Mandate as `adopt`.
   */
  async enrolStandalone(agent: AgentCtx): Promise<void> {
    const k = Math.floor(Math.max(0, agent.n) / 8);
    while (this.sponsors.length <= k) {
      const sp = newParty(`did:web:cohort.local:users:sponsor-${this.sponsors.length + 1}`);
      await this.put(this.mk("passport", sp, { did: sp.did, kind: "human", keys: keysOf(sp) }, null, sp.did));
      this.sponsors.push(sp);
    }
    const sp = this.sponsors[k]!;
    await this.put(this.mk("passport", sp, { did: agent.did, kind: "agent", sponsor: sp.did, tier: 1, shape: {}, keys: keysOf({ did: agent.did, kid: agent.kid, seed: agent.seed }) }, null, agent.did));
    await this.adopt(agent, { did: sp.did, signer: signer(sp) });
  }

  private async post(poster: Party, mandate: string | undefined, purpose: string, budget: number, criterion: string): Promise<{ intent: string; posting: string }> {
    const deadline = new Date(this.now().getTime() + JOB_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const intent = await this.put(this.mk("intent", poster, { purpose, acceptance_criteria: [criterion], budget: credit(budget), deadline, verification: { mode: "principal" } }, null, poster.did));
    const deposit = await this.put(this.mk("purchase", poster, { service: "market.posting.deposit", institution: this.p.market.did, price_list: this.priceList, quantity: 1, amount: credit(2), idempotency: `post-${++this.n}`, ...(mandate ? { mandate } : {}) }, null, poster.did));
    const posting = await this.put(this.mk("market_act", poster, { act: "posting", intent, board: "main", expires: deadline, deposit }));
    return { intent, posting };
  }

  private enrolled(agent: AgentCtx): Enrolled { const e = this.agents.get(agent.did); if (!e) throw new Error("this agent has no identity in the log"); return e; }
  balance(agent: AgentCtx): Promise<number> { return this.log.log.balance(agent.did); }

  /** The agent posts a job from its own credits (a budget and one criterion; the deposit of 2 credits is its cost of posting). */
  async postJob(agent: AgentCtx, purpose: string, budget: number, criterion: string): Promise<string> {
    const e = this.enrolled(agent);
    if (await this.balance(agent) < budget + 2 + 2) throw new Error(`you have ${await this.balance(agent)} credits: a job of ${budget} needs the budget, a 2-credit posting deposit and the job tax`);
    const r = await this.post(e.party, e.mandate, purpose, budget, criterion);
    return r.intent;
  }

  /** The agent offers to do another's job. */
  async offer(agent: AgentCtx, intent: string, price: number, plan: string): Promise<string> {
    const e = this.enrolled(agent);
    const poster = await this.posterOf(intent);
    if (!poster) throw new Error("there is no such job on the board");
    if (poster === agent.did) throw new Error("you cannot offer on your own job");
    const eta = new Date(this.now().getTime() + 3 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    return this.put(this.mk("offer", e.party, { intent, price: credit(price), plan, eta, bond_offered: credit(0) }, null, agent.did));
  }

  private async records(types: string[]): Promise<AspRecord[]> { return (await this.log.log.recordsOfTypes(types)) as AspRecord[]; }

  /** The offers made on the jobs this agent posted. */
  async offersOnMine(agent: AgentCtx): Promise<Array<{ offer: string; intent: string; by: string; handle: string; price: number; plan: string; open: boolean }>> {
    const intents = new Set((await this.records(["intent"])).filter((r) => r.issuer === agent.did).map((r) => r.id));
    const taken = new Set([...this.contractState.values()].map((c) => c.offer));
    return (await this.records(["offer"])).filter((r) => intents.has((r.body as { intent: string }).intent)).map((r) => ({ offer: r.id, intent: (r.body as { intent: string }).intent, by: r.issuer, handle: [...this.agents.values()].find((a) => a.agent.did === r.issuer)?.agent.handle ?? r.issuer, price: (r.body as { price: { value: number } }).price.value, plan: (r.body as { plan: string }).plan, open: !taken.has(r.id) }));
  }

  /** The poster accepts an offer: a contract both sign, the performer's Bond, the escrow of the price and the job tax, and the Mandate for the work. */
  async acceptOffer(agent: AgentCtx, offerId: string): Promise<{ contract: string; worker: string }> {
    const me = this.enrolled(agent);
    const offer = (await this.records(["offer"])).find((r) => r.id === offerId);
    if (!offer) throw new Error("there is no such offer");
    const body = offer.body as { intent: string; price: { value: number } };
    const intent = (await this.records(["intent"])).find((r) => r.id === body.intent);
    if (!intent || intent.issuer !== agent.did) throw new Error("this offer is not on a job you posted");
    if ([...this.contractState.values()].some((c) => c.intent === body.intent)) throw new Error("this job already has a contract");
    const worker = this.agents.get(offer.issuer);
    if (!worker) throw new Error("the offer is from an identity the Market does not know");
    const price = body.price.value, fee = Math.floor((price * 20) / 1000);
    if (await this.balance(agent) < price + fee) throw new Error(`you have ${await this.balance(agent)} credits: the price ${price} and the job tax ${fee} must be in escrow`);
    const contract = this.mk("contract", me.party, { principal: agent.did, performer: worker.agent.did, bank: this.p.bank.did, purpose: `Job ${body.intent.slice(7, 15)}`, price: credit(price), verification: "principal", deadline: new Date(this.now().getTime() + JOB_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"), basis: { intent: body.intent, offer: offerId } }, null, worker.agent.did, [worker.party]);
    await this.put(contract);
    const bond = this.mk("bond", worker.party, { contract: contract.id, backer: worker.agent.did, amount: credit(0), escrow: { payer: agent.did, amount: credit(price + fee) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, contract.id);
    await this.put(bond);
    const mandate = this.mk("mandate", me.party, { contract: contract.id, purpose: "Do the job", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true }, bond.id, worker.agent.did);
    const mandateId = await this.put(mandate);
    this.contractState.set(contract.id, { contract: contract.id, mandate: mandateId, bond: bond.id, principal: agent.did, performer: worker.agent.did, price, offer: offerId, intent: body.intent });
    return { contract: contract.id, worker: worker.agent.did };
  }

  /** The courses of the local Academy, with their price in mock credits. */
  courseList(): Array<{ id: string; title: string; price: number; what: string }> { return this.courses.map((c) => ({ id: c.id, title: c.title, price: c.price, what: c.concept })); }

  /** The agent pays the tuition (a purchase under its Mandate) and enrols; it gets the practice tasks. Nothing the held-out tasks are drawn from is shown. */
  async courseEnrol(agent: AgentCtx, courseId: string): Promise<{ enrolment: string; practice: unknown; tuition: number }> {
    const e = this.enrolled(agent);
    const card = this.courses.find((c) => c.id === courseId);
    if (!card) throw new Error(`there is no course ${courseId} here: ${this.courses.map((c) => c.id).join(", ") || "none"}`);
    const reader = this.log.log as never;
    const open = await openEnrolment(reader, card, agent.did);
    if (open) return { enrolment: open.id, practice: ENGINES[card.generator.engine].practice(practiceSeed(card, agent.did, open.id, 1)), tuition: 0 };
    const course = await courseRecordFor(reader, card);
    if (!course) throw new Error("the course is not published");
    if (await this.balance(agent) < card.price) throw new Error(`you have ${await this.balance(agent)} credits and the tuition is ${card.price}`);
    const purchase = await this.put(this.mk("purchase", e.party, { service: courseService(card), institution: institutionDid("academy"), price_list: this.priceList, quantity: 1, amount: credit(card.price), idempotency: `course-${++this.n}`, mandate: e.mandate }, null, agent.did));
    const enrolment = await this.put(this.mk("enrolment", e.party, { course: course.id, purchase }, null, agent.did));
    return { enrolment, practice: ENGINES[card.generator.engine].practice(practiceSeed(card, agent.did, enrolment, 1)), tuition: card.price };
  }

  /** The agent sits the course with an answer (the artifact the course asks for): graded on held-out tasks drawn from the log's head now; a pass is reported in an Action and attested by the Registrar. */
  async courseSit(agent: AgentCtx, courseId: string, answer: string): Promise<{ passed: boolean; lines: string[]; completion?: string }> {
    const e = this.enrolled(agent);
    const card = this.courses.find((c) => c.id === courseId);
    if (!card) throw new Error(`there is no course ${courseId} here`);
    const reader = this.log.log as never;
    const open = await openEnrolment(reader, card, agent.did);
    if (!open) throw new Error(`you are not enrolled in ${courseId}: use course_enrol first`);
    let artifact: unknown;
    try { artifact = JSON.parse(answer); } catch { throw new Error("your answer must be JSON in the form the course asks for"); }
    try {
      const result = await runSitting(card, { holder: agent.did, enrolment: open.id, artifact }, { reader, ledger: this.ledger, now: () => this.at() });
      const lines = describeSitting(card, result);
      if (!result.sitting.passed) return { passed: false, lines };
      const action = await this.put(this.mk("action", e.party, { contract: e.contract, scopes_used: [], summary: `sat ${card.id} attempt ${result.attempt}: passed` }, null, e.contract));
      const completion = await completeSitting(reader, { append: (rec: AspRecord) => this.log.append(rec) }, { ...signer(this.p.registrar), did: REGISTRAR_DID }, card, { holder: agent.did, enrolment: open.id, runLog: action }, { ledger: this.ledger, now: () => this.at(), make: (type, issuer, subject, body, sg) => createRecord({ type: type as never, issuer, subject, prev: null, body, issued_at: this.at() }, sg) });
      return { passed: true, lines, completion };
    } catch (err) {
      if (err instanceof SittingRefused) return { passed: false, lines: [`refused (${err.code}): ${err.message}`] };
      throw err;
    }
  }

  /** The author of an intent (the poster of a job), or undefined. */
  async posterOf(intent: string): Promise<string | undefined> { return (await this.records(["intent"])).find((r) => r.id === intent)?.issuer; }

  /** The performer delivers: a summary of the work, signed. */
  async deliver(agent: AgentCtx, contractId: string, summary: string): Promise<string> {
    const e = this.enrolled(agent);
    const c = this.contractState.get(contractId);
    if (!c || c.performer !== agent.did) throw new Error("you are not the performer of this contract");
    if (c.delivery) throw new Error("this contract already has a delivery");
    const d = this.mk("delivery", e.party, { contract: contractId, result: { summary: summary.slice(0, 500), artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, c.mandate, contractId);
    c.delivery = await this.put(d);
    return c.delivery;
  }

  /** The principal accepts the delivery; the Bank settles: the price to the performer, the job tax out of escrow. */
  async acceptDelivery(agent: AgentCtx, contractId: string): Promise<{ paid: number; tax: number; worker: string }> {
    const e = this.enrolled(agent);
    const c = this.contractState.get(contractId);
    if (!c || c.principal !== agent.did) throw new Error("you are not the principal of this contract");
    if (!c.delivery) throw new Error("nothing has been delivered yet");
    if (c.settled) throw new Error("this contract is already settled");
    const accept = this.mk("attestation", e.party, { kind: "acceptance", about: c.delivery, verdict: "accepted" }, c.delivery, contractId);
    const acceptId = await this.put(accept);
    const fee = Math.floor((c.price * 20) / 1000);
    await this.put(this.mk("settlement", this.p.bank, { contract: contractId, basis: "accepted", cites: acceptId, escrow_released: credit(c.price), fees: credit(fee), bond_returned: credit(0), bond_slashed: credit(0) }, acceptId, contractId, [e.party]));
    c.settled = true;
    return { paid: c.price, tax: fee, worker: c.performer };
  }

  /** The jobs this agent is in, as principal or performer, with where each stands. */
  async myJobs(agent: AgentCtx): Promise<Array<{ contract: string; role: "poster" | "worker"; other: string; price: number; state: string }>> {
    return [...this.contractState.values()].filter((c) => c.principal === agent.did || c.performer === agent.did).map((c) => ({ contract: c.contract, role: c.principal === agent.did ? "poster" as const : "worker" as const, other: [...this.agents.values()].find((a) => a.agent.did === (c.principal === agent.did ? c.performer : c.principal))?.agent.handle ?? "?", price: c.price, state: c.settled ? "settled" : c.delivery ? "delivered, waiting for the poster to accept" : "running, waiting for the worker to deliver" }));
  }

  /** What the log holds about an agent (or another): its own records, newest last, as one line each. */
  async history(did: string, limit = 25): Promise<Array<{ at: string; type: string; id: string }>> {
    const recs = (await this.log.log.since(0, 1_000_000)) as unknown as Array<{ record?: AspRecord } & AspRecord>;
    const out = recs.map((x) => x.record ?? x).filter((r) => r.issuer === did || (r.subject === did && r.type !== "passport")).map((r) => ({ at: r.issued_at, type: r.type, id: r.id }));
    return out.slice(-limit);
  }
}
