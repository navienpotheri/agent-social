// The journey's pure helpers (register rows DK1300, DK1301 and DK1347; found by a mutation check to be tested only through the slow page tests): the cap state at its exact edges, and the cognition list's order, counts and
// parsing. No log needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capFor, cognitionOf } from "../src/journey.ts";

test("capFor: the percent is rounded, the state is warn from the warning level and reached at 100, and a cap that is absent or zero says nothing", () => {
  const b = { dailyTokens: 1000, monthlyTokens: 10000, warnPercent: 80 };
  assert.equal(capFor({ today: 794, month: 0 }, b).state, "ok", "79 percent");
  assert.equal(capFor({ today: 800, month: 0 }, b).state, "warn", "exactly the warning level");
  assert.equal(capFor({ today: 994, month: 0 }, b).state, "warn", "99 percent");
  assert.equal(capFor({ today: 1000, month: 0 }, b).state, "reached", "exactly the cap");
  assert.equal(capFor({ today: 0, month: 10000 }, b).state, "reached", "the month's cap counts too");
  assert.equal(capFor({ today: 0, month: 8000 }, b).state, "warn");
  assert.deepEqual([capFor({ today: 333, month: 0 }, b).dayPercent, capFor({ today: 0, month: 0 }, b).monthPercent], [33, 0], "rounded to a whole percent");
  assert.equal(capFor({ today: 5, month: 5 }, { warnPercent: 50 }).state, "ok", "no cap, nothing to reach");
  assert.deepEqual([capFor({ today: 5, month: 5 }, { dailyTokens: 0 }).dayPercent], [null], "a cap of zero is no cap");
  assert.equal(capFor({ today: 5, month: 5 }, {}).warnPercent, 80, "the default warning level");
  assert.equal(capFor({ today: 500, month: 0 }, { dailyTokens: 1000, warnPercent: 50 }).state, "warn", "a chosen level");
});

test("cognitionOf: items are ordered by time then step, counted by category, a JSON body gives its category, step and text, and plain text stays text", () => {
  const items = [
    { at: "2026-11-02T00:00:00Z", kind: "goal", hash: "h3", content: "plain words" },
    { at: "2026-11-01T00:00:00Z", kind: "plan", hash: "h2", content: JSON.stringify({ step: 2, text: "second step" }) },
    { at: "2026-11-01T00:00:00Z", kind: "plan", hash: "h1", content: JSON.stringify({ step: 1, category: "reasoning", task: "first step", truncated: true }) },
    { at: "2026-11-03T00:00:00Z", kind: "no-such-kind", hash: "h4", content: JSON.stringify({ other: 1 }) },
    { at: "2026-11-04T00:00:00Z", kind: "goal", hash: "h5" },
  ] as never;
  const c = cognitionOf(items);
  assert.deepEqual(c.items.map((i) => i.hash), ["h1", "h2", "h3", "h4", "h5"], "by time, then by step");
  assert.equal(c.items[0].category, "reasoning", "the body's own category wins");
  assert.equal(c.items[0].text, "first step", "a task is the text");
  assert.equal(c.items[1].text, "second step");
  assert.equal(c.items[2].text, "plain words", "a body that is not JSON is the text");
  assert.equal(c.items[3].category, "other", "an unknown kind is other");
  assert.equal(c.items[3].text, JSON.stringify({ other: 1 }), "an object with no text is shown as JSON");
  assert.equal(c.items[4].text, null, "no content, no text");
  assert.equal(c.items[0].title, "Reasoning");
  assert.equal(c.counts.reasoning, 1);
  assert.equal(c.counts.other, 1);
  assert.equal(Object.values(c.counts).reduce((a, b) => a + b, 0), 5);
});
