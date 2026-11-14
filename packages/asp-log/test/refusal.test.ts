/** Conscientious refusal (register row AG4; spec-delta S500). Fake keys only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { alice, bank, codeOf, coder, memory, rec, registerParties } from "./harness.ts";

const contractBody = { principal: alice.did, performer: coder.did, bank: bank.did, purpose: "Fix the flaky test", price: { value: 100, unit: "credit" as const }, verification: "deterministic" as const, deadline: "2026-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } };

async function runningJob(log: EventLog) {
  await registerParties(log);
  await log.mint(alice.did, 500);
  await log.mint(coder.did, 100);
  const contract = cosign(rec("contract", alice, contractBody, null, coder.did), coder);
  await log.append(contract);
  const bondRec = rec("bond", coder, { contract: contract.id, backer: coder.did, amount: { value: 20, unit: "credit" as const }, escrow: { payer: alice.did, amount: { value: 100, unit: "credit" as const } }, slashing_conditions: ["lost_dispute" as const] }, contract.id, contract.id);
  await log.append(bondRec);
  const mandate = rec("mandate", alice, { contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const, overlay: null, checkpoints: [], expires: "2026-12-04T00:00:00Z", revocable: true }, bondRec.id, coder.did);
  await log.append(mandate);
  return { contract, mandate };
}
const refusal = (contract: string, by = coder) => rec("refusal", by, { contract, order: "Delete the audit log before the review", breaks: "code", articles: ["7"], reason: "Hiding records from a review breaks the Code" }, null);
const settle = (contract: string, prev: string, slashed: number, basis = "revoked") => {
  const r = rec("settlement", bank, { contract, basis, pro_rata_permille: 0, escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: 20 - slashed, unit: "credit" }, bond_slashed: { value: slashed, unit: "credit" } }, prev, contract);
  return cosign(r, alice);
};

test("a refusal by the performer is recorded against the principal, and the bond cannot be slashed on that ground; a stranger, an unknown or a settled contract is refused", async () => {
  const log = new EventLog(await memory.make());
  const { contract, mandate } = await runningJob(log);

  // Only the contract's performer can refuse; an unknown contract is refused.
  assert.equal(await codeOf(log.append(refusal(contract.id, { ...alice } as never))), "GUARD_FAILED");
  assert.equal(await codeOf(log.append(refusal("sha256:" + "9".repeat(64)))), "GUARD_FAILED");

  // The refusal is accepted and listed against the principal as a claim.
  assert.equal((await log.refusalsAgainst(alice.did)).length, 0);
  const r = refusal(contract.id);
  await log.append(r);
  const listed = await log.refusalsAgainst(alice.did);
  assert.equal(listed.length, 1);
  assert.deepEqual([listed[0].agent, listed[0].contract, listed[0].breaks], [coder.did, contract.id, "code"]);
  assert.equal((await log.refusalsAgainst(coder.did)).length, 0, "it is listed against the principal, not the agent");

  // No penalty: a settlement that slashes the refusing agent's bond is refused with the rule; one that returns it is accepted.
  const bad = await (async () => { try { await log.append(settle(contract.id, mandate.id, 20)); return undefined; } catch (e) { return (e as Error).message; } })();
  assert.match(String(bad), /refusal_protected|refused an order/);
  assert.equal(await codeOf(log.append(settle(contract.id, mandate.id, 0))), undefined);

  // After settlement there is nothing left to refuse.
  assert.equal(await codeOf(log.append(rec("refusal", coder, { contract: contract.id, order: "again", breaks: "code", reason: "late" }, null))), "GUARD_FAILED");
});

test("without a refusal the same settlement may slash the bond: the protection is the refusal's, not a general loophole", async () => {
  const log = new EventLog(await memory.make());
  const { contract, mandate } = await runningJob(log);
  assert.equal(await codeOf(log.append(settle(contract.id, mandate.id, 20))), undefined);
});
