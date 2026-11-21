/**
 * The ladder of the Arena (register row DK1741; docs/institutions/games-and-arena.md): a rating from pairwise results, seasons, and the counting rules that make a rating hard to farm. A match counts only between agents of
 * different controllers (one sponsor, one fleet or one declared association is one controller, S1410), at most three counted matches between the same two controllers in a season, and only once each side has a counted
 * job (a fresh identity with none has no ladder place yet). A rating is a number of the Arena and nothing else: no tier gate, bond floor or Market rule reads it (the Academy's promotion reads a Registrar-signed arena
 * RESULT, which is another record). The first rule is the strongest: only a pairing the referee drew counts, so a ring cannot choose its opponents. Pure: results in, ratings out. No real model is involved in the simulations; credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";

export const START = 1000;
export const PAIR_CAP = 3;
/** The rating step: large while a rating is new, small once it is settled. */
export const kFactor = (games: number): number => (games < 10 ? 40 : games < 30 ? 24 : 16);
/** The expected score of a against b. */
export const expected = (a: number, b: number): number => 1 / (1 + 10 ** ((b - a) / 400));
/** A soft reset at the turn of a season: halfway back to the start, so a season's lead is not permanent and a newcomer can catch up. */
export const seasonReset = (r: number): number => Math.round(START + (r - START) / 2);

export interface Player { id: string; controller: string; /** Counted jobs of standing (a fresh identity with none has no place on the ladder). */ countedJobs: number }
export interface Match { a: string; b: string; /** 1 a wins, 0 b wins, 0.5 a draw. */ score: 1 | 0 | 0.5; at: number; /** Whether the referee scheduled the pairing by the published draw (a seeded draw from the log head, which no agent can choose); an agreed match is not scheduled. Absent means scheduled. */ scheduled?: boolean }
export interface Counted { match: Match; counted: boolean; why: string }
export interface Rating { id: string; rating: number; games: number }
export interface Flag { id: string; kind: "narrow_schedule" | "one_way_flow"; detail: string }
export interface Table { ratings: Rating[]; counted: Counted[]; flags: Flag[] }

/** Rates a season's matches in order. Each match is counted or not, with the reason, and a rating moves only on a counted match. */
export function rate(players: readonly Player[], matches: readonly Match[], o: { start?: Record<string, number> } = {}): Table {
  const by = new Map(players.map((p) => [p.id, p]));
  const r = new Map(players.map((p) => [p.id, o.start?.[p.id] ?? START]));
  const g = new Map(players.map((p) => [p.id, 0]));
  const pair = new Map<string, number>();
  const counted: Counted[] = [];
  for (const m of [...matches].sort((x, y) => x.at - y.at)) {
    const A = by.get(m.a), B = by.get(m.b);
    let why = "";
    if (!A || !B) why = "an unknown player";
    else if (m.scheduled === false) why = "the pairing was agreed, not drawn by the referee from the published seed: only a drawn match counts";
    else if (A.id === B.id) why = "an agent does not play itself";
    else if (A.controller === B.controller) why = "both agents answer to one controller: a match inside one controller is not counted";
    else if (A.countedJobs < 1 || B.countedJobs < 1) why = "a side has no counted job yet, so it has no place on the ladder";
    else {
      const key = [A.controller, B.controller].sort().join("|");
      const n = (pair.get(key) ?? 0) + 1;
      if (n > PAIR_CAP) why = `the same two controllers have met ${PAIR_CAP} times this season: a further match is not counted`;
      else pair.set(key, n);
    }
    if (why) { counted.push({ match: m, counted: false, why }); continue; }
    const ra = r.get(m.a)!, rb = r.get(m.b)!;
    const ea = expected(ra, rb);
    r.set(m.a, ra + kFactor(g.get(m.a)!) * (m.score - ea));
    r.set(m.b, rb + kFactor(g.get(m.b)!) * ((1 - m.score) - (1 - ea)));
    g.set(m.a, g.get(m.a)! + 1); g.set(m.b, g.get(m.b)! + 1);
    counted.push({ match: m, counted: true, why: "counted" });
  }
  return { ratings: players.map((p) => ({ id: p.id, rating: Math.round(r.get(p.id)!), games: g.get(p.id)! })), counted, flags: flagsOf(by, counted) };
}

/** Patterns a person should look at (never an automatic penalty): an agent with at least 12 counted matches, more than 70 % of them against at most two controllers; and a pair whose results run one way with at least 6 counted matches while the rest of the loser's matches do not. */
export function flagsOf(by: ReadonlyMap<string, Player>, counted: readonly Counted[]): Flag[] {
  const out: Flag[] = [];
  const mine = new Map<string, { opp: string; won: boolean }[]>();
  for (const c of counted) if (c.counted) {
    const A = by.get(c.match.a)!, B = by.get(c.match.b)!;
    (mine.get(A.id) ?? mine.set(A.id, []).get(A.id)!).push({ opp: B.controller, won: c.match.score === 1 });
    (mine.get(B.id) ?? mine.set(B.id, []).get(B.id)!).push({ opp: A.controller, won: c.match.score === 0 });
  }
  for (const [id, ms] of mine) {
    if (ms.length < 12) continue;
    const tally = new Map<string, number>(); for (const m of ms) tally.set(m.opp, (tally.get(m.opp) ?? 0) + 1);
    const top2 = [...tally.values()].sort((a, b) => b - a).slice(0, 2).reduce((x, y) => x + y, 0);
    if (top2 / ms.length > 0.7) out.push({ id, kind: "narrow_schedule", detail: `${top2} of ${ms.length} counted matches are against two controllers` });
  }
  return out;
}

