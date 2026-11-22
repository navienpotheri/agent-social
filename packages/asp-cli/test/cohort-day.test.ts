// Slice D of the owner's "more to do" job: ENG40 (a day cycle on the simulated clock whose events wake agents that are waiting for them, through the engine's own wake path) and ENG41 (roles taken by a recorded act and
// a Town Hall on a few votable settings, decided at the weekly town meeting, with reserved matters refused and a visible consequence). Fake key; credits are accounting entries.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { DAY, DayCycle, HOUR, scheduleBetween } from "../src/cohort/day-cycle.ts";
import { QUORUM, RESERVED_KINDS, ROLE_SEATS, ROLES, SETTINGS } from "../src/cohort/town.ts";
import { HOUSE_BATCH } from "../src/cohort/house-jobs.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("ENG40: the schedule is a pure function of the simulated time: a market hour and a social hour each day, the open mic on days 1, 4, 7, a course opening on day 2, a town meeting on day 7", () => {
  const week = scheduleBetween(0, 7 * DAY);
  const count = (id: string) => week.filter((e) => e.id === id).length;
  assert.deepEqual([count("market_hour"), count("social_hour"), count("open_mic"), count("course_opening"), count("town_meeting")], [7, 7, 3, 1, 1]);
  assert.deepEqual(week.map((e) => e.at), week.map((e) => e.at).slice().sort((a, b) => a - b), "in order");
  assert.equal(week.find((e) => e.id === "course_opening")!.at, DAY + 10 * HOUR);
  assert.equal(week.find((e) => e.id === "town_meeting")!.at, 6 * DAY + 19 * HOUR);
  assert.equal(week.find((e) => e.id === "market_hour")!.kind, "new_job");
  assert.equal(week.find((e) => e.id === "course_opening")!.kind, "course");
  // an interval is half open: nothing is announced twice
  const a = scheduleBetween(0, 18 * HOUR), b = scheduleBetween(18 * HOUR, DAY + 12 * HOUR);
  assert.equal(a.length + b.length, scheduleBetween(0, DAY + 12 * HOUR).length);
  assert.ok(week.every((e) => !/must|should|have to|hurry/i.test(e.text)), "no pressure in any announcement");
});

test("ENG40: in a world with a day cycle a settled house job does not refill the board; the market hour releases a batch once, however many agents are told; the open mic post exists", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-day-world-")), dayCycle: true });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const day = w.api.dayCycle!;
    assert.ok(day.openMicPost.startsWith("sha256:"), "the open mic thread is there");
    assert.equal(w.api.event, undefined, "no invitation to the first arrival without --house-event");
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const RICH = "Because the charters say what each institution is for, a newcomer should read them first, but the market, the academy and the forum differ; is that enough? 1) read the lesson and the rule for when to post, 2) take a house job, 3) ask a question: 3 questions, 2 offers, 4 notices, 1 other, and the cheapest pays 8, the dearest 28, so I would comment instead.";
    for (let i = 0; i < 3; i++) {
      const job = (await hall.openJobList(a, 50)).find((j) => !j.partner)!;
      const o = await call("offer_on_job", { job: job.job, price: job.budget, plan: "I will write it" });
      const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
      assert.equal((await call("deliver_job", { contract, summary: RICH })).ok, true);
    }
    assert.deepEqual(hall.houseJobs(), { released: HOUSE_BATCH, waiting: hall.houseJobs().waiting }, "nothing was released by the settlements");
    assert.equal((await hall.openJobList(a, 50)).length, HOUSE_BATCH - 3);
    const first = await day.due(0, DAY);
    assert.ok(first.some((e) => e.id === "market_hour"));
    assert.equal((await hall.openJobList(a, 50)).length, HOUSE_BATCH - 3 + 3, "the market hour put three more on the board");
    await day.due(0, DAY);
    assert.equal((await hall.openJobList(a, 50)).length, HOUSE_BATCH, "asked again, the same hour is not applied twice");
    assert.equal(day.fired.filter((f) => f.id === "market_hour").length, 1);
  } finally { await w.close(); }
});

