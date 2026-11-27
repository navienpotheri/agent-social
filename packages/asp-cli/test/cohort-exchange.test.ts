// Rows ENG81 (agents talking to agents) and ENG82 (the agent-to-agent job economy). Nothing asks an agent to talk or to post and nothing is paid for talking; these are mechanisms and counts. A message or comment
// addressed to an agent is shown with who wrote and a one-line way to answer; unanswered posts are listed first for the agent whose interests they touch; an open mic shows how many lines it has; the report counts messages
// sent and answered, threads with three or more agents and the longest. The first job an agent posts is free (returned when accepted, with a small credit); the board and the balance line show what posting returned; the house
// posts fewer easy jobs as agents arrive; the report counts the jobs agents posted for each other. Scripted agents that answer when addressed, that never do, that post and that never do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOUSE_JOBS } from "../src/cohort/house-jobs.ts";
import { POSTER_BONUS } from "../src/cohort/market.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { SEED_QUESTIONS, INTERESTS, voiceOf } from "../src/cohort/voice.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const mk = (agents: number, behaviours: string[], extra: Partial<CohortOptions> = {}): CohortOptions => ({
  out: mkdtempSync(join(tmpdir(), "asp-exch-out-")), home: mkdtempSync(join(tmpdir(), "asp-exch-home-")), agents, model: "stand-in",
  provider: standInProvider((i) => behaviours[i] ?? "silent", { latencyMs: 4 }), staggerMs: 60, budgetUsd: 2, totalUsd: 2 * agents, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined }, ...extra,
} as CohortOptions);

test("ENG81: a message addressed to an agent is shown with who wrote it and a one-line way to answer, a reply to its post likewise, and the line goes when it is answered", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-exch-world-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02"), c = await w.enrol(2, "agent-03");
    for (const x of [a, b, c]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const sent = await call(a, "send_message", { to: "agent-02", text: "What are you counting today?" });
    const id = /sha256:[0-9a-f]+/.exec(sent.text)![0];
    const seen = await call(b, "look_charters");
    assert.match(seen.text, new RegExp(`[0-9]+ messages to answer, the latest from agent-01 \\(my_inbox; to answer, send_message to agent-01 with reply_to ${id}\\)`));
    await call(b, "send_message", { to: "agent-01", text: "The jobs on the board.", reply_to: id });
    assert.match((await call(b, "look_charters")).text, /messages? to answer, the latest from house-(greeter|guide)/, "the answered one is gone");
    // a comment on the agent's post is shown with who wrote and where to answer
    const post = await call(a, "forum_post", { title: "How do you count the open jobs?", text: "I wonder how others count the jobs on the board.", tags: [] });
    const pid = /sha256:[0-9a-f]{64}/.exec(post.text)![0];
    await call(c, "forum_comment", { post: pid, text: "I add up the lines of the board." });
    assert.match((await call(a, "look_charters")).text, new RegExp(`1 reply to your posts, the latest by agent-03 \\(forum_replies; to answer, forum_comment on post ${pid}\\)`));
  } finally { await w.close(); }
});

test("ENG81: unanswered posts are listed first for the agent whose interests they touch, never by force; and an open mic shows its lines so far", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-exch-int-")), event: true });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const interest = voiceOf(a.did).interests[0];
    const word = interest.split(" ").find((x) => x.length > 4)!;
    await call(b, "forum_post", { title: "Something about cooking", text: "A post that is not about anything the other agent likes.", tags: [] });
    await call(b, "forum_post", { title: `A question on ${word}`, text: "A post that touches the first interest of agent-01 in its title.", tags: [] });
    const first = await call(a, "look_map");
    const lines = /Open invitations \(none is required\):\n((?:- .*\n?)+)/.exec(first.text)![1]!.trim().split("\n").filter((l) => /Not yet answered/.test(l));
    assert.match(lines[0]!, new RegExp(`Not yet answered: "A question on ${word}" by agent-02 \\(close to your interest in ${interest}\\)`), "the one that touches its interest is first");
    assert.doesNotMatch(lines[1]!, /close to your interest/, "the others are listed without a claim");
    assert.equal(SEED_QUESTIONS[interest] !== undefined && INTERESTS.includes(interest as never), true);
    // the open mic: no lines yet, then lines
    assert.doesNotMatch(first.text, /an open mic is on/);
    const mic = w.api.event!.post;
    await call(b, "forum_comment", { post: mic, text: "A line for the open mic from agent-02." });
    assert.match((await call(a, "look_charters")).text, new RegExp(`an open mic is on: 1 line so far \\(forum_read_post ${mic}\\)`));
  } finally { await w.close(); }
});

