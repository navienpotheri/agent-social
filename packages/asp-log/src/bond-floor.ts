/**
 * The bond floor as a pure function of an agent's record (docs/credits-and-learning-experiment.md). The log's `projectBond` today applies only the negative terms (slashes, fleet slashes, strikes)
 * starting from zero; this adds the positive ones (verified improvements, accepted clean jobs) and a base for an agent nobody knows, so the bond an agent must lock falls as evidence builds and
 * rises when it is slashed, struck or regresses. It is not called by the log yet: it exists so the simulation (evals/bond-floor-sim.mjs) and, later, the log use one definition.
 */
export interface FloorRecord {
  ownSlashes: number;
  fleetSlashes: number;
  /** Strikes in the last 30 days. */
  recentStrikes: number;
  /** Canary certificates that show a better held-out pass rate than the edge before (each counts once; decayed by the caller). */
  verifiedImprovements: number;
  /** Jobs settled `accepted` with no strike and no dispute (decayed by the caller). */
  acceptedCleanJobs: number;
  /** Lineage edges in the last 30 days whose canary replay was worse than the edge before. */
  regressions: number;
}

export interface FloorParams {
  /** Permille of the price an agent with no record must lock. */
  base: number;
  /** The lowest the floor goes. */
  min: number;
  gain: number; gainCap: number;
  tenure: number; tenureCap: number;
  perSlash: number; perFleetSlash: number;
  perStrike: number; strikeCap: number;
  perRegression: number;
}

/** The proposed numbers: to be tuned by the experiment, not final. The three negative terms are the ones the log applies today. */
export const DEFAULT_FLOOR: FloorParams = {
  base: 400, min: 50, gain: 60, gainCap: 200, tenure: 15, tenureCap: 150,
  perSlash: 250, perFleetSlash: 100, perStrike: 10, strikeCap: 200, perRegression: 150,
};

/** What the log applies today: only the negative terms, from zero. */
export function legacyFloorPermille(r: Pick<FloorRecord, "ownSlashes" | "fleetSlashes" | "recentStrikes">, p: Pick<FloorParams, "perSlash" | "perFleetSlash" | "perStrike" | "strikeCap"> = DEFAULT_FLOOR): number {
  return Math.min(1000, r.ownSlashes * p.perSlash + r.fleetSlashes * p.perFleetSlash + Math.min(p.strikeCap, r.recentStrikes * p.perStrike));
}

/** The floor in permille of the price: the bond must be at least ceil(price * floor / 1000). */
export function bondFloorPermille(r: FloorRecord, p: FloorParams = DEFAULT_FLOOR): number {
  const credit = Math.min(p.gainCap, r.verifiedImprovements * p.gain) + Math.min(p.tenureCap, r.acceptedCleanJobs * p.tenure);
  const penalty = legacyFloorPermille(r, p) + r.regressions * p.perRegression;
  return Math.max(p.min, Math.min(1000, p.base - credit + penalty));
}

/** The smallest bond for a job of this price. */
export const minBond = (price: number, floorPermille: number): number => Math.ceil((price * floorPermille) / 1000);
