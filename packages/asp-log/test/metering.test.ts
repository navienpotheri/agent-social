/**
 * Metering and statements (register row DK1379; spec-delta S1414): per-agent and per-fleet usage counted from the log, a signed plan (the owner sets prices), a statement that prices a month with tax lines, the link to
 * purchased credits, and a recount that checks a statement against the log. A month is closed on a test fleet. Plan figures here are test figures, not prices. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { credit, jump, kit, keysOf, mk, nowIso, operator, owner, party, refusedBy, type Party, DAY } from "./society-kit.ts";
import { creditsFor, meterOf, priceStatement, type Plan, type Usage } from "../src/metering.ts";
import { TREASURY_DID } from "../src/economy.ts";

const PLAN: Plan = { plan: "test-plan", name: "Test plan", currency: "USD", agent_month: 500, writes_included: 10, writes_per_1000: 20, tokens_included_m: 1, tokens_per_m: 300, storage_included_mb: 1, storage_per_gb: 1500, dashboard_month: 2500, credit_value: 5 };
const U = (over: Partial<Usage> = {}): Usage => ({ month: "2026-11", activeAgents: 12, writes: 1500, actions: 0, tokensIn: 1_500_000, tokensOut: 1_000_000, modelRequests: 0, toolCalls: 0, storageBytes: 2_500_000_000, reads: null, ...over });

describe("the pricing arithmetic", () => {
  test("a started unit of overage is a whole unit, nothing under an allowance is charged, a tax line rounds half up and the credits a total can settle are whole", () => {
    const p = priceStatement(PLAN, U(), [{ name: "GST", rate_bp: 1800 }]);
    assert.deepEqual(p.lines.map((l) => [l.item.split(" ")[0], l.quantity, l.unit_price, l.amount]), [["active", 12, 500, 6000], ["writes", 2, 20, 40], ["tokens", 2, 300, 600], ["stored", 3, 1500, 4500], ["hosted", 1, 2500, 2500]], "1490 writes over: 2 started thousands; 1.5 million tokens over: 2; 2.499 GB over: 3");
    assert.equal(p.subtotal, 13640);
    assert.deepEqual(p.tax, [{ name: "GST", rate_bp: 1800, amount: 2455 }], "13640 x 18 % = 2455.2, rounded half up");
    assert.equal(p.total, 16095);
    const small = priceStatement(PLAN, U({ writes: 10, tokensIn: 500_000, tokensOut: 400_000, storageBytes: 1_000_000, activeAgents: 0 }));
    assert.deepEqual(small.lines, [], "nothing active, nothing over: nothing to charge, and no dashboard line without an active agent");
    assert.equal(priceStatement(PLAN, U({ writes: 11 })).lines.find((l) => l.item.startsWith("writes"))!.quantity, 1, "one write over is one started thousand");
    assert.equal(priceStatement(PLAN, U(), [{ name: "VAT", rate_bp: 0 }]).tax[0].amount, 0);
    assert.equal(priceStatement(PLAN, U({ activeAgents: 1, writes: 0, tokensIn: 0, tokensOut: 0, storageBytes: 0 }), [{ name: "T", rate_bp: 5000 }]).tax[0].amount, 1500, "(500 + 2500) x 50 %");
    assert.equal(creditsFor(PLAN, 16095), 3219, "whole credits at 5 minor units each");
    assert.equal(creditsFor({ ...PLAN, credit_value: 0 }, 16095), 0, "a plan with no credit value is not paid with credits");
  });

  test("the meter counts each agent's records in the month, its Actions' tokens and what is stored up to the month's end; an agent that signed nothing is not active", () => {
    const rec = (id: string, type: string, issuer: string, at: string, body: Record<string, unknown> = {}) => ({ id, type, issuer, issued_at: at, body });
    const recs = [
      rec("1", "asp.action/v0.2", "a", "2026-11-03T00:00:00Z", { metrics: { tokens_in: 100, tokens_out: 50, model_requests: 2, tool_calls: 5 } }),
      rec("2", "asp.action/v0.2", "a", "2026-11-04T00:00:00Z", { metrics: { tokens_in: 10, tokens_out: 5 } }),
      rec("3", "asp.offer/v0.2", "b", "2026-11-05T00:00:00Z"),
      rec("4", "asp.offer/v0.2", "b", "2026-10-05T00:00:00Z"),
      rec("5", "asp.offer/v0.2", "outsider", "2026-11-05T00:00:00Z"),
    ] as Parameters<typeof meterOf>[0];
    const m = meterOf(recs, new Set(["a", "b", "idle"]), "2026-11", 77);
    assert.deepEqual([m.total.activeAgents, m.total.writes, m.total.actions, m.total.tokensIn, m.total.tokensOut, m.total.modelRequests, m.total.toolCalls, m.total.reads], [2, 3, 2, 110, 55, 2, 5, 77]);
    assert.deepEqual(m.perAgent.map((a) => [a.did, a.writes, a.tokens, a.active]), [["a", 2, 165, true], ["b", 1, 0, true], ["idle", 0, 0, false]]);
    assert.ok(m.total.storageBytes > 0);
    assert.equal(meterOf(recs, new Set(["b"]), "2026-10").total.writes, 1, "another month");
  });
});

async function world() {
  const k = await kit();
  await k.withPrices();
  const org = party("did:web:example.com:orgs:meter-co");
  await k.log.append(mk("passport", org, { did: org.did, kind: "org", keys: keysOf(org) }, null, { subject: org.did, cosigners: [operator] }));
  const FLEET = "did:web:example.com:orgs:meter-co:fleets:all";
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "All", purpose: "everything" }, null, { subject: FLEET }));
  const join = async (name: string): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${name}`);
    await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET }, null, { subject: a.did }));
    await k.mint(a.did, 100);
    return a;
  };
  const plan = (over: Record<string, unknown> = {}, sign = true) => mk("usage_plan", operator, { ...PLAN, ...over }, null, sign ? { cosigners: [owner] } : {});
  const stated = (month: string, over: Record<string, unknown> = {}, fleet = true) => {
    return async (usage: Usage, taxes = [{ name: "GST", rate_bp: 1800 }], more: Record<string, unknown> = {}) => {
      const p = priceStatement(PLAN, usage, taxes);
      return mk("usage_statement", operator, { holder: org.did, ...(fleet ? { fleet: FLEET } : {}), month, plan: PLAN.plan, usage: { active_agents: usage.activeAgents, writes: usage.writes, tokens: usage.tokensIn + usage.tokensOut, storage_bytes: usage.storageBytes }, lines: p.lines, subtotal: p.subtotal, tax: p.tax, total: p.total, currency: "USD", ...more, ...over }, null, { subject: org.did });
    };
  };
  return { ...k, org, FLEET, join, plan, stated };
}

describe("a plan and a statement in the log", () => {
  test("the operator signs a plan with the owner's go, once per id; a statement must follow from the plan and its usage, once per month, in the plan's currency", async () => {
    const w = await world();
    assert.equal(await refusedBy(w.log.append(w.plan({}, false))), "usage_plan_needs_owner", "the owner sets prices");
    await w.log.append(w.plan());
    assert.equal(await refusedBy(w.log.append(w.plan({ agent_month: 600 }))), "usage_plan_known", "a new price is a new plan");
    assert.equal((await w.log.usagePlan("test-plan"))!.agent_month, 500);
    const a = await w.join("meter-a");
    const month = nowIso().slice(0, 7);
    const m = (await w.log.meter({ fleet: w.FLEET, month })).usage;
    const build = w.stated(month);
    assert.equal(await refusedBy(w.log.append(await build(m, [{ name: "GST", rate_bp: 1800 }], { total: 1 }))), "usage_statement_arithmetic", "a total that does not follow from the usage");
    assert.equal(await refusedBy(w.log.append(await build(m, [{ name: "GST", rate_bp: 1800 }], { plan: "no-such-plan" }))), "usage_plan_unknown");
    assert.equal(await refusedBy(w.log.append(await build(m, [{ name: "GST", rate_bp: 1800 }], { currency: "EUR" }))), "usage_statement_currency");
    assert.equal(await refusedBy(w.log.append(await build({ ...m, activeAgents: m.activeAgents + 1 }))), undefined, "a statement priced from its own stated usage is accepted (the recount below checks it against the log)");
    assert.equal(await refusedBy(w.log.append(await build(m))), "usage_statement_known", "a month is closed once");
    void a;
    assert.equal(await refusedBy(w.log.append(await w.stated(month, {}, false)(m))), undefined, "the organisation as a whole is another statement");
  });

  test("a month closed on a test fleet: agents work, the meter counts it per agent and per fleet, the statement sums it, a recount matches the log, and later work makes the recount differ", async () => {
    const w = await world();
    await w.log.append(w.plan());
    const agents = [await w.join("meter-b0"), await w.join("meter-b1"), await w.join("meter-b2")];
    const month = nowIso().slice(0, 7);
    // agents 0 and 1 work, with tokens; agent 2 signs nothing
    for (const [i, a] of agents.slice(0, 2).entries()) {
      const mandate = await w.openMandate(a);
      const contract = ((await w.log.get(mandate))!.record.body as { contract: string }).contract;
      for (let n = 0; n < 2 + i; n++) await w.log.append(mk("action", a, { contract, scopes_used: [], summary: `run ${n}`, metrics: { tokens_in: 400_000, tokens_out: 100_000 } }, null, { subject: contract }));
    }
    const fleet = await w.log.meter({ fleet: w.FLEET, month });
    const own = (d: string) => fleet.perAgent.find((x) => x.did === d)!;
    assert.deepEqual([fleet.usage.activeAgents, own(agents[0].did).actions, own(agents[1].did).actions, own(agents[2].did).active], [2, 2, 3, false]);
    assert.equal(fleet.usage.tokensIn + fleet.usage.tokensOut, 5 * 500_000, "five Actions of 500,000 tokens");
    assert.equal(fleet.usage.actions, 5);
    const sum = fleet.perAgent.reduce((n, a) => n + a.writes, 0);
    assert.equal(sum, fleet.usage.writes, "the fleet's writes are the sum of its agents'");
    const byOrg = await w.log.meter({ org: w.org.did, month });
    assert.equal(byOrg.usage.writes, fleet.usage.writes, "the organisation's agents are the fleet's here");
    assert.equal((await w.log.meter({ agent: agents[1].did, month })).usage.actions, 3);
    // the statement
    const stmt = await w.stated(month)(fleet.usage);
    const b = stmt.body as { total: number; lines: { item: string; quantity: number }[] };
    assert.equal(b.lines.find((l) => l.item === "active agents")!.quantity, 2);
    assert.equal(b.lines.find((l) => l.item.startsWith("tokens"))!.quantity, 2, "2.5 million tokens against 1 million included: 1.5 over, 2 started millions");
    await w.log.append(stmt);
    assert.deepEqual(await w.log.checkStatement(stmt.id), { ok: true, differences: [] }, "the meter matches the log");
    // more work in the same month: the recount no longer matches the statement
    const mandate = await w.openMandate(agents[2]);
    const contract = ((await w.log.get(mandate))!.record.body as { contract: string }).contract;
    await w.log.append(mk("action", agents[2], { contract, scopes_used: [], summary: "late" }, null, { subject: contract }));
    const late = await w.log.checkStatement(stmt.id);
    assert.equal(late.ok, false);
    assert.match(late.differences.join(" "), /active agents: the log has 3, the statement 2/);
    assert.equal((await w.log.checkStatement("sha256:" + "0".repeat(64))).ok, false);
    assert.equal((await w.log.verify()).ok, true);
  });

  test("a statement may be settled with purchased credits at the plan's credit value: the lots are drawn, the Treasury is paid, the class audit counts it consumed, and no more than the total can be applied", async () => {
    const w = await world();
    await w.log.append(w.plan());
    const a = await w.join("meter-c0");
    const month = nowIso().slice(0, 7);
    const lot = mk("credit_lot", operator, { act: "grant", holder: w.org.did, amount: credit(3000), expires: new Date(Date.parse(nowIso()) + 200 * DAY).toISOString().replace(".000Z", "Z"), reference: "sha256:" + "c".repeat(64) }, null, { subject: w.org.did, cosigners: [owner] });
    await w.log.append(lot);
    const mandate = await w.openMandate(a);
    const contract = ((await w.log.get(mandate))!.record.body as { contract: string }).contract;
    for (let i = 0; i < 40; i++) await w.log.append(mk("action", a, { contract, scopes_used: [], summary: `run ${i}`, metrics: { tokens_in: 400_000, tokens_out: 100_000 } }, null, { subject: contract }));
    const usage = (await w.log.meter({ fleet: w.FLEET, month })).usage;
    const p = priceStatement(PLAN, usage, [{ name: "GST", rate_bp: 1800 }]);
    const most = creditsFor(PLAN, p.total);
    assert.ok(most > 0 && most < 3000, `${most}`);
    assert.equal(await refusedBy(w.log.append(await w.stated(month)(usage, [{ name: "GST", rate_bp: 1800 }], { credits_applied: most + 1 }))), "usage_statement_credits");
    const treasuryBefore = await w.log.balance(TREASURY_DID);
    await w.log.append(await w.stated(month)(usage, [{ name: "GST", rate_bp: 1800 }], { credits_applied: most }));
    assert.equal(await w.log.balance(w.org.did), 3000 - most);
    assert.equal(await w.log.balance(TREASURY_DID), treasuryBefore + most, "the Treasury was paid the credits");
    const c = await w.log.creditClassAudit();
    assert.deepEqual([c.sold, c.consumed, c.outstanding, c.verdict], [3000, most, 3000 - most, "balanced"]);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    jump(DAY);
    void a;
  });
});
