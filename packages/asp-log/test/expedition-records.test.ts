/**
 * Expeditions on the log (register row DK1740; spec-delta S1597; docs/research/exploration-and-expeditions.md 5): the declaration (world model, weights hash, licence, cap, rate, group), the frame chain (order, hash chain, step limit,
 * cost cap), and a result that is the log's own count: scored only with a frame and not stopped at the cap, void otherwise, never claimable. Refusals by name. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { frameHash } from "../src/index.ts";
import { credit, kit, mk, operator, refusedBy, type Party } from "./society-kit.ts";

void credit;
const h = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");

async function world(over: Record<string, unknown> = {}) {
  const k = await kit();
  const sponsor = await k.person("ex-sponsor");
  const group: Party[] = [await k.agent("ex-a", sponsor), await k.agent("ex-b", await k.person("ex-sponsor-b"))];
  const decl = (o: Record<string, unknown> = {}) => mk("expedition", operator, { world: "river-1", model: { name: "open-world-model", weights_sha256: h("weights"), licence_checked: true }, max_steps: 5, cost_cap_millicredits: 500, gpu_millicredits_per_second: 100, group: group.map((g) => g.did), goal: "reach", ...over, ...o });
  const exp = decl();
  await k.log.append(exp);
  let before = "genesis";
  const frame = (n: number, seconds = 1, over2: Record<string, unknown> = {}) => {
    const f = { n, frame_sha256: h(`frame-${n}`), action: "move_forward", gpu_ms: seconds * 1000, before, ...over2 };
    return mk("expedition_frame", operator, { expedition: exp.id, ...f });
  };
  const advance = (n: number, seconds = 1) => { before = frameHash({ n, sha256: h(`frame-${n}`), action: "move_forward", gpu_seconds: seconds * 1000 }, before); };
  void over;
  const result = (o: Record<string, unknown> = {}) => mk("expedition_result", operator, Object.fromEntries(Object.entries({ expedition: exp.id, status: "scored", frames: 3, cost_millicredits: 300, reached: true, evaluator: "landmark-evaluator-1", evaluator_error_permille: 80, reasons: [], ...o }).filter(([, v]) => v !== undefined)));
  return { k, group, decl, exp, frame, advance, result };
}

test("DK1740: a declaration is refused without the model, its weights hash, the licence check, a cap and a rate, or with a seed, a stranger's group or another signer", async () => {
  const w = await world();
  const bad = (o: Record<string, unknown>) => refusedBy(w.k.log.append(w.decl(o)));
  assert.equal(await bad({ model: { name: "m", weights_sha256: h("w"), licence_checked: false } }), "expedition_declaration", "the licence of the weights was not checked");
  assert.equal(await bad({ group: ["did:web:example.com:agents:nobody"] }), "expedition_group");
  assert.equal(await refusedBy(w.k.log.append(mk("expedition", w.group[0], { world: "x", model: { name: "m", weights_sha256: h("w"), licence_checked: true }, max_steps: 5, cost_cap_millicredits: 500, gpu_millicredits_per_second: 100, group: [w.group[0].did], goal: "reach" }))), "expedition_wrong_issuer");
});

test("DK1740: frames chain: in order, each after the hash of the one before it, inside the step limit and the cost cap; the frame that reaches the cap is the last", async () => {
  const w = await world();
  await w.k.log.append(w.frame(0)); w.advance(0);
  assert.equal(await refusedBy(w.k.log.append(w.frame(2))), "expedition_frame_order", "frame 1 is missing");
  assert.equal(await refusedBy(w.k.log.append(w.frame(1, 1, { before: h("some other frame") }))), "expedition_chain_broken", "the chain is broken");
  await w.k.log.append(w.frame(1)); w.advance(1);
  assert.equal(await refusedBy(w.k.log.append(w.frame(2, 5))), "expedition_cost_cap", "7 GPU seconds at 100 millicredits would be over the cap of 500");
  for (let n = 2; n < 10; n++) { try { await w.k.log.append(w.frame(n)); w.advance(n); } catch { break; } }
  const st = (await w.k.log.expeditionState(w.exp.id))!;
  assert.equal(st.stopped, true, "the cap of 500 millicredits (5 GPU seconds) was reached by the fifth frame");
  assert.equal(st.frames, 5, "five frames: the step limit and the cap are reached together");
  assert.equal(await refusedBy(w.k.log.append(w.frame(5))), "expedition_cost_cap", "stopped");
});

test("DK1740: the result is the log's own count: a different count is refused, a stopped or empty expedition cannot be scored, a void one closes, and it closes once", async () => {
  const w = await world({ cost_cap_millicredits: 100000 });
  assert.equal(await refusedBy(w.k.log.append(w.result({ frames: 0, cost_millicredits: 0 }))), "expedition_must_be_void", "no frame, no score");
  await w.k.log.append(w.frame(0)); w.advance(0);
  await w.k.log.append(w.frame(1)); w.advance(1);
  assert.equal(await refusedBy(w.k.log.append(w.result({ frames: 3 }))), "expedition_result_mismatch", "the log counts two frames");
  assert.equal(await refusedBy(w.k.log.append(w.result({ frames: 2, cost_millicredits: 9 }))), "expedition_result_mismatch");
  assert.equal(await refusedBy(w.k.log.append(w.result({ frames: 2, cost_millicredits: 200, evaluator_error_permille: 1500 }))), "/evaluator_error_permille", "the evaluator's own error rate is 0 to 1000 permille");
  await w.k.log.append(w.result({ frames: 2, cost_millicredits: 200 }));
  assert.equal((await w.k.log.expeditionState(w.exp.id))?.result !== null, true);
  assert.equal(await refusedBy(w.k.log.append(w.frame(2))), "expedition_closed");
  assert.equal(await refusedBy(w.k.log.append(w.result({ frames: 2, cost_millicredits: 200, status: "void", reasons: ["again"] }))), "expedition_closed");
  assert.equal((await w.k.log.verify()).ok, true, "a replica recomputes the same state");
});

test("DK1740: an expedition stopped at its cap closes void, and a void result is accepted with its reasons", async () => {
  const w = await world();
  for (let n = 0; n < 5; n++) { await w.k.log.append(w.frame(n, 1)); w.advance(n, 1); }
  const st = (await w.k.log.expeditionState(w.exp.id))!;
  assert.equal(st.stopped, true);
  assert.equal(await refusedBy(w.k.log.append(w.result({ frames: 5, cost_millicredits: st.costMillicredits }))), "expedition_must_be_void", "stopped at the cap: never scored");
  await w.k.log.append(w.result({ frames: 5, cost_millicredits: st.costMillicredits, status: "void", reached: undefined, reasons: ["the cost reached the cap: the expedition was stopped and is not scored"] }));
});
