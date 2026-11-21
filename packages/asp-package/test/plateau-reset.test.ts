/**
 * Reset on plateau (register row DK819; spec-delta S1210): on a scripted optimisation task an anchored agent plateaus and the same agent with the reset climbs past it on the same budget; a reset that drops a
 * gate-passed lesson, or restarts from an artifact that is not the signed best, is flagged. A toy landscape, scripted search; no real model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPLORE, artifactHash, landscape, search, type Options } from "../src/plateau-reset.ts";

const START = { x: 20, score: landscape(20) };
const LESSONS = [{ id: "avoid-the-low-end", text: "scores below 10 never beat the artifact" }, { id: "second-peak-above-60", text: "a second, higher peak lies above 60" }];
const base = (seed: string, over: Partial<Options> = {}): Options => ({ seed, budget: 60, start: START, f: landscape, lessons: LESSONS, ...over });
const seeds = Array.from({ length: 20 }, (_, i) => `run-${i}`);

test("the landscape: a local peak of 50 at 20, the global peak of 100 at 80", () => {
  assert.deepEqual([landscape(20), landscape(80), landscape(50), landscape(0)], [50, 100, 0, 0]);
});

test("an anchored agent plateaus at the local peak on every seed; the same agent with the reset climbs past it on the same budget on nearly every seed, and never ends below where the anchored one stops", () => {
  const anchored = seeds.map((s) => search(base(s)));
  const reset = seeds.map((s) => search(base(s, { resetAfter: 5 })));
  assert.ok(anchored.every((r) => r.best.score === 50 && r.resets.length === 0), "stuck at 50, never resets");
  assert.ok(anchored.every((r) => r.evaluations === 60) && reset.every((r) => r.evaluations === 60), "the same budget");
  const past = reset.filter((r) => r.best.score > 50).length;
  assert.ok(past >= 18, `the reset climbs past the plateau on ${past} of 20 seeds`);
  assert.ok(reset.filter((r) => r.best.score >= 90).length >= 17, "and most of the way to the global peak");
  assert.ok(reset.every((r) => r.best.score >= 50), "a reset never ends below the signed artifact it restarted from");
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(mean(reset.map((r) => r.best.score)) > mean(anchored.map((r) => r.best.score)) + 30);
  // the trace is the best so far: it never falls
  for (const r of reset) assert.ok(r.trace.every((v, i) => i === 0 || v >= r.trace[i - 1]));
});

test("a reset keeps the signed best artifact and every gate-passed lesson, forgets the history, explores before it climbs, and is not flagged", () => {
  const r = search(base("run-0", { resetAfter: 5 }));
  assert.ok(r.resets.length >= 1);
  assert.ok(r.resets.every((x) => x.keptLessons.join() === "avoid-the-low-end,second-peak-above-60"));
  assert.ok(r.resets.every((x) => /^sha256:[0-9a-f]{64}$/.test(x.keptArtifact)));
  assert.equal(r.resets[0].keptArtifact, artifactHash(START), "the first reset restarts from the signed starting artifact");
  assert.deepEqual(r.flags, []);
  assert.equal(EXPLORE, 4);
  const quick = search(base("run-0", { resetAfter: 5, budget: 8 }));
  assert.equal(quick.resets.length, 1, "no gain for five cycles is a plateau; the reset comes at the sixth evaluation or after");
});

test("a reset that drops a gate-passed lesson is flagged for each lesson at each reset, and one that restarts from an artifact that is not the signed best is flagged", () => {
  const dropper = search(base("run-1", { resetAfter: 5, dropLessons: true }));
  assert.ok(dropper.resets.length >= 1);
  const dropped = dropper.flags.filter((f) => f.kind === "dropped_lesson");
  assert.equal(dropped.length, dropper.resets.length * 2, "both lessons, at every reset");
  assert.ok(dropped.some((f) => /avoid-the-low-end/.test(f.detail)) && dropped.some((f) => /second-peak-above-60/.test(f.detail)));
  assert.ok(dropper.resets.every((x) => x.keptLessons.length === 0));
  const forger = search(base("run-1", { resetAfter: 5, forgeArtifact: true }));
  assert.ok(forger.flags.some((f) => f.kind === "unsigned_artifact" && /not the signed best/.test(f.detail)));
  assert.deepEqual(search(base("run-1", { resetAfter: 5 })).flags, [], "the honest reset is clean on the same seed");
  assert.deepEqual(search(base("run-1", { resetAfter: 5 })), search(base("run-1", { resetAfter: 5 })), "the same seed gives the same search");
});
