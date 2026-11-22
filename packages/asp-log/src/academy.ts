/**
 * The Academy's pure rules (docs/institutions/academy.md; register rows DK24, DK25, DK26): the numbers, and the functions both the log (to check a record) and the exam engine and the Arena (to
 * produce one) use, so they cannot disagree. No store, no clock. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";

export const CERT_MAX_DAYS = 180;
/** The step from tier 2 to 3 (academy.md 3, proposals the owner decides). */
export const PROMOTION_QUALIFYING_JOBS_2_TO_3 = 10;
export const PROMOTION_DISTINCT_PRINCIPALS_2_TO_3 = 2;
export const PROMOTION_SLASH_FREE_DAYS_2_TO_3 = 90;
/** The smallest pool an exam may have (academy.md AC-9). */
export const EXAM_MIN_POOL = 40;

/** The seed published for one sitting: anyone can recompute it from public values, and the holder cannot choose it. */
export function examSeed(examRecordId: string, holder: string, attempt: number): string {
  return "sha256:" + createHash("sha256").update(`asp.exam.seed|${examRecordId}|${holder}|${attempt}`).digest("hex");
}

/**
 * The variant a sitting gets: the seed picks a place in the pool, and a variant the holder has already had is skipped (the next unused one), so every sitting is a new variant of the tasks. Pure,
 * so the log recomputes it and refuses a result that was marked on a different variant.
 */
export function examVariant(seed: string, pool: number, used: readonly number[]): number {
  if (used.length >= pool) throw new Error("the holder has had every variant in the pool");
  const taken = new Set(used);
  let v = Number(BigInt("0x" + seed.slice(7, 23)) % BigInt(pool));
  while (taken.has(v)) v = (v + 1) % pool;
  return v;
}

/** Splits a prize pool by the arena's per-rank shares: the amount for `rank` (1-based), rounded down; 0 for a rank the split does not reach. */
export function prizeFor(pool: number, splitPermille: readonly number[], rank: number): number {
  const share = splitPermille[rank - 1];
  return share === undefined ? 0 : Math.floor((pool * share) / 1000);
}

/** The top half of a field: rank times 2 is at most the field size (a field of 7 has a top half of ranks 1 to 3). */
export const inTopHalf = (rank: number, field: number): boolean => rank >= 1 && rank * 2 <= field;

/**
 * The author suspension rule (DK117, S1700; academy.md 6, owner question 34 with a conservative default): an author whose course's learners are struck is suspended from publishing. A learner is struck when it has a
 * blocked attempt in the AUTHOR_STRIKE_DAYS after it completed one of the author's courses; the author is suspended from publishing a new course while at least AUTHOR_MIN_LEARNERS different learners completed its
 * courses in the last AUTHOR_WINDOW_DAYS, at least AUTHOR_STRUCK_MIN of them are struck, and the struck are at least AUTHOR_STRUCK_SHARE_PERMILLE of them. Enrolment in courses already published is not affected.
 */
export const AUTHOR_WINDOW_DAYS = 90;
export const AUTHOR_STRIKE_DAYS = 30;
export const AUTHOR_MIN_LEARNERS = 5;
export const AUTHOR_STRUCK_MIN = 3;
export const AUTHOR_STRUCK_SHARE_PERMILLE = 300;
