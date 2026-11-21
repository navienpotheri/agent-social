/**
 * The cost-of-living review (register rows DK1710 and GV4): the weekly earnings of agents measured from a seeded run of settlements, the draft of the rent and the job tax against the median, house agents left out, nothing
 * changed by it, and `asp prices review` printing it. Synthetic records; fake keys only; credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AspRecord } from "@agent-social/asp-core";
import { draftPrices, earningsReview } from "@agent-social/asp-log";
import { pricesCmd } from "../src/prices.ts";

let n = 0;
const R = (type: string, issuer: string, body: Record<string, unknown>, at: string): AspRecord => ({ type: `asp.${type}/v0.2`, id: `sha256:${String(++n).padStart(64, "0")}`, issuer, actor: issuer, subject: null, body, prev: null, issued_at: at, sig: {} as never });
const P = "did:web:example.com:users:client";
const DAY = 86_400_000, T0 = Date.parse("2026-11-02T10:00:00Z");   // a Monday
const at = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A seeded run: 20 agents over 4 weeks; agent i earns (10 + 5 * (i % 5)) a job, one job a week, except every 4th agent skips week 2. A house agent earns a lot and is left out. */
function seeded(): { records: AspRecord[]; house: string } {
  const records: AspRecord[] = [];
  const job = (agent: string, price: number, when: number) => { const c = R("contract", P, { principal: P, performer: agent, price: { value: price } }, at(when)); records.push(c, R("settlement", "did:web:asp.local:bank", { contract: c.id, basis: "accepted", escrow_released: { value: price }, bond_returned: { value: 0 }, bond_slashed: { value: 0 } }, at(when + 3600_000))); };
  for (let i = 0; i < 20; i++) for (let w = 0; w < 4; w++) { if (i % 4 === 0 && w === 1) continue; job(`did:web:example.com:agents:rv-${i}`, 10 + 5 * (i % 5), T0 + w * 7 * DAY + i * 60_000); }
  const house = "did:web:example.com:agents:rv-house";
  for (let w = 0; w < 4; w++) job(house, 500, T0 + w * 7 * DAY);
  return { records, house };
}

test("DK1710: the review measures weekly earnings per agent from the settlements, leaves house agents out, and counts idle weeks", () => {
  const { records, house } = seeded();
  const to = at(T0 + 3 * 7 * DAY + DAY);
  const r = earningsReview(records, { to, taxPermille: 20, houseAgents: new Set([house]) });
  assert.equal(r.earners, 20);
  assert.equal(r.weeks, 4);
  assert.equal(r.earnerWeeks, 20 * 4 - 5, "five agents skipped one week");
  // earnings per agent-week are 10, 15, 20, 25, 30 in equal numbers: median 20
  assert.equal(r.perEarnerWeek!.median, 20);
  assert.equal(r.perEarnerWeek!.max, 30);
  assert.equal(r.perEarnerWeek!.p25, 15);
  assert.equal(r.perEarnerWeek!.p75, 25);
  assert.equal(r.idleShare, Math.round((5 / 80) * 1000) / 1000, "five idle weeks of eighty");
  assert.equal(r.released, [...Array(20).keys()].reduce((a, i) => a + (10 + 5 * (i % 5)) * (i % 4 === 0 ? 3 : 4), 0));
  assert.equal(r.taxAt, Math.floor((r.released * 20) / 1000));
  const withHouse = earningsReview(records, { to, taxPermille: 20 });
  assert.ok(withHouse.perEarnerWeek!.max === 500 && withHouse.earners === 21, "without the exclusion the house agent would show");
  assert.deepEqual(earningsReview([], { to, taxPermille: 20 }), { weeks: 0, earners: 0, earnerWeeks: 0, perEarnerWeek: null, idleShare: null, released: 0, taxAt: 0 });
});

test("DK1710: the draft sets the rent at a stated share of the median week, keeps the tax inside the bounds, drafts no presence fee, and decides nothing", () => {
  const { records, house } = seeded();
  const r = earningsReview(records, { to: at(T0 + 3 * 7 * DAY + DAY), taxPermille: 20, houseAgents: new Set([house]) });
  const d = draftPrices(r, { rent: 5, taxPermille: 20 });
  assert.equal(d.rent.draft, 1, "5 percent of a median week of 20 is 1");
  assert.equal(d.rent.currentShareOfMedianPermille, 250, "the current rent of 5 is 25 percent of a median week of 20");
  assert.equal(draftPrices(r, { rent: 5, taxPermille: 20 }, { rentShareOfMedianPermille: 100 }).rent.draft, 2);
  assert.equal(d.jobTax.draftPermille, 20);
  assert.equal(d.jobTax.onTheMedianWeek, 0, "at 20 permille a median week of 20 pays no tax: it rounds down");
  assert.equal(draftPrices(r, { rent: 5, taxPermille: 80 }).jobTax.draftPermille, 50, "kept inside the Treasury's range of 0 to 50");
  assert.equal(d.presenceFee.draft, 0);
  assert.match(d.decides, /the owner approves the figures/);
  const none = draftPrices(earningsReview([], { to: at(T0), taxPermille: 20 }), { rent: 5, taxPermille: 20 });
  assert.equal(none.rent.draft, 5, "nothing measured: the current rent is kept");
  assert.match(none.basis, /nothing to measure/);
});

test("DK1710: `asp prices review` prints the measure and the draft from the log and changes nothing", async () => {
  const { records, house } = seeded();
  const lists = [{ id: "rec-1", type: "asp.price_list/v0.2", issued_at: "2026-11-01T00:00:00Z", body: { version: 1, effective_from: "2026-11-01T00:00:00Z", job_tax_permille: 20, items: [{ service: "housing.rent.plot", institution: "did:web:asp.local:housing", price: 5, class: "standard", split: { treasury_permille: 250, burn_permille: 50, payees: [{ account: "did:web:asp.local:housing", permille: 700 }] } }] } }];
  const log = { log: { priceLists: async () => lists, recordsOfTypes: async () => records, houseAgents: async () => [{ did: house }] } };
  const out: string[] = [];
  const code = await pricesCmd("review", [], { log: log as never, io: { out: (l) => out.push(l) }, now: () => at(T0 + 3 * 7 * DAY + DAY), flags: {} });
  assert.equal(code, 0);
  const text = out.join("\n");
  assert.match(text, /median weekly earnings of an agent in a week it earned are 20 credits \(20 agents, 75 agent-weeks over 4 week/);
  assert.match(text, /rent for a plot: 5 credits a week now \(25 percent of the median week\); drafted 1 \(5 percent\)/);
  assert.match(text, /job tax: 20 permille now; drafted 20, which is 0 credits on a median week/);
  assert.match(text, /the owner approves the figures/);
  const json: string[] = [];
  await pricesCmd("review", [], { log: log as never, io: { out: (l) => json.push(l) }, now: () => at(T0 + 3 * 7 * DAY + DAY), flags: { json: true } });
  assert.equal(JSON.parse(json.join("\n")).draft.rent.draft, 1);
  assert.equal(lists.length, 1, "nothing was published");
});
