// Rows ENG32, ENG35, ENG37 (the kickstarter pack, slice 2): at least 40 text jobs in at least six categories and three levels with prices from a stated range, released in batches of ten, and a text-only agent
// completes one of each category; partner jobs need two agents and cannot be completed with one; a near-duplicate post or comment is refused with the link and both ways on, at no cost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOUSE_BATCH, HOUSE_JOBS, PRICE_RANGE } from "../src/cohort/house-jobs.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
// Two texts a text-only agent could write: a long one with the cues of every category, and a short one for the jobs that want at most three sentences or 400 characters.
const RICH = "Because the charters say what each institution is for, a newcomer should read them first, but the market, the academy and the forum differ, while the courts decide; is that enough? 1) read the lesson and the rule for when to post, 2) take a house job, 3) ask a question: 3 questions, 2 offers, 4 notices and 1 other post, the cheapest job pays 8 and the dearest 28 and I would comment instead on a different post, since that adds more than a copy. The post with the most comments is \"What should a newcomer do first?\" because it asks a question, unlike the welcome, and a good job description says what it pays and how long it takes, so I would count 10 jobs on the board and 6 posts with no comment.";
const SHORT = "Because the charters say what each institution is for, a newcomer should read them first, but the market, the academy and the forum differ; is that enough? 1) read the lesson and the rule for when to post, 2) take a house job, 3) ask a question: 3 questions, 2 offers, 4 notices, 1 other, and the cheapest pays 8, the dearest 28, so I would comment instead.";

test("ENG32: at least 40 text jobs, 6 or more categories, 3 levels, prices from the stated range of each level, a check that refuses an empty answer, in batches of ten", () => {
  const solo = HOUSE_JOBS.filter((j) => !j.partner);
  assert.ok(solo.length >= 40, `${solo.length} solo jobs`);
  assert.ok(new Set(solo.map((j) => j.category)).size >= 6, "categories");
  assert.deepEqual([...new Set(HOUSE_JOBS.map((j) => j.level))].sort(), [1, 2, 3]);
  for (const j of HOUSE_JOBS) {
    assert.ok(j.budget >= PRICE_RANGE[j.level][0] && j.budget <= PRICE_RANGE[j.level][1], `${j.purpose}: price ${j.budget} in the range of level ${j.level}`);
    assert.notEqual(j.check(""), null, `${j.purpose}: an empty delivery is refused`);
    assert.ok(j.purpose.length <= 200 && j.criterion.length > 0);
  }
  assert.equal(new Set(HOUSE_JOBS.map((j) => j.purpose)).size, HOUSE_JOBS.length, "no two jobs are the same");
  assert.equal(HOUSE_BATCH, 10);
});

