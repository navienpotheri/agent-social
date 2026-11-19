/**
 * A referee-run game for the Arena (owner vision, docs/society-vision.md: rule-defined games between agents with a referee, entry fees and prizes in mock credits; row DK684). The game is a toy with real rules: "Twenty-One":
 * each entrant plays the same hands against the same dealer, with one move to choose before the seed is revealed, a policy `stand_at` (draw while the total is below it). The referee commits to its seed first (a hash with a salt), the
 * entrants submit policies, the referee reveals the seed, and the engine plays every hand by fixed rules from that seed alone: no clock, no store, no model, so any replica recomputes the same table and the same transcripts.
 * The score of an entrant is the share of the points available that it won (0 to 1000); the table is ranked with the Arena's seeded tie-break; the `transcript_hash` of a result is the hash of the entrant's whole transcript, so a
 * result can be checked hand by hand by anyone. The Arena's result record must cite an Action of the entrant as its run log, so the entrant signs an Action that carries the transcript hash as an artifact and the result cites that Action. A season with too few distinct sponsors is void, as in the Arena's runner (DK131). The entry fees and prizes are the Arena's own records (S222); this module only plays.
 * It is a game of chance with one choice in it, not a measure of ability to do work: nothing in the society's standing, tiers or certificates reads a score from here. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
export const GAME_NAME = "twenty-one";
export const GAME_HANDS = 200;
export const STAND_MIN = 12;
export const STAND_MAX = 21;

export interface GamePolicy { stand_at: number }
export interface GameEntrant { agent: string; sponsor: string; policy?: GamePolicy }
export interface HandRecord { hand: number; player: number[]; dealer: number[]; outcome: "win" | "push" | "loss" }
export interface GameResult { agent: string; score: number; rank: number; field_size: number; opponents: string[]; /** The hash of the entrant's whole transcript: the entrant reports it in an Action of its own (artifact asp://game/twenty-one/transcript) and the Arena's result cites that Action as its run log. */ transcript_hash: string; points: number; transcript?: HandRecord[] }
export interface GameRun { void: boolean; reason?: string; results: GameResult[] }

/** What the referee publishes before entries close: the hash of its seed and a salt, so the seed cannot be changed after the policies are in. */
export const commitSeed = (seed: string, salt: string): string => sha(`${GAME_NAME}-seed|${salt}|${seed}`);

/** A policy is valid when stand_at is a whole number from 12 to 21; anything else, or none, is no move and scores nothing. */
export const validPolicy = (p: unknown): p is GamePolicy => !!p && typeof p === "object" && Number.isInteger((p as GamePolicy).stand_at) && (p as GamePolicy).stand_at >= STAND_MIN && (p as GamePolicy).stand_at <= STAND_MAX;

/** A deterministic stream of numbers from a seed and a tag. */
function stream(seed: string, tag: string) {
  let counter = 0, buf = Buffer.alloc(0), used = 0;
  return (below: number): number => {
    // 4 bytes at a time, rejection-free reduction is fine for a game of chance with a deck of 52.
    if (used + 4 > buf.length) { buf = createHash("sha256").update(`${seed}|${tag}|${counter++}`).digest(); used = 0; }
    const n = buf.readUInt32BE(used); used += 4;
    return n % below;
  };
}

