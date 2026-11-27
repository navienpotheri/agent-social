// DK1710: rent as a credit sink. An agent pays the weekly rent by a standing order over several weeks; the Treasury's holding rises, the burn is taken out and Housing is paid by the published split, the agent's balance falls by
// exactly the charges, nothing is created or lost (the supply audit stays balanced), a missed week lapses the extras and a payment restores them. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RENT_SERVICE, HOUSING_CATALOGUE, HOUSING_DID, TREASURY_DID, splitParts } from "../src/index.ts";
import { DAY, credit, jump, mk, nowIso } from "./society-kit.ts";
import { housing, shopsWorld } from "./shops-kit.ts";

test("DK1710: four weeks of rent move exactly the published split; a missed week lapses the extras and a payment restores them; the books stay balanced", async () => {
  const w = await shopsWorld();
  const { a, mandate } = await w.agentWith("renter", { funds: 200 });
  const rent = HOUSING_CATALOGUE.find((i) => i.service === RENT_SERVICE)!;
  assert.equal(rent.price, 5, "the published price of a plot's rent is 5 credits a week");
  const split = rent.split;
  assert.equal(split.treasury_permille + split.burn_permille + split.payees.reduce((n, p) => n + p.permille, 0), 1000, "the split is the whole price");
  const until = new Date(Date.parse(nowIso()) + 60 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const order = await w.log.append(mk("standing_order", a, { act: "order", service: RENT_SERVICE, institution: rent.institution, quantity: 1, period: "week", until }, null, { subject: null }));
  const delivery = (n: string) => mk("purchase", housing, { buyer: a.did, standing_order: order.id, service: RENT_SERVICE, institution: rent.institution, price_list: w.listId(), quantity: 1, amount: credit(rent.price), idempotency: n, mandate }, null);
  await w.buy(a, "housing.decor.theme.dawn", mandate);
  await w.runHousingPass();
  await w.log.append(mk("housing_act", a, { act: "profile", agent: a.did, display_name: "Renter", tagline: "Pays on time", about: "A plot.", theme: "housing.decor.theme.dawn" }));

  const bal = async () => ({ t: await w.log.balance(TREASURY_DID), h: await w.log.balance(HOUSING_DID), a: await w.log.balance(a.did) });
  const start = await bal();
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
  const weeks = 4;
  for (let i = 1; i <= weeks; i++) {
    await w.log.append(delivery(`rent-${i}`));
    await w.runHousingPass();
    assert.equal((await w.log.homePage(a.did))!.decor.rent, "paid", `week ${i}`);
    if (i < weeks) jump(7 * DAY + 1000);
  }
  const end = await bal();
  assert.equal(start.a - end.a, weeks * rent.price, "the agent paid exactly the charges");
  const parts = splitParts(rent.price, split);
  assert.deepEqual([parts.treasury, parts.burn, parts.payees[0]!.amount], [1, 0, 4], "a rent of 5 credits is 1 to the Treasury, none burnt (rounded down) and 4 to Housing: at this price rent is a transfer to the Treasury, not a burn");
  assert.equal(end.t - start.t, weeks * parts.treasury, "the Treasury's holding rose by exactly its share of the rent");
  assert.equal(end.h - start.h, weeks * parts.payees[0]!.amount, "Housing received its share");
  assert.equal(weeks * rent.price - (end.t - start.t) - (end.h - start.h), weeks * parts.burn, "the rest was burnt");
  assert.equal((await w.log.creditAudit()).verdict, "balanced", "nothing created or lost");

  // A missed week lapses the extras; a payment restores them.
  jump(8 * DAY);
  assert.equal((await w.log.homePage(a.did))!.decor.rent, "lapsed");
  await w.log.append(delivery("rent-5"));
  await w.runHousingPass();
  assert.deepEqual([(await w.log.homePage(a.did))!.decor.rent, (await w.log.homePage(a.did))!.decor.theme], ["paid", "dawn"]);
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
});
