/**
 * The bond floor as a pure function of an agent's record (docs/credits-and-learning-experiment.md). The log's `projectBond` today applies only the negative terms (slashes, fleet slashes, strikes)
 * starting from zero; this adds the positive ones (verified improvements, accepted clean jobs) and a base for an agent nobody knows, so the bond an agent must lock falls as evidence builds and
 * rises when it is slashed, struck or regresses. The log calls it only under the opt-in `bondFloor: "v2"` option (S143, with accepted jobs as the only positive term so far); the simulation (evals/bond-floor-sim.mjs) uses the same definition.
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

/** Whether the v2 floor applies to a bond issued at this time: v2 is on, and the cutover (if there is one) has been reached by the record's own time (T26). */
export const floorIsV2 = (mode: "legacy" | "v2" | "v3", from: string | undefined, issuedAt: string): boolean => (mode === "v2" || mode === "v3") && (from === undefined || Date.parse(issuedAt) >= Date.parse(from));

// ---- Floor v3 (register row DK43; spec-delta S506): the same function of recorded inputs, with four more published terms. ----

export type TaskClass = "trivial" | "routine" | "skilled" | "critical";

/** What the log reads for a bond, besides the v2 record: all of it comes from signed records, none from a person's say-so. */
export interface FloorInputsV3 extends FloorRecord {
  /** Valid (in date, not revoked) certificates the backer holds at the time of the bond. */
  certificates: number;
  /** The backer's latest Clinic diagnosis in the last 30 days, if any: `warn` or `quarantine_recommended` (a `watch` is a note and counts for nothing). */
  drift: "none" | "warn" | "quarantine_recommended";
  /** The class the Intent declared (routine when it declared none). */
  taskClass: TaskClass;
  /** The scopes the job's Mandate grants: the threat matrix is read from them, so it applies when the Mandate is issued. */
  scopes: string[];
}

/** The published table: a version, so a change is a new version and a recomputation names the one it used. */
export const FLOOR_TABLE = {
  version: "v3-1",
  /** Permille off the floor for each valid certificate, up to the cap. */
  certificateCredit: 40, certificateCap: 120,
  /** Permille on the floor for a drift diagnosis in the last 30 days. */
  driftWarn: 100, driftQuarantine: 300,
  /** The v2 floor is multiplied by the class (permille), then the threat terms are added. */
  classPermille: { trivial: 600, routine: 1000, skilled: 1300, critical: 1700 } as Record<TaskClass, number>,
  /** Permille added for the most dangerous scope the Mandate grants of each kind (the largest of each kind counts once). */
  threatPermille: { "shell.exec": 50, "shell.network": 100, "repo.push": 50, "pr.merge": 100, "pr.open": 25, network: 75, mcp: 50 } as Record<string, number>,
} as const;

/** The threat permille for a Mandate's scopes: the largest term among the scopes it grants, plus 25 for each further scope that adds a term (so many dangerous scopes cost more than one). */
export function threatPermille(scopes: readonly string[]): number {
  const terms = scopes.map((s) => (FLOOR_TABLE.threatPermille[s] ?? (s.startsWith("mcp.") || s.startsWith("tool.") ? FLOOR_TABLE.threatPermille.mcp : s.startsWith("web.") || s.startsWith("net.") || s.startsWith("browser.") ? FLOOR_TABLE.threatPermille.network : 0))).filter((t) => t > 0).sort((a, b) => b - a);
  return terms.length ? terms[0] + 25 * (terms.length - 1) : 0;
}

/** The hash of the table, so a published floor can be recomputed against the exact numbers it used. */
export async function floorTableHash(): Promise<string> {
  const { createHash } = await import("node:crypto");
  return "sha256:" + createHash("sha256").update(JSON.stringify(FLOOR_TABLE)).digest("hex");
}

/**
 * The v3 floor in permille of the price. With no certificate, no drift, routine class and no threat scope it is exactly the v2 floor (so the learning pilot's numbers are unchanged). Certificates lower the v2
 * floor, a drift diagnosis raises it, the class multiplies it, and the threat matrix adds; the result stays between the minimum and the whole price.
 */
export function bondFloorV3(i: FloorInputsV3, p: FloorParams = DEFAULT_FLOOR): number {
  const v2 = bondFloorPermille(i, p);
  const certCredit = Math.min(FLOOR_TABLE.certificateCap, i.certificates * FLOOR_TABLE.certificateCredit);
  const drift = i.drift === "quarantine_recommended" ? FLOOR_TABLE.driftQuarantine : i.drift === "warn" ? FLOOR_TABLE.driftWarn : 0;
  const adjusted = Math.max(p.min, v2 - certCredit + drift);
  const classed = Math.round((adjusted * FLOOR_TABLE.classPermille[i.taskClass]) / 1000);
  return Math.max(p.min, Math.min(1000, classed + threatPermille(i.scopes)));
}
