/**
 * Gates and period limits on price-list items (register row DK93; credits.md CR-11; spec-delta S1708): an item of any institution may name a gate (a tier, a valid certificate) and a limit per buyer per period.
 * The log refuses a purchase of a gated item by a buyer without the certificate or the tier, and a purchase over the period limit; a refund does not give the limit back. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { institutionDid } from "../src/index.ts";
import { DAY, PRICES, credit, jump, kit, market, mk, refusedBy, type Party } from "./society-kit.ts";

const SPLIT = PRICES.find((i) => i.service === "market.posting.deposit")!.split;
const NAME_SPLIT = PRICES.find((i) => i.service === "registry.name.claim")!.split;
const ITEMS = [
  ...PRICES,
  { service: "market.report.premium", institution: market.did, price: 3, split: SPLIT, class: "standard", gate: { certificate: "foundations" } },
  { service: "market.report.senior", institution: market.did, price: 3, split: SPLIT, class: "standard", gate: { min_tier: 2 } },
  { service: "market.report.member", institution: market.did, price: 3, split: SPLIT, class: "standard", gate: { min_tier: 1 } },
  { service: "registry.tag.extra", institution: institutionDid("registry"), price: 2, split: NAME_SPLIT, class: "standard", max_per_buyer_period: { count: 3, period: "week" } },
];

async function world() {
  const k = await kit();
  const list = await k.withItems(ITEMS);
  const sponsor = await k.person("pg-sponsor", 100);
  const buyer = await k.agent("pg-buyer", sponsor, { funds: 200 });
  const other = await k.agent("pg-other", await k.person("pg-sponsor-2", 100), { funds: 200 });
  const spend = [{ institution: "market", cap: credit(50), period: "month" }, { institution: "registry", cap: credit(40), period: "month" }];
  const mandates = new Map<string, string>([[buyer.did, await k.openMandate(buyer, spend)], [other.did, await k.openMandate(other, spend)]]);
  let n = 0;
  const buy = (by: Party, service: string, quantity = 1) => {
    const item = ITEMS.find((i) => i.service === service)!;
    return k.log.append(mk("purchase", by, { service, institution: item.institution, price_list: list, quantity, amount: credit(item.price * quantity), idempotency: `pg-${++n}`, mandate: mandates.get(by.did)! }));
  };
  return { k, buyer, other, buy };
}

test("DK93: a gated item of any institution is refused to a buyer without the certificate or the tier, and sold to one who has it", async () => {
  const w = await world();
  assert.equal(await refusedBy(w.buy(w.buyer, "market.report.premium")), "gate_certificate", "no certificate");
  assert.equal(await refusedBy(w.buy(w.buyer, "market.report.senior")), "gate_tier", "a tier 1 agent is below tier 2");
  await w.k.cert(w.buyer.did, "foundations");
  assert.ok(await w.buy(w.buyer, "market.report.premium"), "with a valid certificate of the skill");
  assert.equal(await refusedBy(w.buy(w.other, "market.report.premium")), "gate_certificate", "another buyer without one is still refused");
  assert.ok(await w.buy(w.buyer, "market.report.member"), "tier 1 is the tier the gate asks for: the boundary is allowed");
  assert.ok(await w.buy(w.other, "registry.tag.extra"), "an item with no gate is sold to anyone");
});

test("DK93: a certificate of another skill does not open the gate, and an expired one does not either", async () => {
  const w = await world();
  await w.k.cert(w.buyer.did, "arithmetic");
  assert.equal(await refusedBy(w.buy(w.buyer, "market.report.premium")), "gate_certificate", "the gate names foundations");
  const short = await w.k.cert(w.other.did, "foundations", 1, 2);
  assert.ok(short);
  assert.ok(await w.buy(w.other, "market.report.premium"), "valid now");
  jump(3 * DAY);
  assert.equal(await refusedBy(w.buy(w.other, "market.report.premium")), "gate_certificate", "expired after two days");
});

test("DK93: a purchase over the item's limit per buyer per period is refused, counted by quantity, per buyer, and the count starts again in the next period", async () => {
  const w = await world();
  assert.ok(await w.buy(w.buyer, "registry.tag.extra", 2));
  assert.equal(await refusedBy(w.buy(w.buyer, "registry.tag.extra", 2)), "purchase_over_period_limit", "2 and 2 is over 3 in a week");
  assert.ok(await w.buy(w.buyer, "registry.tag.extra", 1), "the third unit is the limit, not over it");
  assert.equal(await refusedBy(w.buy(w.buyer, "registry.tag.extra", 1)), "purchase_over_period_limit", "a fourth");
  assert.ok(await w.buy(w.other, "registry.tag.extra", 3), "another buyer has its own count");
  jump(8 * DAY);
  assert.ok(await w.buy(w.buyer, "registry.tag.extra", 3), "a new week starts from zero");
});