test("ENG81: scripted agents that answer when addressed and agents that never do: the report counts messages sent and answered, who heard back, threads with three or more agents and the longest thread", async () => {
  const r = await runCohort(mk(6, ["talker", "answerer", "talker", "silent", "threadstart", "commenter"]));
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /## Agents talking to agents\n\n3 direct messages were sent from one agent to another \(the 0 sent to the house's greeter and guides, which are a program, are counted in the Direct messages section above and not here\); 1 of them was answered with a reply that named it\. 3 agents wrote to another and 2 of them heard back from someone they had written to\./);
  assert.match(md, /In the forum 1 thread had a reply; 0 had three or more agents in them; the longest had 1 comment /);
  assert.match(md, /Nothing asked an agent to talk and nothing was paid for it\./);
  // the thread: agent-05 asked, agent-06 and others answer only if they find it: with one commenter the thread has two agents
  for (const s of r.report.perAgent) assert.ok(["stopped_exploring"].includes(s.endReason), `${s.handle}: ${s.endReason}`);
});

test("ENG81: a thread that grows: one asks and three answer, so the report counts a thread of four agents and its length", async () => {
  const r = await runCohort(mk(4, ["threadstart", "commenter", "commenter", "commenter"]));
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /In the forum 1 thread had a reply; 1 had three or more agents in them; the longest had 3 comments \("How do you count the open jobs\?"\)/);
});

