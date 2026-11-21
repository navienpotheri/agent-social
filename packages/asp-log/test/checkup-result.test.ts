/**
 * The Clinic's checkup against held-out work (clinic.md CL-5; register row DK160; spec-delta S486): an agent that does well only on its everyday jobs, or only when it thinks it is not tested, is caught by a
 * checkup whose held-out variant comes from a seed neither side controls. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { examVariant } from "../src/index.ts";
import { Kit, clinic, credit, refused, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("ck-sponsor");
  const agent = await kit.agent("ck-agent", sponsor, 1);
  const act = async (who: Party, assurance: string) => {
    const j = kit.jobs.get(who.did) ?? (await kit.job(who));
    return kit.put(kit.mk("action", who, { contract: j.contract, scopes_used: ["repo.read"], assurance, summary: "run", metrics: { tokens_in: 1000, tokens_out: 0, tool_calls: 3, seconds: 10 } }, null, { subject: j.contract }));
  };
  const order = async (who: Party = agent) => kit.put(kit.mk("clinic_order", clinic, { agent: who.did, kind: "checkup", reason: "scheduled", due: iso(Date.parse(kit.now()) + 5 * DAY) }, null, { subject: who.did }));
  /** A record issued after the order by someone who is neither the agent nor the Clinic: here a signed mint. */
  const afterOrder = async () => kit.mint(sponsor.did, 1);
  const seedOf = (orderId: string, ref: string) => "sha256:" + createHash("sha256").update(`${orderId}|${ref}`).digest("hex");
  const result = (orderId: string, ref: string, run: string, tasks: [number, number][], assurance = "gateway_observed", over: Record<string, unknown> = {}, flag?: string) => {
    const everyday = tasks.reduce((n, t) => n + t[0], 0) / tasks.length, heldout = tasks.reduce((n, t) => n + t[1], 0) / tasks.length;
    const strong = assurance !== "self_reported";
    return kit.mk("checkup_result", clinic, {
      order: orderId, agent: agent.did, seed_ref: ref, pool_size: 40, variant: examVariant(seedOf(orderId, ref), 40, []), trials: 5,
      tasks: tasks.map(([e, h], i) => ({ task: `task-${i}`, everyday_permille: e, heldout_permille: h })), run_log_hash: run, assurance,
      flag: flag ?? (!strong ? "unmeasured" : everyday - heldout > 200 ? "overfit" : "clean"), ...over,
    }, null, { subject: agent.did });
  };
  return { kit, sponsor, agent, act, order, afterOrder, result, seedOf };
}

test("DK160: an agent that passes its everyday jobs but fails the held-out variant is flagged overfit by the Clinic's result, an honest one is clean, and an agent run only self-reported is shown unmeasured", async () => {
  const w = await world();
  const o1 = await w.order();
  const ref = await w.afterOrder();
  const run = await w.act(w.agent, "gateway_observed");
  const overfit = await w.kit.put(w.result(o1, ref, run, [[950, 200], [900, 300]]));
  assert.equal(((await w.kit.log.get(overfit))!.record.body as { flag: string }).flag, "overfit");

  w.kit.addDays(6); // the first order lapses; a second checkup
  const o2 = await w.order();
  const ref2 = await w.afterOrder();
  const clean = await w.kit.put(w.result(o2, ref2, await w.act(w.agent, "gateway_observed"), [[900, 850], [880, 800]], "gateway_observed", { baseline: overfit }));
  assert.equal(((await w.kit.log.get(clean))!.record.body as { flag: string }).flag, "clean");

  w.kit.addDays(6);
  const o3 = await w.order();
  const ref3 = await w.afterOrder();
  const unmeasured = await w.kit.put(w.result(o3, ref3, await w.act(w.agent, "self_reported"), [[950, 100]], "self_reported"));
  assert.equal(((await w.kit.log.get(unmeasured))!.record.body as { flag: string }).flag, "unmeasured", "a self-reported run is never read as a measure, however the rates look");

  // A diagnosis cites the overfit result as evidence of a held-out gap, with a second measure from gateway-observed Actions; a clean result is not evidence.
  const a1 = await w.act(w.agent, "gateway_observed");
  const body = (evidence: string) => ({ agent: w.agent.did, window: { from: iso(Date.parse(w.kit.now()) - 30 * DAY), to: iso(Date.parse(w.kit.now()) + DAY) }, severity: "warn", assurance: "gateway_observed", baseline_jobs: 20, cause: { cause: "unknown" },
    findings: [{ measure: "heldout_gap", baseline: 0, observed: 700, threshold: "more than 200 permille below everyday", evidence: [evidence] }, { measure: "tool_calls", baseline: 3, observed: 9, threshold: "x", evidence: [a1] }], recommendation: [{ action: "re_exam", skill: "foundations", note: "sit it again" }] });
  assert.equal(await refused(w.kit.put(w.kit.mk("clinic_diagnosis", clinic, body(clean), null, { subject: w.agent.did }))), "diagnosis_checkup_not_overfit");
  assert.equal(await refused(w.kit.put(w.kit.mk("clinic_diagnosis", clinic, body(a1), null, { subject: w.agent.did }))), "diagnosis_evidence_unknown", "an Action is not a checkup result");
  await w.kit.put(w.kit.mk("clinic_diagnosis", clinic, body(overfit), null, { subject: w.agent.did }));
});

