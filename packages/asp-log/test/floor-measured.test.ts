// The bond floor's measured terms, decay and probation (register row DK313; spec-delta S1201; owner decision DK313-MEASURE: the Clinic measures). An old clean job counts for less and less and not at all after 270 days;
// a verified improvement and a regression are read from the Clinic's own signed checkup results (the held-out mean against the checkup before); and an agent the Clinic returns from tier 0 is on probation: a surcharge, and only
// what it does after the return counts. All of it applies from `floorMeasuredFrom`, so a log built before replays unchanged. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, examVariant } from "../src/index.ts";
import { DEFAULT_FLOOR, FLOOR_DECAY, FLOOR_MEASURE, FLOOR_MEASURED_FROM, FLOOR_PROBATION, bondFloorPermille, decayWeight, measuredTerms } from "../src/bond-floor.ts";
import { Kit, clinic, operator, owner, registrar, treasury, courts, bankP, refused, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const T0 = "2026-11-01T00:00:00Z";
const at = (days: number) => iso(Date.parse(T0) + days * DAY);

test("decay: a counted job carries its whole weight for 90 days, then less and less, and none from 270 days; the floor rises as the evidence ages", () => {
  assert.equal(FLOOR_DECAY.fullDays, 90);
  assert.equal(FLOOR_DECAY.endDays, 270);
  assert.deepEqual([0, 90, 180, 270, 400].map(decayWeight), [1, 1, 0.5, 0, 0]);
  const jobs = Array.from({ length: 10 }, (_, i) => ({ at: at(i), weight: 1 }));
  const floorAt = (day: number) => bondFloorPermille({ ownSlashes: 0, fleetSlashes: 0, recentStrikes: 0, ...measuredTerms(jobs, [], at(day)) });
  const [young, old, older, gone] = [30, 190, 240, 400].map(floorAt);
  assert.equal(young, DEFAULT_FLOOR.base - DEFAULT_FLOOR.tenureCap, "ten fresh jobs earn the whole tenure credit");
  assert.ok(old > young && older > old && gone === DEFAULT_FLOOR.base, `the floor climbs back to the base as the jobs age: ${young}, ${old}, ${older}, ${gone}`);
  assert.equal(measuredTerms(jobs, [], at(5), undefined).acceptedCleanJobs, 6, "a job after the time asked about is not counted");
});

test("the measured terms: a held-out mean 100 or more above the checkup before is a verified improvement (decayed like a job), 100 or more below within 30 days is a regression, the first measured checkup is neither, and the floor follows", () => {
  assert.equal(FLOOR_MEASURE.marginPermille, 100);
  const series = [{ at: at(0), delta: null }, { at: at(10), delta: 200 }, { at: at(20), delta: 99 }, { at: at(30), delta: -150 }, { at: at(35), delta: -99 }];
  const t = measuredTerms([], series, at(40));
  assert.equal(t.verifiedImprovements, 1, "+200 counts; +99 and the first do not");
  assert.equal(t.regressions, 1, "-150 counts; -99 does not");
  assert.equal(measuredTerms([], series, at(100)).regressions, 0, "a regression ages out of the 30-day window");
  assert.ok(measuredTerms([], series, at(190)).verifiedImprovements < 1, "an improvement decays like a job");
  const base = { ownSlashes: 0, fleetSlashes: 0, recentStrikes: 0 };
  assert.equal(bondFloorPermille({ ...base, ...t }), DEFAULT_FLOOR.base - DEFAULT_FLOOR.gain + DEFAULT_FLOOR.perRegression, "one improvement lowers the floor, one regression raises it");
});

test("probation after a return from tier 0: for 60 days the floor carries a surcharge and only what the agent did after the return counts; after it, the jobs and the improvements count again", () => {
  assert.equal(FLOOR_PROBATION.days, 60);
  const jobs = [{ at: at(0), weight: 1 }, { at: at(1), weight: 1 }, { at: at(100), weight: 1 }];
  const series = [{ at: at(2), delta: 300 }, { at: at(101), delta: -200 }];
  const during = measuredTerms(jobs, series, at(120), at(99));
  assert.deepEqual([during.probation, during.acceptedCleanJobs > 0.99 && during.acceptedCleanJobs <= 1, during.verifiedImprovements, during.regressions], [true, true, 0, 1], JSON.stringify(during));
  const after = measuredTerms(jobs, series, at(99 + 61), at(99));
  assert.equal(after.probation, false);
  assert.ok(after.acceptedCleanJobs > 1, "the jobs from before count again, decayed, once the probation is over");
  const base = { ownSlashes: 1, fleetSlashes: 0, recentStrikes: 0, acceptedCleanJobs: 0, verifiedImprovements: 0, regressions: 0 };
  assert.equal(bondFloorPermille({ ...base, probation: true }) - bondFloorPermille(base), FLOOR_PROBATION.surchargePermille);
});

async function world(floorMeasuredFrom?: string) {
  const store = new MemoryStore();
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP].map((p) => [p.kid, p.publicKey])));
  const clock = { now: (): string => T0 };
  const log = new EventLog(store, { operator: operator.did, owner: owner.did, fallbackResolver: resolver, now: () => new Date(Date.parse(clock.now())), ...(floorMeasuredFrom ? { floorMeasuredFrom } : {}) });
  const kit = new Kit(log);
  clock.now = () => kit.now();
  const sponsor = await kit.person("fm-sponsor");
  const agent = await kit.agent("fm-agent", sponsor, 1);
  return { kit, log, store, sponsor, agent };
}

