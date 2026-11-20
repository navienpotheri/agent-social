/**
 * A welcome inbox, a pooled mission and a boundary page (register rows DK839, DK813 and DK824; spec-deltas S1240 to S1242). Scripted newcomers, funders and rules; credits are mock accounting entries.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mission, Welcome, attemptFlow, boundaryPage, flowsFrom } from "../src/commons-flows.ts";

test("DK839: a scripted newcomer's first reply is answered by a house greeter within the target, the inbox shows the answer, the grade, the handout and the lesson result, and house agents are not in the health counts", () => {
  const w = new Welcome(15);
  w.join("greeter-1", true); w.join("newcomer-1"); w.join("member-2");
  w.firstReply("newcomer-1", 100, "hello, where do I start?");
  assert.deepEqual(w.greet("newcomer-1", 105), { answered: [], refused: true }, "only a labelled house agent greets");
  assert.deepEqual(w.greet("greeter-1", 110), { answered: ["newcomer-1"], refused: false });
  assert.deepEqual(w.slaMet(), [{ newcomer: "newcomer-1", minutes: 10, met: true }]);
  w.grade("newcomer-1", 4); w.lesson("newcomer-1", "C-L1-1", true);
  const inbox = w.inbox("newcomer-1");
  assert.equal(inbox.replies.length, 1);
  assert.equal(inbox.replies[0].from, "greeter-1");
  assert.deepEqual([inbox.grades, inbox.handoutAvailable, inbox.lessons], [[4], true, [{ lesson: "C-L1-1", passed: true }]]);
  assert.deepEqual(w.inbox("member-2"), { replies: [], grades: [], handoutAvailable: false, lessons: [] });
  assert.deepEqual(w.health(), { members: 2, houseAgents: 1, repliesByMembers: 1 }, "the greeter's reply is not counted as member activity");
  w.firstReply("member-2", 200, "hi");
  w.greet("greeter-1", 230);
  assert.equal(w.slaMet()[1].met, false, "30 minutes is beyond a target of 15");
});

test("DK813: a scripted free-rider gets no share, contributors split by their recorded shares, conservation holds with rounding, and an unverified goal refunds the funders", () => {
  const m = new Mission();
  m.fund("f1", 50); m.fund("f2", 50);
  m.contribute("c1", 3); m.contribute("c2", 1); m.contribute("rider", 0);
  const r = m.settle(true);
  assert.deepEqual(r, { ok: true, payouts: { c1: 75, c2: 25 } });
  assert.equal("rider" in (r as { payouts: object }).payouts, false);
  assert.equal(Object.values((r as { payouts: Record<string, number> }).payouts).reduce((a, b) => a + b, 0), m.pool(), "the whole pool is paid, nothing created");
  assert.deepEqual(m.settle(true), { ok: false, code: "NOT_OPEN" });
  const odd = new Mission(); odd.fund("f", 10); odd.contribute("a", 1); odd.contribute("b", 1); odd.contribute("c", 1);
  const p = (odd.settle(true) as { payouts: Record<string, number> }).payouts;
  assert.deepEqual(Object.values(p).sort(), [3, 3, 4]);
  assert.equal(Object.values(p).reduce((a, b) => a + b, 0), 10);
  const failed = new Mission(); failed.fund("f1", 30); failed.fund("f2", 70); failed.contribute("c", 5);
  assert.deepEqual(failed.settle(false), { ok: true, payouts: { f1: 30, f2: 70 } });
  assert.deepEqual(new Mission().settle(true), { ok: false, code: "NO_FUNDING" });
  const none = new Mission(); none.fund("f", 5);
  assert.deepEqual(none.settle(true), { ok: false, code: "NO_CONTRIBUTIONS_RECORDED" });
});

test("DK824: the boundary page is generated from the rules, a scripted attempt to move credits out is refused and the page says so, and changing a rule changes the page", () => {
  const rules = { creditsOut: "none", informationIn: "untrusted", jobsIn: "people_only" } as const;
  assert.deepEqual(attemptFlow(rules, "credits", "out"), { ok: false, code: "BOUNDARY_CLOSED", rule: "creditsOut=none" });
  const page = boundaryPage(rules);
  assert.match(page, /Credits out: none\./);
  assert.match(page, /Information in: untrusted\./);
  assert.match(page, /Jobs in: people only\./);
  assert.match(page, /<td>credits<\/td><td>out<\/td><td>intentional<\/td><td>closed<\/td>/);
  assert.match(page, /<td>attention<\/td><td>in<\/td><td>emergent<\/td><td>open<\/td>/, "emergent flows are listed as such");
  assert.deepEqual(attemptFlow(rules, "information", "in"), { ok: true });
  const open = { ...rules, creditsOut: "allowed" } as const;
  assert.deepEqual(attemptFlow(open, "credits", "out"), { ok: true });
  assert.match(boundaryPage(open), /Credits out: allowed\./);
  assert.deepEqual(flowsFrom(rules).filter((f) => f.origin === "emergent").map((f) => f.flow), ["reputation", "attention"]);
});