test("ENG41: roles are taken by a recorded act (two seats each, one role at a time, no powers), and the Town Hall decides a proposal at the weekly meeting: a vote passes, the setting changes, the clerk posts the notice and catch_up shows it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-town-world-"));
  const w = await bootWorld({ dir, dayCycle: true, roles: true });
  try {
    const ags: Awaited<ReturnType<typeof w.enrol>>[] = [];
    for (let i = 0; i < 4; i++) { const x = await w.enrol(i, `agent-0${i + 1}`); await w.api.market!.enrolStandalone(x); ags.push(x); }
    const hall = w.api.market!, town = w.api.town!, day = w.api.dayCycle!;
    const call = (i: number, name: string, input: Record<string, unknown> = {}) => runTool(w.api, ags[i]!, all, name, input);
    // roles
    assert.match((await call(0, "role_take", { role: "scribe" })).text, /You now hold the role of scribe: a scribe writes down what was decided.*carries no powers/);
    assert.equal(town.roleOf(ags[0]!.did), "scribe");
    assert.match((await call(0, "role_take", { role: "scribe" })).text, /already hold/);
    await call(1, "role_take", { role: "scribe" });
    assert.match((await call(2, "role_take", { role: "scribe" })).text, /the scribe role has its 2 holders already \(agent-01, agent-02\)/);
    assert.equal(ROLE_SEATS, 2);
    assert.deepEqual(Object.keys(ROLES), ["curator", "reviewer", "greeter", "scribe"]);
    assert.equal((await call(0, "role_take", { role: "pirate" })).refused !== undefined, true);
    await call(0, "role_take", { role: "curator" });
    assert.deepEqual(town.roles.get("scribe"), ["agent-02"], "taking another role gives the first up");
    // reserved matters and unknown settings are refused
    for (const kind of RESERVED_KINDS) { const r = await call(0, "town_propose", { title: "x", kind, key: "market.batch_size", value: "4" }); assert.equal(r.refused, "town_refused", kind); assert.match(r.text, /reserved to the owner/); }
    assert.match((await call(0, "town_propose", { title: "x", kind: "setting", key: "safety.floor", value: "1" })).text, /reserved list or a reserved area/);
    assert.match((await call(0, "town_propose", { title: "x", kind: "setting", key: "code.article1", value: "1" })).text, /reserved/);
    assert.match((await call(0, "town_propose", { title: "x", kind: "setting", key: "market.job_tax", value: "0" })).text, /not a setting that can be changed by vote here/);
    assert.match((await call(0, "town_propose", { title: "x", kind: "setting", key: "market.batch_size", value: "99" })).text, /does not fit market\.batch_size/);
    assert.match((await call(0, "town_propose", { title: "x", kind: "setting", key: "market.batch_size", value: "not json" })).text, /the value is JSON/);
    assert.match((await call(0, "town_hall")).text, /Reserved to the owner, never voted: code_article, safety_floor, money_creation, legal/);
    // a proposal, three yes votes and a no, one vote each
    const p = await call(0, "town_propose", { title: "Four jobs in each market hour", kind: "setting", key: "market.batch_size", value: "4" });
    assert.equal(p.ok, true, p.text);
    assert.match(p.text, /Proposal town-1 is open.*3 votes are needed/);
    assert.match((await call(0, "town_propose", { title: "Another", kind: "setting", key: "forum.notice", value: '"hello"' })).text, /already have a proposal open/);
    for (const i of [0, 1, 2]) assert.equal((await call(i, "town_vote", { proposal: "town-1", choice: "yes" })).ok, true);
    assert.equal((await call(3, "town_vote", { proposal: "town-1", choice: "no" })).ok, true);
    assert.match((await call(3, "town_vote", { proposal: "town-1", choice: "yes" })).text, /one vote for each agent/);
    assert.match((await call(0, "town_vote", { proposal: "town-9", choice: "yes" })).text, /there is no proposal town-9/);
    assert.equal(hall.batchSize, 3);
    // nothing is decided before the weekly meeting
    await day.due(0, 6 * DAY);
    assert.equal(town.proposals[0]!.status, "open");
    assert.equal(hall.batchSize, 3);
    // the meeting (day 7, 19:00): decided, enacted, a visible consequence
    const meeting = await day.due(6 * DAY, 7 * DAY);
    assert.ok(meeting.some((e) => e.id === "town_meeting"));
    assert.deepEqual([town.proposals[0]!.status, town.proposals[0]!.result], ["enacted", "3 yes, 1 no"]);
    assert.equal(hall.batchSize, 4, "the setting changed");
    assert.deepEqual(town.settings.get("market.batch_size"), 4);
    const feed = JSON.parse((await w.api.get("/forum/feed?sort=new&limit=30&tag=town")).text) as { posts: { handle: string; title: string }[] };
    assert.deepEqual(feed.posts.map((x) => [x.handle, x.title]), [["house-town-clerk", "Town Hall: decided"]], "the clerk posted the notice");
    assert.match((await call(0, "town_hall")).text, /town-1 "Four jobs in each market hour" by agent-01 \(market\.batch_size = 4\): enacted, 3 yes, 1 no/);
    assert.match((await call(0, "town_vote", { proposal: "town-1", choice: "no" })).text, /no longer open: it was enacted/);
    // a second proposal that does not reach the quorum fails, and a notice that passes is shown by catch_up
    await call(1, "town_propose", { title: "A notice for everyone", kind: "setting", key: "forum.notice", value: '"Be kind in the forum."' });
    await call(1, "town_vote", { proposal: "town-2", choice: "yes" });
    await call(2, "town_propose", { title: "Another notice", kind: "setting", key: "forum.notice", value: '"Read the charters."' });
    for (const i of [0, 1, 2]) await call(i, "town_vote", { proposal: "town-3", choice: "yes" });
    await day.due(13 * DAY, 14 * DAY);
    assert.deepEqual(town.proposals.slice(1).map((x) => x.status), ["no_quorum", "enacted"]);
    assert.match((await call(3, "catch_up")).text, /Town notice: Read the charters\./);
    assert.equal(QUORUM, 3);
    assert.ok("market.batch_size" in SETTINGS && "forum.notice" in SETTINGS);
    const saved = JSON.parse(readFileSync(join(dir, "town.json"), "utf8")) as { settings: Record<string, unknown> };
    assert.deepEqual(saved.settings, { "market.batch_size": 4, "forum.notice": "Read the charters." });
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

test("without a day cycle or roles the tools say so and nothing changes", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-day-none-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    await w.api.market!.enrolStandalone(a);
    assert.match((await runTool(w.api, a, all, "town_hall", {})).text, /There is no Town Hall in this society/);
    assert.equal(w.api.dayCycle, undefined);
    assert.equal(w.api.market!.refillOnSettle, true);
  } finally { await w.close(); }
});

