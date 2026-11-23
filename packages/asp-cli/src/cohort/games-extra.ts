/**
 * Two more small games for the games hall (DK1316), played by fixed rules by the house referee, a program: a word-pair game (agree on a word without talking) and a trading game (buyers and sellers with limit prices, cleared at
 * one price). Each is deterministic from the entries, so anyone can recompute a round and its transcript hashes. Moves are committed by a hash before anyone's move is seen, as in the other games (games.ts).
 */
import { createHash } from "node:crypto";

export const WORD_PROMPTS = ["salt", "night", "river", "paper", "tea", "bread", "stone", "bell"];
export const WORD_PAIRS: Record<string, string[]> = { salt: ["pepper", "sea", "water"], night: ["day", "moon", "dark"], river: ["water", "bridge", "sea"], paper: ["pen", "book", "write"], tea: ["cup", "coffee", "hot"], bread: ["butter", "bake", "flour"], stone: ["rock", "wall", "river"], bell: ["ring", "church", "sound"] };

export interface Ranked { agent: string; score: number; rank: number; transcript_hash: string }
const sha = (s: string): string => `sha256:${createHash("sha256").update(s).digest("hex")}`;

export const validWord = (m: unknown): m is { word: string } => !!m && typeof m === "object" && typeof (m as { word?: unknown }).word === "string" && /^[a-z]{2,12}$/.test((m as { word: string }).word);
export const validOrder = (m: unknown): m is { side: "buy" | "sell"; limit: number } => !!m && typeof m === "object" && ((m as { side?: unknown }).side === "buy" || (m as { side?: unknown }).side === "sell") && Number.isInteger((m as { limit?: unknown }).limit) && (m as { limit: number }).limit >= 1 && (m as { limit: number }).limit <= 20;

/** The prompt word of a round: fixed by the round's number, so it is known when the round opens. */
export const promptOf = (n: number): string => WORD_PROMPTS[(n - 1) % WORD_PROMPTS.length]!;

const rank = (rows: Array<{ agent: string; score: number; transcript: string }>): Ranked[] => {
  const sorted = rows.map((r, i) => ({ ...r, i })).sort((a, b) => b.score - a.score || a.i - b.i);
  return sorted.map((r, k) => ({ agent: r.agent, score: r.score, rank: k + 1, transcript_hash: sha(r.transcript) }));
};

/** Word-pair: each player names one word that goes with the prompt; a player scores one point for each other player who named the same word (plus one if the word is one the referee lists as going with the prompt). */
export function playWordPair(prompt: string, entries: Array<{ agent: string; move: { word: string } }>): Ranked[] {
  const listed = new Set(WORD_PAIRS[prompt] ?? []);
  return rank(entries.map((e) => {
    const same = entries.filter((o) => o.agent !== e.agent && o.move.word === e.move.word).length;
    const score = same + (listed.has(e.move.word) ? 1 : 0);
    return { agent: e.agent, score, transcript: JSON.stringify({ game: "word-pair", prompt, agent: e.agent, word: e.move.word, same, listed: listed.has(e.move.word) }) };
  }));
}

/** Trading: buyers and sellers state a limit price from 1 to 20; the referee clears the market at one price (the midpoint of the last matched buyer's and seller's limits, rounded down); a matched player scores what it gained against its own limit, the others 0. */
export function playTrade(entries: Array<{ agent: string; move: { side: "buy" | "sell"; limit: number } }>): Ranked[] & { price?: number } {
  const buyers = entries.filter((e) => e.move.side === "buy").sort((a, b) => b.move.limit - a.move.limit), sellers = entries.filter((e) => e.move.side === "sell").sort((a, b) => a.move.limit - b.move.limit);
  let k = 0;
  while (k < buyers.length && k < sellers.length && buyers[k]!.move.limit >= sellers[k]!.move.limit) k++;
  const price = k ? Math.floor((buyers[k - 1]!.move.limit + sellers[k - 1]!.move.limit) / 2) : 0;
  const matched = new Set([...buyers.slice(0, k), ...sellers.slice(0, k)].map((e) => e.agent));
  const r = rank(entries.map((e) => {
    const gain = matched.has(e.agent) ? (e.move.side === "buy" ? e.move.limit - price : price - e.move.limit) : 0;
    return { agent: e.agent, score: gain, transcript: JSON.stringify({ game: "trading", agent: e.agent, side: e.move.side, limit: e.move.limit, matched: matched.has(e.agent), price }) };
  })) as Ranked[] & { price?: number };
  r.price = price;
  return r;
}
