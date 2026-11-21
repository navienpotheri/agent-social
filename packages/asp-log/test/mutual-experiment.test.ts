/**
 * The harness for the fleet mutual-cover experiment (register rows DK185 and BI-14; bank-insurer.md 13.2): arms by a published seed over the fleet's DID (balanced, repeatable, no hand-picking), and the verdict by the rule
 * fixed before the start: keep, kill, continue, or too little data. Reads and computes; starts nothing. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mutualArmOf, judgeMutualExperiment, mutualMeasures, type ArmFacts } from "../src/index.ts";

const facts = (over: Partial<ArmFacts> = {}): ArmFacts => ({ policies: 40, premiums: 400, claimsPaid: 120, claims: 4, jobs: 100, cleanJobs: 90, ...over });

test("the arm of a fleet (mutualArmOf) is a function of the published seed and its DID: repeatable, roughly even, and a new seed redraws", () => {
  const fleets = Array.from({ length: 400 }, (_, i) => `did:web:example.com:orgs:o${i}:fleets:f`);
  const arms = fleets.map((f) => mutualArmOf("beta-1", f));
  assert.deepEqual(fleets.map((f) => mutualArmOf("beta-1", f)), arms, "the same seed gives the same arms");
  const mutual = arms.filter((a) => a === "mutual").length;
  assert.ok(mutual > 160 && mutual < 240, `${mutual} of 400 are mutual`);
  assert.notDeepEqual(fleets.map((f) => mutualArmOf("beta-2", f)), arms, "another seed draws again");
});

test("keep: the loss ratio is at most the standard's and the premium per clean job fell by 15 percent", () => {
  const v = judgeMutualExperiment(facts({ premiums: 300, claimsPaid: 90 }), facts());
  assert.equal(v.verdict, "keep");
  assert.ok(Math.abs((v.mutual.premiumPerCleanJob ?? 0) - 300 / 90) < 1e-9);
});

test("kill: a pool below zero, or claims per 100 jobs more than 25 percent higher", () => {
  assert.equal(judgeMutualExperiment(facts({ poolMin: -1 }), facts()).verdict, "kill");
  assert.equal(judgeMutualExperiment(facts({ claims: 6, premiums: 300 }), facts()).verdict, "kill", "6 against 4 per 100 is 50 percent more");
  assert.equal(judgeMutualExperiment(facts({ claims: 5, premiums: 300, claimsPaid: 90 }), facts()).verdict, "keep", "5 against 4 is exactly 25 percent: not over the line");
  assert.equal(judgeMutualExperiment(facts({ claims: 3 }), facts({ claims: 0, claimsPaid: 0 })).verdict, "kill", "three claims where the standard arm had none");
});

test("continue: a premium that has not fallen enough or a worse loss ratio; too little data under 30 jobs an arm", () => {
  const same = judgeMutualExperiment(facts(), facts());
  assert.equal(same.verdict, "continue");
  assert.match(same.reasons.join(" "), /15 percent/);
  const worse = judgeMutualExperiment(facts({ premiums: 300, claimsPaid: 200 }), facts());
  assert.equal(worse.verdict, "continue");
  assert.match(worse.reasons.join(" "), /loss ratio/);
  assert.equal(judgeMutualExperiment(facts({ jobs: 29 }), facts()).verdict, "too_little_data");
  assert.deepEqual(mutualMeasures(facts({ premiums: 0, jobs: 0, cleanJobs: 0 })), { lossRatio: null, claimsPer100Jobs: null, premiumPerCleanJob: null });
});
