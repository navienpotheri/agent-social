/**
 * Cancelling and amending a contract by consent (register row JO5; spec-delta S1701): one party signs and the other cosigns; a cancellation names a fee paid from the escrow, which the settlement must then release
 * exactly; an amendment changes the purpose or the acceptance criteria and never the price or the deadline; each refusal is named. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { bank } from "./harness.ts";
import { credit, kit, mk, refusedBy, type Party } from "./society-kit.ts";

async function world() {
  const k = await kit();
  const principal = await k.person("jo-principal", 5000);
  const sponsor = await k.person("jo-sponsor", 100);
  const performer = await k.agent("jo-performer", sponsor, { funds: 2000 });
  const stranger = await k.person("jo-stranger", 100);
  const cancel = (contract: string, by: Party, other: Party | undefined, fee: number, over: Record<string, unknown> = {}) => mk("contract_cancellation", by, { contract, fee: credit(fee), reason: "the principal no longer needs the work", ...over }, null, { subject: contract, ...(other ? { cosigners: [other] } : {}) });
  const amend = (contract: string, by: Party, other: Party | undefined, changes: Record<string, unknown>, over: Record<string, unknown> = {}) => mk("contract_amendment", by, { contract, changes, reason: "the tests were left out of the first scope", ...over }, null, { subject: contract, ...(other ? { cosigners: [other] } : {}) });
  const settle = (contract: string, prev: string, over: Record<string, unknown> = {}) => mk("settlement", bank, { contract, basis: "revoked", pro_rata_permille: 175, escrow_released: credit(7), fees: credit(0), bond_returned: credit(0), bond_slashed: credit(0), ...over }, prev, { subject: contract, cosigners: [principal] });
  return { k, principal, performer, stranger, cancel, amend, settle };
}

test("JO5: a cancellation is a party's, cosigned by the other, before delivery, with a fee no larger than the price, and once; a cancelled contract takes no further step but its settlement", async () => {
  const w = await world();
  const j = await w.k.runJob(w.principal, w.performer, 40, undefined, { stopAt: "mandate" });
  assert.equal(await refusedBy(w.k.log.append(w.cancel(j.contract, w.stranger, w.performer, 5))), "cancellation_not_a_party", "a stranger cannot cancel");
  assert.equal(await refusedBy(w.k.log.append(w.cancel(j.contract, w.principal, undefined, 5))), "cancellation_needs_consent", "neither side acts for the other");
  assert.equal(await refusedBy(w.k.log.append(w.cancel(j.contract, w.principal, w.stranger, 5))), "cancellation_needs_consent", "the stranger's cosignature is not the performer's");
  assert.equal(await refusedBy(w.k.log.append(w.cancel(j.contract, w.principal, w.performer, 41))), "cancellation_fee_over_price");
  assert.equal(await refusedBy(w.k.log.append(w.cancel("sha256:" + "9".repeat(64), w.principal, w.performer, 5))), "cancellation_unknown_contract");
  const ok = w.cancel(j.contract, w.principal, w.performer, 7);
  await w.k.log.append(ok);
  assert.equal(await refusedBy(w.k.log.append(w.cancel(j.contract, w.performer, w.principal, 0))), "cancellation_known", "once");
  // no further step on the chain: a delivery is refused
  const delivery = mk("delivery", w.performer, { contract: j.contract, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, j.mandate, { subject: j.contract });
  assert.equal(await refusedBy(w.k.log.append(delivery)), "contract_cancelled");
  // the settlement must release exactly the fee, take no job tax and slash nothing
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, j.mandate, { escrow_released: credit(0) }))), "settlement_mismatches_cancellation", "the fee was agreed: 7, not 0");
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, j.mandate, { escrow_released: credit(40) }))), "settlement_mismatches_cancellation", "nor all of it");
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, j.mandate, { fees: credit(1) }))), "settlement_mismatches_cancellation", "no job tax on a cancellation");
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, j.mandate, { pro_rata_permille: 500 }))), "settlement_mismatches_cancellation", "the share of the price paid must be the fee's");
  assert.equal(await refusedBy(w.k.log.append(w.settle(j.contract, j.mandate, { bond_slashed: credit(0), bond_returned: credit(0), escrow_released: credit(7), pro_rata_permille: 174 }))), "settlement_mismatches_cancellation", "to the permille");
  const before = await w.k.log.balance(w.performer.did);
  await w.k.log.append(w.settle(j.contract, j.mandate));
  assert.equal(await w.k.log.balance(w.performer.did), before + 7, "the performer is paid the fee");
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced", "and the books balance");
  assert.equal((await w.k.log.termsOf(j.contract))!.cancelled!.fee, 7);
});

test("JO5: the performer may cancel too, a cancellation before any Bond locks nothing and carries no fee, and a delivered contract cannot be cancelled", async () => {
  const w = await world();
  const early = await w.k.runJob(w.principal, w.performer, 40, undefined, { stopAt: "contract" });
  assert.equal(await refusedBy(w.k.log.append(w.cancel(early.contract, w.performer, w.principal, 3))), "cancellation_fee_without_escrow", "nothing is locked yet");
  await w.k.log.append(w.cancel(early.contract, w.performer, w.principal, 0));
  assert.equal((await w.k.log.termsOf(early.contract))!.cancelled!.fee, 0, "the performer cancelled, with the principal's consent and no fee");
  const done = await w.k.runJob(w.principal, w.performer, 40, undefined, { settle: false });
  assert.equal(await refusedBy(w.k.log.append(w.cancel(done.contract, w.principal, w.performer, 0))), "cancellation_too_late", "after delivery the acceptance, the dispute and the ruling decide");
});

test("JO5: an amendment changes the purpose or the criteria, by consent, before delivery, at most three times; the terms in force apply each in order; the price and deadline are not amendable", async () => {
  const w = await world();
  const j = await w.k.runJob(w.principal, w.performer, 40, undefined, { stopAt: "mandate" });
  assert.equal(await refusedBy(w.k.log.append(w.amend(j.contract, w.stranger, w.performer, { purpose: "x" }))), "amendment_not_a_party");
  assert.equal(await refusedBy(w.k.log.append(w.amend(j.contract, w.principal, undefined, { purpose: "x" }))), "amendment_needs_consent");
  await assert.rejects(() => w.k.log.append(w.amend(j.contract, w.principal, w.performer, { price: credit(99) })), /SCHEMA_INVALID/, "the price is not amendable");
  await assert.rejects(() => w.k.log.append(w.amend(j.contract, w.principal, w.performer, { deadline: "2028-01-01T00:00:00Z" })), /SCHEMA_INVALID/, "nor the deadline");
  const first = (await w.k.log.termsOf(j.contract))!;
  assert.deepEqual(first.amendments, []);
  await w.k.log.append(w.amend(j.contract, w.principal, w.performer, { purpose: "Refactor the date parser and its tests" }));
  await w.k.log.append(w.amend(j.contract, w.performer, w.principal, { acceptance_criteria: ["all tests pass"] }));
  const mid = (await w.k.log.termsOf(j.contract))!;
  assert.equal(mid.purpose, "Refactor the date parser and its tests");
  assert.deepEqual(mid.acceptance_criteria, ["all tests pass"]);
  assert.equal(mid.amendments.length, 2);
  await w.k.log.append(w.amend(j.contract, w.principal, w.performer, { purpose: "Refactor the date parser, its tests and its docs" }));
  assert.equal(await refusedBy(w.k.log.append(w.amend(j.contract, w.principal, w.performer, { purpose: "again" }))), "amendment_limit", "a fourth change is a new contract");
  assert.equal((await w.k.log.termsOf(j.contract))!.purpose, "Refactor the date parser, its tests and its docs", "the latest purpose is in force");
  assert.equal((await w.k.log.termsOf("sha256:" + "8".repeat(64))), null);
  const done = await w.k.runJob(w.principal, w.performer, 40, undefined, { settle: false });
  assert.equal(await refusedBy(w.k.log.append(w.amend(done.contract, w.principal, w.performer, { purpose: "late" }))), "amendment_too_late");
  void cosign; void ({} as Signer);
});

test("JO5: a contract of no price cancelled by consent can still be settled (a fee of nothing is a share of nothing, not a division by zero)", async () => {
  const w = await world();
  const j = await w.k.runJob(w.principal, w.performer, 0, undefined, { stopAt: "mandate" });
  await w.k.log.append(w.cancel(j.contract, w.principal, w.performer, 0));
  await w.k.log.append(w.settle(j.contract, j.mandate, { pro_rata_permille: 0, escrow_released: credit(0) }));
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced");
});
