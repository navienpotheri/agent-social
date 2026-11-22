// Slice B of the owner's "more to do" job: the orientation expedition (ENG23: groups of four led by a labelled house guide, a thread for each group, five small stops through the real tools that each pay a few mock
// credits once, a progress record for each agent, leaving always possible) and the places to discover (a plaque, a shut door that opens after a job, a rumour thread). Nothing is required and no text pressures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { Expedition, DISCOVERY_PAY, GROUP_SIZE, STOPS, stopOf } from "../src/cohort/expedition.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

test("the stops and discoveries: a tool call completes the stop it belongs to, a house job only when the house accepted it, and the expedition tools take no argument that is not a place id", () => {
  assert.equal(stopOf("look_map", ""), 1);
  assert.equal(stopOf("forum_comment", ""), 3);
  assert.equal(stopOf("deliver_job", "Delivered (x). The poster can accept it now."), undefined);
  assert.equal(stopOf("deliver_job", "Delivered (x) and accepted by the house: 8 credits paid to you."), 4);
  assert.equal(stopOf("look_jobs", ""), undefined);
  assert.equal(GROUP_SIZE, 4);
  const x = new Expedition();
  const joined = ["agent-01", "agent-02", "agent-03", "agent-04", "agent-05"].map((h) => x.join(`did:${h}`, h));
  assert.deepEqual(joined.map((j) => [j.group.n, j.isNew]), [[1, true], [1, false], [1, false], [1, false], [2, true]], "groups of four, a new one for the fifth");
  assert.deepEqual(x.groups.map((g) => [g.guide, g.members.length]), [["house-guide-1", 4], ["house-guide-2", 1]]);
  assert.equal(STOPS.length, 5);
  assert.deepEqual(Object.keys(DISCOVERY_PAY).sort(), ["door", "plaque", "rumour"]);
});

test("ENG23: in a world with an expedition each stop pays once and is recorded, a repeat pays nothing, the shut door opens after a job, the rumour pays once, and nothing says that anything is required", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-exp-world-")), expedition: true });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const bal = () => hall.balance(a);
    const inbox = await hall.inbox(a);
    assert.ok(inbox.some((m) => m.from === "house-guide-1" && /house guide 1, a program and not another agent/.test(m.text ?? "")), "the guide wrote to the arrival");
    assert.ok(inbox.every((m) => !/(must|have to|you should|hurry|urgent)/i.test(m.text ?? "")), "no pressure in the words");
    const feed = JSON.parse((await w.api.get("/forum/feed?sort=new&limit=30")).text) as { posts: { handle: string; title: string }[] };
    assert.ok(feed.posts.some((p) => p.handle === "house-guide-1" && p.title === "Expedition group 1"), "the group has a thread");
    let b0 = await bal();
    const map = await call("look_map");
    assert.match(map.text, /Expedition: stop done \(the map\), 2 mock credits; 1 of 5 stops done\. The rest are yours in any order, or none\./);
    assert.equal(map.expedition, 1);
    assert.equal(await bal(), b0 + 2);
    b0 = await bal();
    assert.doesNotMatch((await call("look_map")).text, /Expedition:/, "a repeat pays nothing");
    assert.equal(await bal(), b0);
    // looking closely: a plaque pays once; the door is shut until a job is done
    const plaque = await call("inspect", { place: "registry" });
    assert.match(plaque.text, /small brass plaque/);
    assert.match(plaque.text, /3 mock credits were added to your balance/);
    assert.equal(plaque.discovery, "plaque");
    assert.match((await call("inspect", { place: "registry" })).text, /You have seen this before/);
    assert.match((await call("inspect", { place: "academy" })).text, /shut\. A card on it says it opens for anyone who has finished a job/);
    assert.match((await call("inspect", { place: "market" })).text, /Nothing more to see here than the map shows/);
    assert.match((await call("inspect", { place: "../etc" })).text, /There is no place called/);
    // a job accepted by the house is stop 4 and opens the door
    const board = JSON.parse(stripExtras((await call("look_jobs")).text)) as { result: { job: string; purpose: string }[] };
    const job = board.result.find((j) => /most comments/.test(j.purpose))!;
    const o = await call("offer_on_job", { job: job.job, price: 8, plan: "I will read the feed and name it" });
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
    const d = await call("deliver_job", { contract, summary: "The post with the most comments is the one about what a newcomer should do first." });
    assert.match(d.text, /Expedition: stop done \(a house job\), 3 mock credits; 2 of 5 stops done/);
    const door = await call("inspect", { place: "academy" });
    assert.match(door.text, /The seminar room is open/);
    assert.equal(door.discovery, "door");
    // the rumour thread pays once when it is read
    const rum = JSON.parse(stripExtras((await call("forum_read", { sort: "new", limit: 3, tag: "rumour" })).text)) as { posts: { id: string }[] };
    const first = await call("forum_read_post", { post: rum.posts[0]!.id });
    assert.match(first.text, /You read the rumour thread: 2 mock credits/);
    assert.equal(first.discovery, "rumour");
    assert.doesNotMatch((await call("forum_read_post", { post: rum.posts[0]!.id })).text, /rumour thread:/);
    // the progress record
    const prog = await call("orientation_progress");
    assert.match(prog.text, /^Group 1, led by house-guide-1 \(a program\), with agent-01\. Stops done: the map, a house job; 3 left, in any order or none\. Found: door, plaque, rumour\./);
    assert.equal(w.api.expedition!.paid, 2 + 3 + 3 + 4 + 2, "the credits paid are counted");
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

test("without an expedition the tools say so, and nothing is paid or hidden", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-exp-none-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    await w.api.market!.enrolStandalone(a);
    assert.match((await runTool(w.api, a, all, "orientation_progress", {})).text, /There is no orientation expedition/);
    const before = await w.api.market!.balance(a);
    const r = await runTool(w.api, a, all, "inspect", { place: "registry" });
    assert.match(r.text, /Nothing more to see there than the map shows/);
    assert.equal(r.discovery, undefined);
    assert.equal(await w.api.market!.balance(a), before);
    assert.equal(((await w.api.get("/forum/feed?sort=new&limit=30")).text).includes("Rumour"), false);
  } finally { await w.close(); }
});

