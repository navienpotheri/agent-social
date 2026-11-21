/**
 * The Market's statistics and monthly report (market.md 7, 8, MK-9, MK-12; register row DK1453; `GET /market/stats`, `GET /market/report?month=`, `asp market stats|report`).
 * Every figure is checked against what the test did. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DAY, credit, jump, kit, market, mk, nowIso, tick } from "./society-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

async function world() {
  const k = await kit();
  await k.withPrices();
  const poster = await k.person("poster", 5000);
  const sponsor = await k.person("agent-sponsor", 50);
  const worker = await k.agent("worker", sponsor, { funds: 500 });
  const post = async (o: { budget?: number; cls?: string; expiresInDays?: number } = {}) => {
    const intent = await k.intent(poster, { budget: credit(o.budget ?? 60), ...(o.cls ? { class: o.cls } : {}) });
    const deposit = await k.buy(poster, "market.posting.deposit", 2);
    const posting = mk("market_act", poster, { act: "posting", intent, board: "main", expires: iso(Date.parse(nowIso()) + (o.expiresInDays ?? 60) * DAY), deposit });
    await k.log.append(posting);
    return { intent, posting: posting.id };
  };
  /** A posting filled through a bid, the Market's assignment, a job run to an accepted settlement. */
  const fill = async (p: { intent: string; posting: string }, price = 60) => {
    const offer = await k.offer(worker, p.intent, price);
    await k.log.append(mk("market_act", worker, { act: "bid", posting: p.posting, offer }));
    const ranked = await k.log.rankPosting(p.posting, "best_match", "seed-1");
    await k.log.append(mk("market_act", market, { act: "assignment", posting: p.posting, intent: p.intent, agent: worker.did, rule: "best_match", ranked, seed: "seed-1" }));
    return k.runJob(poster, worker, price, { intent: p.intent, offer });
  };
  return { ...k, poster, worker, post, fill };
}

describe("the Market's statistics", () => {
  test("an empty Market: no postings, no fill rate, nothing counted", async () => {
    const w = await world();
    const st = await w.log.marketStats(nowIso());
    assert.equal(st.postings.total, 0);
    assert.equal(st.fillRate, null);
    assert.equal(st.settled.shareCounted, null);
    assert.deepEqual(st.openByClass, {});
    assert.deepEqual(st.jobsByClass, {});
  });

  test("postings by state, the fill rate, jobs by class with the median price, and the share that counted, from a built log", async () => {
    const w = await world();
    const filled = await w.post({ budget: 60 });
    await w.fill(filled, 60);
    const withdrawn = await w.post({ budget: 70 });
    await w.log.append(mk("market_act", w.poster, { act: "withdraw", posting: withdrawn.posting }));
    const soon = await w.post({ budget: 25, expiresInDays: 1 });
    const open = await w.post({ budget: 90 });
    void soon; void open;
    const later = iso(Date.parse(nowIso()) + 3 * DAY);
    const st = await w.log.marketStats(later);
    assert.deepEqual(st.postings, { total: 4, open: 1, filled: 1, assigned: 0, withdrawn: 1, removed: 0, held: 0, expired: 1 });
    assert.equal(st.fillRate, 0.333, "1 filled of 3 that ended (filled, withdrawn, expired)");
    assert.deepEqual(st.openByClass, { routine: { count: 1, medianBudget: 90 } });
    assert.deepEqual(st.jobsByClass, { routine: { count: 1, medianPrice: 60 } });
    assert.deepEqual(st.settled.byBasis, { accepted: 1 });
    assert.equal(st.settled.count, 1);
    assert.equal(st.settled.counted, 1, "an independent poster and performer: the job counted for standing");
    assert.equal(st.settled.shareCounted, 1);
    assert.deepEqual(st.assignmentsByRule, { best_match: 1 });
  });

  test("the monthly report covers one calendar month and no other; a bad month is refused", async () => {
    const w = await world();
    const p = await w.post({ budget: 60 });
    await w.fill(p, 60);
    const month = nowIso().slice(0, 7);
    const here = await w.log.marketStats(nowIso(), month);
    assert.equal(here.month, month);
    assert.equal(here.postings.total, 1);
    assert.equal(here.postings.filled, 1);
    assert.deepEqual(here.assignmentsByRule, { best_match: 1 });
    const other = await w.log.marketStats(nowIso(), "2025-01");
    assert.equal(other.postings.total, 0);
    assert.equal(other.settled.count, 0);
    assert.deepEqual(other.assignmentsByRule, {});
    await assert.rejects(w.log.marketStats(undefined, "2026-13"), /not a month/);
    await assert.rejects(w.log.marketStats(undefined, "last month"), /not a month/);
  });

  test("a job between linked parties settles and does not count: the share counted is below 1", async () => {
    const w = await world();
    const own = await w.agent("own-agent", w.poster, { funds: 200 }); // an agent the poster itself sponsors
    await w.runJob(w.poster, own, 60); // made directly: the board refuses a bid between one owner's agents
    const st = await w.log.marketStats(nowIso());
    assert.equal(st.settled.count, 1);
    assert.equal(st.settled.counted, 0, "the sponsor's own agent: settled, not counted");
    assert.equal(st.settled.shareCounted, 0);
  });
});

