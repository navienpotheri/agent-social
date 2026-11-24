// G1: the day cycle compressed. A simulated day of any length (dayMs): the scheduled events come round at the same hours of it; an event that is on is shown once, as one true line, to an agent that has not been to it; attendance is counted per event for the report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY, renderDayCycle, scheduleBetween } from "../src/cohort/day-cycle.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("a compressed day schedules the same events at the same hours of a shorter day", () => {
  const long = scheduleBetween(0, 2 * DAY).map((e) => `${e.id}@${(e.at % DAY) / DAY}`), short = scheduleBetween(0, 2 * 8 * 60_000, { dayMs: 8 * 60_000 }).map((e) => `${e.id}@${(e.at % (8 * 60_000)) / (8 * 60_000)}`);
  assert.deepEqual(short, long);
});
test("an event that is on is shown once to an agent that has not been to it; attendance is counted and reported", async () => {
  const dayMs = 8 * 60_000;
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-dayc-")), dayCycle: true, dayMs });
  try {
    const d = w.api.dayCycle!; let t = 0; d.now = () => t;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, n: string, i: Record<string, unknown> = {}) => runTool(w.api, who, all, n, i);
    t = dayMs * (9 / 24) + 1000; // just after the market hour of day 1
    const r = (await call(a, "look_jobs")).text;
    assert.doesNotMatch(r, /On now: /, "an agent that went to the board is not told of it");
    const seen = (await call(b, "my_balance")).text;
    assert.match(seen, /On now: The market hour of day 1 has begun/);
    assert.doesNotMatch((await call(b, "my_balance")).text, /On now: /, "once");
    t = dayMs * 3; // later: the event is no longer on
    assert.doesNotMatch((await call(b, "my_inbox")).text, /On now: The market hour of day 1/);
    const rep = renderDayCycle(d, []);
    assert.match(rep, /\| market hour \| \d+ \| 1 \| 1 \|/);
  } finally { await w.close(); }
});
