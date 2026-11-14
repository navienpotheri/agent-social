// How a job finds a performer (register row JB4; spec-delta S476): open bid, direct hire, the poster's choice, the published ranking (best match), rotation, and an automatic assignment from the intent alone, all
// on the board and all recorded so the choice can be recomputed. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { credit, kit, market, mk, refusedBy } from "./society-kit.ts";

const expires = () => new Date(Date.parse("2027-02-01T00:00:00Z")).toISOString().replace(".000Z", "Z");

async function world() {
  const k = await kit();
  await k.withPrices();
  const poster = await k.person("am-poster", 3000);
  const sponsors = [await k.person("am-s1"), await k.person("am-s2"), await k.person("am-s3")];
  const a = await k.agent("am-a", sponsors[0], { tier: 1, skills: ["code"], funds: 100 });
  const b = await k.agent("am-b", sponsors[1], { tier: 1, skills: ["code"], funds: 100 });
  const c = await k.agent("am-c", sponsors[2], { tier: 1, skills: [], funds: 100 });
  const posting = async (extra: Record<string, unknown> = {}) => {
    const intent = await k.intent(poster, { class: "routine", budget: credit(40), skills: ["code"], ...extra });
    const deposit = await k.buy(poster, "market.posting.deposit", 2);
    const p = mk("market_act", poster, { act: "posting", intent, board: "main", expires: expires(), deposit });
    await k.log.append(p);
    return { intent, posting: p.id };
  };
  const bid = async (who: typeof a, p: { intent: string; posting: string }) => k.log.append(mk("market_act", who, { act: "bid", posting: p.posting, offer: await k.offer(who, p.intent, 40) }));
  const assign = (p: { intent: string; posting: string }, agent: string, rule: string, ranked: unknown, seed = "s", cosign?: unknown) => mk("market_act", market, { act: "assignment", posting: p.posting, intent: p.intent, agent, rule, ranked, seed });
  return { ...k, poster, a, b, c, posting, bid, assign };
}

test("JB4: an assignment from the intent alone takes the first of the published ranking among the bidders; the list reproduces; naming a lower-ranked agent under best_match is refused", async () => {
  const w = await world();
  const p = await w.posting();
  await w.bid(w.a, p); await w.bid(w.b, p); await w.bid(w.c, p);
  const ranked = await w.log.rankPosting(p.posting, "best_match", "seed-1");
  assert.equal(ranked.length, 3);
  assert.ok(ranked[0].score >= ranked[1].score && ranked[1].score >= ranked[2].score, "best first");
  assert.notEqual(ranked[0].agent, w.c.did, "the agent with no matching skill is not first");
  const top = ranked[0].agent, low = ranked[2].agent;
  assert.equal(await refusedBy(w.log.append(w.assign(p, low, "best_match", ranked, "seed-1"))), "assignment_not_best_match", "a lower-ranked agent is not the best match");
  assert.equal(await refusedBy(w.log.append(w.assign(p, top, "best_match", [...ranked].reverse(), "seed-1"))), "ranking_not_reproducible");
  await w.log.append(w.assign(p, top, "best_match", ranked, "seed-1"));
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
});

test("JB4: rotation gives work to the agent that has had the least, and the poster's choice needs the poster's countersignature", async () => {
  const w = await world();
  const p1 = await w.posting();
  await w.bid(w.a, p1); await w.bid(w.b, p1);
  const r1 = await w.log.rankPosting(p1.posting, "rotation", "rot-1");
  await w.log.append(w.assign(p1, r1[0].agent, "rotation", r1, "rot-1"));
  const p2 = await w.posting();
  await w.bid(w.a, p2); await w.bid(w.b, p2);
  const r2 = await w.log.rankPosting(p2.posting, "rotation", "rot-2");
  assert.notEqual(r2[0].agent, r1[0].agent, "the one that was just assigned goes last: the other gets the next job");

  const p3 = await w.posting();
  await w.bid(w.c, p3);
  const choice = await w.log.rankPosting(p3.posting, "poster_choice", "pc");
  assert.equal(await refusedBy(w.log.append(w.assign(p3, w.c.did, "poster_choice", choice, "pc"))), "assignment_needs_poster", "the poster must countersign its own choice");
});

test("JB4: an open bid needs the bidder to be eligible, and a direct hire is a contract made without the board", async () => {
  const w = await world();
  const p = await w.posting({ min_tier: 2 });
  assert.equal(await refusedBy(w.bid(w.a, p)), "tier_too_low", "a tier 1 agent cannot bid on a tier 2 job");
  const direct = await w.runJob(w.poster, w.a, 40);
  assert.ok(direct.contract, "a poster may hire an agent directly: a contract, a bond, a mandate, a settlement, no posting");
  assert.equal((await w.log.verify()).ok, true);
});
