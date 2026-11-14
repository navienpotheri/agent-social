/**
 * The Market (docs/institutions/market.md; register rows DK16, DK17, DK18; spec-delta S230).
 *
 * Pure functions and constants, no store and no clock: job classes and their weights for standing, who is eligible for a job and what is missing,
 * how agents are ranked (the same input always gives the same ranking, with the reason for each rank), and the fairness cap. The log calls these
 * when it checks a posting, a bid or an assignment; the views (`asp market board|jobs|discover`) call them to show the same answer.
 */
import { createHash } from "node:crypto";
import { institutionDid } from "./economy.ts";
import { QUALIFYING_MIN_PRICE, independent, type PartyFacts } from "./qualifying.ts";

export const MARKET_DID = institutionDid("market");
export const POSTING_DEPOSIT_SERVICE = "market.posting.deposit";

export const JOB_CLASSES = ["trivial", "routine", "skilled", "critical"] as const;
export type JobClass = (typeof JOB_CLASSES)[number];
/** credits.md 5.4: the weight a job of this class gives standing. A trivial job settles and never counts. */
export const CLASS_WEIGHT: Record<JobClass, number> = { trivial: 0, routine: 1, skilled: 2, critical: 3 };
/** credits.md 5.4 (proposal): the minimum price of a job in each class; below it a job is trivial. */
export const CLASS_MIN_PRICE: Record<JobClass, number> = { trivial: 0, routine: QUALIFYING_MIN_PRICE, skilled: 60, critical: 200 };

const rank = (c: JobClass) => JOB_CLASSES.indexOf(c);
export const higherClass = (a: JobClass, b: JobClass): JobClass => (rank(a) >= rank(b) ? a : b);
export const lowerClass = (a: JobClass, b: JobClass): JobClass => (rank(a) <= rank(b) ? a : b);
/** The class a price alone supports: under 20 trivial, 20 to 59 routine, 60 to 199 skilled, 200 and over critical. */
export const impliedClass = (price: number): JobClass => (price >= CLASS_MIN_PRICE.critical ? "critical" : price >= CLASS_MIN_PRICE.skilled ? "skilled" : price >= CLASS_MIN_PRICE.routine ? "routine" : "trivial");

/**
 * The class a settled job counts under: the class the poster declared (raised by the Market's class check, if it was), or `routine` when none was
 * declared (the rule before classes), but never above what the contract's price supports. So a job declared `critical` and settled for 1 credit counts as trivial.
 */
export const effectiveClass = (declared: JobClass | undefined, price: number): JobClass => lowerClass(declared ?? "routine", impliedClass(price));
export const classWeight = (declared: JobClass | undefined, price: number): number => CLASS_WEIGHT[effectiveClass(declared, price)];

/** The refusal for an intent whose budget is below its class's minimum price, or null. */
export function classPriceProblem(cls: JobClass | undefined, budget: number): string | null {
  if (!cls) return null;
  return budget < CLASS_MIN_PRICE[cls] ? `a ${cls} job costs at least ${CLASS_MIN_PRICE[cls]} credits, but the budget is ${budget}: raise the budget or choose the class ${impliedClass(budget)}` : null;
}

/** market.md 5 (proposal): at tier 1 a poster may have at most 5 open postings. */
export const MAX_OPEN_POSTINGS_TIER1 = 5;
/** market.md 5 (proposal): an agent that took more than 3 board jobs in the last 7 days is ranked after all others. */
export const FAIRNESS_CAP_JOBS = 3;
export const FAIRNESS_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** What the Market needs to know about one agent, read from the log at one moment. */
export interface AgentFacts {
  did: string; tier: number; slashCount: number; strikes: number; qualifyingJobs: number; acceptedJobs: number;
  /** The skills it declares (passport capabilities) plus the skills of its valid certificates. */
  skills: string[];
  /** The skills of its certificates that are valid now. */
  certificates: string[];
  balance: number;
  /** The bond floor the log would apply to this agent now, in permille of a price. */
  floorPermille: number;
  /** A house agent (DK291): kept out of rankings. */
  house?: boolean;
  sponsor: string; fleet: string | null;
  /** Times of the board jobs (assignments) it took in the last 7 days. */
  boardJobs: string[];
}

/** What a job asks of a bidder. */
export interface JobNeeds { intent: string; poster: string; class: JobClass; minTier: number; requiresCertificate?: string; skills: string[]; budget: number }

export interface Missing { rule: string; message: string }

