/**
 * The parts of market.md 5 and 7 the ranking and the board had left out (register row DK128; spec-delta S481): the rotation rule, the qualifying-job count in the class over 90 days, the price-outlier flag,
 * how many more jobs would count under the counterparty cap, and the qualifying-job feed for AgentRank. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EventLog, MemoryStore } from "../src/index.ts";
import { classQualifying, rankAgents, rotateAgents, type AgentFacts } from "../src/market.ts";
import { moreUnderCap } from "../src/qualifying.ts";
import { DAY, credit, jump, kit, market, mk, nowIso, operator, owner, refusedBy, resolver } from "./society-kit.ts";

const AT = "2026-11-20T00:00:00Z";
const facts = (did: string, over: Partial<AgentFacts> = {}): AgentFacts => ({ did, tier: 1, slashCount: 0, strikes: 0, qualifyingJobs: 0, acceptedJobs: 0, skills: ["code"], certificates: [], balance: 100, floorPermille: 0, sponsor: did, fleet: null, boardJobs: [], ...over });

async function world() {
  const k = await kit();
  await k.withPrices();
  const post = async (intentId: string, by: { did: string }) => {
    const deposit = await k.buy(by as never, "market.posting.deposit", 2);
    const r = mk("market_act", by as never, { act: "posting", intent: intentId, board: "main", expires: new Date(Date.parse("2026-11-01T00:00:00Z") + 600 * DAY).toISOString().replace(".000Z", "Z"), deposit });
    await k.log.append(r);
    return r.id;
  };
  return { ...k, post };
}

describe("the qualifying jobs of the job's own class over 90 days (market.md 5)", () => {
  test("the rank reads the weight of jobs in this class in the last 90 days, not the total: ten routine jobs do not outrank two skilled ones for a skilled job, and old jobs lapse", () => {
    const routineHand = facts("did:web:x:routine", { qualifyingJobs: 10, qualClass: Array.from({ length: 10 }, (_, i) => ({ at: `2026-11-${String(10 + i).padStart(2, "0")}T00:00:00Z`, c: "routine" as const, w: 1 })) });
    const skilledHand = facts("did:web:x:skilled", { qualifyingJobs: 4, qualClass: [{ at: "2026-11-10T00:00:00Z", c: "skilled", w: 2 }, { at: "2026-11-11T00:00:00Z", c: "skilled", w: 2 }] });
    assert.equal(classQualifying(routineHand, "skilled", AT), 0);
    assert.equal(classQualifying(skilledHand, "skilled", AT), 4);
    assert.equal(classQualifying(skilledHand, undefined, AT), 4, "no class named: the 90-day total");
    const forSkilled = rankAgents({ skills: ["code"], class: "skilled" }, [routineHand, skilledHand], "s", AT);
    assert.equal(forSkilled[0].agent, skilledHand.did);
    assert.match(forSkilled[0].reasons.join(" "), /qualifying jobs in skilled over 90 days 4/);
    assert.equal(rankAgents({ skills: ["code"], class: "routine" }, [routineHand, skilledHand], "s", AT)[0].agent, routineHand.did, "for a routine job the routine record counts");
    assert.equal(classQualifying(skilledHand, "skilled", "2027-03-01T00:00:00Z"), 0, "past 90 days the jobs lapse");
    assert.equal(classQualifying({ qualifyingJobs: 7 }, "skilled", AT), 7, "a hand-built fact without the list reads the total");
  });

  test("the log keeps the class and weight of each counted job beside the reputation row, and a replica rebuilt from the records has the same list", async () => {
    const w = await world();
    const worker = await w.agent("worker", await w.person("sponsor"), { skills: ["code"], funds: 50 });
    const clients = await Promise.all([1, 2, 3].map((i) => w.person(`client-${i}`, 5000)));
    const skilled = await w.intent(clients[0], { class: "skilled", budget: credit(80) });
    await w.runJob(clients[0], worker, 80, { intent: skilled, offer: await w.offer(worker, skilled, 80) });
    const routine = await w.intent(clients[1], { class: "routine", budget: credit(30) });
    await w.runJob(clients[1], worker, 30, { intent: routine, offer: await w.offer(worker, routine, 30) });
    const feed = await w.log.qualifyingFeed(worker.did);
    assert.deepEqual(feed.map((f) => [f.class, f.weight, f.price, f.counterparty, f.outcome]), [["skilled", 2, 80, clients[0].did, "accepted"], ["routine", 1, 30, clients[1].did, "accepted"]]);
    assert.ok(feed.every((f) => f.contract && f.verifier && f.at), "each entry names the contract, the verifier and the time");
    assert.equal((await w.log.reputationOf(worker.did))?.qualifyingJobs, 3, "the feed adds up to the standing it explains");
    const replica = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
    await replica.importRecords((await w.log.since(0, 5000)) as never);
    assert.deepEqual(await replica.qualifyingFeed(worker.did), feed);
    // A job that does not count (between linked accounts) is not in the feed.
    const sponsor2 = await w.person("sponsor2", 5000);
    const own = await w.agent("own", sponsor2, { skills: ["code"], funds: 50 });
    const selfJob = await w.intent(sponsor2, { class: "skilled", budget: credit(80) });
    await w.runJob(sponsor2, own, 80, { intent: selfJob, offer: await w.offer(own, selfJob, 80) });
    assert.deepEqual(await w.log.qualifyingFeed(own.did), [], "a job between an owner and its own agent settles and never counts, so it is not in the feed");
  });
});

describe("the rotation rule (market.md 5)", () => {
  test("rotateAgents puts the agent with the fewest board jobs in the last 7 days first, breaks a tie by the seed, and ignores skill", () => {
    const busy = facts("did:web:x:busy", { boardJobs: ["2026-11-18T00:00:00Z", "2026-11-19T00:00:00Z"], skills: ["code", "review"] });
    const idle = facts("did:web:x:idle", { skills: [] });
    const old = facts("did:web:x:old", { boardJobs: ["2026-10-01T00:00:00Z"] });
    const r = rotateAgents([busy, idle, old], "s", AT);
    assert.equal(r[2].agent, busy.did);
    assert.deepEqual(r.map((x) => x.agent).slice(0, 2).sort(), [idle.did, old.did].sort(), "a job from before the week is not counted");
    assert.match(r[2].reasons[0], /rotation: 2 board jobs in the last 7 days/);
    assert.deepEqual(rotateAgents([idle, old], "s", AT), rotateAgents([old, idle], "s", AT), "same input, same list");
  });

  test("the Market may assign by rotation, the log requires the next agent in the rotation and the list to reproduce, and the command proposes the same list", async () => {
    const w = await world();
    const poster = await w.person("poster", 4000);
    const a1 = await w.agent("rot-a", await w.person("s1"), { skills: ["review"], funds: 50 });
    const a2 = await w.agent("rot-b", await w.person("s2"), { skills: ["review"], funds: 50 });
    const assign = (posting: string, intent: string, agent: string, ranked: unknown, rule: string, seed = "seed") => mk("market_act", market, { act: "assignment", posting, intent, agent, rule, ranked, seed });
    const open = async () => {
      const intent = await w.intent(poster, { class: "routine", budget: credit(40), skills: ["review"] });
      const posting = await w.post(intent, poster);
      for (const a of [a1, a2]) await w.log.append(mk("market_act", a, { act: "bid", posting, offer: await w.offer(a, intent, 40) }));
      return { intent, posting };
    };
    const first = await open();
    const rankedFirst = await w.log.rankPosting(first.posting, "rotation", "seed");
    assert.equal(rankedFirst.length, 2);
    assert.match(rankedFirst[0].reasons[0], /rotation: 0 board jobs/);
    const winner = rankedFirst[0].agent, other = rankedFirst[1].agent;
    assert.equal(await refusedBy(w.log.append(assign(first.posting, first.intent, other, rankedFirst, "rotation"))), "assignment_not_rotation", "not the next agent in the rotation");
    assert.equal(await refusedBy(w.log.append(assign(first.posting, first.intent, winner, [...rankedFirst].reverse(), "rotation"))), "ranking_not_reproducible");
    await w.log.append(assign(first.posting, first.intent, winner, rankedFirst, "rotation"));
    // The next posting rotates to the other agent: the winner has now taken a board job this week.
    const second = await open();
    const rankedSecond = await w.log.rankPosting(second.posting, "rotation", "seed");
    assert.equal(rankedSecond[0].agent, other);
    assert.match(rankedSecond[1].reasons[0], /rotation: 1 board job in the last 7 days/);
    await w.log.append(assign(second.posting, second.intent, other, rankedSecond, "rotation"));
    // best_match is still a different rule over the same bidders.
    const third = await open();
    assert.equal(await refusedBy(w.log.append(assign(third.posting, third.intent, a1.did, await w.log.rankPosting(third.posting, "rotation", "seed"), "best_match"))), "ranking_not_reproducible", "a rotation list is not a best-match list");
    void jump; void nowIso;
  });
});

describe("the price-outlier flag and the counterparty-cap line on the board (market.md 5, 6)", () => {
  test("a posting priced more than three times the median of its class is flagged once the class has five postings; the others are not", async () => {
    const w = await world();
    const posters = await Promise.all([1, 2, 3, 4].map((i) => w.person(`p-${i}`, 4000)));
    const normal: string[] = [];
    for (let i = 0; i < 5; i++) normal.push(await w.post(await w.intent(posters[i % 4], { class: "routine", budget: credit(30) }), posters[i % 4]));
    const lone = await w.post(await w.intent(posters[0], { class: "routine", budget: credit(400) }), posters[0]);
    const board = await w.log.marketBoard();
    const flagged = board.filter((e) => e.priceOutlier);
    assert.deepEqual(flagged.map((e) => e.posting), [lone]);
    assert.deepEqual([flagged[0].priceOutlier!.classMedian, flagged[0].priceOutlier!.ratio], [30, 13.3]);
    assert.equal(board.filter((e) => e.class === "routine" && !e.priceOutlier).length, 5);
    // A class with fewer than five postings is not judged.
    const solo = await w.post(await w.intent(posters[1], { class: "critical", budget: credit(900) }), posters[1]);
    assert.equal((await w.log.marketBoard()).find((e) => e.posting === solo)?.priceOutlier, undefined);
  });

  test("the board tells an agent how many more jobs from this poster would count under the cap; moreUnderCap is the pure rule", async () => {
    assert.equal(moreUnderCap([], "p", AT), 2, "from nothing, two from one poster count and the third does not");
    assert.equal(moreUnderCap([{ p: "q", at: AT }], "p", AT), 2);
    assert.equal(moreUnderCap([{ p: "p", at: AT }, { p: "p", at: AT }], "p", AT), 0, "already at the cap with only this poster's jobs");
    assert.equal(moreUnderCap(Array.from({ length: 10 }, (_, i) => ({ p: `q${i}`, at: AT })), "p", AT) >= 5, true, "a varied record leaves room");
    const w = await world();
    const poster = await w.person("poster", 4000);
    const worker = await w.agent("capped", await w.person("cs"), { skills: ["code"], funds: 50 });
    const posting = await w.post(await w.intent(poster, { class: "routine", budget: credit(30), skills: ["code"] }), poster);
    const entry = (await w.log.marketBoard(worker.did)).find((e) => e.posting === posting)!;
    assert.equal(entry.forAgent?.counts.counts, true);
    assert.equal(entry.forAgent?.moreCounting, 2);
    for (let i = 0; i < 2; i++) { const intent = await w.intent(poster, { class: "routine", budget: credit(30) }); await w.runJob(poster, worker, 30, { intent, offer: await w.offer(worker, intent, 30) }); }
    assert.equal((await w.log.marketBoard(worker.did)).find((e) => e.posting === posting)?.forAgent?.moreCounting, 0, "two jobs from this poster have counted: the next one would not");
  });
});
