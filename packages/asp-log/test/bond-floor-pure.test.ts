// The bond floor's arithmetic, direct (register rows DK313 and T26; the closed rows were tested through whole-log tests, so the numbers were not pinned): the legacy terms, the v2 credit and penalty with their caps and
// minimum, the smallest bond, the cutover, the v3 certificate, drift, class and threat terms, the decay and the measured terms with probation. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FLOOR, bondFloorPermille, bondFloorV3, decayWeight, floorIsV2, floorMeasuredActive, legacyFloorPermille, measuredTerms, minBond, threatPermille } from "../src/bond-floor.ts";

const rec = (o: Partial<Parameters<typeof bondFloorPermille>[0]> = {}) => ({ ownSlashes: 0, fleetSlashes: 0, recentStrikes: 0, verifiedImprovements: 0, acceptedCleanJobs: 0, regressions: 0, ...o });

test("the legacy floor adds slashes (250 each), fleet slashes (100), strikes (10 each, capped at 200), and never exceeds 1000", () => {
  assert.equal(legacyFloorPermille(rec()), 0);
  assert.equal(legacyFloorPermille(rec({ ownSlashes: 1 })), 250);
  assert.equal(legacyFloorPermille(rec({ fleetSlashes: 2 })), 200);
  assert.equal(legacyFloorPermille(rec({ recentStrikes: 5 })), 50);
  assert.equal(legacyFloorPermille(rec({ recentStrikes: 20 })), 200, "the strikes stop at 200");
  assert.equal(legacyFloorPermille(rec({ recentStrikes: 21 })), 200);
  assert.equal(legacyFloorPermille(rec({ ownSlashes: 3, fleetSlashes: 3, recentStrikes: 30 })), 1000, "capped at the whole price");
  assert.equal(legacyFloorPermille(rec({ ownSlashes: 2, fleetSlashes: 1, recentStrikes: 4 })), 640);
});

test("the v2 floor: 400 less the credit (60 an improvement up to 200, 15 a clean job up to 150) plus the penalty (the legacy terms, 150 a regression, 150 on probation), never below 50 nor above 1000", () => {
  assert.equal(bondFloorPermille(rec()), 400);
  assert.equal(bondFloorPermille(rec({ verifiedImprovements: 2 })), 280);
  assert.equal(bondFloorPermille(rec({ verifiedImprovements: 4 })), 200, "an improvement credit capped at 200 (not 240)");
  assert.equal(bondFloorPermille(rec({ acceptedCleanJobs: 4 })), 340);
  assert.equal(bondFloorPermille(rec({ acceptedCleanJobs: 20 })), 250, "a tenure credit capped at 150 (not 300)");
  assert.equal(bondFloorPermille(rec({ verifiedImprovements: 4, acceptedCleanJobs: 20 })), 50, "400 less 200 less 150 is 50: the floor");
  assert.equal(bondFloorPermille(rec({ verifiedImprovements: 4, acceptedCleanJobs: 20, recentStrikes: 0 }), { ...DEFAULT_FLOOR, base: 300 }), 50, "never below the minimum");
  assert.equal(bondFloorPermille(rec({ regressions: 2 })), 700);
  assert.equal(bondFloorPermille(rec({ probation: true })), 550);
  assert.equal(bondFloorPermille(rec({ ownSlashes: 1 })), 650);
  assert.equal(bondFloorPermille(rec({ ownSlashes: 4 })), 1000, "never above the whole price");
});

test("the smallest bond rounds up; the v2 floor applies from its cutover and not before; the measured terms from theirs", () => {
  assert.equal(minBond(100, 400), 40);
  assert.equal(minBond(101, 400), 41, "rounded up");
  assert.equal(minBond(0, 400), 0);
  assert.equal(floorIsV2("legacy", undefined, "2026-01-01T00:00:00Z"), false);
  assert.equal(floorIsV2("v2", undefined, "2026-01-01T00:00:00Z"), true);
  assert.equal(floorIsV2("v3", undefined, "2026-01-01T00:00:00Z"), true);
  assert.equal(floorIsV2("v2", "2026-06-01T00:00:00Z", "2026-05-31T23:59:59Z"), false, "before the cutover");
  assert.equal(floorIsV2("v2", "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"), true, "at the cutover");
  assert.equal(floorMeasuredActive("2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"), true);
  assert.equal(floorMeasuredActive("2026-06-01T00:00:00Z", "2026-05-31T00:00:00Z"), false);
  assert.equal(floorMeasuredActive(undefined, "2026-12-14T00:00:00Z"), false, "the default date is 2026-12-15");
});

