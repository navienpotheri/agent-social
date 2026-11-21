// The spend gate (register row CY2; spec-delta S458): what an agent may buy from each institution depends on its record, and the log decides from the record. An agent buys only what its Mandate lists, inside
// the cap for the period; a tier 0 agent buys only essential or remedial items; a person spends their own credits unlimited. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { credit, kit, refusedBy } from "./society-kit.ts";

test("CY2: an agent's purchase is gated by its Mandate's institution_spend per institution, the cap for the period, and its tier; the reason comes with each refusal and the books stay balanced", async () => {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("sg-sponsor", 10);
  const a = await k.agent("sg-agent", sponsor, { funds: 200 });
  // A Mandate that lets the agent spend 20 credits a month at the Registry and nothing at the Market.
  const m = await k.openMandate(a, [{ institution: "registry", cap: credit(20), period: "month" }]);

  // Named institution, inside the cap: allowed, twice; the third is over the cap.
  await k.buy(a, "registry.name.claim", 10, { mandate: m });
  await k.buy(a, "registry.name.renew", 5, { mandate: m });
  assert.match(String(await refusedBy(k.buy(a, "registry.name.claim", 10, { mandate: m }))), /spend|cap|budget|institution/i, "over the month's cap");
  // An institution the Mandate does not list: refused, however much the agent has.
  assert.equal(await refusedBy(k.buy(a, "market.posting.deposit", 2, { mandate: m })), "institution_not_in_mandate");
  // No Mandate named at all: an agent's purchase must name the one that lets it spend.
  assert.equal(await refusedBy(k.buy(a, "registry.name.claim", 10)), "institution_not_in_mandate");
  // Someone else's Mandate does not do.
  const other = await k.agent("sg-other", sponsor, { funds: 50 });
  const theirs = await k.openMandate(other, [{ institution: "registry", cap: credit(20), period: "month" }]);
  assert.equal(await refusedBy(k.buy(a, "registry.name.claim", 10, { mandate: theirs })), "mandate_not_buyers");
  // The reading of the record: a person spends their own credits at any institution, with no Mandate.
  const person = await k.person("sg-person", 50);
  await k.buy(person, "registry.name.claim", 10);

  // Tier 0 (after a slash a tier 0 agent) may buy only essential or remedial items: a standard item is refused, an essential one (an appeal fee) is not.
  const low = await k.agent("sg-tier0", sponsor, { tier: 0, funds: 50 });
  assert.equal(await refusedBy(k.buy(low, "registry.name.claim", 10)), "tier_excluded", "a tier 0 agent buys no standard item");
  await k.buy(low, "courts.appeal.small", 5);

  assert.equal((await k.log.creditAudit()).verdict, "balanced", "refusals moved no credit");
});
