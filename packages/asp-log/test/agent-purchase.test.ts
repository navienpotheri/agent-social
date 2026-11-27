// The purchase path, as register row DK3 states its Done criterion (spec-delta S467): a test agent buys from an institution, the balances and the Treasury split reconcile, and a Mandate that does not list
// the institution is refused with a reason. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BURN_DID, TREASURY_DID, institutionDid } from "../src/index.ts";
import { credit, kit, refusedBy } from "./society-kit.ts";

test("DK3 done: an agent buys from an institution, the balances and the Treasury split reconcile to the price list, and a Mandate that does not list the institution is refused", async () => {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("ap-sponsor", 10);
  const agent = await k.agent("ap-agent", sponsor, { funds: 50 });
  const registry = institutionDid("registry");
  const mandate = await k.openMandate(agent, [{ institution: "registry", cap: credit(40), period: "month" }]);
  const bal = (d: string) => k.log.balance(d);
  const before = { agent: await bal(agent.did), registry: await bal(registry), treasury: await bal(TREASURY_DID), burn: await bal(BURN_DID) };
  const supply = (b: typeof before) => b.agent + b.registry + b.treasury + b.burn;

  // The name claim costs 10: 700 permille to the Registry, 200 to the Treasury, 100 burned (the price list's split).
  await k.buy(agent, "registry.name.claim", 10, { mandate });
  const after = { agent: await bal(agent.did), registry: await bal(registry), treasury: await bal(TREASURY_DID), burn: await bal(BURN_DID) };
  assert.equal(after.agent, before.agent - 10, "the buyer paid the price");
  assert.equal(after.registry, before.registry + 7, "the institution got its share");
  assert.equal(after.treasury, before.treasury + 2, "the Treasury got its share");
  assert.equal(after.burn, before.burn + 1, "the rest was burned");
  assert.equal(supply(after), supply(before), "the split reconciles: what the buyer paid is what the three received");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");

  // An institution the Mandate does not list is refused with the reason, and nothing moves.
  const refused = await k.buy(agent, "market.posting.deposit", 2, { mandate }).then(() => undefined, (e) => e as { detail?: string; message?: string });
  assert.equal(refused?.detail, "institution_not_in_mandate");
  assert.match(refused?.message ?? "", /Mandate/, "the reason names the Mandate");
  assert.equal(await bal(agent.did), after.agent);
  assert.equal(await refusedBy(k.buy(agent, "registry.name.claim", 10)), "institution_not_in_mandate", "and no Mandate at all");
});
