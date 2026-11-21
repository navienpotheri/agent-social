// Row DK390 (spec-delta S963): `asp spend standing create|list|run|cancel` over a fake log (the log's own rules are tested in packages/asp-log/test/standing-order.test.ts): create signs an order at the price in force, run signs this
// period's purchase once for each live order and names the order, a second run in the period does nothing, a cancelled or ended order is not run. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomSeed, signerFromSeed } from "@agent-social/asp-core";
import { SpendUsage, spendCmd } from "../src/spend.ts";

const AGENT = "did:web:example.com:agents:standing-spender";
const ACADEMY = "did:web:asp.local:academy";
const LIST = { id: "list-1", body: { version: 1, effective_from: "2026-11-02T00:00:00Z", job_tax_permille: 20, items: [{ service: "academy.exam.sit", institution: ACADEMY, price: 30 }] } };
const MANDATE = { id: "m1", type: "asp.mandate/v0.2", issuer: "did:web:example.com:users:sponsor", subject: AGENT, issued_at: "2026-11-01T00:00:00Z", body: { expires: "2027-01-01T00:00:00Z", institution_spend: [{ institution: "academy", cap: { value: 100, unit: "credit" }, period: "month" }] } };

function world() {
  const records: any[] = [];
  const out: string[] = [];
  const signer = signerFromSeed(AGENT + "#key-1", randomSeed());
  let clock = "2026-11-12T12:00:00Z";
  const log = {
    log: {
      mandatesOf: async () => [MANDATE], priceLists: async () => [LIST],
      purchasesBy: async () => records.filter((r) => r.type === "asp.purchase/v0.2"),
      recordsOfTypes: async (types: string[]) => records.filter((r) => types.some((t) => r.type === `asp.${t}/v0.2`)),
    },
    append: async (r: any) => { const rec = { ...r, id: `sha256:${String(records.length + 1).padStart(64, "0")}`, type: r.type.startsWith("asp.") ? r.type : `asp.${r.type}/v0.2` }; records.push(rec); return { id: rec.id, seq: records.length }; },
  } as any;
  const call = async (action: string, arg?: string, flags: Record<string, unknown> = {}) => {
    out.length = 0;
    const code = await spendCmd("standing", arg === undefined ? [action] : [action, arg], { log, io: { out: (l) => out.push(l) }, now: () => clock, flags: { by: AGENT, ...flags }, signerFor: () => signer as any });
    return { code, text: out.join("\n") };
  };
  return { records, call, setNow: (t: string) => { clock = t; } };
}

test("DK390: create signs an order at the price in force; run signs one purchase for the period naming the order and the Mandate; a second run in the period does nothing; a new period runs again", async () => {
  const w = world();
  const c = await w.call("create", "academy.exam.sit", { period: "week", until: "30" });
  assert.equal(c.code, 0, c.text);
  assert.match(c.text, /1 x academy\.exam\.sit \(30 credits\) each week/);
  const order = w.records[0];
  assert.equal(order.type, "asp.standing_order/v0.2");
  assert.equal(order.issuer, AGENT);
  assert.deepEqual([order.body.act, order.body.institution, order.body.quantity, order.body.period], ["order", ACADEMY, 1, "week"]);
  assert.equal(order.body.until, "2026-12-12T12:00:00Z");

  const r1 = await w.call("run");
  assert.equal(r1.code, 0, r1.text);
  assert.match(r1.text, /ran: 1 x academy\.exam\.sit for 30 credits/);
  const p = w.records.find((r) => r.type === "asp.purchase/v0.2");
  assert.equal(p.body.standing_order, order.id);
  assert.equal(p.body.mandate, "m1");
  assert.equal(p.body.amount.value, 30);
  assert.match(p.body.idempotency, /^standing-/);
  assert.match((await w.call("run")).text, /already ran this week/);
  assert.equal(w.records.filter((r) => r.type === "asp.purchase/v0.2").length, 1);
  w.setNow("2026-11-20T12:00:00Z");
  assert.match((await w.call("run")).text, /ran: 1 x academy\.exam\.sit/);
  assert.equal(w.records.filter((r) => r.type === "asp.purchase/v0.2").length, 2, "the next week runs again");
  assert.match((await w.call("list")).text, /1 x academy\.exam\.sit\s+each week\s+until 2026-12-12T12:00:00Z/);
});

test("DK390: cancel ends an order at once, an ended order is not run, and the usage is checked", async () => {
  const w = world();
  await w.call("create", "academy.exam.sit", { period: "day", until: "2" });
  const id = w.records[0].id;
  const cancelled = await w.call("cancel", id.slice(0, 15));
  assert.equal(cancelled.code, 0, cancelled.text);
  assert.match(cancelled.text, /cancelled at once/);
  assert.match((await w.call("list")).text, /\(cancelled\)/);
  const run = await w.call("run");
  assert.equal(w.records.filter((r) => r.type === "asp.purchase/v0.2").length, 0, "a cancelled order is not run");
  assert.match(run.text, /0 ran, 0 refused/);
  const w2 = world();
  await w2.call("create", "academy.exam.sit", { period: "week", until: "1" });
  w2.setNow("2026-11-20T00:00:00Z");
  assert.match((await w2.call("run")).text, /0 ran, 0 refused/);
  assert.match((await w2.call("list")).text, /\(ended\)/);
  assert.equal((await w.call("cancel", "nothing")).code, 1);
  assert.equal((await w.call("create", "nothing.here", { period: "week", until: "5" })).code, 1);
  await assert.rejects(() => w.call("create", "academy.exam.sit", { period: "year", until: "5" }), SpendUsage);
  await assert.rejects(() => w.call("create", "academy.exam.sit"), SpendUsage);
});
