// The subsidy ledger (register row DK85; spec-delta S300; residency.md 5 to 7): a published budget in real units, per-agent and per-sponsor caps, grants, one use record per grant per day from the host's meter;
// the ledger reconciles to the meter, a spent budget stops new subsidised runs with a reason, the report is published, and no record touches a credit. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, CITY_BUDGET_DID, HOST_DID, subsidyReport, reconcileSubsidy } from "../src/index.ts";
import { publicReply } from "../src/public-pages.ts";
import { Kit, bankP, clinic, courts, operator, owner, party, refused, registrar, treasury, type Party } from "./academy-kit.ts";

const city = party(CITY_BUDGET_DID, 57);
const host = party(HOST_DID, 58);
const DEC = "2026-12-01T00:00:00Z", JAN = "2027-01-01T00:00:00Z";

async function world() {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, city, host].map((p) => [p.kid, p.publicKey])));
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
  const classes = [{ class: "newcomer", per_agent_cap: 600, per_sponsor_cap: 2 }, { class: "resident", per_agent_cap: 500, per_sponsor_cap: 3 }];
  const budgetBody = (over: Record<string, unknown> = {}) => ({ period: "2026-12", units: "tokens", total: 1000, published_at: kit.now(), classes, ...over });
  const budget = (over: Record<string, unknown> = {}, by: Party = city) => kit.mk("subsidy_budget" as never, by, budgetBody(over), null, { subject: null });
  const grant = (agent: Party, b: string, over: Record<string, unknown> = {}, by: Party = city) => kit.mk("subsidy_grant" as never, by, { agent: agent.did, class: "newcomer", budget: b, daily_cap: 200, period_cap: 600, from: DEC, until: JAN, ...over }, null, { subject: agent.did });
  const use = (g: string, units: number, window: string, over: Record<string, unknown> = {}, by: Party = host) => kit.mk("subsidy_use" as never, by, { grant: g, units, kind: "tokens", window, meter_hash: "sha256:" + "5".repeat(64), ...over }, null, { subject: null });
  return { kit, budget, grant, use };
}

