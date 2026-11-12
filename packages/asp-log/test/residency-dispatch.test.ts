// The funding model of residency (register row DK82; spec-delta S302; residency.md 4 to 7): a test agent is dispatched to the city under a capped sponsor allowance plus a subsidy grant, stops cleanly at each cap
// with a reason (sleeping, never struck), and the sponsor's statement reconciles to the metered usage and to the subsidy ledger. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, CITY_BUDGET_DID, HOST_DID } from "../src/index.ts";
import { ResidentMeter, residencyStatement } from "../../asp-package/src/residency-meter.ts";
import { issueDelegation, newNodeKey } from "../../asp-package/src/residency-host.ts";
import { Kit, bankP, clinic, courts, operator, owner, party, refused, registrar, treasury, type Party } from "./academy-kit.ts";

const city = party(CITY_BUDGET_DID, 57);
const host = party(HOST_DID, 58);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const SHA = "sha256:" + "3".repeat(64);

async function world() {
  let ref: Kit | undefined;
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, city, host].map((p) => [p.kid, p.publicKey])));
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver, now: () => new Date(ref!.now()) }));
  ref = kit;
  const sponsor = await kit.person("rd-sponsor");
  const root = party("did:web:example.com:agents:rd-agent", 78);
  const version = await kit.put(kit.mk("passport", sponsor, { did: root.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: [{ id: root.kid, type: "Ed25519", public_key: b64urlEncode(root.publicKey) }] }, null, { subject: root.did }));
  const job = await kit.job(root);
  const classes = [{ class: "newcomer", per_agent_cap: 400, per_sponsor_cap: 3 }];
  const budget = await kit.put(kit.mk("subsidy_budget" as never, city, { period: "2026-12", units: "tokens", total: 1000, published_at: kit.now(), classes }, null, { subject: null }));
  const grant = await kit.put(kit.mk("subsidy_grant" as never, city, { agent: root.did, class: "newcomer", budget, daily_cap: 150, period_cap: 300, from: "2026-12-01T00:00:00Z", until: "2027-01-01T00:00:00Z" }, null, { subject: root.did }));
  const allowance = (over: Record<string, unknown> = {}, by: Party = sponsor) => kit.mk("sponsor_allowance" as never, by, { sponsor: sponsor.did, agent: root.did, period: "2026-12", tokens_per_day: 100, tokens_total: 250, credits_per_month: 0, source: "sponsor_gateway", completion_reserve_permille: 100, ...over }, null, { subject: root.did });
  const allowanceId = await kit.put(allowance());
  const node = newNodeKey(root.did, "rd-node");
  const t = kit.tick();
  const delegation = await kit.put(issueDelegation(root, root.did, node, { mandate: job.mandate, host: HOST_DID, expires: iso(Date.parse(t) + 20 * 3_600_000), issuedAt: t }));
  const dispatch = (over: Record<string, unknown> = {}, by: Party = sponsor, cosigners: Party[] = [host]) => kit.mk("dispatch" as never, by, clean({ agent: root.did, version, package_sha256: SHA, mandate: job.mandate, sponsor_allowance: allowanceId, subsidy_grant: grant, delegation, mode: "split", host: HOST_DID, from: "2026-12-01T00:00:00Z", until: "2026-12-31T00:00:00Z", recall_deadline_seconds: 60, ...over }), null, { subject: root.did, cosigners });
  return { kit, sponsor, root, job, grant, budget, allowance, allowanceId, delegation, version, dispatch };
}

