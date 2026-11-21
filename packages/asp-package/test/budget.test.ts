// Row US2 (spec-delta S1454): a standing budget for each agent. The caps are validated and kept in a file, the guard counts tokens in the UTC month as well as the day and refuses with the cap named, a run is capped to what
// is left of the smaller cap, the month resets, and the warnings say what is near and what is reached. Fake agents only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Budgets, DailyCeiling, budgetWarnings, monthProjection } from "../src/index.ts";

const A = "did:web:example.com:agents:coder";
const dir = () => mkdtempSync(join(tmpdir(), "asp-budget-"));

test("a budget is set once, kept in a file, changed field by field, and cleared with null; a field left out is unchanged", () => {
  const file = join(dir(), "budgets.json");
  const b = new Budgets(file);
  assert.deepEqual(b.get(A), {});
  assert.deepEqual(b.set(A, { dailyTokens: 1000, monthlyTokens: 20000 }), { dailyTokens: 1000, monthlyTokens: 20000 });
  assert.deepEqual(b.set(A, { warnPercent: 90 }), { dailyTokens: 1000, monthlyTokens: 20000, warnPercent: 90 });
  assert.deepEqual(new Budgets(file).get(A), { dailyTokens: 1000, monthlyTokens: 20000, warnPercent: 90 }, "kept across a restart");
  assert.deepEqual(b.set(A, { dailyTokens: null }), { monthlyTokens: 20000, warnPercent: 90 });
  b.set(A, { monthlyTokens: null, warnPercent: null });
  assert.deepEqual(b.all(), {}, "an agent with nothing set is not listed");
});

test("nonsense is refused and changes nothing: not a whole number, below 1, a warning level outside 1 to 99, a daily cap above the monthly cap", () => {
  const b = new Budgets(join(dir(), "budgets.json"));
  b.set(A, { dailyTokens: 100, monthlyTokens: 1000 });
  for (const bad of [{ dailyTokens: 0 }, { dailyTokens: -5 }, { dailyTokens: 1.5 }, { monthlyTokens: NaN }, { warnPercent: 100 }, { warnPercent: 0 }]) assert.throws(() => b.set(A, bad), /whole number|percent/, JSON.stringify(bad));
  assert.throws(() => b.set(A, { dailyTokens: 2000 }), /above the monthly cap of 1000/);
  assert.throws(() => b.set(A, { monthlyTokens: 50 }), /above the monthly cap of 50/);
  assert.deepEqual(b.get(A), { dailyTokens: 100, monthlyTokens: 1000 }, "nothing changed");
});

test("a damaged budgets file starts empty rather than failing a run", () => {
  const file = join(dir(), "budgets.json");
  writeFileSync(file, "{not json");
  assert.deepEqual(new Budgets(file).all(), {});
});

test("the guard counts tokens in the month, refuses a run at the monthly cap with the cap named, caps a run to the smaller of what is left, and resets the next month", () => {
  const c = new DailyCeiling(join(dir(), "wakes.json"));
  const limits = { tokens: 60, monthTokens: 100 };
  const day = (d: string) => `2026-11-${d}`;
  const run = (d: string, tokens: number) => { const v = c.wake(A, "me", day(d), `${day(d)}T10:00:00Z`, limits); if (v.ok) c.addTokens(A, day(d), tokens); return v; };
  assert.deepEqual(run("01", 50), { ok: true, tokensLeft: 60 }, "the day has 60 and the month 100: 60 is the smaller");
  assert.deepEqual(run("02", 50), { ok: true, tokensLeft: 50 }, "the day has 60 but the month has 50 left: a run is capped to 50");
  const third = c.wake(A, "me", day("03"), `${day("03")}T10:00:00Z`, limits);
  assert.equal(third.ok, false);
  if (!third.ok) {
    assert.equal(third.ceiling, "monthly_tokens");
    assert.match(third.reason, /monthly token cap for did:web:example\.com:agents:coder is 100 and 100 are spent in 2026-11 \(UTC\).*asp budget set --agent .* --monthly-tokens <n>/);
  }
  assert.equal(c.monthTokens(A, "2026-11"), 100);
  // the next month starts at zero
  assert.deepEqual(c.wake(A, "me", "2026-12-01", "2026-12-01T10:00:00Z", limits), { ok: true, tokensLeft: 60 });
  assert.equal(c.monthTokens(A, "2026-12"), 0);
  // what is counted is kept across a restart
  assert.equal(new DailyCeiling(join(dir(), "none.json")).monthTokens(A, "2026-11"), 0);
});

