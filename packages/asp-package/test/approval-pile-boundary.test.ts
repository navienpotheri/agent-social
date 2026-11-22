// Boundary cases of the approval pile (mutation review, 2026-11-22): no more requests are asked once the unanswered ones EQUAL the limit (2 by default); the first refusal tells the person once; the session stops at
// exactly the stop count (6 by default) and only once; the environment sets the limits only when it is a positive number, rounded down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalPile } from "../src/approval-pile.ts";

test("the defaults are 2 unanswered and 6 refusals; the pile closes at exactly 2 unanswered, not at 1", () => {
  const p = new ApprovalPile({ env: {} });
  assert.deepEqual([p.maxUnanswered, p.stopAfter], [2, 6]);
  assert.equal(p.closed, false);
  p.noteUnanswered();
  assert.equal(p.closed, false, "one unanswered");
  assert.equal(p.unansweredCount, 1);
  p.noteUnanswered();
  assert.equal(p.closed, true, "two unanswered");
});

test("the first refusal at once tells the person and no later one does; the session stops at the sixth refusal and only then, once", () => {
  const p = new ApprovalPile({ env: {} });
  p.noteUnanswered(); p.noteUnanswered();
  const notified: boolean[] = [], stopped: boolean[] = [];
  for (let i = 1; i <= 8; i++) { const r = p.refuseAtOnce("shell.exec"); notified.push(!!r.notify); stopped.push(!!r.stop); assert.match(r.reason, /needs the principal's approval, and 2 earlier approval request/); }
  assert.deepEqual(notified, [true, false, false, false, false, false, false, false]);
  assert.deepEqual(stopped, [false, false, false, false, false, true, false, false], "stopped at the sixth, not the fifth, and once");
  assert.equal(p.refusedAtOnceCount, 8);
});

test("stated limits are used exactly: 3 unanswered and a stop at 2 refusals", () => {
  const p = new ApprovalPile({ maxUnanswered: 3, stopAfter: 2, env: {} });
  p.noteUnanswered(); p.noteUnanswered();
  assert.equal(p.closed, false);
  p.noteUnanswered();
  assert.equal(p.closed, true);
  assert.equal(!!p.refuseAtOnce("x").stop, false);
  assert.equal(!!p.refuseAtOnce("x").stop, true);
});

test("the environment sets a limit only when it is a positive number, rounded down; anything else keeps the default; an option wins over the environment", () => {
  const e = (a: string | undefined, b: string | undefined) => new ApprovalPile({ env: { ASP_MAX_UNANSWERED_APPROVALS: a, ASP_STOP_AFTER_UNANSWERED: b } });
  assert.deepEqual([e("5", "9").maxUnanswered, e("5", "9").stopAfter], [5, 9]);
  assert.equal(e("3.9", undefined).maxUnanswered, 3, "rounded down");
  assert.equal(e("1", undefined).maxUnanswered, 1, "one is positive");
  for (const bad of ["0", "-1", "abc", "", undefined]) assert.equal(e(bad, undefined).maxUnanswered, 2, String(bad));
  for (const bad of ["0", "-3", "x"]) assert.equal(e(undefined, bad).stopAfter, 6, bad);
  assert.equal(new ApprovalPile({ maxUnanswered: 4, env: { ASP_MAX_UNANSWERED_APPROVALS: "9" } }).maxUnanswered, 4);
});

test("a decision reason is recognised as unanswered only when it says no answer or did not answer within", () => {
  assert.equal(ApprovalPile.isUnanswered("no answer within 600 seconds"), true);
  assert.equal(ApprovalPile.isUnanswered("the principal did not answer within 10 minutes"), true);
  assert.equal(ApprovalPile.isUnanswered("the principal said no"), false);
  assert.equal(ApprovalPile.isUnanswered(undefined), false);
  assert.equal(ApprovalPile.isUnanswered("xno answer within 5 seconds"), false, "the phrase starts at a word");
  assert.equal(ApprovalPile.isUnanswered("an answer within reason"), false);
});
