/**
 * The log's rules for the Market's records (market.md 3; DK16, DK17, DK18; spec-delta S230): what makes a posting, a withdrawal, a class check, a bid
 * and an assignment valid, and the facts about an agent the ranking reads. Called from `EventLog`; it keeps its state in markers, written inside the
 * append, so a refused record leaves none.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { bondFloorPermille } from "./bond-floor.ts";
import { MAX_OPEN_POSTINGS_TIER1, MARKET_DID, POSTING_DEPOSIT_SERVICE, CLASS_WEIGHT, JOB_CLASSES, classPriceProblem, eligibility, higherClass, rankAgents, type AgentFacts, type JobClass, type JobNeeds } from "./market.ts";
import { assertNotDormant } from "./shops-rules.ts";
import type { LogTx, Store } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const DAY = 24 * 3600 * 1000;
const STRIKE_WINDOW = 30 * DAY;

/** The log's own helpers the rules need, passed in so this file does not reach into the log's private state. */
export interface MarketEnv {
  operator?: string;
  bondFloor: "legacy" | "v2";
  reputation(rd: Pick<Store, "getPassport" | "getRecord" | "getReputation">, did: string): Promise<{ tier: number; slashCount: number; strikeLog: { at: string; count: number }[]; acceptedJobs: number; qualifyingJobs: number } | null>;
}

type Reader = Pick<Store, "getPassport" | "getRecord" | "getReputation" | "getAccount" | "fleetMembers">;

/** The facts about one agent (market.md 5) read from the log at `at`: what the ranking and the eligibility check need. Null for a DID with no agent record. */
export async function agentFacts(rd: Reader, env: MarketEnv, did: string, at: string, certificates: AspRecord[], boardJobs: string[]): Promise<AgentFacts | null> {
  const rep = await env.reputation(rd, did);
  const passport = await rd.getPassport(did);
  if (!rep || !passport) return null;
  const body = (await rd.getRecord(passport.head))?.record.body as { capabilities?: { skill: string }[] } | undefined;
  const t = Date.parse(at);
  const valid = certificates.filter((c) => { const b = c.body as { holder: string; issued: string; expires: string }; return b.holder === did && Date.parse(b.issued) <= t && Date.parse(b.expires) > t; }).map((c) => (c.body as { skill: string }).skill);
  let fleetSlashes = 0;
  if (passport.fleet) for (const m of await rd.fleetMembers(passport.fleet)) if (m.did !== did) fleetSlashes += (await env.reputation(rd, m.did))?.slashCount ?? 0;
  const strikes = rep.strikeLog.filter((s) => Date.parse(s.at) >= t - STRIKE_WINDOW).reduce((n, s) => n + s.count, 0);
  const floor = env.bondFloor === "v2"
    ? bondFloorPermille({ ownSlashes: rep.slashCount, fleetSlashes, recentStrikes: strikes, verifiedImprovements: 0, acceptedCleanJobs: rep.qualifyingJobs, regressions: 0 })
    : Math.min(1000, rep.slashCount * 250 + fleetSlashes * 100 + Math.min(200, strikes * 10));
  return {
    did, tier: rep.tier, slashCount: rep.slashCount, strikes, qualifyingJobs: rep.qualifyingJobs, acceptedJobs: rep.acceptedJobs,
    skills: [...new Set([...(body?.capabilities ?? []).map((c) => c.skill), ...valid])].sort(), certificates: [...new Set(valid)].sort(),
    balance: (await rd.getAccount(did))?.balance ?? 0, floorPermille: floor, sponsor: passport.sponsor ?? did, fleet: passport.fleet, boardJobs,
  };
}

/** What a job asks of a bidder, from its intent (and any class the Market raised it to). */
export function jobNeeds(intent: AspRecord, raised?: JobClass): JobNeeds {
  const b = intent.body as { class?: JobClass; budget: { value: number }; min_tier?: number; requires_certificate?: string; skills?: string[] };
  return { intent: intent.id, poster: intent.issuer, class: raised ? higherClass(raised, b.class ?? "routine") : (b.class ?? "routine"), minTier: b.min_tier ?? 0, requiresCertificate: b.requires_certificate, skills: b.skills ?? [], budget: b.budget.value };
}