test("DK82 done: an agent is dispatched under a capped allowance plus a subsidy, stops cleanly at each cap with a reason and is never struck, and the sponsor statement reconciles to the metered usage", async () => {
  const w = await world();
  const { kit, sponsor, root, job } = w;
  const stranger = await kit.person("rd-stranger");

  // The allowance: the sponsor's, within the tier's ceiling, never prepaid.
  assert.equal(await refused(kit.put(w.allowance({}, stranger))), "allowance_not_the_sponsor");
  assert.equal(await refused(kit.put(w.allowance({ tokens_per_day: 500_001, tokens_total: 9_000_000 }))), "allowance_over_tier_ceiling");
  assert.equal(await refused(kit.put(w.allowance({ tokens_per_day: 300, tokens_total: 200 }))), "allowance_daily_over_total");
  assert.equal(await refused(kit.put(w.allowance({ credits_per_month: 5000 }))), "allowance_over_tier_limit");

  // The dispatch: every part must match.
  assert.equal(await refused(kit.put(w.dispatch({}, stranger))), "dispatch_not_the_sponsor");
  assert.equal(await refused(kit.put(w.dispatch({}, sponsor, []))), "dispatch_needs_host", "the city host countersigns");
  assert.equal(await refused(kit.put(w.dispatch({ host: "did:web:evil.example" }))), "dispatch_wrong_host");
  assert.equal(await refused(kit.put(w.dispatch({ until: "2026-11-30T00:00:00Z" }))), "dispatch_dates");
  assert.equal(await refused(kit.put(w.dispatch({ version: job.contract }))), "dispatch_version_unknown");
  assert.equal(await refused(kit.put(w.dispatch({ mandate: w.allowanceId }))), "dispatch_mandate_mismatch");
  assert.equal(await refused(kit.put(w.dispatch({ sponsor_allowance: w.grant }))), "dispatch_allowance_mismatch");
  assert.equal(await refused(kit.put(w.dispatch({ subsidy_grant: undefined }))), "dispatch_needs_subsidy", "a city residency runs on a subsidy grant");
  assert.equal(await refused(kit.put(w.dispatch({ delegation: w.version }))), "dispatch_delegation_mismatch");
  assert.equal(await refused(kit.put(w.dispatch({ previous: w.allowanceId }))), "dispatch_previous_not_closed");
  const dispatchId = await kit.put(w.dispatch());
  assert.equal(await refused(kit.put(w.dispatch())), "already_dispatched", "one open dispatch per agent");

  // The resident lives three simulated days; the host's meter charges each turn to its source, split mode: routine turns on the subsidy, hard turns on the sponsor's allowance.
  let budgetLeft = 1000;
  const meter = new ResidentMeter({ mode: "split", allowancePerDay: 100, allowanceTotal: 250, reservePermille: 100, subsidyPerDay: 150, subsidyPerPeriod: 300, budgetLeft: () => budgetLeft });
  const statusOf = async (status: "active" | "sleeping", reason?: string) => kit.put(kit.mk("residency_status" as never, host, { dispatch: dispatchId, status, ...(reason ? { reason } : {}) }, null, { subject: null }));
  const must = (c: ReturnType<ResidentMeter["charge"]>) => { assert.equal(c.ok, true); return c; };
  const stops = (c: ReturnType<ResidentMeter["charge"]>, ceiling: string, sleepReason: string, text: RegExp) => { assert.equal(c.ok, false); if (!c.ok) { assert.equal(c.ceiling, ceiling); assert.equal(c.sleepReason, sleepReason); assert.match(c.reason, text); } };
  // Day 1
  must(meter.charge("2026-12-01", 60, { turn: "routine" })); must(meter.charge("2026-12-01", 60, { turn: "routine" }));
  stops(meter.charge("2026-12-01", 60, { turn: "routine" }), "subsidy_daily", "subsidy_spent", /daily subsidy for this agent is spent.*wakes tomorrow/);
  await statusOf("sleeping", "subsidy_spent");
  must(meter.charge("2026-12-01", 50, { turn: "hard" }));
  stops(meter.charge("2026-12-01", 50, { turn: "hard" }), "allowance_daily", "allowance_spent", /allowance for today is spent.*10 % kept to finish open jobs.*asp residency allowance set/);
  must(meter.charge("2026-12-01", 50, { turn: "hard", finishingJob: true })); // the completion reserve lets an open job finish
  stops(meter.charge("2026-12-01", 10, { turn: "hard", finishingJob: true }), "allowance_daily", "allowance_spent", /100 of 100/);
  // Day 2 and 3
  await statusOf("active");
  must(meter.charge("2026-12-02", 60, { turn: "routine" })); must(meter.charge("2026-12-02", 60, { turn: "routine" })); must(meter.charge("2026-12-02", 50, { turn: "hard" }));
  must(meter.charge("2026-12-03", 60, { turn: "routine" }));
  stops(meter.charge("2026-12-03", 10, { turn: "routine" }), "subsidy_period", "subsidy_spent", /subsidy for the period \(300 tokens\) is spent/);
  must(meter.charge("2026-12-03", 60, { turn: "hard" }));
  assert.equal(meter.used("sponsor"), 210, "the sponsor's allowance paid for the hard turns only: 50 and 50 on day 1, 50 on day 2, 60 on day 3");
  assert.equal(meter.used("subsidy"), 300, "the subsidy paid for the routine turns, to the period cap");
  budgetLeft = 0;
  stops(meter.charge("2026-12-04", 1, { turn: "routine" }), "subsidy_budget", "subsidy_spent", /subsidy budget for this period is spent/);

  // Sleeping is never a penalty: no strike, no slash, no change of tier.
  assert.deepEqual(await kit.log.reputationOf(root.did), { tier: 1, slashCount: 0, strikes: 0 });
  assert.equal(await refused(kit.put(kit.mk("residency_status" as never, sponsor, { dispatch: dispatchId, status: "sleeping", reason: "allowance_spent" }, null, { subject: null }))), "status_wrong_issuer");
  assert.equal(await refused(kit.put(kit.mk("residency_status" as never, host, { dispatch: dispatchId, status: "sleeping" }, null, { subject: null }))), "status_needs_reason");
  assert.equal(await refused(kit.put(kit.mk("residency_status" as never, host, { dispatch: dispatchId, status: "active", reason: "allowance_spent" }, null, { subject: null }))), "status_reason_only_when_sleeping");
  assert.equal(await refused(kit.put(kit.mk("residency_status" as never, host, { dispatch: w.grant, status: "active" }, null, { subject: null }))), "status_unknown_dispatch");

  // The host signs one subsidy use per day from its meter; the log accepts exactly what the meter says, within the grant's caps.
  for (const d of meter.subsidyDays()) await kit.put(kit.mk("subsidy_use" as never, host, { grant: w.grant, units: d.units, kind: "tokens", window: d.window, meter_hash: SHA }, null, { subject: null }));
  const uses = (await records(kit)).filter((r) => r.type === "asp.subsidy_use/v0.2").map((r) => r.body as { window: string; units: number });
  const input = { dispatch: dispatchId, agent: root.did, mode: "split" as const, meter: { rows: meter.rows, refusals: meter.refusals }, subsidyUses: uses, sponsorRunLogTokens: 210 };
  const statement = residencyStatement(input);
  assert.equal(statement.reconciles, true, statement.mismatches.join("; "));
  assert.deepEqual(statement.tokens_by_source, { sponsor: 210, subsidy: 300 });
  assert.deepEqual([...statement.ceilings_hit].sort(), ["allowance_daily", "subsidy_budget", "subsidy_daily", "subsidy_period"]);
  assert.match(statement.lines.join(" "), /slept at each and was not struck or slashed/);
  assert.match(statement.lines.join(" "), /not a payment to you/);
  // A statement that does not match the meter says so.
  assert.equal(residencyStatement({ ...input, sponsorRunLogTokens: 211 }).reconciles, false);
  assert.equal(residencyStatement({ ...input, subsidyUses: uses.slice(1) }).reconciles, false);

  // A recall ends the residency; the dispatch stays open to the handback that closes the cycle.
  assert.equal(await refused(kit.put(kit.mk("recall" as never, stranger, { dispatch: dispatchId, reason: "mine now" }, null, { subject: null }))), "recall_not_the_sponsor");
  assert.equal(await refused(kit.put(kit.mk("recall" as never, sponsor, { dispatch: w.grant, reason: "x" }, null, { subject: null }))), "recall_unknown_dispatch");
  await kit.put(kit.mk("recall" as never, sponsor, { dispatch: dispatchId, reason: "bring it home to review and evolve it" }, null, { subject: null }));
  assert.equal(await refused(kit.put(kit.mk("recall" as never, sponsor, { dispatch: dispatchId, reason: "again" }, null, { subject: null }))), "recall_not_open");
  assert.equal(await refused(kit.put(w.dispatch())), "already_dispatched", "a recalled dispatch is not closed until its handback");
  assert.equal((await kit.log.verify()).ok, true);
  void job;
});

async function records(kit: Kit) {
  const out = [];
  for (let after = 0; ;) { const page = await kit.log.since(after, 500); if (!page.length) break; for (const s of page) { after = s.seq; out.push(s.record); } }
  return out;
}
