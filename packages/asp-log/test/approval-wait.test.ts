// T21 (owner's answer of 2026-11-21, spec-delta S1441): a contract's deadline that binds is extended by the time the performer waited for its principal to answer Checkpoints; the wait an Action claims is checked
// against the Checkpoints in the chain (a wait the log does not show is refused); an agent late by more than its wait is still late.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { alice, bank, codeOf, coder, memory, registerParties } from "./harness.ts";

const T0 = Date.parse("2026-10-05T09:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString().replace(".000Z", "Z");
const mk = (type: string, by: { did: string } & Signer, body: Record<string, unknown>, prev: string | null, subject: string | null, min: number): AspRecord =>
  createRecord({ type: type as never, issuer: by.did, subject, body, prev, issued_at: at(min) }, by);

/** A running contract whose deadline binds, at 09:30; then a Checkpoint raised at 09:20 and answered at 09:50 (thirty minutes waited) when `waited`. */
async function job(deadlineMin: number, binds: boolean) {
  const log = new EventLog(await memory.make());
  await registerParties(log);
  const money = (v: number) => ({ value: v, unit: "credit" as const });
  const contract = cosign(mk("contract", alice, {
    principal: alice.did, performer: coder.did, bank: bank.did, purpose: "Fix the flaky test", price: money(0), verification: "deterministic", deadline: at(deadlineMin), ...(binds ? { deadline_binds: true } : {}),
    basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
  }, null, coder.did, 0), coder);
  await log.append(contract);
  const bond = mk("bond", coder, { contract: contract.id, backer: coder.did, amount: money(0), escrow: { payer: alice.did, amount: money(0) }, slashing_conditions: ["lost_dispute"] }, contract.id, contract.id, 1);
  await log.append(bond);
  const mandate = mk("mandate", alice, {
    contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false },
    nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2026-10-30T00:00:00Z", revocable: true,
  }, bond.id, coder.did, 2);
  assert.equal((await log.append(mandate)).state, "Running");
  return { log, contract, mandate };
}
const checkpoint = (c: AspRecord, prev: string, min: number) => mk("checkpoint", coder, { contract: c.id, kind: "plan", question: "May I proceed?", options: ["yes"] }, prev, c.id, min);
const answer = (c: AspRecord, about: string, min: number) => mk("attestation", alice, { kind: "checkpoint_resolution", about, verdict: "approved" }, about, c.id, min);
const hex = (x: string) => "sha256:" + x.repeat(64).slice(0, 64);
const delivery = (c: AspRecord, prev: string, min: number) => mk("delivery", coder, {
  contract: c.id, result: { summary: "Fixed the race", artifacts: [{ uri: "https://git.example.com/pull/1", sha256: hex("a") }] },
  evidence: { trace: { uri: "asp-trace://coder/job/1", sha256: hex("b"), media_type: "application/x-ndjson" }, forecasts: [{ claim: "tests pass", p_permille: 850, made_at: at(min - 1) }], tests: { passed: 3, failed: 0 } },
}, prev, c.id, min);
const action = (c: AspRecord, seconds: number, min: number) => mk("action", coder, { contract: c.id, scopes_used: ["repo.read"], metrics: { approval_wait_seconds: seconds } }, null, c.id, min);

test("a delivery after a binding deadline is refused; with the wait the log shows, a delivery within the deadline plus the wait is accepted", async () => {
  const late = await job(30, true);
  assert.equal(await codeOf(late.log.append(delivery(late.contract, late.mandate.id, 40))), "GUARD_FAILED", "ten minutes late, no wait");
  const onTime = await job(30, true);
  assert.equal((await onTime.log.append(delivery(onTime.contract, onTime.mandate.id, 29))).state, "Delivered");

  // a Checkpoint raised at 09:20 and answered at 09:50: thirty minutes waited, so the deadline is 10:00
  const extended = await job(30, true);
  const cp = checkpoint(extended.contract, extended.mandate.id, 20);
  await extended.log.append(cp);
  await extended.log.append(answer(extended.contract, cp.id, 50));
  assert.equal((await extended.log.append(delivery(extended.contract, (await extended.log.chainInfo(extended.contract.id))!.head, 58))).state, "Delivered", "at 09:58: after 09:30, within 09:30 plus the thirty minutes waited");
});

test("an agent late by more than its wait is still late; a deadline that does not bind stays informational", async () => {
  const j = await job(30, true);
  const cp = checkpoint(j.contract, j.mandate.id, 20);
  await j.log.append(cp);
  const ans = answer(j.contract, cp.id, 50);
  await j.log.append(ans);
  assert.equal(await codeOf(j.log.append(delivery(j.contract, ans.id, 65))), "GUARD_FAILED", "at 10:05: late by five minutes more than the wait");
  const free = await job(30, false);
  assert.equal((await free.log.append(delivery(free.contract, free.mandate.id, 120))).state, "Delivered", "no deadline_binds: as before");
});

test("the wait an Action claims must be shown by the Checkpoints: a claim the log does not show is refused, a claim it shows is kept, and the claims add up", async () => {
  const j = await job(30, true);
  assert.equal(await codeOf(j.log.append(action(j.contract, 600, 10))), "GUARD_FAILED", "no Checkpoint in the chain shows ten minutes");
  const cp = checkpoint(j.contract, j.mandate.id, 20);
  await j.log.append(cp);
  // while the Checkpoint is open, the wait so far counts: at 09:25 five minutes have been waited
  assert.equal(await codeOf(j.log.append(action(j.contract, 290, 25))), undefined);
  assert.equal(await codeOf(j.log.append(action(j.contract, 290, 26))), "GUARD_FAILED", "the first claim used up what the log showed at that point");
  const ans = answer(j.contract, cp.id, 50);
  await j.log.append(ans);
  assert.equal(await codeOf(j.log.append(action(j.contract, 1500, 51))), undefined, "after the answer the whole thirty minutes are shown: 290 + 1500 is within 1800 plus the rounding");
  assert.equal(await codeOf(j.log.append(action(j.contract, 100, 52))), "GUARD_FAILED", "and no more than the Checkpoints show in all");
});
