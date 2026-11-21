/**
 * The guard measures that were unavailable, now computed from the log (register rows GV2, GV4, DK1; credits.md 5.6): G4 the basket ratio from measured earnings and the prices in force, G7 dormancy, G3 the claim rate.
 * The basket is measured on a real log (jobs settled through the kit), with too few earners it says so, and the monitor reports each as a measure or as unavailable with the reason. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AspRecord } from "@agent-social/asp-core";
import { basketRatio, claimsInDay, computeGuardReport, dormancyShare, BASKET_MIN_EARNERS } from "../src/index.ts";
import { institutionDid as institutionDidOf } from "../src/index.ts";
import { PRICES, kit } from "./society-kit.ts";

const rec = (type: string, body: Record<string, unknown>, at: string, id = `sha256:${type}${at}`): AspRecord => ({ type: `asp.${type}/v0.2`, id, issuer: "did:web:x", actor: "did:web:x", subject: null, body, prev: null, issued_at: at, sig: {} as never } as unknown as AspRecord);

test("G7: the share of residents that are dormant, visitors left out; nothing to measure with no resident", () => {
  assert.deepEqual(dormancyShare([], "2026-11-20T00:00:00Z"), { residents: 0, dormant: 0, share: null });
  const res = (agent: string, mode: string, at: string) => rec("shops_act", { act: "residency", agent, mode, since: "2026-11-01", budget: { credits_per_month: 30 } }, at);
  const records = [res("a", "resident", "2026-11-01T00:00:00Z"), res("b", "resident", "2026-11-01T00:01:00Z"), res("c", "resident", "2026-11-01T00:02:00Z"), res("d", "visit", "2026-11-01T00:03:00Z"),
    rec("shops_act", { act: "residency_status", agent: "b", status: "dormant", reason: "upkeep unpaid" }, "2026-11-10T00:00:00Z")];
  assert.deepEqual(dormancyShare(records, "2026-11-20T00:00:00Z"), { residents: 3, dormant: 1, share: 1 / 3 });
  assert.equal(dormancyShare(records, "2026-11-05T00:00:00Z").dormant, 0, "before the status record there was none");
});

test("G3: starter claims in the 24 hours before the time asked", () => {
  const c = (at: string) => rec("starter_claim", {}, at);
  const records = [c("2026-11-19T23:00:00Z"), c("2026-11-20T01:00:00Z"), c("2026-11-20T02:00:00Z"), c("2026-11-20T09:00:00Z")];
  assert.equal(claimsInDay(records, "2026-11-20T10:00:00Z"), 4);
  assert.equal(claimsInDay(records, "2026-11-21T08:30:00Z"), 1);
});

test("G4: the basket ratio is measured from the settlements and the prices in force: too few earners says so, enough gives the ratio, a missing price is named", async () => {
  const k = await kit();
  const extra = [
    { service: "shops.upkeep", institution: institutionDidOf("shops"), price: 1, split: { treasury_permille: 300, burn_permille: 150, payees: [{ account: institutionDidOf("shops"), permille: 550 }] }, class: "essential", effect: { type: "meal", value: "upkeep" }, duration_days: 1 },
    { service: "academy.course.foundations", institution: institutionDidOf("academy"), price: 30, split: { treasury_permille: 200, burn_permille: 100, payees: [{ account: institutionDidOf("academy"), permille: 700 }] }, class: "standard" },
  ];
  await k.issueList([...PRICES, ...extra] as never);
  const client = await k.person("gb-client", 100_000);
  const earn = async (name: string, price: number) => { const s = await k.person(`gb-s-${name}`); const a = await k.agent(`gb-${name}`, s, { funds: 10 }); await k.runJob(client, a, price); };
  for (let i = 0; i < BASKET_MIN_EARNERS - 1; i++) await earn(`early${i}`, 100);
  const records = async () => k.log.recordsOfTypes(["contract", "settlement"]);
  const at = "2026-11-20T00:00:00Z";
  const price = (s: string) => ([...PRICES, ...extra] as { service: string; price: number }[]).find((i) => i.service === s)?.price;
  const few = basketRatio(await records(), { to: at, price, taxPermille: 20 });
  assert.equal(few.verdict, "too_little_data");
  assert.equal(few.ratio, null);
  await earn("fifth", 100);
  await earn("sixth", 300);
  const measured = basketRatio(await records(), { to: at, price, taxPermille: 20 });
  assert.equal(measured.verdict, "measured");
  assert.equal(measured.earners, 6);
  assert.equal(measured.medianMonthlyEarnings, 100, "the median of 100 x5 and 300");
  assert.deepEqual(measured.parts, { upkeep: 30, course: 30, exam: 20, jobTax: 2 });
  assert.equal(measured.ratio, 82 / 100);
  assert.deepEqual(measured.missing, []);
  assert.deepEqual(basketRatio(await records(), { to: at, price: (s) => (s === "shops.upkeep" ? undefined : price(s)), taxPermille: 20 }).missing, ["shops.upkeep"], "a price the list does not have is named, not guessed");
  assert.equal(basketRatio(await records(), { to: "2027-03-01T00:00:00Z", price, taxPermille: 20 }).verdict, "too_little_data", "earnings older than 30 days are not counted");

  // The monitor reports the measures from the live log: G4 triggers (0.82 is above 0.40), G3 and G7 are measured, none of the three is unavailable.
  const report = await computeGuardReport({ handle: { log: k.log } as never, now: () => Date.parse(at) });
  const g4 = report.measures.find((m) => m.id === "G4");
  assert.ok(g4 && g4.triggered && Math.abs(g4.value - 0.82) < 1e-9, "the basket is over 40 percent of what the median agent earns");
  assert.ok(report.measures.some((m) => m.id === "G3" && m.value === 0 && !m.triggered));
  assert.equal(report.unavailable.some((u) => u.id === "G4" || u.id === "G3"), false);
  assert.ok(report.unavailable.some((u) => u.id === "G7"), "no resident yet: said plainly");
  assert.equal(report.anyTriggered, true);
});