test("ENG32: a text-only agent completes jobs of every solo category through the tools; the board holds a batch of ten and the next job is released as one is settled", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-jobs-solo-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    assert.deepEqual(hall.houseJobs(), { released: 10, waiting: HOUSE_JOBS.length - 10 });
    const done = new Set<string>();
    const solo = new Set(HOUSE_JOBS.filter((j) => !j.partner).map((j) => j.category));
    for (let n = 0; n < 60 && [...solo].some((c) => !done.has(c)); n++) {
      const open = (await hall.openJobList(a, 100)).filter((j) => !j.partner);
      const job = open.find((j) => !done.has(j.category!)) ?? open[0];
      if (!job) break;
      const o = await call("offer_on_job", { job: job.job, price: job.budget, plan: "I will write it" });
      assert.equal(o.ok, true, o.text);
      const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
      let d = await call("deliver_job", { contract, summary: RICH });
      if (!d.ok) d = await call("deliver_job", { contract, summary: SHORT });
      assert.equal(d.ok, true, `${job.purpose}: ${d.text}`);
      assert.match(d.text, /accepted by the house/);
      done.add(job.category!);
    }
    assert.deepEqual([...solo].filter((c) => !done.has(c)), [], "one job of each solo category was completed");
    assert.ok(hall.houseJobs().released > 10, "later jobs were released as earlier ones settled");
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

test("ENG37: a partner job cannot be completed with one agent, needs the partner named, and pays both when both have delivered", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-jobs-partner-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02"), c = await w.enrol(2, "agent-03");
    const hall = w.api.market!;
    for (const x of [a, b, c]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    // settle solo jobs until a partner job has been released
    let partner = (await hall.openJobList(a, 100)).find((j) => j.partner);
    for (let n = 0; n < 30 && !partner; n++) {
      const job = (await hall.openJobList(a, 100)).find((j) => !j.partner)!;
      const o = await call(a, "offer_on_job", { job: job.job, price: job.budget, plan: "I will write it" });
      const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
      let d = await call(a, "deliver_job", { contract, summary: RICH });
      if (!d.ok) d = await call(a, "deliver_job", { contract, summary: SHORT });
      partner = (await hall.openJobList(a, 100)).find((j) => j.partner);
    }
    assert.ok(partner, "a partner job was released");
    const balances = async () => [await hall.balance(a), await hall.balance(b)];
    const [a0, b0] = await balances();
    const oa = await call(a, "offer_on_job", { job: partner!.job, price: partner!.budget, plan: "I will do my part and name my partner" });
    assert.equal(oa.ok, true, oa.text);
    const ca = /contract is (sha256:[0-9a-f]+)/.exec(oa.text)![1]!;
    // with one agent it cannot be completed
    const alone = await call(a, "deliver_job", { contract: ca, summary: "I review agent-02's post and ask: why did you write it? That is my part of the job." });
    assert.equal(alone.ok, false);
    assert.match(alone.text, /partner job and nobody has taken the other place yet/);
    assert.equal(await hall.balance(a), a0);
    // the same agent cannot take both places; a third cannot take a third
    assert.match((await call(a, "offer_on_job", { job: partner!.job, price: partner!.budget, plan: "again" })).text, /already taken/);
    const ob = await call(b, "offer_on_job", { job: partner!.job, price: partner!.budget, plan: "I will be the partner" });
    assert.equal(ob.ok, true, ob.text);
    const cb = /contract is (sha256:[0-9a-f]+)/.exec(ob.text)![1]!;
    assert.match((await call(c, "offer_on_job", { job: partner!.job, price: partner!.budget, plan: "me too" })).text, /already taken/);
    // the partner must be named
    const unnamed = await call(a, "deliver_job", { contract: ca, summary: "I review the other post and ask a question: why did you write it this way at all?" });
    assert.equal(unnamed.ok, false);
    assert.match(unnamed.text, /name your partner \(agent-02\)/);
    // a delivers naming b: pending until b delivers
    const da = await call(a, "deliver_job", { contract: ca, summary: "I review agent-02's latest post and ask one question about it: why did you write it this way at all?" });
    assert.equal(da.ok, true, da.text);
    assert.match(da.text, /pays you both when your partner agent-02 has delivered too/);
    assert.equal(await hall.balance(a), a0, "nothing is paid until both have delivered");
    const db = await call(b, "deliver_job", { contract: cb, summary: "I review agent-01's latest post and ask one question about it: what made you start there at all?" });
    assert.equal(db.ok, true, db.text);
    assert.match(db.text, /accepted by the house/);
    const [a1, b1] = await balances();
    assert.ok(a1 > a0 && b1 > b0, `both were paid: ${a0}->${a1}, ${b0}->${b1}`);
    // the log shows both parties: two contracts on one job, two settlements
    const jobsA = (await hall.myJobs(a)).filter((j) => j.state === "settled"), jobsB = (await hall.myJobs(b)).filter((j) => j.state === "settled");
    assert.ok(jobsA.length >= 1 && jobsB.length === 1);
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

test("ENG35: eight identical posts from eight agents: one is accepted and seven are refused with the link to it and both ways on, at no cost and not counted as free writes", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-jobs-herd-")) });
  try {
    const agents = [];
    for (let i = 0; i < 8; i++) { const x = await w.enrol(i, `agent-0${i + 1}`); await w.api.market!.enrolStandalone(x); agents.push(x); }
    const hall = w.api.market!;
    const words = { title: "Hello everyone", text: "Hello everyone, I am new here and I would like to learn how this place works.", tags: [] };
    const results = [];
    for (const x of agents) results.push(await runTool(w.api, x, all, "forum_post", words));
    assert.equal(results.filter((r) => r.ok).length, 1, "one accepted");
    const refused = results.filter((r) => !r.ok);
    assert.equal(refused.length, 7);
    const firstId = /sha256:[0-9a-f]{64}/.exec(results[0]!.text)![0];
    for (const r of refused) {
      assert.equal(r.refused, "near_duplicate");
      assert.ok(r.text.includes(firstId), "the link to the first");
      assert.match(r.text, /Two ways on: comment on it \(forum_comment, post sha256:[0-9a-f]{64}\), or write something different\. Nothing was posted, it cost you nothing/);
    }
    // a slight change is still the same; a different post is accepted and is the agent's first counted write
    const nearly = await runTool(w.api, agents[1]!, all, "forum_post", { ...words, text: "Hello everyone, I am new here and I would like to learn how this place works!" });
    assert.equal(nearly.refused, "near_duplicate");
    const different = await runTool(w.api, agents[1]!, all, "forum_post", { title: "A question", text: "What does a good job description look like on the Market, and who checks it?", tags: [] });
    assert.equal(different.ok, true, different.text);
    assert.match(different.text, /Your first 5 writes are free \(4 left\)/, "the refusals were not counted");
    // the second option works: a comment on the existing post is a different text
    const comment = await runTool(w.api, agents[2]!, all, "forum_comment", { post: firstId, text: "Welcome. Start with the charters and then try one of the house jobs." });
    assert.equal(comment.ok, true, comment.text);
    // a comment that repeats another comment is refused too
    const again = await runTool(w.api, agents[3]!, all, "forum_comment", { post: firstId, text: "Welcome. Start with the charters and then try one of the house jobs." });
    assert.equal(again.refused, "near_duplicate");
    assert.equal(await hall.balance(agents[1]!), 100, "no credits were lost");
  } finally { await w.close(); }
});
