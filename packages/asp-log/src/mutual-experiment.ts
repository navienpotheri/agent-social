/**
 * The harness for the fleet mutual-cover experiment (register rows DK185 and BI-14; bank-insurer.md 13.1 and 13.2): the rule, the metrics, the baseline and the kill threshold are fixed BEFORE it starts, and the arms are chosen by
 * a published seed over a hash of the fleet's DID, so no one hand-picks. The harness only reads and computes: it starts nothing (the owner starts the experiment) and changes no premium. Pure. Credits are accounting entries, not money.
 *
 * Rule (13.2): fleets that opt in are randomised to `mutual` or `standard`. Measures: the loss ratio (claims paid divided by premiums collected), claims per 100 jobs and the premium paid per clean job. Baseline: the standard policies
 * at the table rates. KEEP when the mutual's loss ratio is at most the standard's and its premium per clean job is at least 15 percent lower; KILL when the pool ever went below zero or its claims per 100 jobs are 25 percent higher
 * (moral hazard); otherwise CONTINUE; and a verdict waits for at least 30 jobs in each arm (the plan says the beta may not reach significance and uses the replay of past jobs under both rules as the main evidence).
 */
import { createHash } from "node:crypto";

export const MUTUAL_EXPERIMENT = {
  arms: ["mutual", "standard"] as const,
  minJobsPerArm: 30,
  keepPremiumDropPermille: 150,
  killClaimsRisePermille: 250,
} as const;
export type Arm = (typeof MUTUAL_EXPERIMENT.arms)[number];

/** The arm of a fleet: a seeded hash of the fleet's DID, published with the seed so anyone can recompute it. */
export function mutualArmOf(seed: string, fleet: string): Arm {
  return createHash("sha256").update(`${seed}|${fleet}|mutual-experiment`).digest()[0] % 2 === 0 ? "mutual" : "standard";
}

export interface ArmFacts { policies: number; premiums: number; claimsPaid: number; claims: number; jobs: number; cleanJobs: number; poolMin?: number }
export interface ArmMeasures { lossRatio: number | null; claimsPer100Jobs: number | null; premiumPerCleanJob: number | null }
export const measures = (a: ArmFacts): ArmMeasures => ({
  lossRatio: a.premiums > 0 ? a.claimsPaid / a.premiums : null,
  claimsPer100Jobs: a.jobs > 0 ? (100 * a.claims) / a.jobs : null,
  premiumPerCleanJob: a.cleanJobs > 0 ? a.premiums / a.cleanJobs : null,
});

export interface ExperimentVerdict { verdict: "keep" | "kill" | "continue" | "too_little_data"; mutual: ArmMeasures; standard: ArmMeasures; reasons: string[] }

export function judgeMutualExperiment(mutual: ArmFacts, standard: ArmFacts): ExperimentVerdict {
  const m = measures(mutual), s = measures(standard);
  const out = (verdict: ExperimentVerdict["verdict"], reasons: string[]): ExperimentVerdict => ({ verdict, mutual: m, standard: s, reasons });
  if ((mutual.poolMin ?? 0) < 0) return out("kill", ["the pool went below zero (it must be refused first: this is a fault, not a result)"]);
  if (mutual.jobs < MUTUAL_EXPERIMENT.minJobsPerArm || standard.jobs < MUTUAL_EXPERIMENT.minJobsPerArm) return out("too_little_data", [`each arm needs at least ${MUTUAL_EXPERIMENT.minJobsPerArm} jobs (mutual ${mutual.jobs}, standard ${standard.jobs})`]);
  if (m.claimsPer100Jobs !== null && s.claimsPer100Jobs !== null && s.claimsPer100Jobs > 0 && m.claimsPer100Jobs * 1000 > s.claimsPer100Jobs * (1000 + MUTUAL_EXPERIMENT.killClaimsRisePermille)) return out("kill", [`claims per 100 jobs are ${m.claimsPer100Jobs.toFixed(1)} against ${s.claimsPer100Jobs.toFixed(1)}: more than 25 percent higher (moral hazard)`]);
  if (m.claimsPer100Jobs !== null && s.claimsPer100Jobs === 0 && m.claimsPer100Jobs > 0 && mutual.claims >= 3) return out("kill", ["the standard arm had no claims and the mutual arm had three or more"]);
  const reasons: string[] = [];
  const lossOk = m.lossRatio !== null && s.lossRatio !== null ? m.lossRatio <= s.lossRatio : m.lossRatio === 0 || m.lossRatio === null;
  if (!lossOk) reasons.push(`the loss ratio is ${m.lossRatio?.toFixed(2)} against ${s.lossRatio?.toFixed(2)}: not at most the standard's`);
  const dropOk = m.premiumPerCleanJob !== null && s.premiumPerCleanJob !== null && m.premiumPerCleanJob * 1000 <= s.premiumPerCleanJob * (1000 - MUTUAL_EXPERIMENT.keepPremiumDropPermille);
  if (!dropOk) reasons.push("the premium per clean job has not fallen by 15 percent against the standard's");
  return reasons.length ? out("continue", reasons) : out("keep", ["the loss ratio is at most the standard's and the premium per clean job fell by at least 15 percent"]);
}
