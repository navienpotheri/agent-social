/**
 * The job-data term in the log (register row JO3; spec-delta S1569): a contract may carry `data_handling`, part of what both parties sign; the log refuses an unknown term and a `retain_days` that does not fit its retention
 * by name, accepts every valid combination, and a contract without the field reads as every default. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, readDataHandling } from "@agent-social/asp-core";
import { credit, kit, mk, refusedBy } from "./society-kit.ts";

async function world() {
  const k = await kit();
  const principal = await k.person("dh-principal", 500);
  const sponsor = await k.person("dh-sponsor");
  const agent = await k.agent("dh-agent", sponsor, { funds: 10 });
  const contract = (dh?: Record<string, unknown>) => cosign(mk("contract", principal, { principal: principal.did, performer: agent.did, bank: "did:web:example.com:bank", purpose: `Job ${Math.random()}`, price: credit(20), verification: "principal", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) }, ...(dh ? { data_handling: dh } : {}) }, null, { subject: agent.did }), agent);
  return { k, contract };
}

test("JO3: every valid data_handling is accepted and a contract with none reads as every default", async () => {
  const w = await world();
  for (const dh of [undefined, {}, { term: "asp.job-data/v1" }, { commons_sharing: true }, { retention: "retain_days", retain_days: 30 }, { retention: "retain_days", retain_days: 365 }, { personal_data: "included" }, { retention: "delete_at_settlement" }]) {
    const c = w.contract(dh as Record<string, unknown> | undefined);
    await w.k.log.append(c);
    const stored = await w.k.log.get(c.id);
    assert.deepEqual(readDataHandling((stored?.record.body as { data_handling?: never }).data_handling), readDataHandling(dh as never));
  }
  assert.deepEqual(readDataHandling(undefined), { term: "asp.job-data/v1", commons_sharing: false, retention: "delete_at_settlement", retain_days: null, personal_data: "none" });
});

test("JO3: an unknown term and a retain_days that does not fit its retention are refused by name", async () => {
  const w = await world();
  assert.equal(await refusedBy(w.k.log.append(w.contract({ term: "asp.job-data/v2" }))), "data_handling_unknown_term");
  for (const dh of [{ retain_days: 30 }, { retention: "delete_at_settlement", retain_days: 30 }, { retention: "retain_days" }, { retention: "retain_days", retain_days: 0 }, { retention: "retain_days", retain_days: 366 }])
    assert.equal(await refusedBy(w.k.log.append(w.contract(dh))), "data_handling_retention_invalid", JSON.stringify(dh));
  assert.equal((await w.k.log.verify()).ok, true);
});
