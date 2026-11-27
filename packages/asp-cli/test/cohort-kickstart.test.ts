// Rows ENG30, ENG33, ENG38, ENG44 (the kickstarter pack, slice 1): the first observation of every arrival lists at least three open invitations; a labelled house greeter writes to each arrival with a three-step
// first quest, and the steps done are counted; the credits are said to be a free grant and the first five writes cost nothing; the briefing and the welcome post name no study or experiment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIEFING } from "../src/cohort/agent.ts";
import { FREE_WRITES } from "../src/cohort/market.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("ENG30: the first observation of each arrival carries at least three short open invitations, the second carries none, and the invitations name the tool that does them", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-kick-inv-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    for (const x of [a, b]) {
      const first = await runTool(w.api, x, all, "look_map", {});
      assert.ok((first.invitations ?? 0) >= 3, `${x.handle}: ${first.invitations} invitations`);
      const block = /Open invitations \(none is required\):\n((?:- .*\n?)+)/.exec(first.text)![1]!.trim().split("\n");
      assert.ok(block.length >= 3 && block.every((l) => l.length < 260), "each invitation is one short line");
      assert.ok(block.some((l) => /offer_on_job sha256:/.test(l)) && block.some((l) => /forum_read_post sha256:/.test(l)) && block.some((l) => /course_enrol C-L2-1/.test(l)) && block.some((l) => /my_inbox/.test(l)));
      assert.doesNotMatch(first.text, /you must|you should|urgent|hurry/i, "no pressure");
      const second = await runTool(w.api, x, all, "look_charters", {});
      assert.equal(second.invitations, undefined);
      assert.doesNotMatch(second.text, /Open invitations/);
    }
  } finally { await w.close(); }
});

test("ENG38: the labelled house greeter writes to every arrival with the free-grant line and a three-step quest, and the steps an agent does are counted", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-kick-greet-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const inbox = await hall.inbox(a);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]!.from, "house-greeter");
    assert.match(inbox[0]!.text ?? "", /house greeter, a program, not another agent/);
    assert.match(inbox[0]!.text ?? "", /free grant of mock credits/);
    assert.match(inbox[0]!.text ?? "", /write in the forum, take a house job \(look_jobs\), or reply to this message. None of it is required/);
    assert.equal(hall.questSteps(a.did), 0);
    // step 1: a post
    const p = await call("forum_post", { title: "Hello", text: "I am new here and reading the house questions.", tags: [] });
    assert.equal(p.ok, true, p.text);
    assert.equal(p.quest, 1);
    assert.match(p.text, /First quest: step 1 done \(1 of 3\)/);
    // step 2: a house job, delivered and accepted by the house
    const board = JSON.parse(stripExtras((await call("look_jobs")).text)) as { result: { job: string; purpose: string; budget: number }[] };
    const job = board.result.find((j) => /most comments/.test(j.purpose))!;
    const o = await call("offer_on_job", { job: job.job, price: job.budget, plan: "I will read the feed and name it" });
    assert.equal(o.ok, true, o.text);
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
    const d = await call("deliver_job", { contract, summary: "The post with the most comments is the one about what a newcomer should do first." });
    assert.equal(d.quest, 2, d.text);
    // step 3: a reply to the greeter
    const r = await call("send_message", { to: "house-greeter", text: "I posted, did a job and I am replying.", reply_to: inbox[0]!.id });
    assert.equal(r.ok, true, r.text);
    assert.equal(r.quest, 3);
    assert.equal(hall.questSteps(a.did), 3);
    // the same step again is not counted twice
    const again = await call("forum_post", { title: "Another", text: "A second post from the same agent about something else.", tags: [] });
    assert.equal(again.quest, undefined);
  } finally { await w.close(); }
});

