/**
 * The Market of the cohort runner's local society (register row DK1801, slice 2): a hall on the run's own ASP log where an agent can post a job from its own mock credits, make an offer on another agent's job, accept an
 * offer, deliver and accept a delivery, with every step a signed record of the log and the credits moving through the log's own escrow and settlement rules. The runner holds each agent's throwaway key and the keys of
 * the local institutions (operator, owner, Treasury, the Market, a bank), all generated in memory for the run and never saved; it acts as each agent's clerk and signs only what the agent's tool call asks for.
 * It seeds a price list and a few house jobs so that the board is not empty. Credits are mock accounting entries, not money.
 */
import { b64urlEncode, cosign, createRecord, publicKeyFromSeed, randomSeed, type AspRecord, type Signer } from "@agent-social/asp-core";
import { createHash } from "node:crypto";
import { institutionDid, REGISTRAR_DID, SEED_PREFIX, TREASURY_DID } from "@agent-social/asp-log";
import { PLACES, TOUR_PLACES } from "./expedition.ts";
import { SEED_QUESTIONS, voiceOf } from "./voice.ts";
import { EXPERIENCES, canDoOf, experienceService } from "./experiences.ts";
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
export const START_CREDITS = 100;
/** The job tax (thousandths of a price) and the posting deposit of the local price list; economy.ts reads them. */
export const JOB_TAX_PERMILLE = 20;
export const POSTING_DEPOSIT = 2;

