// The job board (register row JB1; spec-delta S471): open jobs listed by class, budget and skill, searchable by people and agents (a filter and words in the purpose), with the poster's standing shown beside each.
// Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { credit, DAY, kit, mk } from "./society-kit.ts";
import { publicReply } from "../src/public-pages.ts";

const day = (n: number) => new Date(Date.parse("2026-11-01T00:00:00Z") + n * DAY).toISOString().replace(".000Z", "Z");

async function board() {
  const k = await kit();
  await k.withPrices();
  const poster = await k.person("jb-poster", 2000), other = await k.person("jb-other", 2000);
  const post = async (by: typeof poster, over: Record<string, unknown>) => {
    const intent = await k.intent(by, over);
    const deposit = await k.buy(by, "market.posting.deposit", 2);
    await k.log.append(mk("market_act", by, { act: "posting", intent, board: "main", expires: day(50), deposit }));
    return intent;
  };
  await post(poster, { purpose: "Review the payment retries pull request", class: "routine", budget: credit(30), skills: ["review"] });
  await post(poster, { purpose: "Refactor the billing module", class: "skilled", budget: credit(90), skills: ["code"] });
  await post(other, { purpose: "Audit the signup flow for abuse", class: "critical", budget: credit(250), skills: ["review", "security"], min_tier: 2 });
  return { k, poster, other };
}

test("JB1: the board lists open jobs by class, budget and skill and can be searched by each and by words in the purpose, with every filter narrowing and none hiding what should show", async () => {
  const { k } = await board();
  const all = await k.log.marketBoard();
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((e) => [e.class, e.budget]).sort(), [["critical", 250], ["routine", 30], ["skilled", 90]]);
  const only = async (f: Parameters<typeof k.log.marketBoard>[2]) => (await k.log.marketBoard(undefined, undefined, f)).map((e) => e.purpose);
  assert.deepEqual(await only({ class: "skilled" }), ["Refactor the billing module"]);
  assert.deepEqual((await only({ skill: "review" })).sort(), ["Audit the signup flow for abuse", "Review the payment retries pull request"]);
  assert.deepEqual(await only({ minBudget: 80, maxBudget: 100 }), ["Refactor the billing module"], "a budget range");
  assert.deepEqual(await only({ maxMinTier: 1 }), ["Review the payment retries pull request", "Refactor the billing module"], "jobs a tier 1 agent may take");
  assert.deepEqual(await only({ text: "BILLING" }), ["Refactor the billing module"], "words in the purpose, any case");
  assert.deepEqual(await only({ skill: "review", class: "routine", text: "retries" }), ["Review the payment retries pull request"], "filters combine");
  assert.deepEqual(await only({ skill: "nothing" }), []);
  assert.equal((await only({})).length, 3, "an empty filter shows everything");
});

test("JB1: each job shows who is asking: the poster's standing and how many jobs they have posted", async () => {
  const { k, poster, other } = await board();
  const entries = await k.log.marketBoard();
  const of = (did: string) => entries.filter((e) => e.poster === did);
  assert.equal(of(poster.did).length, 2);
  assert.ok(of(poster.did).every((e) => e.posterStanding?.jobsPosted === 2 && e.posterStanding.kind === "person" && e.posterStanding.slashes === 0));
  assert.equal(of(other.did)[0].posterStanding?.jobsPosted, 1);
  // A poster with a settled job shows it.
  const worker = await k.agent("jb-worker", await k.person("jb-ws"), { tier: 1, funds: 100 });
  await k.runJob(poster, worker, 100);
  const after = (await k.log.marketBoard()).find((e) => e.poster === poster.did)!;
  assert.ok(after.posterStanding!.jobsPosted >= 2);
});

test("JB1: the public board takes the same filters in the address, and an agent's own view still ranks eligible jobs first", async () => {
  const { k } = await board();
  const res = async (qs: string) => ((await publicReply(k.log, `/market/board${qs}`, false))!.json as { result: { purpose: string; posterStanding: unknown }[] }).result;
  assert.equal((await res("")).length, 3);
  assert.deepEqual((await res("?class=critical")).map((e) => e.purpose), ["Audit the signup flow for abuse"]);
  assert.deepEqual((await res("?min_budget=80&max_budget=100")).map((e) => e.purpose), ["Refactor the billing module"]);
  assert.deepEqual((await res("?q=signup")).map((e) => e.purpose), ["Audit the signup flow for abuse"]);
  assert.ok((await res("?skill=code"))[0].posterStanding, "the poster's standing is in the public answer");
  const junior = await k.agent("jb-junior", await k.person("jb-js"), { tier: 1, skills: ["review"], funds: 100 });
  const mine = await k.log.marketBoard(junior.did);
  assert.equal(mine[0].forAgent?.eligible, true);
  assert.equal(mine.at(-1)!.forAgent?.eligible, false, "the tier 2 job is last for a tier 1 agent");
});
