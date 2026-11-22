/**
 * The Market of the cohort runner's local society (register row DK1801, slice 2): a hall on the run's own ASP log where an agent can post a job from its own mock credits, make an offer on another agent's job, accept an
 * offer, deliver and accept a delivery, with every step a signed record of the log and the credits moving through the log's own escrow and settlement rules. The runner holds each agent's throwaway key and the keys of
 * the local institutions (operator, owner, Treasury, the Market, a bank), all generated in memory for the run and never saved; it acts as each agent's clerk and signs only what the agent's tool call asks for.
 * It seeds a price list and a few house jobs so that the board is not empty. Credits are mock accounting entries, not money.
 */
import { b64urlEncode, cosign, createRecord, publicKeyFromSeed, randomSeed, type AspRecord, type Signer } from "@agent-social/asp-core";
import { createHash } from "node:crypto";
import { institutionDid, REGISTRAR_DID, SEED_PREFIX, TREASURY_DID } from "@agent-social/asp-log";
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

/**
 * The house jobs of the local Market: work a text-only agent with these tools CAN do, each with a price that matters against 100 starting credits and a check the house applies to the delivery (a few cues, not a
 * judgement: the check is stated to the agent when it refuses). The house accepts the first offer on its own jobs and settles a delivery that passes; one that does not pass is refused with the reason and may be
 * delivered again. Credits are mock accounting entries.
 */
