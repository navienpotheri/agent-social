// Rows UC-2190..: what the owner's first 25-agent run showed did not move agents, and the smallest changes the data supports. Every line is a plain fact, none is required, none is paid for: (1) the board says
// where posting a job leads and what the first one returns; (2) a two-agent job names the partner and how to reach them; (3) a job that names a place says how to look at it; (4) a house job another agent was just
// shown near the top of its list is left off yours for a minute, so agents that look together are not offered the same jobs; (5) a refused over-long text says by how much; (6) the report counts messages to the
// house's greeter and guides apart from messages to other agents, in every section. Scripted stand-ins; whether real models move is for a real run to show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kindsReport, renderKinds } from "../src/cohort/kinds.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const all = new Set(TOOLS.map((t) => t.scope));
type Row = { job: string; poster: string; purpose: string };
const board = async (w: Awaited<ReturnType<typeof bootWorld>>, who: Parameters<typeof runTool>[1]): Promise<{ note: string; result: Row[] }> => JSON.parse(stripExtras((await runTool(w.api, who, all, "look_jobs", {})).text));

test("a house job one agent was just shown near the top is left off the list of the next agent for a minute; the first agent still sees them; after the minute they come back", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mv-hold-")) });
  w.api.foldRepeats = false; // these tests read the same answer twice on purpose
  try {
    const hall = w.api.market!;
    hall.slotsOn = true;
    await hall.scaleFor(10);
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const first = await board(w, a);
    const mine = first.result.filter((x) => x.poster.startsWith("house") && !/Partner job/.test(x.purpose)).slice(0, 3).map((x) => x.job);
    assert.equal(mine.length, 3);
    const second = await board(w, b);
    assert.equal(second.result.some((x) => x.job === mine[0]), false, "the top job is held for agent-01");
    assert.match(second.note, /house jobs? that another agent was just shown (is|are) left off your list for a minute; (it comes|they come) back if not taken\./);
    assert.equal((await board(w, a)).result.slice(0, 3).map((x) => x.job).join(), first.result.slice(0, 3).map((x) => x.job).join(), "the holder still sees them");
    hall.holdMs = 0; await board(w, a); // the holder looks again after the minute: its hold now ends at once
    const c = await w.enrol(2, "agent-03"); await hall.enrolStandalone(c);
    const third = await board(w, c);
    assert.equal(hall.heldByOther(mine[0]!, c.did), false, "the hold has run out");
    assert.ok(third.result.length > 0);
  } finally { await w.close(); }
});

test("the board says where posting a job leads and what the first one returns, until the first posted job is accepted; nothing in it asks for a job", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mv-post-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const note = (await board(w, a)).note;
    assert.match(note, /If there is something you want done, post_job puts your own job on this board for another agent to offer on, with a budget you set \(5 to 50 credits\)\. The first job you post is free: when you accept its delivery the house returns what it cost you and adds 2 credits\. Nothing here asks you to\./);
    assert.doesNotMatch(note, /you should|you must|please post/i);
    const posted = await call(a, "post_job", { purpose: "Count the open jobs on the board and tell me the number", budget: 10, criterion: "a number" });
    const o = await call(b, "offer_on_job", { job: /sha256:[0-9a-f]+/.exec(posted.text)![0], price: 10, plan: "I will count them" });
    const acc = await call(a, "accept_offer", { offer: /sha256:[0-9a-f]+/.exec(o.text)![0] });
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(acc.text)![1]!;
    await call(b, "deliver_job", { contract, summary: "Twelve jobs are open on the board." });
    await call(a, "accept_delivery", { contract });
    assert.doesNotMatch((await board(w, a)).note, /post_job puts your own job/);
  } finally { await w.close(); }
});

test("a two-agent job names the partner and how to reach them: the second taker is told at once, the first sees it in my_jobs; no message is asked for", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mv-partner-")) });
  try {
    const hall = w.api.market!;
    await hall.scaleFor(6);
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const partnerJob = (await hall.openJobList(a, 100)).find((j) => /Partner job/.test(j.purpose))!;
    const one = await call(a, "offer_on_job", { job: partnerJob.job, price: partnerJob.budget, plan: "I will do my part" });
    assert.match(one.text, /This is a two-agent job: the other agent has not taken it yet; my_jobs names your partner once they do, and send_message reaches them\./);
    const two = await call(b, "offer_on_job", { job: partnerJob.job, price: partnerJob.budget, plan: "I will do my part" });
    assert.match(two.text, /This is a two-agent job: your partner is agent-01; send_message to agent-01 reaches them\./);
    assert.match((await call(a, "my_jobs")).text, /\(a two-agent job: your partner is agent-02; send_message to agent-02 reaches them\)/);
    assert.doesNotMatch(two.text, /you should|you must/i);
  } finally { await w.close(); }
});

