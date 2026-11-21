// DK685 (S985): moves committed in the entry and revealed after the season closes, checked by the log; a second game with an opponent whose good move depends on the others' moves; played by scripted agents
// on the log, scored from the revealed moves, and accepted by the Arena's results with the books balanced. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, institutionDid, moveCommit, movesFromRecords, runHideSeek, validHsMove, probesToFind, hsScore, type HsMove } from "../src/index.ts";
import { Kit, SERVICES, bankP, clinic, courts, operator, owner, party, registrar, treasury, type Party } from "./academy-kit.ts";

const ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const mv = (hide: number, order = ORDER): HsMove => ({ hide, order });
const e = (agent: string, sponsor: string, move?: unknown) => ({ agent, sponsor, move });

test("the rules: a move is a hiding cell and a permutation of the nine cells; probes are the position in the seeker's order; the score is the share of matches won", () => {
  assert.equal(validHsMove(mv(3)), true);
  for (const bad of [mv(9), mv(-1), { hide: 1, order: [0, 1, 2] }, { hide: 1, order: [0, 0, 1, 2, 3, 4, 5, 6, 7] }, { hide: 1.5, order: ORDER }, null, undefined, "x"]) assert.equal(validHsMove(bad), false, JSON.stringify(bad));
  assert.equal(probesToFind(mv(0, [8, 7, 6, 5, 4, 3, 2, 1, 0]), mv(8)), 1, "the first cell searched");
  assert.equal(probesToFind(mv(0, [8, 7, 6, 5, 4, 3, 2, 1, 0]), mv(0)), 9, "the last cell searched");
  assert.equal(hsScore(4, 4), 1000);
  assert.equal(hsScore(-4, 4), 0);
  assert.equal(hsScore(0, 4), 500);
});

test("a good move depends on the opponents: against four who hide at 0 and look from 0, hiding at 8 and looking at 0 first wins every match; the table is the same in any order and a hash is recomputable", () => {
  const naive = (n: string, s: string) => e(n, s, mv(0, ORDER));
  const field = [naive("a", "s1"), naive("b", "s2"), naive("c", "s3"), naive("d", "s4"), e("smart", "s5", mv(8, ORDER))];
  const run = runHideSeek({ entrants: field, minDistinctSponsors: 3, tieSeed: "t", keepTranscripts: true });
  assert.equal(run.void, false);
  assert.equal(run.results[0]!.agent, "smart");
  assert.equal(run.results[0]!.score, 1000, "won all four matches");
  assert.deepEqual(runHideSeek({ entrants: [...field].reverse(), minDistinctSponsors: 3, tieSeed: "t", keepTranscripts: true }), run, "the same table in any order of entrants");
  const again = runHideSeek({ entrants: field, minDistinctSponsors: 3, tieSeed: "t" });
  assert.equal(again.results[0]!.transcript_hash, run.results[0]!.transcript_hash, "the hash does not depend on whether transcripts are kept");
  // The same move gives another result against another field: the game is about the others.
  const rev = [8, 7, 6, 5, 4, 3, 2, 1, 0];
  const other = runHideSeek({ entrants: [e("smart", "s5", mv(8, ORDER)), e("x", "s1", mv(8, rev)), e("y", "s2", mv(8, rev)), e("z", "s3", mv(8, rev))], minDistinctSponsors: 3, tieSeed: "t" });
  assert.notEqual(other.results.find((r) => r.agent === "smart")!.score, 1000);
});

test("no reveal or an invalid move loses every match and gives the opponents a draw; too few sponsors or no entries is void", () => {
  const run = runHideSeek({ entrants: [e("a", "s1", mv(0)), e("b", "s2", mv(1)), e("c", "s3", mv(2)), e("ghost", "s4", undefined), e("bad", "s5", mv(99))], minDistinctSponsors: 3, tieSeed: "t" });
  assert.equal(run.results.find((r) => r.agent === "ghost")!.score, 0);
  assert.equal(run.results.find((r) => r.agent === "bad")!.score, 0);
  assert.ok(run.results.filter((r) => ["a", "b", "c"].includes(r.agent)).every((r) => r.points > -3), "opponents are not punished for a ghost");
  assert.deepEqual(runHideSeek({ entrants: [e("a", "s1", mv(0)), e("b", "s2", mv(1))], minDistinctSponsors: 3, tieSeed: "t" }), { void: true, reason: "too_few_sponsors", results: [] });
  assert.deepEqual(runHideSeek({ entrants: [], minDistinctSponsors: 3, tieSeed: "t" }), { void: true, reason: "no_entries", results: [] });
});

