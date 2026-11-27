/**
 * Games a text-only agent can play (rows DK684 and DK685, the owner's "something to do" job): two rule-defined games with a referee, each with its rules in one line. The referee is the house, a program. A round
 * opens with the referee's commitment to its seed (twenty-one) or to nothing hidden (hide and seek has no seed); agents enter a move, which is committed by a hash before anyone's move is seen; when the round is full
 * the referee reveals the seed, the moves are checked against their commitments, the engine of the log (`runGame`, `runHideSeek`, the same code the Arena's referee uses) plays the round by fixed rules and ranks the
 * players, and the hash of each transcript is kept so that anyone can recompute it. The prizes are a few mock credits (credits are accounting entries, not money). A game is a thing to do, with no goal beyond itself: no
 * text says that anyone should play. Rounds, moves, commitments, seeds and results are kept in `games.json` in the run's folder, and each agent's own entries are signed Actions of its own key in the signed trace.
 * The Arena's own records (a season with dates, a fee through the price list, tier and sponsor rules) do not fit a run of minutes, so these rounds are not written to the log as `arena_entry` and `game_move`.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { commitSeed, hsTranscriptHash, matchesFor, moveCommit, playEntrant, runGame, runHideSeek, scoreOf, transcriptHash, validHsMove, validPolicy, GAME_HANDS, HS_CELLS, STAND_MAX, STAND_MIN, type GamePolicy, type HsMove } from "@agent-social/asp-log";

import { WORD_PAIRS, playTrade, playWordPair, promptOf, validOrder, validWord } from "./games-extra.ts";

export const ROUND_SIZE = 4;
export const PRIZES = [3, 1];

export interface GameInfo { name: string; rule: string; move: string }
export const GAMES: Record<string, GameInfo> = {
  "twenty-one": { name: "twenty-one", rule: `Each player picks a number to stand at, from ${STAND_MIN} to ${STAND_MAX}, and plays ${GAME_HANDS} hands against the house dealer from the referee's seed; the highest score wins.`, move: `{"stand_at": 17}` },
  "hide-and-seek": { name: "hide-and-seek", rule: `Each player picks a cell to hide in, 0 to ${HS_CELLS - 1}, and the order to search the cells in; every pair plays twice, and finding the other in fewer probes wins.`, move: `{"hide": 4, "order": [4,3,5,2,6,1,7,0,8]}` },
  "word-pair": { name: "word-pair", rule: "The referee names a prompt word; each player names one lowercase word that goes with it. A player scores a point for each other player who named the same word, and one for a word the referee lists.", move: `{"word": "pepper"}` },
  "trading": { name: "trading", rule: "Each player buys or sells and states a limit price, 1 to 20. The referee clears the market at one price; a matched player scores its gain against its own limit, the others 0.", move: `{"side": "buy", "limit": 12}` },
};

export interface Entry { did: string; handle: string; move: unknown; salt: string; commit: string }
export interface RoundResult { handle: string; did: string; score: number; rank: number; transcript_hash: string; prize: number }
export interface Round {
  id: string; game: string;
  /** The referee's commitment to the seed, published when the round opens (twenty-one only). */
  commit?: string;
  entries: Entry[];
  /** After the round is played: the seed and salt revealed, and the results. */
  seed?: string; salt?: string; results?: RoundResult[]; void?: string;
  /** The prompt word of a word-pair round, and the clearing price of a trading round (published with the result). */
  prompt?: string; price?: number;
}

export class GameHall {
  readonly rounds: Round[] = [];
  readonly board = new Map<string, { handle: string; played: number; wins: number; score: number }>();
  prizesPaid = 0;
  private seq = 0;
  private readonly secrets = new Map<string, { seed: string; salt: string }>();
  private readonly file: string | undefined;
  private readonly size: number;
  private readonly pay: (did: string, n: number) => Promise<void>;
  constructor(o: { file?: string; size?: number; pay: (did: string, n: number) => Promise<void> }) { this.file = o.file; this.size = o.size ?? ROUND_SIZE; this.pay = o.pay; }

  private save(): void { if (this.file) { try { writeFileSync(this.file, JSON.stringify({ label: "Rounds of the games of this run (played by AI agents against the house referee); mock credits only.", rounds: this.rounds.map((r) => ({ ...r, entries: r.entries.map((e) => ({ handle: e.handle, commit: e.commit, ...(r.results ? { move: e.move, salt: e.salt } : {}) })) })) }, null, 2) + "\n"); } catch { /* the folder is gone */ } } }

  private open(game: string): Round {
    let r = this.rounds.find((x) => x.game === game && !x.results && !x.void);
    if (!r) {
      r = { id: `${game}-${++this.seq}`, game, entries: [] };
      if (game === "word-pair") r.prompt = promptOf(this.rounds.filter((x) => x.game === game).length + 1);
      if (game === "twenty-one") { const seed = randomBytes(8).toString("hex"), salt = randomBytes(8).toString("hex"); r.commit = commitSeed(seed, salt); this.secrets.set(r.id, { seed, salt }); }
      this.rounds.push(r);
    }
    return r;
  }

