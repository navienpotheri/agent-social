// The spend guard's edges (register row DK1715; found loose by a mutation check): the Mandate's daily budget lowers the day's ceiling and never raises it, a fractional figure is cut to whole tokens, and a figure below one is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DAY_TOKENS, ceilingsFor } from "../src/spend-guard.ts";

test("the Mandate's daily budget lowers the day's ceiling with a line saying so, and a larger one changes nothing", () => {
  const low = ceilingsFor({}, {}, { per_day: 5000 });
  assert.equal(low.perDay, 5000);
  assert.ok(low.clamped.some((l) => /token budget for one day is 5000/.test(l)));
  const high = ceilingsFor({}, {}, { per_day: DEFAULT_DAY_TOKENS * 2 });
  assert.equal(high.perDay, DEFAULT_DAY_TOKENS, "a budget above the ceiling is not a raise");
  assert.deepEqual(high.clamped, []);
});

test("a fractional figure is cut to whole tokens, and a figure below one or not a number is refused by name", () => {
  assert.equal(ceilingsFor({ "token-cap": "1234.9" }).perRun, 1234);
  assert.throws(() => ceilingsFor({ "token-cap": "0" }), /--token-cap is a whole number of tokens, at least 1/);
  assert.throws(() => ceilingsFor({ "daily-tokens": "lots" }), /--daily-tokens/);
  assert.throws(() => ceilingsFor({}, { ASP_MAX_RUN_TOKENS: "-5" }), /ASP_MAX_RUN_TOKENS/);
});
