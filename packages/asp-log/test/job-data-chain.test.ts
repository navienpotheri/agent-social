/**
 * The job-data deletion chain bound to the signed Action (register row JO3; spec-delta S1602): an Action may cite the SHA-256 of the head of the performer's `asp job-data delete` chain for a contract (`job_data_chain`);
 * a settlement of a contract whose data_handling retention is delete_at_settlement (the default) with none cited is marked data_unconfirmed, never refused; a contract that retains data for a stated number of days is not
 * marked; a late Action after the settlement that cites the head confirms it. Old Actions without the field stay valid. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { Kit, bankP, credit, hashOf, type Party } from "./academy-kit.ts";

const HEAD = "ab".repeat(32);

/** A delivered and accepted job; `before` runs between the mandate and the delivery (where a performer reports its Actions); the settlement is returned unsent so the test can see what follows it. */
async function job(dh: Record<string, unknown> | undefined, before: (c: { kit: Kit; agent: Party; contract: string }) => Promise<void>, n: number) {
  const kit = new Kit();
  const principal = await kit.person(`jdc-principal-${n}`);
  const sponsor = await kit.person(`jdc-sponsor-${n}`);
  const agent = await kit.agent(`jdc-agent-${n}`, sponsor, 1);
  await kit.priceList();
  await kit.mint(principal.did, 100); await kit.mint(agent.did, 20);
  const contract = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `Data job ${n}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") }, ...(dh ? { data_handling: dh } : {}) }, null, { subject: agent.did }), agent);
  await kit.put(contract);
  const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await kit.put(bond);
  const mandate = kit.mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
  await kit.put(mandate);
  await before({ kit, agent, contract: contract.id });
  const delivery = kit.mk("delivery", agent, { contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, mandate.id, { subject: contract.id });
  await kit.put(delivery);
  const accept = kit.mk("attestation", principal, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, { subject: contract.id });
  await kit.put(accept);
  await kit.put(kit.mk("settlement", bankP, { contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: credit(96), fees: credit(4), bond_returned: credit(20), bond_slashed: credit(0) }, accept.id, { subject: contract.id }));
  return { kit, agent, contract: contract.id };
}
const act = (kit: Kit, agent: Party, contract: string, over: Record<string, unknown> = {}) => kit.put(kit.mk("action", agent, { contract, scopes_used: [], summary: "run", assurance: "gateway_observed", ...over }, null, { subject: contract }));

test("JO3: a settlement with no chain head cited is marked data_unconfirmed and is not refused; an old Action without the field stays valid", async () => {
  const w = await job(undefined, async (c) => { await act(c.kit, c.agent, c.contract); }, 1);
  assert.deepEqual(await w.kit.log.jobDataStatus(w.contract), { status: "unconfirmed" });
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("JO3: an Action that cites the chain head confirms the deletion at settlement, and the latest head wins", async () => {
  const w = await job({ retention: "delete_at_settlement" }, async (c) => { await act(c.kit, c.agent, c.contract, { job_data_chain: "cd".repeat(32) }); await act(c.kit, c.agent, c.contract, { job_data_chain: HEAD }); }, 2);
  assert.deepEqual(await w.kit.log.jobDataStatus(w.contract), { status: "confirmed", chain_head: HEAD });
});

test("JO3: a contract that retains data for a stated number of days is not marked, and a late Action after the settlement that cites the head confirms it", async () => {
  const kept = await job({ retention: "retain_days", retain_days: 30 }, async () => {}, 3);
  assert.deepEqual(await kept.kit.log.jobDataStatus(kept.contract), { status: "not_applicable" });
  const late = await job(undefined, async () => {}, 4);
  assert.equal((await late.kit.log.jobDataStatus(late.contract)).status, "unconfirmed");
  await act(late.kit, late.agent, late.contract, { late: { activity_ended: late.kit.now() }, job_data_chain: HEAD });
  assert.deepEqual(await late.kit.log.jobDataStatus(late.contract), { status: "confirmed", chain_head: HEAD });
});

test("JO3: a contract that is not settled yet has no status to report", async () => {
  const w = await job(undefined, async () => {}, 5);
  assert.deepEqual(await w.kit.log.jobDataStatus("sha256:" + "7".repeat(64)), { status: "not_applicable" });
});