/** An intent's class must fit its budget (class_price_mismatch), and a private intent is never posted. */
export function checkIntentClass(r: AspRecord): void {
  const b = r.body as { class?: JobClass; budget: { value: number } };
  const problem = classPriceProblem(b.class, b.budget.value);
  if (problem) throw rule("class_price_mismatch", problem);
}

interface PostingInfo { intent: string; poster: string; expires: string; deposit: string }
const readList = async (tx: LogTx, key: string): Promise<string[]> => ((await tx.getMarker(key)) ?? "").split(",").filter(Boolean);
const addTo = async (tx: LogTx, key: string, v: string) => { const l = await readList(tx, key); if (!l.includes(v)) await tx.putMarker(key, [...l, v].join(",")); };

/** The state of a posting: open, withdrawn, assigned:<agent> or filled:<contract>. */
export const postingState = async (tx: Pick<LogTx, "getMarker">, id: string): Promise<string> => (await tx.getMarker(`posting_state:${id}`)) ?? "open";

async function loadPosting(tx: LogTx, id: string, now: string): Promise<PostingInfo> {
  const raw = await tx.getMarker(`posting:${id}`);
  if (!raw) throw rule("posting_unknown", `${id} is not a posting in this log`);
  const info = JSON.parse(raw) as PostingInfo;
  if ((await postingState(tx, id)) !== "open") throw rule("posting_closed", `the posting ${id} is no longer open (${await postingState(tx, id)})`);
  if (Date.parse(info.expires) <= Date.parse(now)) throw rule("posting_expired", `the posting ${id} expired at ${info.expires}`);
  return info;
}