test("DK85 done: the ledger reconciles to the meter, a spent budget stops new subsidised runs with a reason, and the report is published; no record touches a credit", async () => {
  const { kit, budget, grant, use } = await world();
  const sponsor = await kit.person("sub-sponsor");
  const a = await kit.agent("sub-a", sponsor, 1), b = await kit.agent("sub-b", sponsor, 1), c = await kit.agent("sub-c", sponsor, 1);
  await kit.mint(a.did, 50); await kit.mint(sponsor.did, 70);
  const credits = async () => [a.did, b.did, c.did, sponsor.did, "did:web:asp.local:treasury"].map((d) => kit.log.balance(d));
  const before = await Promise.all(await credits());

  // The budget: the City's alone, 72 hours ahead, one per period and unit.
  assert.equal(await refused(kit.put(budget({}, treasury))), "subsidy_wrong_issuer");
  assert.equal(await refused(kit.put(budget({ period: "2026-11" }))), "subsidy_budget_late", "published less than 72 hours ahead");
  assert.equal(await refused(kit.put(budget({ classes: [classes0(), classes0()] }))), "subsidy_class_twice");
  const bid = await kit.put(budget());
  assert.equal(await refused(kit.put(budget())), "subsidy_budget_exists");

  // Grants: caps by class and sponsor, one active per class, classes by standing, inside the period, inside the budget.
  assert.equal(await refused(kit.put(grant(a, "sha256:" + "4".repeat(64)))), "subsidy_budget_unknown");
  assert.equal(await refused(kit.put(grant(sponsor as Party, bid))), "subsidy_not_an_agent");
  assert.equal(await refused(kit.put(grant(a, bid, { period_cap: 601 }))), "subsidy_over_agent_cap");
  assert.equal(await refused(kit.put(grant(a, bid, { daily_cap: 601 }))), "subsidy_daily_cap");
  assert.equal(await refused(kit.put(grant(a, bid, { from: "2026-11-30T00:00:00Z" }))), "subsidy_grant_outside_period");
  assert.equal(await refused(kit.put(grant(a, bid, { class: "research" }))), "subsidy_class_not_in_budget");
  assert.equal(await refused(kit.put(grant(a, bid, { class: "resident", period_cap: 500 }))), "subsidy_class_not_met", "a resident needs 3 qualifying jobs");
  const ga = await kit.put(grant(a, bid));
  assert.equal(await refused(kit.put(grant(a, bid, { period_cap: 100, daily_cap: 100 }))), "subsidy_grant_exists", "one active grant per agent and class");
  assert.equal(await refused(kit.put(grant(b, bid))), "subsidy_budget_committed", "600 and 600 do not fit in 1,000");
  const gb = await kit.put(grant(b, bid, { period_cap: 400 }));
  assert.equal(await refused(kit.put(grant(c, bid, { period_cap: 1, daily_cap: 1 }))), "subsidy_over_sponsor_cap", "a sponsor has 2 agents on the class at once");

  // Use: the host's, one per grant per day, in the grant's units, inside the day's cap and the grant.
  assert.equal(await refused(kit.put(use(ga, 100, "2026-12-02", {}, city))), "subsidy_use_wrong_issuer");
  assert.equal(await refused(kit.put(use("sha256:" + "4".repeat(64), 100, "2026-12-02"))), "subsidy_grant_unknown");
  assert.equal(await refused(kit.put(use(ga, 100, "2026-12-02", { kind: "host_seconds" }))), "subsidy_units_mismatch", "units are never converted");
  assert.equal(await refused(kit.put(use(ga, 100, "2026-11-20"))), "subsidy_use_outside_grant");
  assert.equal(await refused(kit.put(use(ga, 201, "2026-12-02"))), "subsidy_exceeded", "over the day's cap");
  const meter: { grant: string; window: string; units: number }[] = [];
  const day = async (g: string, units: number, window: string) => { await kit.put(use(g, units, window)); meter.push({ grant: g, window, units }); };
  await day(ga, 200, "2026-12-02");
  assert.equal(await refused(kit.put(use(ga, 100, "2026-12-02"))), "subsidy_use_exists", "one per grant and day");
  await day(ga, 200, "2026-12-03");
  await day(ga, 200, "2026-12-04");
  assert.equal(await refused(kit.put(use(ga, 1, "2026-12-05"))), "subsidy_exceeded", "the grant's 600 is used");

  // The ledger reconciles to the host's meter; a tampered meter does not.
  assert.deepEqual(reconcileSubsidy(await records(kit), meter), []);
  assert.deepEqual(reconcileSubsidy(await records(kit), [...meter.slice(1), { ...meter[0], units: 199 }]), [{ grant: ga, window: "2026-12-02", recorded: 200, metered: 199 }]);

  // The budget runs out: the second grant is used up too, and then no new subsidised run starts, with the reason.
  await day(gb, 200, "2026-12-02");
  await day(gb, 200, "2026-12-03");
  const rep = subsidyReport(await records(kit)).budgets[0];
  assert.equal(rep.total, 1000); assert.equal(rep.used, 1000); assert.equal(rep.remaining, 0); assert.equal(rep.spent, true);
  assert.deepEqual(rep.by_class.newcomer, { grants: 2, granted: 1000, used: 1000 });
  const other = await kit.agent("sub-other", await kit.person("sub-sponsor-2"), 1);
  assert.equal(await refused(kit.put(grant(other, bid, { period_cap: 1, daily_cap: 1 }))), "subsidy_exhausted", "a spent budget stops new subsidised runs");

  // The report is published, and no record moved a credit.
  const page = await publicReply(kit.log, "/residency/subsidy", false);
  assert.equal(page?.status, 200);
  assert.equal(((page!.json as { result: { budgets: { spent: boolean }[] } }).result).budgets[0].spent, true);
  assert.match(subsidyReport(await records(kit)).note, /never credits/);
  assert.deepEqual(await Promise.all(await credits()), before, "no subsidy record changes any credit account");
  assert.equal((await kit.log.verify()).ok, true);
});

const classes0 = () => ({ class: "newcomer", per_agent_cap: 1, per_sponsor_cap: 1 });
async function records(kit: Kit) {
  const out = [];
  for (let after = 0; ;) { const page = await kit.log.since(after, 500); if (!page.length) break; for (const s of page) { after = s.seq; out.push(s.record); } }
  return out;
}