// ---- the engine's own wake path ----
const SECRET = "sk-ant-api03-FAKE-day-9876543210abcdef";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const use = (name: string, input: Record<string, unknown> = {}) => [{ type: "tool_use", id: "t", name: name.startsWith("mcp") ? name : P + name, input }];
async function provider(script: (r: { system: string; last: string }) => unknown[]) {
  const seen: { system: string; last: string }[] = [];
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const msgs = body.messages ?? [], lm = msgs[msgs.length - 1];
      const last = typeof lm?.content === "string" ? lm.content : JSON.stringify(lm?.content ?? "");
      const r = { system: Array.isArray(body.system) ? body.system.map((b: { text?: string }) => b.text ?? "").join("") : String(body.system ?? ""), last };
      seen.push(r);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 700, output_tokens: 50 }, content: script(r) }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}

test("ENG40: through the engine's wake path an agent waiting for a scheduled event is woken by it with no model call while it waited, and told what it is; a wait for a kind the world cannot raise is refused", { timeout: 180_000 }, async () => {
  const p = await provider((r) => {
    if (/You are here now/.test(r.last)) return use("wait_for", { events: ["event"], max_wait: "3d" });
    if (/You waited/.test(r.last)) return use("notebook_write", { text: "the social hour began" });
    if (/Noted|notebook/i.test(r.last) || /Exit check/.test(r.last)) return use("leave", { reason: "I heard the bell" });
    return use("do_nothing");
  });
  const out = mkdtempSync(join(tmpdir(), "asp-day-out-")), home = mkdtempSync(join(tmpdir(), "asp-day-home-"));
  const outLines: string[] = [], errLines: string[] = [];
  const io: Io = { out: (l) => outLines.push(l), err: (l) => errLines.push(l), env: { ASP_HOME: home, DAY_KEY: SECRET }, cwd: home };
  const code = await main(["society", "cohort", "--local", "--agents", "1", "--model", "claude-haiku-5-5", "--api-key-env", "DAY_KEY", "--budget-usd", "0.40", "--provider-url", p.url, "--out", out, "--sim-speed", "20000", "--day-cycle"], io);
  assert.equal(code, 0, errLines.join("\n") + outLines.join("\n"));
  const dir = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!);
  const events = readFileSync(join(dir, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const wake = events.find((e) => e.t === "wake" && e.kinds.includes("event"));
  assert.ok(wake, `a wake because of an event: ${JSON.stringify(events.filter((e) => e.t === "wake"))}`);
  assert.match(wake.because, /something you were waiting for happened \(event\)/);
  const woke = p.seen.find((q) => /You waited/.test(q.last))!;
  assert.match(woke.last, /social hour of day 1 has begun\. The forum is the place to talk; no one is asked to\./);
  assert.equal(p.seen.filter((q) => /You are here now/.test(q.last)).length, 1, "one model call before the wait and none while it waited");
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /## The day cycle\n\n\d+ scheduled events fell due on the simulated clock .* 1 wake of waiting agents were because of one \(agent-01\)/);
  assert.match(md, /It reaches only an agent that is waiting|An event reaches only an agent that is waiting for its kind, and asks nothing of it/);
});
