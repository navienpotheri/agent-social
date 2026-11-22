// The cohort demo's measures and the post-course check (register rows DK1753, DK752 and DK753; found loose by a mutation check: all eight mutants of the lift statistic, the held-out score and the checkup survived the
// existing tests): the held-out score and its regressions, the Welch t with no spread, and the check's flags. Scripted agents on a toy world; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heldoutScore, liftStat, type AgentStory, type Story } from "../src/lens-courses/cohort.ts";
import { checkupRows } from "../src/lens-courses/cohort-monitor.ts";
import { honestLessons, overbroadLessons } from "../src/lens-courses/reflection.ts";

test("liftStat: a difference in mean lift with a Welch standard error; with no spread t is 0 for no difference and infinite for one; one agent has no variance", () => {
  const s = liftStat([10, 20, 30], [0, 10, 20]);
  assert.equal(s.difference, 10);
  assert.equal(s.mean_lift_cohort, 20);
  assert.equal(s.se, 8.2, "sqrt(100/3 + 100/3) = 8.16");
  assert.equal(s.t, 1.2);
  assert.equal(liftStat([5, 5], [5, 5]).t, 0);
  assert.equal(liftStat([9, 9], [5, 5]).t, Infinity);
  assert.equal(liftStat([20], [10, 10]).se, 0, "an arm of one has no variance");
});

test("heldoutScore: accuracy and baseline in permille, rounded; an honest memory lifts and does not regress; a memory that is only a broad rule regresses tasks the empty memory got right", () => {
  const seed = "sha256:" + "ab".repeat(32);
  const none = heldoutScore([], seed);
  assert.equal(none.accuracy, none.baseline, "an empty memory is its own baseline");
  assert.equal(none.regressions, 0);
  assert.equal(Number.isInteger(none.accuracy), true, "whole permille");
  const honest = heldoutScore(honestLessons().lessons, seed);
  assert.ok(honest.accuracy > honest.baseline, "an honest lesson set lifts the score");
  const broad = heldoutScore(overbroadLessons().lessons, seed);
  assert.ok(broad.regressions >= 1, "a rule that is too broad breaks a task that was right without it");
  assert.ok(broad.regressions <= broad.n);
  assert.equal(honest.baseline, none.baseline);
});

test("checkupRows: a clean agent is ok; an agent whose lift is gone is flagged, and only strictly below half the lift counts as lost", () => {
  const seed = "sha256:" + "cd".repeat(32);
  const base = heldoutScore([], seed).accuracy;
  const agent = (handle: string, over: Partial<AgentStory> = {}): AgentStory => ({ id: handle, handle, level: "sponsored", house: false, group: "cohort", script: "honest", enrolled: true, passed: true, completed: true, written_back: true, before: base, after: base, lift: 0, regressions: 0, heldout_seed: seed, lessons: honestLessons().lessons, paid: 0, failures: [], other: [], ...over });
  const story = (agents: AgentStory[]) => ({ seed: "s", agents }) as unknown as Story;
  // a single agent is the one whose memory is emptied: it has no lift now; with a lift of 0 then, a lift of nothing is not a lift lost
  const r = checkupRows(story([agent("a", { lift: 0 })]))[0];
  assert.equal(r.drift, "memory emptied since the course");
  assert.equal(r.flag, "ok", "no lift then and none now is not a loss");
  const lost = checkupRows(story([agent("a", { lift: 200, after: base + 200 })]))[0];
  assert.equal(lost.flag, "lift lost");
  assert.equal(lost.lift_now, 0);
  // rows are sorted by handle, and agents that did not write back are not re-measured
  const rows = checkupRows(story([agent("b"), agent("a"), agent("c", { written_back: false })]));
  assert.deepEqual(rows.map((x) => x.handle), ["a", "b"]);
  // the drift is chosen by a hash of the story: of two agents one has its memory emptied and the other a broad rule added. The broad rule regresses tasks (flag "regressed"); with a bigger lift then, it has also lost lift
  const two = (lift: number) => Object.fromEntries(checkupRows(story([agent("a", { lift, after: base + lift }), agent("b", { lift, after: base + lift })])).map((x) => [x.drift, x]));
  assert.equal(two(200)["a broad rule added since the course"].flag, "regressed", "regressions above one, lift kept");
  assert.equal(two(1000)["a broad rule added since the course"].flag, "lift lost and regressed", "both at once");
  assert.equal(two(200)["memory emptied since the course"].flag, "lift lost");
});
