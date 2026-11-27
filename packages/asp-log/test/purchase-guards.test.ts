// Rows CY2, DK3 (mutation check, launch-bar-2, 2026-11-22): two guards of the purchase rule had no test of their own. A purchase under a Mandate whose contract was revoked is refused with its own reason
// (before this test, disabling the guard changed nothing any test saw), and a purchase before any price list is in force is refused as `no_price_list`, not by an accident further down. A third guard, `self_dealing`
// for a buyer that is also a payee, cannot be reached: a payee must be a registered institution account or the Treasury, and those cannot buy (`institution_payment_not_allowed`, `treasury_payment_not_allowed`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { credit, kit, mk, party, refusedBy } from "./society-kit.ts";
import { bank } from "./harness.ts";
import { institutionDid } from "../src/index.ts";

test("a purchase under a Mandate whose contract was revoked is refused as mandate_revoked, and one under a live Mandate is not", async () => {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("pg-sponsor", 10);
  const a = await k.agent("pg-agent", sponsor, { funds: 200 });
  const m = await k.openMandate(a, [{ institution: "registry", cap: credit(70), period: "month" }]);
  await k.buy(a, "registry.name.claim", 10, { mandate: m });
  const contract = ((await k.log.get(m))!.record.body as { contract: string }).contract;
  const principal = party(((await k.log.get(contract))!.record.body as { principal: string }).principal);
  await k.log.append(cosign(mk("settlement", bank, { contract, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(0), fees: credit(0) }, m, { subject: contract }), principal));
  assert.equal(await refusedBy(k.buy(a, "registry.name.claim", 10, { mandate: m })), "mandate_revoked");
  const fresh = await k.openMandate(a, [{ institution: "registry", cap: credit(70), period: "month" }]);
  await k.buy(a, "registry.name.claim", 10, { mandate: fresh });
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});

test("nothing can be bought before a price list is in force, and the refusal says so", async () => {
  const k = await kit();
  const person = await k.person("pg-person", 50);
  const p = mk("purchase", person, { service: "registry.name.claim", institution: institutionDid("registry"), price_list: "sha256:" + "1".repeat(64), quantity: 1, amount: credit(10), idempotency: "pg-1" }, null, { subject: person.did });
  assert.equal(await refusedBy(k.log.append(p)), "no_price_list");
});
