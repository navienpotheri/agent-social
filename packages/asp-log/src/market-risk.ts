/**
 * The Market's risk model (docs/institutions/market.md 13.1; register rows DK1455 and DK43; spec-delta S1404): what bond and escrow the Market SUGGESTS for a job, from a published, versioned model record. Pure and integer-only
 * (permille), the same arithmetic in the Python SDK (python/src/asp_core/risk.py) and held to conformance/vectors/risk.json. The suggestion is shown on every offer and never binding: the log still enforces only the bond floor of
 * `bond-floor.ts`. It moves how much is suggested to be locked, never a tier, a rank or a standing.
 */
import type { JobClass } from "./market.ts";

export const RISK_MODEL = "asp-risk-model/1";
export type Verification = "deterministic" | "principal" | "arbiter";
export interface RiskTerms {
  /** Permille of the price added to (or taken from) the suggested bond by the job's class. */
  class_permille: Record<JobClass, number>;
  /** By the way the job is verified: tests lower it, free-text acceptance raises it. */
  verification_permille: Record<Verification, number>;
  /** Added at 100 % of the poster's disputes lost, in proportion below it. */
  poster_permille: number;
  /** The share of the price suggested as escrow, in permille. */
  escrow_share_permille: number;
}
export interface RiskInput {
  price: number;
  /** The performer's own floor in permille of the price (bond-floor.ts). */
  floorPermille: number;
  jobClass: JobClass;
  verification: Verification;
  /** The share of the poster's settled jobs that ended in a dispute the poster lost, in permille (0 with no record). */
  posterLostPermille: number;
}
export interface RiskSuggestion { bondPermille: number; bond: number; escrow: number; parts: { floor: number; class: number; verification: number; poster: number } }

/** The zero model: no extra term, the whole price as escrow. Replacing a model with this one is the kill-switch of market.md 13.1: the suggestion is the performer's own floor again. */
export const ZERO_TERMS: RiskTerms = { class_permille: { trivial: 0, routine: 0, skilled: 0, critical: 0 }, verification_permille: { deterministic: 0, principal: 0, arbiter: 0 }, poster_permille: 0, escrow_share_permille: 1000 };

/**
 * The suggestion: bond permille = the performer's floor + the class term + the verification term + the poster term (its share of lost disputes times `poster_permille`, rounded), kept between 0 and 1000; the bond is that share of
 * the price rounded up, and the escrow the model's share of the price rounded up. A suggestion with no model (`terms` null) is the performer's floor and the whole price.
 */
export function suggestRisk(terms: RiskTerms | null, i: RiskInput): RiskSuggestion {
  const t = terms ?? ZERO_TERMS;
  const parts = {
    floor: i.floorPermille,
    class: t.class_permille[i.jobClass],
    verification: t.verification_permille[i.verification],
    poster: Math.round((Math.max(0, Math.min(1000, i.posterLostPermille)) * t.poster_permille) / 1000),
  };
  const bondPermille = Math.max(0, Math.min(1000, parts.floor + parts.class + parts.verification + parts.poster));
  return { bondPermille, bond: Math.ceil((i.price * bondPermille) / 1000), escrow: Math.ceil((i.price * t.escrow_share_permille) / 1000), parts };
}

/** Every term of `next` is no larger than the same term of `prev` and the escrow share no smaller: the change only removes rule, so it may take effect at once (market.md 13: the kill-switch). */
export function onlyRemovesRule(prev: RiskTerms, next: RiskTerms): boolean {
  const cl = (["trivial", "routine", "skilled", "critical"] as JobClass[]).every((c) => next.class_permille[c] <= prev.class_permille[c]);
  const vf = (["deterministic", "principal", "arbiter"] as Verification[]).every((v) => next.verification_permille[v] <= prev.verification_permille[v]);
  return cl && vf && next.poster_permille <= prev.poster_permille && next.escrow_share_permille >= prev.escrow_share_permille;
}
