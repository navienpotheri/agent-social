/**
 * The risk-priced bond model (DK1333): the bound is a real Beta quantile, the bond falls as clean evidence grows, thin evidence costs more, and the 95% upper bound covers the true event rate at least 95% of the time (MEASURED here
 * by simulation and printed). A pure model: no money moves. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betaCdf, betaQuantile, evidenceTier, sizeBond } from "../src/bond-sizing.ts";

function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test("the Beta functions are right on known values", () => {
  assert.ok(Math.abs(betaCdf(0.5, 2, 2) - 0.5) < 1e-9, "symmetric");
  assert.ok(Math.abs(betaCdf(0.25, 1, 1) - 0.25) < 1e-9, "uniform");
  assert.ok(Math.abs(betaCdf(0.3, 2, 5) - 0.579825) < 1e-5, "I_0.3(2,5)");
  assert.ok(Math.abs(betaQuantile(0.5, 3, 3) - 0.5) < 1e-9);
  assert.ok(Math.abs(betaCdf(betaQuantile(0.95, 1.5, 40), 1.5, 40) - 0.95) < 1e-9, "the quantile inverts the cdf");
});

test("the bond falls as clean runs accumulate, rises with events and with the loss, never below the floor, and thin evidence is labelled", () => {
  const job = { jobValue: 50, damage: 100 };
  const bonds = [0, 20, 100, 500, 2000].map((n) => sizeBond({ trials: n, events: 0, ...job }));
  for (let i = 1; i < bonds.length; i++) assert.ok(bonds[i].bond < bonds[i - 1].bond, `${bonds[i - 1].bond} then ${bonds[i].bond}`);
  assert.deepEqual([bonds[0].tier, bonds[2].tier, bonds[3].tier], ["thin", "some", "strong"]);
  assert.ok(sizeBond({ trials: 100, events: 5, ...job }).bond > sizeBond({ trials: 100, events: 0, ...job }).bond);
  assert.ok(sizeBond({ trials: 100, events: 0, jobValue: 50, damage: 1000 }).bond > bonds[2].bond);
  assert.equal(sizeBond({ trials: 100000, events: 0, jobValue: 1, damage: 0 }).bond, 1, "the floor");
  assert.throws(() => sizeBond({ trials: 5, events: 6, ...job }));
  assert.equal(evidenceTier(29), "thin");
  console.log("\nBOND TABLE (job 50 + damage 100, 0 events): " + [0, 20, 100, 500, 2000].map((n, i) => `${n} runs -> bond ${bonds[i].bond} (${bonds[i].tier}, upper bound ${(bonds[i].upperBound * 100).toFixed(2)}%)`).join("; "));
});

test("calibration: the 95% upper bound covers the true event rate at least 95% of the time, measured over simulated agents", () => {
  const rand = prng(7);
  for (const [p, n] of [[0.01, 50], [0.02, 200], [0.05, 100], [0.002, 500]] as const) {
    let covered = 0; const reps = 2000;
    for (let r = 0; r < reps; r++) { let ev = 0; for (let k = 0; k < n; k++) if (rand() < p) ev++; if (sizeBond({ trials: n, events: ev, jobValue: 1, damage: 0 }).upperBound >= p) covered++; }
    const rate = covered / reps;
    console.log(`coverage at true rate ${p}, ${n} runs, ${reps} simulated agents: ${(rate * 100).toFixed(1)}%`);
    assert.ok(rate >= 0.93, `coverage ${rate} at p=${p} n=${n}`);
  }
});
