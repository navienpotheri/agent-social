/**
 * A model swap holds the agent (register row DK1605; spec-delta S1556): after the model behind an agent changes (a new model, or the same name on different weights) its tier does not rise until it passes an exam of its own
 * after the swap. A promotion that would have been accepted is refused with the reason, and accepted after the re-examination; an agent that did not swap is promoted as before. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Kit, refused, type Party } from "./academy-kit.ts";

async function earned(k: Kit, name: string) {
  const a = await k.agent(name);
  const [p1, p2] = [await k.person(`${name}-p1`), await k.person(`${name}-p2`)];
  const cert = await k.certify(a, "foundations", 1);
  for (const p of [p1, p2, p1]) await k.acceptedJob(p, a);
  return { a, cert };
}
const run = (k: Kit, a: Party, model: { name: string; provider?: string; digest?: string }) => { const j = k.jobs.get(a.did)!; return k.put(k.mk("action", a, { contract: j.contract, scopes_used: [], summary: "run", metrics: { models: [model] } }, null, { subject: j.contract })); };
const GPT = { name: "gpt-x", provider: "api.openai.com" };

test("DK1605: a swap holds the agent: a promotion it earned is refused until it passes an exam after the swap; an agent that did not swap is promoted", async () => {
  const k = new Kit();
  const held = await earned(k, "hold-a"), free = await earned(k, "hold-b");
  await run(k, held.a, GPT); await run(k, free.a, GPT);
  await run(k, held.a, { name: "claude-y", provider: "api.anthropic.com" }); // the swap
  assert.equal(await refused(k.log.append(k.promote(held.a, 1, 2, [held.cert]))), "agent_model_hold");
  assert.equal((await k.log.reputationOf(held.a.did))?.tier, 1, "the tier did not move");
  await k.log.append(k.promote(free.a, 1, 2, [free.cert]));
  assert.equal((await k.log.reputationOf(free.a.did))?.tier, 2, "an agent that did not swap is promoted as before");
  // the Foundations exam it passed BEFORE the swap does not lift it; one passed after does
  assert.equal(await refused(k.log.append(k.promote(held.a, 1, 2, [held.cert]))), "agent_model_hold", "an exam passed before the swap does not count");
  k.addDays(1);
  await k.passedResult(held.a, "practitioner", 1);
  await k.log.append(k.promote(held.a, 1, 2, [held.cert]));
  assert.equal((await k.log.reputationOf(held.a.did))?.tier, 2, "after the re-examination the promotion is accepted");
  assert.equal((await k.log.verify()).ok, true);
});

test("DK1605: the same name on different weights is a swap too; a digest appearing for the first time is not", async () => {
  const k = new Kit();
  const w = await earned(k, "hold-c"), v = await earned(k, "hold-d");
  await run(k, w.a, { ...GPT, digest: "fingerprint:fp_1" }); await run(k, w.a, { ...GPT, digest: "fingerprint:fp_2" });
  assert.equal(await refused(k.log.append(k.promote(w.a, 1, 2, [w.cert]))), "agent_model_hold");
  await run(k, v.a, GPT); await run(k, v.a, { ...GPT, digest: "fingerprint:fp_1" });
  await k.log.append(k.promote(v.a, 1, 2, [v.cert]));
  assert.equal((await k.log.reputationOf(v.a.did))?.tier, 2);
});