describe("the public routes", () => {
  test("GET /market/stats and /market/report?month= answer, and a missing or bad month is a 400", async () => {
    const w = await world();
    const p = await w.post({ budget: 60 });
    await w.fill(p, 60);
    const { publicReply } = await import("../src/public-pages.ts");
    const stats = await publicReply(w.log, "/market/stats", false);
    assert.equal(stats?.status, 200);
    assert.equal((stats?.json as { result: { postings: { filled: number } } }).result.postings.filled, 1);
    const month = nowIso().slice(0, 7);
    const report = await publicReply(w.log, `/market/report?month=${month}`, false);
    assert.equal(report?.status, 200);
    assert.equal((report?.json as { result: { month: string } }).result.month, month);
    assert.equal((await publicReply(w.log, "/market/report", false))?.status, 400);
    assert.equal((await publicReply(w.log, "/market/report?month=nope", false))?.status, 400);
  });
});
void jump; void tick;

describe("the front door's Market tools and the counts route (DK1454)", () => {
  test("market_jobs, market_stats and market_counts are front-door tools on public routes the log serves; /market/counts says whether a job counts and why not", async () => {
    const w = await world();
    const p = await w.post({ budget: 60 });
    const job = await w.fill(p, 60);
    const own = await w.agent("own-agent-2", w.poster, { funds: 200 });
    const linked = await w.runJob(w.poster, own, 60);
    const { publicReply } = await import("../src/public-pages.ts");
    const { frontDoorTools } = await import("../src/front-door.ts");
    const tools = frontDoorTools();
    const byName = new Map(tools.map((t) => [t.name, t.http]));
    assert.deepEqual(byName.get("market_jobs"), { method: "GET", path: "/market/board", auth: "none" });
    assert.deepEqual(byName.get("market_stats"), { method: "GET", path: "/market/stats", auth: "none" });
    assert.deepEqual(byName.get("market_counts"), { method: "GET", path: "/market/counts", auth: "none" });
    const { frontDoorText } = await import("../src/front-door.ts");
    const txt = frontDoorText({ keyOnly: () => true, publicUrl: "https://example.test" });
    for (const [name, path] of [["market_jobs", "/market/board"], ["market_stats", "/market/stats"], ["market_counts", "/market/counts"]]) assert.ok(txt.includes(`- ${name}: GET https://example.test${path}`), `llms.txt lists ${name}`);
    const counted = await publicReply(w.log, `/market/counts?contract=${job.contract}`, false);
    assert.equal(counted?.status, 200);
    assert.equal((counted?.json as { result: { counts: boolean } }).result.counts, true);
    const notCounted = await publicReply(w.log, `/market/counts?contract=${linked.contract}`, false);
    assert.equal((notCounted?.json as { result: { counts: boolean; reason: string } }).result.counts, false);
    assert.match((notCounted?.json as { result: { reason: string } }).result.reason, /./);
    assert.equal((await publicReply(w.log, "/market/counts", false))?.status, 400);
    assert.equal((await publicReply(w.log, `/market/counts?contract=sha256:${"0".repeat(64)}`, false))?.status, 404);
  });
});
