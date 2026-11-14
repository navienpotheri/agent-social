/**
 * The capacity plan's arithmetic (docs/capacity-plan.md; register row DK65): the plan for 1,000 tenants and 1,000,000 runs, and the check of the shipped limits and the starter pool against it.
 * The inputs that are measured (bytes a record takes, latency) come from the load test, not from here; nothing here says the hosted target is met.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STARTING, STARTER_POOL, capacityPlan as plan, limitProblems, starterPoolFor } from "../src/index.ts";

const base = { tenants: 1000, runs: 1_000_000, days: 92, recordsPerRun: 2, bytesPerRecord: 1500, peakFactor: 20, requestsPerWrite: 3 };

test("the plan: records, storage and writes a second follow from the stated inputs", () => {
  const p = plan(base);
  assert.equal(p.records, 2_000_000);
  assert.equal(p.storageBytes, 3_000_000_000);
  assert.equal(p.recordsPerTenant, 2000);
  assert.equal(p.runsPerTenant, 1000);
  assert.ok(Math.abs(p.avgWritesPerSecond - 2_000_000 / (92 * 86_400)) < 1e-9);
  assert.equal(p.peakWritesPerSecond, p.avgWritesPerSecond * 20);
  const marketed = plan({ ...base, recordsPerRun: 10 });
  assert.equal(marketed.records, 10_000_000);
  assert.equal(marketed.recordsPerTenant, 10_000);
});

test("the shipped limits are checked against the plan: the 2,000-record quota covers a governed run's two records for 1,000 runs a tenant and no more, and falls short of marketed jobs", () => {
  assert.deepEqual(limitProblems(base).filter((x) => x.startsWith("record quota")), [], "2 records a run for 1,000 runs a tenant is exactly the quota");
  const over = limitProblems({ ...base, recordsPerRun: 3 });
  assert.ok(over.some((p) => p.startsWith("record quota 2000 a tenant is below the 3000")), over.join("; "));
  const marketed = limitProblems({ ...base, recordsPerRun: 10 });
  assert.ok(marketed.some((p) => p.includes("record quota")));
  assert.ok(marketed.some((p) => p.includes("byte quota")) === (10_000 * 1500 > DEFAULT_STARTING.byteQuota));
});

test("the starter pool is sized from the launch target: it covers 1,000 tenants x 2 identities x 500 credits, and a smaller pool is named as short", () => {
  assert.equal(STARTER_POOL, starterPoolFor(1000));
  assert.equal(starterPoolFor(1000), 1_000_000);
  assert.deepEqual(limitProblems(base).filter((p) => p.startsWith("starter pool")), []);
  assert.ok(limitProblems(base, DEFAULT_STARTING, 200_000).some((p) => p.startsWith("starter pool 200000 is below the 1000000")));
  assert.ok(limitProblems({ ...base, tenants: 2000 }).some((p) => p.startsWith("starter pool")), "2,000 tenants need more than the pool for 1,000");
});

test("the per-tenant rate and write limits: a busy tenant carries a tenth of the peak; governed runs fit the shipped limits, marketed jobs at a 20 times peak do not fit the write limit of 120 a minute", () => {
  const roomy = { ...DEFAULT_STARTING, recordQuota: 1e9, byteQuota: 1e12 };
  assert.deepEqual(limitProblems(base, roomy), []);
  const marketed = limitProblems({ ...base, recordsPerRun: 10 }, roomy);
  assert.ok(marketed.some((p) => p.startsWith("write limit 120 a minute a tenant is below")), marketed.join("; "));
  const p = plan({ ...base, recordsPerRun: 10 });
  assert.ok(p.busyTenantWritesPerMinute > 120 && p.busyTenantWritesPerMinute < 400, String(p.busyTenantWritesPerMinute));
  assert.ok(limitProblems({ ...base, recordsPerRun: 10, peakFactor: 200 }, roomy).some((x) => x.startsWith("rate limit")));
});

test("DK220 proposal (waits on the owner): the limits that carry the marketed-jobs case are a record quota of 12,000 and a write limit of 200 a minute; with the shipped defaults the plan's check reports two shortfalls, with the proposal it reports nothing", () => {
  const marketed = { ...base, recordsPerRun: 10, bytesPerRecord: 673 }; // 673 bytes a record: the measured figure of docs/capacity-plan.md
  const shipped = limitProblems(marketed);
  assert.equal(shipped.length, 2, shipped.join("; "));
  assert.ok(shipped.some((p) => p.startsWith("record quota 2000")) && shipped.some((p) => p.startsWith("write limit 120")));
  const proposed = { ...DEFAULT_STARTING, recordQuota: 12_000, writeLimitPerMinute: 200 };
  assert.deepEqual(limitProblems(marketed, proposed), [], "nothing short at the proposal");
  assert.ok(limitProblems({ ...marketed, recordsPerRun: 14 }, proposed).some((p) => p.startsWith("record quota")), "and the proposal is named short again when a run writes 14 records: it is sized to the plan, not unbounded");
  // The byte and request limits already carry it: the record count and the write rate are what fall short.
  assert.ok(!shipped.some((p) => p.startsWith("byte quota") || p.startsWith("rate limit")));
});