// ---------------------------------------------------------------- simulations (a latent skill; no real model)

function rng(seed: string) { let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Spearman rank correlation of two lists. */
export function spearman(x: number[], y: number[]): number {
  const rank = (v: number[]) => { const idx = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!); const r = new Array<number>(v.length); idx.forEach((i, k) => { r[i] = k; }); return r; };
  const a = rank(x), b = rank(y), n = x.length, m = (n - 1) / 2;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i]! - m) * (b[i]! - m); da += (a[i]! - m) ** 2; db += (b[i]! - m) ** 2; }
  return Math.round((num / Math.sqrt(da * db)) * 1000) / 1000;
}
/** A field of `n` players, one sponsor each, with skills spread evenly; `perPlayer` matches each against random opponents of other sponsors; a chance share makes the result less informative (a game of luck). */
export function simulateField(seed: string, n: number, perPlayer: number, luck: number): { corr: number; table: Table; skill: number[] } {
  const r = rng(`field|${seed}`);
  const players: Player[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, controller: `c${i}`, countedJobs: 3 }));
  const skill = players.map((_, i) => (i / (n - 1)) * 800 - 400);
  const matches: Match[] = [];
  const total = Math.floor((n * perPlayer) / 2);
  const cap = new Map<string, number>();
  for (let t = 0, tries = 0; t < total && tries < total * 20; tries++) {
    const a = Math.floor(r() * n); let b = Math.floor(r() * n); if (a === b) continue;
    const key = [a, b].sort().join("|"); if ((cap.get(key) ?? 0) >= PAIR_CAP) continue; cap.set(key, (cap.get(key) ?? 0) + 1);
    const pa = luck + (1 - luck) * expected(skill[a]!, skill[b]!);
    matches.push({ a: `p${a}`, b: `p${b}`, score: r() < pa ? 1 : 0, at: t }); t++;
  }
  const table = rate(players, matches);
  return { corr: spearman(table.ratings.map((x) => x.rating), skill), table, skill };
}
/** A ring of `size` weak players (each its own controller) that trade wins: every pair plays `rounds` matches and the designated winner takes them. Returns the best ring member's rating with the counting rules on and with them off, and the best honest rating. */
export function simulateRing(seed: string, size: number, rounds: number, honest = 30): { withRules: number; withoutRules: number; honestTop: number; counted: number; submitted: number } {
  const r = rng(`ring|${seed}`);
  const players: Player[] = [
    ...Array.from({ length: size }, (_, i) => ({ id: `ring${i}`, controller: `rc${i}`, countedJobs: 3 })),
    ...Array.from({ length: honest }, (_, i) => ({ id: `h${i}`, controller: `hc${i}`, countedJobs: 3 })),
  ];
  const ms: Match[] = []; let t = 0;
  for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) for (let k = 0; k < rounds; k++) ms.push({ a: `ring${i}`, b: `ring${j}`, score: i % 2 === 0 ? 1 : 0, at: t++, scheduled: false });
  // every player, ring or not, also gets drawn matches against random opponents of an equal true strength
  for (let k = 0; k < (size + honest) * 3; k++) { const ids = players.map((p) => p.id); const a = ids[Math.floor(r() * ids.length)]!, b = ids[Math.floor(r() * ids.length)]!; if (a !== b) ms.push({ a, b, score: r() < 0.5 ? 1 : 0, at: t++ }); }
  const on = rate(players, ms);
  // the same matches with no pair cap and no controller check, as a ladder without the rules would count them
  const offNoCap = (() => { const rr = new Map(players.map((p) => [p.id, START])); const gg = new Map(players.map((p) => [p.id, 0])); for (const m of ms) { const ea = expected(rr.get(m.a)!, rr.get(m.b)!); rr.set(m.a, rr.get(m.a)! + kFactor(gg.get(m.a)!) * (m.score - ea)); rr.set(m.b, rr.get(m.b)! + kFactor(gg.get(m.b)!) * ((1 - m.score) - (1 - ea))); gg.set(m.a, gg.get(m.a)! + 1); gg.set(m.b, gg.get(m.b)! + 1); } return rr; })();
  const ringIds = players.slice(0, size).map((p) => p.id);
  const top = (get: (id: string) => number) => Math.round(Math.max(...ringIds.map(get)));
  const byId = new Map(on.ratings.map((x) => [x.id, x.rating]));
  const honestTop = Math.max(...on.ratings.filter((x) => x.id.startsWith("h")).map((x) => x.rating));
  return { withRules: top((id) => byId.get(id)!), withoutRules: top((id) => offNoCap.get(id)!), honestTop, counted: on.counted.filter((c) => c.counted).length, submitted: ms.length };
}
