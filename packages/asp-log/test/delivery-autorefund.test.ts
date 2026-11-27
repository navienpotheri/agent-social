// DK682 (S995): an institution signs the delivery of a standing order its buyer signed once, with every rule of a purchase applied to the buyer; and an automatic refund (the operator's, seven days after a purchase
// the institution never answered). The closed loop stays balanced. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_REFUND_AFTER_MS, buyerOf } from "../src/index.ts";
import { DAY, PRICES, credit, jump, kit, mk, nowIso, operator, refusedBy, registrar, shops } from "./society-kit.ts";

test("S995: the institution the order names delivers it, naming the buyer; any other signer, another buyer's order, or a missing order is refused; the buyer pays, the period's run is used and the books balance", async () => {
  const k = await kit();
  const listId = await k.withPrices();
  const item = PRICES.find((i) => i.service === "registry.name.renew")!;
  const buyer = await k.person("dl-buyer", 100), other = await k.person("dl-other", 100);
  const until = new Date(Date.parse(nowIso()) + 30 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const so = await k.log.append(mk("standing_order", buyer, { act: "order", service: item.service, institution: item.institution, quantity: 1, period: "week", until }, null, { subject: null }));
  const otherSo = await k.log.append(mk("standing_order", other, { act: "order", service: item.service, institution: item.institution, quantity: 1, period: "week", until }, null, { subject: null }));
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const delivery = (by: typeof registrar | typeof shops, over: Record<string, unknown> = {}) => mk("purchase", by, clean({ buyer: buyer.did, standing_order: so.id, service: item.service, institution: item.institution, price_list: listId, quantity: 1, amount: credit(item.price), idempotency: `d-${Math.random()}`, ...over }), null);
  const before = await k.log.balance(buyer.did);
  assert.equal(await refusedBy(k.log.append(delivery(shops))), "delivery_wrong_institution", "another institution may not deliver it");
  assert.equal(await refusedBy(k.log.append(delivery(registrar, { standing_order: undefined }))), "delivery_needs_order");
  assert.equal(await refusedBy(k.log.append(delivery(registrar, { standing_order: otherSo.id }))), "delivery_not_buyers_order");
  assert.equal(await refusedBy(k.log.append(delivery(registrar, { standing_order: "sha256:" + "4".repeat(64) }))), "standing_order_unknown");
  const d1 = delivery(registrar);
  await k.log.append(d1);
  assert.equal(buyerOf(d1), buyer.did, "the record names its buyer");
  assert.equal(await k.log.balance(buyer.did), before - item.price, "the buyer is charged");
  assert.equal((await k.log.purchasesBy(buyer.did)).length, 1, "the buyer's purchases include it");
  assert.equal(await refusedBy(k.log.append(delivery(registrar))), "standing_order_period_used", "one delivery for each period");
  jump(8 * DAY);
  await k.log.append(delivery(registrar));
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal((await k.log.verify()).ok, true);
});

test("S995: a purchase the institution never answers is refunded by the operator after seven days, the whole price less the burn, once; before that, by anyone else, or for the wrong amount, it is refused", async () => {
  const k = await kit();
  const listId = await k.withPrices();
  const item = PRICES.find((i) => i.service === "clinic.checkup")!;
  const buyer = await k.person("ar-buyer", 100);
  const start = await k.log.balance(buyer.did);
  const purchase = mk("purchase", buyer, { service: item.service, institution: item.institution, price_list: listId, quantity: 1, amount: credit(item.price), idempotency: "ar-1" }, null);
  await k.log.append(purchase);
  assert.equal(await k.log.balance(buyer.did), start - item.price);
  assert.equal((await k.log.unreceiptedPurchases(Date.parse(nowIso()))).map((p) => p.id).includes(purchase.id), true, "it has no receipt");
  const refund = (by: typeof operator | typeof buyer, amount: number, over: Record<string, unknown> = {}) => mk("receipt", by, Object.fromEntries(Object.entries({ purchase: purchase.id, status: "refunded", refund_amount: credit(amount), auto_refund: true, ...over }).filter(([, v]) => v !== undefined)), purchase.id);
  assert.equal(await refusedBy(k.log.append(refund(operator, item.price))), "auto_refund_too_soon");
  jump(AUTO_REFUND_AFTER_MS + DAY);
  assert.equal(await refusedBy(k.log.append(refund(buyer, item.price))), "auto_refund_wrong_issuer", "only the operator");
  assert.equal(await refusedBy(k.log.append(refund(operator, 1))), "auto_refund_amount", "the whole price less the burn");
  assert.equal(await refusedBy(k.log.append(refund(operator, item.price, { status: "failed" }))), "auto_refund_not_refund");
  assert.equal(await refusedBy(k.log.append(refund(operator, item.price, { auto_refund: undefined }))), "receipt_wrong_issuer", "without the flag only the institution signs");
  const due = (await k.log.unreceiptedPurchases(Date.parse(nowIso()) - AUTO_REFUND_AFTER_MS)).map((p) => p.id);
  assert.ok(due.includes(purchase.id), "the purchase is due for the automatic refund");
  await k.log.append(refund(operator, item.price));
  assert.equal(await k.log.balance(buyer.did), start, "the buyer is made whole without asking");
  assert.equal((await k.log.unreceiptedPurchases(Date.parse(nowIso()))).map((p) => p.id).includes(purchase.id), false, "answered now");
  assert.ok(await refusedBy(k.log.append(refund(operator, item.price))), "a second refund is refused");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal((await k.log.verify()).ok, true);
});