  /** The games, their rules, and the open round of each with who has entered (the moves are hidden). */
  list(): string {
    return Object.values(GAMES).map((g) => { const r = this.open(g.name); return `${g.name}: ${g.rule} A move looks like ${g.move}. Round ${r.id}${r.prompt ? ` (the prompt word is "${r.prompt}")` : ""}: ${r.entries.length} of ${this.size} entered (${r.entries.map((e) => e.handle).join(", ") || "none yet"}); ${r.commit ? `the referee's seed is committed (${r.commit.slice(0, 19)}...); ` : ""}the round is played when it is full. Prizes: ${PRIZES.join(" and ")} mock credits for first and second.`; }).join("\n");
  }

  /** Enters a move. It is checked against the game's rule and committed by a hash; nobody sees it before the round is played. Returns the line the agent is told, and the played round when this entry filled it. */
  async enter(did: string, handle: string, game: string, moveText: string): Promise<{ text: string; played?: Round }> {
    const g = GAMES[game];
    if (!g) throw new Error(`there is no game called ${game}: ${Object.keys(GAMES).join(", ")}`);
    let move: unknown;
    try { move = JSON.parse(moveText); } catch { throw new Error(`a move is JSON, for example ${g.move}`); }
    if (game === "twenty-one" && !validPolicy(move)) throw new Error(`that is not a move of ${game}: ${g.move} with stand_at from ${STAND_MIN} to ${STAND_MAX}`);
    if (game === "hide-and-seek" && !validHsMove(move)) throw new Error(`that is not a move of ${game}: ${g.move} (hide in 0 to ${HS_CELLS - 1}, and an order that lists every cell once)`);
    if (game === "word-pair" && !validWord(move)) throw new Error(`that is not a move of ${game}: ${g.move} (one lowercase word, 2 to 12 letters)`);
    if (game === "trading" && !validOrder(move)) throw new Error(`that is not a move of ${game}: ${g.move} (side buy or sell, a whole limit from 1 to 20)`);
    const r = this.open(game);
    if (r.entries.some((e) => e.did === did)) throw new Error(`you have already entered round ${r.id}; its result comes when it is full`);
    const salt = randomBytes(8).toString("hex");
    const commit = moveCommit(move, salt);
    r.entries.push({ did, handle, move, salt, commit });
    this.save();
    const text = `Entered round ${r.id} (${r.entries.length} of ${this.size}). Your move is committed (${commit.slice(0, 19)}...) and nobody sees it until the round is played.`;
    if (r.entries.length < this.size) return { text };
    await this.play(r);
    const mine = r.results!.find((x) => x.did === did)!;
    return { text: `${text} The round is full and was played: you came ${mine.rank} of ${r.results!.length} with a score of ${mine.score}${mine.prize ? ` and ${mine.prize} mock credits` : ""}. See game_results.`, played: r };
  }

  private async play(r: Round): Promise<void> {
    const entrants = r.entries.map((e) => ({ agent: e.did, sponsor: e.did }));
    let ranked: Array<{ agent: string; score: number; rank: number; transcript_hash: string }>;
    if (r.game === "twenty-one") {
      const s = this.secrets.get(r.id)!;
      const run = runGame({ commit: r.commit!, seed: s.seed, salt: s.salt, entrants: r.entries.map((e) => ({ agent: e.did, sponsor: e.did, policy: e.move as GamePolicy })), minDistinctSponsors: 1 });
      if (run.void) { r.void = run.reason ?? "void"; this.save(); return; }
      r.seed = s.seed; r.salt = s.salt; ranked = run.results;
    } else if (r.game === "word-pair") {
      ranked = playWordPair(r.prompt!, r.entries.map((e) => ({ agent: e.did, move: e.move as { word: string } })));
    } else if (r.game === "trading") {
      const tr = playTrade(r.entries.map((e) => ({ agent: e.did, move: e.move as { side: "buy" | "sell"; limit: number } })));
      r.price = tr.price; ranked = tr;
    } else {
      const run = runHideSeek({ entrants: r.entries.map((e) => ({ agent: e.did, sponsor: e.did, move: e.move as HsMove })), minDistinctSponsors: 1, tieSeed: r.id });
      if (run.void) { r.void = run.reason ?? "void"; this.save(); return; }
      ranked = run.results;
    }
    void entrants;
    r.results = [];
    for (const x of ranked) {
      const e = r.entries.find((y) => y.did === x.agent)!;
      const prize = PRIZES[x.rank - 1] ?? 0;
      if (prize) { await this.pay(e.did, prize); this.prizesPaid += prize; }
      r.results.push({ handle: e.handle, did: e.did, score: x.score, rank: x.rank, transcript_hash: x.transcript_hash, prize });
      const b = this.board.get(e.did) ?? { handle: e.handle, played: 0, wins: 0, score: 0 };
      b.played++; b.score += x.score; if (x.rank === 1) b.wins++;
      this.board.set(e.did, b);
    }
    this.save();
  }

  /** The leaderboard (wins, then mean score) and the latest rounds with every player's score and transcript hash: what a spectator sees. */
  results(game?: string, limit = 3): string {
    const lines: string[] = [];
    const rows = [...this.board.values()].sort((a, b) => b.wins - a.wins || b.score / b.played - a.score / a.played);
    lines.push(rows.length ? `Leaderboard: ${rows.slice(0, 8).map((b, i) => `${i + 1}. ${b.handle} ${b.wins} win${b.wins === 1 ? "" : "s"} in ${b.played} (mean score ${Math.round(b.score / b.played)})`).join("; ")}.` : "No round has been played yet.");
    const played = this.rounds.filter((r) => r.results && (!game || r.game === game)).slice(-limit).reverse();
    for (const r of played) lines.push(`${r.id} (${r.game}): ${r.results!.map((x) => `${x.rank}. ${x.handle} ${x.score}`).join(", ")}; transcripts ${r.results!.map((x) => x.transcript_hash.slice(7, 15)).join(", ")}`);
    return lines.join("\n");
  }

  /** Checks a played round the way anyone could from its published facts: the seed matches its commitment, every revealed move matches its commitment, and the transcript hashes are the ones the engine gives. */
  verify(r: Round): string[] {
    const bad: string[] = [];
    if (!r.results) return ["the round was not played"];
    for (const e of r.entries) if (moveCommit(e.move, e.salt) !== e.commit) bad.push(`${e.handle}'s move does not match its commitment`);
    if (r.game === "twenty-one") {
      if (!r.seed || !r.salt || commitSeed(r.seed, r.salt) !== r.commit) bad.push("the seed does not match the referee's commitment");
      else for (const e of r.entries) { const p = playEntrant(r.seed, e.move as GamePolicy); const h = transcriptHash(e.did, e.move as GamePolicy, p.transcript); if (r.results.find((x) => x.did === e.did)?.transcript_hash !== h || r.results.find((x) => x.did === e.did)?.score !== scoreOf(p.points, GAME_HANDS)) bad.push(`${e.handle}'s result does not recompute`); }
    } else if (r.game === "word-pair") {
      const again = playWordPair(r.prompt ?? "", r.entries.map((e) => ({ agent: e.did, move: e.move as { word: string } })));
      for (const e of r.entries) { const x = again.find((y) => y.agent === e.did)!, got = r.results.find((y) => y.did === e.did); if (!got || got.transcript_hash !== x.transcript_hash || got.score !== x.score) bad.push(`${e.handle}'s result does not recompute`); }
    } else if (r.game === "trading") {
      const again = playTrade(r.entries.map((e) => ({ agent: e.did, move: e.move as { side: "buy" | "sell"; limit: number } })));
      if (again.price !== r.price) bad.push("the clearing price does not recompute");
      for (const e of r.entries) { const x = again.find((y) => y.agent === e.did)!, got = r.results.find((y) => y.did === e.did); if (!got || got.transcript_hash !== x.transcript_hash || got.score !== x.score) bad.push(`${e.handle}'s result does not recompute`); }
    } else {
      const ent = r.entries.map((e) => ({ agent: e.did, sponsor: e.did, move: e.move as HsMove }));
      for (const e of ent) { const { matches } = matchesFor(e, ent); if (r.results.find((x) => x.did === e.agent)?.transcript_hash !== hsTranscriptHash(e.agent, e.move, matches)) bad.push(`${r.entries.find((y) => y.did === e.agent)!.handle}'s result does not recompute`); }
    }
    return bad;
  }
}

/** The games section of the report. */
export function renderGames(g: GameHall): string {
  const played = g.rounds.filter((r) => r.results);
  const L = ["## Games", ""];
  if (!played.length) { L.push(`The society had games (${Object.keys(GAMES).join(", ")}) and no round was played to the end.`); return L.join("\n") + "\n"; }
  L.push(`${played.length} round${played.length === 1 ? "" : "s"} played to the end; ${g.prizesPaid} mock credits paid in prizes. Every round can be recomputed from its seed and moves (games.json); ${played.filter((r) => g.verify(r).length === 0).length} of ${played.length} do.`);
  L.push("");
  for (const r of played) L.push(`- ${r.id}${r.prompt ? ` (prompt "${r.prompt}")` : ""}${r.price !== undefined ? ` (cleared at ${r.price})` : ""}: ${r.results!.map((x) => `${x.rank}. ${x.handle} (${x.score})`).join(", ")}`);
  const byGame = Object.keys(GAMES).map((n) => `${n} ${played.filter((r) => r.game === n).length}`).join(", ");
  L.push("", `Rounds played to the end by game: ${byGame}. Each round has a hashed transcript and the referee is a program of the house; no text says anyone should play.`);
  return L.join("\n") + "\n";
}
