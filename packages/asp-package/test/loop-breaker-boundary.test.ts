// Boundary cases of the loop breaker and its limits (mutation review, 2026-11-22): the call that makes the count reach the limit halts, the one before does not; depth counts agents started one after another and any other
// call starts the count again; the daily token cap halts above it, not at it; the lower of the Mandate's and the fleet's limit wins; a halt is kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayBreaker, loopLimitsFrom } from "../src/agent-guards.ts";

test("equivalent calls: the third identical call halts at a limit of 3, the second does not; a different argument is a different call", () => {
  const b = new GatewayBreaker({ equivalentCalls: 3 });
  assert.equal(b.check("bash", { command: "ls" }, 0), null);
  assert.equal(b.check("bash", { command: "pwd" }, 0), null);
  assert.equal(b.check("bash", { command: "ls" }, 0), null, "the second ls");
  const h = b.check("bash", { command: "ls" }, 0);
  assert.equal(h?.reason, "equivalent_calls");
  assert.equal(h?.count, 3);
  assert.equal(h?.limit, 3);
  assert.equal(b.check("bash", { command: "other" }, 0), h, "a halt is kept: every later call gets it");
  assert.equal(new GatewayBreaker({ equivalentCalls: 2 }).check("a", {}, 0), null);
  const two = new GatewayBreaker({ equivalentCalls: 2 }); two.check("a", { x: 1 }, 0);
  assert.equal(two.check("a", { x: 1 }, 0)?.reason, "equivalent_calls", "at a limit of 2 the second halts");
  assert.equal(new GatewayBreaker({}).check("a", {}, 0), null, "no limit, no halt");
});

test("the order of the arguments does not make a call different", () => {
  const b = new GatewayBreaker({ equivalentCalls: 2 });
  b.check("t", { a: 1, b: 2 }, 0);
  assert.equal(b.check("t", { b: 2, a: 1 }, 0)?.reason, "equivalent_calls");
});

test("depth: at a limit of 2 two agents started one after another are allowed and the third halts; any other call starts the count again", () => {
  const b = new GatewayBreaker({ depth: 2 });
  assert.equal(b.check("spawn_agent", { n: 1 }, 0), null);
  assert.equal(b.check("task", { n: 2 }, 0), null);
  const h = b.check("subagent", { n: 3 }, 0);
  assert.equal(h?.reason, "depth");
  assert.equal(h?.count, 3);
  const c = new GatewayBreaker({ depth: 2 });
  c.check("spawn_agent", { n: 1 }, 0); c.check("spawn_agent", { n: 2 }, 0);
  assert.equal(c.check("read_file", { p: "a" }, 0), null, "another call");
  assert.equal(c.check("spawn_agent", { n: 3 }, 0), null, "the count started again");
  assert.equal(c.check("spawn_agent", { n: 4 }, 0), null);
  assert.equal(c.check("spawn_agent", { n: 5 }, 0)?.reason, "depth");
  for (const t of ["dispatch-agent", "mcp__x__spawn_it", "mcp__y__delegate_work", "Agent", "TASK"]) { const d = new GatewayBreaker({ depth: 1 }); d.check(t, { i: 1 }, 0); assert.equal(d.check(t, { i: 2 }, 0)?.reason, "depth", t); }
  for (const t of ["read_task", "agents_list", "spawn"]) { const d = new GatewayBreaker({ depth: 1 }); d.check(t, { i: 1 }, 0); assert.equal(d.check(t, { i: 2 }, 0), null, t); }
});

test("near repeats: the third call that differs only in a number halts at a limit of 3, the second does not; the window forgets older calls", () => {
  const b = new GatewayBreaker({ nearRepeats: 3 });
  assert.equal(b.check("bash", { command: "curl http://x/1" }, 0), null);
  assert.equal(b.check("bash", { command: "curl http://x/2" }, 0), null);
  const h = b.check("bash", { command: "curl http://x/3" }, 0);
  assert.equal(h?.reason, "near_repeat");
  assert.equal(h?.count, 3);
  assert.equal(h?.limit, 3);
  // a window of 3: two near repeats, three other calls, then another: the first two have left the window
  const w = new GatewayBreaker({ nearRepeats: 3, nearWindow: 3 });
  w.check("bash", { command: "curl http://x/1" }, 0); w.check("bash", { command: "curl http://x/2" }, 0);
  for (const f of ["ls", "pwd", "whoami"]) assert.equal(w.check("sh", { command: f }, 0), null);
  assert.equal(w.check("bash", { command: "curl http://x/3" }, 0), null, "the two earlier calls are outside a window of 3");
});

test("the daily token cap halts above it and not at it", () => {
  const b = new GatewayBreaker({ dailyTokens: 1000 });
  assert.equal(b.check("a", { i: 1 }, 999), null);
  assert.equal(b.check("a", { i: 2 }, 1000), null, "exactly at the cap");
  const h = b.check("a", { i: 3 }, 1001);
  assert.equal(h?.reason, "token_cap");
  assert.equal(h?.count, 1001);
  assert.equal(h?.limit, 1000);
});

test("the loop limits of a run are the lower of the Mandate's and the fleet ceiling's, and a limit neither states is absent", () => {
  assert.deepEqual(loopLimitsFrom({ loop_limits: { equivalent_calls: 5, depth: 3, near_repeats: 6 }, token_budget: { per_day: 1000 } }, { loop_limits: { equivalent_calls: 4, depth: 9, near_repeats: 3 }, token_budget: { per_day: 500 } }), { equivalentCalls: 4, depth: 3, nearRepeats: 3, dailyTokens: 500 });
  assert.deepEqual(loopLimitsFrom({}, { loop_limits: { depth: 2 } }), { depth: 2 }, "the ceiling alone");
  assert.deepEqual(loopLimitsFrom({ loop_limits: { equivalent_calls: 7 } }), { equivalentCalls: 7 }, "the Mandate alone");
  assert.deepEqual(loopLimitsFrom(undefined, undefined), {});
  assert.deepEqual(loopLimitsFrom({ loop_limits: { equivalent_calls: 4 } }, { loop_limits: { equivalent_calls: 4 } }), { equivalentCalls: 4 });
});

test("the near-repeat window is the newest call and the 23 before it by default: two near repeats and 21 other calls still count, 22 do not; a window of 3 holds the newest and the two before", () => {
  const run = (others: number) => {
    const d = new GatewayBreaker({ nearRepeats: 3 });
    d.check("bash", { command: "curl http://x/1" }, 0); d.check("bash", { command: "curl http://x/2" }, 0);
    for (let i = 0; i < others; i++) d.check("sh", { command: "echo " + "q".repeat(i + 1) }, 0);
    return d.check("bash", { command: "curl http://x/3" }, 0);
  };
  assert.equal(run(21)?.reason, "near_repeat", "the two earlier calls are 22 and 23 back");
  assert.equal(run(22), null, "the first is 24 back: outside");
  const w = new GatewayBreaker({ nearRepeats: 3, nearWindow: 3 });
  w.check("bash", { command: "curl http://x/1" }, 0); w.check("bash", { command: "curl http://x/2" }, 0);
  assert.equal(w.check("bash", { command: "curl http://x/3" }, 0)?.reason, "near_repeat");
  const w2 = new GatewayBreaker({ nearRepeats: 3, nearWindow: 3 });
  w2.check("bash", { command: "curl http://x/1" }, 0); w2.check("bash", { command: "curl http://x/2" }, 0); w2.check("sh", { command: "ls" }, 0);
  assert.equal(w2.check("bash", { command: "curl http://x/3" }, 0), null, "with one other call between, the first is 3 back: outside a window of 3");
});
