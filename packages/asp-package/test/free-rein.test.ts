/**
 * The free-rein calculator (register row DK836; spec-delta S1204): the inequality "gain > chance of harm x residual damage + monitoring + tokens" filled from the record, as an interval that is wide for a new agent;
 * three scripted agents give ordered break-even results; the numbers equal a hand calculation; and nothing here changes a Mandate (it returns an unsigned proposal for the sponsor to sign). Mock credits.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as freeRein from "../src/free-rein.ts";
import { LADDER, MIN_CLEAN_JOBS_FOR_WIDENING, orderByBreakEven, renderPanel, residualDamageAt, wilson } from "../src/free-rein.ts";

const mandate = { cap: 50, residualDamage: 20 };
const sponsor = { gain: 25, monitoring: 5, tokens: 10 };
const agents = {
  steady: { cleanJobs: 50, refusedCalls: 0, incidents: 0 },     // clean for 50 jobs
  newcomer: { cleanJobs: 2, refusedCalls: 0, incidents: 0 },    // clean for 2 jobs
  prober: { cleanJobs: 20, refusedCalls: 10, incidents: 0 },    // 10 refused calls
};
const panels = Object.entries(agents).map(([name, e]) => ({ name, panel: freeRein.freeRein(e, mandate, sponsor) }));
const by = Object.fromEntries(panels.map((p) => [p.name, p.panel]));

test("the numbers equal a hand calculation: the Wilson interval at 95%, the cost at its high end, and the margin", () => {
  // steady: no events in 50 jobs, so the upper bound is z^2 / (n + z^2).
  const hiSteady = 1.96 ** 2 / (50 + 1.96 ** 2);
  assert.equal(by.steady.harm.hi, Math.round(hiSteady * 1e4) / 1e4);
  assert.equal(by.steady.cost.hi, Math.round((hiSteady * 20 + 15) * 10) / 10);
  assert.equal(by.steady.margin.worst, Math.round((25 - (hiSteady * 20 + 15)) * 10) / 10);
  assert.equal(by.steady.margin.worst, 8.6);
  // newcomer: two jobs, upper bound z^2 / (2 + z^2).
  assert.equal(by.newcomer.harm.hi, Math.round((1.96 ** 2 / (2 + 1.96 ** 2)) * 1e4) / 1e4);
  assert.equal(by.newcomer.margin.worst, -3.2);
  // prober: 10 refused calls count a quarter each (2.5 events in 20 jobs): p = 0.125, interval from the closed form.
  const z2 = 1.96 ** 2, n = 20, p = 2.5 / 20, denom = 1 + z2 / n, centre = (p + z2 / (2 * n)) / denom, half = (1.96 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  assert.equal(by.prober.harm.hi, Math.round((centre + half) * 1e4) / 1e4);
  assert.equal(by.prober.margin.worst, 3.4);
  assert.deepEqual(wilson(0, 0), { lo: 0, mid: 0.5, hi: 1 }, "no trials: the interval is the whole range");
});

test("three scripted agents give ordered break-even results, and the interval is wider for the new agent", () => {
  assert.deepEqual(orderByBreakEven(panels).map((p) => p.name), ["steady", "prober", "newcomer"]);
  assert.deepEqual([by.steady.breaksEven, by.prober.breaksEven, by.newcomer.breaksEven], [true, true, false], "the delegation pays for the steady agent, still pays at the worst end for the prober, and not yet for the newcomer");
  const width = (p: freeRein.Panel) => p.harm.hi - p.harm.lo;
  assert.ok(width(by.newcomer) > 5 * width(by.steady), `a new agent's chance of harm is shown as a wide interval: ${width(by.newcomer)} against ${width(by.steady)}`);
  assert.ok(by.newcomer.margin.best - by.newcomer.margin.worst > by.steady.margin.best - by.steady.margin.worst);
});

test("the next widening is suggested only on the record: enough clean jobs, no recent incident, few refusals, and a step that still pays at the high end; it comes with its evidence and is unsigned", () => {
  assert.equal(MIN_CLEAN_JOBS_FOR_WIDENING, 20);
  assert.deepEqual(LADDER, [20, 50, 100, 300, 1000]);
  const next = by.steady.next!;
  assert.deepEqual([next.cap, next.residualDamage], [100, residualDamageAt(100)]);
  assert.match(next.evidence, /50 clean jobs, 0 incidents, 0 refused calls/);
  assert.ok(next.marginWorst > 0);
  assert.equal(by.newcomer.next, null); assert.match(by.newcomer.reason, /2 clean jobs/);
  assert.equal(by.prober.next, null); assert.match(by.prober.reason, /refused 10 calls/);
  const hurt = freeRein.freeRein({ cleanJobs: 50, refusedCalls: 0, incidents: 1 }, mandate, sponsor);
  assert.equal(hurt.next, null); assert.match(hurt.reason, /incident/);
  const top = freeRein.freeRein(agents.steady, { cap: 1000, residualDamage: 400 }, sponsor);
  assert.equal(top.next, null); assert.match(top.reason, /top of the ladder/);
  const tight = freeRein.freeRein(agents.steady, mandate, { gain: 16, monitoring: 20, tokens: 10 });
  assert.equal(tight.next, null, "a step that would not pay at the high end is not suggested"); assert.match(tight.reason, /would not pay/);
  for (const p of panels) { assert.equal(p.panel.signed, false); assert.equal(p.panel.requiresSignatureOf, "sponsor"); }
});

test("it never widens by itself: the module has no function that writes a Mandate, the panel is data and text, and the text says a sponsor signs", () => {
  const writers = Object.keys(freeRein).filter((k) => /^(apply|widen|set|write|append|sign|issue|grant)/i.test(k));
  assert.deepEqual(writers, [], "no export that changes anything");
  const text = renderPanel("steady", by.steady);
  assert.match(text, /A sponsor signs a new Mandate to take it; nothing here does/);
  assert.match(text, /credits \(mock\)/);
  assert.match(renderPanel("newcomer", by.newcomer), /does not yet pay/);
  assert.equal(freeRein.freeRein({ ...agents.steady, heldOutPermille: 820 }, mandate, sponsor).heldOutPermille, 820);
  assert.equal(JSON.stringify(freeRein.freeRein(agents.steady, mandate, sponsor)), JSON.stringify(freeRein.freeRein(agents.steady, mandate, sponsor)), "the same inputs give the same panel");
});
