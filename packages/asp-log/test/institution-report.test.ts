/**
 * What an institution sold in a month (DK172, DK177, DK192; GET /institutions/<name>/report?month=YYYY-MM): for every service the quantity and the credits of the purchases issued in the month, and the receipts issued in
 * the month that delivered, refunded or failed, with the credits refunded; equal to a hand count, one institution's purchases never in another's report, counted in the month the record was issued. Credits are accounting
 * entries, not money. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, institutionDid } from "../src/index.ts";
import { publicReply } from "../src/public-pages.ts";
import { Kit, SERVICES, bankP, clinic, courts, credit, operator, owner, party, registrar, treasury } from "./academy-kit.ts";

const academyP = party(institutionDid("academy"), 57);

async function world() {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, academyP].map((p) => [p.kid, p.publicKey])));
  const k = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver })); // the clock starts on 2026-11-01
  await k.priceList();
  const a = await k.agent("ir-a", undefined, 2); await k.fund(a, 400);
  const b = await k.agent("ir-b", undefined, 2); await k.fund(b, 400);
  return { k, a, b };
}

test("DK172: the report lists the month's sales by service with quantity and credits, and the receipts, as a hand count would", async () => {
  const w = await world();
  const s1 = await w.k.buy(w.a, SERVICES.sitting, 20);
  await w.k.buy(w.b, SERVICES.sitting, 40, { quantity: 2 });
  const c1 = await w.k.buy(w.a, SERVICES.foundations, 30);
  await w.k.put(w.k.mk("receipt", academyP, { purchase: s1, status: "delivered" }, s1));
  await w.k.put(w.k.mk("receipt", academyP, { purchase: c1, status: "refunded", refund_amount: credit(12) }, c1));
  const rep = await w.k.log.institutionReport("academy", "2026-11");
  assert.deepEqual(rep.sold[SERVICES.sitting], { quantity: 3, credits: 60 }, "one sitting and a purchase of two");
  assert.deepEqual(rep.sold[SERVICES.foundations], { quantity: 1, credits: 30 });
  assert.equal(rep.purchases, 3);
  assert.equal(rep.credits, 90);
  assert.equal(rep.delivered, 1);
  assert.equal(rep.refunded, 1);
  assert.equal(rep.failed, 0);
  assert.equal(rep.refundedCredits, 12);
  assert.equal(rep.from, "2026-11-01T00:00:00Z");
  assert.equal(rep.to, "2026-12-01T00:00:00Z");
});

test("DK172: a purchase counts in the month it was issued and a receipt in the month it was issued; another institution's purchases are not in the report", async () => {
  const w = await world();
  const p = await w.k.buy(w.a, SERVICES.sitting, 20);
  w.k.addDays(40); // into December
  await w.k.buy(w.b, SERVICES.sitting, 20);
  await w.k.put(w.k.mk("receipt", academyP, { purchase: p, status: "failed", refund_amount: credit(18) }, p));
  const nov = await w.k.log.institutionReport("academy", "2026-11");
  assert.deepEqual([nov.purchases, nov.credits, nov.failed], [1, 20, 0], "the December purchase and the December receipt are not November's");
  const dec = await w.k.log.institutionReport("academy", "2026-12");
  assert.equal(dec.refundedCredits, 18, "a failed delivery refunds the price");
  assert.deepEqual([dec.purchases, dec.credits, dec.failed], [1, 20, 1], "a receipt for a November purchase counts in December, the month it was issued");
  const oct = await w.k.log.institutionReport("academy", "2026-10");
  assert.deepEqual([oct.purchases, oct.credits, oct.delivered, oct.refunded, oct.failed, oct.refundedCredits], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(oct.sold, {});
  assert.equal((await w.k.log.institutionReport("clinic", "2026-11")).purchases, 0, "the Academy's sales are not in the Clinic's report");
  assert.equal((await w.k.log.institutionReport("market", "2026-11")).purchases, 0, "an institution that sold nothing has an empty report");
});

test("DK172: the institution must be one of the city's, and GET /institutions/<name>/report serves it without a token", async () => {
  const w = await world();
  await w.k.buy(w.a, SERVICES.sitting, 20);
  const r = await publicReply(w.k.log, "/institutions/academy/report?month=2026-11", false) as { status: number; json: { ok: boolean; result: { purchases: number; institution: string } } };
  assert.equal(r.status, 200);
  assert.equal(r.json.result.institution, "academy");
  assert.equal(r.json.result.purchases, 1);
  assert.equal(((await publicReply(w.k.log, "/institutions/nowhere/report?month=2026-11", false)) as { status: number }).status, 404);
  assert.equal(((await publicReply(w.k.log, "/institutions/academy/report?month=2026-13", false)) as { status: number }).status, 400);
  assert.equal(((await publicReply(w.k.log, "/institutions/academy/report", false)) as { status: number }).status, 200);
  await assert.rejects(() => w.k.log.institutionReport("nowhere", "2026-11"), /not an institution/);
  await assert.rejects(() => w.k.log.institutionReport("academy", "Nov"), /YYYY-MM/);
});
