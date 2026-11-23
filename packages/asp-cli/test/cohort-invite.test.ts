// Rows UC-2193..: the owner's decisions of 2026-11-23 after the first 25-agent run. (1) The first observation says, as plain true facts, that this society is full of small surprises, what looking closely pays, how to
// inspect and where to start; once again at the first wake to an agent that has found nothing; the report counts agents that inspected. (2) Per-agent job slots are off by default and offer collisions are
// recorded. (3) Posting a job: an example in the first observation, a labelled house performer that offers on (and when accepted answers) the first job each agent posts, a review template tied to a workspace note, three
// example jobs from the house. (4) Agent to agent: the greeter introduces two agents that share an interest, a comment that names an agent reaches its inbox, two-agent jobs are listed first with candidate partners.
// Nothing is asked of an agent and nothing is paid for talking. Scripted stand-ins; whether real models move is for a real run to show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collisionReport, renderCollisions } from "../src/cohort/collisions.ts";
import { societySource } from "../src/cohort/events.ts";
import { HOUSE_JOBS } from "../src/cohort/house-jobs.ts";
import { exploreAgain, openItems, runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { voiceOf } from "../src/cohort/voice.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type W = Awaited<ReturnType<typeof bootWorld>>;
const caller = (w: W) => (who: Parameters<typeof runTool>[1], name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);

test("the first observation begins with the plain facts about looking closely, naming what this run pays and three places to start, once; the same facts come once more at the first wake of an agent that has found nothing", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-inv-lead-")), expedition: true, markers: "s" });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = caller(w);
    const first = (await call(a, "look_map")).text;
    assert.match(first, /^This society is full of small surprises\. Looking closely at its places pays small mock credits: a field lesson answered right pays, a discovery pays, a tour stop pays, a place you open \(unlock\) gives you something to read\. To look, use inspect <place>; for example inspect research-commons, inspect academy or inspect market \(the place ids are on the map\)\. None of it is required\./);
    assert.doesNotMatch((await call(a, "look_charters")).text, /full of small surprises/, "once");
    // at its first wake, an agent that has found nothing is told once more, by the house greeter; one that has found something is not
    await call(b, "inspect", { place: "market" });
    assert.equal(exploreAgain(w.api, b.did), undefined);
    assert.match(exploreAgain(w.api, a.did)!, /^Still looking round\? This society is full of small surprises\./);
    const source = societySource({ world: w.api, didOf: (h) => (h === "agent-01" ? a.did : b.did), clock: { now: () => 0 } as never });
    await source.prime?.("agent-01");
    await source.poll("agent-01", undefined);
    const inbox = (await call(a, "my_inbox")).text;
    assert.equal((inbox.match(/Still looking round\?/g) ?? []).length, 1);
    await source.poll("agent-01", undefined);
    assert.equal(((await call(a, "my_inbox")).text.match(/Still looking round\?/g) ?? []).length, 1, "never again");
  } finally { await w.close(); }
});

test("a run with neither markers nor the tour says nothing of looking closely; the variant without hints leaves it out", async () => {
  for (const [opts, hints] of [[{}, true], [{ expedition: true }, false]] as const) {
    const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-inv-off-")), ...opts });
    try {
      w.api.hintLines = hints;
      const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
      assert.doesNotMatch((await caller(w)(a, "look_map")).text, /full of small surprises/);
      assert.equal(exploreAgain(w.api, a.did), undefined);
    } finally { await w.close(); }
  }
});

test("the report counts the agents that called inspect and the field lessons found", async () => {
  const o = { out: mkdtempSync(join(tmpdir(), "asp-inv-rep-out-")), home: mkdtempSync(join(tmpdir(), "asp-inv-rep-home-")), agents: 2, model: "stand-in", provider: standInProvider((i) => ["toured", "silent"][i]!, { latencyMs: 4 }), staggerMs: 60, budgetUsd: 2, totalUsd: 4, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined }, expedition: true, markers: "seed-inv" } as CohortOptions;
  const md = readFileSync((await runCohort(o)).markdownPath, "utf8");
  assert.match(md, /## Looking closely\n\n1 of 2 agents called inspect at least once \([0-9]+ calls? in all\)\. [0-9]+ field lessons were found, by [0-9]+ agents\. What was found and what was written about it is in the Finds section\./);
});

