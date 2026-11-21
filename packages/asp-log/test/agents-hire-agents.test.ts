// Row DK1302 (spec-delta S1551; owner answer): agents hire agents. An enrolled agent posts a job from its own credits, an agent of another sponsor offers, the contract settles and both balances move. The first accepted job that
// unlocks the rest of the starter grant must come from a principal that is not a house agent, is independent (another sponsor), and is at the existing minimum price of 20 credits; a sponsor cluster settling its own jobs does not
// unlock it. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode } from "@agent-social/asp-core";
import { QUALIFYING_MIN_PRICE } from "../src/qualifying.ts";
import { STARTER_PER_DID, STARTER_UPFRONT } from "../src/index.ts";
import { STARTER_POOL_DID } from "../src/economy.ts";
import { credit, kit, keysOf, mk, operator, party } from "./society-kit.ts";
import { failure } from "./harness.ts";
const refused = async (p: Promise<unknown>) => { const f = await failure(p); return f?.detail ?? f?.code; };

async function world() {
  const k = await kit();
  await k.withPrices();
  await k.log.append(mk("mint", operator, { to: STARTER_POOL_DID, amount: credit(2000), reason: "starter_upfront", authority: "operator" }, null, { subject: STARTER_POOL_DID }));
  await k.log.append(mk("mint", operator, { to: STARTER_POOL_DID, amount: credit(2000), reason: "starter_rest", authority: "operator" }, null, { subject: STARTER_POOL_DID }));
  const sponsorA = await k.person("hh-sponsor-a", 200), sponsorB = await k.person("hh-sponsor-b", 200);
  const a = await k.agent("hh-poster", sponsorA, { tier: 1, funds: 300 });          // the agent that posts, from its own credits
  const b = await k.agent("hh-worker", sponsorB, { tier: 1 });                        // the newcomer that does the work: no credits of its own
  const b2 = await k.agent("hh-worker-sibling", sponsorB, { tier: 1, funds: 300 });  // another identity of the worker's sponsor
  const houseP = party("did:web:example.com:agents:hh-house");
  await k.log.append(mk("passport", operator, { did: houseP.did, kind: "agent", sponsor: operator.did, house: true, tier: 1, shape: {}, keys: keysOf(houseP) }, null, { subject: houseP.did }));
  await k.log.append(mk("mint", operator, { to: houseP.did, amount: credit(500), reason: "test", authority: "operator" }, null, { subject: houseP.did }));
  const claim = (by: typeof a, part: "upfront" | "rest") => k.log.append(mk("starter_claim", by, { part, amount: credit(part === "upfront" ? STARTER_UPFRONT : STARTER_PER_DID - STARTER_UPFRONT) }, null, { subject: by.did }));
  return { k, a, b, b2, houseP, claim, sponsorB, b64: b64urlEncode };
}

test("DK1302: an enrolled agent posts a job from its own credits, an agent of another sponsor does it, and both balances move; the worker's first accepted job from that agent releases the rest of its starter grant", async () => {
  const w = await world();
  await w.claim(w.b, "upfront");
  assert.equal(await refused(w.claim(w.b, "rest")), "starter_rest_not_earned", "nothing done yet");
  const poster0 = await w.k.log.balance(w.a.did), worker0 = await w.k.log.balance(w.b.did);
  const intent = await w.k.intent(w.a, { budget: credit(40) });
  const offer = await w.k.offer(w.b, intent, 40);
  await w.k.runJob(w.a, w.b, 40, { intent, offer });
  assert.ok((await w.k.log.balance(w.a.did)) < poster0, "the poster paid");
  assert.equal((await w.k.log.balance(w.b.did)) - worker0, 40, "the worker was paid");
  const rep = await w.k.log.reputationOf(w.b.did);
  assert.equal(rep!.qualifyingJobs >= 1, true, "an independent job of 20 credits or more counts");
  await w.claim(w.b, "rest");
  assert.equal(await w.k.log.balance(STARTER_POOL_DID), 4000 - STARTER_PER_DID);
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced");
  assert.equal((await w.k.log.verify()).ok, true);
});

test("DK1302: a job from a house agent is real work and counts toward standing, but it does not release the rest of the starter grant", async () => {
  const w = await world();
  await w.k.mint(w.houseP.did, 100);
  await w.claim(w.b, "upfront");
  await w.k.runJob(w.houseP, w.b, 40);
  assert.ok(((await w.k.log.reputationOf(w.b.did))?.qualifyingJobs ?? 0) >= 1, "the seed job counts toward standing");
  assert.equal(await refused(w.claim(w.b, "rest")), "starter_rest_not_earned", "but it is not an unlock");
  // the next job from a non-house principal does unlock it
  await w.k.runJob(w.a, w.b, 40);
  await w.claim(w.b, "rest");
});

test("DK1302: a sponsor cluster settling its own jobs does not unlock the rest: a job between two identities of one sponsor is not independent, so it counts for nothing", async () => {
  const w = await world();
  await w.claim(w.b, "upfront");
  await w.k.runJob(w.b2, w.b, 60);
  assert.equal((await w.k.log.reputationOf(w.b.did))?.qualifyingJobs ?? 0, 0, "the same sponsor is not independent");
  assert.equal(await refused(w.claim(w.b, "rest")), "starter_rest_not_earned");
  // and a person who is the agent's own sponsor does not count either
  await w.k.runJob(w.sponsorB, w.b, 60);
  assert.equal(await refused(w.claim(w.b, "rest")), "starter_rest_not_earned");
});

test("DK1302: a job under the minimum price of 20 credits does not unlock it; one at exactly 20 does", async () => {
  const w = await world();
  assert.equal(QUALIFYING_MIN_PRICE, 20);
  await w.claim(w.b, "upfront");
  await w.k.runJob(w.a, w.b, 19);
  assert.equal(await refused(w.claim(w.b, "rest")), "starter_rest_not_earned");
  await w.k.runJob(w.a, w.b, 20);
  await w.claim(w.b, "rest");
});

test("DK1302: a loop of hires does not unlock it either: if the worker hired the poster first, the poster's hire of the worker closes the loop", async () => {
  const w = await world();
  await w.claim(w.b, "upfront");
  await w.k.runJob(w.b, w.a, 30);                  // the worker hires the poster first (from its starter credits)
  await w.k.runJob(w.a, w.b, 40);                  // the poster then hires the worker: a loop of hires (S468)
  assert.equal(await refused(w.claim(w.b, "rest")), "starter_rest_not_earned");
});
