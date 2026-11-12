// Society health (register row DK77): the measures and the three alarms, on simulated societies with a known shape. A seeded generator makes each run the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { societyHealth, healthFigure, type Activity, type HealthEvent } from "../src/society-health.ts";

const DAY = 86_400_000, T0 = Date.parse("2026-11-01T00:00:00Z");
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const KINDS = ["code", "data", "review", "writing"];

/** A simulated society: `agents` agents, `days` days; `shape(day)` says how many jobs, the kind weights and the base price that day. */
function simulate(days: number, agents: number, shape: (d: number) => { jobs: number; weights: number[]; price: number }, seed = 7): Activity[] {
  const r = rng(seed), out: Activity[] = [];
  for (let d = 0; d < days; d++) {
    const { jobs, weights, price } = shape(d), total = weights.reduce((a, b) => a + b, 0);
    for (let j = 0; j < jobs; j++) {
      let x = r() * total, k = 0; while (x >= weights[k]) { x -= weights[k]; k++; }
      out.push({ at: T0 + d * DAY + Math.floor(r() * DAY), agent: `agent-${Math.floor(r() * agents)}`, kind: KINDS[k], price: Math.round(price * (0.9 + r() * 0.2)) });
    }
  }
  return out;
}
const ids = (r: ReturnType<typeof societyHealth>) => r.alarms.map((a) => a.id);

test("DK77: a healthy society, whose mix and prices drift a little around events, raises no alarm", () => {
  const events: HealthEvent[] = [{ at: T0 + 9.5 * DAY, type: "price_shock" }, { at: T0 + 19.5 * DAY, type: "job_opening" }];
  const act = simulate(30, 20, (d) => ({ jobs: 12 + (d % 3), weights: d < 10 ? [4, 3, 2, 1] : d < 20 ? [3, 3, 2, 2] : [2, 3, 2, 3], price: d < 10 ? 100 : d < 20 ? 110 : 120 }));
  const r = societyHealth(act, events);
  assert.deepEqual(ids(r), []);
  assert.equal(r.periods.length, 30);
  assert.equal(r.events, 2);
  assert.ok(Math.abs(r.eventsPerPeriod - 2 / 30) < 1e-9);
  assert.match(healthFigure(r, "November"), /No alarm/);
});

test("DK77: a society that has gone quiet raises QUIET once activity stays below the floor for the stated number of periods, and not before", () => {
  const act = simulate(20, 10, (d) => ({ jobs: d < 14 ? 10 : 1, weights: [1, 1, 1, 1], price: 100 }));
  assert.deepEqual(ids(societyHealth(act, [], { until: T0 + 20 * DAY - 1 })).includes("QUIET"), true);
  const q = societyHealth(act, [], { until: T0 + 20 * DAY - 1 }).alarms.find((a) => a.id === "QUIET")!;
  assert.equal(q.periods, 6);
  assert.equal(q.since.slice(0, 10), "2026-11-15");
  // two quiet days at the end are below the stated three
  const brief = simulate(16, 10, (d) => ({ jobs: d < 14 ? 10 : 1, weights: [1, 1, 1, 1], price: 100 }));
  assert.ok(!ids(societyHealth(brief, [], { until: T0 + 16 * DAY - 1 })).includes("QUIET"));
  // a society with no activity at all, watched over a stated stretch, is quiet too
  assert.ok(ids(societyHealth([], [], { from: T0, until: T0 + 5 * DAY - 1 })).includes("QUIET"));
});

test("DK77: a society that changes too fast to learn from raises TOO_FAST: the mix flips every period", () => {
  const act = simulate(12, 10, (d) => ({ jobs: 20, weights: d % 2 ? [20, 0.01, 0.01, 0.01] : [0.01, 0.01, 0.01, 20], price: 100 }));
  const r = societyHealth(act);
  assert.ok(ids(r).includes("TOO_FAST"), JSON.stringify(r.alarms));
  assert.ok(r.periods.slice(1).every((p) => p.mixDrift! > 0.9));
  const price = simulate(10, 10, (d) => ({ jobs: 20, weights: [1, 1, 1, 1], price: d % 2 ? 100 : 400 }));
  assert.ok(ids(societyHealth(price)).includes("TOO_FAST"), "the price level jumping fourfold every period is too fast as well");
});

test("DK77: a society that is busy and never changes raises FROZEN; the same society with an event and a shift does not", () => {
  const flat = simulate(14, 10, () => ({ jobs: 400, weights: [1, 1, 1, 1], price: 100 }));
  assert.ok(ids(societyHealth(flat, [], { frozenMix: 0.1, frozenPrice: 0.1 })).includes("FROZEN"));
  const moving = simulate(14, 10, (d) => ({ jobs: 400, weights: d < 7 ? [1, 1, 1, 1] : [4, 1, 1, 1], price: d < 7 ? 100 : 160 }));
  assert.ok(!ids(societyHealth(moving, [{ at: T0 + 7 * DAY, type: "price_shock" }], { frozenMix: 0.1, frozenPrice: 0.1 })).includes("FROZEN"), "the run of unchanged periods is cut by the shift");
});

test("DK77: behaviour after an event is measured against the periods before it, and adaptation time per agent counts the periods to the first new kind of job", () => {
  // Days 0-4: every agent does only "code" at 100. An event at the start of day 5; from day 6 agents 0 and 1 also do "data" (agent 0 on day 6, agent 1 on day 8), at 150.
  const act: Activity[] = [];
  for (let d = 0; d < 12; d++) for (const a of [0, 1, 2]) act.push({ at: T0 + d * DAY + 3600_000 * (a + 1), agent: `agent-${a}`, kind: "code", price: d >= 6 ? 150 : 100 });
  act.push({ at: T0 + 6 * DAY + 7200_000, agent: "agent-0", kind: "data", price: 150 }, { at: T0 + 8 * DAY + 7200_000, agent: "agent-1", kind: "data", price: 150 });
  const r = societyHealth(act, [{ at: T0 + 5 * DAY + 60_000, type: "job_opening" }]);
  const e = r.afterEvents[0];
  assert.equal(e.period, 5);
  assert.ok(e.mixShift! > 0.05, "the mix moved after the event");
  assert.ok(e.priceShift! > 0.3, "the median price rose after the event");
  const ad = Object.fromEntries(r.adaptation.map((x) => [x.agent, x.periods]));
  assert.deepEqual(ad, { "agent-0": 1, "agent-1": 3, "agent-2": null });
  assert.ok(Math.abs(r.adaptedShare! - 2 / 3) < 1e-9);
});

test("DK77: the measures only read: the input is untouched, and a run with nothing in it reports nothing and no alarm without a stated stretch", () => {
  const act = simulate(5, 3, () => ({ jobs: 5, weights: [1, 1, 1, 1], price: 100 }));
  const copy = JSON.stringify(act);
  societyHealth(act);
  assert.equal(JSON.stringify(act), copy);
  const empty = societyHealth([]);
  assert.deepEqual([empty.periods.length, empty.jobs, empty.alarms.length, empty.adaptedShare], [0, 0, 0, null]);
});
