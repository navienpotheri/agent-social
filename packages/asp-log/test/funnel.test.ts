// The measured front door (register row DK838; spec-delta S1211): anonymous counters for each step from the start page to the first return, by source, and a drop-off view. A scripted agent that stops at each step moves
// exactly the matching counters once; the counters hold no personal text; the drop-off view orders the steps correctly. Scripted visitors; no real traffic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Funnel, STEPS, type Step } from "../src/funnel.ts";

const DAY = "2026-12-01";
/** A scripted agent that walks the first `n` steps and stops. */
const walk = (f: Funnel, key: string, n: number, source = "llms-txt", day = DAY) => STEPS.slice(0, n).forEach((s) => f.record(s, source, key, day));

test("a scripted agent that stops at each step moves exactly the counters up to that step, once each, and none after it", () => {
  for (let n = 1; n <= STEPS.length; n++) {
    const f = new Funnel();
    walk(f, `agent-${n}`, n);
    assert.deepEqual(STEPS.map((s) => f.count(s)), STEPS.map((_, i) => (i < n ? 1 : 0)), `stopping after step ${n}`);
  }
  const f = new Funnel();
  walk(f, "a", 3); walk(f, "a", 3); walk(f, "a", 3);
  assert.deepEqual(STEPS.map((s) => f.count(s)), [1, 1, 1, 0, 0, 0], "repeating a step does not count again");
  assert.equal(f.record("enrolled", "llms-txt", "a", DAY), false);
  assert.equal(f.record("first_act", "llms-txt", "someone-else", DAY), true);
});

test("counters are by source: the same step for two sources is two counts, and a source's own view is its own", () => {
  const f = new Funnel();
  walk(f, "a", 2, "llms-txt"); walk(f, "b", 2, "mcp-registry"); walk(f, "c", 1, "mcp-registry");
  assert.equal(f.count("start_page_read"), 3); assert.equal(f.count("start_page_read", "mcp-registry"), 2); assert.equal(f.count("enrolled", "mcp-registry"), 1);
  assert.deepEqual(f.sources(), ["llms-txt", "mcp-registry"]);
  assert.deepEqual(f.dropOff("llms-txt").map((r) => r.visitors), [1, 1, 0, 0, 0, 0]);
});

test("the drop-off view orders the steps correctly, gives the share of the first step and of the step before, counts what was lost, and names the worst step", () => {
  const f = new Funnel();
  // 10 read the page; 8 enrol; 6 act; 3 start a lesson; 2 pass it; 1 returns.
  [10, 8, 6, 3, 2, 1].forEach((n, i) => { for (let v = 0; v < n; v++) f.record(STEPS[i], "llms-txt", `v${v}`, DAY); });
  const rows = f.dropOff();
  assert.deepEqual(rows.map((r) => r.step), [...STEPS], "in the order of the walk");
  assert.deepEqual(rows.map((r) => r.visitors), [10, 8, 6, 3, 2, 1]);
  assert.deepEqual(rows.map((r) => r.ofFirstPermille), [1000, 800, 600, 300, 200, 100]);
  assert.deepEqual(rows.map((r) => r.ofPreviousPermille), [1000, 800, 750, 500, 667, 500]);
  assert.deepEqual(rows.map((r) => r.lost), [0, 2, 2, 3, 1, 1]);
  assert.deepEqual(f.worstStep(), { step: "free_lesson_started", lost: 3 });
  assert.equal(new Funnel().worstStep(), null, "no traffic, no worst step");
});

test("the counters hold no personal text: a source is a short label and not free text, a visitor is a daily hash and never stored raw, the snapshot is counts only, and the same key is another visitor on another day", () => {
  const f = new Funnel();
  assert.throws(() => f.record("enrolled", "Jane Doe, jane@example.com", "k", DAY), /not text/);
  assert.throws(() => f.record("enrolled", "x".repeat(30), "k", DAY), /not text/);
  assert.throws(() => f.record("hacked" as Step, "ok", "k", DAY), /not a funnel step/);
  f.record("start_page_read", "llms-txt", "jane@example.com", DAY);
  const text = JSON.stringify(f.snapshot()) + JSON.stringify(f.dropOff()) + JSON.stringify(f.sources());
  assert.ok(!text.includes("jane"), "the opaque key is nowhere in what the counters hold");
  assert.deepEqual(f.snapshot(), [{ step: "start_page_read", source: "llms-txt", visitors: 1 }]);
  assert.notEqual(f.visitor("k", "2026-12-01"), f.visitor("k", "2026-12-02"), "another day, another visitor: a daily salt");
  assert.equal(f.visitor("k", "2026-12-01"), f.visitor("k", "2026-12-01"));
  f.record("start_page_read", "llms-txt", "jane@example.com", "2026-12-02");
  assert.equal(f.count("start_page_read"), 2, "a visitor who returns another day is counted as a new visitor at the page: the funnel measures days, not people");
  assert.match(f.visitor("k", DAY), /^[0-9a-f]{16}$/);
});
