/**
 * A job that fails in the middle (register row JO4; spec-delta S1703): the principal declares the failure once the deadline and a day's grace have passed with nothing delivered; the settlement then refunds the whole
 * escrow and slashes the stated share of the Bond to the principal; a new contract can replace the failed one and resume from its last checkpoint. Each refusal is named. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bank } from "./harness.ts";
import { DAY, credit, jump, kit, mk, refusedBy } from "./society-kit.ts";
import { FAILURE_GRACE_MS, FAILURE_SLASH_PERMILLE, failureSlash } from "../src/contract-failure.ts";

const DEADLINE = "2026-11-03T00:00:00Z"; // the kit's clock starts on 2026-11-01

async function world() {
  const k = await kit();
  const principal = await k.person("jf-principal", 5000);
  const performer = await k.agent("jf-performer", await k.person("jf-sponsor", 100), { funds: 2000 });
  const other = await k.person("jf-other", 5000);
  const fail = (contract: string, by = principal, over: Record<string, unknown> = {}) => mk("contract_failure", by, { contract, cause: "unreachable", evidence: "no answer to six messages after the deadline", ...over }, null, { subject: contract });
  const settle = (contract: string, prev: string, over: Record<string, unknown> = {}) => mk("settlement", bank, { contract, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), fees: credit(0), bond_returned: credit(0), bond_slashed: credit(failureSlash(100)), ...over }, prev, { subject: contract, cosigners: [principal] });
  const job = (over: Record<string, unknown> = {}, stopAt: "mandate" | "bond" | "contract" = "mandate", p = principal) => k.runJob(p, performer, 100, undefined, { stopAt, deadline: DEADLINE, bond: 100, ...over });
  const checkpoint = async (j: { contract: string; mandate: string }) => {
    const cp = mk("checkpoint", performer, { contract: j.contract, kind: "plan", question: "Is the plan right?" }, j.mandate, { subject: j.contract });
    await k.log.append(cp);
    return cp;
  };
  const resolve = async (j: { contract: string }, cp: { id: string }) => { const a = mk("attestation", principal, { kind: "checkpoint_resolution", about: cp.id, verdict: "approved" }, cp.id, { subject: j.contract }); await k.log.append(a); return a; };
  return { k, principal, performer, other, fail, settle, job, checkpoint, resolve };
}

test("JO4: the principal declares a failure once the deadline and a day's grace have passed with the Bond locked and nothing delivered; each refusal is named", async () => {
  assert.equal(FAILURE_GRACE_MS, DAY);
  assert.equal(FAILURE_SLASH_PERMILLE, 250);
  assert.equal(failureSlash(100), 25);
  assert.equal(failureSlash(7), 1, "rounded down");
  const w = await world();
  const j = await w.job();
  assert.equal(await refusedBy(w.k.log.append(w.fail(j.contract))), "failure_not_past_deadline", "before the deadline");
  jump(2 * DAY + 3_600_000); // 2026-11-03 01:00: past the deadline, inside its day's grace
  assert.equal(await refusedBy(w.k.log.append(w.fail(j.contract))), "failure_not_past_deadline", "inside the grace");
  jump(DAY);
  assert.equal(await refusedBy(w.k.log.append(w.fail(j.contract, w.other))), "failure_not_the_principal", "only the principal declares it");
  assert.equal(await refusedBy(w.k.log.append(w.fail("sha256:" + "9".repeat(64)))), "failure_unknown_contract");
  const cp = await w.checkpoint(j);
  assert.equal(await refusedBy(w.k.log.append(w.fail(j.contract))), "failure_waiting_on_principal", "a job waiting on its principal has not failed");
  const answered = await w.resolve(j, cp);
  await w.k.log.append(w.fail(j.contract));
  assert.equal(await refusedBy(w.k.log.append(w.fail(j.contract))), "failure_known", "once");
  // nothing more happens on the chain but its settlement
  const delivery = mk("delivery", w.performer, { contract: j.contract, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, answered.id, { subject: j.contract });
  assert.equal(await refusedBy(w.k.log.append(delivery)), "contract_failed");
  const cancel = mk("contract_cancellation", w.principal, { contract: j.contract, fee: credit(0), reason: "x" }, null, { subject: j.contract, cosigners: [w.performer] });
  assert.equal(await refusedBy(w.k.log.append(cancel)), "cancellation_after_failure", "a failed job is not also cancelled");
  // the settlement is the refund rule: the whole escrow back, no work paid, no job tax, the stated share of the Bond to the principal
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, answered.id, { escrow_released: credit(40) }))), "settlement_mismatches_failure", "no part of the price is paid for work not delivered");
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, answered.id, { bond_slashed: credit(0) }))), "settlement_mismatches_failure", "the stated share of the Bond is slashed");
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, answered.id, { bond_slashed: credit(100) }))), "settlement_mismatches_failure", "and no more");
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, answered.id, { fees: credit(1) }))), "settlement_mismatches_failure", "no job tax on a refund");
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, answered.id, { pro_rata_permille: 300 }))), "settlement_mismatches_failure", "no share of the price was earned");
  const [p0, f0] = [await w.k.log.balance(w.principal.did), await w.k.log.balance(w.performer.did)];
  await w.k.log.append(w.settle(j.contract, answered.id));
  assert.equal((await w.k.log.balance(w.principal.did)) - p0, 102 + 25, "the whole escrow of 102 (the price and its fee) and a quarter of the bond come back to the principal");
  assert.equal((await w.k.log.balance(w.performer.did)) - f0, 75, "the performer gets back the rest of its bond");
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced");
});

test("JO4: a failure is declared with the Bond locked and before delivery: not before any Bond, not after delivery; a Bonded job that never started may be declared failed too", async () => {
  const w = await world();
  const early = await w.job({}, "contract");
  jump(3 * DAY);
  assert.equal(await refusedBy(w.k.log.append(w.fail(early.contract))), "failure_too_early", "nothing is locked: there is nothing to refund");
  const w2 = await world();
  const delivered = await w2.k.runJob(w2.principal, w2.performer, 100, undefined, { settle: false, deadline: DEADLINE, bond: 100 });
  jump(3 * DAY);
  assert.equal(await refusedBy(w2.k.log.append(w2.fail(delivered.contract))), "failure_too_late", "after delivery the acceptance and the ruling decide");
  const w4 = await world();
  const cancelled = await w4.job();
  await w4.k.log.append(mk("contract_cancellation", w4.principal, { contract: cancelled.contract, fee: credit(0), reason: "no longer needed" }, null, { subject: cancelled.contract, cosigners: [w4.performer] }));
  jump(3 * DAY);
  assert.equal(await refusedBy(w4.k.log.append(w4.fail(cancelled.contract))), "failure_after_cancellation", "a cancelled job is settled as a cancellation");
  const w3 = await world();
  const bonded = await w3.job({}, "bond");
  jump(3 * DAY);
  assert.ok(await w3.k.log.append(w3.fail(bonded.contract, w3.principal, { cause: "deadline_passed", evidence: "the Mandate was never issued and nothing was delivered" })), "a Bonded job that never started can fail");
});

test("JO4: a new contract replaces a failed one and may resume from its last checkpoint, for the same principal and once", async () => {
  const w = await world();
  const j = await w.job();
  const cp = await w.checkpoint(j);
  const answered = await w.resolve(j, cp);
  const running = await w.job({ deadline: DEADLINE }, "mandate");
  jump(3 * DAY);
  const successor = (over: Record<string, unknown>, p = w.principal) => w.k.runJob(p, w.performer, 100, undefined, { stopAt: "contract", extra: over });
  await assert.rejects(() => successor({ replaces: "sha256:" + "9".repeat(64) }), /replaces_unknown|not a contract in this log/);
  await assert.rejects(() => successor({ replaces: j.contract }), /carries no contract failure/, "only a failed job is replaced");
  await w.k.log.append(w.fail(j.contract));
  await assert.rejects(() => successor({ replaces: j.contract }, w.other), /same principal/, "the principal chooses the new performer");
  await assert.rejects(() => successor({ resumes: cp.id }), /only when it replaces/, "resume needs a replaced contract");
  await assert.rejects(() => successor({ replaces: j.contract, resumes: j.mandate }), /not a checkpoint of/, "resume is from a checkpoint of the failed contract");
  const otherCp = await w.checkpoint(running);
  await assert.rejects(() => successor({ replaces: j.contract, resumes: otherCp.id }), /not a checkpoint of/, "a checkpoint of another contract is not the failed job's");
  const ghostCp = cp.id.replace(/.$/, cp.id.endsWith("0") ? "1" : "0");
  await assert.rejects(() => successor({ replaces: j.contract, resumes: ghostCp }), /not a checkpoint of/, "from a checkpoint that exists");
  const ok = await successor({ replaces: j.contract, resumes: cp.id });
  assert.ok(ok.contract, "the replacement resumes from the failed job's checkpoint");
  await assert.rejects(() => successor({ replaces: j.contract }), /already replaced/, "a failed job is replaced once");
  void answered; void running;
});