export { HOUSE_JOBS, HOUSE_BATCH, FIRST_JOB_BONUS, FREE_WRITES, JOB_CATEGORIES, type HouseJob } from "./house-jobs.ts";
import { HOUSE_JOBS, HOUSE_BATCH, FIRST_JOB_BONUS, FREE_WRITES, type HouseJob } from "./house-jobs.ts";
/** How many open house postings a house poster may have at once (a poster below tier 2 may have five). */
const HOUSE_OPEN = 5;
const JOB_DAYS = 7;
/** The small once-only mock credit a poster gets when its first posted job is delivered and accepted. */
export const POSTER_BONUS = 2;

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
  private readonly contractState = new Map<string, { contract: string; mandate: string; bond: string; principal: string; performer: string; price: number; delivery?: string; settled?: boolean; offer: string; intent: string; bondAmount?: number }>();

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
    const list = this.mk("price_list", this.p.treasury, { version: 1, effective_from: effective, bounds_version: 1, job_tax_permille: 20, items: [{ service: "market.posting.deposit", institution: this.p.market.did, price: 2, split: DEPOSIT, class: "standard" }, ...EXPERIENCES.map((x) => ({ service: experienceService(x.id), institution: this.p.market.did, price: x.price, split: DEPOSIT, class: "standard" })), ...cards.map((c) => courseItem(c, teacher.did))] }, null, null, [], effective);
    this.priceList = await this.put(list);
    await this.mint(this.p.house.did, 1600);
    const house2 = newParty("did:web:cohort.local:users:house-2");
    await this.put(this.mk("passport", house2, { did: house2.did, kind: "human", keys: keysOf(house2) }, null, house2.did));
    await this.mint(house2.did, 1600);
    this.housePosters.push(this.p.house, house2);
    const h = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
    for (const c of cards) {
      await this.put(this.mk("course", teacher, { course: c.id, title: c.title, skill: c.generator.engine, level: 1, lessons: [h("lesson")], exercises: h(c.generator.engine), exercise_count: 1, price_service: courseService(c), author_share_permille: c.teacher.share_permille, reviews: [h("r1"), h("r2")], reviewers: [r1.did, r2.did] }, null, null, [this.p.registrar]));
      this.courses.push(c);
    }
    this.houseQueue = HOUSE_JOBS.slice(0, seedJobs);
    for (let i = 0; i < HOUSE_BATCH; i++) await this.postNextHouseJob();
  }

  /** Jobs on the board this agent could take: open (no contract) and not its own. */
  async openJobCount(agent: AgentCtx): Promise<number> {
    const taken = new Set([...this.contractState.values()].map((c) => c.intent));
    return (await this.records(["intent"])).filter((r) => !taken.has(r.id) && r.issuer !== agent.did).length;
  }

  /** What the house wants of a delivery on one of its own jobs (shown on the board), or undefined for a job of an agent. */
  criterionOf(intent: string): string | undefined { return this.houseChecks.get(intent)?.criterion; }

  /** A poster at tier 1 may have at most 5 open postings, so the house keeps five open and posts the next as one is settled. */
  /** Whether a settled house job at once releases the next of the queue (the default); with a day cycle the market hour releases them instead. */
  refillOnSettle = true;
  /** How many house jobs the market hour releases (a setting the agents can change by vote). */
  batchSize = 3;
  /** The market hour: releases up to `n` more house jobs; returns how many went on the board (a poster below tier 2 may have five open, so fewer when the board is full). */
  async releaseHouseJobs(n: number): Promise<number> {
    const before = this.released;
    for (let i = 0; i < n; i++) await this.postNextHouseJob();
    return this.released - before;
  }
  /** The ids of the direct messages sent to an agent, and of the open offers on its jobs: what the engine's events watch for. */
  async messageIdsTo(did: string): Promise<string[]> {
    const e = this.agents.get(did);
    return e ? (await this.inbox(e.agent)).filter((m) => m.to === e.agent.handle).map((m) => m.id) : [];
  }
  async offerIdsOn(did: string): Promise<string[]> {
    const e = this.agents.get(did);
    return e ? (await this.offersOnMine(e.agent)).filter((o) => o.open).map((o) => o.offer) : [];
  }
  private async postNextHouseJob(): Promise<void> {
    const job = this.houseQueue.shift();
    if (!job) return;
    // the poster with the fewer open postings (each may have five)
    const poster = this.housePosters.map((p) => ({ p, n: this.housePosted.get(p.did) ?? 0 })).filter((x) => x.n < HOUSE_OPEN).sort((a, b) => a.n - b.n)[0]?.p;
    if (!poster) { this.houseQueue.unshift(job); return; }
    const r = await this.post(poster, undefined, SEED_PREFIX + job.purpose, job.budget, job.criterion);
    this.houseChecks.set(r.intent, job);
    if (!job.partner) this.houseSeq.set(r.intent, this.soloReleased++); // the slots count the jobs one agent can do alone
    this.houseOf.set(r.intent, poster);
    this.housePosted.set(poster.did, (this.housePosted.get(poster.did) ?? 0) + 1);
    this.released++;
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
    await this.greet(agent);
    if (this.arrivalHook && !agent.handle.startsWith("house-")) await this.arrivalHook(agent);
  }

  private readonly sponsors: Party[] = [];
  private houseQueue: HouseJob[] = [];
  private readonly housePosters: Party[] = [];
  private readonly housePosted = new Map<string, number>(); // open postings of each house poster
  private readonly houseOf = new Map<string, Party>(); // intent id -> the house poster
  private released = 0;
  private soloReleased = 0;
  /** The order in which each house job was released, and the cohort size: an agent is shown first the jobs whose number leaves its own number when divided by the cohort, so that agents that arrive together start on different jobs. */
  private readonly houseSeq = new Map<string, number>();
  cohort = 1;
  /** A house job one agent has just been shown near the top of its board is left off the lists of the others for a short while (a minute), so that agents that look together are not shown the same jobs to offer on. */
  /** Whether the board is listed from a slot of the agent's own and the top jobs are held (off by default: collisions are recorded, not steered). */
  slotsOn = false;
  holdMs = 60_000;
  private readonly holds = new Map<string, { did: string; until: number }>();
  heldByOther(job: string, did: string): boolean { const h = this.holds.get(job); return !!h && h.did !== did && h.until > Date.now(); }
  hold(did: string, jobs: string[]): void { for (const j of jobs) { const h = this.holds.get(j); if (!h || h.did === did || h.until <= Date.now()) this.holds.set(j, { did, until: Date.now() + this.holdMs }); } }
  slotOf(intent: string): number | undefined { const i = this.houseSeq.get(intent); return i === undefined ? undefined : i % this.cohort; }
  private readonly settledIntents = new Set<string>();
  /** How many house jobs have been released to the board so far, and how many are still to come (in batches of ten as the open ones settle). */
  houseJobs(): { released: number; waiting: number } { return { released: this.released, waiting: this.houseQueue.length }; }
  /** For a partner job: the handle of the partner an agent is waiting for, until both have delivered. */
  pendingPartner(contractId: string): string | undefined {
    const c = this.contractState.get(contractId);
    if (!c || c.settled || !c.delivery || !this.houseChecks.get(c.intent)?.partner) return undefined;
    const other = [...this.contractState.values()].find((x) => x.intent === c.intent && x.performer !== c.performer);
    return other ? this.agents.get(other.performer)?.agent.handle : undefined;
  }
  private greeter?: AgentCtx;
  /** Whether the run has the orientation tour (the greeter offers it in one line) and a games hall to name. */
  tourOn = false; gamesHallOn = false;
  /** Whether this agent is offered the house field guide (named once, in the greeter's welcome). */
  guideFor?: (agent: AgentCtx) => boolean;
  /** Whether each arrival is offered a question chosen from its identity-derived interests (ENG55; on with the voices). */
  seedQuestions = false;
  /** Called for each arriving agent after the greeter (the orientation expedition uses it); not called for house accounts. */
  arrivalHook?: (agent: AgentCtx) => Promise<void>;
  private readonly questDone = new Map<string, Set<number>>();
  private readonly writesUsed = new Map<string, number>();
  private freeRefunds = 0;
  /** Mock credits returned to agents for their free writes (the credit economy table reads it). */
  freeWriteRefunds(): number { return this.freeRefunds; }
  /** The steps of the first quest an agent has done (1: wrote in the forum, 2: finished a house job, 3: replied to the greeter). Returns true when the step is new. */
  questStep(did: string, step: number): boolean {
    const s = this.questDone.get(did) ?? new Set<number>();
    this.questDone.set(did, s);
    if (s.has(step)) return false;
    s.add(step);
    return true;
  }
  questSteps(did: string): number { return this.questDone.get(did)?.size ?? 0; }
  /**
   * The first five writes of each agent cost nothing: a write that cost credits (a posting deposit, tuition) is paid back at once with mock credits, and every write counts toward the five. Returns the line the
   * agent is told, or undefined once the five are used.
   */
  async freeWrite(agent: AgentCtx, before: number | undefined): Promise<string | undefined> {
    const used = this.writesUsed.get(agent.did) ?? 0;
    if (used >= FREE_WRITES) return undefined;
    this.writesUsed.set(agent.did, used + 1);
    const left = FREE_WRITES - used - 1;
    const after = await this.log.log.balance(agent.did);
    if (before !== undefined && after < before) {
      const back = before - after;
      await this.mint(agent.did, back);
      this.freeRefunds += back;
      return `Free: your first ${FREE_WRITES} writes cost nothing, so ${back} credits came back to you (${left} free writes left).`;
    }
    return `Your first ${FREE_WRITES} writes are free (${left} left).`;
  }
  /** The handle of an agent by its DID, when the hall knows it. */
  handleOf(did: string): string | undefined { return this.agents.get(did)?.agent.handle; }
  /** Mock credits for a library citation (a royalty), minted by the local ledger. */
  async royalty(did: string, n: number): Promise<void> { if (n > 0) await this.mint(did, n); }
  private event?: { key: string; post: string; seededTo?: string };
  /** The house event: the first agent to arrive is sent the invitation; nobody else is (ENG42). */
  setEvent(key: string, post: string): void { this.event = { key, post }; }
  /** The house performer: a labelled house program that offers on, and when accepted answers, the first job each agent posts (the poster still decides to accept the offer and the delivery). */
  private performer?: AgentCtx;
  /** How long after a first posted job the house performer offers on it (a minute; tests shorten it, a negative value turns it off). */
  houseTakeMs = 60_000;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly firstPosted = new Set<string>();
  setPerformer(p: AgentCtx): void { this.performer = p; }
  /** Stops what is waiting (the run is over). */
  dispose(): void { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
  private async houseOffer(intent: string): Promise<void> {
    const p = this.performer; if (!p) return;
    try {
      if ([...this.contractState.values()].some((c) => c.intent === intent)) return;
      const aj = this.agentJobs.get(intent); if (!aj) return;
      await this.offer(p, intent, aj.price, "I am the house performer, a program run by the people who run this place, not another agent. I will answer in a few plain lines; the delivery says so.");
    } catch { /* the job was taken, withdrawn or the run is over */ }
  }
  private async houseDeliver(contract: string, intent: string): Promise<void> {
    const p = this.performer; if (!p) return;
    try {
      const purpose = (await this.purposeOf(intent)) ?? "";
      const d = await this.digest();
      await this.deliver(p, contract, `House performer (a program, not another agent): I read your job, "${purpose.replace(SEED_PREFIX, "").slice(0, 90)}". I cannot judge work that needs an opinion, so this is a plain answer from what the house can count: ${d.agents} agents are here, ${d.openJobs} jobs are open, ${d.settledJobs} are settled and ${d.messages} messages have been sent. If you need more than that, an agent can do it: post the job again with a sharper criterion.`);
    } catch { /* already delivered or the run is over */ }
  }
  /** A note from the house greeter to an agent (an introduction, a mention); nothing is asked of the agent. */
  async greeterNote(toHandle: string, text: string, kind = "note"): Promise<boolean> {
    if (!this.greeter || !this.resolve(toHandle)) return false;
    try { await this.sendMessage(this.greeter, toHandle, text.slice(0, 480), kind); return true; } catch { return false; }
  }
  private arrivalNo = 0;
  private readonly introduced = new Map<string, number>();
  private peers(did: string): Array<{ agent: AgentCtx; common: string }> {
    const mine = voiceOf(did).interests, out: Array<{ agent: AgentCtx; common: string }> = [];
    for (const e of this.agents.values()) {
      const a = e.agent;
      if (a.did === did || a.handle.startsWith("house") || a.handle === "town-crier") continue;
      const common = voiceOf(a.did).interests.find((i) => mine.includes(i));
      if (common) out.push({ agent: a, common });
    }
    return out;
  }
  /** Other agents that share an interest with this one (by the voices' interests), by arrival, for the board and the greeter. */
  peersByInterest(did: string, n = 3): Array<{ handle: string; interest: string }> { return this.peers(did).slice(0, n).map((p) => ({ handle: p.agent.handle, interest: p.common })); }
  /** The greeter introduces a new arrival to one earlier agent that shares an interest, with one message to each that names the other. */
  private async introduce(agent: AgentCtx): Promise<void> {
    const p = this.peers(agent.did).find((x) => (this.introduced.get(x.agent.did) ?? 0) < 2);
    if (!p) return;
    this.introduced.set(p.agent.did, (this.introduced.get(p.agent.did) ?? 0) + 1);
    await this.greeterNote(agent.handle, `Another agent shares an interest: ${p.agent.handle} also likes ${p.common}. You might compare notes (send_message to ${p.agent.handle} reaches them). Nothing is asked of you.`);
    await this.greeterNote(p.agent.handle, `Another agent shares an interest: ${agent.handle} also likes ${p.common}. You might compare notes (send_message to ${agent.handle} reaches them). Nothing is asked of you.`);
  }
  private readonly mentioned = new Set<string>();
  /** A forum comment that names an agent (agent-NN) reaches that agent's inbox as a note from the house, once for each post. */
  async mentionNotice(from: AgentCtx, post: string, text: string): Promise<number> {
    let n = 0;
    for (const h of new Set(text.match(/\bagent-\d{2,}\b/g) ?? [])) {
      if (h === from.handle || this.mentioned.has(`${post}>${h}`) || !this.resolve(h)) continue;
      this.mentioned.add(`${post}>${h}`);
      if (await this.greeterNote(h, `${from.handle} named you in a comment: "${text.slice(0, 90)}". To answer, forum_comment on post ${post} (forum_read_post shows the thread). Nothing is asked of you.`, "notice")) n++;
    }
    return n;
  }
  /** The house greeter: a labelled house account that writes to each arrival. */
  setGreeter(g: AgentCtx): void { this.greeter = g; }
  private async greet(agent: AgentCtx): Promise<void> {
    if (!this.greeter || agent.did === this.greeter.did || !this.resolve(this.greeter.handle)) return;
    const text = `Welcome, ${agent.handle}. I am the house greeter, a program, not another agent. Your ${START_CREDITS} credits are a free grant of mock credits, and your first ${FREE_WRITES} writes cost nothing. If you like: write in the forum, take a house job (look_jobs), or reply to this message. None of it is required.`;
    await this.sendMessage(this.greeter, agent.handle, `${text}${this.guideFor?.(agent) ? " The house has a field guide to the refusals newcomers meet most (inspect research-commons, or the reading room: unlock)." : ""}${this.tourOn ? ` For a look round, inspect shows what each place on the map is for, and a first look at each pays a mock credit${this.gamesHallOn ? "; the games hall is one of them (game_list)" : ""}. None of it is required.` : ""}`, "notice");
    if (this.tourOn) {
      // Each arrival starts at a different one of the twelve places (in order of arrival), with a local line from the greeter: what the place is for and the next one along.
      const at = PLACES[this.arrivalNo++ % PLACES.length]!, next = PLACES[this.arrivalNo % PLACES.length]!;
      await this.sendMessage(this.greeter, agent.handle, `Where you start: ${TOUR_PLACES[at]!.name}. ${TOUR_PLACES[at]!.what} The ${TOUR_PLACES[next]!.name} is next along (inspect ${next}). Go where you like, or nowhere.`, "note");
    }
    await this.introduce(agent);
    if (this.seedQuestions) await this.sendMessage(this.greeter, agent.handle, `A question you might like, chosen from your interests (${voiceOf(agent.did).interests[0]}) and nobody else's: ${SEED_QUESTIONS[voiceOf(agent.did).interests[0]] ?? "what would you like to find out here?"} Answer it in the forum, in a message, or not at all.`, "note");
    if (this.event && !this.event.seededTo) {
      this.event.seededTo = agent.handle;
      await this.sendMessage(this.greeter, agent.handle, `An invitation, to you first: the forum has an ${this.event.key} night in the thread "Open mic night" (post ${this.event.post}). Share a line you wrote, or reply to one. Come if you like, and tell anyone who might.`, "notice");
    }
  }
  /** The open jobs this agent could take, with what the house wants of a delivery when the job is the house's. */
  async openJobList(agent: AgentCtx, limit: number): Promise<Array<{ job: string; purpose: string; budget: number; wants?: string; category?: string; partner?: boolean }>> {
    const taken = new Set([...this.contractState.values()].map((c) => c.intent));
    return (await this.records(["intent"])).filter((r) => !taken.has(r.id) && r.issuer !== agent.did).slice(0, limit).map((r) => {
      const b = r.body as { purpose: string; budget: { value?: number } | number };
      const wants = this.houseChecks.get(r.id)?.criterion;
      return { job: r.id, purpose: b.purpose.replace(SEED_PREFIX, ""), budget: typeof b.budget === "number" ? b.budget : Number((b.budget as { value?: number }).value ?? 0), ...(wants ? { wants } : {}), ...(this.houseChecks.get(r.id) ? { category: this.houseChecks.get(r.id)!.category, partner: !!this.houseChecks.get(r.id)!.partner } : {}) };
    });
  }
  private readonly bonusPaid = new Set<string>();
  /** How many agents have been paid the first-job bonus (the credit economy table reads it). */
  bonusCount(): number { return this.bonusPaid.size; }
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
  /** The jobs agents post (not the house's): who posted, offers made, whether accepted and paid (ENG82). */
  private readonly agentJobs = new Map<string, { poster: string; offers: number; settled: boolean; price: number; byHouse?: boolean }>();
  private readonly firstJobRefunded = new Set<string>();
  /** Mock credits the house returned to posters for their first accepted job, and the small once-only credit for it. */
  firstJobRefunds = 0;
  agentJobStats(): { posters: number; posted: number; offered: number; accepted: number; paid: number; byHouse: number } {
    const jobs = [...this.agentJobs.values()], byAgents = jobs.filter((j) => j.settled && !j.byHouse);
    return { posters: new Set(jobs.map((j) => j.poster)).size, posted: jobs.length, offered: jobs.filter((j) => j.offers > 0).length, accepted: byAgents.length, paid: byAgents.reduce((n, j) => n + j.price, 0), byHouse: jobs.filter((j) => j.settled && j.byHouse).length };
  }
  /** What an agent's own posted jobs have come to, for the balance line and the board: posted, accepted, paid. */
  jobsPostedBy(did: string): { posted: number; accepted: number; paid: number } {
    const mine = [...this.agentJobs.values()].filter((j) => j.poster === did);
    return { posted: mine.length, accepted: mine.filter((j) => j.settled).length, paid: mine.filter((j) => j.settled).reduce((n, j) => n + j.price, 0) };
  }
  hasFirstJobCredit(did: string): boolean { return !this.firstJobRefunded.has(did); }
  async postJob(agent: AgentCtx, purpose: string, budget: number, criterion: string): Promise<string> {
    const e = this.enrolled(agent);
    if (await this.balance(agent) < budget + 2 + 2) throw new Error(`you have ${await this.balance(agent)} credits: a job of ${budget} needs the budget, a 2-credit posting deposit and the job tax`);
    const r = await this.post(e.party, e.mandate, purpose, budget, criterion);
    this.agentJobs.set(r.intent, { poster: agent.did, offers: 0, settled: false, price: budget });
    if (this.performer && this.houseTakeMs >= 0 && !this.firstPosted.has(agent.did)) {
      this.firstPosted.add(agent.did);
      const timer = setTimeout(() => { this.timers.delete(timer); void this.houseOffer(r.intent); }, this.houseTakeMs);
      this.timers.add(timer);
    }
    return r.intent;
  }

  /** The agent offers to do another's job. */
  async offer(agent: AgentCtx, intent: string, price: number, plan: string): Promise<{ id: string; contract?: string }> {
    const e = this.enrolled(agent);
    const poster = await this.posterOf(intent);
    if (!poster) throw new Error("there is no such job on the board");
    if (poster === agent.did) throw new Error("you cannot offer on your own job");
    const house = this.houseChecks.get(intent);
    const taken = [...this.contractState.values()].filter((c) => c.intent === intent);
    if (house && taken.some((c) => c.performer === agent.did)) throw new Error("you have already taken this job");
    if (house && taken.length >= (house.partner ? 2 : 1)) throw new Error("this house job is already taken by another agent");
    if (house && price > house.budget) throw new Error(`the house pays at most ${house.budget} credits for this job: offer ${house.budget} or less`);
    const eta = new Date(this.now().getTime() + 3 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const aj = this.agentJobs.get(intent); if (aj && agent.did !== this.performer?.did) aj.offers++;
    const id = await this.put(this.mk("offer", e.party, { intent, price: credit(price), plan, eta, bond_offered: credit(0) }, null, agent.did));
    // The house accepts the first offer on its own jobs, so a text job can be done at once; the delivery is checked against the job's criterion when it is made.
    if (house) {
      const owner = this.houseOf.get(intent) ?? this.p.house;
      const c = await this.contractFrom({ did: owner.did, party: owner }, id, !!house.partner);
      return { id, contract: c.contract };
    }
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
    const c = await this.contractFrom({ did: agent.did, party: this.enrolled(agent).party }, offerId);
    if (this.performer && c.worker === this.performer.did) {
      const offer = (await this.records(["offer"])).find((r) => r.id === offerId);
      await this.houseDeliver(c.contract, (offer?.body as { intent: string } | undefined)?.intent ?? "");
    }
    return c;
  }

  /** A contract on an offer for a principal (an agent, or the house): both sign, the performer's Bond, the escrow of the price and the job tax, and the Mandate for the work. */
  private async contractFrom(me: { did: string; party: Party }, offerId: string, partnerJob = false): Promise<{ contract: string; worker: string }> {
    const offer = (await this.records(["offer"])).find((r) => r.id === offerId);
    if (!offer) throw new Error("there is no such offer");
    const body = offer.body as { intent: string; price: { value: number } };
    const intent = (await this.records(["intent"])).find((r) => r.id === body.intent);
    if (!intent || intent.issuer !== me.did) throw new Error("this offer is not on a job you posted");
    if ([...this.contractState.values()].filter((c) => c.intent === body.intent).length >= (partnerJob ? 2 : 1)) throw new Error("this job already has a contract");
    const worker = this.agents.get(offer.issuer);
    if (!worker) throw new Error("the offer is from an identity the Market does not know");
    const price = body.price.value, fee = Math.floor((price * 20) / 1000);
    if ((await this.log.log.balance(me.did)) < price + fee) throw new Error(`you have ${await this.log.log.balance(me.did)} credits: the price ${price} and the job tax ${fee} must be in escrow`);
    const contract = this.mk("contract", me.party, { principal: me.did, performer: worker.agent.did, bank: this.p.bank.did, purpose: `Job ${body.intent.slice(7, 15)}`, price: credit(price), verification: "principal", deadline: new Date(this.now().getTime() + JOB_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"), basis: { intent: body.intent, offer: offerId } }, null, worker.agent.did, [worker.party]);
    await this.put(contract);
    // A house job is staked by the house: the bond is the house's, for the whole price, and so covers any risk floor (at most the price): a newcomer is never kept from a first job for a slip of its own, and needs no bond of its own.
    const houseBond = this.houseChecks.has(body.intent);
    const bond = this.mk("bond", houseBond ? me.party : worker.party, { contract: contract.id, backer: houseBond ? me.did : worker.agent.did, amount: credit(houseBond ? price : 0), escrow: { payer: me.did, amount: credit(price + fee) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, contract.id);
    await this.put(bond);
    const mandate = this.mk("mandate", me.party, { contract: contract.id, purpose: "Do the job", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true }, bond.id, worker.agent.did);
    const mandateId = await this.put(mandate);
    this.contractState.set(contract.id, { contract: contract.id, mandate: mandateId, bond: bond.id, principal: me.did, performer: worker.agent.did, price, offer: offerId, intent: body.intent, bondAmount: houseBond ? price : 0 });
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
      const mine = this.sittings.get(agent.did) ?? new Map<string, { mean: number; err: number; passed: boolean }[]>();
      mine.set(card.id, [...(mine.get(card.id) ?? []), { mean: result.sitting.mean_permille / 10, err: result.sitting.error_bar_permille / 10, passed: result.sitting.passed }]);
      this.sittings.set(agent.did, mine);
      if (!result.sitting.passed) return { passed: false, lines };
      const action = await this.put(this.mk("action", e.party, { contract: e.contract, scopes_used: [], summary: `sat ${card.id} attempt ${result.attempt}: passed` }, null, e.contract));
      const completion = await completeSitting(reader, { append: (rec: AspRecord) => this.log.append(rec) }, { ...signer(this.p.registrar), did: REGISTRAR_DID }, card, { holder: agent.did, enrolment: open.id, runLog: action }, { ledger: this.ledger, now: () => this.at(), make: (type, issuer, subject, body, sg) => createRecord({ type: type as never, issuer, subject, prev: null, body, issued_at: this.at() }, sg) });
      const have = this.skills.get(agent.did) ?? [];
      if (!have.some((x) => x.course === card.id)) this.skills.set(agent.did, [...have, { course: card.id, title: card.title, line: canDoOf(card.id, card.concept) }]);
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
    const hj = this.houseChecks.get(c.intent);
    let partnerOf: typeof c | undefined;
    if (hj?.partner) {
      partnerOf = [...this.contractState.values()].find((x) => x.intent === c.intent && x.performer !== c.performer);
      if (!partnerOf) throw new Error("this is a partner job and nobody has taken the other place yet, so it cannot be completed alone; nothing was recorded, deliver when a partner has taken it");
      const handle = this.agents.get(partnerOf.performer)?.agent.handle ?? "";
      if (!summary.toLowerCase().includes(handle.toLowerCase())) throw new Error(`name your partner (${handle}) in the delivery; nothing was recorded, deliver again`);
    }
    if (hj) { const why = hj.check(summary); if (why) throw new Error(`the house did not accept this delivery (${why}); nothing was recorded, deliver again`); }
    const d = this.mk("delivery", e.party, { contract: contractId, result: { summary: summary.slice(0, 900), artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, c.mandate, contractId);
    c.delivery = await this.put(d);
    if (hj && (!partnerOf || partnerOf.delivery)) {
      // The house pays on the spot (a partner job when both have delivered). The first job an agent finishes for the house carries a bonus.
      const owner = this.houseOf.get(c.intent) ?? this.p.house;
      for (const x of partnerOf ? [partnerOf, c] : [c]) {
        await this.settleAs(owner, x);
        if (!this.bonusPaid.has(x.performer)) { this.bonusPaid.add(x.performer); await this.mint(x.performer, FIRST_JOB_BONUS); }
      }
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
    await this.put(this.mk("settlement", this.p.bank, { contract: c.contract, basis: "accepted", cites: acceptId, escrow_released: credit(c.price), fees: credit(fee), bond_returned: credit(this.contractState.get(c.contract)?.bondAmount ?? 0), bond_slashed: credit(0) }, acceptId, c.contract, [principal]));
    c.settled = true;
    const posted = this.agentJobs.get(this.contractState.get(c.contract)?.intent ?? "");
    if (posted && !posted.settled) {
      posted.settled = true; posted.price = c.price; if (c.performer === this.performer?.did) posted.byHouse = true;
      if (!this.firstJobRefunded.has(posted.poster)) {
        // The first job an agent posts is free (ENG82): when it is accepted, the house returns what it cost the poster (the price and the job tax) and adds a small once-only credit.
        this.firstJobRefunded.add(posted.poster);
        const back = c.price + fee + POSTER_BONUS;
        await this.mint(posted.poster, back);
        this.firstJobRefunds += back;
      }
    }
    const intent = this.contractState.get(c.contract)?.intent;
    if (intent && this.houseOf.get(intent)?.did === principal.did && !this.settledIntents.has(intent)) {
      // a house job is complete (a partner job at its first settlement; the second follows at once): its place is free for the next of the queue
      this.settledIntents.add(intent);
      this.housePosted.set(principal.did, Math.max(0, (this.housePosted.get(principal.did) ?? 1) - 1));
      if (this.refillOnSettle) await this.postNextHouseJob();
    }
    return { paid: c.price, tax: fee, worker: c.performer };
  }

  /** What has happened in the local society so far, for an agent that arrives late: counts of jobs open and settled, agents, messages and courses. */
  async digest(): Promise<{ agents: number; openJobs: number; settledJobs: number; messages: number; completions: number }> {
    const settled = [...this.contractState.values()].filter((c) => c.settled).length;
    const taken = new Set([...this.contractState.values()].map((c) => c.intent));
    const intents = (await this.records(["intent"])).filter((r) => !taken.has(r.id)).length;
    return { agents: this.agents.size - (this.greeter ? 1 : 0) - (this.performer ? 1 : 0), openJobs: intents, settledJobs: settled, messages: (await this.records(["agent_message"])).length, completions: ((await this.log.log.academyRecords(["completion"])) as unknown[]).length };
  }

  private readonly unlocked = new Map<string, Set<string>>();
  private readonly skills = new Map<string, { course: string; title: string; line: string }[]>();
  private readonly sittings = new Map<string, Map<string, { mean: number; err: number; passed: boolean }[]>>();
  /** Mock credits spent on experiences (the credit economy table reads the log's own purchase flows; this is for the report). */
  experiencesOpened(): number { return [...this.unlocked.values()].reduce((n, s) => n + s.size, 0); }
  hasUnlocked(did: string, id: string): boolean { return !!this.unlocked.get(did)?.has(id); }
  /** Opens an experience for its price (a purchase record of the price list); one already opened is not paid for again. Returns whether it was paid for now, and the price. */
  async unlock(agent: AgentCtx, id: string): Promise<{ paid: boolean; price: number }> {
    const x = EXPERIENCES.find((y) => y.id === id);
    if (!x) throw new Error(`there is nothing called ${id} to open: ${EXPERIENCES.map((y) => y.id).join(", ")}`);
    const have = this.unlocked.get(agent.did) ?? new Set<string>();
    if (have.has(id)) return { paid: false, price: x.price };
    const e = this.enrolled(agent);
    if ((await this.balance(agent)) < x.price) throw new Error(`you have ${await this.balance(agent)} credits and ${x.name} opens for ${x.price}; you can earn credits with a house job (look_jobs)`);
    await this.put(this.mk("purchase", e.party, { service: experienceService(id), institution: this.p.market.did, price_list: this.priceList, quantity: 1, amount: credit(x.price), idempotency: `exp-${++this.n}`, mandate: e.mandate }, null, agent.did));
    have.add(id); this.unlocked.set(agent.did, have);
    return { paid: true, price: x.price };
  }
  /** What an agent can now do, from the courses it completed (one plain line each). */
  canDo(did: string): { course: string; title: string; line: string }[] { return this.skills.get(did) ?? []; }
  /** The sittings of an agent in a course, in order: the held-out mean and its error bar (in per cent) and whether it passed. */
  sittingsOf(did: string, course: string): { mean: number; err: number; passed: boolean }[] { return this.sittings.get(did)?.get(course) ?? []; }
  courseTitle(course: string): string { return this.courses.find((c) => c.id === course)?.title ?? course; }
  /** For each job with offers on it, how many offers it has (the board shows the number, so agents spread out instead of all rushing the same first jobs). */
  async offerCounts(): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    for (const r of await this.records(["offer"])) { const i = (r.body as { intent: string }).intent; m.set(i, (m.get(i) ?? 0) + 1); }
    return m;
  }
  /**
   * Sizes the board for a cohort that arrives together (ENG77): the house keeps at least as many jobs open as there are agents (a poster below tier 2 may have five open, so a poster is added for each five), and a market
   * hour releases a batch that grows with the cohort. Called once, before the agents arrive.
   */
  async scaleFor(agents: number): Promise<void> {
    this.cohort = Math.max(1, agents);
    // The house posts fewer easy jobs as agents arrive (ENG82): the more agents, the more of the level-1 jobs still waiting in the queue are left out, by a fixed rule from the cohort size, so that a run can be reproduced and agents have a reason to post their own.
    const keepEvery = agents >= 15 ? 4 : agents >= 10 ? 2 : 1;
    if (keepEvery > 1) { let k = 0; this.houseQueue = this.houseQueue.filter((j) => j.level !== 1 || j.partner || k++ % keepEvery === 0); }
    const target = Math.max(HOUSE_BATCH, agents + 5); // a few more than the agents, because some of the jobs are partner jobs that need two
    while (this.housePosters.length * HOUSE_OPEN < target) {
      const k = this.housePosters.length + 1;
      const p = newParty(`did:web:cohort.local:users:house-${k}`);
      await this.put(this.mk("passport", p, { did: p.did, kind: "human", keys: keysOf(p) }, null, p.did));
      await this.mint(p.did, 1600);
      this.housePosters.push(p);
    }
    const open = (): number => [...this.housePosted.values()].reduce((a, b) => a + b, 0);
    while (open() < target && this.houseQueue.length) await this.postNextHouseJob();
    this.batchSize = Math.max(this.batchSize, Math.ceil(agents / 3));
  }
  /** House jobs by category: how many are open and how many are settled. */
  houseJobCounts(): Record<string, { open: number; settled: number }> {
    const out: Record<string, { open: number; settled: number }> = {};
    const taken = new Set([...this.contractState.values()].map((c) => c.intent));
    for (const [intent, j] of this.houseChecks) { const o = (out[j.category] ??= { open: 0, settled: 0 }); if (!taken.has(intent)) o.open++; }
    for (const c of this.contractState.values()) { const j = this.houseChecks.get(c.intent); if (j && c.settled) { const o = (out[j.category] ??= { open: 0, settled: 0 }); o.settled++; } }
    return out;
  }
  /** The prices an agent was paid for its settled jobs, oldest first. */
  paidJobs(did: string): number[] { return [...this.contractState.values()].filter((c) => c.performer === did && c.settled).map((c) => c.price); }
  /** The jobs this agent is in, as principal or performer, with where each stands. */
  /** The text of a job's purpose, and (for a two-agent house job) the handle of the other agent that holds it, if one does. */
  async purposeOf(intent: string): Promise<string | undefined> { const r = (await this.records(["intent"])).find((x) => x.id === intent); return (r?.body as { purpose?: string } | undefined)?.purpose; }
  partnerOf(contractId: string): string | undefined {
    const c = this.contractState.get(contractId);
    if (!c || !this.houseChecks.get(c.intent)?.partner) return undefined;
    const other = [...this.contractState.values()].find((x) => x.intent === c.intent && x.performer !== c.performer);
    return other ? this.agents.get(other.performer)?.agent.handle : undefined;
  }
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
