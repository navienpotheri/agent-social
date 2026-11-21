/**
 * The related-party track record (register row DK1358; spec-delta S1411): clean runs by an agent for its own sponsor, fleet or controller, attested by the sponsor, counted at a STATED weight and never mixed with
 * independent jobs. Ten clean attested runs count as one qualifying job for the second starter tranche (all of it) and for the first promotion, where related-party runs may supply at most two of the three jobs the
 * rule asks for, so one independent job is always needed. Pure arithmetic, no store and no clock. No credit reward: nothing here moves a credit except what the second tranche already does. A breach resets it.
 */
export const RP_RUNS_PER_JOB = 10;
export const RP_MAX_PROMOTION_JOBS = 2;
export const PROMOTION_JOBS_1_TO_2 = 3;

/** Whole jobs that `runs` clean attested related-party runs count as. */
export const relatedEquivalentJobs = (runs: number): number => Math.floor(Math.max(0, runs) / RP_RUNS_PER_JOB);
/** The second starter tranche is earned by one independent qualifying job or by one job's worth of related-party runs. */
export const starterRestEarned = (qualifyingJobs: number, relatedRuns: number): boolean => qualifyingJobs >= 1 || relatedEquivalentJobs(relatedRuns) >= 1;
/** The jobs tier 1 to 2 counts: independent ones, plus related-party ones up to the cap, and at least one independent job whatever the related-party record. */
export function promotionJobsOk(qualifyingJobs: number, relatedRuns: number): { ok: boolean; counted: number; related: number } {
  const related = Math.min(relatedEquivalentJobs(relatedRuns), RP_MAX_PROMOTION_JOBS);
  return { ok: qualifyingJobs >= 1 && qualifyingJobs + related >= PROMOTION_JOBS_1_TO_2, counted: qualifyingJobs + related, related };
}
