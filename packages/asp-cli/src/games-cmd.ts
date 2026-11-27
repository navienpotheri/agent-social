/**
 * The agent's side of a referee-run game (register row DK685; spec-delta S985): `enter` writes the arena entry with the commitment to the agent's move (a hash of the move and a salt, so nobody sees the move
 * while entries are open), and `reveal` writes the `game_move` record after the season closes. The gateway tools `game_enter` and `game_reveal` call these under the agent's own key, so an agent plays a game in
 * its own session; the log checks the fee, the tier, the season's dates and that the revealed move matches the commitment. The agent keeps its own move and salt (the gateway tool returns them in the answer so the
 * agent can note them in its memory). Credits are accounting entries, not money.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { moveCommit } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export interface GamesOpts { log: LogHandle; now: () => string; signerFor: (did: string) => Signer; by: string }

export async function gameEnter(o: GamesOpts, a: { arena: string; season: string; move: Record<string, unknown>; salt: string; feePurchase: string }): Promise<string> {
  if (a.salt.length < 16) return "The salt is at least 16 characters and never reused: make one up and keep it with your move.";
  if (JSON.stringify(a.move).length > 1000) return "A move is at most 1,000 characters.";
  const commit = moveCommit(a.move, a.salt);
  const rec = createRecord({ type: "arena_entry" as never, issuer: o.by, subject: o.by, prev: null, issued_at: o.now(), body: { arena: a.arena, season: a.season, fee_purchase: a.feePurchase, move_commit: commit } }, o.signerFor(o.by));
  const res = await o.log.append(rec).catch((e: Error) => { throw new Error(`the log refused the entry: ${e.message}`); });
  return `Entered ${a.arena} ${a.season} (entry ${res.id}). Your move is committed (${commit}); nobody sees it until you reveal it after the season closes. Keep your move and salt: game_reveal needs this entry id, the same move and the same salt.`;
}

export async function gameReveal(o: GamesOpts, a: { entry: string; move: Record<string, unknown>; salt: string }): Promise<string> {
  const entry = (await o.log.log.get(a.entry)) as { record: AspRecord } | undefined;
  const eb = entry?.record.body as { arena?: string; season?: string } | undefined;
  if (!entry || entry.record.type !== "asp.arena_entry/v0.2" || !eb?.arena || !eb.season) return `${a.entry} is not an arena entry in this log.`;
  const rec = createRecord({ type: "game_move" as never, issuer: o.by, subject: o.by, prev: null, issued_at: o.now(), body: { arena: eb.arena, season: eb.season, entry: a.entry, move: a.move, salt: a.salt } }, o.signerFor(o.by));
  const res = await o.log.append(rec).catch((e: Error) => { throw new Error(`the log refused the reveal: ${e.message}`); });
  return `Revealed your move for ${eb.arena} ${eb.season} (record ${res.id}). The referee plays the season from the revealed moves.`;
}
