// Rows DK1607 and AG3 (S1601): the gateway's refusal recorder. A refusal becomes one body with the scope, a rule class and the hash of the call, never the call; the same call is recorded once; a storm is bounded by
// a per-minute and a per-run cap and what is not recorded is counted and reported, not silently dropped; a failed append is counted and does not stop the run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RefusalRecorder, callSha256, refusalRule, type RefusalBody } from "../src/index.ts";

const rec = (over: Partial<ConstructorParameters<typeof RefusalRecorder>[0]> = {}) => {
  const bodies: RefusalBody[] = []; const overflows: unknown[] = []; let t = 0;
  const r = new RefusalRecorder({ agent: "did:web:x:a", contract: "sha256:" + "1".repeat(64), append: async (b) => { bodies.push(b); }, now: () => t, onOverflow: (e) => overflows.push(e), ...over });
  return { r, bodies, overflows, tick: (ms: number) => { t += ms; } };
};
const ev = (i: number) => ({ tool: "bash", scope: "shell.network", rule: "outside_mandate" as const, callSha256: callSha256("bash", { command: `curl https://h${i}.example.net` }) });

test("the rule classes follow the gateway's own reasons", () => {
  assert.equal(refusalRule("the scope shell.network is not granted by this job's Mandate", "shell.network"), "outside_mandate");
  assert.equal(refusalRule("the host login.victim.example is not one this job's Mandate allows (docs.example.org)", "shell.network"), "network_host");
  assert.equal(refusalRule("[ASP] this call (shell.network) reaches outward and was not run: you just read text written by another agent", "shell.network"), "injection_hold");
  assert.equal(refusalRule("[ASP] this call was not run: it carries 1 value(s) copied from a tool result", "web.read"), "injection_hold");
  assert.equal(refusalRule("the host docs.example.org was called 2 times in the last minute; this job's Mandate allows 2 a minute", "shell.network"), "budget");
  assert.equal(refusalRule("[ASP] outbound scan: this call carries secret and was not sent", "shell.exec"), "forbidden_means");
  assert.equal(refusalRule(undefined, "x"), "outside_mandate");
});

test("a record is a body of scope, rule, contract and the hash of the call, and the hash is of the call but is not the call", async () => {
  const x = rec();
  x.r.record(ev(1));
  await x.r.flush();
  assert.equal(x.bodies.length, 1);
  assert.deepEqual(Object.keys(x.bodies[0]).sort(), ["agent", "at", "call_sha256", "contract", "rule", "scope"]);
  assert.match(x.bodies[0].call_sha256, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(x.bodies).includes("example.net"));
  assert.equal(callSha256("bash", { command: "a" }), callSha256("bash", { command: "a" }));
  assert.notEqual(callSha256("bash", { command: "a" }), callSha256("bash", { command: "b" }));
});

test("the same call is recorded once; a storm of 500 distinct refusals is bounded to 10 a minute and 50 a run, and the rest is counted", async () => {
  const x = rec();
  x.r.record(ev(1)); x.r.record(ev(1)); x.r.record(ev(1));
  await x.r.flush();
  assert.equal(x.r.summary().recorded, 1);
  assert.equal(x.r.summary().duplicates, 2);
  const s = rec();
  for (let i = 0; i < 500; i++) s.r.record(ev(i));
  await s.r.flush();
  assert.equal(s.r.summary().recorded, 10, "ten in the first minute");
  assert.equal(s.r.summary().overflow, 490, "the rest is counted");
  assert.equal(s.overflows.length, 490);
  assert.equal((s.overflows[0] as { reason: string }).reason, "per_minute");
  // a minute later the next ten go in, up to the run's cap of fifty
  for (let m = 0; m < 8; m++) { s.tick(61_000); for (let i = 0; i < 20; i++) s.r.record(ev(1000 + m * 100 + i)); }
  await s.r.flush();
  assert.equal(s.r.summary().recorded, 50, "fifty a run, and no more");
  assert.ok(s.overflows.some((o) => (o as { reason: string }).reason === "per_run"));
});

test("a refusal the log will not take is counted as failed, and the run goes on", async () => {
  const errors: string[] = [];
  const x = rec({ append: async () => { throw new Error("gateway_refusal_unknown_agent: no passport"); }, onError: (e) => errors.push(e.message) });
  x.r.record(ev(1)); x.r.record(ev(2));
  await x.r.flush();
  assert.deepEqual(x.r.summary(), { recorded: 0, duplicates: 0, overflow: 0, failed: 2 });
  assert.equal(errors.length, 2);
});
