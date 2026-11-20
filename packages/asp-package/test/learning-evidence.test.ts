/**
 * Path grading, the learning-progress stipend and episodes-to-fix (register rows DK848, DK817 and DK815; spec-deltas S1237 to S1239). Scripted agents and a toy world; credits are mock accounting entries.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { exposureFingerprint, gradePath, regress, scriptedStream, stipendFor, stipendRun } from "../src/learning-evidence.ts";

const graph = { search: [], read: ["search"], cite: ["read"], answer: ["read"] };

test("DK848: a scripted agent that reaches the right answer through an invented call fails; a reordered valid path passes; missing calls, order violations and wrong answers are each named", () => {
  assert.deepEqual(gradePath(["search", "read", "cite", "answer"], graph, true), { pass: true, failures: [], invented: [], missing: [], violations: [] });
  const invented = gradePath(["search", "read", "magic_oracle", "cite", "answer"], graph, true);
  assert.equal(invented.pass, false, "the right answer through an invented call fails");
  assert.deepEqual([invented.failures, invented.invented], [["invented_call"], ["magic_oracle"]]);
  assert.equal(gradePath(["search", "read", "answer", "cite"], graph, true).pass, true, "a reordered valid path passes");
  assert.deepEqual(gradePath(["read", "search", "cite", "answer"], graph, true).failures, ["order_violation"]);
  assert.deepEqual(gradePath(["search", "read", "answer"], graph, true).missing, ["cite"]);
  assert.deepEqual(gradePath(["search", "read", "cite", "answer"], graph, false).failures, ["wrong_outcome"]);
  const r = regress([
    { calls: ["search", "read", "cite", "answer"], outcomeOk: true },
    { calls: ["search", "read", "answer", "cite"], outcomeOk: true },
    { calls: ["search", "read", "ghost", "cite", "answer"], outcomeOk: true },
    { calls: ["search", "read", "cite", "answer"], outcomeOk: false },
  ], graph);
  assert.deepEqual([r.n, r.passPermille, r.rightAnswerWrongPath, r.byFailure.invented_call, r.byFailure.wrong_outcome], [4, 500, 1, 1, 1]);
});

test("DK817: a novelty-seeking scripted agent stays at the noise and earns nothing; a progress-seeking one earns and improves; recovered ground is not paid twice", () => {
  const novelty = stipendRun("novelty", 80, 7);
  assert.deepEqual([novelty.attended.learnable, novelty.attended.noise], [0, 80], "it never leaves the noise");
  assert.deepEqual([novelty.earned, novelty.finalProbePermille], [0, 0]);
  const progress = stipendRun("progress", 80, 7);
  assert.equal(progress.finalProbePermille, 1000, "it learns every probe");
  assert.equal(progress.earned, 40, "five credits for each of eight keys");
  assert.ok(progress.attended.learnable >= 8 && progress.attended.noise >= 1);
  assert.deepEqual(stipendRun("progress", 80, 7), progress, "deterministic");
  assert.equal(stipendFor([0, 500, 100, 500, 500]).paid, 20, "dropping and recovering earns nothing for the recovery");
  assert.equal(stipendFor([0, 500, 100, 600]).paid, 24, "only the step above the best so far is paid");
  assert.equal(stipendFor([300, 300, 300]).paid, 0);
});

test("DK815: two scripted learners with different speeds get different episodes-to-fix on the same stream, exposure is the stream length, and a failure still repeating has none", () => {
  const fast = exposureFingerprint(scriptedStream(2, ["a", "b"], 40), 5);
  const slow = exposureFingerprint(scriptedStream(6, ["a", "b"], 40), 5);
  assert.equal(fast.exposure, 40);
  assert.deepEqual(fast.entries.map((e) => [e.tag, e.episodesToFix, e.occurrences]), [["a", 3, 2], ["b", 3, 2]]);
  assert.deepEqual(slow.entries.map((e) => [e.tag, e.episodesToFix, e.occurrences]), [["a", 11, 6], ["b", 11, 6]]);
  assert.ok(slow.entries[0].episodesToFix! > fast.entries[0].episodesToFix!);
  assert.deepEqual(exposureFingerprint(scriptedStream(30, ["a", "b"], 40), 5).entries.map((e) => e.episodesToFix), [null, null], "still repeating at the end of the stream");
  assert.deepEqual(exposureFingerprint([], 5), { exposure: 0, entries: [] });
});
