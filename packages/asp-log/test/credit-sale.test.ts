/**
 * The purchase flow against the provider's TEST MODE (register row DK1370; spec-delta S1419): an order, a payment by a published test card, and only on success the signed lot (the operator signs and the owner
 * countersigns); a declined card sells nothing; the same order is never sold twice; a refund burns the unspent credits and refunds the money in the provider. No network, no money. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { kit, mk, nowIso, operator, owner, refusedBy, DAY } from "./society-kit.ts";
import { TestProvider, sellCredits, refundCredits, referenceHash } from "../../asp-package/src/payments.ts";

async function world() {
  const k = await kit();
  const buyer = await k.person("sale-buyer");
  const provider = new TestProvider();
  const recordLot = async (body: Record<string, unknown>, holder: string) => { const r = mk("credit_lot", operator, body, null, { subject: holder, cosigners: [owner] }); await k.log.append(r); return { id: r.id }; };
  const deps = { provider, recordLot, now: () => new Date(nowIso()), creditValue: 5, currency: "USD", expiresDays: 365, refundDays: 14 };
  return { ...k, buyer, provider, deps, recordLot };
}

test("a paid test order becomes a lot; the order, the reference hash and the lot agree; the books balance", async () => {
  const w = await world();
  const sale = await sellCredits(w.deps, { holder: w.buyer.did, credits: 1000, method: "test-card-ok", idempotency: "order-1" });
  assert.equal(sale.order.status, "paid");
  assert.equal(sale.order.amount_minor, 5000);
  assert.ok(sale.lot);
  assert.equal(await w.log.balance(w.buyer.did), 1000);
  const lot = (await w.log.get(sale.lot!))!.record.body as { reference: string; expires: string; refund_until: string };
  assert.equal(lot.reference, referenceHash("test-mode", sale.order.id), "the log holds the hash of the provider's reference, nothing else of the payment");
  assert.ok(Date.parse(lot.expires) - Date.parse(nowIso()) >= 364 * DAY && Date.parse(lot.refund_until) - Date.parse(nowIso()) <= 15 * DAY);
  assert.deepEqual([(await w.log.creditClassAudit()).sold, (await w.log.creditAudit()).verdict], [1000, "balanced"]);
});

test("a declined card or an unknown method sells nothing; the same order is not sold twice", async () => {
  const w = await world();
  const declined = await sellCredits(w.deps, { holder: w.buyer.did, credits: 500, method: "test-card-declined", idempotency: "order-2" });
  assert.deepEqual([declined.order.status, declined.lot, declined.order.reason], ["failed", undefined, "declined"]);
  const unknown = await sellCredits(w.deps, { holder: w.buyer.did, credits: 500, method: "a-real-card-number", idempotency: "order-3" });
  assert.equal(unknown.lot, undefined);
  assert.equal(await w.log.balance(w.buyer.did), 0, "no credit without a payment");
  assert.equal((await w.log.creditClassAudit()).sold, 0);
  const first = await sellCredits(w.deps, { holder: w.buyer.did, credits: 200, method: "test-card-ok", idempotency: "order-4" });
  assert.ok(first.lot);
  await assert.rejects(sellCredits(w.deps, { holder: w.buyer.did, credits: 200, method: "test-card-ok", idempotency: "order-4" }), /one lot per payment reference|credit_lot_reference_known/, "the same order again is refused by the log");
  assert.equal(await w.log.balance(w.buyer.did), 200, "sold once");
  await assert.rejects(sellCredits(w.deps, { holder: w.buyer.did, credits: 0, method: "test-card-ok", idempotency: "order-5" }), /whole number/);
});

test("a refund inside the window burns the unspent credits in the ledger and refunds the money in the provider, in part and then in full; more than was paid is refused", async () => {
  const w = await world();
  const sale = await sellCredits(w.deps, { holder: w.buyer.did, credits: 400, method: "test-card-ok", idempotency: "order-6" });
  const act = (amount: number) => mk("credit_lot", operator, { act: "refund", holder: w.buyer.did, amount: { value: amount, unit: "credit" }, lot: sale.lot }, null, { subject: w.buyer.did, cosigners: [owner] });
  await w.log.append(act(100));
  const part = await refundCredits(w.provider, sale.order.id, 100, 5);
  assert.deepEqual([part.refunded_minor, part.status], [500, "paid"]);
  await w.log.append(act(300));
  const rest = await refundCredits(w.provider, sale.order.id, 300, 5);
  assert.deepEqual([rest.refunded_minor, rest.status], [2000, "refunded"]);
  assert.equal(await w.log.balance(w.buyer.did), 0);
  const c = await w.log.creditClassAudit();
  assert.deepEqual([c.sold, c.refunded, c.outstanding, c.verdict], [400, 400, 0, "balanced"]);
  await assert.rejects(refundCredits(w.provider, sale.order.id, 1, 5), /not a paid order/);
  assert.equal(await refusedBy(w.log.append(act(1))), "credit_lot_empty");
  void cosign;
});
