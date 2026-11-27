/**
 * BI-18, the Insurer's stress replay and its "still moving" line (register rows DK491, DK185; bank-insurer.md 14.1, 14.4): the last 90 days replayed with the claims multiplied, in simulation only, with the three verdicts;
 * a seeded run over the model ledger of insurer-dynamics replays to the same answer; the line says frozen when the reserve is flat for eight weeks. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dynamicsLine, simulateInsurer, stressReplay, type StressEvent } from "../src/index.ts";

const day = (n: number) => new Date(Date.parse("2026-09-01T00:00:00Z") + n * 86_400_000).toISOString().replace(".000Z", "Z");
const AT = day(89);
const ev = (n: number, kind: "premium" | "claim", amount: number, insured?: number): StressEvent => ({ at: day(n), kind, amount, ...(insured ? { insured } : {}) });

test("BI-18: the stress replay doubles the claims and says whether the reserve holds, stops sales or runs dry", () => {
  const events = [ev(1, "premium", 40, 40), ev(10, "claim", 30), ev(20, "premium", 40, 40), ev(40, "claim", 30)];
  const base = stressReplay(events, 1000, AT, { multiplier: 1 });
  assert.equal(base.startReserve, 1000 - 80 + 60, "the start is worked back from the reserve today");
  assert.equal(base.endStressed, 1000, "a multiplier of 1 is what happened");
  const doubled = stressReplay(events, 1000, AT);
  assert.equal(doubled.endStressed, 1000 - 60, "30 and 30 more are paid");
  assert.equal(doubled.verdict, "holds");
  const thin = stressReplay(events, 520, AT, { multiplier: 2 });
  assert.equal(thin.verdict, "sales_stop", "above zero, under the 500 floor");
  const dry = stressReplay([ev(5, "claim", 400), ev(6, "claim", 400)], 300, AT, { multiplier: 2 });
  assert.equal(dry.verdict, "runs_dry");
  assert.ok(dry.minStressed < 0);
  assert.equal(stressReplay([ev(1, "claim", 50)], 700, "2027-06-01T00:00:00Z").events, 0, "events outside the 90 days are not replayed");
  assert.match(doubled.note, /it holds/);
});

test("BI-18: the line says moving, frozen, or not yet judged; rate dispersion near zero means the rating stopped tracking behaviour", () => {
  assert.equal(dynamicsLine([], 0, []).reserveStatus, "too_little_data");
  assert.equal(dynamicsLine([{ premium: 2, insured: 20 }], 0, [500, 500, 500, 500, 500, 500, 500]).reserveStatus, "too_little_data", "seven weeks are not eight");
  assert.equal(dynamicsLine([], 0, Array(8).fill(500)).reserveStatus, "frozen");
  assert.equal(dynamicsLine([], 0, [500, 520, 540, 500, 560, 530, 600, 610]).reserveStatus, "moving");
  const same = dynamicsLine([{ premium: 2, insured: 20 }, { premium: 4, insured: 40 }], 1, []);
  assert.equal(same.premiumDispersion, 0);
  assert.equal(same.claimsPer100, 50);
  assert.ok((dynamicsLine([{ premium: 2, insured: 20 }, { premium: 8, insured: 20 }], 0, []).premiumDispersion ?? 0) > 0.5);
});

test("BI-18: over the seeded model ledger the replay is the same from the same seed, and the reserve the model keeps stays above zero", () => {
  const a = simulateInsurer({ seed: "stress-1", months: 12, holders: 30, reserve: 800, drivers: true });
  const b = simulateInsurer({ seed: "stress-1", months: 12, holders: 30, reserve: 800, drivers: true });
  assert.equal(a.trace, b.trace, "replays from its seed");
  assert.ok(a.minReserve >= 0, "the reserve is never negative");
});
