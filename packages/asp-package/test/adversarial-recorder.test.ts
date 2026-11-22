// Adversarial review of the refusal recorder and the escalation ladder before the live run. A storm of the same call, a scope name of ten thousand characters, a failing log, and refusals spread over many scopes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RefusalRecorder, callSha256, type RefusalBody } from "../src/index.ts";

const make = (over: Partial<ConstructorParameters<typeof RefusalRecorder>[0]> = {}) => {
  const bodies: RefusalBody[] = []; let t = 0;
  const r = new RefusalRecorder({ agent: "did:web:x:a", append: async (b) => { bodies.push(b); }, now: () => t, ...over });
  return { r, bodies, tick: (ms: number) => { t += ms; } };
};
const ev = (i: number, scope = "shell.network") => ({ tool: "bash", scope, rule: "outside_mandate" as const, callSha256: callSha256("bash", { command: `curl h${i}` }) });

test("the same call repeated a thousand times is one record and 999 counted duplicates", async () => {
  const x = make();
  for (let i = 0; i < 1000; i++) x.r.record(ev(1));
  await x.r.flush();
  assert.deepEqual([x.bodies.length, x.r.summary().duplicates], [1, 999]);
});

test("a scope name of ten thousand characters is cut to what the schema allows, and the call's text is nowhere in the body", async () => {
  const x = make();
  x.r.record({ tool: "bash", scope: "s".repeat(10_000), rule: "outside_mandate", callSha256: callSha256("bash", { command: "SECRET-COMMAND-TEXT" }) });
  await x.r.flush();
  assert.equal(x.bodies[0].scope.length, 128);
  assert.ok(!JSON.stringify(x.bodies).includes("SECRET-COMMAND-TEXT"));
});

test("a log that rejects every record (no passport, a wrong signer) never throws into the run, and the failures are counted", async () => {
  const errors: string[] = [];
  const x = make({ append: async () => { throw new Error("gateway_refusal_unknown_agent"); }, onError: (e) => errors.push(e.message) });
  for (let i = 0; i < 30; i++) x.r.record(ev(i));
  await x.r.flush();
  assert.equal(x.r.summary().failed, 10, "only the first ten in a minute were tried; the rest were counted as overflow");
  assert.equal(x.r.summary().overflow, 20);
  assert.equal(errors.length, 10);
});

test("a hash is of the tool name and the arguments together: two different tools with the same arguments are two refusals (a different key order is a different hash: the cap, not the hash, bounds a storm)", () => {
  assert.notEqual(callSha256("bash", { a: 1 }), callSha256("sh", { a: 1 }));
  assert.equal(callSha256("bash", { a: 1, b: 2 }).length, 64);
});
