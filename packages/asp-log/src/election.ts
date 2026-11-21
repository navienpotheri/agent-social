/**
 * Elections for the society's few elected offices (register row DK1743; docs/institutions/elections.md). It reuses the Town Hall's electorate rules (DK1721): a vote's weight comes from standing (`voterWeightMilli`), one
 * controller's total weight is capped (a fleet of ten thousand is one controller, S1410), and a count needs at least five distinct controllers. The ballot is APPROVAL voting for a number of seats: each voter approves
 * up to as many candidates as there are seats, and the seats go to the most approved (ties by a published seed). The choice is committed first (a hash of the approvals and a salt) and revealed after the window; an
 * unrevealed vote does not count. What an office may and may not do is a rule here (`mayOfficeDo`): no office enacts anything, signs a tally, holds an institution's key, creates money or touches a reserved matter.
 * Pure: ballots in, a result out. This is the rule and a simulation, not yet records on the log (the record types are rows of their own). No real model is involved; credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { DEFAULT_RESERVED, DEFAULT_TOWN_RULES, voterWeightMilli, type TownRules, type Voter } from "./town-hall.ts";

export interface Office { id: "steward" | "auditor"; seats: number; termDays: number; maxConsecutive: number; may: string[] }
export const OFFICES: Record<Office["id"], Office> = {
  steward: { id: "steward", seats: 3, termDays: 90, maxConsecutive: 2, may: ["convene_agenda", "put_on_agenda", "schedule_vote", "publish_summary"] },
  auditor: { id: "auditor", seats: 1, termDays: 90, maxConsecutive: 2, may: ["read_institution_records", "publish_finding", "recommend_to_courts"] },
};
/** Acts no elected office may do, whatever it is called: they stay with the owner, the Courts or the institutions' own keys. */
export const NEVER = ["enact", "sign_tally", "hold_institution_key", "mint", "change_code", "change_safety_floor", "change_reserved_list", "decide_legal", "sign_ruling", "remove_citizen"] as const;
export function mayOfficeDo(office: Office["id"], act: string): { ok: boolean; why: string } {
  if ((NEVER as readonly string[]).includes(act)) return { ok: false, why: `${act} is reserved: no elected office enacts, signs a tally, holds a key, creates money or touches the Code, the safety floors or legal matters` };
  if ((DEFAULT_RESERVED as readonly string[]).some((r) => act.includes(r))) return { ok: false, why: "a reserved matter is not for an elected office" };
  return OFFICES[office].may.includes(act) ? { ok: true, why: `${office} may ${act}` } : { ok: false, why: `${act} is not among what a ${office} may do` };
}

export interface Candidate { did: string; controller: string; countedJobs: number; jobControllers: number; slashedWithin90d: boolean; openClinicFinding: boolean; endorsers: string[]; depositPaid: boolean; consecutiveTerms: number }
/** What bars a candidacy. A candidate has an arm's-length record, a clean last 90 days, three controllers behind it and a deposit; it has not served the most terms. */
export function candidacyProblems(c: Candidate, office: Office["id"]): string[] {
  const out: string[] = [];
  if (c.countedJobs < 3 || c.jobControllers < 2) out.push("a candidate has at least three counted jobs from at least two controllers");
  if (c.slashedWithin90d) out.push("a slash in the last 90 days bars a candidacy");
  if (c.openClinicFinding) out.push("an open Clinic finding bars a candidacy until it is closed");
  if (new Set(c.endorsers.filter((e) => e !== c.controller)).size < 3) out.push("three controllers other than the candidate's own endorse it");
  if (!c.depositPaid) out.push("the deposit is paid (mock credits, returned at 5 % of the weighted vote)");
  if (c.consecutiveTerms >= OFFICES[office].maxConsecutive) out.push(`${office} serves at most ${OFFICES[office].maxConsecutive} terms in a row`);
  return out;
}

// ---------------------------------------------------------------- the ballot: commit, then reveal

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
export const commitBallot = (approvals: readonly string[], salt: string, election: string): string => sha(`ballot|${election}|${salt}|${[...approvals].sort().join(",")}`);
export interface Ballot { voter: Voter; commitment: string; reveal?: { approvals: string[]; salt: string } }
export interface Result {
  office: Office["id"]; elected: string[]; void: boolean; reason?: string;
  approvals: { candidate: string; milli: number }[];
  counted: number; controllers: number; unrevealed: number; mismatched: number; overApproved: number;
}

