/** The institutions exist (register row CY1; spec-delta S460): each of the eleven institution accounts has a specification, a charter, a module in the log that enforces its rules, a test that runs those rules, and a place on the map; the ones that sell have a price in credits. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTITUTION_NAMES, institutionDid } from "@agent-social/asp-log";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const log = (f: string) => `packages/asp-log/${f}`;

/** For each institution: its specification, the module(s) in the log that enforce it, and the test(s) that run those rules. */
const BUILT: Record<string, { spec: string; src: string[]; tests: string[]; sells: boolean }> = {
  market: { spec: "market.md", src: ["src/market.ts", "src/market-rules.ts"], tests: ["test/market-board.test.ts"], sells: true },
  academy: { spec: "academy.md", src: ["src/academy.ts"], tests: ["test/academy-halls.test.ts"], sells: true },
  shops: { spec: "shops.md", src: ["src/shops.ts", "src/shops-rules.ts"], tests: ["test/shops.test.ts"], sells: true },
  courts: { spec: "courts.md", src: ["src/courts.ts", "src/courts-rules.ts"], tests: ["test/courts-routes.test.ts"], sells: true },
  registry: { spec: "registry.md", src: ["src/registry.ts", "src/registry-rules.ts"], tests: ["test/registry-civil.test.ts"], sells: true },
  clinic: { spec: "clinic.md", src: ["src/drift.ts"], tests: ["test/clinic-health-log.test.ts"], sells: false /* its prices are DK161 */ },
  housing: { spec: "housing.md", src: ["src/housing.ts", "src/housing-rules.ts"], tests: ["test/housing.test.ts"], sells: true },
  events: { spec: "leisure-events.md", src: ["src/events.ts", "src/events-rules.ts"], tests: ["test/events.test.ts"], sells: true },
  bank: { spec: "bank-insurer.md", src: ["src/bank.ts"], tests: ["test/bank.test.ts"], sells: false },
  insurer: { spec: "bank-insurer.md", src: ["src/insurer.ts"], tests: ["test/insurer.test.ts"], sells: true },
  research: { spec: "research-commons.md", src: ["src/research.ts", "src/research-rules.ts"], tests: ["test/research.test.ts"], sells: false },
};

test("CY1: every institution of the log has a specification, a charter, an enforcing module, a test that runs it, a row on the map and an account", () => {
  assert.deepEqual(Object.keys(BUILT).sort(), [...INSTITUTION_NAMES].sort(), "the table covers every institution account the log knows");
  const charters = read("docs/institutions/charter.md") + read("docs/institutions/charters.md");
  const map = read("docs/institutions/map.md");
  for (const [name, b] of Object.entries(BUILT)) {
    assert.ok(existsSync(join(root, "docs/institutions", b.spec)), `${name}: ${b.spec}`);
    for (const f of b.src) assert.ok(existsSync(join(root, log(f))), `${name}: ${f}`);
    for (const t of b.tests) {
      assert.ok(existsSync(join(root, log(t))), `${name}: ${t}`);
      assert.ok(read(log(t)).length > 2000, `${name}: ${t} is a real test`);
    }
    assert.ok(map.toLowerCase().includes(name === "events" ? "leisure and events" : name === "bank" || name === "insurer" ? "bank and insurer" : name), `${name} is on the map`);
    assert.match(charters.toLowerCase(), new RegExp(name === "events" ? "events" : name), `${name} has a charter`);
    assert.equal(institutionDid(name), `did:web:asp.local:${name}`);
  }
});

test("CY1: the institutions that sell have services priced in credits that a test of the log buys; the ones that do not sell are funded by a Treasury budget line and say so", () => {
  const tests = readdirSync(join(root, "packages/asp-log/test")).filter((f) => f.endsWith(".ts")).map((f) => read(log(`test/${f}`))).join(" ");
  for (const [name, b] of Object.entries(BUILT)) {
    if (!b.sells) continue;
    assert.match(tests, new RegExp(`"${name}\\.[a-z_.0-9]+"`), `${name} has a priced service that a test buys`);
  }
  const charters = read("docs/institutions/charter.md") + read("docs/institutions/charters.md");
  assert.match(charters, /Research.*No sales/s, "Research and the Commons sell nothing and say so");
  assert.match(charters, /Bank.*Treasury budget line/s, "the Bank is funded by a budget line, not by sales");
  assert.match(charters, /Clinic[\s\S]*Budget line "clinic"/, "the Clinic is funded by a budget line until its prices are on the list (DK161)");
});
