// Rows DK8, DK1476, DK1769 (mutation check, launch-bar-2, 2026-11-22): a ceiling is reached when the tokens spent EQUAL it, not only when they pass it. The older tests used figures well past the cap,
// so changing ">=" to ">" in the guard went unnoticed. These cases sit exactly on, one below and one above each token ceiling. Fake agent names; a temporary file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailyCeiling } from "../src/daily-ceiling.ts";

const A = "did:web:example.com:agents:coder";
const DAY = "2026-11-22";

function ceiling() { return new DailyCeiling(join(mkdtempSync(join(tmpdir(), "ceil-")), "ceilings.json")); }

test("the daily token ceiling refuses when the tokens spent equal it, and not one token earlier", () => {
  const c = ceiling();
  c.addTokens(A, DAY, 99);
  assert.equal(c.wake(A, "x", DAY, "t1", { tokens: 100 }).ok, true, "99 of 100 is under the ceiling");
  c.addTokens(A, DAY, 1);
  const v = c.wake(A, "x", DAY, "t2", { tokens: 100 });
  assert.equal(v.ok, false, "100 of 100 is the ceiling");
  assert.equal(!v.ok && v.ceiling, "daily_tokens");
});

test("the monthly token cap refuses when the tokens of the month equal it, and not one token earlier", () => {
  const c = ceiling();
  c.addTokens(A, DAY, 29);
  assert.equal(c.wake(A, "x", DAY, "t1", { monthTokens: 30 }).ok, true, "29 of 30 is under the cap");
  c.addTokens(A, DAY, 1);
  const v = c.wake(A, "x", DAY, "t2", { monthTokens: 30 });
  assert.equal(v.ok, false, "30 of 30 is the cap");
  assert.equal(!v.ok && v.ceiling, "monthly_tokens");
  assert.equal(c.wake(A, "x", "2026-12-01", "t3", { monthTokens: 30 }).ok, true, "a new month starts from zero");
});

test("DK827: a wake is capped to the most tokens one wake may spend, or to what is left of the day if that is less; no cap leaves it as it was", () => {
  const c = ceiling();
  const v = c.wake(A, "x", DAY, "t1", { wakeTokens: 40 });
  assert.deepEqual([v.ok, v.ok && v.tokensLeft], [true, 40], "a per-wake cap alone");
  c.addTokens(A, DAY, 90);
  const w = c.wake(A, "x", DAY, "t2", { wakeTokens: 40, tokens: 100 });
  assert.deepEqual([w.ok, w.ok && w.tokensLeft], [true, 10], "10 left of the day is less than 40");
  const x = c.wake(A, "x", DAY, "t3", { wakeTokens: 5, tokens: 1000 });
  assert.deepEqual([x.ok, x.ok && x.tokensLeft], [true, 5], "the per-wake cap is the smaller");
  assert.equal((c.wake(A, "x", DAY, "t4", {}) as { tokensLeft?: number }).tokensLeft, undefined, "no limit named: no cap");
});

test("DK827: a wake whose run spent no tokens is counted as idle and leaves the day's tokens unchanged; a wake that spent some is not idle; the report counts both", () => {
  const c = ceiling();
  c.wake(A, "heartbeat", DAY, "t1", {});
  c.addTokens(A, DAY, 0);
  c.wake(A, "heartbeat", DAY, "t2", {});
  c.addTokens(A, DAY, 12);
  c.wake(A, "heartbeat", DAY, "t3", {});
  c.addTokens(A, DAY, 0);
  const row = c.report(A)[0];
  assert.deepEqual([row.wakes, row.idle, row.tokens], [3, 2, 12], "three wakes, two of them idle, 12 tokens in all");
  assert.equal(c.tokensUsed(A, DAY), 12, "an idle heartbeat adds nothing to the balance");
  // an idle run does not mark a refused wake
  const d = ceiling();
  d.wake(A, "x", DAY, "t1", { wakes: 1 });
  d.wake(A, "x", DAY, "t2", { wakes: 1 });
  d.addTokens(A, DAY, 0);
  assert.deepEqual([d.report(A)[0].wakes, d.report(A)[0].idle, d.report(A)[0].refused], [1, 1, 1]);
});
