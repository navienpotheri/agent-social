// The exact edges of the gateway's loop breaker (register rows DK1230 and DK1478; found loose by a mutation check): a limit is hit AT its value for equivalent calls and near-repeats, and only PAST its value for depth
// and tokens; the lower of the Mandate's and the ceiling's limit wins. Pure, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayBreaker, loopLimitsFrom, nearCount, normalizeCall } from "../src/agent-guards.ts";

test("tokens: exactly the daily cap is allowed, one more halts", () => {
  const b = new GatewayBreaker({ dailyTokens: 100 });
  assert.equal(b.check("read", { n: 1 }, 100), null);
  assert.equal(b.check("read", { n: 2 }, 101)?.reason, "token_cap");
});

test("equivalent calls: the Nth identical call halts, the one before does not", () => {
  const b = new GatewayBreaker({ equivalentCalls: 3 });
  assert.equal(b.check("t", { a: 1 }, 0), null);
  assert.equal(b.check("t", { a: 1 }, 0), null);
  assert.equal(b.check("t", { a: 1 }, 0)?.reason, "equivalent_calls");
});

test("depth: a chain of exactly the depth is allowed, one more spawn halts, and any other call resets the chain", () => {
  const b = new GatewayBreaker({ depth: 2 });
  assert.equal(b.check("task", { i: 1 }, 0), null);
  assert.equal(b.check("task", { i: 2 }, 0), null);
  assert.equal(b.check("read", {}, 0), null);
  assert.equal(b.check("task", { i: 3 }, 0), null);
  assert.equal(b.check("task", { i: 4 }, 0), null);
  assert.equal(b.check("task", { i: 5 }, 0)?.reason, "depth");
});

test("near repeats: the Nth alike call inside the window halts; alike calls older than the window do not count", () => {
  const b = new GatewayBreaker({ nearRepeats: 3, nearWindow: 4 });
  assert.equal(b.check("open", { path: "/a/1" }, 0), null);
  assert.equal(b.check("open", { path: "/a/2" }, 0), null);
  assert.equal(b.check("open", { path: "/a/3" }, 0)?.reason, "near_repeat");
  const c = new GatewayBreaker({ nearRepeats: 3, nearWindow: 4 });
  c.check("open", { path: "/a/1" }, 0);
  c.check("open", { path: "/a/2" }, 0);
  for (const t of ["w", "x", "y"]) c.check(t, {}, 0); // the two alike calls are now older than the window
  assert.equal(c.check("open", { path: "/a/9" }, 0), null, "only one alike call is inside the last four");
});

test("nearCount counts the newest call and the window's earlier calls, no more", () => {
  assert.equal(nearCount(["k", "k", "k", "k"], "k", 3), 3, "a window of 3 holds the newest and the 2 before it");
  assert.equal(nearCount(["k", "x", "k"], "k", 5), 3);
});

test("normalisation makes numbers, ids and spacing alike and keeps the tool and the shape", () => {
  assert.equal(normalizeCall("open", { path: "/a/17", note: "try  3" }), normalizeCall("open", { path: "/a/99", note: "try 4" }));
  assert.notEqual(normalizeCall("open", { path: "/a/1" }), normalizeCall("close", { path: "/a/1" }));
  assert.notEqual(normalizeCall("open", { path: "/a/1" }), normalizeCall("open", { file: "/a/1" }));
  assert.equal(normalizeCall("t", { id: "123e4567-e89b-12d3-a456-426614174000" }), normalizeCall("t", { id: "223e4567-e89b-12d3-a456-426614174999" }));
});

test("the lower limit wins and a limit neither states is absent", () => {
  assert.deepEqual(loopLimitsFrom({ loop_limits: { equivalent_calls: 8 } }, { loop_limits: { equivalent_calls: 5 } }), { equivalentCalls: 5 });
  assert.deepEqual(loopLimitsFrom({ loop_limits: { equivalent_calls: 4 } }, { loop_limits: { equivalent_calls: 9 } }), { equivalentCalls: 4 });
  assert.deepEqual(loopLimitsFrom({}, {}), {});
});
