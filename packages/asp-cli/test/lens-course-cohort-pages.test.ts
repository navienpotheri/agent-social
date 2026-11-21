/**
 * The cohort demo, steps 2 and 3 (register rows DK751 to DK753; spec-deltas S991 to S993): the public dashboard at /society/cohorts/<id>, the post-course check, the sponsor report for each agent and the feed file the
 * map replays. All public over HTTP, deterministic, with no private field and no free text, and in the smoke script. Scripted agents on a toy world, credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cohortRoutes } from "../src/lens-courses/cohort-pages.ts";
import { demoRun, reasonOf } from "../src/lens-courses/cohort-pages.ts";
import { checkupRows, CHECKUP_DAY } from "../src/lens-courses/cohort-monitor.ts";
// @ts-expect-error the smoke script is plain JavaScript
import { ROUTES } from "../../../scripts/smoke-serve.mjs";

const PRIVATE = /did:|did%3A|"sponsor":|"balance":|public_key|"token":|"email":|"address":|"secret":|"keys?":/i;

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const route = cohortRoutes();
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { return await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}/society/cohorts`); } finally { server.close(); }
}
const json = async (u: string) => (await fetch(u, { headers: { accept: "application/json" } })).json() as Promise<any>;

test("the dashboard is public over HTTP: completion, pass rate, held-out before and after for the cohort against the control, the lift with its statistic, regressions and cost per point; the same bytes every time, by id or by the demo alias", async () => {
  await withServer(async (base) => {
    const { story } = await demoRun();
    const j = await json(`${base}/${story.id}`);
    assert.equal(j.ok, true);
    const c = j.cohort;
    assert.equal(c.completion.cohort, 12);
    assert.equal(c.completion.completed, 8);
    assert.equal(c.completion.pass_rate_permille, 667);
    assert.equal(c.held_out.cohort_before, 400); assert.equal(c.held_out.cohort_after, 800);
    assert.equal(c.held_out.control_before, 400); assert.equal(c.held_out.control_after, 400);
    assert.equal(c.lift.difference, 400); assert.ok(c.lift.t > 3); assert.match(c.lift.method, /Welch/);
    assert.equal(c.regressions, 0);
    assert.ok(c.cost_per_point_of_lift > 0);
    assert.equal(c.agents.length, 24);
    const html = await (await fetch(`${base}/${story.id}`)).text();
    assert.match(html, /8 of 12 completed/); assert.match(html, /control/); assert.match(html, /standard error/); assert.match(html, /not money/); assert.match(html, /no real model/);
    assert.equal(html, await (await fetch(`${base}/demo`)).text(), "the alias gives the same page");
    assert.equal(html, await (await fetch(`${base}/${story.id}/`)).text());
    assert.deepEqual(await json(`${base}/demo`), j);
    const list = await json(base);
    assert.equal(list.cohorts.length, 1);
    assert.equal((await fetch(`${base}/co-0000000000`)).status, 404);
    assert.equal((await fetch(`${base}/demo`, { method: "POST" })).status, 405);
  });
});

test("the lift on the page is computed from held-out scores only: the agents' before and after on the page give the same lift, and a failed sitting leaves an agent's score unchanged", async () => {
  await withServer(async (base) => {
    const c = (await json(`${base}/demo`)).cohort;
    const co = c.agents.filter((a: any) => a.group === "cohort"), ct = c.agents.filter((a: any) => a.group === "control");
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.equal(mean(co.map((a: any) => a.after - a.before)) - mean(ct.map((a: any) => a.after - a.before)), c.lift.difference);
    for (const a of co.filter((x: any) => x.result !== "passed and written back")) assert.equal(a.lift, 0, `${a.handle}: ${a.result}`);
    assert.deepEqual([...new Set(co.map((a: any) => a.result))].sort(), ["below the held-out mark", "not written as rules", "passed and written back", "rules too broad", "used a held-out case"]);
  });
});

test("the dashboard, the check, a report and the feed carry no private field: no DID, key, sponsor, balance, token or address, and no free text from an agent", async () => {
  await withServer(async (base) => {
    const bodies = [await (await fetch(`${base}/demo`)).text(), JSON.stringify(await json(`${base}/demo`)), await (await fetch(`${base}/demo/checkup`)).text(), JSON.stringify(await json(`${base}/demo/checkup`)), await (await fetch(`${base}/demo/feed.json`)).text(), await (await fetch(`${base}/demo/agents/s04`)).text(), JSON.stringify(await json(`${base}/demo/agents/s04`))];
    for (const b of bodies) assert.doesNotMatch(b, PRIVATE);
    const { story } = await demoRun();
    for (const a of story.agents) for (const b of bodies) assert.ok(!b.includes(a.id), `${a.handle}'s identity is not on a page`);
    const view = JSON.stringify((await json(`${base}/demo`)).cohort);
    for (const a of story.agents) assert.ok(!a.failures.some((f) => f.length > 8 && view.includes(f)), "the text of a failure is not on the dashboard");
  });
});

test("the post-course check measures the agents that kept lessons again on the same held-out cases and flags a lost lift or a regression, and a clean agent is not flagged", async () => {
  const { story } = await demoRun();
  const rows = checkupRows(story);
  assert.equal(rows.length, story.summary.passed, "only agents that kept lessons are checked");
  const flagged = rows.filter((r) => r.flag !== "ok");
  assert.equal(flagged.length, 2);
  assert.deepEqual(flagged.map((r) => r.drift).sort(), ["a broad rule added since the course", "memory emptied since the course"]);
  const forgot = flagged.find((r) => r.drift === "memory emptied since the course")!;
  assert.equal(forgot.lift_now, 0); assert.match(forgot.flag, /lift lost/);
  const broad = flagged.find((r) => r.drift === "a broad rule added since the course")!;
  assert.ok(broad.lift_now < broad.lift_then / 2 || broad.regressions_now > 1);
  for (const r of rows.filter((x) => x.drift === "none")) { assert.equal(r.flag, "ok"); assert.equal(r.lift_now, r.lift_then); assert.equal(r.regressions_now, 0); }
  await withServer(async (base) => {
    const c = (await json(`${base}/demo/checkup`)).checkup;
    assert.equal(c.day, CHECKUP_DAY); assert.equal(c.flagged, 2); assert.equal(c.checked, rows.length); assert.match(c.rule, /under half/);
    assert.match(await (await fetch(`${base}/demo/checkup`)).text(), /lift lost/);
    assert.deepEqual(await json(`${base}/demo/checkup`), { ok: true, checkup: c });
  });
});

test("a sponsor report for each agent says what it learned, what changed in its memory and what it cost; an agent that did not pass or did not enrol changed nothing; an unknown agent is a 404", async () => {
  const { story } = await demoRun();
  await withServer(async (base) => {
    const honest = story.agents.find((a) => a.written_back)!, failed = story.agents.find((a) => a.enrolled && !a.passed)!, control = story.agents.find((a) => a.group === "control")!;
    const h = (await json(`${base}/demo/agents/${honest.handle}`)).report;
    assert.ok(h.learned.length >= 3);
    assert.equal(h.memory_change.through_lesson_gate, true); assert.equal(h.memory_change.rules_added, h.learned.length); assert.match(h.memory_change.learning_record, /^sha256:[0-9a-f]{64}$/);
    assert.equal(h.held_out.lift, 600); assert.equal(h.cost.tuition, 30);
    assert.match(await (await fetch(`${base}/demo/agents/${honest.handle}`)).text(), /What it learned/);
    const f = (await json(`${base}/demo/agents/${failed.handle}`)).report;
    assert.deepEqual(f.learned, []); assert.equal(f.memory_change.rules_added, 0); assert.equal(f.memory_change.through_lesson_gate, false); assert.equal(f.held_out.lift, 0); assert.equal(f.cost.tuition, 30);
    const c = (await json(`${base}/demo/agents/${control.handle}`)).report;
    assert.equal(c.course, null); assert.equal(c.held_out, null); assert.equal(c.cost.tuition, 0); assert.equal(c.checkup, null);
    assert.equal((await fetch(`${base}/demo/agents/zz99`)).status, 404);
  });
  assert.equal(reasonOf(story.agents.find((a) => a.group === "control")!), "not enrolled");
});

test("the feed file the map replays has every agent with level, kind, courses taken, lessons learned and standing, and flows between agents and institutions over simulated days, including the enrolments, the sittings and the checks; it is the same every time", async () => {
  const { story } = await demoRun();
  await withServer(async (base) => {
    const feed = await json(`${base}/demo/feed.json`);
    assert.equal(feed.simulated, true); assert.match(feed.note, /no real model/);
    assert.equal(feed.agents.length, 24);
    assert.deepEqual([...new Set(feed.agents.map((a: any) => a.kind))].sort(), ["house", "key-only", "sponsored"]);
    for (const a of feed.agents) { assert.ok(["cohort", "control"].includes(a.group)); assert.equal(typeof a.lessons_learned, "number"); assert.ok("held_out_before" in a.standing); if (a.house) assert.equal(a.label, "house agent"); else assert.equal(a.label, null); }
    assert.equal(feed.agents.filter((a: any) => a.courses.length).length, 12, "only the cohort has taken the course");
    assert.equal(feed.agents.filter((a: any) => a.courses.some((c: any) => c.state === "completed")).length, story.summary.passed);
    const known = new Set([...feed.agents.map((a: any) => a.id), ...feed.places.map((p: any) => p.id)]);
    assert.ok(feed.flows.length > 40);
    for (const f of feed.flows) { assert.ok(known.has(f.from) && known.has(f.to), `${f.from} -> ${f.to}`); assert.ok(f.day >= 0 && f.day <= CHECKUP_DAY); }
    assert.deepEqual(feed.flows.map((f: any) => f.day), [...feed.flows.map((f: any) => f.day)].sort((a: number, b: number) => a - b), "in simulated time order");
    const kinds = new Set(feed.flows.map((f: any) => f.kind));
    for (const k of ["enrol", "tuition", "sitting", "completion", "learn", "job", "purchase", "game", "checkup"]) assert.ok(kinds.has(k), k);
    assert.equal(await (await fetch(`${base}/demo/feed.json`)).text(), await (await fetch(`${base}/demo/feed.json`)).text());
  });
});

test("the cohort dashboard is on the smoke script's list of public routes, and the books of the story balance", async () => {
  assert.ok((ROUTES as string[][]).some(([p]) => p === "/society/cohorts/demo"));
  const { story, k } = await demoRun();
  assert.equal(story.books, "balanced");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
