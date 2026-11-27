// Row DK390 (spec-delta S963): a standing order the buyer signs once; the log lets one purchase through for each period, only for what the order states, only for its buyer, only while it is live; every ordinary rule of a purchase still applies.
// Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, PRICES, credit, jump, kit, mk, nowIso, refusedBy } from "./society-kit.ts";

test("DK390: a weekly standing order runs once a week; a second run in the week, another buyer, a changed purchase, a cancelled or expired order and an agent with no Mandate are refused", async () => {
  const k = await kit();
  const listId = await k.withPrices();
  const item = PRICES.find((i) => i.service === "registry.name.renew")!;
  const buyer = await k.person("so-buyer", 200), other = await k.person("so-other", 200);
  const until = (days: number) => new Date(Date.parse(nowIso()) + days * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const order = (by: typeof buyer, over: Record<string, unknown> = {}) => mk("standing_order", by, { act: "order", service: item.service, institution: item.institution, quantity: 1, period: "week", until: until(30), ...over }, null, { subject: null });
  const run = (by: typeof buyer, orderId: string, nonce: string, over: Record<string, unknown> = {}) => mk("purchase", by, { service: item.service, institution: item.institution, price_list: listId, quantity: 1, amount: credit(item.price), idempotency: nonce, standing_order: orderId, ...over });

  assert.equal(await refusedBy(k.log.append(order(buyer, { until: until(400) }))), "standing_order_too_long");
  const so = await k.log.append(order(buyer));
  const before = await k.log.balance(buyer.did);
  await k.log.append(run(buyer, so.id, "w1"));
  assert.equal(await k.log.balance(buyer.did), before - item.price, "one run charges the price");
  assert.equal(await refusedBy(k.log.append(run(buyer, so.id, "w1-again"))), "standing_order_period_used", "one run in a week");
  assert.equal(await refusedBy(k.log.append(run(other, so.id, "x1"))), "standing_order_not_buyers");
  assert.equal(await refusedBy(k.log.append(run(buyer, so.id, "q2", { quantity: 2, amount: credit(item.price * 2) }))), "standing_order_mismatch", "another quantity is another purchase");
  assert.equal(await refusedBy(k.log.append(run(buyer, "sha256:" + "4".repeat(64), "u1"))), "standing_order_unknown");
  jump(8 * DAY);
  await k.log.append(run(buyer, so.id, "w2"));
  assert.equal(await k.log.balance(buyer.did), before - 2 * item.price, "the next week runs again");

  // Cancelling: only the buyer, at once, once.
  assert.equal(await refusedBy(k.log.append(mk("standing_order", other, { act: "cancel", order: so.id }, null, { subject: null }))), "standing_cancel_not_owner");
  await k.log.append(mk("standing_order", buyer, { act: "cancel", order: so.id }, null, { subject: null }));
  assert.equal(await refusedBy(k.log.append(mk("standing_order", buyer, { act: "cancel", order: so.id }, null, { subject: null }))), "standing_cancel_already");
  jump(8 * DAY);
  assert.equal(await refusedBy(k.log.append(run(buyer, so.id, "w3"))), "standing_order_cancelled");

  // An order ends on its date.
  const short = await k.log.append(order(buyer, { until: until(3) }));
  jump(5 * DAY);
  assert.equal(await refusedBy(k.log.append(run(buyer, short.id, "late"))), "standing_order_expired");

  // The ordinary rules still apply: an agent with no Mandate buys nothing, standing order or not.
  const sponsor = await k.person("so-sponsor", 50);
  const agent = await k.agent("so-agent", sponsor, { funds: 100 });
  const agentOrder = await k.log.append(order(agent));
  assert.equal(await refusedBy(k.log.append(run(agent, agentOrder.id, "a1"))), "institution_not_in_mandate", "a standing order does not widen a Mandate");
  const mandate = await k.openMandate(agent);
  await k.log.append(run(agent, agentOrder.id, "a2", { mandate }));
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal((await k.log.verify()).ok, true);
});

test("DK390: at most twenty standing orders for one buyer in all", async () => {
  const k = await kit();
  await k.withPrices();
  const item = PRICES.find((i) => i.service === "registry.name.renew")!;
  const buyer = await k.person("so-many", 10);
  const until = new Date(Date.parse(nowIso()) + 30 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  for (let i = 0; i < 20; i++) await k.log.append(mk("standing_order", buyer, { act: "order", service: item.service, institution: item.institution, quantity: 1 + (i % 5), period: i % 2 ? "week" : "day", until: new Date(Date.parse(until) + i * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") }, null, { subject: null }));
  assert.equal(await refusedBy(k.log.append(mk("standing_order", buyer, { act: "order", service: item.service, institution: item.institution, quantity: 1, period: "month", until }, null, { subject: null }))), "standing_orders_full");
});

test("DK390: an order has ended at the very moment of its end date", async () => {
  const k = await kit();
  const listId = await k.withPrices();
  const item = PRICES.find((i) => i.service === "registry.name.renew")!;
  const buyer = await k.person("so-edge", 200);
  const end = new Date(Date.parse(nowIso()) + 3 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const so = await k.log.append(mk("standing_order", buyer, { act: "order", service: item.service, institution: item.institution, quantity: 1, period: "week", until: end }, null, { subject: null }));
  const atEnd = mk("purchase", buyer, { service: item.service, institution: item.institution, price_list: listId, quantity: 1, amount: credit(item.price), idempotency: "edge", standing_order: so.id }, null, { subject: null, at: end });
  assert.equal(await refusedBy(k.log.append(atEnd)), "standing_order_expired", "at the end date the order is over");
});