test("on the log: the Clinic's measured checkups give the floor an improvement and then a regression, an unmeasured one counts for nothing, and a log whose terms start later reads none of it", async () => {
  const w = await world("2026-01-01T00:00:00Z");
  const late = await world("2027-06-01T00:00:00Z");
  for (const x of [w, late]) {
    const { kit, agent, sponsor } = x;
    const act = async (assurance: string) => { const j = kit.jobs.get(agent.did) ?? (await kit.job(agent)); return kit.put(kit.mk("action", agent, { contract: j.contract, scopes_used: ["repo.read"], assurance, summary: "run", metrics: { tokens_in: 1000, tokens_out: 0, tool_calls: 3, seconds: 10 } }, null, { subject: j.contract })); };
    const checkup = async (heldout: number, assurance = "gateway_observed") => {
      const order = await kit.put(kit.mk("clinic_order", clinic, { agent: agent.did, kind: "checkup", reason: "scheduled", due: iso(Date.parse(kit.now()) + 5 * DAY) }, null, { subject: agent.did }));
      const ref = await kit.mint(sponsor.did, 1);
      const seed = "sha256:" + createHash("sha256").update(`${order}|${ref}`).digest("hex");
      const strong = assurance !== "self_reported";
      const id = await kit.put(kit.mk("checkup_result", clinic, { order, agent: agent.did, seed_ref: ref, pool_size: 40, variant: examVariant(seed, 40, []), trials: 5, tasks: [{ task: "t", everyday_permille: 900, heldout_permille: heldout }], run_log_hash: await act(assurance), assurance, flag: strong ? (900 - heldout > 200 ? "overfit" : "clean") : "unmeasured" }, null, { subject: agent.did }));
      kit.addDays(6);
      return id;
    };
    await checkup(500, "self_reported");                       // unmeasured: not a measure, however it looks
    await checkup(700);                                         // the first measured checkup: no change to compare
    const afterFirst = await x.log.floorTerms(agent.did);
    await checkup(900);                                         // +200: a verified improvement
    const afterImprove = await x.log.floorTerms(agent.did);
    await checkup(700);                                         // -200: a regression
    const afterRegress = await x.log.floorTerms(agent.did);
    if (x === w) {
      assert.deepEqual([afterFirst.measured, afterFirst.verifiedImprovements, afterFirst.regressions], [true, 0, 0], "the first measured checkup and the unmeasured one change nothing");
      assert.deepEqual([afterImprove.verifiedImprovements, afterImprove.regressions], [1, 0]);
      assert.deepEqual([afterRegress.verifiedImprovements, afterRegress.regressions], [1, 1], "the improvement stands (it decays with age), the new regression is counted for 30 days");
      assert.ok(bondFloorPermille(afterRegress) > bondFloorPermille(afterImprove), "a regression raises the floor");
    } else {
      assert.deepEqual([afterRegress.measured, afterRegress.verifiedImprovements, afterRegress.regressions], [false, 0, 0], "before the date the log reads none of the measured terms");
    }
  }
});

test("on the log: the Clinic's return from tier 0 starts the probation, in which the floor carries a surcharge and the jobs from before the return do not count; after 60 days they do again", async () => {
  const w = await world("2026-01-01T00:00:00Z");
  const { kit, log, store, sponsor, agent } = w;
  kit.addDays(1);
  const exam = await kit.passedResult(agent, "foundations", 1);
  const nowMs = Date.parse(kit.tick());
  await store.transaction(async (tx) => {
    await tx.putReputation({ did: agent.did, tier: 0, slashCount: 2, strikeLog: [], qualifyingJobs: 3 } as never);
    await tx.putMarker(`slashed_at:${agent.did}`, iso(nowMs - 40 * DAY));
    await tx.putMarker(`qual_feed:${agent.did}`, JSON.stringify([0, 1, 2].map((i) => ({ at: iso(nowMs - (60 + i) * DAY), weight: 1 }))));
  });
  const before = await log.floorTerms(agent.did);
  assert.ok(before.acceptedCleanJobs > 2.9 && !before.probation, "before the return the old jobs count");
  const vouch = await kit.put(kit.mk("revouch", sponsor, { agent: agent.did, reason: "reviewed its last runs" }, null, { subject: agent.did }));
  await kit.put(kit.mk("retraining_release", clinic, { agent: agent.did, exam_result: exam, revouch: vouch }, null, { subject: agent.did }));
  const during = await log.floorTerms(agent.did);
  assert.equal(during.probation, true);
  assert.equal(during.acceptedCleanJobs, 0, "what it did before the return does not count while it is on probation");
  assert.equal(bondFloorPermille({ ...during, ownSlashes: 0 }) - bondFloorPermille({ ...during, ownSlashes: 0, probation: false }), FLOOR_PROBATION.surchargePermille);
  assert.ok(bondFloorPermille(during) > bondFloorPermille({ ...during, probation: false }), "with two slashes the surcharge still raises the floor, up to the whole price");
  const later = await log.floorTerms(agent.did, iso(Date.parse(kit.now()) + 61 * DAY));
  assert.equal(later.probation, false);
  assert.ok(later.acceptedCleanJobs > 0 && later.acceptedCleanJobs < 3, "after the probation the older jobs count again, decayed");
  // (The slash is placed in the store directly, as in clinic-retraining.test.ts, so this log is not replayed.)
  assert.equal(FLOOR_MEASURED_FROM, "2026-12-15T00:00:00Z");
});
