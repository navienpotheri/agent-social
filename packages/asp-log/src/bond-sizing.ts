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
