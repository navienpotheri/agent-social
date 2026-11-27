// Row DK684: a referee-run game for the Arena ("Twenty-One"): the referee commits to its seed, entrants submit a policy, the seed is revealed and the engine plays every hand by fixed rules; results are ranked, carry a transcript hash anyone can
// recompute, and are accepted by the Arena's own records (entry fees, results, balanced books). Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, institutionDid, GAME_HANDS, commitSeed, gameTotal, playEntrant, runGame, scoreOf, transcriptHash, validPolicy, type GameEntrant } from "../src/index.ts";
import { Kit, SERVICES, bankP, clinic, courts, operator, owner, party, registrar, treasury, type Party } from "./academy-kit.ts";

const SEED = "referee-seed-7", SALT = "salt-1";
const e = (agent: string, sponsor: string, stand_at?: number): GameEntrant => ({ agent, sponsor, ...(stand_at ? { policy: { stand_at } } : {}) });
const field = [e("a", "s1", 17), e("b", "s2", 12), e("c", "s3", 21), e("d", "s4", 15), e("e", "s5")];
const play = (over: Record<string, unknown> = {}) => runGame({ commit: commitSeed(SEED, SALT), seed: SEED, salt: SALT, entrants: field, minDistinctSponsors: 3, hands: 1000, ...over });

test("DK684: the rules: aces count 11 and fall to 1, faces count 10, a policy is a whole number from 12 to 21, the score is the share of points won", () => {
  assert.equal(gameTotal([1, 13]), 21);
  assert.equal(gameTotal([1, 1, 9]), 21, "two aces: 11 + 1 + 9");
  assert.equal(gameTotal([10, 10, 5]), 25);
  assert.equal(gameTotal([1, 6, 10]), 17, "the ace falls to 1 to avoid a bust");
  assert.equal(validPolicy({ stand_at: 17 }), true);
  for (const bad of [{ stand_at: 11 }, { stand_at: 22 }, { stand_at: 16.5 }, { stand_at: "17" }, {}, null, undefined]) assert.equal(validPolicy(bad), false, JSON.stringify(bad));
  assert.equal(scoreOf(0, 200), 500, "even");
  assert.equal(scoreOf(200, 200), 1000, "won every hand");
  assert.equal(scoreOf(-200, 200), 0);
});

test("DK684: the same seed and policies give the same table and the same transcripts in any order; a policy that always draws to 21 loses clearly, no move scores 0, and a result's hash is recomputable by anyone", () => {
  const run = play();
  assert.equal(run.void, false);
  assert.deepEqual(play({ entrants: [...field].reverse() }), run, "the same table in any order of entrants");
  assert.equal(run.results.length, 5);
  assert.equal(run.results.at(-1)!.agent, "e");
  assert.equal(run.results.at(-1)!.score, 0, "no move, no hands, no points");
  const c = run.results.find((r) => r.agent === "c")!;
  const others = run.results.filter((r) => ["a", "b", "d"].includes(r.agent));
  assert.ok(others.every((r) => r.score > c.score + 150), `drawing to 21 busts too often: ${c.score} against ${others.map((r) => r.score).join(", ")}`);
  assert.deepEqual(run.results.map((r) => r.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(run.results[0].opponents, ["b", "c", "d", "e"].filter((x) => x !== run.results[0].agent).sort());
  // Anyone with the seed, the policy and the hand count recomputes the transcript hash.
  const a = run.results.find((r) => r.agent === "a")!;
  const g = playEntrant(SEED, { stand_at: 17 }, 1000);
  assert.equal(transcriptHash("a", { stand_at: 17 }, g.transcript), a.transcript_hash);
  assert.equal(a.points, g.points);
  assert.equal(a.score, scoreOf(g.points, 1000));
  assert.equal(g.transcript.length, 1000);
  assert.notEqual(transcriptHash("a", { stand_at: 16 }, playEntrant(SEED, { stand_at: 16 }, 1000).transcript), a.transcript_hash, "another policy is another transcript");
});

test("DK684: the referee cannot change the seed after the policies are in; a season with too few sponsors or no entries is void", () => {
  assert.throws(() => runGame({ commit: commitSeed(SEED, SALT), seed: "another-seed", salt: SALT, entrants: field, minDistinctSponsors: 3 }), /seed_changed/);
  assert.throws(() => runGame({ commit: commitSeed(SEED, SALT), seed: SEED, salt: "another-salt", entrants: field, minDistinctSponsors: 3 }), /seed_changed/);
  assert.deepEqual(play({ entrants: [e("a", "s1", 17), e("b", "s2", 15), e("c", "s3", 16)] }), { void: true, reason: "too_few_sponsors", results: [] });
  assert.deepEqual(play({ entrants: [] }), { void: true, reason: "no_entries", results: [] });
  assert.equal(GAME_HANDS, 200);
  assert.ok(play({ keepTranscripts: true }).results[0].transcript!.length === 1000);
});

test("DK684: on the log: entrants pay the Arena's entry fee, the referee plays the season, and the table is accepted by the Arena's result records with the books balanced; a result for an unentered agent is not the engine's to make", async () => {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, party(institutionDid("academy"), 57)].map((p) => [p.kid, p.publicKey])));
  const k = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
  const agents: Party[] = await Promise.all(["g1", "g2", "g3", "g4"].map((n) => k.agent(n, undefined, 2)));
  await k.priceList();
  await k.put(k.mk("arena", registrar, { arena: "twenty-one", season: "2026-q4", min_tier: 2, entry_service: SERVICES.arena, min_distinct_sponsors: 3, opens: "2026-11-02T00:00:00Z", closes: "2026-12-01T00:00:00Z", prize_split_permille: [500, 300, 200] }));
  k.at("2026-11-05T00:00:00Z");
  for (const a of agents) { await k.fund(a, 10); const fee = await k.buy(a, SERVICES.arena, 10); await k.put(k.mk("arena_entry", a, { arena: "twenty-one", season: "2026-q4", fee_purchase: fee }, null, { subject: a.did })); }
  const policies = [17, 15, 12, 21];
  const entrants = agents.map((a, i) => ({ agent: a.did, sponsor: k.sponsors.get(a.did)!.did, policy: { stand_at: policies[i] } }));
  const run = runGame({ commit: commitSeed("log-seed", "s"), seed: "log-seed", salt: "s", entrants, minDistinctSponsors: 3 });
  assert.equal(run.void, false);
  k.at("2026-12-02T00:00:00Z");
  for (const r of run.results) {
    // The entrant reports its game in an Action of its own, carrying the transcript hash; the Arena's result cites that Action as the run log.
    const who = agents.find((x) => x.did === r.agent)!;
    const j = k.jobs.get(who.did) ?? (await k.job(who));
    const action = await k.put(k.mk("action", who, { contract: j.contract, scopes_used: [], summary: "twenty-one: my game", artifacts: [{ uri: "asp://game/twenty-one/transcript", sha256: r.transcript_hash }] }, null, { subject: j.contract }));
    await k.log.append(k.mk("arena_result", registrar, { arena: "twenty-one", season: "2026-q4", agent: r.agent, score: r.score, rank: r.rank, field_size: r.field_size, opponents: r.opponents, run_log_hash: action }, null, { subject: r.agent }));
  }
  assert.equal(run.results.at(-1)!.agent, agents[3].did, "the player who draws to 21 is last");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
