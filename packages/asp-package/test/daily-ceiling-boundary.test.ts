// Boundary cases of the daily and monthly ceilings (mutation review, 2026-11-22): a ceiling is reached when the spend EQUALS it, not when it passes it, and the run that starts one token under it is told exactly how much
// is left. Exactly on the limit and one below, for tokens by day, tokens by month, wakes by day and wakes by sender.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailyCeiling } from "../src/index.ts";

const fresh = () => new DailyCeiling(join(mkdtempSync(join(tmpdir(), "ceil-")), "c.json"));
const A = "did:web:x:a";

test("a daily token ceiling: one token under it the run starts and is told 1 is left; exactly at it the wake is refused", () => {
  const c = fresh();
  c.addTokens(A, "2026-11-22", 9);
  const under = c.wake(A, "s", "2026-11-22", "t", { tokens: 10 });
  assert.equal(under.ok, true);
  assert.equal((under as { tokensLeft?: number }).tokensLeft, 1);
  c.addTokens(A, "2026-11-22", 1);
  const at = c.wake(A, "s", "2026-11-22", "t", { tokens: 10 });
  assert.equal(at.ok, false);
  assert.equal((at as { ceiling?: string }).ceiling, "daily_tokens");
  assert.equal(c.wake(A, "s", "2026-11-23", "t", { tokens: 10 }).ok, true, "the next UTC day starts again");
});

test("a monthly token cap counts across days: one under starts the run with the remainder, exactly at it refuses", () => {
  const c = fresh();
  c.addTokens(A, "2026-11-03", 60); c.addTokens(A, "2026-11-10", 39);
  const under = c.wake(A, "s", "2026-11-22", "t", { monthTokens: 100 });
  assert.equal(under.ok, true);
  assert.equal((under as { tokensLeft?: number }).tokensLeft, 1);
  c.addTokens(A, "2026-11-22", 1);
  const at = c.wake(A, "s", "2026-11-22", "t", { monthTokens: 100 });
  assert.equal(at.ok, false);
  assert.equal((at as { ceiling?: string }).ceiling, "monthly_tokens");
  assert.equal(c.wake(A, "s", "2026-12-01", "t", { monthTokens: 100 }).ok, true, "a new month starts again");
});

test("with both a daily and a monthly cap, the run is told the smaller remainder", () => {
  const c = fresh();
  c.addTokens(A, "2026-11-01", 50);
  const v = c.wake(A, "s", "2026-11-22", "t", { tokens: 40, monthTokens: 70 });
  assert.equal((v as { tokensLeft?: number }).tokensLeft, 20, "month has 20 left, the day has 40");
  const w = c.wake(A, "s", "2026-11-22", "t", { tokens: 15, monthTokens: 70 });
  assert.equal((w as { tokensLeft?: number }).tokensLeft, 15, "the day has 15 left, the month 20");
});

test("a daily wake ceiling of 2 allows two wakes and refuses the third; a per-sender ceiling of 2 refuses a sender's third and not another's", () => {
  const c = fresh();
  assert.equal(c.wake(A, "s", "2026-11-22", "t", { wakes: 2 }).ok, true);
  assert.equal(c.wake(A, "s", "2026-11-22", "t", { wakes: 2 }).ok, true);
  const third = c.wake(A, "s", "2026-11-22", "t", { wakes: 2 });
  assert.equal(third.ok, false);
  assert.equal((third as { ceiling?: string }).ceiling, "daily_wakes");
  const d = fresh();
  assert.equal(d.wake(A, "p", "2026-11-22", "t", { senderWakes: 2 }).ok, true);
  assert.equal(d.wake(A, "p", "2026-11-22", "t", { senderWakes: 2 }).ok, true);
  const p3 = d.wake(A, "p", "2026-11-22", "t", { senderWakes: 2 });
  assert.equal(p3.ok, false);
  assert.equal((p3 as { ceiling?: string }).ceiling, "sender_wakes");
  assert.equal(d.wake(A, "q", "2026-11-22", "t", { senderWakes: 2 }).ok, true, "another sender is not affected");
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
