import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain JavaScript with no types
import { decide, decideB, fisherOneSided } from "../../../evals/learning/decide.mjs";

const rs = (xs: number[], n = 8) => xs.map((passes, round) => ({ round, passes, n }));
const ok = { reliability: { ok: 90, n: 100 }, share: { learner: { ok: 30, n: 40 }, static: { ok: 36, n: 40 } } };

test("the one-sided Fisher test gives known values", () => {
  assert.ok(Math.abs(fisherOneSided(3, 3, 0, 3) - 0.05) < 1e-9, "3 of 3 against 0 of 3: p = 1/20");
  assert.ok(fisherOneSided(0, 5, 5, 5) > 0.999999, "the first group doing worse is never evidence for it");
  assert.ok(fisherOneSided(24, 48, 24, 48) > 0.5, "equal groups: p about one half");
  assert.ok(fisherOneSided(20, 48, 4, 48) < 0.001, "a big difference is far below 0.05");
});

test("a clear gap at the first reading, a clear nothing, and the middle band that extends the run", () => {
  const base = { round: 5, final: false, ...ok };
  const gap = decide({ ...base, learner: rs([0, 0, 1, 3, 5, 6]), static: rs([0, 0, 0, 1, 0, 1]), floorLearner: 250, floorStatic: 400 });
  assert.equal(gap.status, "gap");
  const none = decide({ ...base, learner: rs([0, 0, 0, 1, 1, 1]), static: rs([0, 0, 0, 0, 1, 1]), floorLearner: 400, floorStatic: 400 });
  assert.equal(none.status, "nogap");
  const middle = decide({ ...base, learner: rs([0, 0, 1, 2, 3, 3]), static: rs([0, 0, 0, 0, 1, 1]), floorLearner: 350, floorStatic: 400 });
  assert.equal(middle.status, "middle", middle.why);
  // A big pass-rate gap without the floor 100 permille lower is also the middle band, not a gap.
  assert.equal(decide({ ...base, learner: rs([0, 0, 1, 3, 5, 6]), static: rs([0, 0, 0, 1, 0, 1]), floorLearner: 350, floorStatic: 400 }).status, "middle");
  // And a Static agent that improved by itself is no gap for the Learner to claim.
  assert.equal(decide({ ...base, learner: rs([0, 0, 1, 3, 5, 6]), static: rs([0, 1, 2, 3, 4, 3]), floorLearner: 250, floorStatic: 400 }).status, "middle");
});

test("at the final round the pooled test decides: a gap or no measurable gap, never a middle", () => {
  const base = { round: 8, final: true, ...ok, floorLearner: 300, floorStatic: 400 };
  const gap = decide({ ...base, learner: rs([0, 0, 1, 2, 3, 4, 5, 5, 6]), static: rs([0, 0, 0, 1, 0, 1, 1, 0, 1]) });
  assert.equal(gap.status, "gap", gap.why);
  const none = decide({ ...base, learner: rs([0, 0, 1, 1, 2, 1, 2, 1, 2]), static: rs([0, 0, 1, 1, 1, 2, 1, 2, 1]) });
  assert.equal(none.status, "nogap", none.why);
  assert.match(none.why, /no measurable gap at this size/);
});

test("an instrument that was not equal for the two agents gives no result, never a finding", () => {
  const base = { round: 5, final: false, learner: rs([0, 0, 1, 3, 5, 6]), static: rs([0, 0, 0, 1, 0, 1]), floorLearner: 250, floorStatic: 400 };
  assert.equal(decide({ ...base, reliability: { ok: 70, n: 100 }, share: ok.share }).status, "invalid");
  const unequal = decide({ ...base, reliability: ok.reliability, share: { learner: { ok: 12, n: 40 }, static: { ok: 36, n: 40 } } });
  assert.equal(unequal.status, "invalid");
  assert.match(unequal.why, /not equally able to write working files/);
  assert.equal(decide({ ...base, round: 7, reliability: ok.reliability, share: ok.share }).status, "invalid", "a missing reading is not a result");
});

test("a Learner whose lessons are placeholders is an invalid run, never a finding", () => {
  const base = { round: 5, final: false, learner: rs([0, 0, 1, 3, 5, 6]), static: rs([0, 0, 0, 1, 0, 1]), floorLearner: 250, floorStatic: 400, ...ok };
  const bad = decide({ ...base, lessons: { n: 4, placeholder: 4 } });
  assert.equal(bad.status, "invalid");
  assert.match(bad.why, /placeholders, not lessons/);
  assert.equal(decide({ ...base, lessons: { n: 4, placeholder: 0 } }).status, "gap");
});

test("Stage B: the floor holds only if both gaming agents are priced at least 50 permille above the Learner", () => {
  const readings = { learner: rs([0, 1, 2, 5, 6, 7]), careless: rs([0, 0, 1, 2, 2, 3]), overfitter: rs([0, 0, 0, 1, 1, 1]) };
  const base = { round: 5, readings, share: { careless: { ok: 40, n: 48 }, overfitter: { ok: 40, n: 48 } }, lessons: { careless: { n: 5, placeholder: 0 }, overfitter: { n: 5, placeholder: 0 } } };
  assert.equal(decideB({ ...base, floors: { learner: 240, careless: 330, overfitter: 400 } }).status, "holds");
  assert.equal(decideB({ ...base, floors: { learner: 240, careless: 260, overfitter: 400 } }).status, "gameable");
  assert.equal(decideB({ ...base, floors: { learner: 240, careless: 330, overfitter: 200 } }).status, "gameable");
  assert.equal(decideB({ ...base, floors: { learner: 240, careless: 330, overfitter: 400 }, lessons: { careless: { n: 5, placeholder: 1 }, overfitter: { n: 5, placeholder: 0 } } }).status, "invalid");
  assert.equal(decideB({ ...base, floors: { learner: 240, careless: 330, overfitter: 400 }, share: { careless: { ok: 10, n: 48 }, overfitter: { ok: 40, n: 48 } } }).status, "invalid");
});
