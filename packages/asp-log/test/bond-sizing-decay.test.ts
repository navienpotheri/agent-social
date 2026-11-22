// The time-varying hazard of the bond model (register row DK1333): a run counts for half as much for every half-life of age, so a recent slash costs more than an old one, old clean runs fade towards the prior, and with no
// decay (every run now) the result is the plain model's. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HALF_LIFE_DAYS, sizeBond, sizeBondDecayed, type DatedRun } from "../src/bond-sizing.ts";

const DAY = 86_400_000, NOW = Date.parse("2026-11-22T00:00:00Z");
const runs = (n: number, daysAgo: number, event = false): DatedRun[] => Array.from({ length: n }, (_, i) => ({ at: NOW - daysAgo * DAY, event: event && i === 0 }));
const o = { jobValue: 100, damage: 100 };

test("with every run now the decayed model is the plain model", () => {
  const all = [...runs(100, 0), ...runs(1, 0, true)];
  const d = sizeBondDecayed(all, NOW, o);
  const p = sizeBond({ trials: 101, events: 1, ...o });
  assert.equal(d.bond, p.bond);
  assert.ok(Math.abs(d.upperBound - p.upperBound) < 1e-9);
  assert.equal(d.effectiveTrials, 101);
});

test("a run weighs half as much for every half-life, and a recent slash costs more than the same slash long ago", () => {
  const d = sizeBondDecayed(runs(1, DEFAULT_HALF_LIFE_DAYS), NOW, o);
  assert.ok(Math.abs(d.effectiveTrials - 0.5) < 1e-9, "one half-life old counts for a half");
  const slip = (daysAgo: number) => sizeBondDecayed([...runs(200, 5), { at: NOW - daysAgo * DAY, event: true }], NOW, o);
  assert.ok(slip(7).upperBound > slip(400).upperBound, "a slash last week raises the bound more than one a year ago");
  assert.ok(slip(7).bond >= slip(400).bond);
  assert.ok(slip(400).effectiveEvents < 0.05, "a slash over four half-lives old has almost faded");
});

test("old clean runs fade: a year of silence leaves a thinner record and a wider bound than the same runs just now", () => {
  const fresh = sizeBondDecayed(runs(300, 1), NOW, o), stale = sizeBondDecayed(runs(300, 540), NOW, o);
  assert.ok(stale.upperBound > fresh.upperBound, "the record that is out of date supports less");
  assert.ok(stale.effectiveTrials < fresh.effectiveTrials);
  assert.equal(stale.tier, "thin", "its evidence tier follows the effective trials");
});

test("the half-life must be positive, a run from the future counts in full, and an empty record is the prior", () => {
  assert.throws(() => sizeBondDecayed([], NOW, { ...o, halfLifeDays: 0 }));
  assert.equal(sizeBondDecayed([{ at: NOW + DAY, event: false }], NOW, o).effectiveTrials, 1);
  const none = sizeBondDecayed([], NOW, o), plain = sizeBond({ trials: 0, events: 0, ...o });
  assert.equal(none.bond, plain.bond);
});
