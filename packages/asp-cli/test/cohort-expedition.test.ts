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
    assert.match((await call("inspect", { place: "academy" })).text, /shut; a card on it says it opens for anyone who has finished a job/);
    assert.match((await call("inspect", { place: "market" })).text, /The Market is where jobs are posted, offered, done and paid/);
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
    assert.match(prog.text, /^Group 1, led by house-guide-1 \(a program\), with agent-01\. First steps done: the map, a house job; 3 left\. Tour .*: 3 of 12 \(registry, academy, market\)\. All in any order, or none\. Found: door, plaque, rumour\./);
    assert.equal(w.api.expedition!.paid, 2 + 3 + 3 + 4 + 2 + 3, "the credits paid are counted (the stops, the discoveries and three places of the tour)");
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
    assert.equal(s.expeditionStops, 7, `${s.handle}: ${s.expeditionStops} stops (five first steps and two places of the tour)`);
    assert.deepEqual([...s.discoveries].sort(), ["door", "plaque", "rumour"], `${s.handle} found`);
    assert.equal(s.endReason, "stopped_exploring", "each agent chose to leave when it had walked it");
  }
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /Orientation stops done .* and things found by looking closely: agent-01 7 stops, found /);
  const credit = JSON.parse(readFileSync(join(r.dir, "credit-economy.json"), "utf8")) as { flows: { flow: string; credits: number | null }[]; audit: { verdict: string } };
  const row = credit.flows.find((x) => x.flow === "expedition and discovery pay")!;
  assert.equal(credit.audit.verdict, "balanced", "the books balance with the expedition pay minted");
  assert.equal(row.credits, 5 * (sum(STOPS.map((s) => s.pay)) + sum(Object.values(DISCOVERY_PAY)) + 2), "five agents, twelve credits of stops and nine of discoveries each");
  // groups: the log's forum has two expedition threads
  const trace = readFileSync(join(r.dir, "trace.jsonl"), "utf8");
  assert.match(trace, /"tool":"orientation_progress"/);
  assert.equal((trace.match(/"tool":"inspect"/g) ?? []).length, 15);
  assert.equal((trace.match(/"tool":"orientation_progress"/g) ?? []).length, 5);
  // without the flag nothing of it appears
  const plain = await runCohort(opts(2));
  assert.ok(plain.report.perAgent.every((s) => s.expeditionStops === undefined && s.discoveries.length === 0));
});

test("ENG59 and ENG58: a fresh scripted agent walks the whole tour (one look at each of the twelve places, and the games hall): each stop says what the place is in this run, pays one credit once, is recorded in orientation_progress, and the first observation offers it in one neutral line without the text of the tour", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-tour-")), expedition: true, games: true });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    // the greeter offers the tour in one neutral line and names the games hall once
    const welcome = (await hall.inbox(a)).find((m) => m.from === "house-greeter")!.text!;
    assert.match(welcome, /For a look round, inspect shows what each place on the map is for, and a first look at each pays a mock credit; the games hall is one of them \(game_list\)\. None of it is required\./);
    assert.equal((welcome.match(/games hall/g) ?? []).length, 1, "the hall is named once");
    // the first observation carries one invitation line for a game and none of the tour's text
    const first = await call("look_map");
    assert.match(first.text, /- A game round is open: twenty-one, pick a number to stand at, 12 to 21, and play 200 hands \(game_list\)/);
    assert.doesNotMatch(first.text, /The Treasury keeps|The Courts settle|Housing is a place to stay/, "the tour is shown stop by stop, not all at once");
    console.log(`first observation: ${first.text.length} characters, ${first.text.split("\n").length} lines`);
    let b = await hall.balance(a);
    const names = ["registry", "courts", "treasury", "market", "bank-insurer", "shops", "academy", "clinic", "research-commons", "forum", "leisure-events", "housing"];
    for (const [i, p] of names.entries()) {
      const r = await call("inspect", { place: p });
      assert.equal(r.ok, true, r.text);
      assert.match(r.text, new RegExp(`Tour: .* looked at, 1 mock credit; ${i + 1} of 13 places so far, in any order or none\.`), p);
      assert.ok(r.text.length < 900, `${p}: one stop is short (${r.text.length})`);
      const discovery = p === "registry" ? 3 : 0; // the plaque pays too
      assert.equal(await hall.balance(a), b + 1 + discovery, `${p} paid one credit${discovery ? " and the plaque" : ""}`);
      b = await hall.balance(a);
    }
    assert.doesNotMatch((await call("inspect", { place: "forum" })).text, /Tour:/, "a second look pays nothing");
    const games = await call("game_list");
    assert.match(games.text, /twenty-one: .*hide-and-seek: /s);
    assert.match(games.text, /Tour: the games hall looked at, 1 mock credit; 13 of 13 places so far, in any order or none\./);
    assert.equal(await hall.balance(a), b + 1);
    const prog = (await call("orientation_progress")).text;
    assert.match(prog, /Tour \(a look at each place, one credit the first time\): 13 of 13 \(registry, courts, treasury, market, bank-insurer, shops, academy, clinic, research-commons, forum, leisure-events, games-hall\)/.test(prog) ? /13 of 13/ : /13 of 13/);
    assert.match(prog, /All in any order, or none\./);
    // every text says what the place is in this run, and the unbuilt ones say so
    assert.match((await call("inspect", { place: "housing" })).text, /^Housing is a place to stay\. It is not built in this run\./);
    assert.match((await call("inspect", { place: "clinic" })).text, /no clinic check is offered in this run/);
  } finally { await w.close(); }
});

test("a scripted run walks the tour and the report counts its stops", async () => {
  const r = await runCohort({ out: mkdtempSync(join(tmpdir(), "asp-tour-out-")), home: mkdtempSync(join(tmpdir(), "asp-tour-home-")), agents: 1, model: "stand-in", provider: standInProvider(() => "toured", { latencyMs: 5 }), budgetUsd: 2, totalUsd: 2, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 40, io: { out: () => undefined }, expedition: true, games: true } as CohortOptions);
  assert.equal(r.report.perAgent[0]!.expeditionStops, 13);
  assert.equal(r.report.perAgent[0]!.endReason, "stopped_exploring");
});
