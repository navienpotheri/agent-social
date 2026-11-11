/**
 * Qualifying jobs (credits.md 5.4, CR-12 and CR-13; register row DK69, spec-delta S161).
 *
 * A job settled `accepted` is always settled, but it counts toward standing (the opt-in bond floor, the starter
 * grant's rest) only if it is a QUALIFYING job: the principal and the performer (and the backer who is credited)
 * are independent, the job is not trivial, and no one principal supplies more than its share of the agent's
 * recent eligible jobs. Everything here is deterministic so replicas agree.
 */

/**
 * PROPOSAL (credits.md 5.4 gives price minimums per class; the `class` field on the intent does not exist yet, CR-12):
 * a job with no class is treated as `routine`, so a contract priced below 20 never counts ("trivial": weight 0).
 */
export const QUALIFYING_MIN_PRICE = 20;

/** The cap looks at the agent's last 20 eligible jobs within 90 days (credits.md 5.4). */
export const CAP_WINDOW_JOBS = 20;
export const CAP_WINDOW_MS = 90 * 24 * 3600 * 1000;

/** One eligible (independent, not trivial) job, kept per agent for the counterparty cap. `p` is the principal's sponsor key. */
export interface RecentJob { p: string; at: string }

/** credits.md 5.4: among n jobs, at most max(2, ceil(n / 2)) may come from one principal (or one sponsor of principals). */
export const counterpartyCap = (n: number): number => Math.max(2, Math.ceil(n / 2));

/**
 * Adds an eligible job from `principalKey` at `at` to the agent's recent window and says whether it counts.
 * The window is the agent's previous eligible jobs inside 90 days, trimmed to the last 19, plus this one (n <= 20);
 * the job counts if the jobs from this principal in that window, itself included, are within the cap for n.
 * Jobs that do not count stay in the window: they were eligible, they just did not add to standing.
 */
export function admitEligibleJob(recent: RecentJob[], principalKey: string, at: string): { counts: boolean; window: RecentJob[] } {
  const t = Date.parse(at);
  const kept = recent.filter((j) => Date.parse(j.at) >= t - CAP_WINDOW_MS).slice(-(CAP_WINDOW_JOBS - 1));
  const window = [...kept, { p: principalKey, at }];
  const fromThis = window.filter((j) => j.p === principalKey).length;
  return { counts: fromThis <= counterpartyCap(window.length), window };
}

/** The sponsor-level facts about one party to a job, read from the passport (a person with no passport is their own sponsor). */
export interface PartyFacts { did: string; sponsor: string; fleet: string | null }

/**
 * credits.md 5.4 independence rule, the parts the log can read: (1) same DID, same sponsor, or one sponsors the other;
 * (2) one fleet. Rule 4 (verifier is a party) is already refused when the verification is appended (`verifier_conflicted`).
 * NOT here: rule 3 (one Google account behind two starter claims) is known only to the hosted service, and lineage.
 */
export function independent(principal: PartyFacts, other: PartyFacts): boolean {
  if (principal.did === other.did) return false;
  if (principal.sponsor === other.sponsor) return false;
  if (principal.sponsor === other.did || other.sponsor === principal.did) return false;
  if (principal.fleet && principal.fleet === other.fleet) return false;
  return true;
}