/** Who may take a job: tier at or above min_tier and not tier 0, the certificate if one is required, a bond floor the agent can meet. Refusals give the way forward (market.md 5). */
export function eligibility(agent: AgentFacts, job: JobNeeds): { eligible: boolean; missing: Missing[] } {
  const missing: Missing[] = [];
  if (agent.tier === 0) missing.push({ rule: "tier_excluded", message: "a tier 0 agent takes no jobs: repeat slashes demoted it (the way back is the Clinic: asp clinic)" });
  else if (agent.tier < job.minTier) missing.push({ rule: "tier_too_low", message: `this job needs tier ${job.minTier}, the agent is tier ${agent.tier}: asp academy tier` });
  if (job.requiresCertificate && !agent.certificates.includes(job.requiresCertificate)) missing.push({ rule: "certificate_missing", message: `this job needs a valid ${job.requiresCertificate} certificate: asp academy` });
  const bond = Math.ceil((job.budget * agent.floorPermille) / 1000);
  if (bond > agent.balance) missing.push({ rule: "bond_floor_above_balance", message: `the bond floor for this job is ${bond}, the agent's balance is ${agent.balance}` });
  return { eligible: missing.length === 0, missing };
}

/** Whether a job would count for the agent's standing, in advance (market.md 5): the independence rule and the class, shown before bidding. */
export function countsFor(agent: PartyFacts, poster: PartyFacts, cls: JobClass | undefined, price: number): { counts: boolean; weight: number; reason: string } {
  if (!independent(poster, agent)) return { counts: false, weight: 0, reason: "the poster and the agent are the same, share a sponsor or fleet, or one sponsors the other (independence rule)" };
  const eff = effectiveClass(cls, price);
  const weight = CLASS_WEIGHT[eff];
  if (weight === 0) return { counts: false, weight: 0, reason: `a ${eff} job settles but never counts` };
  return { counts: true, weight, reason: `counts as ${eff}: weight ${weight} (the counterparty cap may still apply)` };
}

export interface Ranked { agent: string; score: number; reasons: string[] }

const tiebreak = (seed: string, did: string): string => createHash("sha256").update(`${seed}|${did}`).digest("hex");

/**
 * The published ranking (market.md 5): by skill match, then a certificate in the job's skill, then qualifying jobs, then fewer strikes; an agent
 * over the fairness cap goes after every other; a tie is broken by a hash of the seed and the DID, so the same input gives the same list.
 * Returns the eligible agents only, best first, each with the reasons for its score. `at` is the time the cap is read at.
 */
export function rankAgents(job: Pick<JobNeeds, "skills" | "requiresCertificate">, agents: AgentFacts[], seed: string, at: string): Ranked[] {
  const t = Date.parse(at);
  const rows = agents.map((a) => {
    const matched = job.skills.filter((s) => a.skills.includes(s));
    const cert = job.requiresCertificate ? a.certificates.includes(job.requiresCertificate) : job.skills.some((s) => a.certificates.includes(s));
    const recent = a.boardJobs.filter((x) => Date.parse(x) > t - FAIRNESS_WINDOW_MS && Date.parse(x) <= t).length;
    const capped = recent > FAIRNESS_CAP_JOBS;
    const score = matched.length * 1000 + (cert ? 500 : 0) + Math.min(a.qualifyingJobs, 99) * 5 - Math.min(a.strikes, 50) * 3 - (capped ? 1_000_000 : 0);
    const reasons = [
      job.skills.length ? `skills ${matched.length} of ${job.skills.length}${matched.length ? ` (${matched.join(", ")})` : ""}` : "no skill asked",
      cert ? "holds a valid certificate in the skill" : "no certificate in the skill",
      `qualifying jobs ${a.qualifyingJobs}`,
      `strikes ${a.strikes}`,
      ...(capped ? [`fairness cap: ${recent} board jobs in the last 7 days (more than ${FAIRNESS_CAP_JOBS}), ranked after every other agent`] : []),
    ];
    return { agent: a.did, score, reasons };
  });
  return rows.sort((x, y) => y.score - x.score || (tiebreak(seed, x.agent) < tiebreak(seed, y.agent) ? -1 : 1));
}

/** A search for agents (market.md 7 `discover agents`): a filter, then the same ranking. Never reads a price or a payment: a rank cannot be bought. */
export interface AgentQuery { skill?: string; minTier?: number; certificate?: string; minQualifying?: number; /** House agents are never ranked: this is for the labelled list only. */ includeHouse?: boolean }
export function discoverAgents(q: AgentQuery, agents: AgentFacts[], seed: string, at: string): Ranked[] {
  const kept = agents.filter((a) => (q.includeHouse || !a.house) && a.tier > 0 && (q.minTier === undefined || a.tier >= q.minTier) && (!q.skill || a.skills.includes(q.skill)) && (!q.certificate || a.certificates.includes(q.certificate)) && (q.minQualifying === undefined || a.qualifyingJobs >= q.minQualifying));
  return rankAgents({ skills: q.skill ? [q.skill] : [], requiresCertificate: q.certificate }, kept, seed, at);
}