test("the month tally survives a restart and an old file with no months is read as zero", () => {
  const file = join(dir(), "wakes.json");
  const c = new DailyCeiling(file);
  c.addTokens(A, "2026-11-05", 40); c.addTokens(A, "2026-11-20", 2);
  assert.equal(new DailyCeiling(file).monthTokens(A, "2026-11"), 42);
  const old = join(dir(), "old.json");
  writeFileSync(old, JSON.stringify({ days: { "2026-11-05": { [A]: { tokens: 9, wakes: [] } } } }));
  const o = new DailyCeiling(old);
  assert.equal(o.monthTokens(A, "2026-11"), 0, "an earlier file has no month tally");
  o.addTokens(A, "2026-11-06", 3);
  assert.equal(o.monthTokens(A, "2026-11"), 3);
  assert.ok(readFileSync(old, "utf8").includes("months"));
});

test("only the last 13 months of tally are kept", () => {
  const c = new DailyCeiling(join(dir(), "wakes.json"));
  for (let m = 1; m <= 12; m++) c.addTokens(A, `2025-${String(m).padStart(2, "0")}-01`, 1);
  for (let m = 1; m <= 3; m++) c.addTokens(A, `2026-${String(m).padStart(2, "0")}-01`, 1);
  assert.equal(c.monthTokens(A, "2025-01"), 0, "older than 13 months is gone");
  assert.equal(c.monthTokens(A, "2025-03"), 1);
  assert.equal(c.monthTokens(A, "2026-03"), 1);
});

test("warnings: nothing below the level, a sentence at or above it, a different sentence when the cap is reached, and the level is the person's", () => {
  assert.deepEqual(budgetWarnings(A, { dailyTokens: 1000, monthlyTokens: 10000 }, { today: 799, month: 7999 }), []);
  const near = budgetWarnings(A, { dailyTokens: 1000, monthlyTokens: 10000 }, { today: 800, month: 100 });
  assert.equal(near.length, 1);
  assert.match(near[0], /has used 80% of its daily cap: 800 of 1000 tokens, 200 left \(warning level 80%/);
  const both = budgetWarnings(A, { dailyTokens: 1000, monthlyTokens: 10000 }, { today: 1000, month: 9500 });
  assert.match(both[0], /has reached its daily cap: 1000 of 1000 tokens \(100%\); further runs are refused/);
  assert.match(both[1], /95% of its monthly cap/);
  assert.deepEqual(budgetWarnings(A, { dailyTokens: 1000, warnPercent: 50 }, { today: 500, month: 0 }).length, 1);
  assert.deepEqual(budgetWarnings(A, {}, { today: 99999, month: 99999 }), [], "no cap, no warning");
});

test("the projection says where the month is heading at the pace so far, and whether that is over the cap", () => {
  assert.deepEqual(monthProjection(1000, 10, 30, 2000), { projected: 3000, over: true });
  assert.deepEqual(monthProjection(1000, 10, 30, 3000), { projected: 3000, over: false });
  assert.deepEqual(monthProjection(500, 15, 30), { projected: 1000, over: false }, "no cap, never over");
  assert.deepEqual(monthProjection(0, 1, 31, 10), { projected: 0, over: false });
});
