// Row DK1380: the status page records the availability the enterprise terms state a target for (99.0 percent a calendar month), counted from the monitor's own checks, month by month,
// and says plainly what it is: the share of checks at which no critical component was down, not a service credit and not a guarantee.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AVAILABILITY_TARGET_PERCENT, availabilityOf, statusHtml, statusJson, step, type CheckResult, type MonitorState } from "../src/monitor.ts";

const up: CheckResult[] = [{ id: "service", title: "The service answers", critical: true, ok: true, detail: "ok", ms: 5 }];
const down: CheckResult[] = [{ id: "service", title: "The service answers", critical: true, ok: false, detail: "500", ms: 5 }];
const degraded: CheckResult[] = [...up, { id: "backup", title: "A backup exists", critical: false, ok: false, detail: "old", ms: 1 }];

test("each check counts toward its month; only a failed critical check counts as down", () => {
  let state: MonitorState = { checks: {} };
  const runs: [string, CheckResult[]][] = [["2026-11-30T23:00:00Z", up], ["2026-11-30T23:05:00Z", down], ["2026-11-30T23:10:00Z", degraded], ["2026-12-01T00:00:00Z", up]];
  for (const [at, r] of runs) state = step(state, r, at, 2).state;
  assert.deepEqual(state.availability, { "2026-11": { checks: 3, up: 2 }, "2026-12": { checks: 1, up: 1 } });
});

test("the status page states the month's availability against the 99.0 percent target and says what the figure is", () => {
  let state: MonitorState = { checks: {} };
  for (let i = 0; i < 200; i++) state = step(state, i === 7 ? down : up, `2026-11-21T${String(Math.floor(i / 12)).padStart(2, "0")}:${String((i % 12) * 5).padStart(2, "0")}:00Z`, 2).state;
  const a = availabilityOf(state.availability, "2026-11-21T20:00:00Z");
  assert.equal(a.target_percent, AVAILABILITY_TARGET_PERCENT);
  assert.deepEqual(a.months, [{ month: "2026-11", checks: 200, percent: 99.5 }]);
  const json = statusJson("operational", up, [], "2026-11-21T20:00:00Z", 300, state.availability);
  assert.equal(json.availability.months[0]!.percent, 99.5);
  const html = statusHtml(json);
  assert.match(html, /<h2>Availability<\/h2>/);
  assert.match(html, /99\.5%/);
  assert.match(html, /target 99% a month/);
  assert.match(html, /not a service credit and not a guarantee/);
  // A month below the target is shown as a warning, not hidden.
  const bad = availabilityOf({ "2026-11": { checks: 100, up: 95 } }, "2026-11-21T00:00:00Z");
  assert.match(statusHtml(statusJson("operational", up, [], "2026-11-21T00:00:00Z", 300, { "2026-11": { checks: 100, up: 95 } })), /class="warn">95%/);
  assert.equal(bad.months[0]!.percent, 95);
});
