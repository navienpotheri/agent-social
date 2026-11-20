/**
 * The free-rein calculator and the delegation ladder with numbers (register row DK836; spec-delta S1204; docs/intake/11th-nov.md, IMG_6478 and 6479). A sponsor widening an agent's Mandate is betting that
 *
 *   time and coverage gained  >  chance of harm x residual damage  +  monitoring  +  tokens
 *
 * This fills that inequality from the record and shows it read-only: the agent's clean jobs, refused calls and incidents give the chance of harm as an interval (wide for a new agent: a Wilson score interval, not
 * a point), the Mandate's cap and bond give the residual damage, the metered tokens give the cost, and the sponsor's own estimate gives the gain. It lists the next widening the record supports and the evidence
 * behind it. It never widens anything: it returns an unsigned proposal, and a Mandate changes only by a new record the sponsor signs. All the numbers are in mock credits (accounting entries, not money).
 */

/** What the record says about the agent: jobs settled clean, calls the gateway refused, incidents (a slash, a strike or a finding), and the held-out mean of its latest measured checkup if any. */
export interface Evidence { cleanJobs: number; refusedCalls: number; incidents: number; heldOutPermille?: number }
/** The Mandate the agent works under now: the most it can spend and put at risk (residual damage is what a bad job can cost beyond what the bond returns). */
export interface MandateTerms { cap: number; residualDamage: number }
/** What the sponsor puts in: the value of time and coverage the agent gives them over the period, the monitoring they do, and the tokens the agent burns. */
export interface Estimates { gain: number; monitoring: number; tokens: number }

/** A refused call is a near miss: it counts as a quarter of an incident for the chance of harm (the gateway stopped it, but the agent tried). */
export const REFUSED_WEIGHT = 0.25;
export const Z95 = 1.96;
/** The ladder of caps a sponsor may step through, and the least evidence before the next step is suggested at all. */
export const LADDER = [20, 50, 100, 300, 1000] as const;
export const MIN_CLEAN_JOBS_FOR_WIDENING = 20;
/** The residual damage of a cap on the ladder: the bond is the cap on damage, so it grows with the cap (a fixed share of it, 40%, the v2 floor's base). */
export const DAMAGE_SHARE_PERMILLE = 400;

const round = (x: number, d = 1) => { const f = 10 ** d; return Math.round(x * f) / f; };

/** The Wilson score interval for `k` events in `n` trials at 95%: [0, 1] when there are no trials. */
export function wilson(k: number, n: number, z = Z95): { lo: number; mid: number; hi: number } {
  if (n <= 0) return { lo: 0, mid: 0.5, hi: 1 };
  const p = Math.min(1, Math.max(0, k / n)), z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), mid: p, hi: Math.min(1, centre + half) };
}

export interface Panel {
  /** Chance of harm for one job, as an interval. */
  harm: { lo: number; mid: number; hi: number };
  jobs: number;
  /** The two sides of the inequality at the current Mandate, in credits: the gain, and the cost at the low, middle and high chance of harm. */
  gain: number;
  cost: { lo: number; mid: number; hi: number };
  /** The gain less the cost: the margin is positive when the delegation pays. `worst` uses the high end of the interval, which is the one a careful sponsor reads. */
  margin: { best: number; mid: number; worst: number };
  breaksEven: boolean;
  /** The next step on the ladder the record supports, if any, with the numbers behind it. Unsigned: a sponsor signs a new Mandate record to take it. */
  next: Widening | null;
  /** Why there is no next step, or what it rests on. */
  reason: string;
  requiresSignatureOf: "sponsor";
  signed: false;
  /** The held-out mean of the latest measured checkup, shown beside the numbers when there is one. */
  heldOutPermille: number | null;
}
export interface Widening { cap: number; residualDamage: number; marginWorst: number; marginMid: number; evidence: string }

export const residualDamageAt = (cap: number): number => round((cap * DAMAGE_SHARE_PERMILLE) / 1000, 2);

