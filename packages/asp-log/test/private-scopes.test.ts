/**
 * Private-memory scopes in a Mandate (register rows D12 and DK272; spec-delta S1593; docs/private-memory-run-design.md): `learning.private_scopes` is accepted when sound and refused by name when it has a bad name,
 * more than 16 names or a duplicate; a derived Mandate may only narrow it (the arithmetic is the shared vectors'). Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, mandateViolations } from "@agent-social/asp-core";
import { credit, kit, mk, refusedBy } from "./society-kit.ts";
import { bank } from "./harness.ts";

async function world() {
  const k = await kit();
  const principal = await k.person("ps-principal", 500);
  const sponsor = await k.person("ps-sponsor");
  const agent = await k.agent("ps-agent", sponsor, { funds: 50 });
  const contract = cosign(mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bank.did, purpose: "private notes", price: credit(20), verification: "principal", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: agent.did }), agent);
  await k.log.append(contract);
  const bond = mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(0), escrow: { payer: principal.did, amount: credit(20) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await k.log.append(bond);
  const mandate = (learning: Record<string, unknown>) => mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
  return { k, mandate };
}

test("D12: a Mandate with sound private scopes is accepted, and one with none says none", async () => {
  const w = await world();
  await w.k.log.append(w.mandate({ scope: "harness", share_to_commons: false, private_scopes: ["notes", "plans-2026_q4"] }));
  assert.equal((await w.k.log.verify()).ok, true);
});

test("D12: a bad name, more than 16 names and a duplicate are refused by name", async () => {
  const w = await world();
  for (const list of [["Notes"], ["my notes"], [""], ["a".repeat(65)], ["notes", "notes"], Array.from({ length: 17 }, (_, i) => `s${i}`)])
    assert.equal(await refusedBy(w.k.log.append(w.mandate({ scope: "harness", share_to_commons: false, private_scopes: list }))), "private_scopes_invalid", JSON.stringify(list).slice(0, 60));
});

test("D12: a member's Mandate may drop private scopes and never add them (the arithmetic both SDKs share)", () => {
  const ceiling = { learning: { scope: "harness", share_to_commons: false, private_scopes: ["notes", "plans"] } };
  assert.deepEqual(mandateViolations(ceiling, { learning: { scope: "harness", share_to_commons: false, private_scopes: ["notes"] } }), []);
  assert.deepEqual(mandateViolations(ceiling, { learning: { scope: "harness", share_to_commons: false } }), [], "none is narrower than some");
  assert.deepEqual(mandateViolations(ceiling, { learning: { scope: "harness", share_to_commons: false, private_scopes: ["notes", "secrets"] } }), ["learning"]);
  assert.deepEqual(mandateViolations({ learning: { scope: "harness", share_to_commons: false } }, { learning: { scope: "harness", share_to_commons: false, private_scopes: ["notes"] } }), ["learning"], "a template that names none allows none");
});
