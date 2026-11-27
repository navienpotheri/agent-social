// The board's cold start (register rows GV3 and JB7; spec-delta S477): seed jobs the labelled house account posts, and a measure from the log of what a newcomer finds and who posts. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode } from "@agent-social/asp-core";
import { SEED_JOBS, SEED_PREFIX } from "../src/index.ts";
import { publicReply } from "../src/public-pages.ts";
import { credit, kit, mk, operator, party } from "./society-kit.ts";

const expires = "2027-02-01T00:00:00Z";

test("GV3, JB7: with an empty board no newcomer finds a job; after the house posts the starter jobs every newcomer finds them, and the measure says who is posting", async () => {
  const k = await kit();
  await k.withPrices();
  // Three newcomers (tier 1, no accepted job) with their own sponsors.
  const newcomers = [];
  for (let i = 0; i < 3; i++) newcomers.push(await k.agent(`cs-new-${i}`, await k.person(`cs-sp-${i}`), { tier: 1, skills: ["review"], funds: 100 }));
  const before = await k.log.coldStart();
  assert.equal(before.postings.open, 0);
  const base = before.newcomers.count;
  assert.ok(base >= 3, "the three newcomers (and the fixture's own agent) are counted");
  assert.equal(before.newcomers.withAJob, 0, "an empty board: no newcomer finds a job");
  assert.equal(before.newcomers.share, 0);

  // The labelled house agent posts the seed jobs, each with its own deposit, as `asp market seed` does.
  const house = party("did:web:example.com:agents:cs-house");
  await k.log.append(mk("passport", operator, { did: house.did, kind: "agent", sponsor: operator.did, tier: 1, shape: {}, keys: [{ id: house.kid, type: "Ed25519", public_key: b64urlEncode(house.publicKey) }], house: true }, null, { subject: house.did }));
  await k.mint(house.did, 200);
  const mandate = await k.openMandate(house, [{ institution: "market", cap: credit(30), period: "month" }]);
  for (const job of SEED_JOBS.slice(0, 5)) {
    const intent = await k.intent(house, { purpose: SEED_PREFIX + job.purpose, class: "routine", budget: credit(job.budget), skills: job.skills, min_tier: 1, acceptance_criteria: job.criteria });
    const deposit = await k.buy(house, "market.posting.deposit", 2, { mandate });
    await k.log.append(mk("market_act", house, { act: "posting", intent, board: "main", expires, deposit }));
  }
  // A person who runs an agent of their own posts one job, and a stranger posts one.
  const owner = await k.person("cs-owner", 500), stranger = await k.person("cs-stranger", 500);
  await k.agent("cs-owned", owner, { tier: 1, skills: ["code"], funds: 10 });
  for (const by of [owner, stranger]) {
    const intent = await k.intent(by, { purpose: "A real job", class: "routine", budget: credit(40), skills: ["code"] });
    const deposit = await k.buy(by, "market.posting.deposit", 2);
    await k.log.append(mk("market_act", by, { act: "posting", intent, board: "main", expires, deposit }));
  }
  const after = await k.log.coldStart();
  assert.equal(after.postings.open, 7);
  assert.equal(after.postings.seeded, 5, "five were posted by the house and say so");
  assert.deepEqual(after.postings.byPosterKind, { house: 5, ownersOfAgents: 1, others: 1 }, "who is posting");
  assert.equal(after.newcomerReachable, 7, "every one is open to a brand-new agent");
  assert.equal(after.newcomers.count, base + 1, "the owner's agent is a newcomer too");
  assert.equal(after.newcomers.withAJob, base + 1);
  assert.equal(after.newcomers.share, 1);
  assert.ok((after.newcomers.jobsFoundMedian ?? 0) >= 5, "each newcomer found at least the seeds");
  assert.ok(after.medianBudget !== null && after.medianBudget >= 20 && after.medianBudget <= 59, "inside the routine class");

  // Seed jobs are routine, tier 1, no certificate and priced in the routine band; the house account is a house agent and so is left out of rankings.
  for (const j of SEED_JOBS) { assert.ok(j.budget >= 20 && j.budget < 60, j.purpose); assert.ok(j.criteria.length >= 1 && j.skills.length >= 1); }
  assert.ok((await k.log.houseAgents()).some((h) => h.did === house.did));
  assert.equal((await k.log.creditAudit()).verdict, "balanced", "the deposits moved credits, nothing was made");

  const pub = await publicReply(k.log, "/market/cold-start", false);
  const r = (pub!.json as { result: { postings: { open: number }; method: Record<string, string> } }).result;
  assert.equal(r.postings.open, 7);
  for (const key of ["postings", "newcomerReachable", "newcomers", "medianBudget"]) assert.ok(r.method[key].length > 30, `${key} has its method`);
});