test("the v3 floor: a certificate lowers by 40 up to 120, a drift raises by 100 or 300, the class multiplies, the threat terms add (the largest plus 25 for each further), within the minimum and the whole price", () => {
  const v3 = (o: Record<string, unknown> = {}) => bondFloorV3({ ...rec(), certificates: 0, drift: "none", taskClass: "routine", scopes: [], ...o } as never);
  assert.equal(v3(), 400, "with nothing added it is exactly the v2 floor");
  assert.equal(v3({ certificates: 2 }), 320);
  assert.equal(v3({ certificates: 5 }), 280, "a certificate credit capped at 120 (not 200)");
  assert.equal(v3({ drift: "warn" }), 500);
  assert.equal(v3({ drift: "quarantine_recommended" }), 700);
  assert.equal(v3({ taskClass: "trivial" }), 240);
  assert.equal(v3({ taskClass: "skilled" }), 520);
  assert.equal(v3({ taskClass: "critical" }), 680);
  assert.equal(v3({ scopes: ["shell.exec"] }), 450);
  assert.equal(v3({ scopes: ["shell.network", "repo.push"] }), 525, "100 for the largest and 25 for the second");
  assert.equal(v3({ ownSlashes: 4, taskClass: "critical", scopes: ["pr.merge"] }), 1000, "capped at the whole price");
  assert.equal(threatPermille([]), 0);
  assert.equal(threatPermille(["shell.exec", "repo.push", "pr.open"]), 100, "the largest term plus 25 for each of the two others: 50 + 25 + 25");
  assert.equal(threatPermille(["mcp.thing"]), 50);
  assert.equal(threatPermille(["web.fetch"]), 75);
  assert.equal(threatPermille(["repo.read"]), 0, "a scope with no term adds nothing");
});

test("the decay: full for 90 days, nothing from 270, a straight line between; the measured terms weigh jobs and improvements by it, count a regression only in the last 30 days, and a probation keeps only what came after the return", () => {
  assert.equal(decayWeight(90), 1);
  assert.equal(decayWeight(91) < 1 && decayWeight(91) > 0.99, true);
  assert.equal(decayWeight(180), 0.5);
  assert.equal(decayWeight(270), 0);
  assert.equal(decayWeight(500), 0);
  const day = (d: number) => new Date(Date.parse("2026-12-31T00:00:00Z") - d * 86_400_000).toISOString();
  const now = day(0);
  const m = measuredTerms([{ at: day(10), weight: 1 }, { at: day(180), weight: 2 }], [{ at: day(10), delta: 100 }, { at: day(20), delta: 99 }, { at: day(5), delta: -100 }, { at: day(40), delta: -150 }, { at: day(3), delta: null }], now);
  assert.deepEqual([m.acceptedCleanJobs, m.verifiedImprovements, m.regressions, m.probation], [2, 1, 1, false], "1 for a recent job and half of 2 for the old one; one improvement at the 100 margin and not 99; a regression at -100 inside 30 days and not the one 40 days old");
  assert.equal(measuredTerms([{ at: day(-5), weight: 1 }], [], now).acceptedCleanJobs, 0, "a job dated after now does not count yet");
  const back = measuredTerms([{ at: day(10), weight: 1 }, { at: day(30), weight: 1 }], [{ at: day(50), delta: 200 }, { at: day(50), delta: -200 }, { at: day(10), delta: 200 }], now, day(15));
  assert.equal(back.probation, true);
  assert.deepEqual([back.acceptedCleanJobs, back.verifiedImprovements, back.regressions], [1, 1, 0], "after a return only jobs and improvements after it count; a regression before it still counts but is outside the window here");
  assert.equal(measuredTerms([], [], now, day(60)).probation, true, "60 days after the return is still on probation");
  assert.equal(measuredTerms([], [], now, day(61)).probation, false);
});
