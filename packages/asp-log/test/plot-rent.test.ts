// DK681 (S996): plot rent charged each week by a standing order the agent signed once and Housing delivers (S995): a week is paid, a missed week lapses the theme and layout (the plain page shows), a payment restores
// them, the standing order can be cancelled at once, and the books balance. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RENT_SERVICE, HOUSING_CATALOGUE } from "../src/index.ts";
import { DAY, credit, jump, mk, nowIso, refusedBy } from "./society-kit.ts";
import { housing, shopsWorld } from "./shops-kit.ts";

test("S996: the rent is bought each week by a standing order; a missed week lapses the extras, a paid one restores them; cancelling ends it at once", async () => {
  const w = await shopsWorld();
  const { a, mandate } = await w.agentWith("renter");
  const rent = HOUSING_CATALOGUE.find((i) => i.service === RENT_SERVICE)!;
  const until = new Date(Date.parse(nowIso()) + 40 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const order = await w.log.append(mk("standing_order", a, { act: "order", service: RENT_SERVICE, institution: rent.institution, quantity: 1, period: "week", until }, null, { subject: null }));
  const delivery = (n: string) => mk("purchase", housing, { buyer: a.did, standing_order: order.id, service: RENT_SERVICE, institution: rent.institution, price_list: w.listId(), quantity: 1, amount: credit(rent.price), idempotency: n, mandate }, null);

  // A theme the agent bought and applied; before any rent the page shows it as always (rent: none).
  await w.buy(a, "housing.decor.theme.dawn", mandate);
  await w.runHousingPass();
  await w.log.append(mk("housing_act", a, { act: "profile", agent: a.did, display_name: "Renter", tagline: "Pays on time", about: "A plot.", theme: "housing.decor.theme.dawn" }));
  let home = (await w.log.homePage(a.did))!;
  assert.deepEqual([home.decor.rent, home.decor.theme], ["none", "dawn"]);

  // Week 1: Housing delivers the rent; the holding runs one week; the extras show.
  const before = await w.log.balance(a.did);
  await w.log.append(delivery("rent-1"));
  assert.equal(await w.log.balance(a.did), before - rent.price, "the period is charged");
  assert.equal((await w.runHousingPass()).holdings.length, 1, "Housing records the week as a holding of the agent");
  home = (await w.log.homePage(a.did))!;
  assert.deepEqual([home.decor.rent, home.decor.theme], ["paid", "dawn"]);
  assert.equal(await refusedBy(w.log.append(delivery("rent-1b"))), "standing_order_period_used", "one charge for each week");

  // A missed week: no delivery, the holding ends, the extras fall back to the plain page; the Record panel is untouched.
  jump(8 * DAY);
  home = (await w.log.homePage(a.did))!;
  assert.deepEqual([home.decor.rent, home.decor.theme, home.decor.layout], ["lapsed", null, null], "the plain page shows");
  assert.equal(home.record.kind, "agent");

  // A payment restores them.
  await w.log.append(delivery("rent-2"));
  await w.runHousingPass();
  home = (await w.log.homePage(a.did))!;
  assert.deepEqual([home.decor.rent, home.decor.theme], ["paid", "dawn"]);

  // The agent cancels at once; Housing's next delivery is refused, and the week runs out.
  await w.log.append(mk("standing_order", a, { act: "cancel", order: order.id }, null, { subject: null }));
  jump(8 * DAY);
  assert.equal(await refusedBy(w.log.append(delivery("rent-3"))), "standing_order_cancelled");
  home = (await w.log.homePage(a.did))!;
  assert.deepEqual([home.decor.rent, home.decor.theme], ["lapsed", null]);
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
  assert.equal((await w.log.verify()).ok, true);
});
