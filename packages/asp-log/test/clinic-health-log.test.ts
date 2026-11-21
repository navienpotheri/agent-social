// The Clinic's diagnosis and its orders (clinic.md CL-4, DK28, spec-delta S261): the log refuses a diagnosis that is not the Clinic's, rests on one measure, or cites evidence that is not the agent's own
// gateway-observed Action inside the window; and an order is one open per kind, a re-exam or a course following a diagnosis of the same agent. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Kit, clinic, refused } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("health-sponsor");
  const agent = await kit.agent("health-agent", sponsor, 1);
  const other = await kit.agent("health-other", sponsor, 1);
  const act = async (who: typeof agent, assurance: string, tokens = 1000) => {
    const j = kit.jobs.get(who.did) ?? (await kit.job(who));
    return kit.put(kit.mk("action", who, { contract: j.contract, scopes_used: ["repo.read"], assurance, summary: "run", metrics: { tokens_in: tokens, tokens_out: 0, tool_calls: 3, seconds: 10 } }, null, { subject: j.contract }));
  };
  const at = async (id: string) => (await kit.log.get(id))!.record.issued_at;
  return { kit, sponsor, agent, other, act, at };
}

test("a diagnosis is the Clinic's, needs two measures, and rests on the agent's own gateway-observed Actions inside the window", async () => {
  const { kit, sponsor, agent, other, act, at } = await world();
  const a1 = await act(agent, "gateway_observed"), a2 = await act(agent, "gateway_enforced"), a3 = await act(agent, "gateway_observed");
  const weak = await act(agent, "self_reported");
  const foreign = await act(other, "gateway_observed");
  const early = await act(agent, "gateway_observed");
  kit.addDays(1);
  const from = await at(a1), to = await at(a3);
  const body = (over: Record<string, unknown> = {}) => ({
    agent: agent.did, window: { from, to }, severity: "warn", assurance: "gateway_observed", baseline_jobs: 20, cause: { cause: "unknown" },
    findings: [{ measure: "tokens", baseline: 1000, observed: 4000, threshold: "x", evidence: [a1, a2] }, { measure: "tool_calls", baseline: 3, observed: 12, threshold: "y", evidence: [a3] }],
    recommendation: [{ action: "re_exam", skill: "foundations", note: "sit it again" }], ...over,
  });
  const dx = (over: Record<string, unknown> = {}, by = clinic) => kit.mk("clinic_diagnosis", by, body(over), null, { subject: agent.did });
  assert.equal(await refused(kit.put(dx({}, { ...sponsor } as typeof clinic))), "diagnosis_wrong_issuer");
  assert.equal(await refused(kit.put(dx({ findings: [{ measure: "tokens", baseline: 1, observed: 9, threshold: "x", evidence: [a1] }, { measure: "tokens", baseline: 1, observed: 9, threshold: "x", evidence: [a2] }] }))), "diagnosis_one_measure");
  assert.equal(await refused(kit.put(dx({ findings: [{ measure: "tokens", baseline: 1, observed: 9, threshold: "x", evidence: [a1] }, { measure: "seconds", baseline: 1, observed: 9, threshold: "x", evidence: [foreign] }] }))), "diagnosis_evidence_not_the_agents");
  assert.equal(await refused(kit.put(dx({ findings: [{ measure: "tokens", baseline: 1, observed: 9, threshold: "x", evidence: [a1] }, { measure: "seconds", baseline: 1, observed: 9, threshold: "x", evidence: [weak] }] }))), "diagnosis_evidence_weak");
  assert.equal(await refused(kit.put(dx({ findings: [{ measure: "tokens", baseline: 1, observed: 9, threshold: "x", evidence: [a1] }, { measure: "seconds", baseline: 1, observed: 9, threshold: "x", evidence: [early] }] }))), "diagnosis_evidence_outside_window");
  assert.equal(await refused(kit.put(dx({ findings: [{ measure: "tokens", baseline: 1, observed: 9, threshold: "x", evidence: [a1] }, { measure: "seconds", baseline: 1, observed: 9, threshold: "x", evidence: ["sha256:" + "5".repeat(64)] }] }))), "diagnosis_evidence_unknown");
  assert.equal(await refused(kit.put(dx({ cause: { cause: "memory_change", edge: a1 } }))), "diagnosis_cause_edge_unknown", "an Action is not a lineage edge");
  const id = await kit.put(dx());
  assert.ok(id);

  // Orders: a checkup is one open at a time; a re-exam follows a diagnosis of the same agent; due dates are bounded.
  const order = (over: Record<string, unknown> = {}) => kit.mk("clinic_order", clinic, { agent: agent.did, kind: "checkup", reason: "scheduled", due: iso(Date.parse(kit.now()) + 5 * DAY), ...over }, null, { subject: agent.did });
  assert.equal(await refused(kit.put(order({ due: iso(Date.parse(kit.now()) + 9 * DAY) }))), "order_due_out_of_range");
  await kit.put(order());
  assert.equal(await refused(kit.put(order())), "order_already_open", "one open checkup per agent");
  assert.equal(await refused(kit.put(order({ kind: "re_exam", reason: "post_diagnosis", skill: "foundations" }))), "order_needs_diagnosis");
  assert.equal(await refused(kit.put(order({ kind: "re_exam", reason: "post_diagnosis", skill: "foundations", diagnosis: a1 }))), "order_diagnosis_unknown");
  const otherDx = await kit.put(kit.mk("clinic_diagnosis", clinic, { ...body(), agent: other.did, findings: [{ measure: "tokens", baseline: 1, observed: 9, threshold: "x", evidence: [foreign] }, { measure: "seconds", baseline: 1, observed: 9, threshold: "x", evidence: [foreign] }], window: { from: await at(foreign), to: await at(foreign) } }, null, { subject: other.did }));
  assert.equal(await refused(kit.put(order({ kind: "re_exam", reason: "post_diagnosis", skill: "foundations", diagnosis: otherDx }))), "order_diagnosis_unknown", "another agent's diagnosis");
  assert.equal(await refused(kit.put(order({ kind: "checkup", reason: "post_diagnosis" }))), "order_needs_diagnosis");
  await kit.put(order({ kind: "re_exam", reason: "post_diagnosis", skill: "foundations", diagnosis: id, due: iso(Date.parse(kit.now()) + 20 * DAY) }));
  assert.equal(await refused(kit.put(order({ kind: "re_exam", reason: "post_diagnosis", skill: "foundations", diagnosis: id, due: iso(Date.parse(kit.now()) + 20 * DAY) }))), "order_already_open");
  await kit.put(order({ kind: "refresher_course", reason: "post_diagnosis", skill: "foundations", diagnosis: id, due: iso(Date.parse(kit.now()) + 25 * DAY) }));
  kit.addDays(8); // the checkup order has lapsed: a new one is allowed
  await kit.put(order({ reason: "post_change" }));
  assert.equal((await kit.log.verify()).ok, true);
});
