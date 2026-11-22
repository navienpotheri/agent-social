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