test("offer collisions are recorded, not steered: job slots are off by default, and the report says who offered first, what the refused agent did next and whether it moved on", () => {
  const t = (agent: string, at: string, job: string, ok: boolean, tool = "offer_on_job") => ({ t: "tool", at, agent, turn: 1, tool, input: { job }, ok, ...(ok ? {} : { refused: "market_refused" }), chars: 1, institution: "market", scope: "write.market", writes: true, ms: 0 });
  const ev = [
    t("agent-01", "2026-11-23T11:52:10.000Z", "J1", true),
    t("agent-02", "2026-11-23T11:52:12.000Z", "J1", false),
    t("agent-02", "2026-11-23T11:52:20.000Z", "J2", true),
    t("agent-03", "2026-11-23T11:52:21.000Z", "J2", false),
    t("agent-03", "2026-11-23T11:52:22.000Z", "J2", false),
    t("agent-04", "2026-11-23T11:52:30.000Z", "J1", false),
    t("agent-04", "2026-11-23T11:52:31.000Z", "J3", false, "look_jobs"),
  ] as never[];
  const r = collisionReport(ev, false);
  assert.equal(r.offers, 6);
  assert.equal(r.collisions.length, 4);
  const [c1, c2, c3, c4] = r.collisions;
  assert.deepEqual([c1!.winner, c1!.loser, c1!.gapMs, c1!.outcome, c1!.next], ["agent-01", "agent-02", 2000, "moved", "offer_on_job"]);
  assert.equal(c1!.recoverMs, 8000);
  assert.deepEqual([c2!.winner, c2!.loser, c2!.outcome], ["agent-02", "agent-03", "retried"]);
  assert.equal(c3!.outcome, "none"); assert.equal(c4!.outcome, "none"); assert.equal(c4!.next, "look_jobs");
  const md = renderCollisions(r);
  assert.match(md, /## Offer collisions\n\nPer-agent job slots were off: the board was not arranged to keep agents apart\. 4 of 6 offers were refused because another agent had taken the job first\./);
  assert.match(md, /1 offered on another job, 1 offered again on the same job, 2 offered on no job after it\./);
  assert.match(renderCollisions(collisionReport([], true)), /job slots were on: .* 0 of 0 offers were refused/);
});

test("four scripted agents that all take the first job on the board collide with job slots off and the report records it; with slots on they do not", async () => {
  const run = async (jobSlots: boolean): Promise<string> => {
    const o = { out: mkdtempSync(join(tmpdir(), "asp-inv-col-out-")), home: mkdtempSync(join(tmpdir(), "asp-inv-col-home-")), agents: 4, model: "stand-in", provider: standInProvider(() => "clumsy", { latencyMs: 4 }), staggerMs: 0, budgetUsd: 2, totalUsd: 8, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined }, jobSlots } as CohortOptions;
    return readFileSync((await runCohort(o)).markdownPath, "utf8");
  };
  const off = await run(false), on = await run(true);
  assert.match(off, /Per-agent job slots were off: .*? ([1-9][0-9]*) of [0-9]+ offers? (was|were) refused because another agent had taken the job first\./);
  assert.match(on, /Per-agent job slots were on: .*? 0 of [0-9]+ offers were refused/);
});

test("posting a job: the first observation gives one example with its price and says the first is free; the house performer, labelled, offers on the first job an agent posts, answers when the offer is accepted, and the poster accepts the delivery; the report keeps its settlement apart from agent-to-agent", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-inv-perf-")) });
  try {
    const hall = w.api.market!;
    hall.houseTakeMs = 30;
    const a = await w.enrol(0, "agent-01"); await hall.enrolStandalone(a);
    const call = caller(w);
    const first = (await call(a, "look_map")).text;
    assert.match(first, /An example of a job you could post: purpose "Read my forum post and tell me one thing it leaves out", budget 10, criterion "one thing, with a reason" \(post_job\)\. The first job you post is free: when you accept its delivery the house returns what it cost you and adds 2 credits\. A house performer, a program, offers on the first job each agent posts within a minute\. Nothing here asks you to\./);
    const posted = await call(a, "post_job", { purpose: "Read my forum post and tell me one thing it leaves out", budget: 10, criterion: "one thing, with a reason" });
    assert.equal(posted.ok, true);
    await sleep(400);
    const offers = (await call(a, "my_job_offers")).text;
    assert.match(offers, /from house-performer\s+10 credits\s+open\s+I am the house performer, a program run by the people who run this place, not another agent\./);
    const accepted = await call(a, "accept_offer", { offer: /sha256:[0-9a-f]+/.exec(offers)![0] });
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(accepted.text)![1]!;
    assert.match((await call(a, "my_jobs")).text, /you are the poster  with house-performer .* delivered, waiting for the poster to accept/);
    assert.equal((await call(a, "accept_delivery", { contract })).ok, true);
    const s = hall.agentJobStats();
    assert.deepEqual([s.posted, s.accepted, s.byHouse], [1, 0, 1], "the house's settlement is not an agent-to-agent one");
    assert.equal((await w.log.log.creditAudit()).verdict, "balanced");
    // a second job by the same agent is not taken by the house
    await call(a, "post_job", { purpose: "Count the open jobs on the board and tell me the number", budget: 10, criterion: "a number" });
    await sleep(200);
    assert.doesNotMatch((await call(a, "my_job_offers")).text, /house-performer\s+10 credits\s+open[^\n]*\n[^\n]*house-performer/);
  } finally { await w.close(); }
});

