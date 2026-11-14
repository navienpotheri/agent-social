import { test } from "node:test";
import assert from "node:assert/strict";
import { signerFromSeed, randomSeed } from "@agent-social/asp-core";
import { DEFAULT_INSTITUTION_SPEND, parseInstitutionSpend, spendCmd, SpendUsage } from "../src/spend.ts";

// `asp spend` only reads records the log already checked (the log's own tests cover the rule); here the reads are fake and the output is what is checked.
const AGENT = "did:web:example.com:agents:spender";
const mandate = (id: string, lines: unknown[], expires = "2027-01-01T00:00:00Z") => ({ id, type: "asp.mandate/v0.2", issuer: "did:web:example.com:users:sponsor", subject: AGENT, issued_at: "2026-11-01T00:00:00Z", body: { expires, institution_spend: lines } });
const purchase = (at: string, institution: string, value: number) => ({ id: `p-${at}`, type: "asp.purchase/v0.2", issuer: AGENT, issued_at: at, body: { institution, amount: { value, unit: "credit" } } });
const LIST = { id: "list-1", body: { version: 1, effective_from: "2026-11-02T00:00:00Z", job_tax_permille: 20, items: [{ service: "academy.exam.sit", institution: "did:web:asp.local:academy", price: 30 }] } };

function run(sub: string | undefined, rest: string[], mandates: unknown[], purchases: unknown[], flags: Record<string, unknown> = {}, appended: unknown[] = []) {
  const out: string[] = [];
  const signer = signerFromSeed(AGENT + "#key-1", randomSeed());
  const log = { log: { mandatesOf: async () => mandates, purchasesBy: async () => purchases, priceLists: async () => [LIST] }, append: async (r: unknown) => { appended.push(r); return { id: "new-purchase", seq: 9 }; } } as any;
  const code = spendCmd(sub, rest, { log, io: { out: (l) => out.push(l) }, now: () => "2026-11-12T12:00:00Z", flags, signerFor: () => signer as any });
  return code.then((c) => ({ code: c, text: out.join("\n") }));
}

test("spend shows each institution_spend line with what was spent this period and what is left; last month's spending does not count", async () => {
  const m = mandate("m1", [{ institution: "academy", cap: { value: 100, unit: "credit" }, period: "month" }, { institution: "shops", cap: { value: 20, unit: "credit" }, period: "day", services: ["shops.upkeep"] }]);
  const r = await run(AGENT, [], [m], [purchase("2026-11-03T10:00:00Z", "did:web:asp.local:academy", 30), purchase("2026-10-30T10:00:00Z", "did:web:asp.local:academy", 50)]);
  assert.equal(r.code, 0);
  assert.match(r.text, /academy\s+30 of\s+100 this month, 70 left/);
  assert.match(r.text, /shops\s+0 of\s+20 this day, 20 left; only shops\.upkeep/);
  const j = JSON.parse((await run(AGENT, [], [m], [], { json: true })).text);
  assert.equal(j.lines[0].left, 100);
});

test("an agent with no Mandate or only an expired one can buy nothing, and says so", async () => {
  assert.match((await run(AGENT, [], [], [])).text, /default-deny/);
  const old = mandate("m0", [{ institution: "academy", cap: { value: 10, unit: "credit" }, period: "day" }], "2026-11-05T00:00:00Z");
  const r = await run(AGENT, [], [old], []);
  assert.equal(r.code, 1);
  assert.match(r.text, /can buy nothing/);
});

test("buy signs a purchase at the price in force, names the Mandate, and refuses an unknown service or a bad quantity", async () => {
  const appended: any[] = [];
  const r = await run("buy", ["academy.exam.sit"], [mandate("m1", [{ institution: "academy", cap: { value: 100, unit: "credit" }, period: "month" }])], [], { by: AGENT, quantity: "2" }, appended);
  assert.equal(r.code, 0);
  assert.match(r.text, /bought academy\.exam\.sit x2 for 60 credits/);
  assert.equal(appended[0].type, "asp.purchase/v0.2");
  assert.equal(appended[0].issuer, AGENT);
  assert.equal(appended[0].body.mandate, "m1");
  assert.equal(appended[0].body.price_list, "list-1");
  assert.equal(appended[0].body.amount.value, 60);
  assert.equal((await run("buy", ["nothing.here"], [], [], { by: AGENT })).code, 1);
  await assert.rejects(() => run("buy", ["academy.exam.sit"], [], [], { by: AGENT, quantity: "0" }), SpendUsage);
  await assert.rejects(() => run("buy", [], [], [], {}), SpendUsage);
});

test("the default budget of a new Mandate is the Academy and the Shops by the month and fits a tier 1 agent; lines can be named, and none means no budget", () => {
  const d = parseInstitutionSpend(undefined);
  assert.deepEqual(d.map((l) => [l.institution, l.cap.value, l.period]), [["academy", 60, "month"], ["shops", 40, "month"]]);
  assert.ok(d.reduce((n, l) => n + l.cap.value, 0) <= 100, "the caps of one period add up to at most the tier 1 limit of 100");
  d[0].cap.value = 1;
  assert.equal(DEFAULT_INSTITUTION_SPEND[0].cap.value, 60, "a caller changing its copy does not change the default");
  assert.deepEqual(parseInstitutionSpend(["academy=30/week", "shops=10/day:shops.upkeep,shops.repair"]), [
    { institution: "academy", cap: { value: 30, unit: "credit" }, period: "week" },
    { institution: "shops", cap: { value: 10, unit: "credit" }, period: "day", services: ["shops.upkeep", "shops.repair"] },
  ]);
  assert.deepEqual(parseInstitutionSpend(["none"]), []);
  for (const bad of ["academy", "academy=0/month", "academy=5/year", "=5/day"]) assert.throws(() => parseInstitutionSpend([bad]), SpendUsage, bad);
});
