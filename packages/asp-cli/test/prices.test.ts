import { test } from "node:test";
import assert from "node:assert/strict";
import { pricesCmd, PricesUsage } from "../src/prices.ts";

// The records are shaped like the log's price_list records; `asp prices` only reads them (the log's own tests check the signing and the rules).
const item = (service: string, price: number, burn = 100) => ({ service, institution: "did:web:asp.local:market", price, class: "standard", split: { treasury_permille: 150, burn_permille: burn, payees: [{ account: "did:web:asp.local:market", permille: 1000 - 150 - burn }] } });
const list = (version: number, from: string, items: unknown[], tax = 20) => ({ id: `rec-${version}`, type: "asp.price_list/v0.2", issued_at: "2026-11-01T00:00:00Z", body: { version, effective_from: from, job_tax_permille: tax, items } });
const LISTS = [
  list(1, "2026-11-02T00:00:00Z", [item("market.posting.deposit", 40), item("academy.course", 30)]),
  list(2, "2026-12-01T00:00:00Z", [item("market.posting.deposit", 50, 120), item("academy.course", 30), item("clinic.checkup", 20)], 25),
];
async function run(sub: string, rest: string[], flags: { at?: string; json?: boolean } = {}, lists: unknown[] = LISTS) {
  const out: string[] = [];
  const code = await pricesCmd(sub, rest, { log: { log: { priceLists: async () => lists } } as any, io: { out: (l) => out.push(l) }, now: () => "2026-11-12T00:00:00Z", flags });
  return { code, text: out.join("\n") };
}

test("show prints the version in force with every service, its split, and announces the next version", async () => {
  const r = await run("show", []);
  assert.equal(r.code, 0);
  assert.match(r.text, /version 1/);
  assert.match(r.text, /market\.posting\.deposit\s+40/);
  assert.match(r.text, /treasury 150, burn 100/);
  assert.match(r.text, /announced: version 2 takes effect 2026-12-01/);
  assert.doesNotMatch(r.text, /clinic\.checkup/, "a service only in the next version is not in force yet");
});

test("show --at reads the list in force then; one service or institution can be named; before the first list there is none", async () => {
  assert.match((await run("show", [], { at: "2026-12-05T00:00:00Z" })).text, /version 2/);
  const one = await run("show", ["clinic.checkup"], { at: "2026-12-05T00:00:00Z" });
  assert.match(one.text, /clinic\.checkup/); assert.doesNotMatch(one.text, /academy\.course/);
  const before = await run("show", [], { at: "2026-10-01T00:00:00Z" });
  assert.equal(before.code, 1); assert.match(before.text, /no price list is in force/);
  assert.equal((await run("show", [], {}, [])).text, "the Treasury has not published a price list yet");
  assert.equal((await run("show", ["nothing.here"])).code, 1);
});

test("history lists the versions and diff names what was added, changed and removed, and the tax change", async () => {
  const h = await run("history", []);
  assert.match(h.text, /version 1[^\n]*\n.*version 2/s);
  const d = await run("diff", ["1", "2"]);
  assert.match(d.text, /job tax: 20 -> 25/);
  assert.match(d.text, /changed market\.posting\.deposit: price 40 -> 50, split changed/);
  assert.match(d.text, /added   clinic\.checkup: 20/);
  assert.doesNotMatch(d.text, /academy\.course/, "unchanged");
  assert.equal((await run("diff", ["1", "9"])).code, 1);
  await assert.rejects(() => run("diff", ["x"]), PricesUsage);
  await assert.rejects(() => run("nope", []), PricesUsage);
});
