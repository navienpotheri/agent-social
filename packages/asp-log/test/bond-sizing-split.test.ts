/**
 * The split bond model and the Insurer's advisory premium (DK1333): P(event) = P(attempt) x P(an attempt gets through), the through rate MEASURED (the held-out benchmark, 12 of 165), the published table in
 * docs/research/breach-probability-model.md equal to what the code computes, the product bound covering the true rate by simulation, and the Insurer's quote shown beside the table's premium without changing it.
 * Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEASURED_THROUGH, modelPremium, sizeBond, sizeBondSplit } from "../src/index.ts";
import { COVER_SHARE_PERMILLE, premiumFor } from "../src/insurer.ts";

const doc = readFileSync(new URL("../../../docs/research/breach-probability-model.md", import.meta.url), "utf8").replace(/\r/g, "");

test("the measured input is the held-out benchmark's and is labelled as cases, not live runs", () => {
  assert.deepEqual([MEASURED_THROUGH.attempts, MEASURED_THROUGH.through, MEASURED_THROUGH.live], [165, 12, false]);
  assert.match(MEASURED_THROUGH.source, /blind2/);
});

test("the bond falls with clean runs, rises with attempts, and a leakier gateway costs more", () => {
  const b = (trials: number, attemptRuns: number, through?: number) => sizeBondSplit({ trials, attemptRuns, ...(through === undefined ? {} : { attempts: 165, through }), jobValue: 50, damage: 100 }).bond;
  assert.ok(b(0, 0) > b(30, 0) && b(30, 0) >= b(300, 0));
  assert.ok(b(30, 3) > b(30, 0));
  assert.ok(b(30, 1, 60) > b(30, 1, 12), "if more attempts got through the bond is bigger");
  assert.throws(() => sizeBondSplit({ trials: 3, attemptRuns: 4, jobValue: 1, damage: 0 }));
  assert.throws(() => sizeBondSplit({ trials: 3, attemptRuns: 0, attempts: 5, through: 6, jobValue: 1, damage: 0 }));
});

test("the product of the two bounds covers the true chance of an event at least 95% of the time, by simulation (printed)", () => {
  let a = 12345; const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cases: [number, number][] = [[0.02, 0.05], [0.05, 0.1], [0.1, 0.07], [0.01, 0.2]];
  const out: string[] = [];
  for (const [pa, pt] of cases) {
    let covered = 0; const N = 400;
    for (let r = 0; r < N; r++) {
      let ar = 0; for (let i = 0; i < 100; i++) if (rnd() < pa) ar++;
      let th = 0; for (let i = 0; i < 165; i++) if (rnd() < pt) th++;
      if (sizeBondSplit({ trials: 100, attemptRuns: ar, attempts: 165, through: th, jobValue: 1, damage: 0 }).upperBound >= pa * pt) covered++;
    }
    out.push(`attempt ${pa}, through ${pt}: covered ${(100 * covered / N).toFixed(1)}% of ${N}`);
    assert.ok(covered / N >= 0.93, out[out.length - 1]);
  }
  console.log("\nDK1333 split-model calibration:\n  " + out.join("\n  "));
});

test("the published table is the one the code computes (a job of 50 plus damage 100)", () => {
  const rows = [...doc.matchAll(/^\| (\d+) runs, (\d+) with an attempt \| (\d+) \| ([\d.]+) % \| (\d+) \|$/gm)];
  assert.ok(rows.length >= 8, `${rows.length} rows in the table`);
  for (const [, t, a, bond, upper, single] of rows) {
    const s = sizeBondSplit({ trials: +t, attemptRuns: +a, jobValue: 50, damage: 100 });
    assert.equal(s.bond, +bond, `${t}/${a} bond`);
    assert.equal((s.upperBound * 100).toFixed(2), upper, `${t}/${a} bound`);
    assert.equal(sizeBond({ trials: +t, events: +a, jobValue: 50, damage: 100 }).bond, +single, `${t}/${a} single-rate bond`);
  }
});

test("the Insurer's model premium is the expected loss with the margin, shown beside the table's premium and never charged", () => {
  const s = sizeBondSplit({ trials: 0, attemptRuns: 0, jobValue: 100, damage: 0 });
  const p = modelPremium(s, 20, COVER_SHARE_PERMILLE);
  assert.equal(p, Math.max(1, Math.ceil(s.mean * 20 * 0.5 * 1.25)));
  assert.equal(modelPremium({ mean: 0 }, 20, COVER_SHARE_PERMILLE), 1, "at least one credit");
  assert.ok(premiumFor("bond_slash", 20, 100, 0, 0) >= 1, "the table's premium is a separate function the log still enforces");
});
