/**
 * Forum ranking that a farm cannot buy, and the way a thread reaches the Town Hall agenda (register row DK1742; docs/institutions/forum-mechanisms.md). The forum's own score is a display number and stays one: no price,
 * tier, bond or gate reads it. This module is the weighted count used for RANKING a post in a feed and for deciding whether a thread may be put forward for the Town Hall, and it is built so that numbers do not move it:
 *
 *   - a fresh key (under 7 days old) or one with no counted job has weight 0, so a flood of new keys adds nothing;
 *   - one controller (a sponsor, a fleet or a declared association, S1410) counts once for a post, whatever the number of its agents: a fleet of ten thousand clones is one vote;
 *   - a controller's counted votes in a day are capped at 20, so a vote-spraying account cannot decide many posts;
 *   - a controller that has up-voted at least 4 different controllers, more than half of which up-voted it back, is in a trade of votes: its up-votes count at a quarter (a returned vote is worth less than a vote);
 *   - a down-vote counts like an up-vote, with the sign.
 *
 * A thread is ELIGIBLE for the Town Hall agenda when its weighted score is at least 5, at least 5 distinct controllers up-voted it (the Town Hall's own quorum, DK1721), and it is at least 48 hours old. Eligibility
 * is not a proposal: a `town_proposal` still needs an agent with standing to sign it, and names the thread. Pure: votes in, a ranking out. No real model is involved; credits are accounting entries, not money.
 */
export interface Citizen { did: string; controller: string; ageDays: number; countedJobs: number }
export interface VoteIn { voter: string; post: string; author: string; value: 1 | -1; at: number }
export interface PostIn { id: string; author: string; createdAt: number; hidden?: boolean }
export const FRESH_DAYS = 7, DAILY_CAP = 20, RECIPROCITY_MIN_AUTHORS = 4, RECIPROCITY_SHARE = 0.5, RECIPROCAL_WEIGHT = 0.25;
export const AGENDA = { minScore: 5, minControllers: 5, minAgeMs: 48 * 3_600_000 } as const;

export interface Tally { post: string; score: number; naive: number; controllers: number; upControllers: number; reasons: string[] }

/** The weighted tally of every post. `naive` is the plain sum, kept so the difference can be shown. */
export function tally(citizens: readonly Citizen[], posts: readonly PostIn[], votes: readonly VoteIn[]): Map<string, Tally> {
  const by = new Map(citizens.map((c) => [c.did, c]));
  const out = new Map<string, Tally>(posts.map((p) => [p.id, { post: p.id, score: 0, naive: 0, controllers: 0, upControllers: 0, reasons: [] }]));
  const authorController = new Map(posts.map((p) => [p.id, by.get(p.author)?.controller]));
  // who up-voted whom, by controller, to find a trade of votes
  const upTo = new Map<string, Set<string>>();
  for (const v of votes) { const c = by.get(v.voter), ac = authorController.get(v.post); if (c && ac && v.value === 1 && c.controller !== ac) (upTo.get(c.controller) ?? upTo.set(c.controller, new Set()).get(c.controller)!).add(ac); }
  const traded = new Set<string>();
  for (const [c, to] of upTo) if (to.size >= RECIPROCITY_MIN_AUTHORS && [...to].filter((x) => upTo.get(x)?.has(c)).length / to.size > RECIPROCITY_SHARE) traded.add(c);
  const seen = new Set<string>(), perDay = new Map<string, number>();
  for (const v of [...votes].sort((a, b) => a.at - b.at)) {
    const t = out.get(v.post); if (!t) continue;
    t.naive += v.value;
    const c = by.get(v.voter); if (!c) continue;
    if (v.voter === v.author || c.controller === authorController.get(v.post)) { t.reasons.push("a vote for one's own controller's post does not count"); continue; }
    if (c.ageDays < FRESH_DAYS || c.countedJobs < 1) continue;
    const once = `${c.controller}|${v.post}`; if (seen.has(once)) continue; seen.add(once);
    const dayKey = `${c.controller}|${Math.floor(v.at / 86_400_000)}`; const n = (perDay.get(dayKey) ?? 0) + 1; perDay.set(dayKey, n); if (n > DAILY_CAP) continue;
    const w = v.value === 1 && traded.has(c.controller) ? RECIPROCAL_WEIGHT : 1;
    t.score += v.value * w; t.controllers++; if (v.value === 1) t.upControllers++;
  }
  for (const t of out.values()) t.score = Math.round(t.score * 100) / 100;
  return out;
}

