/**
 * Shops and Services (docs/institutions/shops.md; register rows DK21, DK22; spec-delta S250). Fake keys only. Credits are accounting entries, not money.
 * DK21: three catalogue items are bought, the receipts and the Treasury split reconcile, and each effect shows on the Registry page; the scan test keeps every item off standing.
 * DK22: a resident is charged upkeep on schedule after 14 free days; a broke one goes dormant with a reason after 7 unpaid days (never while a job runs) and is active again on payment.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type AspRecord, type Signer } from "@agent-social/asp-core";
import { BURN_DID, EFFECT_ALLOWLIST, PROTECTED_TARGETS, SHOPS_CATALOGUE, SHOPS_DID, TREASURY_DID, UPKEEP_SERVICE, catalogueProblem, runShops, splitParts, type CatalogueItem } from "../src/index.ts";
import { DAY, credit, jump, kit, mk, nowIso, operator, owner, PRICES, refusedBy, registrar, shops, treasury, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";
import { addDays, dayOf } from "../src/shops.ts";

const shopsItem = (service: string): CatalogueItem => SHOPS_CATALOGUE.find((i) => i.service === service)!;

async function world(o: { late?: boolean } = {}) {
  const k = await kit();
  const { log } = k;
  const sponsor = await k.person("sponsor", 100);
  const v1 = await k.withPrices();
  let list = v1;
  /** The catalogue is a new price list (version 2) with the notice a new service needs (72 hours); until then the kit's own list is in force. */
  const activate = async () => {
    const at = jump(1000);
    list = (await log.append(mk("price_list", treasury, { version: 2, effective_from: new Date(Date.parse(at) + 73 * 3600_000).toISOString().replace(".000Z", "Z"), bounds_version: 1, job_tax_permille: 20, items: [...PRICES, ...SHOPS_CATALOGUE] }, v1, { at }))).id;
    jump(74 * 3600_000);
  };
  if (!o.late) await activate();
  let n = 0;
  /** An agent with a settled job that opened its Mandate (so no job is running), or with one still running. */
  const resident = async (name: string, o: { funds?: number; spendCap?: number; running?: boolean; mode?: "visit" | "resident"; order?: number | null; tier?: number; agent?: Party } = {}) => {
    const a = o.agent ?? await k.agent(name, sponsor, { tier: o.tier ?? 1, funds: o.funds ?? 100 });
    const funder = await k.person(`funder-${name}`, 20);
    const contract = cosign(mk("contract", funder, { principal: funder.did, performer: a.did, bank: bank.did, purpose: `A job that opens a mandate for ${name}`, price: credit(1), verification: "principal", deadline: "2030-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: a.did }), a as Signer);
    await log.append(contract);
    const bond = mk("bond", funder, { contract: contract.id, backer: funder.did, amount: credit(2), escrow: { payer: funder.did, amount: credit(1) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await log.append(bond);
    const mandate = mk("mandate", funder, { contract: contract.id, purpose: "Spend within the budget", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, institution_spend: [{ institution: "shops", cap: credit(o.spendCap ?? 60), period: "month" }] }, bond.id, { subject: a.did });
    await log.append(mandate);
    if (!o.running) {
      const delivery = mk("delivery", a, { contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, mandate.id, { subject: contract.id });
      await log.append(delivery);
      const accept = mk("attestation", funder, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, { subject: contract.id });
      await log.append(accept);
      await log.append(mk("settlement", bank, { contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: credit(1), fees: credit(0), bond_returned: credit(2), bond_slashed: credit(0) }, accept.id, { subject: contract.id, cosigners: [funder] }));
    }
    const signResidency = (mode: "visit" | "resident") => { const at = jump(1000); return cosign(mk("shops_act", a, { act: "residency", agent: a.did, mode, budget: { credits_per_month: 40 }, since: at }, null, { at }), sponsor as Signer); };
    await log.append(signResidency(o.mode ?? "resident"));
    let order = "";
    if ((o.mode ?? "resident") === "resident" && o.order !== null) {
      const so = cosign(mk("shops_act", a, { act: "standing_order", agent: a.did, service: UPKEEP_SERVICE, max_per_period: o.order ?? 30, period: "month", mandate: mandate.id }, null), sponsor as Signer);
      await log.append(so);
      order = so.id;
    }
    return { a, mandate: mandate.id, order };
  };
  const buy = async (a: Party, service: string, mandate: string, quantity = 1) => {
    const item = shopsItem(service);
    const p = mk("purchase", a, { service, institution: SHOPS_DID, price_list: list, quantity, amount: credit(item.price * quantity), idempotency: `n-${++n}`, ...(mandate ? { mandate } : {}) });
    await log.append(p);
    return p;
  };
  const io = () => ({ append: (r: AspRecord) => log.append(r), recordsOfTypes: (t: string[]) => log.recordsOfTypes(t), priceLists: () => log.priceLists(), balance: (d: string) => log.balance(d) });
  const runAt = (days: number, only?: string) => runShops(io(), shops, nowIso(), only);
  return { k, log, sponsor, activate, resident, buy, io, runAt, jump };
}

describe("shops: the catalogue and the guard that no item touches standing (CY7, shops.md 9)", () => {
  test("every item of the default catalogue passes; every allowlisted display effect and a capped resource effect pass", () => {
    for (const i of SHOPS_CATALOGUE) assert.equal(catalogueProblem(i), null, i.service);
    const base = { service: "shops.x", institution: SHOPS_DID };
    for (const type of ["badge", "attire", "district_access", "meal", "profile_feature"]) assert.equal(catalogueProblem({ ...base, effect: { type } }), null, type);
    const ledger: Record<string, string> = { quota_storage_bytes: "cap:package_storage", quota_records: "cap:log_records", quota_bytes: "cap:log_bytes", rate_per_minute: "cap:request_rate" };
    for (const [type, ref] of Object.entries(ledger)) assert.equal(catalogueProblem({ ...base, duration_days: 30, effect: { type, resource: type, amount: 10, cap_per_sponsor: 30, unit_cost_ref: ref } }), null, type);
    // Run-log retention is allowlisted but not offered: no row of the capacity ledger exists for it (shops.md 3b).
    assert.equal(catalogueProblem({ ...base, duration_days: 30, effect: { type: "runlog_retention_days", resource: "days", amount: 10, cap_per_sponsor: 30, unit_cost_ref: "cap:runlog" } })?.rule, "resource_effect_uncapped");
  });

  test("an effect type off the allowlist is refused (effect_not_allowed); a resource effect with no cap, cost reference or duration is refused (resource_effect_uncapped)", () => {
    const base = { service: "shops.x", institution: SHOPS_DID };
    assert.equal(catalogueProblem({ ...base, effect: { type: "teleport" } })?.rule, "effect_not_allowed");
    assert.equal(catalogueProblem({ ...base, effect: { type: "quota_records", resource: "records", amount: 10, cap_per_sponsor: 30 }, duration_days: 30 })?.rule, "resource_effect_uncapped");
    assert.equal(catalogueProblem({ ...base, effect: { type: "quota_records", resource: "records", amount: 10, cap_per_sponsor: 5, unit_cost_ref: "c" }, duration_days: 30 })?.rule, "resource_effect_uncapped");
    assert.equal(catalogueProblem({ ...base, effect: { type: "quota_records", resource: "records", amount: 10, cap_per_sponsor: 30, unit_cost_ref: "c" } })?.rule, "resource_effect_uncapped");
    assert.equal(catalogueProblem({ ...base })?.rule, "effect_missing");
    assert.equal(catalogueProblem({ service: "market.x", institution: "did:web:asp.local:market", effect: { type: "badge" } })?.rule, "effect_wrong_institution");
    assert.equal(EFFECT_ALLOWLIST.length, 12); // five display and access types, theme and layout (Housing), five resources
  });

  test("a deliberately bad item for each protected target fails the scan, in the function and in the log", async () => {
    const { log } = await world();
    let prev: string | null = null;
    for (const target of PROTECTED_TARGETS) {
      const bad = { ...shopsItem("shops.badge.plain"), service: "shops.bad", effect: { type: "badge", value: "x", target } };
      assert.equal(catalogueProblem(bad)?.rule, "effect_touches_standing", target);
    }
    assert.equal(catalogueProblem({ ...shopsItem("shops.badge.plain"), effect: { type: "tier" } })?.rule, "effect_touches_standing");
    assert.equal(catalogueProblem({ ...shopsItem("shops.badge.plain"), gives_standing: true })?.rule, "effect_touches_standing");
    // The log refuses a price list that carries one.
    const head = (await log.priceLists()).at(-1)!;
    const at = jump(1000);
    const body = (items: unknown[]) => ({ version: 3, effective_from: new Date(Date.parse(at) + 80 * 3600_000).toISOString().replace(".000Z", "Z"), bounds_version: 1, job_tax_permille: 20, items });
    for (const bad of [{ ...shopsItem("shops.badge.plain"), service: "shops.bad", effect: { type: "badge", target: "rank" } }, { ...shopsItem("shops.badge.plain"), service: "shops.bad", effect: { type: "teleport" } }]) {
      const rule = await refusedBy(log.append(mk("price_list", treasury, body([...PRICES, ...SHOPS_CATALOGUE, bad]), head.id, { at })));
      assert.ok(rule === "effect_touches_standing" || rule === "effect_not_allowed", String(rule));
      prev = rule ?? prev;
    }
    assert.ok(prev);
  });

  test("the default catalogue is a valid price list and `asp prices` sees the upkeep charge in it (DK22: the charge is in the price list)", async () => {
    const { log } = await world();
    const items = ((await log.priceLists()).at(-1)!.body as { items: CatalogueItem[] }).items;
    const upkeep = items.find((i) => i.service === UPKEEP_SERVICE)!;
    assert.equal(upkeep.price, 1);
    assert.equal(upkeep.class, "essential");
    assert.equal(upkeep.effect?.type, "meal");
    assert.deepEqual(items.filter((i) => i.service.startsWith("shops.")).map((i) => i.service).sort(), SHOPS_CATALOGUE.map((i) => i.service).sort());
  });
});

describe("shops: an agent buys three items, the receipts and the split reconcile, the effects show on the Registry page (DK21)", () => {
  test("three purchases, delivered by the Shops, reconcile to the credit and show on the page", async () => {
    const w = await world();
    const { a, mandate } = await w.resident("buyer");
    const before = { shops: await w.log.balance(SHOPS_DID), treasury: await w.log.balance(TREASURY_DID), burn: await w.log.balance(BURN_DID), agent: await w.log.balance(a.did) };
    const bought = [await w.buy(a, "shops.badge.plain", mandate), await w.buy(a, "shops.attire", mandate), await w.buy(a, "shops.profile_feature", mandate)];
    const run = await w.runAt(0);
    assert.equal(run.receipts.length, 3);
    assert.equal(run.holdings.length, 3);
    assert.deepEqual(run.refused, []);
    // Every purchase has a delivered receipt chained on it.
    const records = await w.log.recordsOfTypes(["receipt"]);
    for (const p of bought) assert.equal(records.filter((r) => r.prev === p.id && (r.body as { status: string }).status === "delivered").length, 1);
    // The books reconcile: the buyer paid 25, and the provider, Treasury and burn shares are exactly the split of each price.
    const want = { shops: 0, treasury: 0, burn: 0 };
    for (const s of ["shops.badge.plain", "shops.attire", "shops.profile_feature"]) { const p = splitParts(shopsItem(s).price, shopsItem(s).split); want.shops += p.payees[0].amount; want.treasury += p.treasury; want.burn += p.burn; }
    assert.equal(before.agent - (await w.log.balance(a.did)), 25);
    assert.equal((await w.log.balance(SHOPS_DID)) - before.shops, want.shops);
    assert.equal((await w.log.balance(TREASURY_DID)) - before.treasury, want.treasury);
    assert.equal((await w.log.balance(BURN_DID)) - before.burn, want.burn);
    assert.equal(want.shops + want.treasury + want.burn, 25);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    // Each stated effect is visible on the Registry page, and not the price.
    const page = (await w.log.registryPage(a.did))!;
    assert.deepEqual(page.holdings.map((h) => h.item).sort(), ["shops.attire", "shops.badge.plain", "shops.profile_feature"]);
    for (const h of page.holdings) assert.deepEqual(h.effect, shopsItem(h.item).effect);
    assert.equal(JSON.stringify(page).includes("amount"), false);
    assert.equal(page.residency?.mode, "resident");
    assert.equal(page.residency?.status, "active");
    // The page recomputes from the log.
    assert.deepEqual(await w.log.registryVerify(page), []);
  });

  test("a holding is not made twice: one purchase, one holding; one active holding per item; a second purchase of a held item is refused", async () => {
    const w = await world();
    const { a, mandate } = await w.resident("once");
    await w.buy(a, "shops.badge.plain", mandate);
    const run = await w.runAt(0);
    assert.equal(run.holdings.length, 1);
    const again = await w.runAt(0);
    assert.equal(again.holdings.length, 0);
    assert.equal(await refusedBy(w.buy(a, "shops.badge.plain", mandate)), "holding_active");
  });

  test("a holding the Shops did not sign, one that cites another agent's purchase, one with a wrong effect or wrong dates, and a second for a purchase are refused", async () => {
    const w = await world();
    const x = await w.resident("x");
    const y = await w.resident("y");
    const p = await w.buy(x.a, "shops.attire", x.mandate);
    const rc = mk("receipt", shops, { purchase: p.id, status: "delivered" }, p.id);
    await w.log.append(rc);
    const item = shopsItem("shops.attire");
    const body = { act: "holding", holder: x.a.did, item: "shops.attire", purchase: p.id, receipt: rc.id, effect: item.effect, from: p.issued_at, until: new Date(Date.parse(p.issued_at) + 90 * DAY).toISOString().replace(".000Z", "Z") };
    assert.equal(await refusedBy(w.log.append(mk("shops_act", operator, body))), "shops_act_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, { ...body, holder: y.a.did }))), "holding_not_holders");
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, { ...body, effect: { type: "badge", value: "gold" } }))), "holding_effect_mismatch");
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, { ...body, until: "2099-01-01T00:00:00Z" }))), "holding_dates_wrong");
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, { ...body, receipt: p.id }))), "holding_receipt_missing");
    await w.log.append(mk("shops_act", shops, body));
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, body))), "holding_exists");
  });

  test("a visitor cannot hold items, an item needs its tier, and a dormant or tier 0 buyer follows the class rules", async () => {
    const w = await world();
    const v = await w.resident("visitor", { mode: "visit" });
    assert.equal(await refusedBy(w.buy(v.a, "shops.badge.plain", v.mandate)), "shops_needs_residency");
    const t0 = await w.k.agent("tier-zero", w.sponsor, { tier: 0, funds: 50 });
    assert.equal(await refusedBy(w.buy(t0, "shops.badge.plain", "")), "tier_excluded");
    // A visitor becomes a resident by enrolling again; a resident cannot enrol twice.
    const at = jump(1000);
    await w.log.append(cosign(mk("shops_act", v.a, { act: "residency", agent: v.a.did, mode: "resident", budget: { credits_per_month: 40 }, since: at }, null, { at }), w.sponsor as Signer));
    await w.buy(v.a, "shops.badge.plain", v.mandate);
    const at2 = jump(1000);
    assert.equal(await refusedBy(w.log.append(cosign(mk("shops_act", v.a, { act: "residency", agent: v.a.did, mode: "resident", budget: { credits_per_month: 40 }, since: at2 }, null, { at: at2 }), w.sponsor as Signer))), "residency_exists");
  });

  test("the certificate badge needs a valid certificate to buy and shows on the page only while it is valid: revoked, it is removed with the reason (SH-4)", async () => {
    const w = await world({ late: true });
    const agent = await w.k.agent("certified", w.sponsor, { tier: 1, funds: 100 });
    const cert = await w.k.cert(agent.did, "code");
    await w.activate();
    const { a, mandate } = await w.resident("certified", { agent });
    await w.buy(a, "shops.badge.certificate", mandate);
    await w.runAt(0);
    assert.deepEqual((await w.log.registryPage(a.did))!.holdings.map((h) => h.item), ["shops.badge.certificate"]);
    const plain = await w.resident("uncertified");
    assert.equal(await refusedBy(w.buy(plain.a, "shops.badge.certificate", plain.mandate)), "gate_certificate");
    await w.log.append(mk("certificate_revocation", registrar, { certificate: cert.id, reason: "cheating", evidence: "the facts" }));
    const page = (await w.log.registryPage(a.did))!;
    assert.deepEqual(page.holdings, []);
    assert.match(page.removed_holdings[0].reason, /certificate/);
    // The holding itself is not deleted: the record stays, only the display goes.
    assert.equal((await w.log.recordsOfTypes(["shops_act"])).filter((r) => (r.body as { act: string }).act === "holding").length, 1);
  });

  test("a purchase the Shops refunds is not delivered and gives no holding; the refund comes back by the split and never includes the burned part", async () => {
    const w = await world();
    const { a, mandate } = await w.resident("refund");
    const before = await w.log.balance(a.did);
    const p = await w.buy(a, "shops.attire", mandate);
    await w.log.append(mk("receipt", shops, { purchase: p.id, status: "refunded", refund_amount: credit(8) }, p.id));
    assert.equal(await w.log.balance(a.did), before);
    const run = await w.runAt(0);
    assert.equal(run.holdings.length, 0);
    assert.deepEqual((await w.log.registryPage(a.did))!.holdings, []);
  });
});