/** The panel for an agent: the chance of harm as an interval, the inequality at the current Mandate, and the next widening the record supports. */
export function freeRein(e: Evidence, m: MandateTerms, s: Estimates): Panel {
  const jobs = e.cleanJobs + e.incidents;
  const events = e.incidents + REFUSED_WEIGHT * e.refusedCalls;
  const harm = wilson(events, jobs);
  const costAt = (p: number, damage: number) => p * damage + s.monitoring + s.tokens;
  const cost = { lo: costAt(harm.lo, m.residualDamage), mid: costAt(harm.mid, m.residualDamage), hi: costAt(harm.hi, m.residualDamage) };
  const margin = { best: s.gain - cost.lo, mid: s.gain - cost.mid, worst: s.gain - cost.hi };
  let next: Widening | null = null, reason: string;
  const nextCap = LADDER.find((c) => c > m.cap);
  if (nextCap === undefined) reason = "the Mandate is at the top of the ladder";
  else if (e.cleanJobs < MIN_CLEAN_JOBS_FOR_WIDENING) reason = `${e.cleanJobs} clean jobs: the record needs ${MIN_CLEAN_JOBS_FOR_WIDENING} before it supports a wider Mandate`;
  else if (e.refusedCalls > 0.25 * jobs) reason = `the gateway refused ${e.refusedCalls} calls in ${jobs} jobs: an agent still testing its limits does not support a wider Mandate`;
  else if (e.incidents > 0 && e.cleanJobs < 3 * MIN_CLEAN_JOBS_FOR_WIDENING) reason = `${e.incidents} incident(s) on the record: the record needs ${3 * MIN_CLEAN_JOBS_FOR_WIDENING} clean jobs after an incident before it supports a wider Mandate`;
  else {
    const damage = residualDamageAt(nextCap);
    // The gain is assumed to grow with the cap in proportion (a wider Mandate gives more cover); the sponsor's estimate is for the current cap.
    const gain = s.gain * (nextCap / m.cap);
    const worst = gain - costAt(harm.hi, damage), mid = gain - costAt(harm.mid, damage);
    if (worst > 0) { next = { cap: nextCap, residualDamage: damage, marginWorst: round(worst), marginMid: round(mid), evidence: `${e.cleanJobs} clean jobs, ${e.incidents} incidents, ${e.refusedCalls} refused calls: the chance of harm is at most ${round(harm.hi * 100)}% a job` }; reason = `the next step (cap ${nextCap}) still pays at the high end of the interval`; }
    else reason = `the next step (cap ${nextCap}) would not pay at the high end of the interval (margin ${round(worst)})`;
  }
  return { harm: { lo: round(harm.lo, 4), mid: round(harm.mid, 4), hi: round(harm.hi, 4) }, jobs, gain: s.gain, cost: { lo: round(cost.lo), mid: round(cost.mid), hi: round(cost.hi) }, margin: { best: round(margin.best), mid: round(margin.mid), worst: round(margin.worst) }, breaksEven: margin.worst > 0, next, reason, requiresSignatureOf: "sponsor", signed: false, heldOutPermille: e.heldOutPermille ?? null };
}

/** Agents ordered by how safely their delegation pays: the worst-case margin, highest first. */
export const orderByBreakEven = <T extends { panel: Panel }>(xs: T[]): T[] => [...xs].sort((a, b) => b.panel.margin.worst - a.panel.margin.worst);

/** The read-only panel as text for the dashboard or a terminal. It says what it is and that nothing here changes a Mandate. */
export function renderPanel(name: string, p: Panel): string {
  const pct = (x: number) => `${round(x * 100, 1)}%`;
  return [
    `${name}: ${p.breaksEven ? "the delegation pays" : "the delegation does not yet pay"} at the high end of the chance of harm`,
    `  chance of harm a job: ${pct(p.harm.lo)} to ${pct(p.harm.hi)} (${p.jobs} jobs)`,
    `  gain ${p.gain}; cost ${p.cost.lo} to ${p.cost.hi}; margin ${p.margin.worst} to ${p.margin.best} credits (mock)`,
    p.next ? `  next step: cap ${p.next.cap} (residual damage ${p.next.residualDamage}): ${p.next.evidence}. A sponsor signs a new Mandate to take it; nothing here does.` : `  no wider step suggested: ${p.reason}`,
  ].join("\n");
}
