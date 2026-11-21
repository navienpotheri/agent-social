/** The map of the society (register row DK41; spec-delta S454): every institution has a row that lists what it reads and writes, every record type an institution owns is in the map, and the twelfth institution is built from the shared layer. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RECORD_TYPES } from "@agent-social/asp-core";
import { INSTITUTION_NAMES } from "@agent-social/asp-log";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const map = readFileSync(join(root, "docs/institutions/map.md"), "utf8");
const rows = map.split("\n").filter((l) => /^\| \d+ \| \*\*/.test(l)).map((l) => l.split(" | ").map((c) => c.replace(/^\| |\s*\|$/g, "")));

test("DK41: the map has a row for each of the twelve institutions, none pending, each with what it reads, writes and holds", () => {
  assert.equal(rows.length, 12);
  assert.ok(!/\*pending\*/.test(rows.map((r) => r.join(" ")).join("\n")), "no row is still pending");
  for (const r of rows) {
    const [num, name, reads, writes, accounts, dependsOn, dependedOnBy, shared] = r;
    for (const [what, v] of Object.entries({ reads, writes, accounts, dependsOn, dependedOnBy, shared })) assert.ok(v && v.length > 3, `${name}: ${what}`);
    assert.ok(Number(num) >= 1);
  }
  const text = rows.map((r) => r[1].toLowerCase()).join(" | ");
  for (const w of ["registry", "courts", "treasury", "market", "bank and insurer", "shops", "academy", "clinic", "research", "forum", "leisure", "housing"]) assert.ok(text.includes(w), `a row for ${w}`);
});

test("DK41: every record type an institution owns (its `_act` records and the closed loop's) is named in the map, and each institution account of the log has a row", () => {
  const owned = RECORD_TYPES.filter((t) => /_act$/.test(t) && !["deposit_act", "telemetry_act", "court_act"].includes(t) || ["budget", "treasury_payment", "allowance", "prize", "price_list", "purchase", "receipt"].includes(t));
  const writes = rows.map((r) => r[3]).join("\n");
  for (const t of owned) {
    if (t === "market_act" || t === "registry_act" || t === "shops_act" || t === "housing_act" || t === "events_act" || t === "research_act") assert.ok(writes.includes(t) || map.includes(t), `${t} is in the map`);
    else assert.ok(map.includes(t), `${t} is in the map`);
  }
  const all = rows.map((r) => r.join(" ").toLowerCase()).join("\n");
  for (const n of INSTITUTION_NAMES) assert.ok(all.includes(n), `${n} has a row`);
});

test("DK41: the twelfth institution (Housing) is built from the shared layer: its row uses the price list, purchase and receipt, charter and audit, and its test buys through the shared purchase path", () => {
  const housing = rows.find((r) => /Housing/.test(r[1]))!;
  for (const w of ["price list", "purchase and receipt", "charter", "audit"]) assert.ok(housing[7].includes(w), `Housing uses the shared ${w}`);
  assert.ok(existsSync(join(root, "packages/asp-log/src/shops.ts")), "the shared catalogue and purchase checks");
  const test_ = readFileSync(join(root, "packages/asp-log/test/housing.test.ts"), "utf8");
  assert.match(test_, /w\.buy\(a, "housing\./, "a purchase of a housing item goes through the shared path");
  assert.match(test_, /price_list/, "from a price list");
  // The shared layer's rows say what is built.
  assert.match(map, /\| \*\*Price list\*\* .*yes \(`price_list`/);
  assert.match(map, /\| \*\*Purchase and receipt\*\* .*yes \(`purchase`, `receipt`/);
});
