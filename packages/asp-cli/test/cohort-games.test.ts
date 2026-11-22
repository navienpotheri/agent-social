// Slice C of the owner's "more to do" job (rows DK684, DK685): two games with a house referee that a text-only agent can play through tools: rules in one line, a move committed by a hash, a round played by the engines
// of the Arena when it is full, a leaderboard and the latest rounds for a spectator, prizes of a few mock credits, and rounds anyone can recompute. A scripted-agent run plays both games to the end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameHall, GAMES, PRIZES, ROUND_SIZE } from "../src/cohort/games.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("the game hall: rules in one line, moves checked against the game's rule and committed, one entry each, the round played when full, prizes to the first two, and every round recomputable from its seed and moves", async () => {
  const paid: Array<[string, number]> = [];
  const hall = new GameHall({ pay: async (did, n) => { paid.push([did, n]); } });
  assert.deepEqual(Object.keys(GAMES), ["twenty-one", "hide-and-seek"]);
  for (const g of Object.values(GAMES)) assert.ok(g.rule.length < 260 && !g.rule.includes("\n"), `${g.name}: the rules in one line`);
  assert.match(hall.list(), /twenty-one: .*Round twenty-one-1: 0 of 4 entered.*the referee's seed is committed \(sha256:/);
  await assert.rejects(hall.enter("a", "agent-01", "chess", "{}"), /there is no game called chess/);
  await assert.rejects(hall.enter("a", "agent-01", "twenty-one", "not json"), /a move is JSON/);
  await assert.rejects(hall.enter("a", "agent-01", "twenty-one", '{"stand_at": 5}'), /not a move of twenty-one/);
  await assert.rejects(hall.enter("a", "agent-01", "hide-and-seek", '{"hide": 9, "order": [0,1,2,3,4,5,6,7,8]}'), /not a move of hide-and-seek/);
  const dids = ["did:a", "did:b", "did:c", "did:d"], names = ["agent-01", "agent-02", "agent-03", "agent-04"];
  const stands = [13, 15, 17, 19];
  const said: string[] = [];
  for (const [i, d] of dids.entries()) { const r = await hall.enter(d, names[i]!, "twenty-one", JSON.stringify({ stand_at: stands[i] })); said.push(r.text); assert.equal(!!r.played, i === ROUND_SIZE - 1); }
  assert.match(said[0]!, /^Entered round twenty-one-1 \(1 of 4\)\. Your move is committed \(sha256:[0-9a-f]{12}/);
  assert.match(said[3]!, /The round is full and was played: you came \d of 4 with a score of \d+/);
  const r1 = hall.rounds.find((r) => r.id === "twenty-one-1")!;
  assert.deepEqual(r1.results!.map((x) => x.rank), [1, 2, 3, 4]);
  assert.deepEqual(r1.results!.map((x) => x.prize), [PRIZES[0], PRIZES[1], 0, 0]);
  assert.deepEqual(paid.map((p) => p[1]).sort(), [1, 3]);
  assert.equal(hall.prizesPaid, 4);
  assert.deepEqual(hall.verify(r1), [], "the round recomputes from the published seed and moves");
  assert.match(hall.list(), /Round twenty-one-3: 0 of 4 entered/, "a new round opened");
  assert.match(hall.results(), /^Leaderboard: 1\. agent-\d\d 1 win in 1 \(mean score \d+\)/);
  assert.match(hall.results("twenty-one"), /twenty-one-1 \(twenty-one\): 1\. agent-\d\d \d+, 2\./);
  // tampering is found: a changed move, a changed seed
  const bad1 = structuredClone(r1); bad1.entries[0]!.move = { stand_at: 12 };
  assert.match(hall.verify(bad1).join(";"), /does not match its commitment/);
  const bad2 = structuredClone(r1); bad2.seed = "ffffffffffffffff";
  assert.match(hall.verify(bad2).join(";"), /seed does not match the referee's commitment/);
  // hide and seek: a round of four, every pair plays
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (const [i, d] of dids.entries()) await hall.enter(d, names[i]!, "hide-and-seek", JSON.stringify({ hide: i * 2, order: order.map((c) => (c + i * 3) % 9) }));
  const hs = hall.rounds.find((r) => r.game === "hide-and-seek" && r.results)!;
  assert.equal(hs.results!.length, 4);
  assert.deepEqual(hall.verify(hs), []);
  const bad3 = structuredClone(hs); bad3.entries[1]!.move = { hide: 0, order };
  assert.ok(hall.verify(bad3).length >= 1);
});

test("the tools: a text agent lists the games, enters, waits for the round and reads the results; a full round pays the first two in mock credits; refusals say why; without games the tools say so", async () => {
  const none = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-games-none-")) });
  try {
    const a = await none.enrol(0, "agent-01");
    assert.match((await runTool(none.api, a, all, "game_list", {})).text, /There are no games in this society/);
  } finally { await none.close(); }
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-games-tools-")), games: true, gameRound: 2 });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    const hall = w.api.market!;
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    assert.match((await call(a, "game_list")).text, /twenty-one: .*A move looks like \{"stand_at": 17\}.*hide-and-seek: /s);
    assert.equal((await call(a, "game_enter", { game: "twenty-one", move: "{}" })).refused, "game_refused");
    const first = await call(a, "game_enter", { game: "twenty-one", move: '{"stand_at": 16}' });
    assert.equal(first.ok, true, first.text);
    assert.match(first.text, /Entered round twenty-one-1 \(1 of 2\)/);
    assert.match((await call(a, "game_enter", { game: "twenty-one", move: '{"stand_at": 14}' })).text, /already entered/);
    const before = [await hall.balance(a), await hall.balance(b)];
    const second = await call(b, "game_enter", { game: "twenty-one", move: '{"stand_at": 18}' });
    assert.match(second.text, /The round is full and was played: you came [12] of 2/);
    const after = [await hall.balance(a), await hall.balance(b)];
    assert.equal(after[0]! + after[1]! - before[0]! - before[1]!, PRIZES[0]! + PRIZES[1]!, "the two prizes were paid");
    assert.match((await call(a, "game_results")).text, /Leaderboard: .*twenty-one-1 \(twenty-one\)/s);
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

const opts = (extra: Partial<CohortOptions> = {}): CohortOptions => ({
  out: mkdtempSync(join(tmpdir(), "asp-games-out-")), home: mkdtempSync(join(tmpdir(), "asp-games-home-")), agents: 4, model: "stand-in",
  provider: standInProvider(() => "gamer", { latencyMs: 10 }), staggerMs: 60, budgetUsd: 2, totalUsd: 8, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined }, games: true, ...extra,
} as CohortOptions);

test("a run of four scripted agents plays both games to the end: both sides' entries are in the trace and the signed log, the report has a Games section, the prizes are in the credit table and the books balance, and every round recomputes", async () => {
  const r = await runCohort(opts());
  const trace = readFileSync(join(r.dir, "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const enters = trace.filter((e) => e.t === "tool" && e.tool === "game_enter" && e.ok);
  assert.equal(enters.length, 8, "four agents entered both games");
  assert.equal(new Set(enters.map((e) => e.agent)).size, 4, "all four sides are there");
  assert.ok(r.report.perAgent.every((s) => s.endReason === "stopped_exploring"), r.report.perAgent.map((s) => s.endReason).join());
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /## Games\n\n2 rounds played to the end; 8 mock credits paid in prizes\. Every round can be recomputed from its seed and moves \(games\.json\); 2 of 2 do\./);
  const games = JSON.parse(readFileSync(join(r.dir, "society", "games.json"), "utf8")) as { label: string; rounds: { id: string; entries: { handle: string; commit: string; move?: unknown; salt?: string }[]; results?: unknown[] }[] };
  assert.match(games.label, /played by AI agents/);
  assert.equal(games.rounds.filter((x) => x.results).length, 2);
  assert.ok(games.rounds[0]!.entries.every((e) => /^sha256:/.test(e.commit) && e.move !== undefined && e.salt), "a played round publishes its moves and salts");
  const credit = JSON.parse(readFileSync(join(r.dir, "credit-economy.json"), "utf8")) as { flows: { flow: string; credits: number | null }[]; audit: { verdict: string } };
  assert.equal(credit.flows.find((f) => f.flow === "game prizes")!.credits, 8);
  assert.equal(credit.audit.verdict, "balanced");
  // without --games nothing of it appears
  const plain = await runCohort(opts({ games: false, provider: standInProvider(() => "sleeper", { latencyMs: 5 }) }));
  assert.doesNotMatch(readFileSync(plain.markdownPath, "utf8"), /## Games/);
  assert.equal(ROUND_SIZE, 4);
});