/** A shuffled deck of 52 as card values 1 to 13 (ace, 2 to 10, jack, queen, king), the same for the same seed and tag. */
function deck(seed: string, tag: string): number[] {
  const d: number[] = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push(r);
  const next = stream(seed, tag);
  for (let i = d.length - 1; i > 0; i--) { const j = next(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** The total of a hand: aces count 11 and fall to 1 while the hand would bust; faces count 10. */
export function total(cards: number[]): number {
  let t = 0, aces = 0;
  for (const c of cards) { if (c === 1) { aces++; t += 11; } else t += Math.min(c, 10); }
  while (t > 21 && aces > 0) { t -= 10; aces--; }
  return t;
}

/** One entrant's whole game: the same hands for everyone, because the decks come from the seed and the hand alone. */
export function playEntrant(seed: string, policy: GamePolicy, hands = GAME_HANDS): { points: number; transcript: HandRecord[] } {
  const transcript: HandRecord[] = [];
  let points = 0;
  for (let h = 0; h < hands; h++) {
    const p = deck(seed, `player|${h}`), q = deck(seed, `dealer|${h}`);
    const player = [p[0], p[1]];
    let pi = 2;
    while (total(player) < policy.stand_at && pi < p.length) player.push(p[pi++]);
    const dealer = [q[0], q[1]];
    let qi = 2;
    // The dealer's cards do not depend on the player's draws: it plays from its own deck and stands on 17.
    while (total(dealer) < 17 && qi < q.length) dealer.push(q[qi++]);
    const pt = total(player), dt = total(dealer);
    const outcome: HandRecord["outcome"] = pt > 21 ? "loss" : dt > 21 || pt > dt ? "win" : pt === dt ? "push" : "loss";
    points += outcome === "win" ? 1 : outcome === "loss" ? -1 : 0;
    transcript.push({ hand: h, player, dealer, outcome });
  }
  return { points, transcript };
}

/** The share of the points available that an entrant won, 0 to 1000. */
export const scoreOf = (points: number, hands: number): number => Math.round((1000 * (points + hands)) / (2 * hands));

/** The hash of an entrant's transcript: the entrant, its policy and every hand, so the result can be checked hand by hand. */
export const transcriptHash = (agent: string, policy: GamePolicy | undefined, hands: HandRecord[]): string => sha(JSON.stringify({ game: GAME_NAME, agent, policy: policy ?? null, hands }));

/**
 * Plays a season of the game. `commit` is what the referee published before entries closed, `seed` and `salt` what it reveals after: a seed that does not hash to its commitment is an error (`seed_changed`). An entrant with no valid
 * policy plays no hands and scores 0. The season is void with no entries or fewer than `minDistinctSponsors + 1` distinct sponsors (the log requires a result to have that many independent opponents). Ranks come from the score with a
 * seeded tie-break that reproduces.
 */
export function runGame(o: { commit: string; seed: string; salt: string; entrants: GameEntrant[]; minDistinctSponsors: number; hands?: number; keepTranscripts?: boolean }): GameRun {
  if (commitSeed(o.seed, o.salt) !== o.commit) throw new Error("seed_changed: the revealed seed is not the one committed before the entries closed");
  const hands = o.hands ?? GAME_HANDS;
  if (o.entrants.length === 0) return { void: true, reason: "no_entries", results: [] };
  if (new Set(o.entrants.map((e) => e.sponsor)).size < o.minDistinctSponsors + 1) return { void: true, reason: "too_few_sponsors", results: [] };
  const played = o.entrants.map((e) => {
    if (!validPolicy(e.policy)) return { e, points: -hands, score: 0, hash: transcriptHash(e.agent, undefined, []), transcript: [] as HandRecord[] };
    const g = playEntrant(o.seed, e.policy, hands);
    return { e, points: g.points, score: scoreOf(g.points, hands), hash: transcriptHash(e.agent, e.policy, g.transcript), transcript: g.transcript };
  });
  const tie = (agent: string) => sha(`${o.seed}|${agent}`);
  played.sort((a, b) => b.score - a.score || (tie(a.e.agent) < tie(b.e.agent) ? -1 : 1));
  return {
    void: false,
    results: played.map((s, i) => ({
      agent: s.e.agent, score: s.score, rank: i + 1, field_size: played.length, points: s.points, transcript_hash: s.hash,
      opponents: o.entrants.filter((x) => x.sponsor !== s.e.sponsor).map((x) => x.agent).sort(),
      ...(o.keepTranscripts ? { transcript: s.transcript } : {}),
    })),
  };
}
