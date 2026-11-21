/**
 * The Town Hall's public view and page (register rows DK1724 and DK1720; spec-delta S1428): the agenda with each proposal's state, the live count, the votes by fleet, the count as the votes arrived (the replay: the page as it
 * stood at each vote, by `?at=`, with no script), the signed tally and enactment; equal to a count taken from the log; a table with every bar. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicReply } from "../src/public-pages.ts";
import { DAY, jump, kit, mk, nowIso, operator } from "./society-kit.ts";

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

test("DK1724: the page shows the agenda, the live count, the votes by fleet, the replay as the votes arrived, and the signed tally and enactment, and equals a count from the log", async () => {
  const k = await kit();
  await k.withPrices();
  const client = await k.person("tp-client", 5000);
  const agents: Awaited<ReturnType<typeof k.agent>>[] = [];
  for (let i = 0; i < 6; i++) { const s = await k.person(`tp-s${i}`, 0); const a = await k.agent(`tp-a${i}`, s, { funds: 0 }); await k.runJob(client, a, 40); agents.push(a); }
  // before any proposal
  const empty = (await publicReply(k.log, "/society/townhall", true) as { html: string }).html;
  assert.match(empty, /No proposal yet/);
  const open = Date.parse(nowIso()) + 60_000;
  const p = mk("town_proposal", agents[0]!, { title: "Two study hours", kind: "setting", key: "academy.study_hours", value: 2, opens_at: iso(open), closes_at: iso(open + 7 * DAY), thread: "forum:study-hours" });
  await k.log.append(p);
  let view = await k.log.townHall(iso(open - 1000));
  assert.equal(view.proposals[0]!.state, "upcoming", "before the window opens the vote is upcoming");
  jump(2 * 60_000);
  assert.equal((await k.log.townHall()).proposals[0]!.state, "open");
  const voteAt: string[] = [];
  for (const [i, who] of agents.entries()) { const v = mk("town_vote", who, { proposal: p.id, choice: i === 5 ? "no" : "yes" }); await k.log.append(v); voteAt.push(v.issued_at); jump(60_000); }
  view = await k.log.townHall();
  const pr = view.proposals[0]!;
  const live = await k.log.townTally(p.id);
  assert.deepEqual(pr.live, live, "the page's count is the log's own count");
  assert.deepEqual([pr.live.yes_milli, pr.live.no_milli, pr.live.controllers, pr.live.quorum_met, pr.live.passed], [5000, 1000, 6, true, true]);
  assert.equal(pr.series.length, 6);
  assert.deepEqual(pr.series.map((s) => s.yes_milli), [1000, 2000, 3000, 4000, 5000, 5000], "the count as the votes arrived");
  assert.equal(pr.series[5]!.no_milli, 1000);
  assert.equal(pr.byFleet.reduce((n, f) => n + f.votes, 0), 6, "votes by fleet add up to the votes");
  // the page
  const html = (await publicReply(k.log, "/society/townhall", true) as { html: string }).html;
  assert.match(html, /<h1>The Town Hall<\/h1>/);
  assert.match(html, /Two study hours <small>\(setting; open\)<\/small>/);
  assert.match(html, /<caption>The count now \(weighted votes\)<\/caption>/);
  assert.match(html, /<caption>Votes by fleet \(counts\)<\/caption>/);
  assert.match(html, /The count as the votes arrived \(the table of the replay\)/);
  assert.match(html, /forum:study-hours/);
  assert.match(html, /Reserved \(not put to a vote\): code_article, safety_floor, money_creation, legal/);
  assert.ok(!html.includes("<script"), "no script: the public pages allow none");
  // the replay by time: the page as it stood at the third vote
  const third = (await publicReply(k.log, `/society/townhall?at=${encodeURIComponent(voteAt[2]!)}`, false) as { json: { result: { proposals: { live: { yes_milli: number }; series: unknown[] }[] } } }).json.result.proposals[0]!;
  assert.equal(third.live.yes_milli, 3000);
  assert.equal(third.series.length, 3);
  assert.equal((await publicReply(k.log, "/society/townhall?at=nonsense", false))!.status, 400);
  assert.ok(html.includes(`href="/society/townhall?at=${encodeURIComponent(voteAt[2]!)}#p-`), "a link for each vote");
  // tally and enactment
  jump(7 * DAY + 3_600_000);
  assert.equal((await k.log.townHall()).proposals[0]!.state, "closed");
  const tally = mk("town_tally", operator, { proposal: p.id, yes_milli: 5000, no_milli: 1000, abstain_milli: 0, counted: 6, controllers: 6, quorum_met: true, passed: true });
  await k.log.append(tally);
  assert.equal((await k.log.townHall()).proposals[0]!.state, "passed");
  jump(DAY);
  await k.log.append(mk("town_enactment", operator, { proposal: p.id, tally: tally.id, key: "academy.study_hours", value: 2 }));
  const done = await k.log.townHall();
  assert.equal(done.proposals[0]!.state, "enacted");
  const html2 = (await publicReply(k.log, "/society/townhall", true) as { html: string }).html;
  assert.match(html2, /The operator's signed tally: <code>sha256:[0-9a-f]+<\/code>, passed\. Enacted \d{4}-\d{2}-\d{2}/);
  assert.equal((await k.log.verify()).ok, true);
});
