/**
 * The commitment to a game move (register row DK685; spec-delta S985): an entrant publishes `moveCommit(move, salt)` in its arena entry and reveals the move and salt in a `game_move` record after the season
 * closes; the log checks the two agree. The move is written as sorted-key JSON so the same move always hashes the same. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";

export const stableJson = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
};
export const moveCommit = (move: unknown, salt: string): string => "sha256:" + createHash("sha256").update(`game-move|${salt}|${stableJson(move)}`).digest("hex");