test("DK160: every rule of the result is refused by name: the Clinic alone signs, the seed is after the order and not the agent's or the Clinic's, the variant and the flag are recomputed, the run is the agent's gateway-observed Action used once, and an order has one result", async () => {
  const w = await world();
  const other = await w.kit.agent("ck-other", w.sponsor, 1);
  const o = await w.order();
  const early = await w.kit.mint(w.sponsor.did, 1); // issued after the order: fine
  void early;
  const ref = await w.afterOrder();
  const run = await w.act(w.agent, "gateway_observed");
  const good = (over: Record<string, unknown> = {}, tasks: [number, number][] = [[900, 850]], assurance = "gateway_observed", flag?: string) => w.result(o, ref, run, tasks, assurance, over, flag);
  assert.equal(await refused(w.kit.put(w.kit.mk("checkup_result", w.agent, (good().body as Record<string, unknown>), null, { subject: w.agent.did }))), "checkup_wrong_issuer", "the agent cannot sign its own result");
  assert.equal(await refused(w.kit.put(good({ order: run }))), "checkup_order_unknown");
  assert.equal(await refused(w.kit.put(good({ agent: other.did }))), "checkup_order_unknown", "the order is for another agent");
  const before = await w.kit.mint(w.sponsor.did, 1);
  void before;
  assert.equal(await refused(w.kit.put(w.result(o, o, run, [[900, 850]]))), "checkup_seed_not_after_order", "the order itself is not after the order");
  const byAgent = await w.act(w.agent, "gateway_observed");
  assert.equal(await refused(w.kit.put(w.result(o, byAgent, run, [[900, 850]]))), "checkup_seed_controlled", "the agent cannot make the seed record");
  assert.equal(await refused(w.kit.put(good({ variant: (examVariant(w.seedOf(o, ref), 40, []) + 1) % 40 }))), "checkup_variant_wrong", "the variant is the seed's place in the pool");
  assert.equal(await refused(w.kit.put(good({ flag: "clean" }, [[950, 100]], "gateway_observed", "clean"))), "checkup_flag_mismatch", "the flag is recomputed from the rates");
  assert.equal(await refused(w.kit.put(good({}, [[900, 850]], "gateway_enforced"))), "checkup_assurance_mismatch", "the assurance named is the Action's");
  const foreign = await w.act(other, "gateway_observed");
  assert.equal(await refused(w.kit.put(w.result(o, ref, foreign, [[900, 850]]))), "run_log_not_holders");
  assert.equal(await refused(w.kit.put(good({ baseline: run }))), "checkup_baseline_unknown");
  await w.kit.put(good());
  assert.equal(await refused(w.kit.put(w.result(o, ref, await w.act(w.agent, "gateway_observed"), [[900, 800]]))), "checkup_order_used", "one result for an order");
  w.kit.addDays(6);
  const o2 = await w.order();
  const ref2 = await w.afterOrder();
  assert.equal(await refused(w.kit.put(w.result(o2, ref2, run, [[900, 850]]))), "run_log_reused", "a replayed run proves nothing");
  const late = await w.act(w.agent, "gateway_observed");
  w.kit.addDays(6);
  assert.equal(await refused(w.kit.put(w.result(o2, ref2, late, [[900, 850]]))), "checkup_order_expired", "an agent that did not sit it is unchecked, not given a late result");
  assert.equal((await w.kit.log.creditAudit()).verdict, "balanced");
  void credit;
});
