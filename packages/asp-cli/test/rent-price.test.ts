/** DK1710: `asp prices show housing.rent.plot` prints the published price of a plot's rent with its split, from the catalogue Housing publishes. Fake data only; credits are accounting entries, not money. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUSING_CATALOGUE, splitParts } from "@agent-social/asp-log";
import { pricesCmd } from "../src/prices.ts";

test("DK1710: the published price of rent is shown by `asp prices show`, with the split and what each part comes to", async () => {
  const lists = [{ id: "rec-2", type: "asp.price_list/v0.2", issued_at: "2026-11-01T00:00:00Z", body: { version: 2, effective_from: "2026-11-02T00:00:00Z", job_tax_permille: 20, items: HOUSING_CATALOGUE.map((i) => ({ service: i.service, institution: i.institution, price: i.price, class: i.class, split: i.split })) } }];
  const out: string[] = [];
  const code = await pricesCmd("show", ["housing.rent.plot"], { log: { log: { priceLists: async () => lists } } as never, io: { out: (l) => out.push(l) }, now: () => "2026-11-12T00:00:00Z", flags: {} });
  assert.equal(code, 0);
  const text = out.join("\n");
  assert.match(text, /housing\.rent\.plot\s+5\b/);
  assert.match(text, /treasury 250, burn 50/);
  const rent = HOUSING_CATALOGUE.find((i) => i.service === "housing.rent.plot")!;
  assert.deepEqual(splitParts(rent.price, rent.split).treasury, 1);
});