test("on the log: moves are committed in the entry and revealed after the season closes; a move that does not match is refused; scripted agents play, the referee scores the revealed moves and the Arena accepts the results", async () => {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, party(institutionDid("academy"), 57)].map((p) => [p.kid, p.publicKey])));
  const k = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
  const agents: Party[] = await Promise.all(["h1", "h2", "h3", "h4"].map((n) => k.agent(n, undefined, 2)));
  await k.priceList();
  await k.put(k.mk("arena", registrar, { arena: "hide-and-seek", season: "2026-q4", min_tier: 2, entry_service: SERVICES.arena, min_distinct_sponsors: 3, opens: "2026-11-02T00:00:00Z", closes: "2026-12-01T00:00:00Z", prize_split_permille: [500, 300, 200] }));
  k.at("2026-11-05T00:00:00Z");
  const moves = [mv(0, ORDER), mv(8, ORDER), mv(4, [4, 3, 5, 2, 6, 1, 7, 0, 8]), mv(8, [8, 0, 1, 2, 3, 4, 5, 6, 7])];
  const salts = agents.map((_, i) => `a-long-unique-salt-${i}`);
  const entryIds: string[] = [];
  for (const [i, a] of agents.entries()) {
    await k.fund(a, 10);
    const fee = await k.buy(a, SERVICES.arena, 10);
    entryIds.push(await k.put(k.mk("arena_entry", a, { arena: "hide-and-seek", season: "2026-q4", fee_purchase: fee, move_commit: moveCommit(moves[i], salts[i]!) }, null, { subject: a.did })));
  }
  const reveal = (i: number, over: Record<string, unknown> = {}) => k.mk("game_move", agents[i]!, { arena: "hide-and-seek", season: "2026-q4", entry: entryIds[i]!, move: moves[i], salt: salts[i], ...over }, null, { subject: agents[i]!.did });
  const refused = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (err) { return (err as { detail?: string }).detail; } };
  // While entries are open nobody reveals.
  assert.equal(await refused(k.log.append(reveal(0))), "game_move_early");
  k.at("2026-12-02T00:00:00Z");
  assert.equal(await refused(k.log.append(reveal(0, { move: mv(5, ORDER) }))), "move_mismatch", "a changed move is refused");
  assert.equal(await refused(k.log.append(reveal(0, { salt: "another-unique-salt-x" }))), "move_mismatch");
  assert.equal(await refused(k.log.append(k.mk("game_move", agents[1]!, { arena: "hide-and-seek", season: "2026-q4", entry: entryIds[0], move: moves[0], salt: salts[0] }, null, { subject: agents[1]!.did }))), "game_move_not_entrants");
  for (let i = 0; i < 3; i++) await k.log.append(reveal(i));
  assert.equal(await refused(k.log.append(reveal(0))), "game_move_already_revealed");
  // The fourth agent never reveals: it scores nothing.
  const records = (await k.log.academyRecords(["arena_entry", "game_move"])) as never[];
  const read = movesFromRecords("hide-and-seek", "2026-q4", records);
  assert.deepEqual(read.get(agents[1]!.did), moves[1]);
  assert.equal(read.get(agents[3]!.did), undefined);
  const run = runHideSeek({ entrants: agents.map((a) => ({ agent: a.did, sponsor: k.sponsors.get(a.did)!.did, move: read.get(a.did) })), minDistinctSponsors: 3, tieSeed: "referee-t" });
  assert.equal(run.void, false);
  assert.equal(run.results.at(-1)!.agent, agents[3]!.did, "no reveal, last");
  for (const r of run.results) {
    const who = agents.find((x) => x.did === r.agent)!;
    const j = k.jobs.get(who.did) ?? (await k.job(who));
    const action = await k.put(k.mk("action", who, { contract: j.contract, scopes_used: [], summary: "hide and seek: my game", artifacts: [{ uri: "asp://game/hide-and-seek/transcript", sha256: r.transcript_hash }] }, null, { subject: j.contract }));
    await k.log.append(k.mk("arena_result", registrar, { arena: "hide-and-seek", season: "2026-q4", agent: r.agent, score: r.score, rank: r.rank, field_size: r.field_size, opponents: r.opponents, run_log_hash: action }, null, { subject: r.agent }));
  }
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal((await k.log.verify()).ok, true);
});