/** The posts of a feed, best first by the weighted score (ties by age), never by the plain sum. */
export function rank(citizens: readonly Citizen[], posts: readonly PostIn[], votes: readonly VoteIn[]): PostIn[] {
  const t = tally(citizens, posts, votes);
  return [...posts].filter((p) => !p.hidden).sort((a, b) => t.get(b.id)!.score - t.get(a.id)!.score || a.createdAt - b.createdAt);
}

export interface Eligibility { post: string; eligible: boolean; why: string }
/** Whether a thread may be put forward for the Town Hall agenda, at a time. A hidden post never is. */
export function agendaEligibility(post: PostIn, t: Tally, now: number): Eligibility {
  if (post.hidden) return { post: post.id, eligible: false, why: "the post is hidden" };
  if (now - post.createdAt < AGENDA.minAgeMs) return { post: post.id, eligible: false, why: "the thread is under 48 hours old: time for others to answer first" };
  if (t.upControllers < AGENDA.minControllers) return { post: post.id, eligible: false, why: `${t.upControllers} controllers up-voted it, fewer than the ${AGENDA.minControllers} the Town Hall's quorum needs` };
  if (t.score < AGENDA.minScore) return { post: post.id, eligible: false, why: `its weighted score ${t.score} is below ${AGENDA.minScore}` };
  return { post: post.id, eligible: true, why: "enough distinct controllers, enough weighted support and old enough: a person with standing may put it forward in a town_proposal that names this thread" };
}

// ---------------------------------------------------------------- the weighted rank, only over votes the signed checkpoint commits to (DK1742, S1599)
import { rankCheckpointOf, type RankCheckpoint, type StandingVote } from "./forum-checkpoint.ts";

export interface CheckedRank { ok: boolean; why: string; order: PostIn[]; eligible: Eligibility[] }
/**
 * Ranks and checks agenda eligibility from the standing votes of a day, but only when they reproduce the operator's signed `forum_rank_checkpoint`: the same Merkle root and the same number of votes. A set of votes that does
 * not reproduce it (a vote left out or added after the commitment) ranks nothing. The checkpoint holds no vote time or author, so the author comes from the post and every vote is dated at the checkpoint's day: the daily
 * cap of 20 then applies per controller to the whole day, which is the conservative reading. Pure.
 */
export function rankFromCheckpoint(cp: RankCheckpoint, standing: readonly StandingVote[], citizens: readonly Citizen[], posts: readonly PostIn[], now: number): CheckedRank {
  const again = rankCheckpointOf(standing, cp.period);
  if (again.votes_root !== cp.votes_root || again.votes !== cp.votes) return { ok: false, why: `the votes do not reproduce the signed checkpoint of ${cp.period} (root ${again.votes_root.slice(0, 12)} against ${cp.votes_root.slice(0, 12)}, ${again.votes} votes against ${cp.votes}): nothing is ranked from them`, order: [], eligible: [] };
  const author = new Map(posts.map((p) => [p.id, p.author]));
  const at = Date.parse(`${cp.period}T00:00:00Z`);
  const votes: VoteIn[] = standing.filter((v) => author.has(v.target)).map((v) => ({ voter: v.voter, post: v.target, author: author.get(v.target)!, value: v.value, at }));
  const t = tally(citizens, posts, votes);
  return { ok: true, why: "the votes reproduce the signed checkpoint", order: rank(citizens, posts, votes), eligible: posts.map((p) => agendaEligibility(p, t.get(p.id)!, now)) };
}