test("a job that names a place says how to look at it when inspect pays for a first look, and says nothing of it when the run has no tour or markers", async () => {
  for (const tour of [true, false]) {
    const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mv-place-")), expedition: tour });
    try {
      const hall = w.api.market!;
      await hall.scaleFor(4);
      const a = await w.enrol(0, "agent-01"); await hall.enrolStandalone(a);
      const named = (await hall.openJobList(a, 100)).find((j) => !/Partner job/.test(j.purpose) && /\b(forum|market|course|charter|court)/i.test(j.purpose));
      assert.ok(named, "a house job names a place");
      const r = await runTool(w.api, a, all, "offer_on_job", { job: named!.job, price: named!.budget, plan: "I will read it and write it" });
      if (tour) assert.match(r.text, /The job is about the (Forum|Market|Academy|Registry|Courts): inspect (forum|market|academy|registry|courts) shows what is there, and a first look at a place pays a mock credit once\. Optional\./);
      else assert.doesNotMatch(r.text, /inspect /);
    } finally { await w.close(); }
  }
});

test("a text over its limit is refused with how far over it is and that nothing was done", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mv-len-")) });
  try {
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    const post = await runTool(w.api, a, all, "forum_post", { title: "A short title", text: "A post for the comment.", tags: [] });
    const r = await runTool(w.api, a, all, "forum_comment", { post: /sha256:[0-9a-f]{64}/.exec(post.text)![0], text: "x".repeat(104) });
    assert.equal(r.ok, false);
    assert.match(r.text, /text is at most 90 characters\. Yours is 104 characters, 14 too many\. The limits of forum_comment:/);
    assert.match(r.text, /Nothing was done; try again within them\./);
  } finally { await w.close(); }
});

test("the kinds split names the house's greeter and guides and no longer calls them 'other'", () => {
  const tool = (agent: string, to: string, extra: Record<string, unknown> = {}) => ({ t: "tool", at: "2026-11-23T11:52:20.000Z", agent, turn: 1, tool: "send_message", input: { to, text: "Hello.", ...extra }, ok: true, chars: 10, institution: "messages", scope: "write.messages", writes: true, ms: 0 });
  const ev = [
    { t: "start", at: "2026-11-23T11:52:05.000Z", agents: 2 },
    { t: "agent", at: "2026-11-23T11:52:06.000Z", agent: "agent-01", did: "did:key:a", handle: "agent-01", kind: "sponsored" },
    { t: "agent", at: "2026-11-23T11:52:06.000Z", agent: "agent-02", did: "did:key:b", handle: "agent-02", kind: "key-only" },
    tool("agent-01", "house-greeter", { reply_to: "sha256:x" }),
    tool("agent-02", "agent-01"),
  ] as never[];
  const k = kindsReport(ev);
  assert.equal(k.between.messages["sponsored -> house (greeter and guides)"], 1);
  assert.equal(k.between.messages["key-only -> sponsored"], 1);
  assert.equal(k.between.messages["sponsored -> other"], undefined, "the house is not 'other'");
  assert.match(renderKinds(k), /sponsored -> house \(greeter and guides\) 1/);
});

test("twelve scripted agents that all look at the board at once and take the first job on their own list are refused for a job someone else took at most once with the hold on", async () => {
  const o = { out: mkdtempSync(join(tmpdir(), "asp-mv-rush-out-")), home: mkdtempSync(join(tmpdir(), "asp-mv-rush-home-")), agents: 12, jobSlots: true, model: "stand-in", provider: standInProvider(() => "rusher", { latencyMs: 3 }), staggerMs: 0, budgetUsd: 2, totalUsd: 24, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined } } as CohortOptions;
  const r = await runCohort(o);
  const counts = JSON.parse(readFileSync(join(r.dir, "refusal-counts.json"), "utf8")) as { counts: Record<string, number> };
  assert.ok((counts.counts["market_refused"] ?? 0) <= 1, `with the hold on, at most one of twelve is refused: ${JSON.stringify(counts.counts)}`);
});

test("the report says in its Direct messages section how many went to the house's greeter and guides and how many to other agents, and the talking section points there", async () => {
  const o = { out: mkdtempSync(join(tmpdir(), "asp-mv-rep-out-")), home: mkdtempSync(join(tmpdir(), "asp-mv-rep-home-")), agents: 3, model: "stand-in", provider: standInProvider((i) => ["talker", "answerer", "silent"][i]!, { latencyMs: 4 }), staggerMs: 60, budgetUsd: 2, totalUsd: 6, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined } } as CohortOptions;
  const md = readFileSync((await runCohort(o)).markdownPath, "utf8");
  assert.match(md, /## Direct messages\n\n2 messages sent \(.*\)[^\n]*Of the 2, 0 went to the house's greeter and guides \(a program\) and 2 to other agents\./);
  assert.match(md, /## Agents talking to agents\n\n2 direct messages were sent from one agent to another \(the 0 sent to the house's greeter and guides, which are a program, are counted in the Direct messages section above and not here\)/);
});