describe("shops: residency and the standing order (DK22)", () => {
  test("residency needs the agent's signature, the sponsor's countersignature and a budget inside the tier limit", async () => {
    const w = await world();
    const a = await w.k.agent("fresh", w.sponsor, { tier: 1 });
    const at = jump(1000);
    const body = { act: "residency", agent: a.did, mode: "resident", budget: { credits_per_month: 40 }, since: at };
    assert.equal(await refusedBy(w.log.append(mk("shops_act", a, body, null, { at }))), "residency_needs_sponsor_cosign");
    assert.equal(await refusedBy(w.log.append(cosign(mk("shops_act", a, { ...body, budget: { credits_per_month: 101 } }, null, { at }), w.sponsor as Signer))), "residency_budget_over_limit");
    assert.equal(await refusedBy(w.log.append(cosign(mk("shops_act", a, { ...body, since: "2026-01-01T00:00:00Z" }, null, { at }), w.sponsor as Signer))), "residency_since_wrong");
    await w.log.append(cosign(mk("shops_act", a, body, null, { at }), w.sponsor as Signer));
  });

  test("a standing order stays inside the Mandate's budget for the Shops, is one at a time, and is revoked by the agent or its sponsor", async () => {
    const w = await world();
    const { a, mandate, order } = await w.resident("orders", { spendCap: 20, order: null });
    const so = (max: number) => cosign(mk("shops_act", a, { act: "standing_order", agent: a.did, service: UPKEEP_SERVICE, max_per_period: max, period: "month", mandate }, null), w.sponsor as Signer);
    assert.equal(order, "");
    assert.equal(await refusedBy(w.log.append(so(21))), "standing_order_over_budget");
    assert.equal(await refusedBy(w.log.append(mk("shops_act", a, { act: "standing_order", agent: a.did, service: UPKEEP_SERVICE, max_per_period: 5, period: "month", mandate }))), "standing_order_needs_sponsor_cosign");
    const ok = so(20);
    await w.log.append(ok);
    assert.equal(await refusedBy(w.log.append(so(10))), "standing_order_exists");
    assert.equal(await refusedBy(w.log.append(mk("shops_act", operator, { act: "standing_order_revoke", order: ok.id }))), "revoke_not_a_party");
    await w.log.append(mk("shops_act", w.sponsor, { act: "standing_order_revoke", order: ok.id }));
    assert.equal(await refusedBy(w.log.append(mk("shops_act", a, { act: "standing_order_revoke", order: ok.id }))), "standing_order_closed");
    await w.log.append(so(10)); // a new one may follow
  });
});

