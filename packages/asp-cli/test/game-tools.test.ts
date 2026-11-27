// DK685 (S985, S986): two scripted agents play hide and seek through the gateway tools game_enter and game_reveal in their own sessions (moves committed before the reveal, a changed move refused), the referee
// scores the revealed moves, the Arena accepts the results, and a Court record replays a disputed result and says whether it matches. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { staticResolver, type Signer } from "@agent-social/asp-core";
import { EventLog, MemoryStore, institutionDid, recomputeHsHash, movesFromRecords, runHideSeek } from "@agent-social/asp-log";
import { aspHandler } from "../../asp-package/src/gateway/mcp.ts";
import { gameEnter, gameReveal } from "../src/games-cmd.ts";
import { Kit, SERVICES, bankP, clinic, courts, operator, owner, party, registrar, treasury, type Party } from "../../asp-log/test/academy-kit.ts";

const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;
const ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8];

test("agents play through game_enter and game_reveal; a changed move is refused; the referee scores the revealed moves; a Court replays a result and the record says it matches", async () => {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, party(institutionDid("academy"), 57)].map((p) => [p.kid, p.publicKey])));
  const k = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
  const agents: Party[] = await Promise.all(["t1", "t2", "t3", "t4"].map((n) => k.agent(n, undefined, 2)));
  await k.priceList();
  await k.put(k.mk("arena", registrar, { arena: "hide-and-seek", season: "2026-q4", min_tier: 2, entry_service: SERVICES.arena, min_distinct_sponsors: 3, opens: "2026-11-02T00:00:00Z", closes: "2026-12-01T00:00:00Z", prize_split_permille: [500, 300, 200] }));
  k.at("2026-11-05T00:00:00Z");
  let clock = "2026-11-05T00:00:00Z";
  const handle = { log: k.log, append: (r: never) => k.log.append(r) } as never;
  const handlers = agents.map((a) => aspHandler({ society: { standing: async () => "credits", games: {
    enter: (x) => gameEnter({ log: handle, now: () => clock, signerFor: () => a as Signer, by: a.did }, x).catch((e: Error) => `The game was not entered: ${e.message}`),
    reveal: (x) => gameReveal({ log: handle, now: () => clock, signerFor: () => a as Signer, by: a.did }, x).catch((e: Error) => `The move was not revealed: ${e.message}`),
  } } }));
  // The tools exist only when the run holds the agent's key.
  assert.deepEqual((await handlers[0]!.listTools()).map((t) => t.name).filter((n) => n.startsWith("game_")).sort(), ["game_enter", "game_reveal"]);
  assert.ok(!(await aspHandler({ society: { standing: async () => "credits" } }).listTools()).some((t) => t.name === "game_enter"), "no key, no game");

  const moves = [{ hide: 0, order: ORDER }, { hide: 8, order: ORDER }, { hide: 4, order: [4, 3, 5, 2, 6, 1, 7, 0, 8] }, { hide: 8, order: [8, 0, 1, 2, 3, 4, 5, 6, 7] }];
  const salts = agents.map((_, i) => `scripted-agent-salt-${i}`);
  const entries: string[] = [];
  for (const [i, a] of agents.entries()) {
    await k.fund(a, 10);
    const fee = await k.buy(a, SERVICES.arena, 10);
    const said = text(await handlers[i]!.callTool("game_enter", { arena: "hide-and-seek", season: "2026-q4", move: moves[i], salt: salts[i], fee_purchase: fee }));
    assert.match(said, /Entered hide-and-seek 2026-q4 \(entry sha256:[0-9a-f]{64}\)\. Your move is committed/);
    entries.push(/entry (sha256:[0-9a-f]{64})/.exec(said)![1]!);
  }
  // A bad call is refused before it reaches the log, and the log refuses an early reveal.
  assert.equal((await handlers[0]!.callTool("game_enter", { arena: "x" })).isError, true);
  assert.match(text(await handlers[0]!.callTool("game_reveal", { entry: entries[0], move: moves[0], salt: salts[0] })), /refused the reveal.*after the season closes/);
  clock = "2026-12-02T00:00:00Z"; k.at(clock);
  assert.match(text(await handlers[0]!.callTool("game_reveal", { entry: entries[0], move: { hide: 5, order: ORDER }, salt: salts[0] })), /do not hash to the commitment/, "a changed move is refused");
  for (const i of [0, 1, 2]) assert.match(text(await handlers[i]!.callTool("game_reveal", { entry: entries[i], move: moves[i], salt: salts[i] })), /Revealed your move/);
  // The fourth agent never reveals. The referee plays the season from the log alone.
  const records = (await k.log.academyRecords(["arena_entry", "game_move"])) as never[];
  const read = movesFromRecords("hide-and-seek", "2026-q4", records);
  const run = runHideSeek({ entrants: agents.map((a) => ({ agent: a.did, sponsor: k.sponsors.get(a.did)!.did, move: read.get(a.did) })), minDistinctSponsors: 3, tieSeed: "t" });
  assert.equal(run.void, false);
  const actionOf = new Map<string, string>();
  for (const r of run.results) {
    const who = agents.find((x) => x.did === r.agent)!;
    const j = k.jobs.get(who.did) ?? (await k.job(who));
    const action = await k.put(k.mk("action", who, { contract: j.contract, scopes_used: [], summary: "hide and seek: my game", artifacts: [{ uri: "asp://game/hide-and-seek/transcript", sha256: r.transcript_hash }] }, null, { subject: j.contract }));
    actionOf.set(r.agent, action);
    await k.log.append(k.mk("arena_result", registrar, { arena: "hide-and-seek", season: "2026-q4", agent: r.agent, score: r.score, rank: r.rank, field_size: r.field_size, opponents: r.opponents, run_log_hash: action }, null, { subject: r.agent }));
  }
  assert.equal((await k.log.creditAudit()).verdict, "balanced");

  // A dispute: the Court recomputes the first result's transcript from the revealed moves in the log and records the replay.
  const disputed = run.results[0]!;
  const recomputed = recomputeHsHash("hide-and-seek", "2026-q4", records, disputed.agent)!;
  assert.equal(recomputed, disputed.transcript_hash, "anyone recomputes the same hash from the log");
  const replay = (over: Record<string, unknown> = {}, by: Party = courts) => k.mk("court_act", by, { act: "game_replay", replay: { arena: "hide-and-seek", season: "2026-q4", agent: disputed.agent, transcript_sha256: disputed.transcript_hash, recomputed_sha256: recomputed, outcome: "match", ...over } }, null);
  const refused = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (err) { return (err as { detail?: string }).detail; } };
  assert.equal(await refused(k.log.append(replay({}, registrar))), "replay_wrong_issuer");
  assert.equal(await refused(k.log.append(replay({ transcript_sha256: "sha256:" + "9".repeat(64), recomputed_sha256: "sha256:" + "9".repeat(64) }))), "replay_transcript_not_cited");
  assert.equal(await refused(k.log.append(replay({ outcome: "mismatch" }))), "replay_outcome_wrong", "the outcome must tell the truth about the comparison");
  assert.equal(await refused(k.log.append(replay({ agent: "did:web:example.com:agents:nobody" }))), "replay_no_result");
  await k.log.append(replay());
  assert.equal((await k.log.verify()).ok, true);
});
