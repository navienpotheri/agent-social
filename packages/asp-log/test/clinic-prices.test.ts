/**
 * The Clinic's prices and account (clinic.md section 4, CL-12; register row DK161; spec-delta S482): a checkup and a restore are on the Treasury's price list, the first checkup each quarter and one after each change
 * are free from a Treasury budget line, an extra one is bought, refunds are paid by the split in reverse, a quarantined agent may still buy a checkup but not a standard item, the credit audit balances and
 * `creditFlows` lists the Clinic's flows. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CLINIC_CHECKUP_PRICE, TREASURY_DID, institutionDid } from "../src/index.ts";
import { DAY, clinic, credit, jump, kit, mk, nowIso, owner, refusedBy, treasury } from "./society-kit.ts";

const CLINIC = institutionDid("clinic");
const inDays = (n: number) => new Date(Date.parse(nowIso()) + n * DAY).toISOString().replace(".000Z", "Z");

async function world() {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("sponsor", 200);
  const agent = await k.agent("patient", sponsor, { funds: 60 });
  await k.mint(TREASURY_DID, 500);
  const budget = async (amount = 30, over: Record<string, unknown> = {}) =>
    (await k.log.append(mk("budget", treasury, { institution: CLINIC, period: "2026-11", amount: credit(amount), purpose: "free_checkups", ...over }, null, { cosigners: [owner] }))).id;
  const order = (agentDid: string, reason: string, over: Record<string, unknown> = {}) => mk("clinic_order", clinic, { agent: agentDid, kind: "checkup", reason, due: inDays(3), ...over }, null, { subject: agentDid });
  return { ...k, mkAgent: k.agent, sponsor, agent, budget, order };
}

describe("a free checkup is paid by the Treasury's budget line for the Clinic", () => {
  test("the first scheduled checkup of a quarter and one after a named change are free; a second in the quarter, or a second for one change, is refused with the way forward", async () => {
    const w = await world();
    const b = await w.budget();
    const t0 = await w.log.balance(TREASURY_DID);
    await w.log.append(w.order(w.agent.did, "scheduled", { budget: b }));
    assert.deepEqual([t0 - (await w.log.balance(TREASURY_DID)), await w.log.balance(CLINIC)], [CLINIC_CHECKUP_PRICE, CLINIC_CHECKUP_PRICE], "the Treasury paid the Clinic out of the budget; the agent paid nothing");
    assert.equal(await w.log.balance(w.agent.did), 60);
    jump(8 * DAY); // the first order's due date has passed
    assert.equal(await refusedBy(w.log.append(w.order(w.agent.did, "scheduled", { budget: b }))), "order_free_used", "one free scheduled checkup a quarter");
    assert.equal(await refusedBy(w.log.append(w.order(w.agent.did, "post_change", { budget: b }))), "order_needs_change");
    await w.log.append(w.order(w.agent.did, "post_change", { budget: b, change: "memory-update-7" }));
    jump(8 * DAY);
    assert.equal(await refusedBy(w.log.append(w.order(w.agent.did, "post_change", { budget: b, change: "memory-update-7" }))), "order_free_used", "one free checkup for each change");
    await w.log.append(w.order(w.agent.did, "post_change", { budget: b, change: "runtime-change-2" }));
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("the budget is the cap: a free checkup needs the Clinic's free_checkups budget, and once it is used up the Clinic cannot order another free one", async () => {
    const w = await world();
    const b = await w.budget(20);
    const other = await w.budget(20, { institution: institutionDid("courts"), purpose: "charter" });
    assert.equal(await refusedBy(w.log.append(w.order(w.agent.did, "scheduled"))), "order_needs_budget", "no budget cited");
    assert.equal(await refusedBy(w.log.append(w.order(w.agent.did, "scheduled", { budget: other }))), "order_needs_budget", "another institution's budget is not the Clinic's");
    const agents = [w.agent, await w.mkAgent("p2", w.sponsor, { funds: 5 }), await w.mkAgent("p3", w.sponsor, { funds: 5 })];
    await w.log.append(w.order(agents[0].did, "scheduled", { budget: b }));
    await w.log.append(w.order(agents[1].did, "scheduled", { budget: b }));
    assert.equal(await refusedBy(w.log.append(w.order(agents[2].did, "scheduled", { budget: b }))), "over_budget", "20 credits are two free checkups");
    assert.equal(await w.log.balance(CLINIC), 20);
  });
});

describe("an extra or requested checkup is bought (clinic.checkup)", () => {
  test("a requested checkup cites a purchase of clinic.checkup by the agent or its sponsor, used once; the wrong item, a stranger's purchase and no purchase are refused", async () => {
    const w = await world();
    const stranger = await w.person("stranger", 50);
    assert.equal(await refusedBy(w.log.append(w.order(w.agent.did, "requested"))), "order_needs_purchase");
    const restore = await w.buy(w.agent, "clinic.restore", 5);
    assert.equal(await refusedBy(w.log.append(w.order(w.agent.did, "requested", { purchase: restore }))), "order_purchase_wrong_item");
    const strangers = await w.buy(stranger, "clinic.checkup", 10);
    assert.equal(await refusedBy(w.log.append(w.order(w.agent.did, "requested", { purchase: strangers }))), "order_purchase_not_owners");
    const bought = await w.buy(w.agent, "clinic.checkup", 10);
    assert.equal(await w.log.balance(w.agent.did), 60 - 5 - 10, "the agent paid the price from its own credits");
    await w.log.append(w.order(w.agent.did, "requested", { purchase: bought }));
    jump(8 * DAY);
    assert.equal(await refusedBy(w.log.append(w.order(w.agent.did, "requested", { purchase: bought }))), "order_purchase_used", "one purchase, one checkup");
    const sponsorsPurchase = await w.buy(w.sponsor, "clinic.checkup", 10);
    await w.log.append(w.order(w.agent.did, "requested", { purchase: sponsorsPurchase }));
    // The split: 20 % to the Treasury, 80 % to the Clinic (clinic.checkup, essential, burns nothing).
    assert.equal(await w.log.balance(CLINIC), 4 + 8 + 8 + 8, "the restore 4, and three checkups at 8 (the stranger's purchase was made and not used)");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("before the list carries clinic.checkup the Clinic orders as it did: no budget, no purchase", async () => {
    const k = await kit();
    const sponsor = await k.person("sponsor");
    const agent = await k.agent("early", sponsor);
    await k.log.append(mk("clinic_order", clinic, { agent: agent.did, kind: "checkup", reason: "scheduled", due: inDays(3) }, null, { subject: agent.did }));
  });
});

describe("a restore, a refund and a quarantined agent", () => {
  test("a restore is bought as a remedial item; the Clinic's refund comes back by the split in reverse and never includes a burn; a quarantined agent may buy a checkup but not a standard item", async () => {
    const w = await world();
    const restore = await w.buy(w.agent, "clinic.restore", 5);
    assert.equal(await w.log.balance(w.agent.did), 55);
    await w.log.append(mk("receipt", clinic, { purchase: restore, status: "refunded", refund_amount: credit(5) }, restore));
    assert.equal(await w.log.balance(w.agent.did), 60, "the whole price comes back: the restore burns nothing");
    await w.log.append(mk("quarantine", clinic, { members: [w.agent.did], level: "halt", reason: "drift", until: inDays(5) }, null, { subject: w.agent.did }));
    assert.equal(await refusedBy(w.log.append(mk("purchase", w.agent, { service: "registry.name.claim", institution: institutionDid("registry"), price_list: w.listId(), quantity: 1, amount: credit(10), idempotency: "q-1" }))), "agent_quarantined");
    await w.buy(w.agent, "clinic.checkup", 10);
    assert.equal((await w.log.creditAudit()).verdict, "balanced", "a checkup, a restore, a refund and a refused purchase leave the books balanced");
  });

  test("asp credits audit --by-flow lists the Clinic's flows: checkups and restores bought, free checkups, refunds", async () => {
    const w = await world();
    const b = await w.budget();
    await w.log.append(w.order(w.agent.did, "scheduled", { budget: b }));
    await w.buy(w.agent, "clinic.checkup", 10);
    const restore = await w.buy(w.agent, "clinic.restore", 5);
    await w.log.append(mk("receipt", clinic, { purchase: restore, status: "refunded", refund_amount: credit(5) }, restore));
    const flows = await w.log.creditFlows();
    assert.deepEqual(flows.clinic, { checkupsBought: { count: 1, amount: 10 }, restoresBought: { count: 1, amount: 5 }, freeCheckups: { count: 1, amount: 10 }, refunds: { count: 1, amount: 5 } });
  });
});

describe("an agent buys from its Mandate's institution_spend", () => {
  test("an agent whose Mandate lists the Clinic buys a checkup and a restore; an agent with no Mandate line still can, because essential and remedial items are the way back and are never default-denied", async () => {
    const w = await world();
    const withLine = await w.mkAgent("with-line", w.sponsor, { funds: 40 });
    const m = await w.openMandate(withLine, [{ institution: "clinic", cap: credit(30), period: "month" }]);
    await w.buy(withLine, "clinic.checkup", 10, { mandate: m });
    await w.buy(withLine, "clinic.restore", 5, { mandate: m });
    assert.equal(await w.log.balance(withLine.did), 25);
    await w.buy(w.agent, "clinic.checkup", 10);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });
});
