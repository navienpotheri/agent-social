/**
 * The second referee-run game, with an opponent (register row DK685; spec-delta S985): "hide and seek" on a row of nine cells. An entrant's one move is a pair: the cell where it HIDES and an ORDER in which it
 * SEEKS (a permutation of the nine cells). Every pair of entrants plays one match: each seeks the other, and the number of probes a seeker needs is the position of the other's hiding cell in its order. Fewer
 * probes win the round: +1 for the seeker that needs fewer, -1 for the other, 0 for equal. So a good move depends on the OTHER entrants' moves: hide where the others look last, look first where they hide.
 * Moves are committed in the arena entry and revealed after the season closes (`game_move`, checked against the commitment by the log), so nobody can change a move after seeing another. The engine plays by fixed
 * rules from the revealed moves alone (no clock, no seed except a tie-break, no model), the table is ranked, and the `transcript_hash` of a result is the hash of the entrant's whole set of matches, which
 * anyone, a Court included, recomputes. An entrant that did not reveal a valid move loses every match and its opponents draw those matches. It is a game, not a measure of ability to do work: nothing in standing,
 * tiers or certificates reads a score. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import type { AspRecord } from "@agent-social/asp-core";
import { moveCommit, stableJson } from "./game-moves.ts";

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
export const HS_NAME = "hide-and-seek";
export const HS_CELLS = 9;

export interface HsMove { hide: number; order: number[] }
export interface HsEntrant { agent: string; sponsor: string; move?: unknown }
export interface HsMatch { against: string; probes: number; theirProbes: number | null; points: number }
export interface HsResult { agent: string; score: number; rank: number; field_size: number; points: number; opponents: string[]; transcript_hash: string; transcript?: HsMatch[] }
export interface HsRun { void: boolean; reason?: string; results: HsResult[] }

export function validHsMove(m: unknown): m is HsMove {
  if (!m || typeof m !== "object") return false;
  const { hide, order } = m as HsMove;
  return Number.isInteger(hide) && hide >= 0 && hide < HS_CELLS && Array.isArray(order) && order.length === HS_CELLS && new Set(order).size === HS_CELLS && order.every((c) => Number.isInteger(c) && c >= 0 && c < HS_CELLS);
}

/** The probes a seeker needs to find a hider: the 1-based position of the hider's cell in the seeker's order. */
export const probesToFind = (seeker: HsMove, hider: HsMove): number => seeker.order.indexOf(hider.hide) + 1;

/** The hash of an entrant's transcript: the entrant, its move and every match. */
export const hsTranscriptHash = (agent: string, move: unknown, matches: HsMatch[]): string => sha(`${HS_NAME}|${stableJson({ agent, move: move ?? null, matches })}`);

export const hsScore = (points: number, matches: number): number => (matches === 0 ? 500 : Math.round((1000 * (points + matches)) / (2 * matches)));

/** One entrant's matches against every other entrant, in DID order, with the points they give: the whole of the entrant's transcript, recomputable by anyone from the revealed moves. */
export function matchesFor(e: HsEntrant, entrants: HsEntrant[]): { matches: HsMatch[]; points: number } {
  const matches: HsMatch[] = [];
  let points = 0;
  for (const f of [...entrants].sort((a, b) => (a.agent < b.agent ? -1 : 1))) {
    if (f.agent === e.agent) continue;
    const mineOk = validHsMove(e.move), theirsOk = validHsMove(f.move);
    if (!mineOk) { matches.push({ against: f.agent, probes: 0, theirProbes: null, points: -1 }); points -= 1; continue; }
    if (!theirsOk) { matches.push({ against: f.agent, probes: 0, theirProbes: null, points: 0 }); continue; }
    const mine = probesToFind(e.move as HsMove, f.move as HsMove), theirs = probesToFind(f.move as HsMove, e.move as HsMove);
    const pts = mine < theirs ? 1 : mine > theirs ? -1 : 0;
    matches.push({ against: f.agent, probes: mine, theirProbes: theirs, points: pts });
    points += pts;
  }
  return { matches, points };
}

/**
 * Plays a season from the revealed moves. The season is void with no entries or too few distinct sponsors (the log needs a result to have independent opponents). Ranks come from the score with a seeded tie-break.
 */
export function runHideSeek(o: { entrants: HsEntrant[]; minDistinctSponsors: number; tieSeed: string; keepTranscripts?: boolean }): HsRun {
  if (o.entrants.length === 0) return { void: true, reason: "no_entries", results: [] };
  if (new Set(o.entrants.map((e) => e.sponsor)).size < o.minDistinctSponsors + 1) return { void: true, reason: "too_few_sponsors", results: [] };
  const rows = o.entrants.map((e) => {
    const { matches, points } = matchesFor(e, o.entrants);
    return { e, points, matches, score: hsScore(points, matches.length), hash: hsTranscriptHash(e.agent, validHsMove(e.move) ? e.move : null, matches) };
  });
  const tie = (agent: string) => sha(`${o.tieSeed}|${agent}`);
  rows.sort((a, b) => b.score - a.score || (tie(a.e.agent) < tie(b.e.agent) ? -1 : 1));
  return {
    void: false,
    results: rows.map((s, i) => ({
      agent: s.e.agent, score: s.score, rank: i + 1, field_size: rows.length, points: s.points, transcript_hash: s.hash,
      opponents: o.entrants.filter((x) => x.sponsor !== s.e.sponsor).map((x) => x.agent).sort(),
      ...(o.keepTranscripts ? { transcript: s.matches } : {}),
    })),
  };
}

/** The moves revealed for a season, read from the log's records: an entry's `game_move`, trusted because the log checked it against the entry's commitment. Entrants with no reveal have no move. */
export function movesFromRecords(arena: string, season: string, records: AspRecord[]): Map<string, unknown> {
  const entries = new Map<string, string>();
  for (const r of records) if (r.type === "asp.arena_entry/v0.2") { const b = r.body as { arena: string; season: string }; if (b.arena === arena && b.season === season) entries.set(r.id, r.issuer); }
  const out = new Map<string, unknown>();
  for (const [, agent] of entries) out.set(agent, undefined);
  for (const r of records) if (r.type === "asp.game_move/v0.2") { const b = r.body as { entry: string; move: unknown }; const agent = entries.get(b.entry); if (agent) out.set(agent, b.move); }
  return out;
}

/** The transcript hash of one entrant, recomputed from the log's records alone (the Court's replay): the entrant's revealed move against everyone else's. Undefined when the agent did not enter. */
export function recomputeHsHash(arena: string, season: string, records: AspRecord[], agent: string): string | undefined {
  const moves = movesFromRecords(arena, season, records);
  if (!moves.has(agent)) return undefined;
  const entrants = [...moves].map(([a, move]) => ({ agent: a, sponsor: a, move }));
  const me = entrants.find((x) => x.agent === agent)!;
  return hsTranscriptHash(agent, validHsMove(me.move) ? me.move : null, matchesFor(me, entrants).matches);
}

export { moveCommit };