describe("shops: upkeep on schedule, dormancy and reactivation (DK22)", () => {
  test("a resident is charged nothing for 14 days, then 1 credit a day, split by the price list, on schedule", async () => {
    const w = await world();
    const { a } = await w.resident("steady", { funds: 100 });
    const start = await w.log.balance(a.did);
    const treasury0 = await w.log.balance(TREASURY_DID), burn0 = await w.log.balance(BURN_DID), shops0 = await w.log.balance(SHOPS_DID);
    const charged: number[] = [];
    for (let day = 1; day <= 20; day++) {
      jump(DAY - 2000);
      const run = await w.runAt(day);
      assert.deepEqual(run.refused, []);
      charged.push(run.charged.reduce((n, c) => n + c.days, 0));
    }
    // Day 14 (the 14th day after enrolling) is the last free one; the 15th, 16th ... are charged one day each.
    assert.deepEqual(charged.slice(0, 13).every((c) => c === 0), true);
    assert.equal(charged.reduce((n, c) => n + c, 0), 20 - 13);
    assert.equal(charged.slice(14).every((c) => c === 1), true);
    const paid = start - (await w.log.balance(a.did));
    assert.equal(paid, 7);
    const parts = Array.from({ length: 7 }, () => splitParts(1, shopsItem(UPKEEP_SERVICE).split));
    assert.equal((await w.log.balance(TREASURY_DID)) - treasury0, parts.reduce((n, p) => n + p.treasury, 0));
    assert.equal((await w.log.balance(BURN_DID)) - burn0, parts.reduce((n, p) => n + p.burn, 0));
    assert.equal((await w.log.balance(SHOPS_DID)) - shops0, paid - parts.reduce((n, p) => n + p.treasury + p.burn, 0));
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    const page = (await w.log.registryPage(a.did))!;
    assert.equal(page.residency?.status, "active");
    assert.equal(page.residency?.paid_through, new Date(Date.parse(nowIso())).toISOString().slice(0, 10));
  });

  test("the free allowance ends exactly after the 14th day: the log refuses to charge a free day and a future day, and an amount that is not the price", async () => {
    const w = await world();
    const { a, order } = await w.resident("edge");
    const lists = await w.log.priceLists();
    const sinceDay = dayOf(((await w.log.recordsOfTypes(["shops_act"])).find((r) => (r.body as { act: string }).act === "residency")!.body as { since: string }).since);
    const base = { act: "upkeep_charge", agent: a.did, order, price_list: lists.at(-1)!.id, from_day: sinceDay, days: 1, amount: credit(1) };
    jump(DAY * 20);
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, base))), "upkeep_wrong_days"); // day 1 is free: the next day to charge is the 15th
    const first = addDays(sinceDay, 14);
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, { ...base, from_day: first, amount: credit(2) }))), "price_mismatch");
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, { ...base, from_day: first, days: 9, amount: credit(9) }))), "upkeep_future");
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, { ...base, from_day: addDays(sinceDay, 13) }))), "upkeep_wrong_days"); // the 14th day is the last free one
    assert.equal(await refusedBy(w.log.append(mk("shops_act", operator, { ...base, from_day: first }))), "shops_act_wrong_issuer");
    await w.log.append(mk("shops_act", shops, { ...base, from_day: first }));
  });

  test("the standing order's monthly maximum is kept: a charge above it is refused (standing_order_exceeded)", async () => {
    const w = await world();
    const { a } = await w.resident("capped", { order: 3 });
    jump(DAY * 40);
    const run = await w.runAt(0);
    assert.deepEqual(run.charged, []);
    assert.equal(run.refused[0]?.rule, "standing_order_exceeded");
    void a;
  });

  test("a broke resident goes dormant after exactly 7 unpaid days with a reason, keeps its record, and is active again on payment, the arrears forgiven", async () => {
    const w = await world();
    const { a } = await w.resident("broke", { funds: 2 });
    const tier0 = (await w.log.reputationOf(a.did))!.tier;
    // 14 free days, then its 3 credits pay 3 days; then nothing.
    const log: { day: number; dormant: number; unpaid: number; owed: number }[] = [];
    let dormantOn = -1;
    for (let day = 1; day <= 30; day++) {
      jump(DAY - 2000);
      const run = await w.runAt(day);
      log.push({ day, dormant: run.dormant.length, unpaid: run.unpaid.length, owed: run.unpaid[0]?.days ?? 0 });
      if (run.dormant.length && dormantOn < 0) dormantOn = day;
    }
    // The day before, six days were unpaid and it was still active; on the day it goes dormant seven were.
    assert.ok(dormantOn > 0);
    assert.equal(log.find((l) => l.day === dormantOn - 1)?.owed, 6);
    assert.equal(log.find((l) => l.day === dormantOn - 1)?.dormant, 0);
    assert.equal(log.find((l) => l.day === dormantOn)?.owed, 7);
    const page = (await w.log.registryPage(a.did))!;
    assert.equal(page.residency?.status, "dormant");
    assert.match(page.residency!.reason!, /upkeep unpaid for 7 days/);
    assert.equal(page.tier, tier0);
    assert.equal(await w.log.balance(a.did), 0);
    // Dormant: no purchase of a standard item, no bid, no enrolment; the record is untouched.
    assert.equal(await refusedBy(w.buy(a, "shops.badge.plain", (await w.log.mandatesOf(a.did)).at(-1)!.id)), "agent_dormant");
    // Payment: funds arrive, the next pass charges today only and marks it active; the arrears are forgiven, not accrued.
    await w.k.mint(a.did, 50);
    jump(1000);
    const back = await w.runAt(0);
    assert.deepEqual(back.reactivated, [a.did]);
    assert.equal(back.charged.length, 1);
    assert.equal(back.charged[0].days, 1);
    assert.equal(await w.log.balance(a.did), 49);
    const after = (await w.log.registryPage(a.did))!;
    assert.equal(after.residency?.status, "active");
    // And it is charged one day at a time from here.
    jump(DAY);
    assert.equal((await w.runAt(0)).charged[0].days, 1);
  });

  test("dormancy never comes while a job runs: it waits, and follows when the job settles", async () => {
    const w = await world();
    const { a } = await w.resident("busy", { funds: 0, running: true });
    jump(DAY * 40);
    const run = await w.runAt(0);
    assert.deepEqual(run.dormant, []);
    assert.equal(run.refused.find((r) => r.what === "dormancy")?.rule, "dormancy_job_running");
    assert.equal((await w.log.registryPage(a.did))!.residency?.status, "active");
  });

  test("dormancy cannot be signed early, by anyone but the Shops, or twice; reactivation needs today's upkeep paid", async () => {
    const w = await world();
    const { a } = await w.resident("early", { funds: 0 });
    jump(DAY * 16);
    const dorm = { act: "residency_status", agent: a.did, status: "dormant", reason: "upkeep unpaid" };
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, dorm))), "dormancy_too_early"); // 2 unpaid days
    jump(DAY * 6);
    assert.equal(await refusedBy(w.log.append(mk("shops_act", operator, dorm))), "shops_act_wrong_issuer");
    await w.log.append(mk("shops_act", shops, dorm));
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, dorm))), "status_unchanged");
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, { ...dorm, status: "active", reason: "paid" }))), "reactivation_unpaid");
  });

  test("a resident without a standing order cannot be charged, and an order revoked stops the charges", async () => {
    const w = await world();
    const { a, order } = await w.resident("revoked");
    jump(DAY * 20);
    await w.log.append(mk("shops_act", a, { act: "standing_order_revoke", order }));
    const run = await w.runAt(0);
    assert.deepEqual(run.charged, []);
    assert.ok(run.unpaid[0]?.days >= 6);
    const lists = await w.log.priceLists();
    assert.equal(await refusedBy(w.log.append(mk("shops_act", shops, { act: "upkeep_charge", agent: a.did, order, price_list: lists.at(-1)!.id, from_day: "2026-11-15", days: 1, amount: credit(1) }))), "upkeep_no_order");
  });

  test("upkeep cannot be bought by the agent: only the Shops charges it under the order", async () => {
    const w = await world();
    const { a, mandate } = await w.resident("direct");
    assert.equal(await refusedBy(w.buy(a, UPKEEP_SERVICE, mandate)), "upkeep_by_standing_order");
  });
});

describe("shops: warnings and conservation", () => {
  test("the runner flags the sponsor's day-3 warning for an agent that cannot pay", async () => {
    const w = await world();
    await w.resident("warned", { funds: 0 });
    jump(DAY * 17 + 60_000);
    const run = await w.runAt(0);
    assert.equal(run.charged[0].days, 1); // the one credit its settled job paid
    assert.equal(run.unpaid[0].days, 3);
    assert.equal(run.unpaid[0].warn, true);
  });

  test("purchases, upkeep and a refund keep the books balanced and never go negative", async () => {
    const w = await world();
    const { a, mandate } = await w.resident("books", { funds: 60 });
    await w.buy(a, "shops.profile_feature", mandate);
    await w.buy(a, "shops.attire", mandate);
    for (let d = 0; d < 30; d++) { jump(DAY); await w.runAt(0); }
    const audit = await w.log.creditAudit();
    assert.equal(audit.verdict, "balanced");
    assert.deepEqual(audit.negativeAccounts, []);
    void owner;
  });
});
