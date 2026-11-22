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
