// The intake record's edges (register rows DK1750 and DK1751; found loose by a mutation check: nine of nineteen mutants survived): the shortest claim, falsifier and measure, a smallest effect or deviation of zero, the looks'
// minimum and order, the retention days, the retention floor's range and the kill rule's regression limit; and the effect's z when the error is zero. Built from the real evals intake with one field changed at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectOf, evalsIntake, intakeProblems, type Intake } from "../src/lens-loop.ts";

const courses = [{ id: "C-L11-1" }];
const base = evalsIntake();
const withPrereg = (over: Record<string, unknown>): Intake => ({ ...base, prereg: { ...base.prereg, ...over } as never });
const problems = (i: Intake) => intakeProblems(i, courses);

test("the real intake is clean, and each text field has its own shortest length", () => {
  assert.deepEqual(problems(base), []);
  const pad = (n: number) => "x".repeat(n);
  assert.ok(problems({ ...base, claim: pad(39) }).some((p) => /^claim .* at least 40/.test(p)), "a claim of 39");
  assert.ok(!problems({ ...base, claim: pad(40) }).some((p) => /^claim /.test(p)), "40 is enough");
  assert.ok(problems({ ...base, falsifier: pad(29) }).some((p) => /^falsifier .* at least 30/.test(p)));
  assert.ok(!problems({ ...base, falsifier: pad(30) }).some((p) => /^falsifier /.test(p)));
  assert.ok(problems({ ...base, measure: pad(19) }).some((p) => /^measure .* at least 20/.test(p)));
  assert.ok(!problems({ ...base, measure: pad(20) }).some((p) => /^measure /.test(p)));
});

test("the plan's numbers: effect and deviation above zero, looks of at least 4 and strictly ascending, retention days ascending, the floor in 0 to 1000, the kill limit named", () => {
  assert.ok(problems(withPrereg({ min_effect_permille: 0 })).some((p) => /smallest effect/.test(p)));
  assert.ok(problems(withPrereg({ sd_permille: 0 })).some((p) => /standard deviation/.test(p)));
  assert.ok(problems(withPrereg({ looks: [3, 10] })).some((p) => /looks are ascending/.test(p)), "a look of 3");
  assert.ok(!problems(withPrereg({ looks: [4, 10] })).some((p) => /looks are ascending/.test(p)), "a look of 4");
  assert.ok(problems(withPrereg({ looks: [10, 10] })).some((p) => /looks are ascending/.test(p)), "the same look twice is not ascending");
  assert.ok(problems(withPrereg({ looks: [] })).some((p) => /looks are ascending/.test(p)));
  assert.ok(problems(withPrereg({ retention_days: [7, 7] })).some((p) => /retention days ascend/.test(p)), "equal days do not ascend");
  assert.ok(problems(withPrereg({ retention_floor_permille: 1001 })).some((p) => /retention floor/.test(p)), "above 1000");
  assert.ok(problems(withPrereg({ retention_floor_permille: -1 })).some((p) => /retention floor/.test(p)), "below 0");
  assert.ok(!problems(withPrereg({ retention_floor_permille: 1000 })).some((p) => /retention floor/.test(p)), "1000 is allowed");
  assert.ok(problems(withPrereg({ kill: { lift_below_permille: 0 } })).some((p) => /kill rule/.test(p)), "no regression limit");
});

test("the effect: with no spread the z is zero for no difference and 99 in the direction of one; one agent has no spread", () => {
  assert.equal(effectOf([10, 10], [10, 10], 2, 50).z, 0);
  assert.equal(effectOf([20, 20], [10, 10], 2, 50).z, 99);
  assert.equal(effectOf([5, 5], [10, 10], 2, 50).z, -99);
  assert.equal(effectOf([20], [10, 10], 2, 50).se, 0, "one agent in an arm has no standard deviation, so no error from that arm");
  const e = effectOf([12, 14, 16], [8, 10, 12], 2, 50);
  assert.equal(e.difference, 4);
  assert.ok(e.se > 0 && e.z > 0);
});
