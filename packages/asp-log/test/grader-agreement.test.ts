/**
 * A judge's agreement with the deterministic check as a record (register row DK1223, from DK802; spec-delta S1651): the totals are kept, a run set counts once, agreements cannot exceed runs, and the grader's weight is its pooled
 * agreement in permille with a prior of half. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { kit, mk, refusedBy, type Party } from "./society-kit.ts";

test("DK1223: a grader's weight follows its recorded agreement; a set counts once; agreed cannot exceed runs", async () => {
  const k = await kit();
  const judge = await k.person("ga-judge");
  const rec = (runs: number, agreed: number, set: string) => mk("grader_agreement", judge as Party, { runs, agreed, run_set_sha256: set.repeat(64) }, null, { subject: null });
  assert.deepEqual(await k.log.graderWeight(judge.did), { weight: 500, runs: 0, agreed: 0 }, "no record weighs a half");
  assert.equal(await refusedBy(k.log.append(rec(10, 11, "1"))), "grader_agreement_exceeds_runs");
  await k.log.append(rec(90, 90, "1"));
  assert.deepEqual(await k.log.graderWeight(judge.did), { weight: 950, runs: 90, agreed: 90 }, "(90 + 5) of (90 + 10)");
  assert.equal(await refusedBy(k.log.append(rec(90, 90, "1"))), "grader_agreement_known", "the same run set is not counted twice");
  await k.log.append(rec(100, 40, "2"));
  assert.deepEqual(await k.log.graderWeight(judge.did), { weight: 675, runs: 190, agreed: 130 }, "pooled: (130 + 5) of (190 + 10) = 675");
  assert.equal((await k.log.verify()).ok, true);
});
