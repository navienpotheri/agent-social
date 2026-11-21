/**
 * Loop breaker, fleet roles and the unprompted-action marker (register rows DK843, DK821 and DK822; spec-deltas S1231 to S1233). Scripted agents; credits are mock accounting entries.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomSeed, b64urlDecode, verifyBytes, publicKeyFromSeed } from "@agent-social/asp-core";
import { ActionRecorder, Fleet, LoopBreaker } from "../src/agent-guards.ts";

test("DK843: a scripted looping agent is halted at the cap with a signed record and credits stop draining; varying arguments are not halted; a depth beyond the cap and a token cap each halt", () => {
  const seed = randomSeed();
  const mk = () => new LoopBreaker({ maxEquivalent: 5, maxDepth: 4, dailyTokenCap: 1000, creditPerCall: 2, seed });
  const loop = mk();
  let ran = 0;
  for (let i = 0; i < 100; i++) if (loop.call("search", { q: "same" }, 1, 10).ok) ran++;
  assert.equal(ran, 4, "halted on the fifth equivalent call");
  assert.equal(loop.creditsSpent, 8, "credits stop draining at the halt");
  assert.equal(loop.halted?.reason, "equivalent_calls");
  const h = loop.halted!;
  const body = JSON.stringify({ reason: h.reason, at: h.at, detail: h.detail });
  assert.equal(verifyBytes(b64urlDecode(h.sig), new TextEncoder().encode(body), publicKeyFromSeed(seed)), true, "the halted record is signed");
  const varied = mk();
  for (let i = 0; i < 40; i++) assert.equal(varied.call("search", { q: `q${i}`, page: i }, 1, 10).ok, true);
  assert.equal(varied.halted, null, "a legitimate repeated call with varying arguments is not halted");
  const keyOrder = mk();
  for (let i = 0; i < 4; i++) keyOrder.call("t", i % 2 ? { a: 1, b: 2 } : { b: 2, a: 1 }, 1, 1);
  assert.equal(keyOrder.call("t", { a: 1, b: 2 }, 1, 1).ok, false, "argument order does not hide a loop");
  assert.equal(mk().call("x", {}, 5, 1).ok, false);
  const deep = mk(); deep.call("x", {}, 9, 1);
  assert.equal(deep.halted?.reason, "depth");
  const tok = mk();
  for (let i = 0; i < 4; i++) tok.call("t", { i }, 1, 300);
  assert.equal(tok.halted?.reason, "token_cap");
  assert.equal(tok.call("t", { z: 1 }, 1, 1).ok, false, "after a halt every call is refused");
});

test("DK821: a router may dispatch and not execute, a worker wider than the router is refused, the log marks the roles, and a watchdog halts a stuck scripted worker", () => {
  const f = new Fleet("router", ["files.read", "web.search"]);
  assert.deepEqual(f.spawnWorker("w1", ["files.read"]), { ok: true });
  assert.deepEqual(f.spawnWorker("w2", ["files.read", "wire.send"]), { ok: false, code: "WORKER_WIDER_THAN_ROUTER", extra: ["wire.send"] });
  assert.equal(f.roleOf("w2"), undefined, "the refused worker is not in the log");
  f.spawnWorker("w3", ["web.search"]);
  f.addWatchdog("dog");
  assert.deepEqual(f.roleLog.map((r) => [r.agent, r.role]), [["router", "router"], ["w1", "worker"], ["w3", "worker"], ["dog", "watchdog"]]);
  assert.deepEqual(f.act("router", "dispatch"), { ok: true });
  assert.deepEqual(f.act("router", "execute"), { ok: false, code: "ROUTER_CANNOT_EXECUTE" });
  assert.deepEqual(f.act("w1", "execute"), { ok: true });
  assert.deepEqual(f.act("w1", "dispatch"), { ok: false, code: "WORKER_CANNOT_DISPATCH" });
  assert.deepEqual(f.act("w1", "halt", "w3"), { ok: false, code: "NOT_A_WATCHDOG" });
  assert.deepEqual(f.act("dog", "execute"), { ok: false, code: "WATCHDOG_CANNOT_EXECUTE" });
  assert.deepEqual(f.act("dog", "read_logs"), { ok: true });
  assert.deepEqual(f.act("nobody", "execute"), { ok: false, code: "NO_ROLE" });
  assert.deepEqual(f.watch("dog", { w1: 1, w3: 9, router: 50 }, 5), ["w3"], "the stuck worker is halted; the router is not a worker");
  assert.deepEqual(f.act("w3", "execute"), { ok: false, code: "HALTED" });
  assert.deepEqual(f.act("w1", "execute"), { ok: true });
});

test("DK822: an unprompted action is logged with the flag and refused where the Mandate forbids it or past its daily cap; the share is reported", () => {
  const no = new ActionRecorder({ allowed: false, perDayCap: 0 });
  assert.deepEqual(no.record("d1", "post", true), { ok: false, code: "UNPROMPTED_NOT_ALLOWED" });
  assert.equal(no.record("d1", "post", false).ok, true);
  assert.equal(no.rows.length, 1, "a refused action leaves no row");
  const yes = new ActionRecorder({ allowed: true, perDayCap: 2 });
  yes.record("d1", "a", false); yes.record("d1", "b", true); yes.record("d1", "c", true);
  assert.deepEqual(yes.record("d1", "d", true), { ok: false, code: "UNPROMPTED_CAP" });
  assert.equal(yes.record("d2", "e", true).ok, true, "the cap is per day");
  assert.deepEqual(yes.share(), { unprompted: 3, total: 4, permille: 750 });
  assert.deepEqual(yes.rows.filter((r) => r.unprompted).map((r) => r.action), ["b", "c", "e"]);
  assert.deepEqual(new ActionRecorder({ allowed: true, perDayCap: 1 }).share(), { unprompted: 0, total: 0, permille: 0 });
});
