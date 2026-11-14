// The city's indicators (register row GV1; spec-delta S461): population, work, disputes, credit supply, inequality and newcomer survival from the log's records only, each with its method, house agents left
// out, happiness stated as not measured, and a public page. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode } from "@agent-social/asp-core";
import { cityIndicators, INDICATOR_METHOD } from "../src/society-indicators.ts";
import { publicReply } from "../src/public-pages.ts";
import { Kit, operator, party } from "./academy-kit.ts";

const DAY = 86_400_000;

test("GV1: the inequality figures are the ones a reader can check by hand: equal holders give Gini 0, the textbook 1-2-3-4 gives 0.25, and the richest tenth's share is the share of the top tenth of holders", () => {
  const acc = (xs: number[]) => xs.map((b, i) => ({ did: `did:web:example.com:users:h${i}`, balance: b }));
  const at = "2026-12-01T00:00:00Z";
  const mk = (xs: number[]) => cityIndicators({ records: [], accounts: acc(xs), minted: xs.reduce((a, b) => a + b, 0), locked: 0, tiers: new Map() }, at);
  assert.equal(mk([5, 5, 5, 5]).inequality.gini, 0);
  assert.equal(mk([1, 2, 3, 4]).inequality.gini, 0.25);
  const ten = mk([1, 1, 1, 1, 1, 1, 1, 1, 1, 91]);
  assert.equal(ten.inequality.topTenthShare, 0.91, "one holder of ten holds 91 of 100");
  assert.equal(ten.inequality.holders, 10);
  assert.equal(mk([7]).inequality.gini, null, "one holder is not a distribution");
  assert.equal(mk([]).inequality.topTenthShare, null);
  // Institution and pool accounts are not citizens: they are not in circulation or in the shares.
  const withTreasury = cityIndicators({ records: [], accounts: [...acc([5, 5]), { did: "did:web:asp.local:treasury", balance: 1000 }], minted: 1010, locked: 0, tiers: new Map() }, at);
  assert.equal(withTreasury.supply.circulating, 10);
  assert.equal(withTreasury.supply.held, 1010);
  assert.equal(withTreasury.inequality.gini, 0);
});

test("GV1: on a log with people, agents, a house agent, a settled job, a report and a ruling the figures count what the records say, leave the house agent out, and say happiness is not measured", async () => {
  const kit = new Kit();
  const sponsor = await kit.person("ci-sponsor");
  const buyer = await kit.person("ci-buyer");
  const a = await kit.agent("ci-agent", sponsor, 1);
  const house = party("did:web:example.com:agents:ci-house", 77);
  await kit.put(kit.mk("passport", operator, { did: house.did, kind: "agent", sponsor: operator.did, tier: 1, shape: {}, keys: [{ id: house.kid, type: "Ed25519", public_key: b64urlEncode(house.publicKey) }], house: true }, null, { subject: house.did }));
  await kit.acceptedJob(buyer, a);
  const ind = await kit.log.cityIndicators(kit.now());
  assert.equal(ind.population.people, 2);
  assert.equal(ind.population.agents, 1);
  assert.equal(ind.population.houseAgentsExcluded, 1);
  assert.deepEqual(ind.population.agentsByTier, { "1": 1 });
  assert.equal(ind.work.contracts, 1);
  assert.equal(ind.work.settled, 1);
  assert.deepEqual(ind.work.settledByBasis, { accepted: 1 });
  assert.equal(ind.work.settledLast30Days, 1);
  assert.equal(ind.supply.minted > 0, true);
  assert.equal(ind.supply.minted, (await kit.log.creditAudit()).minted, "the supply is the audit's");
  assert.equal(ind.happiness, null, "happiness is not measured");
  for (const k of ["population", "work", "disputes", "supply", "inequality", "newcomers", "happiness"]) assert.ok(INDICATOR_METHOD[k].length > 40 && ind.method[k] === INDICATOR_METHOD[k], `${k} has its method`);
  assert.match(ind.method.happiness, /Not measured/);
});

test("GV1: newcomer survival counts the agents whose first passport is 30 to 90 days old and who did something in the last 30 days", async () => {
  const kit = new Kit();
  const sponsor = await kit.person("ci-sponsor-2");
  const buyer = await kit.person("ci-buyer-2");
  const active = await kit.agent("ci-active", sponsor, 1), quiet = await kit.agent("ci-quiet", sponsor, 1);
  await kit.acceptedJob(buyer, active); // both exist; only one works
  kit.addDays(45);
  const buyer2 = await kit.person("ci-buyer-3");
  await kit.acceptedJob(buyer2, active); // active again, 45 days on
  const ind = await kit.log.cityIndicators(kit.now());
  assert.equal(ind.newcomers.cohort, 2, "both agents are 45 days old");
  assert.equal(ind.newcomers.stillActive, 1, "only the one that worked in the last 30 days");
  assert.equal(ind.newcomers.survival, 0.5);
  void quiet;
  // Too new (under 30 days) is not a newcomer yet; too old (over 90) is established.
  const early = await kit.log.cityIndicators(new Date(Date.parse(kit.now()) - 40 * DAY).toISOString());
  assert.equal(early.newcomers.cohort, 0);
  kit.addDays(60);
  assert.equal((await kit.log.cityIndicators(kit.now())).newcomers.cohort, 0, "past 90 days they are established");
});

test("GV1: the public page serves the figures as JSON and as a page, with each method beside it and happiness marked not measured", async () => {
  const kit = new Kit();
  const sponsor = await kit.person("ci-sponsor-3");
  await kit.agent("ci-page", sponsor, 1);
  const json = await publicReply(kit.log, "/society/indicators", false);
  const r = (json!.json as { result: { population: { agents: number }; method: Record<string, string>; happiness: null } }).result;
  assert.equal(r.population.agents, 1);
  assert.equal(r.happiness, null);
  assert.ok(r.method.newcomers.includes("30 to 90 days"));
  const html = await publicReply(kit.log, "/society/indicators", true);
  assert.match(html!.html!, /<h1>City indicators<\/h1>/);
  assert.match(html!.html!, /<th>happiness<\/th><td>not enough data<\/td><td>Not measured/);
  assert.match(html!.html!, /anyone can recompute it/);
});