test("ENG33: the first five writes cost nothing (a posting deposit or tuition comes back and every write counts), the sixth costs what it costs, and the balance line says the credits are a free grant", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-kick-free-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    assert.match((await call("my_balance")).text, /100 mock credits: a free grant that is yours to use, and spending them is normal\. Offering on a job and delivering it cost nothing, and you are paid the price\. Credits are spent on learning \(courses\) and on opening places \(unlock\); neither is a score or a debt\. Your first 5 writes cost nothing\./);
    const j = await call("post_job", { purpose: "Check the README for broken links", budget: 20, criterion: "a list" });
    assert.equal(j.ok, true, j.text);
    assert.match(j.text, /Free: your first 5 writes cost nothing, so 2 credits came back to you \(4 free writes left\)\./);
    assert.equal(await hall.balance(a), 100, "the 2-credit deposit came back");
    for (let i = 0; i < 3; i++) assert.equal((await call("forum_post", { title: `Post ${i}`, text: `A different thing to say, number ${i}, about nothing in particular.`, tags: [] })).ok, true);
    assert.match((await call("forum_post", { title: "Post 3", text: "Another different thing, the fifth write of this agent.", tags: [] })).text, /\(0 left\)/);
    const sixth = await call("post_job", { purpose: "Count the open jobs on the board", budget: 10, criterion: "a number" });
    assert.equal(sixth.ok, true, sixth.text);
    assert.doesNotMatch(sixth.text, /Free:|first 5 writes/);
    assert.equal(await hall.balance(a), 100, "the sixth write was the first posted job: the house covers its 2-credit deposit (batch B2)");
    assert.equal(hall.freeWriteRefunds(), 2);
    assert.equal(FREE_WRITES, 5);
  } finally { await w.close(); }
});

test("ENG44: the briefing and the welcome post say the place is a simulated society with mock, free credits, and name no study or experiment; what they say is true", async () => {
  assert.doesNotMatch(BRIEFING, /\bstud(y|ies)\b|experiment|research subject|being tested|a test\b/i);
  assert.match(BRIEFING, /small simulated society/);
  assert.match(BRIEFING, /mock accounting entries, a free grant to every agent, and spending them is normal/);
  assert.match(BRIEFING, /Everything you do is recorded/, "true: the log records it");
  assert.match(BRIEFING, /You have no shell and no files/, "true: the tool set has neither");
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-kick-brief-")) });
  try {
    const feed = JSON.parse((await w.api.get("/forum/feed?sort=new&limit=20")).text) as { posts: { id: string; title: string }[] };
    const welcome = feed.posts.find((p) => p.title === "Welcome")!;
    assert.ok(welcome, "the welcome post is there");
    const post = (await w.api.get(`/forum/posts/${encodeURIComponent(welcome.id)}`)).text;
    assert.doesNotMatch(post, /\bstudy\b|experiment/i);
    assert.match(post, /simulated society/);
  } finally { await w.close(); }
});

test("the report counts the invitations of an agent's first observation and the steps of the first quest it did", async () => {
  const { analyse, renderReport } = await import("../src/cohort/observe.ts");
  const at = "2026-11-22T10:00:00Z";
  const base = { institution: "forum", scope: "write.forum", writes: true, chars: 5, ms: 1 };
  const ev = [
    { t: "start", at, run: "r", model: "m", provider: "p", agents: 1, capUsdPerAgent: 1, capUsdTotal: 1, minutes: 1 },
    { t: "agent", at, agent: "a1", did: "did:key:z", handle: "agent-01" },
    { t: "tool", at, agent: "a1", turn: 1, tool: "look_map", input: {}, ok: true, ...base, writes: false, invitations: 4 },
    { t: "tool", at, agent: "a1", turn: 2, tool: "forum_post", input: {}, ok: true, ...base, quest: 1 },
    { t: "tool", at, agent: "a1", turn: 3, tool: "deliver_job", input: {}, ok: true, ...base, quest: 2 },
  ] as never;
  const md = renderReport(analyse(ev)).markdown;
  assert.match(md, /agent-01 4 invitations, 2 of 3 steps/);
});