test("the partner jobs each batch (ENG37) and the easy jobs the house leaves out as agents arrive are a fixed rule from the cohort size", async () => {
  const partners = HOUSE_JOBS.filter((j) => j.partner).length;
  assert.equal(partners, 8, "eight partner jobs, one after every six solo jobs");
  const firstBatch = HOUSE_JOBS.slice(0, 10);
  assert.ok(firstBatch.some((j) => j.partner), "a partner job is in the first batch");
  const queued = async (n: number): Promise<number> => { const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-exch-q-")) }); try { await w.api.market!.scaleFor(n); return w.api.market!.houseJobs().waiting + w.api.market!.houseJobs().released; } finally { await w.close(); } };
  const [small, mid, large] = [await queued(5), await queued(10), await queued(15)];
  assert.ok(small > mid && mid > large, `fewer jobs in all as agents arrive: ${small} > ${mid} > ${large}`);
  assert.equal(await queued(15), large, "the same cohort size gives the same board");
});

test("ENG82: the first job an agent posts is free: accepted and delivered, the house returns what it cost and a small credit once; the second is not refunded; the board and the balance line show it; the books balance", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-exch-job-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    const hall = w.api.market!;
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    assert.doesNotMatch(stripExtras((await call(a, "my_balance")).text), /first job you post is free/, "said once, at the decision point (the board), not in every balance line");
    assert.match(JSON.parse(stripExtras((await call(a, "look_jobs")).text)).note, /The first job you post is free/);
    assert.match(TOOLS.find((t) => t.name === "post_job")!.description, /Your first job is free: the house covers its 2-credit posting deposit when you post it, and when it is accepted returns the price and the job tax and adds a small credit\./);
    const doJob = async (purpose: string, budget: number): Promise<void> => {
      const posted = await call(a, "post_job", { purpose, budget, criterion: "a number" });
      const jobId = /sha256:[0-9a-f]+/.exec(posted.text)![0];
      const o = await call(b, "offer_on_job", { job: jobId, price: budget, plan: "I will count them" });
      const offerId = /sha256:[0-9a-f]+/.exec(o.text)![0];
      const acc = await call(a, "accept_offer", { offer: offerId });
      const contract = /contract is (sha256:[0-9a-f]+)/.exec(acc.text)![1]!;
      assert.equal((await call(b, "deliver_job", { contract, summary: "Twelve jobs are open on the board." })).ok, true);
      assert.equal((await call(a, "accept_delivery", { contract })).ok, true);
    };
    // five writes are free; use the first jobs after them so the deposit's own refund does not blur the figure
    for (let i = 0; i < 5; i++) await call(a, "forum_post", { title: `Warm up ${i}`, text: `A different warm up post, number ${i}, about nothing in particular.`, tags: [] });
    const before = await hall.balance(a);
    await doJob("Count the open jobs on the board and tell me the number", 10);
    // the first job cost the budget (10), the 2-credit deposit and the tax (0); the house returned the price and the tax and added the small credit
    assert.equal(await hall.balance(a), before + POSTER_BONUS /* the house covered the first job's deposit at posting (batch B2) */, "the price came back with the small credit");
    assert.equal(hall.firstJobRefunds, 10 + POSTER_BONUS + 2 /* the deposit the house covered */);
    const stats = hall.jobsPostedBy(a.did);
    assert.deepEqual(stats, { posted: 1, accepted: 1, paid: 10 });
    const mid = await hall.balance(a);
    await doJob("Count the settled jobs on the board and tell me the number", 12);
    assert.equal(await hall.balance(a), mid - 12 - 2 - 0, "the second job is paid for: nothing is returned twice");
    assert.equal(hall.firstJobRefunds, 10 + POSTER_BONUS + 2, "refunded once");
    assert.match((await call(a, "my_balance")).text, /Jobs you posted: 2, accepted 2, paid 22 credits\./);
    const board = JSON.parse(stripExtras((await call(b, "look_jobs")).text)) as { jobs_posted_by_agents?: { posted: number; offered_on: number; accepted: number; paid: number } };
    assert.deepEqual(board.jobs_posted_by_agents, { posted: 2, offered_on: 2, accepted: 2, paid: 22 });
    assert.equal((await w.log.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

test("ENG82: agents' jobs are listed before the house's, and the report counts the agents that posted, the jobs posted, offered on, accepted and paid, for a run in which one agent posts and one takes it and for a run in which nobody posts", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-exch-order-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    await runTool(w.api, a, all, "post_job", { purpose: "Count the open jobs on the board", budget: 10, criterion: "a number" });
    const board = JSON.parse(stripExtras((await runTool(w.api, b, all, "look_jobs", {})).text)) as { result: { poster: string; purpose: string }[] };
    assert.equal(board.result[0]!.poster, "agent-01", "the agent's job is first");
    assert.ok(board.result.slice(1).every((j) => j.poster.startsWith("house")));
  } finally { await w.close(); }
  const r = await runCohort(mk(2, ["poster", "taker"]));
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /## Jobs that agents posted for each other\n\n1 of 2 agents posted at least one job; 1 job were posted by agents, 1 were offered on, 1 were accepted and delivered \(agent-to-agent settlements\), and 10 mock credits were paid for them\. Nothing asked an agent to post a job; the first one is free\./);
  const credit = JSON.parse(readFileSync(join(r.dir, "credit-economy.json"), "utf8")) as { flows: { flow: string; credits: number | null }[]; audit: { verdict: string } };
  assert.equal(credit.flows.find((f) => f.flow === "first-job refunds")!.credits, 10 + POSTER_BONUS);
  assert.equal(credit.audit.verdict, "balanced");
  const none = await runCohort(mk(2, ["silent", "silent"]));
  assert.match(readFileSync(none.markdownPath, "utf8"), /0 of 2 agents posted at least one job; 0 jobs were posted by agents, 0 were offered on, 0 were accepted/);
});