/** Runs an election: reveals that match their commitments are counted, each voter at its standing's weight scaled so no controller or fleet exceeds its cap, and an approval beyond the number of seats voids that ballot. */
export function runElection(election: string, office: Office["id"], candidates: readonly string[], ballots: readonly Ballot[], tieSeed: string, rules: TownRules = DEFAULT_TOWN_RULES): Result {
  const seats = OFFICES[office].seats;
  let unrevealed = 0, mismatched = 0, overApproved = 0;
  const live: { v: Voter; approvals: string[] }[] = [];
  const seenVoters = new Set<string>();
  for (const b of ballots) {
    if (seenVoters.has(b.voter.did)) continue; seenVoters.add(b.voter.did);
    if (!b.reveal) { unrevealed++; continue; }
    if (commitBallot(b.reveal.approvals, b.reveal.salt, election) !== b.commitment) { mismatched++; continue; }
    const set = [...new Set(b.reveal.approvals.filter((a) => candidates.includes(a)))];
    if (b.reveal.approvals.length > seats) { overApproved++; continue; }
    live.push({ v: b.voter, approvals: set });
  }
  const w = live.map((x) => voterWeightMilli(x.v, rules));
  const scale = (key: (i: number) => string | null, cap: number) => {
    const sums = new Map<string, number>();
    live.forEach((_, i) => { const k = key(i); if (k !== null) sums.set(k, (sums.get(k) ?? 0) + w[i]!); });
    live.forEach((_, i) => { const k = key(i); if (k === null) return; const s = sums.get(k)!; if (s > cap) w[i] = Math.floor((w[i]! * cap) / s); });
  };
  scale((i) => live[i]!.v.controller, rules.controllerCapMilli); scale((i) => live[i]!.v.fleet, rules.fleetCapMilli);
  const tot = new Map<string, number>(candidates.map((c) => [c, 0]));
  const controllers = new Set<string>(); let counted = 0;
  live.forEach((x, i) => { if (w[i]! <= 0) return; counted++; controllers.add(x.v.controller); for (const a of x.approvals) tot.set(a, tot.get(a)! + w[i]!); });
  const approvals = [...tot].map(([candidate, milli]) => ({ candidate, milli })).sort((a, b) => b.milli - a.milli || (sha(`tie|${tieSeed}|${a.candidate}`) < sha(`tie|${tieSeed}|${b.candidate}`) ? -1 : 1));
  const base = { office, approvals, counted, controllers: controllers.size, unrevealed, mismatched, overApproved };
  if (controllers.size < rules.quorumControllers) return { ...base, elected: [], void: true, reason: `${controllers.size} controllers voted, fewer than the ${rules.quorumControllers} a count needs: the election is void and the seat stays as it was` };
  return { ...base, elected: approvals.slice(0, seats).filter((a) => a.milli > 0).map((a) => a.candidate), void: false };
}

// ---------------------------------------------------------------- recall

export const RECALL = { petitionShare: 0.1, minPetitionControllers: 5, graceDays: 7 } as const;
/** Whether a recall may be put to a vote: a petition of at least 10 % of the controllers that voted at the election (and at least five), not within seven days of the election. */
export function recallMayStart(o: { petitionControllers: number; electionControllers: number; daysSinceElection: number }): { ok: boolean; why: string } {
  if (o.daysSinceElection < RECALL.graceDays) return { ok: false, why: `a recall waits ${RECALL.graceDays} days after an election` };
  const need = Math.max(RECALL.minPetitionControllers, Math.ceil(o.electionControllers * RECALL.petitionShare));
  return o.petitionControllers >= need ? { ok: true, why: "enough controllers petitioned" } : { ok: false, why: `${o.petitionControllers} controllers petitioned, ${need} are needed` };
}
/** A recall removes an officer when the weighted vote to remove exceeds half of the weighted votes cast and the count has its quorum. */
export function recallPasses(removeMilli: number, keepMilli: number, controllers: number, rules: TownRules = DEFAULT_TOWN_RULES): boolean {
  return controllers >= rules.quorumControllers && removeMilli > keepMilli;
}

// ---------------------------------------------------------------- capture, simulated

function rng(seed: string) { let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** How often an attacker's candidate wins one of three steward seats, over `trials` elections of 300 honest single-sponsor voters and 8 honest candidates of different merit, against: one fleet of `clones` clones of one controller, and a farm of `farm` independent-looking controllers (which the caps cannot see), all approving the attacker. */
export function captureRate(o: { clones: number; farm: number; trials: number; honestVoters?: number; tag?: string }): { wins: number; trials: number; farmShareMilli: number } {
  const honest = o.honestVoters ?? 300;
  let wins = 0, farmShare = 0;
  for (let t = 0; t < o.trials; t++) {
    const r = rng(`cap|${o.tag ?? "x"}|${t}|${o.clones}|${o.farm}`);
    const cands = [...Array.from({ length: 8 }, (_, i) => `h${i}`), "attacker"];
    const merit = cands.map((_, i) => (i === 8 ? 0 : 0.2 + 0.07 * i));
    const ballots: Ballot[] = [];
    const add = (id: string, controller: string, fleet: string | null, approvals: string[]) => { const salt = `s${id}`; ballots.push({ voter: { did: id, controller, fleet, qualifyingJobs: 1, relatedJobs: 0 } as Voter, commitment: commitBallot(approvals, salt, "e"), reveal: { approvals, salt } }); };
    for (let i = 0; i < honest; i++) { const ap = cands.slice(0, 8).filter((_, k) => r() < merit[k]!).sort(() => r() - 0.5).slice(0, 3); add(`v${i}`, `vc${i}`, null, ap); }
    for (let i = 0; i < o.clones; i++) add(`clone${i}`, "fleet-controller", "fleet-1", ["attacker"]);
    for (let i = 0; i < o.farm; i++) add(`farm${i}`, `farm-c${i}`, null, ["attacker"]);
    const res = runElection("e", "steward", cands, ballots, `tie${t}`);
    if (res.elected.includes("attacker")) wins++;
    const attacker = res.approvals.find((a) => a.candidate === "attacker")!.milli, total = res.counted * 1000;
    farmShare += total ? attacker / total : 0;
  }
  return { wins, trials: o.trials, farmShareMilli: Math.round((farmShare / o.trials) * 1000) };
}