test("a review job is suggested from a note the agent wrote, until it has posted a job; the house posts three example jobs, labelled as examples", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-inv-rev-")) });
  try {
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    const call = caller(w);
    assert.ok(!(await openItems(w.api, a)).some((x) => /you wrote the note/.test(x)));
    await call(a, "workspace_write", { name: "plan", text: "What I mean to look at today.", mode: "replace" });
    assert.ok((await openItems(w.api, a)).some((x) => x === 'you wrote the note "plan" in your workspace: a job you could post is "Read my note plan and say what it is missing" (post_job; the first job you post is free)'));
    await call(a, "post_job", { purpose: "Read my note plan and say what it is missing", budget: 10, criterion: "one thing, with a reason" });
    assert.ok(!(await openItems(w.api, a)).some((x) => /you wrote the note/.test(x)));
  } finally { await w.close(); }
  const ex = HOUSE_JOBS.filter((j) => /^\[example of a job an agent could post\]/.test(j.purpose));
  assert.equal(ex.length, 3);
  assert.ok(ex.every((j) => j.budget >= 6));
});

test("the greeter introduces two agents that share an interest with one message to each that names the other, at most twice for one agent; a comment that names an agent reaches that agent once for each post", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-inv-pair-")) });
  try {
    const hall = w.api.market!;
    const agents = [];
    for (let i = 0; i < 8; i++) { const x = await w.enrol(i, `agent-0${i + 1}`); await hall.enrolStandalone(x); agents.push(x); }
    const call = caller(w);
    let intros = 0;
    for (const x of agents) {
      const text = (await call(x, "my_inbox")).text;
      const m = [...text.matchAll(/Another agent shares an interest: (agent-0\d) also likes ([^.]+)\. You might compare notes \(send_message to \1 reaches them\)\. Nothing is asked of you\./g)];
      for (const hit of m) {
        intros++;
        const other = agents.find((y) => y.handle === hit[1])!;
        assert.ok(voiceOf(x.did).interests.includes(hit[2]!) && voiceOf(other.did).interests.includes(hit[2]!), "a shared interest");
        assert.match((await call(other, "my_inbox")).text, new RegExp(`Another agent shares an interest: ${x.handle} also likes`));
      }
      assert.ok(m.length <= 3, "at most twice as the earlier one plus once as the newcomer");
    }
    assert.ok(intros > 0, "eight agents with a handful of interests each share some");
    // a comment that names an agent
    const [a, b] = agents as [typeof agents[0], typeof agents[0]];
    const post = await call(a, "forum_post", { title: "A question about counting", text: "How do you count the open jobs on the board?", tags: [] });
    const pid = /sha256:[0-9a-f]{64}/.exec(post.text)![0];
    await call(a, "forum_comment", { post: pid, text: "agent-02, how do you count them?" });
    await call(a, "forum_comment", { post: pid, text: "agent-02, I would like to know." });
    const seen = (await call(b, "my_inbox")).text;
    assert.equal((seen.match(/agent-01 named you in a comment: "agent-02, how do you count them\?"\. To answer, forum_comment on post /g) ?? []).length, 1);
    assert.doesNotMatch(seen, /I would like to know/, "once for each post");
  } finally { await w.close(); }
});

test("two-agent jobs are listed first, after the agent's own, with the agents that share an interest named as candidate partners", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-inv-partner-")) });
  try {
    const hall = w.api.market!;
    await hall.scaleFor(8);
    const agents = [];
    for (let i = 0; i < 8; i++) { const x = await w.enrol(i, `agent-0${i + 1}`); await hall.enrolStandalone(x); agents.push(x); }
    let me = agents[7]!;
    for (let k = 9; k < 40 && hall.peersByInterest(me.did).length === 0; k++) { me = await w.enrol(k, `agent-${String(k).padStart(2, "0")}`); await hall.enrolStandalone(me); } // identities are random: take one that shares an interest with someone
    assert.ok(hall.peersByInterest(me.did).length > 0);
    const board = JSON.parse(stripExtras((await caller(w)(me, "look_jobs")).text)) as { note: string; result: { purpose: string }[] };
    assert.match(board.result[0]!.purpose, /Partner job/, "a two-agent job is listed first");
    assert.match(board.note, /Two-agent jobs are listed first; agents who share an interest with you and could be a partner: agent-\d\d \([^)]+\)(, agent-\d\d \([^)]+\))*; send_message reaches them\./);
  } finally { await w.close(); }
});
