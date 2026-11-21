// The Clinic's drift series and scoring (clinic.md CL-1, CL-2, CL-4; register row DK28). Synthetic jobs with a fixed seed: a stable agent is never flagged (1,000 series, at most 1 % false flags), an agent whose
// behaviour changes on purpose is flagged within the stated number of jobs and its diagnosis lists the evidence; the thresholds are tested at their boundaries. Fake data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HEALTH, checkupDue, diagnosisOf, driftSeries, firstFlag, scoreSeries, type HealthJob } from "../src/clinic-health.ts";

/** A small deterministic generator (mulberry32). */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const T0 = Date.parse("2026-11-01T00:00:00Z");
const stamp = (i: number) => new Date(T0 + i * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** One job. Normal behaviour: about 2,000 tokens, 8 tool calls, 60 s, rarely refused, reads and edits. `changed` is the purposely changed behaviour. */
function job(i: number, r: () => number, changed = false, over: Partial<HealthJob> = {}): HealthJob {
  const noise = (x: number, pct: number) => Math.round(x * (1 + (r() * 2 - 1) * pct));
  return changed
    ? { id: `act-${i}`, issuedAt: stamp(i), assurance: "gateway_observed", tokens: noise(5200, 0.15), toolCalls: noise(22, 0.15), seconds: noise(130, 0.15), blocked: 2 + Math.round(r()), scopes: ["repo.read", "shell.exec"], models: ["m1"], ...over }
    : { id: `act-${i}`, issuedAt: stamp(i), assurance: "gateway_observed", tokens: noise(2000, 0.25), toolCalls: noise(8, 0.25), seconds: noise(60, 0.25), blocked: r() < 0.05 ? 1 : 0, scopes: ["repo.read", "repo.write"], models: ["m1"], ...over };
}
const run = (seed: number, n: number, changeAt?: number) => { const r = rng(seed); return Array.from({ length: n }, (_, i) => job(i, r, changeAt !== undefined && i >= changeAt)); };

test("a stable agent over 200 jobs is never flagged; 1,000 seeded stable series give at most 1 % false flags", () => {
  assert.equal(firstFlag(run(1, 200)), undefined);
  let flagged = 0;
  for (let s = 1; s <= 1000; s++) if (firstFlag(run(s * 7919, 60))) flagged++;
  assert.ok(flagged / 1000 <= 0.01, `${flagged} of 1000 stable series were flagged`);
});

test("DK28 done: an agent whose behaviour is changed on purpose at job 50 is flagged within the stated number of jobs, and its diagnosis lists the evidence", () => {
  const jobs = run(2, 200, 50);
  const flag = firstFlag(jobs)!;
  assert.ok(flag, "flagged");
  assert.ok(flag.index >= 50, "not before the change");
  assert.ok(flag.index - 50 + 1 <= HEALTH.detectWithinJobs, `flagged at job ${flag.index}, ${flag.index - 50 + 1} jobs after the change; the stated bound is ${HEALTH.detectWithinJobs}`);
  const d = diagnosisOf("did:web:example.com:agents:x", flag.score)!;
  assert.ok(d, "a diagnosis");
  assert.ok(new Set(d.findings.map((f) => f.measure)).size >= 2, "two or more different measures");
  assert.equal(d.severity, "quarantine_recommended", "a new risky scope with another measure");
  const window = new Set(flag.score.window!.jobs);
  for (const f of d.findings) { assert.ok(f.evidence.length >= 1, `${f.measure} has evidence`); for (const id of f.evidence) assert.ok(window.has(id) && jobs.some((j) => j.id === id), "the evidence is an Action in the window"); }
  assert.deepEqual(d.recommendation.map((x) => x.action), ["quarantine", "re_exam", "refresher_course"]);
  // 1,000 seeded series with a change: every one is flagged inside the bound.
  let late = 0;
  for (let s = 1; s <= 1000; s++) { const f = firstFlag(run(s * 104729, 90, 50)); if (!f || f.index - 50 + 1 > HEALTH.detectWithinJobs) late++; }
  assert.equal(late, 0, "every changed series is flagged within the bound");
});

test("the thresholds at their boundaries: 1.5 times is not a drift and 1.51 times is, one measure is a watch, and four observed jobs are not a window", () => {
  const mk = (tokens: number, extra: Partial<HealthJob> = {}) => {
    const j: HealthJob[] = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, issuedAt: stamp(i), assurance: "gateway_observed", tokens: 2000, toolCalls: 8, seconds: 60, blocked: 0, scopes: ["repo.read"], models: ["m"] }));
    for (let i = 0; i < 5; i++) j.push({ id: `w${i}`, issuedAt: stamp(20 + i), assurance: "gateway_observed", tokens, toolCalls: 8, seconds: 60, blocked: 0, scopes: ["repo.read"], models: ["m"], ...extra });
    return j;
  };
  assert.equal(scoreSeries(mk(3000), 24).severity, "ok", "exactly 1.5 times is not above it");
  assert.equal(scoreSeries(mk(3010), 24).severity, "watch", "1.51 times and 1,010 more is a drift, but one measure is a watch, not a diagnosis");
  assert.equal(diagnosisOf("a", scoreSeries(mk(3010), 24)), undefined);
  assert.equal(scoreSeries(mk(3010, { toolCalls: 20 }), 24).severity, "warn", "two measures flag");
  assert.equal(scoreSeries(mk(2100), 24).severity, "ok", "above 1.5 times needs more than 200 tokens more: 2,100 is neither");
  const partial = (changed: number) => { const j = mk(3010, { toolCalls: 20 }); for (let i = 0; i < 5 - changed; i++) Object.assign(j[20 + i], { tokens: 2000, toolCalls: 8 }); return j; };
  assert.equal(scoreSeries(partial(2), 24).severity, "ok", "2 changed jobs of the last 5: the median has not moved");
  assert.equal(scoreSeries(partial(3), 24).severity, "warn", "the 3rd changed job moves the median of 5: flagged");
  assert.equal(scoreSeries(mk(3010, { toolCalls: 20 }).slice(0, 4), 3).severity, "unmeasured", "a series of 4 jobs");
  const short = mk(3010, { toolCalls: 20 }).slice(18); // 2 baseline jobs and 5 in the window
  assert.equal(scoreSeries(short, 6).severity, "unmeasured", "a baseline below the minimum is never flagged");
});