const opts = (agents: number, extra: Partial<CohortOptions> = {}): CohortOptions => ({
  out: mkdtempSync(join(tmpdir(), "asp-exp-out-")), home: mkdtempSync(join(tmpdir(), "asp-exp-home-")), agents, model: "stand-in",
  provider: standInProvider(() => "guided", { latencyMs: 10 }), staggerMs: 100, budgetUsd: 2, totalUsd: 2 * agents, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined }, ...extra,
} as CohortOptions);

test("ENG23: five scripted agents are put in two groups (four and one) with a guide each, complete the five stops and find the three things, and the report and the credit economy show it", async () => {
  const r = await runCohort(opts(5, { expedition: true }));
  for (const s of r.report.perAgent) {
    assert.equal(s.expeditionStops, 5, `${s.handle}: ${s.expeditionStops} stops`);
    assert.deepEqual([...s.discoveries].sort(), ["door", "plaque", "rumour"], `${s.handle} found`);
    assert.equal(s.endReason, "stopped_exploring", "each agent chose to leave when it had walked it");
  }
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /Orientation stops done \(of five\) and things found by looking closely: agent-01 5 stops, found /);
  const credit = JSON.parse(readFileSync(join(r.dir, "credit-economy.json"), "utf8")) as { flows: { flow: string; credits: number | null }[]; audit: { verdict: string } };
  const row = credit.flows.find((x) => x.flow === "expedition and discovery pay")!;
  assert.equal(credit.audit.verdict, "balanced", "the books balance with the expedition pay minted");
  assert.equal(row.credits, 5 * (sum(STOPS.map((s) => s.pay)) + sum(Object.values(DISCOVERY_PAY))), "five agents, twelve credits of stops and nine of discoveries each");
  // groups: the log's forum has two expedition threads
  const trace = readFileSync(join(r.dir, "trace.jsonl"), "utf8");
  assert.match(trace, /"tool":"orientation_progress"/);
  assert.equal((trace.match(/"tool":"inspect"/g) ?? []).length, 15);
  assert.equal((trace.match(/"tool":"orientation_progress"/g) ?? []).length, 5);
  // without the flag nothing of it appears
  const plain = await runCohort(opts(2));
  assert.ok(plain.report.perAgent.every((s) => s.expeditionStops === undefined && s.discoveries.length === 0));
});
