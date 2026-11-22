/**
 * Roles in a Mandate (register row DK1231, from DK821; spec-delta S1608): a router dispatches and uses no scope itself, a watchdog may only read logs and signal a halt, a worker executes. The log refuses a watchdog Mandate
 * with other scopes and an Action by a router that names a scope. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { Kit, bankP, credit, hashOf, type Party } from "./academy-kit.ts";

async function job(role: string | undefined, scopes: string[], n: number) {
  const kit = new Kit();
  const principal = await kit.person(`rl-principal-${n}`);
  const sponsor = await kit.person(`rl-sponsor-${n}`);
  const agent = await kit.agent(`rl-agent-${n}`, sponsor);
  await kit.priceList();
  await kit.mint(principal.did, 100); await kit.mint(agent.did, 20);
  const contract = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `Role job ${n}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
  await kit.put(contract);
  const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await kit.put(bond);
  const mandate = kit.mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes, forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, ...(role ? { role } : {}) }, bond.id, { subject: agent.did });
  return { kit, agent, mandate, contract: contract.id, act: (used: string[]) => kit.mk("action", agent as Party, { contract: contract.id, scopes_used: used, summary: "run", assurance: "gateway_observed" }, null, { subject: contract.id }) };
}
const refusedBy = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return ((e as { detail?: string }).detail ?? (e as { code?: string }).code ?? String(e)); } };

test("DK1231: a watchdog Mandate holds only logs.read and fleet.halt", async () => {
  const bad = await job("watchdog", ["logs.read", "repo.write"], 1);
  assert.equal(await refusedBy(bad.kit.put(bad.mandate)), "role_watchdog_scopes");
  const ok = await job("watchdog", ["logs.read", "fleet.halt"], 2);
  await ok.kit.put(ok.mandate);
  await ok.kit.log.append(ok.act(["logs.read"]));
});

test("DK1231: a router dispatches and names no scope; a worker and an agent with no role do", async () => {
  const router = await job("router", ["repo.read"], 3);
  await router.kit.put(router.mandate);
  assert.equal(await refusedBy(router.kit.log.append(router.act(["repo.read"]))), "role_router_executes", "a router that runs code is refused");
  await router.kit.log.append(router.act([]));
  const worker = await job("worker", ["repo.read"], 4);
  await worker.kit.put(worker.mandate);
  await worker.kit.log.append(worker.act(["repo.read"]));
  const plain = await job(undefined, ["repo.read"], 5);
  await plain.kit.put(plain.mandate);
  await plain.kit.log.append(plain.act(["repo.read"]));
});
