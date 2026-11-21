/**
 * The ladder's draw (register row DK1741; spec-delta S1598; docs/institutions/games-and-arena.md 3 and 6): the pairing of a round is a function of the published seed, the round and the entrants, so no agent chooses its
 * opponent and anyone can recompute who plays whom. Entrants are ordered by a hash of the seed, the round and the DID, and paired two by two; an odd entrant has a bye that round. Pure.
 */
import { createHash } from "node:crypto";

const h = (s: string) => createHash("sha256").update(s).digest("hex");

/** The pairs of a round, each pair in the order of the draw. */
export function ladderDraw(seed: string, round: number, entrants: readonly string[]): [string, string][] {
  const order = [...new Set(entrants)].sort((x, y) => { const a = h(`ladder|${seed}|${round}|${x}`), b = h(`ladder|${seed}|${round}|${y}`); return a < b ? -1 : a > b ? 1 : 0; });
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < order.length; i += 2) out.push([order[i]!, order[i + 1]!]);
  return out;
}

/** Whether two entrants are paired in a round, in either order. */
export const isDrawn = (seed: string, round: number, entrants: readonly string[], a: string, b: string): boolean =>
  ladderDraw(seed, round, entrants).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
