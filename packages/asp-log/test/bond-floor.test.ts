import { test } from "node:test";
import assert from "node:assert/strict";
import { bondFloorPermille, DEFAULT_FLOOR, legacyFloorPermille, minBond, type FloorRecord } from "../src/bond-floor.ts";

const none: FloorRecord = { ownSlashes: 0, fleetSlashes: 0, recentStrikes: 0, verifiedImprovements: 0, acceptedCleanJobs: 0, regressions: 0 };

test("an agent with no record pays the base; evidence lowers the floor, never below the minimum", () => {
  assert.equal(bondFloorPermille(none), 400);
  assert.equal(bondFloorPermille({ ...none, verifiedImprovements: 1 }), 340);
  assert.equal(bondFloorPermille({ ...none, acceptedCleanJobs: 4 }), 340);
  // Both credits are capped: 200 for improvements, 150 for tenure, so 400 - 350 = 50 is the least.
  assert.equal(bondFloorPermille({ ...none, verifiedImprovements: 99, acceptedCleanJobs: 99 }), DEFAULT_FLOOR.min);
});

test("slashes, fleet slashes, strikes and regressions raise it, up to the whole price", () => {
  assert.equal(bondFloorPermille({ ...none, ownSlashes: 1 }), 650);
  assert.equal(bondFloorPermille({ ...none, fleetSlashes: 1 }), 500);
  assert.equal(bondFloorPermille({ ...none, recentStrikes: 5 }), 450);
  assert.equal(bondFloorPermille({ ...none, recentStrikes: 500 }), 600, "strikes are capped at 200");
  assert.equal(bondFloorPermille({ ...none, regressions: 1 }), 550);
  assert.equal(bondFloorPermille({ ...none, ownSlashes: 9 }), 1000);
});

test("it is monotone: more good evidence never raises it, more bad evidence never lowers it", () => {
  for (let i = 0; i < 6; i++) {
    assert.ok(bondFloorPermille({ ...none, verifiedImprovements: i + 1 }) <= bondFloorPermille({ ...none, verifiedImprovements: i }));
    assert.ok(bondFloorPermille({ ...none, acceptedCleanJobs: i + 1 }) <= bondFloorPermille({ ...none, acceptedCleanJobs: i }));
    assert.ok(bondFloorPermille({ ...none, regressions: i + 1 }) >= bondFloorPermille({ ...none, regressions: i }));
    assert.ok(bondFloorPermille({ ...none, ownSlashes: i + 1 }) >= bondFloorPermille({ ...none, ownSlashes: i }));
  }
});

test("with the base, minimum and the two credits switched off it is exactly the floor the log applies today", () => {
  const off = { ...DEFAULT_FLOOR, base: 0, min: 0, gain: 0, tenure: 0, perRegression: 0 };
  for (const r of [none, { ...none, ownSlashes: 2 }, { ...none, fleetSlashes: 3, recentStrikes: 7 }, { ...none, ownSlashes: 1, fleetSlashes: 1, recentStrikes: 40 }]) {
    assert.equal(bondFloorPermille(r, off), legacyFloorPermille(r));
  }
});

test("the bond for a price rounds up", () => {
  assert.equal(minBond(100, 400), 40);
  assert.equal(minBond(100, 55), 6);
  assert.equal(minBond(33, 50), 2);
});
