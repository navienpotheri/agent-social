/**
 * A workflow clause on the log (register row DK1209, from DK841; spec-delta S1607): a Mandate may carry the states a job moves through, where it starts and the transitions it may take; an Action may report a step. The log refuses
 * a clause that names a state it does not have, a step under a Mandate with no clause, a step from the wrong state and a transition the clause does not allow, and keeps the current state. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { Kit, bankP, credit, hashOf, type Party } from "./academy-kit.ts";

const CLAUSE = { states: ["plan", "work", "check", "done"], start: "plan", transitions: [{ from: "plan", to: "work" }, { from: "work", to: "check" }, { from: "check", to: "work" }, { from: "check", to: "done" }], terminal: ["done"] };
async function job(extra: Record<string, unknown>, n: number) {
  const kit = new Kit();
  const principal = await kit.person(`wf-principal-${n}`);
  const sponsor = await kit.person(`wf-sponsor-${n}`);
  const agent = await kit.agent(`wf-agent-${n}`, sponsor);
  await kit.priceList();
  await kit.mint(principal.did, 100); await kit.mint(agent.did, 20);
  const contract = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `Workflow job ${n}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
  await kit.put(contract);
  const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await kit.put(bond);
  const mandate = kit.mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, ...extra }, bond.id, { subject: agent.did });
  await kit.put(mandate);
  const act = (over: Record<string, unknown> = {}) => kit.mk("action", agent as Party, { contract: contract.id, scopes_used: [], summary: "run", assurance: "gateway_observed", ...over }, null, { subject: contract.id });
  return { kit, agent, contract: contract.id, act };
}
const refusedBy = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return ((e as { detail?: string }).detail ?? (e as { code?: string }).code ?? String(e)); } };


test("DK1209: a step needs a clause; the job starts in the start state and moves only by the clause's transitions, one state at a time", async () => {
  const none = await job({}, 1);
  assert.equal(await none.kit.log.workflowState(none.contract), null);
  assert.equal(await refusedBy(none.kit.log.append(none.act({ workflow_step: { from: "plan", to: "work" } }))), "workflow_not_in_mandate");
  const w = await job({ workflow: CLAUSE }, 2);
  assert.deepEqual(await w.kit.log.workflowState(w.contract), { state: "plan", terminal: false });
  assert.equal(await refusedBy(w.kit.log.append(w.act({ workflow_step: { from: "work", to: "check" } }))), "workflow_wrong_state", "the job is still in plan");
  assert.equal(await refusedBy(w.kit.log.append(w.act({ workflow_step: { from: "plan", to: "done" } }))), "workflow_bad_transition", "no skipping the checker");
  await w.kit.log.append(w.act({ workflow_step: { from: "plan", to: "work" } }));
  await w.kit.log.append(w.act({ workflow_step: { from: "work", to: "check" } }));
  await w.kit.log.append(w.act({ workflow_step: { from: "check", to: "work" } })); // a failed check goes back
  assert.deepEqual(await w.kit.log.workflowState(w.contract), { state: "work", terminal: false });
  await w.kit.log.append(w.act({ workflow_step: { from: "work", to: "check" } }));
  await w.kit.log.append(w.act({ workflow_step: { from: "check", to: "done" } }));
  assert.deepEqual(await w.kit.log.workflowState(w.contract), { state: "done", terminal: true });
  assert.equal(await refusedBy(w.kit.log.append(w.act({ workflow_step: { from: "done", to: "work" } }))), "workflow_bad_transition", "a finished job does not start again");
  await w.kit.log.append(w.act()); // an Action with no step is not held up by the clause
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("DK1209: a clause that names a state it does not have is refused when the Mandate is recorded", async () => {
  const bad = (clause: Record<string, unknown>, n: number) => refusedBy(job({ workflow: clause }, n));
  assert.equal(await bad({ ...CLAUSE, start: "review" }, 3), "workflow_unknown_state", "the start is not a state");
  assert.equal(await bad({ ...CLAUSE, transitions: [{ from: "plan", to: "review" }] }, 4), "workflow_unknown_state", "a transition to a state it does not have");
});
