/**
 * The risk-priced bond model (register row DK1333): bond = (upper confidence bound on the chance of a drift or breach event for this agent kind and job kind) x (the loss if it happens: job value plus damage) x (1 + margin).
 * The chance is a Beta posterior over measured events and trials (a prior that says "events are rare" and counts as `priorTrials` observations), so thin evidence gives a wide upper bound and a bigger bond, and the more clean
 * runs an agent has, the smaller the bond. A pure function: no log, no money; credits are accounting entries, not money, and any real-money use is gated by counsel (docs/counsel-brief.md).
 */

/** ln Gamma (Lanczos). */
function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015; for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
/** The regularised incomplete beta function I_x(a, b) (continued fraction). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (xx: number, aa: number, bb: number): number => {
    let c = 1, d = 1 - ((aa + bb) * xx) / (aa + 1); if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m; let aaa = (m * (bb - m) * xx) / ((aa + m2 - 1) * (aa + m2));
      d = 1 + aaa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aaa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c;
      aaa = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + m2 + 1));
      d = 1 + aaa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aaa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (bt * cf(x, a, b)) / a : 1 - (bt * cf(1 - x, b, a)) / b;
}
/** The q-quantile of Beta(a, b) by bisection. */
export function betaQuantile(q: number, a: number, b: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (betaCdf(mid, a, b) < q) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export interface BondInput {
  /** Runs observed for this agent kind and job kind, and how many ended in a drift or breach event. */
  trials: number; events: number;
  /** What a job is worth, and the damage if it goes wrong (credits). */
  jobValue: number; damage: number;
}
export interface BondModel { confidence: number; margin: number; priorEvents: number; priorTrials: number; floor: number }
export const DEFAULT_BOND_MODEL: BondModel = { confidence: 0.95, margin: 0.25, priorEvents: 1, priorTrials: 20, floor: 1 };

export type EvidenceTier = "thin" | "some" | "strong";
export const evidenceTier = (trials: number): EvidenceTier => (trials < 30 ? "thin" : trials < 300 ? "some" : "strong");

export interface BondSuggestion { upperBound: number; mean: number; loss: number; bond: number; tier: EvidenceTier; why: string }

/** The bond for one agent kind and job kind. Rounded up to a whole credit and never below the floor. */
export function sizeBond(i: BondInput, m: BondModel = DEFAULT_BOND_MODEL): BondSuggestion {
  if (!(i.trials >= 0) || !(i.events >= 0) || i.events > i.trials) throw new Error("events cannot exceed trials");
  const a = m.priorEvents + i.events, b = m.priorTrials - m.priorEvents + (i.trials - i.events);
  const upper = betaQuantile(m.confidence, a, b);
  const loss = i.jobValue + i.damage;
  const bond = Math.max(m.floor, Math.ceil(upper * loss * (1 + m.margin)));
  const tier = evidenceTier(i.trials);
  return { upperBound: upper, mean: a / (a + b), loss, bond, tier, why: `${(m.confidence * 100).toFixed(0)}% upper bound ${(upper * 100).toFixed(2)}% of an event from ${i.events} in ${i.trials} runs (${tier} evidence) x a loss of ${loss} x (1 + ${m.margin})` };
}

/**
 * The measured chance that an ATTEMPT gets through the gateway (register row DK1333): the ASP Containment Benchmark's second blind set (evals/benchmark/blind2-cases.json, 300 cases written by a separate author who never saw the
 * gateway's code), run on 2026-11-22 with `node evals/benchmark/blind.mjs --file blind2-cases.json`: of 165 calls that should be blocked, the gateway blocked 153 and let 12 through. These are held-out CASES, not live agent runs: they
 * measure the gateway against written attacks, not how often real agents try. The number is replaced by live data when there is some (DK1457) and by the alignment study's (DK1332).
 */
export const MEASURED_THROUGH = { attempts: 165, through: 12, source: "evals/benchmark blind2 (held-out), gateway, 2026-11-22", live: false } as const;

export interface SplitInput {
  /** Runs observed for this agent kind and job kind; and the runs in which the agent attempted something the gateway had to refuse or that got through (a strike, a block or a slash). */
  trials: number; attemptRuns: number;
  /** Attempts measured against the gateway and how many got through (the pooled rate; default the benchmark's). */
  attempts?: number; through?: number;
  jobValue: number; damage: number;
}
export interface SplitSuggestion extends BondSuggestion { attemptUpper: number; throughUpper: number; attemptMean: number; throughMean: number }

/**
 * The split model of docs/research/breach-probability-model.md: P(event) = P(attempt) x P(an attempt gets through). Each is a Beta posterior (the attempt rate from this agent's own record with the cautious prior of one in
 * twenty, the through rate from the measured attempts with a flat prior) and each is bounded at the square root of the confidence, so that the product of the two bounds covers the true chance of an event with the stated
 * confidence (both hold at once with probability confidence, if the two are independent). A better gateway lowers the bond even for an agent we know little about; a cleaner agent lowers it even against a leaky gateway.
 */
export function sizeBondSplit(i: SplitInput, m: BondModel = DEFAULT_BOND_MODEL): SplitSuggestion {
  const attempts = i.attempts ?? MEASURED_THROUGH.attempts, through = i.through ?? MEASURED_THROUGH.through;
  if (!(i.trials >= 0) || !(i.attemptRuns >= 0) || i.attemptRuns > i.trials) throw new Error("attempt runs cannot exceed runs");
  if (!(attempts >= 0) || !(through >= 0) || through > attempts) throw new Error("attempts that got through cannot exceed attempts");
  const q = Math.sqrt(m.confidence);
  const aA = m.priorEvents + i.attemptRuns, bA = m.priorTrials - m.priorEvents + (i.trials - i.attemptRuns);
  const aT = 1 + through, bT = 1 + (attempts - through);
  const attemptUpper = betaQuantile(q, aA, bA), throughUpper = betaQuantile(q, aT, bT);
  const upper = attemptUpper * throughUpper;
  const loss = i.jobValue + i.damage;
  const bond = Math.max(m.floor, Math.ceil(upper * loss * (1 + m.margin)));
  const tier = evidenceTier(i.trials);
  const attemptMean = aA / (aA + bA), throughMean = aT / (aT + bT);
  return { upperBound: upper, mean: attemptMean * throughMean, loss, bond, tier, attemptUpper, throughUpper, attemptMean, throughMean, why: `${(m.confidence * 100).toFixed(0)}% bound ${(upper * 100).toFixed(2)}% = an attempt in at most ${(attemptUpper * 100).toFixed(1)}% of runs (${i.attemptRuns} in ${i.trials}, ${tier} evidence) x an attempt getting through at most ${(throughUpper * 100).toFixed(1)}% (${through} of ${attempts} measured) x a loss of ${loss} x (1 + ${m.margin})` };
}

/**
 * What the model says cover should cost (advisory; the log still charges the table's premium): the expected loss, which is the posterior MEAN chance of an event (not the bound) x the insured amount x the share the Insurer pays
 * x (1 + the margin), rounded up to a whole credit, at least 1. Shown beside the table's premium in `asp insure quote` so the owner can see where the table is above or below the model before any rule is changed.
 */
export function modelPremium(s: Pick<SplitSuggestion, "mean">, insured: number, coverSharePermille: number, m: BondModel = DEFAULT_BOND_MODEL): number {
  return Math.max(1, Math.ceil(s.mean * insured * (coverSharePermille / 1000) * (1 + m.margin)));
}

/** One observed run of an agent kind: when it happened (ms) and whether it ended in a drift or breach event. */
export interface DatedRun { at: number; event: boolean }
export const DEFAULT_HALF_LIFE_DAYS = 90;
/**
 * The time-varying hazard (register row DK1333): a run counts for less the older it is, by half every `halfLifeDays` (default 90), so an agent that was reckless a year ago and clean since pays less than one that slipped
 * last week, and old clean runs fade towards the prior (the evidence thins, so the bond does not shrink for ever on a record that is out of date). Counts become fractional; the Beta posterior of `sizeBond` takes them as they are.
 * Pure. The result carries the effective trials and events so a reader can see what the bond rests on.
 */
export function sizeBondDecayed(runs: readonly DatedRun[], now: number, o: { jobValue: number; damage: number; halfLifeDays?: number }, m: BondModel = DEFAULT_BOND_MODEL): BondSuggestion & { effectiveTrials: number; effectiveEvents: number } {
  const half = (o.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS) * 86_400_000;
  if (!(half > 0)) throw new Error("the half-life is positive");
  let trials = 0, events = 0;
  for (const r of runs) {
    const w = Math.pow(0.5, Math.max(0, now - r.at) / half);
    trials += w; if (r.event) events += w;
  }
  const s = sizeBond({ trials, events, jobValue: o.jobValue, damage: o.damage }, m);
  return { ...s, effectiveTrials: trials, effectiveEvents: events, why: `${s.why}; runs weighted by age with a half-life of ${o.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS} days` };
}
