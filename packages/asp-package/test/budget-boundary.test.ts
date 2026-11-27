// Boundary cases of the standing budget's warnings (mutation review, 2026-11-22): the warning starts at the warning level exactly, not a token before; the cap is reached when the tokens equal it; the percentage is
// rounded down, so 79.9 percent is not a warning at level 80; a day and a month are judged apart. Fake agent name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetWarnings, DEFAULT_WARN_PERCENT } from "../src/index.ts";

const A = "did:web:example.com:agents:coder";
const w = (b: Parameters<typeof budgetWarnings>[1], today: number, month = 0) => budgetWarnings(A, b, { today, month });

test("the default warning level is 80 and the warning starts at exactly 80 percent, not at 79", () => {
  assert.equal(DEFAULT_WARN_PERCENT, 80);
  assert.deepEqual(w({ dailyTokens: 100 }, 79), []);
  const at = w({ dailyTokens: 100 }, 80);
  assert.equal(at.length, 1);
  assert.match(at[0], /used 80% of its daily cap: 80 of 100 tokens, 20 left/);
});

test("the percentage rounds down: 79.99 percent is under the level, and one token under the cap is a warning that is not yet the cap", () => {
  assert.deepEqual(w({ dailyTokens: 10_000 }, 7_999), [], "79.99 percent");
  assert.equal(w({ dailyTokens: 10_000 }, 8_000).length, 1);
  const one = w({ dailyTokens: 100 }, 99);
  assert.match(one[0], /used 99% of its daily cap/);
  assert.doesNotMatch(one[0], /has reached/);
  const at = w({ dailyTokens: 100 }, 100);
  assert.match(at[0], /has reached its daily cap: 100 of 100 tokens \(100%\)/);
  assert.match(w({ dailyTokens: 100 }, 101)[0], /has reached its daily cap/);
});

test("a stated warning level is used exactly, and a day and a month are judged apart", () => {
  assert.deepEqual(w({ dailyTokens: 100, warnPercent: 50 }, 49), []);
  assert.equal(w({ dailyTokens: 100, warnPercent: 50 }, 50).length, 1);
  assert.deepEqual(w({ dailyTokens: 100 }, 0, 0), []);
  const both = w({ dailyTokens: 100, monthlyTokens: 1000 }, 80, 900);
  assert.equal(both.length, 2);
  assert.match(both[0], /daily/);
  assert.match(both[1], /monthly/);
  assert.equal(w({ monthlyTokens: 1000 }, 999, 799).length, 0, "the day has no cap; the month is at 79 percent");
  assert.deepEqual(w({}, 1_000_000, 1_000_000), [], "no cap, no warning");
});
