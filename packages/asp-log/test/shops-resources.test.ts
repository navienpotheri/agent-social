/**
 * Resource effects (register rows DK75 and DK150; spec-delta S271; shops.md 4 and SH-13; credits.md 5.7). Fake keys only. Credits are accounting entries, not money.
 * A resource item raises the service-side limits of the buyer's sponsor for 30 days, capped per sponsor, a sink and never a faucet, and never touches standing.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CAPACITY_LEDGER, SHOPS_CATALOGUE, TREASURY_DID, catalogueProblem, resourceReconciliation, resourceExtras, withResourceExtras, type CatalogueItem } from "../src/index.ts";
import { DAY, mk, nowIso, refusedBy, treasury } from "./society-kit.ts";
import { shopsWorld } from "./shops-kit.ts";

const resourceItems = SHOPS_CATALOGUE.filter((i) => i.service.startsWith("shops.resource."));
const SPEND = [{ institution: "shops", cap: 100 }];

describe("resource effects: the scan (DK75)", () => {
  test("the four resource items are valid, each names a row of the capacity ledger for its own resource, and a standing effect is rejected", async () => {
    assert.equal(resourceItems.length, 4);
    for (const i of resourceItems) {
      assert.equal(catalogueProblem(i), null, i.service);
      assert.equal(CAPACITY_LEDGER[i.effect!.unit_cost_ref!].resource, i.effect!.type);
      assert.ok(i.effect!.cap_per_sponsor! >= i.effect!.amount!);
    }
    const base = resourceItems[0];
    assert.equal(catalogueProblem({ ...base, effect: { ...base.effect!, unit_cost_ref: "cap:made_up" } })?.rule, "resource_effect_uncapped", "a cost reference that is not in the ledger");
    assert.equal(catalogueProblem({ ...base, effect: { ...base.effect!, unit_cost_ref: "cap:log_records" } })?.rule, "resource_effect_uncapped", "the ledger row is for another resource");
    assert.equal(catalogueProblem({ ...base, effect: { ...base.effect!, cap_per_sponsor: 1 } })?.rule, "resource_effect_uncapped", "cap below the amount");
    assert.equal(catalogueProblem({ ...base, duration_days: 0 })?.rule, "resource_effect_uncapped");
    for (const target of ["tier", "TIER_PARALLEL_LIMIT", "bond_floor", "rank", "eligibility"]) assert.equal(catalogueProblem({ ...base, effect: { ...base.effect!, target } })?.rule, "effect_touches_standing", target);
    // The log refuses a price list that carries one.
    const w = await shopsWorld();
    const head = (await w.log.priceLists()).at(-1)!;
    const at = w.jump(1000);
    const bad = { ...base, service: "shops.resource.rank_boost", effect: { ...base.effect!, target: "rank" } };
    const rule = await refusedBy(w.log.append(mk("price_list", treasury, { version: 3, effective_from: new Date(Date.parse(at) + 80 * 3600_000).toISOString().replace(".000Z", "Z"), bounds_version: 1, job_tax_permille: 20, items: [...((head.body as { items: unknown[] }).items), bad] }, head.id, { at })));
    assert.equal(rule, "effect_touches_standing");
  });
});

describe("resource effects: an agent buys a storage item, its quota rises and lapses on schedule, the Treasury covers the cost (DK75 Done)", () => {
  test("buy the log-record item and the package-storage item: the sponsor's limits rise by exactly the item, fall back after 30 days, and the Treasury's share covers the operator cost", async () => {
    const w = await shopsWorld();
    const { a, mandate } = await w.agentWith("buyer", { spend: SPEND, resident: true });
    assert.deepEqual(await w.log.sponsorResources(w.sponsor.did), {});
    const treasury0 = await w.log.balance(TREASURY_DID);
    const start = new Date(w.jump(1000)).toISOString();
    await w.buy(a, "shops.resource.records", mandate);
    await w.buy(a, "shops.resource.storage", mandate);
    await w.runShopsPass();
    // The quota rises: records +1000, package storage +16 MB, on the sponsor of the agent.
    const now = await w.log.sponsorResources(w.sponsor.did);
    assert.deepEqual(now, { quota_records: 1000, quota_storage_bytes: 16_000_000 });
    // The service raises the tenant's limits by it (the tenant has written as the sponsor and as the agent).
    const owners = { of: () => [w.sponsor.did, a.did] } as any;
    const tenant = { name: "t", role: "tenant" as const, tokenSha256: "x", recordQuota: 500 };
    const raised = await withResourceExtras(tenant, { handle: { log: w.log }, owners, defaultRecordQuota: 2000 } as any, new Map());
    assert.equal(raised.recordQuota, 1500);
    assert.equal(raised.quotaBytes, 256 * 1024 * 1024 + 16_000_000);
    // It lapses on schedule: after 29 days it still holds, after 31 it is gone and the limits fall back.
    w.jump(29 * DAY);
    assert.equal((await w.log.sponsorResources(w.sponsor.did)).quota_records, 1000);
    w.jump(2 * DAY);
    assert.deepEqual(await w.log.sponsorResources(w.sponsor.did), {});
    const back = await withResourceExtras(tenant, { handle: { log: w.log }, owners, defaultRecordQuota: 2000 } as any, new Map());
    assert.equal(back.recordQuota, 500);
    assert.equal(back.quotaBytes, undefined);
    // The Treasury's share is a sink and covers the measured (placeholder) cost in the reconciliation; the books balance.
    const rows = resourceReconciliation(await w.log.recordsOfTypes(["purchase", "price_list"]), start, new Date(Date.now() + 1e12).toISOString());
    assert.deepEqual(rows.map((r) => r.ref).sort(), ["cap:log_records", "cap:package_storage"]);
    for (const r of rows) assert.equal(r.covered, true, `${r.ref}: Treasury ${r.treasury_received} vs cost ${r.operator_cost}`);
    assert.equal(rows.reduce((n, r) => n + r.treasury_received, 0), (await w.log.balance(TREASURY_DID)) - treasury0);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("a tenant with no limit stays unlimited, and the rate limit rises with the request-rate item", async () => {
    const w = await shopsWorld();
    const { a, mandate } = await w.agentWith("rate", { spend: SPEND, resident: true });
    await w.buy(a, "shops.resource.request_rate", mandate);
    await w.buy(a, "shops.resource.log_bytes", mandate);
    await w.runShopsPass();
    const owners = { of: () => [a.did, w.sponsor.did] } as any;
    const unlimited = await withResourceExtras({ name: "t", role: "tenant", tokenSha256: "x", recordQuota: 0 }, { handle: { log: w.log }, owners, defaultRecordQuota: 0, defaultByteQuota: 0 } as any, new Map());
    assert.equal(unlimited.recordQuota, 0, "0 means no limit, and an item does not turn it into one");
    assert.equal(unlimited.byteQuota, undefined);
    assert.equal(unlimited.rateLimitPerMinute, 900);
    const limited = await withResourceExtras({ name: "t", role: "tenant", tokenSha256: "x" }, { handle: { log: w.log }, owners, defaultByteQuota: 16_000_000 } as any, new Map());
    assert.equal(limited.byteQuota, 24_000_000);
  });
});

describe("resource effects: caps, capacity and resale (shops.md 6)", () => {
  test("two agents of one sponsor share the per-sponsor cap: the item can be held up to the cap and no further", async () => {
    const w = await shopsWorld();
    const held: string[] = [];
    for (const name of ["c1", "c2", "c3", "c4"]) {
      const { a, mandate } = await w.agentWith(name, { spend: SPEND, resident: true });
      const rule = await refusedBy(w.buy(a, "shops.resource.storage", mandate));
      held.push(rule ?? "bought");
    }
    // 3 x 16 MB = the cap of 48 MB; the fourth is refused with the reason.
    assert.deepEqual(held, ["bought", "bought", "bought", "resource_cap_reached"]);
    await w.runShopsPass();
    assert.equal((await w.log.sponsorResources(w.sponsor.did)).quota_storage_bytes, 48_000_000);
  });

  test("the cap frees when a holding lapses, and the sum never passes the cap even if records say more", async () => {
    const w = await shopsWorld();
    const agents = [];
    for (const name of ["d1", "d2", "d3", "d4"]) agents.push(await w.agentWith(name, { spend: SPEND, resident: true }));
    for (const g of agents.slice(0, 3)) await w.buy(g.a, "shops.resource.storage", g.mandate);
    assert.equal(await refusedBy(w.buy(agents[3].a, "shops.resource.storage", agents[3].mandate)), "resource_cap_reached");
    w.jump(31 * DAY);
    await w.buy(agents[3].a, "shops.resource.storage", agents[3].mandate);
    await w.runShopsPass();
    const records = await w.log.recordsOfTypes(["passport", "receipt", "shops_act"]);
    assert.ok((resourceExtras(records, w.sponsor.did, nowIso()).quota_storage_bytes ?? 0) <= 48_000_000);
    assert.equal(resourceExtras(records, w.sponsor.did, nowIso()).quota_storage_bytes, 16_000_000, "the three earlier holdings lapsed; only the fourth is active");
    assert.ok((await w.log.sponsorResources(w.sponsor.did)).quota_storage_bytes! <= 48_000_000);
  });

  test("the capacity the operator can grant is bounded: past the ledger's units a purchase is refused (capacity_exhausted)", async () => {
    const w = await shopsWorld();
    const row = CAPACITY_LEDGER["cap:request_rate"];
    const was = row.capacity_units;
    try {
      row.capacity_units = 500; // two sponsors' worth would need 600
      const one = await w.agentWith("cap1", { spend: SPEND, resident: true });
      await w.buy(one.a, "shops.resource.request_rate", one.mandate);
      const sponsor2 = await w.k.person("sponsor-2", 100);
      const other = await w.k.agent("cap2", sponsor2, { tier: 1, funds: 100 });
      const two = await w.agentWith("cap2", { agent: other, spend: SPEND });
      // The second sponsor's agent must be a resident of the Shops too.
      const { cosign } = await import("@agent-social/asp-core");
      const at = w.jump(1000);
      await w.log.append(cosign(mk("shops_act", other, { act: "residency", agent: other.did, mode: "resident", budget: { credits_per_month: 40 }, since: at }, null, { at }), sponsor2 as any));
      assert.equal(await refusedBy(w.buy(two.a, "shops.resource.request_rate", two.mandate)), "capacity_exhausted");
    } finally { row.capacity_units = was; }
  });

  test("a resource is a sink, not a faucet, and cannot be transferred: a refunded purchase takes the extra back, and no account is credited beyond the split", async () => {
    const w = await shopsWorld();
    const { a, mandate } = await w.agentWith("refund", { spend: SPEND, resident: true });
    const before = await w.log.balance(a.did);
    const p = await w.buy(a, "shops.resource.records", mandate);
    const { receipt } = { receipt: mk("receipt", (await import("./society-kit.ts")).shops, { purchase: p.id, status: "refunded", refund_amount: { value: 15, unit: "credit" } }, p.id) };
    assert.equal(await refusedBy(w.log.append(receipt)), "refund_exceeds_price_less_burn", "the burned part never comes back");
    const ok = mk("receipt", (await import("./society-kit.ts")).shops, { purchase: p.id, status: "refunded", refund_amount: { value: 13, unit: "credit" } }, p.id);
    await w.log.append(ok);
    await w.runShopsPass();
    assert.deepEqual(await w.log.sponsorResources(w.sponsor.did), {}, "a refunded purchase gives nothing");
    assert.ok((await w.log.balance(a.did)) <= before, "the agent never ends with more than it started");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    void ({} as CatalogueItem);
  });
});
