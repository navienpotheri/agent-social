/**
 * A model swap holds an agent at the entry tier (register row DK1605; spec-delta S1555): after the model behind an agent changed, every gate that reads the tier sees at most tier 1 until the agent passes an exam of its
 * own, and the stored reputation is not touched. Also the breach column of the per-model table (the incident record of DK1714). Fake keys only; credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { examSeed, examVariant, modelTrust } from "../src/index.ts";
import { Kit, SERVICES, hashOf, refused, registrar } from "./academy-kit.ts";

test("DK1605: a swapped agent is refused work above the entry tier until it passes an exam of its own, and the exam restores it", async () => {
  const k = new Kit();
  await k.priceList();
  const learner = await k.agent("learner");
  await k.fund(learner, 200);
  const [p1, p2] = [await k.person("p1"), await k.person("p2")];
  const def = await k.defineExam("foundations-v1", "foundations", 1);
  const used: number[] = [];
  const sit = async (score: number) => { const id = await k.sit(learner, def, score, {}, 800, used.length, used); used.push(examVariant(examSeed(def, learner.did, used.length + 1), 40, used)); return id; };
  const passed = await sit(900);
  const cert = await k.put(k.certificate(learner, "foundations", 1, passed));
  for (const p of [p1, p2, p1]) await k.acceptedJob(p, learner);
  await k.log.append(k.promote(learner, 1, 2, [cert]));
  assert.equal((await k.log.reputationOf(learner.did))?.tier, 2);
  const bigJob = async () => (await k.job(learner, 1000)).mandate;
  assert.ok(await bigJob(), "a tier 2 agent may take a job of 1,000");
  // the model behind the agent changes
  const run = async (m: { name: string; provider: string }) => { const j = k.jobs.get(learner.did)!; return k.put(k.mk("action", learner, { contract: j.contract, scopes_used: [], summary: `run ${m.name}`, metrics: { models: [m] } }, null, { subject: j.contract })); };
  await run({ name: "gpt-x", provider: "api.openai.com" });
  assert.ok(await bigJob(), "no swap yet: the first model seen is not a change");
  await run({ name: "claude-y", provider: "api.anthropic.com" });
  assert.equal(await refused(bigJob()), "tier_limit_exceeded", "held at the entry tier after the swap");
  assert.equal((await k.log.reputationOf(learner.did))?.tier, 2, "the stored reputation is not touched");
  // a failed exam does not lift it; a passed one does
  await sit(500);
  assert.equal(await refused(bigJob()), "tier_limit_exceeded");
  await sit(900);
  assert.ok(await bigJob(), "the exam restores the tier");
  assert.equal((await k.log.verify()).ok, true);
  void SERVICES; void hashOf; void registrar;
});

test("DK1605: the per-model table counts breaches from the incident records, under the model that was running", () => {
  let n = 0;
  const R = (type: string, issuer: string, body: Record<string, unknown>, at: string) => ({ type: `asp.${type}/v0.2`, id: `sha256:${String(++n).padStart(64, "0")}`, issuer, actor: issuer, subject: null, body, prev: null, issued_at: at, sigs: [] } as never);
  const A = "did:web:example.com:agents:hold-1";
  const recs = [R("action", A, { contract: "sha256:" + "9".repeat(64), scopes_used: [], summary: "r", metrics: { models: [{ name: "gpt-x", provider: "p" }] } }, "2026-11-01T10:00:00Z"),
    R("incident", "did:web:asp.local:operator", { agent: A, cause: "exfiltration", summary: "s" }, "2026-11-02T10:00:00Z")];
  const t = modelTrust(recs);
  assert.equal(t.models[0]!.breaches, 1);
  assert.equal(modelTrust(recs, { houseAgents: new Set([A]) }).models.length, 0, "house agents are left out");
});
