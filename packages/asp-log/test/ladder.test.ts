// Row DK1741: the Arena's ladder: a rating from pairwise results with counting rules that make it hard to farm (only referee-drawn pairings, only between different controllers, a cap on the same pair, a counted job
// first), seasons with a soft reset, a measured simulation of how well a rating tracks skill (and how luck blurs it) and of a ring trading wins. A rating is read by nothing that gates tier, bond or work. Fake ids only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LADDER_PAIR_CAP, kFactor, rateLadder, seasonReset, simulateField, simulateRing, spearman, type LadderMatch, type LadderPlayer } from "../src/index.ts";
import { expected, flagsOf } from "../src/ladder.ts";

const P = (id: string, controller = id, countedJobs = 3): LadderPlayer => ({ id, controller, countedJobs });
const M = (a: string, b: string, score: 1 | 0 | 0.5, at: number, scheduled?: boolean): LadderMatch => ({ a, b, score, at, ...(scheduled === undefined ? {} : { scheduled }) });

test("DK1741: the rating moves by a step that shrinks as games accumulate, and a counted match is zero-sum", () => {
  assert.deepEqual([kFactor(0), kFactor(9), kFactor(10), kFactor(29), kFactor(30)], [40, 40, 24, 24, 16]);
  assert.equal(expected(1000, 1000), 0.5);
  assert.ok(Math.abs(expected(1200, 1000) + expected(1000, 1200) - 1) < 1e-12);
  const t = rateLadder([P("a"), P("b")], [M("a", "b", 1, 1)]);
  assert.deepEqual(t.ratings.map((r) => r.rating), [1020, 980]);
  const many = rateLadder([P("a"), P("b"), P("c")], [M("a", "b", 1, 1), M("b", "c", 0, 2), M("a", "c", 0.5, 3)]);
  assert.ok(Math.abs(many.ratings.reduce((s, r) => s + r.rating, 0) - 3000) <= 2, "the sum is kept, apart from rounding");
});

test("DK1741: what counts: only a drawn pairing, between different controllers, at most three times for the same pair, and only with a counted job", () => {
  const players = [P("a1", "ca"), P("a2", "ca"), P("b", "cb"), P("fresh", "cf", 0)];
  const t = rateLadder(players, [
    M("a1", "a2", 1, 1),             // one controller
    M("a1", "b", 1, 2, false),       // agreed, not drawn
    M("a1", "fresh", 1, 3),          // no counted job
    M("a1", "b", 1, 4), M("b", "a1", 0, 5), M("a2", "b", 1, 6), // three between the two controllers
    M("a1", "b", 1, 7),              // the fourth
    M("a1", "a1", 1, 8),             // itself
  ]);
  const why = t.counted.map((c) => [c.counted, c.why.slice(0, 30)]);
  assert.deepEqual(why.map((x) => x[0]), [false, false, false, true, true, true, false, false]);
  assert.match(t.counted[0]!.why, /one controller/);
  assert.match(t.counted[1]!.why, /not drawn by the referee/);
  assert.match(t.counted[2]!.why, /no counted job/);
  assert.match(t.counted[6]!.why, new RegExp(`${LADDER_PAIR_CAP} times`));
  assert.match(t.counted[7]!.why, /itself/);
  assert.equal(t.ratings.find((r) => r.id === "fresh")!.games, 0);
  assert.equal(seasonReset(1200), 1100);
  assert.equal(seasonReset(800), 900);
  assert.equal(seasonReset(1000), 1000);
});

test("DK1741: an agent that plays mostly two controllers is flagged for a person to look at, never penalised by the rule", () => {
  const players = [P("x", "cx"), ...Array.from({ length: 8 }, (_, i) => P(`o${i}`, `co${i}`))];
  const ms: LadderMatch[] = [];
  for (let i = 0; i < 13; i++) ms.push(M("x", i % 2 ? "o0" : "o1", i % 3 === 0 ? 0 : 1, i));
  ms.push(M("x", "o2", 1, 20));
  const by = new Map(players.map((p) => [p.id, p]));
  const raw = ms.map((m) => ({ match: m, counted: true, why: "counted" }));
  assert.deepEqual(flagsOf(by, raw).map((f) => [f.id, f.kind]), [["x", "narrow_schedule"]]);
  assert.equal(flagsOf(by, raw.slice(0, 5)).length, 0, "too few matches to say");
});

test("DK1741 measured: a rating tracks skill better with more games and worse with more luck (40 players, Spearman against the true skill)", () => {
  const at = (per: number, luck: number) => simulateField("t1", 40, per, luck).corr;
  assert.ok(at(10, 0) < at(30, 0) && at(30, 0) < at(100, 0), "more games, a better rank");
  assert.ok(at(30, 0) > at(30, 0.3) && at(30, 0.3) > at(30, 0.6), "more luck, a worse rank");
  assert.ok(at(30, 0.6) < 0.8, "a game that is mostly luck cannot be read finely even with 30 games each");
  assert.ok(at(30, 0) > 0.9);
  assert.equal(simulateField("t1", 40, 30, 0.3).corr, simulateField("t1", 40, 30, 0.3).corr, "deterministic");
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
});

test("DK1741 measured: a ring of six that trades wins among itself tops the ladder without the counting rules and does not with them (five seeds)", () => {
  let off = 0, on = 0;
  for (const s of ["a", "b", "c", "d", "e"]) {
    const r = simulateRing(s, 6, 12);
    assert.ok(r.withoutRules > r.honestTop + 100, `without the rules the ring's best (${r.withoutRules}) is far above the best honest player (${r.honestTop})`);
    assert.ok(r.withRules <= r.honestTop + 60, `with them the ring's best (${r.withRules}) is within the luck of the honest top (${r.honestTop})`);
    assert.ok(r.counted < r.submitted, "the ring's private matches were not counted");
    off += r.withoutRules; on += r.withRules;
  }
  assert.ok(off / 5 - on / 5 > 120, `mean inflation removed: ${Math.round(off / 5 - on / 5)} rating points`);
});

test("DK1741: a rating reaches no gate: no file of the log imports the ladder except the index that exports it", () => {
  const dir = new URL("../src/", import.meta.url);
  const importers = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "ladder.ts" && /from "\.\/ladder\.ts"/.test(readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(importers, ["index.ts"], "only the index exports it: the tier, bond and Market rules do not read a rating");
});
