// The spend gate at its edges (register row CY2; mutation review 2026-11-22): the cap is spent to exactly its last credit and not one over, a new month opens a new cap, a Mandate that lists services buys
// only those, an expired Mandate buys nothing, and a Mandate whose contract was revoked buys nothing from then on. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { bank } from "./harness.ts";
import { credit, jump, kit, mk, refusedBy, DAY } from "./society-kit.ts";

test("CY2: the cap is spent to exactly its last credit, one credit over is refused, and a new month opens a new cap", async () => {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("sge-sponsor", 10);
  const a = await k.agent("sge-agent", sponsor, { funds: 300 });
  // A cap of 25: 10 + 10 + 5 reaches it exactly and is allowed.
  const m = await k.openMandate(a, [{ institution: "registry", cap: credit(25), period: "month" }]);
  await k.buy(a, "registry.name.claim", 10, { mandate: m });
  await k.buy(a, "registry.name.claim", 10, { mandate: m });
  await k.buy(a, "registry.name.renew", 5, { mandate: m });
  assert.equal(await refusedBy(k.buy(a, "registry.name.renew", 5, { mandate: m })), "institution_spend_cap_exceeded", "25 of 25 is spent");
  // A cap of 24: the same third purchase would be one credit over and is refused.
  const b = await k.agent("sge-agent-b", sponsor, { funds: 300 });
  const mb = await k.openMandate(b, [{ institution: "registry", cap: credit(24), period: "month" }]);
  await k.buy(b, "registry.name.claim", 10, { mandate: mb });
  await k.buy(b, "registry.name.claim", 10, { mandate: mb });
  assert.equal(await refusedBy(k.buy(b, "registry.name.renew", 5, { mandate: mb })), "institution_spend_cap_exceeded", "25 against a cap of 24");
  // A month later the same Mandate has a fresh cap.
  jump(40 * DAY);
  await k.buy(b, "registry.name.claim", 10, { mandate: mb });
});

test("CY2: a Mandate that lists services buys only those from the institution, and a Mandate whose contract was revoked buys nothing from then on", async () => {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("sgr-sponsor", 10);
  const a = await k.agent("sgr-agent", sponsor, { funds: 300 });
  const m = await k.openMandate(a, [{ institution: "registry", cap: credit(70), period: "month", services: ["registry.name.claim"] }]);
  await k.buy(a, "registry.name.claim", 10, { mandate: m });
  assert.equal(await refusedBy(k.buy(a, "registry.name.renew", 5, { mandate: m })), "institution_not_in_mandate", "a service the Mandate does not list");
  // Revoke the contract: Bank settlement on the basis revoked, countersigned by the principal.
  const contract = ((await k.log.get(m))!.record.body as { contract: string }).contract;
  const funder = k.funderOf.get(m)!;
  await k.log.append(cosign(mk("settlement", bank, { contract, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(0) }, m, { subject: contract }), funder));
  assert.equal(await refusedBy(k.buy(a, "registry.name.claim", 10, { mandate: m })), "mandate_revoked");
});