export async function projectMarketAct(tx: LogTx, r: AspRecord, env: MarketEnv): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.prev !== null) throw rule("market_act_not_chained", "a market act starts its own chain (prev is null)");
  const now = r.issued_at;

  if (b.act === "posting") {
    await assertNotDormant(tx, r.issuer, "post a job");
    const intent = await tx.getRecord(b.intent);
    if (!intent || intent.record.type !== "asp.intent/v0.2") throw rule("posting_intent_unknown", `${b.intent} is not an intent in this log`);
    if (intent.record.issuer !== r.issuer) throw rule("posting_not_posters", `the intent ${b.intent} was signed by ${intent.record.issuer}: only its poster lists it`);
    if ((intent.record.body as { listed?: string }).listed === "private") throw rule("posting_private", "this intent is marked private: it is not listed on the board");
    if (await tx.getMarker(`posting_for_intent:${b.intent}`)) throw rule("posting_exists", `the intent ${b.intent} is already posted`);
    if (Date.parse(b.expires) <= Date.parse(now)) throw rule("posting_expired", "a posting must expire after it is made");
    const deposit = await tx.getRecord(b.deposit);
    const pb = deposit?.record.body as { service?: string; institution?: string } | undefined;
    if (!deposit || deposit.record.type !== "asp.purchase/v0.2") throw rule("posting_deposit_unknown", `${b.deposit} is not a purchase in this log: pay the deposit first (asp credits buy ${POSTING_DEPOSIT_SERVICE})`);
    if (deposit.record.issuer !== r.issuer) throw rule("posting_deposit_not_posters", "the deposit was paid by someone else");
    if (pb?.service !== POSTING_DEPOSIT_SERVICE || pb.institution !== MARKET_DID) throw rule("posting_deposit_wrong_item", `the deposit must be a purchase of ${POSTING_DEPOSIT_SERVICE} from the Market`);
    if (await tx.getMarker(`deposit_used:${b.deposit}`)) throw rule("posting_deposit_used", "this deposit already pays for another posting");
    const rep = await env.reputation(tx, r.issuer);
    if (rep?.tier === 0) throw rule("tier_excluded", `${r.issuer} is tier 0: repeat slashes demoted it, so it may not post jobs`);
    if (!rep || rep.tier <= 1) {
      const open: string[] = [];
      for (const id of await readList(tx, `open_postings:${r.issuer}`)) {
        const info = JSON.parse((await tx.getMarker(`posting:${id}`)) ?? "null") as PostingInfo | null;
        if (info && Date.parse(info.expires) > Date.parse(now) && (await postingState(tx, id)) === "open") open.push(id);
      }
      if (open.length >= MAX_OPEN_POSTINGS_TIER1) throw rule("posting_cap", `a poster at tier 1 or below has at most ${MAX_OPEN_POSTINGS_TIER1} open postings; ${open.length} are open (withdraw one or wait for one to end)`);
    }
    await tx.putMarker(`posting:${r.id}`, JSON.stringify({ intent: b.intent, poster: r.issuer, expires: b.expires, deposit: b.deposit } satisfies PostingInfo));
    await tx.putMarker(`posting_for_intent:${b.intent}`, r.id);
    await tx.putMarker(`deposit_used:${b.deposit}`, r.id);
    await addTo(tx, `open_postings:${r.issuer}`, r.id);
    return;
  }

  if (b.act === "withdraw") {
    const info = await loadPosting(tx, b.posting, now);
    if (info.poster !== r.issuer) throw rule("withdraw_not_posters", "only the poster withdraws a posting");
    await tx.putMarker(`posting_state:${b.posting}`, "withdrawn");
    return;
  }

  if (b.act === "class_check") {
    if (r.issuer !== MARKET_DID) throw rule("class_check_wrong_issuer", `${r.issuer} is not the Market (${MARKET_DID}): only the Market checks a class`);
    const intent = await tx.getRecord(b.intent);
    if (!intent || intent.record.type !== "asp.intent/v0.2") throw rule("class_check_intent_unknown", `${b.intent} is not an intent in this log`);
    const raised = (await tx.getMarker(`class_raise:${b.intent}`)) as JobClass | undefined;
    const current = jobNeeds(intent.record, raised).class;
    if (b.verdict === "confirmed" && b.class !== current) throw rule("class_check_mismatch", `a confirmed check names the class in force (${current}), not ${b.class}`);
    if (b.verdict === "changed_to" && JOB_CLASSES.indexOf(b.class) <= JOB_CLASSES.indexOf(current)) throw rule("class_check_lowers", `the Market may raise a class, never lower it or leave it as it is: ${current} to ${b.class} is not a raise`);
    if (b.verdict === "changed_to") await tx.putMarker(`class_raise:${b.intent}`, b.class);
    return;
  }

  if (b.act === "bid") {
    await assertNotDormant(tx, r.issuer, "bid on a job");
    const info = await loadPosting(tx, b.posting, now);
    if (info.poster === r.issuer) throw rule("self_hire", "a poster does not bid on its own posting");
    const offer = await tx.getRecord(b.offer);
    const ob = offer?.record.body as { intent?: string } | undefined;
    if (!offer || offer.record.type !== "asp.offer/v0.2" || offer.record.issuer !== r.issuer || ob?.intent !== info.intent) throw rule("bid_offer_mismatch", "a bid names the agent's own offer on this posting's intent");
    const intent = (await tx.getRecord(info.intent))!;
    const facts = await facts_(tx, env, r.issuer, now);
    if (!facts) throw rule("bid_not_an_agent", `${r.issuer} has no agent record in this log`);
    const raised = (await tx.getMarker(`class_raise:${info.intent}`)) as JobClass | undefined;
    const verdict = eligibility(facts, jobNeeds(intent.record, raised));
    if (!verdict.eligible) throw rule(verdict.missing[0].rule, verdict.missing.map((m) => m.message).join("; "));
    if (facts.tier <= 1) {
      let open = 0;
      for (const id of await readList(tx, `open_bids:${r.issuer}`)) {
        const pi = JSON.parse((await tx.getMarker(`posting:${id}`)) ?? "null") as PostingInfo | null;
        if (pi && Date.parse(pi.expires) > Date.parse(now) && (await postingState(tx, id)) === "open") open++;
      }
      if (open >= 5) throw rule("bid_cap", "an agent at tier 1 has at most 5 open bids");
    }
    await addTo(tx, `bids:${b.posting}`, r.issuer);
    await addTo(tx, `open_bids:${r.issuer}`, b.posting);
    return;
  }

  if (b.act === "assignment") {
    if (r.issuer !== MARKET_DID) throw rule("assignment_wrong_issuer", `${r.issuer} is not the Market (${MARKET_DID}): only the Market assigns`);
    const info = await loadPosting(tx, b.posting, now);
    if (info.intent !== b.intent) throw rule("assignment_intent_mismatch", "the intent is not the posting's intent");
    const bidders = await readList(tx, `bids:${b.posting}`);
    if (!bidders.includes(b.agent)) throw rule("assignment_no_bid", `${b.agent} has not bid on this posting`);
    if (b.rule === "poster_choice") {
      let countersigned = false;
      for (const c of r.cosigs ?? []) if ((await tx.getKey(c.kid))?.did === info.poster) countersigned = true;
      if (!countersigned) throw rule("assignment_needs_poster", "a poster_choice assignment is countersigned by the poster");
    }
    const intent = (await tx.getRecord(info.intent))!;
    const raised = (await tx.getMarker(`class_raise:${info.intent}`)) as JobClass | undefined;
    const needs = jobNeeds(intent.record, raised);
    const candidates: AgentFacts[] = [];
    for (const did of bidders) {
      const f = await facts_(tx, env, did, now);
      if (f && eligibility(f, needs).eligible && (b.rule === "poster_choice" || !env.operator || f.sponsor !== env.operator)) candidates.push(f);
    }
    if (!candidates.some((c) => c.did === b.agent)) throw rule("assignment_not_eligible", `${b.agent} is not eligible for this job (tier, certificate or bond floor), or is run by the operator and so may not be assigned by best_match`);
    const ranked = rankAgents(needs, candidates, b.seed, now);
    if (JSON.stringify(ranked) !== JSON.stringify(b.ranked)) throw rule("ranking_not_reproducible", `the ranked list does not reproduce from the log by the published rule; the rule gives ${JSON.stringify(ranked.map((x) => x.agent))}`);
    if (b.rule === "best_match" && ranked[0].agent !== b.agent) throw rule("assignment_not_best_match", `the best match is ${ranked[0].agent}, not ${b.agent}`);
    await tx.putMarker(`posting_state:${b.posting}`, `assigned:${b.agent}`);
    await addTo(tx, `assigns:${b.agent}`, now);
  }
}

/** When a contract is made on a posted intent, the posting is filled and its deposit becomes returnable. */
export async function markPostingFilled(tx: LogTx, contract: AspRecord): Promise<void> {
  const intent = (contract.body as { basis?: { intent?: string } }).basis?.intent;
  if (!intent) return;
  const id = await tx.getMarker(`posting_for_intent:${intent}`);
  if (!id) return;
  const info = JSON.parse((await tx.getMarker(`posting:${id}`))!) as PostingInfo;
  await tx.putMarker(`posting_state:${id}`, `filled:${contract.id}`);
  await tx.putMarker(`posting_filled:${info.deposit}`, contract.id);
}

async function facts_(tx: LogTx, env: MarketEnv, did: string, at: string): Promise<AgentFacts | null> {
  const certs: AspRecord[] = [];
  for (const id of await readList(tx, `certs_of:${did}`)) { const c = await tx.getRecord(id); if (c) certs.push(c.record); }
  return agentFacts(tx, env, did, at, certs, await readList(tx, `assigns:${did}`));
}

export { CLASS_WEIGHT };