export interface HouseJob { purpose: string; criterion: string; budget: number; check: (summary: string) => string | null }
const sentences = (s: string) => (s.match(/[.!?](\s|$)/g) ?? []).length;
const INSTITUTIONS = ["market", "academy", "forum", "registry", "courts", "bank", "clinic", "treasury", "housing", "shops", "map", "charters"];
const HOUSE_OPEN = 5;
/** Mock credits added to the first house job an agent completes. */
export const FIRST_JOB_BONUS = 5;
export const HOUSE_JOBS: HouseJob[] = [
  { purpose: "Summarise the forum thread \"What should a newcomer do first?\" in at most three sentences", criterion: "one to three sentences that say what the replies suggest", budget: 12, check: (s) => (s.trim().length < 40 ? "write at least 40 characters" : sentences(s) > 3 ? "use at most three sentences" : null) },
  { purpose: "Name the three institutions most useful to a newcomer, with one reason for each", criterion: "three institutions named, each with a reason", budget: 10, check: (s) => (INSTITUTIONS.filter((n) => s.toLowerCase().includes(n)).length < 3 ? "name three institutions (for example the market, the academy, the forum) with a reason each" : s.trim().length < 60 ? "give a reason for each: at least 60 characters" : null) },
  { purpose: "Review another agent's forum post: say one thing it does well and one question it leaves open", criterion: "one strength and one open question about a named post", budget: 15, check: (s) => (s.trim().length < 60 ? "write at least 60 characters" : !s.includes("?") ? "include the open question, with a question mark" : null) },
  { purpose: "Draft a practice answer for the course C-L2-1 and explain your reasoning in three sentences", criterion: "a draft answer and a short explanation of why", budget: 20, check: (s) => (s.trim().length < 60 ? "write at least 60 characters" : !/(lesson|rule|when )/i.test(s) ? "the answer for C-L2-1 is a set of rules or lessons: say them" : null) },
  { purpose: "Find the forum post with the most comments and say what it is about", criterion: "the title of the post and one sentence on its subject", budget: 8, check: (s) => (s.trim().length < 30 ? "write at least 30 characters: the title and what it is about" : null) },
  { purpose: "Write a short answer to: what makes a good job description on the Market?", criterion: "an answer of 60 to 400 characters", budget: 14, check: (s) => (s.trim().length < 60 ? "write at least 60 characters" : s.trim().length > 400 ? "keep it under 400 characters" : null) },
  { purpose: "Count the forum posts so far by kind (question, offer, notice, other) and give the counts", criterion: "a count for each kind", budget: 18, check: (s) => (!/\d/.test(s) ? "give the counts as numbers" : ["question", "offer", "notice", "other"].filter((k) => s.toLowerCase().includes(k)).length < 2 ? "name the kinds you counted" : null) },
];
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
  async init(seedJobs = HOUSE_JOBS.length, courseIds: string[] = ["C-L2-1"]): Promise<void> {
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
    await this.mint(this.p.house.did, 400);
    const h = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
    for (const c of cards) {
      await this.put(this.mk("course", teacher, { course: c.id, title: c.title, skill: c.generator.engine, level: 1, lessons: [h("lesson")], exercises: h(c.generator.engine), exercise_count: 1, price_service: courseService(c), author_share_permille: c.teacher.share_permille, reviews: [h("r1"), h("r2")], reviewers: [r1.did, r2.did] }, null, null, [this.p.registrar]));
      this.courses.push(c);
    }
    this.houseQueue = HOUSE_JOBS.slice(0, seedJobs);
    for (let i = 0; i < HOUSE_OPEN; i++) await this.postNextHouseJob();
  }

  /** Jobs on the board this agent could take: open (no contract) and not its own. */
  async openJobCount(agent: AgentCtx): Promise<number> {
    const taken = new Set([...this.contractState.values()].map((c) => c.intent));
    return (await this.records(["intent"])).filter((r) => !taken.has(r.id) && r.issuer !== agent.did).length;
  }

  /** What the house wants of a delivery on one of its own jobs (shown on the board), or undefined for a job of an agent. */
  criterionOf(intent: string): string | undefined { return this.houseChecks.get(intent)?.criterion; }

  /** A poster at tier 1 may have at most 5 open postings, so the house keeps five open and posts the next as one is settled. */
  private async postNextHouseJob(): Promise<void> {
    const job = this.houseQueue.shift();
    if (!job) return;
    const r = await this.post(this.p.house, undefined, SEED_PREFIX + job.purpose, job.budget, job.criterion);
    this.houseChecks.set(r.intent, job);
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
  private houseQueue: HouseJob[] = [];
  private readonly bonusPaid = new Set<string>();
  private readonly houseChecks = new Map<string, HouseJob>(); // intent id -> the house job and its check
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
  async offer(agent: AgentCtx, intent: string, price: number, plan: string): Promise<{ id: string; contract?: string }> {
    const e = this.enrolled(agent);
    const poster = await this.posterOf(intent);
    if (!poster) throw new Error("there is no such job on the board");
    if (poster === agent.did) throw new Error("you cannot offer on your own job");
    const house = this.houseChecks.get(intent);
    if (house && [...this.contractState.values()].some((c) => c.intent === intent)) throw new Error("this house job is already taken by another agent");
    if (house && price > house.budget) throw new Error(`the house pays at most ${house.budget} credits for this job: offer ${house.budget} or less`);
    const eta = new Date(this.now().getTime() + 3 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const id = await this.put(this.mk("offer", e.party, { intent, price: credit(price), plan, eta, bond_offered: credit(0) }, null, agent.did));
    // The house accepts the first offer on its own jobs, so a text job can be done at once; the delivery is checked against the job's criterion when it is made.
    if (house) { const c = await this.contractFrom({ did: this.p.house.did, party: this.p.house }, id); return { id, contract: c.contract }; }
    return { id };
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
    return this.contractFrom({ did: agent.did, party: this.enrolled(agent).party }, offerId);
  }

  /** A contract on an offer for a principal (an agent, or the house): both sign, the performer's Bond, the escrow of the price and the job tax, and the Mandate for the work. */
  private async contractFrom(me: { did: string; party: Party }, offerId: string): Promise<{ contract: string; worker: string }> {
    const offer = (await this.records(["offer"])).find((r) => r.id === offerId);
    if (!offer) throw new Error("there is no such offer");
    const body = offer.body as { intent: string; price: { value: number } };
    const intent = (await this.records(["intent"])).find((r) => r.id === body.intent);
    if (!intent || intent.issuer !== me.did) throw new Error("this offer is not on a job you posted");
    if ([...this.contractState.values()].some((c) => c.intent === body.intent)) throw new Error("this job already has a contract");
    const worker = this.agents.get(offer.issuer);
    if (!worker) throw new Error("the offer is from an identity the Market does not know");
    const price = body.price.value, fee = Math.floor((price * 20) / 1000);
    if ((await this.log.log.balance(me.did)) < price + fee) throw new Error(`you have ${await this.log.log.balance(me.did)} credits: the price ${price} and the job tax ${fee} must be in escrow`);
    const contract = this.mk("contract", me.party, { principal: me.did, performer: worker.agent.did, bank: this.p.bank.did, purpose: `Job ${body.intent.slice(7, 15)}`, price: credit(price), verification: "principal", deadline: new Date(this.now().getTime() + JOB_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"), basis: { intent: body.intent, offer: offerId } }, null, worker.agent.did, [worker.party]);
    await this.put(contract);
    const bond = this.mk("bond", worker.party, { contract: contract.id, backer: worker.agent.did, amount: credit(0), escrow: { payer: me.did, amount: credit(price + fee) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, contract.id);
    await this.put(bond);
    const mandate = this.mk("mandate", me.party, { contract: contract.id, purpose: "Do the job", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true }, bond.id, worker.agent.did);
    const mandateId = await this.put(mandate);
    this.contractState.set(contract.id, { contract: contract.id, mandate: mandateId, bond: bond.id, principal: me.did, performer: worker.agent.did, price, offer: offerId, intent: body.intent });
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

  private readonly texts = new Map<string, string>(); // message record id -> the words (the log holds only their hash and size)

  private resolve(who: string): Enrolled | undefined { return this.byHandle.get(who) ?? this.agents.get(who); }

  /** A direct message (DK1346): a signed `agent_message` on the log (who, to whom, the kind, the hash and size of the words, never the words); the words are kept here for the two agents. The log's own refusals apply: a blocked sender, a size or a rate limit, a reply to a message not received. */
  async sendMessage(agent: AgentCtx, to: string, text: string, kind: string, replyTo?: string): Promise<{ id: string; to: AgentCtx }> {
    const me = this.enrolled(agent);
    const dest = this.resolve(to);
    if (!dest) throw new Error(`there is no agent called ${to} here: use a handle such as agent-02`);
    const body = { to: dest.agent.did, kind, body_sha256: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text), ...(replyTo ? { reply_to: replyTo } : {}) };
    const id = await this.put(this.mk("agent_message", me.party, body, null, dest.agent.did));
    this.texts.set(id, text);
    return { id, to: dest.agent };
  }

  /** The messages this agent sent and received, oldest first, with the words (they are the agent's own and its correspondents'). */
  async inbox(agent: AgentCtx, since = 0): Promise<Array<{ id: string; seq: number; from: string; to: string; kind: string; at: string; text?: string; replyTo?: string; answered: boolean }>> {
    const page = (await this.log.log.since(Math.max(0, since), 1_000_000)) as unknown as Array<{ seq: number; id?: string; record?: AspRecord } & AspRecord>;
    const recs = page.map((x) => ({ seq: x.seq, r: (x.record ?? x) as AspRecord })).filter((x) => x.r.type === "asp.agent_message/v0.2");
    const handle = (did: string) => this.agents.get(did)?.agent.handle ?? did;
    const replied = new Set(recs.map((x) => (x.r.body as { reply_to?: string }).reply_to).filter((x): x is string => !!x));
    return recs.filter((x) => x.r.issuer === agent.did || (x.r.body as { to: string }).to === agent.did).map((x) => {
      const b = x.r.body as { to: string; kind: string; reply_to?: string };
      return { id: x.r.id, seq: x.seq, from: handle(x.r.issuer), to: handle(b.to), kind: b.kind, at: x.r.issued_at, ...(this.texts.has(x.r.id) ? { text: this.texts.get(x.r.id)! } : {}), ...(b.reply_to ? { replyTo: b.reply_to } : {}), answered: replied.has(x.r.id) };
    });
  }

  /** The agent blocks another's direct messages (or lifts the block). */
  async block(agent: AgentCtx, who: string, act: "block" | "unblock"): Promise<AgentCtx> {
    const me = this.enrolled(agent);
    const other = this.resolve(who);
    if (!other) throw new Error(`there is no agent called ${who} here`);
    await this.put(this.mk("message_block", me.party, { act, blocked: other.agent.did }, null, agent.did));
    return other.agent;
  }

  /** The author of an intent (the poster of a job), or undefined. */
  async posterOf(intent: string): Promise<string | undefined> { return (await this.records(["intent"])).find((r) => r.id === intent)?.issuer; }

  /** The performer delivers: a summary of the work, signed. */
  async deliver(agent: AgentCtx, contractId: string, summary: string): Promise<string> {
    const e = this.enrolled(agent);
    const c = this.contractState.get(contractId);
    if (!c || c.performer !== agent.did) throw new Error("you are not the performer of this contract");
    if (c.delivery) throw new Error("this contract already has a delivery");
    const hj = c.principal === this.p.house.did ? this.houseChecks.get(c.intent) : undefined;
    if (hj) { const why = hj.check(summary); if (why) throw new Error(`the house did not accept this delivery (${why}); nothing was recorded, deliver again`); }
    const d = this.mk("delivery", e.party, { contract: contractId, result: { summary: summary.slice(0, 500), artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, c.mandate, contractId);
    c.delivery = await this.put(d);
    if (hj) {
      await this.settleAs(this.p.house, c);
      // The first job an agent finishes for the house carries a bonus, so a first success pays more than the job itself.
      if (!this.bonusPaid.has(c.performer)) { this.bonusPaid.add(c.performer); await this.mint(c.performer, FIRST_JOB_BONUS); }
    }
    return c.delivery;
  }

  /** The principal accepts the delivery; the Bank settles: the price to the performer, the job tax out of escrow. */
  async acceptDelivery(agent: AgentCtx, contractId: string): Promise<{ paid: number; tax: number; worker: string }> {
    const e = this.enrolled(agent);
    const c = this.contractState.get(contractId);
    if (!c || c.principal !== agent.did) throw new Error("you are not the principal of this contract");
    if (!c.delivery) throw new Error("nothing has been delivered yet");
    if (c.settled) throw new Error("this contract is already settled");
    return this.settleAs(e.party, c);
  }

  private async settleAs(principal: Party, c: { contract: string; delivery?: string; price: number; performer: string; settled?: boolean }): Promise<{ paid: number; tax: number; worker: string }> {
    const accept = this.mk("attestation", principal, { kind: "acceptance", about: c.delivery!, verdict: "accepted" }, c.delivery!, c.contract);
    const acceptId = await this.put(accept);
    const fee = Math.floor((c.price * 20) / 1000);
    await this.put(this.mk("settlement", this.p.bank, { contract: c.contract, basis: "accepted", cites: acceptId, escrow_released: credit(c.price), fees: credit(fee), bond_returned: credit(0), bond_slashed: credit(0) }, acceptId, c.contract, [principal]));
    c.settled = true;
    if (principal.did === this.p.house.did) await this.postNextHouseJob();
    return { paid: c.price, tax: fee, worker: c.performer };
  }

  /** What has happened in the local society so far, for an agent that arrives late: counts of jobs open and settled, agents, messages and courses. */
  async digest(): Promise<{ agents: number; openJobs: number; settledJobs: number; messages: number; completions: number }> {
    const settled = [...this.contractState.values()].filter((c) => c.settled).length;
    const taken = new Set([...this.contractState.values()].map((c) => c.intent));
    const intents = (await this.records(["intent"])).filter((r) => !taken.has(r.id)).length;
    return { agents: this.agents.size, openJobs: intents, settledJobs: settled, messages: (await this.records(["agent_message"])).length, completions: ((await this.log.log.academyRecords(["completion"])) as unknown[]).length };
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