test("only gateway-observed jobs count: an agent that reports about itself is unmeasured, not clean", () => {
  const selfReported = run(3, 60, 30).map((j) => ({ ...j, assurance: "self_reported" }));
  const { series, skippedUnobserved } = driftSeries(selfReported);
  assert.equal(series.length, 0);
  assert.equal(skippedUnobserved, 60);
  assert.equal(scoreSeries(series, -1, [], skippedUnobserved).severity, "unmeasured");
  const mixed = run(4, 60, 30).map((j, i) => (i % 2 ? { ...j, assurance: "self_reported" } : j));
  const m = driftSeries(mixed);
  assert.equal(m.series.length, 30);
  assert.ok(firstFlag(m.series, [], m.skippedUnobserved), "the observed half still shows the change");
});

test("the diagnosis names a cause: a model that changed, else the lineage edge the change follows", () => {
  const jobs = run(5, 80, 50);
  const edges = [{ id: "edge-old", at: stamp(10), layer: "memory" }, { id: "edge-memory", at: stamp(49), layer: "memory" }, { id: "edge-swap", at: stamp(300), layer: "backend" }];
  assert.deepEqual(firstFlag(jobs, edges)!.score.cause, { cause: "memory_change", edge: "edge-memory" });
  assert.deepEqual(firstFlag(jobs, [{ id: "edge-b", at: stamp(50), layer: "backend" }])!.score.cause, { cause: "runtime_swap", edge: "edge-b" });
  const newModel = run(5, 80, 50).map((j, i) => (i >= 50 ? { ...j, models: ["m2"] } : j));
  assert.deepEqual(firstFlag(newModel, edges)!.score.cause, { cause: "model_update" });
  assert.deepEqual(firstFlag(jobs, [])!.score.cause, { cause: "unknown" });
});

test("a post-change checkup compares the jobs after a lineage edge with the jobs before it, however long the change has lasted", () => {
  const jobs = run(6, 120, 50);
  const long = scoreSeries(jobs, 119, [], 0, stamp(49.5));
  assert.ok(long.severity === "warn" || long.severity === "quarantine_recommended", `scored ${long.severity}`);
  assert.equal(long.baselineJobs, HEALTH.baseline);
  assert.equal(scoreSeries(run(6, 120), 119, [], 0, stamp(49.5)).severity, "ok", "the same edge on an unchanged agent is clean");
});

test("scheduled checkups: one when none was ever done, one after a lineage change, one every 90 days, none otherwise", () => {
  const now = "2026-11-12T00:00:00Z";
  assert.equal(checkupDue(undefined, [], now), "scheduled");
  assert.equal(checkupDue("2026-11-01T00:00:00Z", [], now), undefined);
  assert.equal(checkupDue("2026-11-01T00:00:00Z", [{ id: "e", at: "2026-11-05T00:00:00Z", layer: "memory" }], now), "post_change");
  assert.equal(checkupDue("2026-08-01T00:00:00Z", [], now), "scheduled");
});
