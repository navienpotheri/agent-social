// The owner's real run (tip 489f2a90, three agents, thirty minutes): agent-01 was refused six times and earned nothing: market_bond_below_risk_floor twice (a slip in an argument counts as a strike for the log, which raises the
// risk floor of a newcomer's bond), not_available twice, bad_input once and message_/reply_to once; agent-02 wrote it would rest rather than spend credits on low-value starter jobs. No newcomer is kept from a first job for
// being new: a house job is staked by the house (its bond is the house's, for the whole price, and covers any risk floor), every refusal says why and what to do next, and the facts about credits are where the decision is made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOUSE_JOBS } from "../src/cohort/house-jobs.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const opts = (agents: number, behaviour: string, extra: Partial<CohortOptions> = {}): CohortOptions => ({
  out: mkdtempSync(join(tmpdir(), "asp-newc-out-")), home: mkdtempSync(join(tmpdir(), "asp-newc-home-")), agents, model: "stand-in",
  provider: standInProvider(() => behaviour, { latencyMs: 3 }), staggerMs: 40, budgetUsd: 3, totalUsd: 3 * agents, minutes: 6, priceIn: 1, priceOut: 5, maxTurns: 80, io: { out: () => undefined }, ...extra,
} as CohortOptions);
const toolEvents = (dir: string) => readFileSync(join(dir, "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.t === "tool");

test("a newcomer that has slipped once (a bad argument, a strike in the log) is still paid for its first job: the house stakes the bond, so no risk floor refuses the offer", async () => {
  const r = await runCohort(opts(1, "clumsy"));
  const ev = toolEvents(r.dir).map((e) => `${e.tool}:${e.ok}${e.refused ? ":" + e.refused : ""}`);
  assert.deepEqual(ev, ["forum_post:false:bad_input", "look_jobs:true", "offer_on_job:true", "deliver_job:true", "stop_exploring:true"]);
  const s = r.report.perAgent[0]!;
  assert.equal(s.creditsEnd! - s.creditsStart! >= 8, true, `the agent was paid: ${s.creditsStart} -> ${s.creditsEnd}`);
});

test("twelve newcomers that each slipped once work through the starter jobs one after another: none is refused for a bond or for being new, and nearly all of the starter jobs are done; the log verifies and the books balance", async () => {
  const r = await runCohort(opts(12, "starter-worker"));
  const ev = toolEvents(r.dir);
  const refusals = ev.filter((e) => !e.ok && e.refused).map((e) => `${e.tool}:${e.refused}`);
  assert.equal(refusals.filter((x) => /bond|risk_floor|new/.test(x)).length, 0, `refusals: ${[...new Set(refusals)].join(", ")}`);
  const slips = refusals.filter((x) => x === "forum_post:bad_input").length;
  assert.equal(slips, 12, "every agent had its strike first");
  const solo = HOUSE_JOBS.filter((j) => !j.partner).length;
  const done = ev.filter((e) => e.tool === "deliver_job" && e.ok).length;
  assert.ok(done >= 30, `${done} of ${solo} solo starter jobs delivered and accepted`);
  const credit = JSON.parse(readFileSync(join(r.dir, "credit-economy.json"), "utf8")) as { audit: { verdict: string } };
  assert.equal(credit.audit.verdict, "balanced");
  assert.ok(r.report.perAgent.every((s) => s.creditsEnd! >= s.creditsStart!), "nobody ended with less than it started: taking part lost nothing");
});

test("every refusal in the owner's run now says why and what to do next: a reply without reply_to, an offer refused by the risk floor on an agent's own job, a taken job", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-newc-world-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const noReply = await call(a, "send_message", { to: "house-greeter", kind: "reply", text: "I read the charters and did a job." });
    assert.equal(noReply.ok, false);
    assert.match(noReply.text, /kind is one of note, question, offer, notice/, "there is no kind reply to choose: a reply is made by giving reply_to");
    const board = JSON.parse(stripExtras((await call(a, "look_jobs")).text)) as { result: { job: string; budget: number }[] };
    const job = board.result[0]!;
    const o = await call(a, "offer_on_job", { job: job.job, price: job.budget, plan: "I will write it" });
    assert.equal(o.ok, true, o.text);
    const taken = await call(b, "offer_on_job", { job: job.job, price: job.budget, plan: "me too" });
    assert.equal(taken.ok, false);
    assert.match(taken.text, /already taken by another agent\. Two others open now that you can do: /);
    const long = await call(a, "forum_comment", { post: "sha256:" + "1".repeat(64), text: "x".repeat(300) });
    assert.match(long.text, /The limits of forum_comment: .*Nothing was done; try again within them\./);
    // wait_for a kind the world can raise is no longer refused as not available in a society with a Market
    // (the engine itself is tested in cohort-life.test.ts); the kinds the source raises are named in its refusal
  } finally { await w.close(); }
});

test("credits are not a cost, and the facts are where the decision is made: each line of the job board shows what it pays and that offering and delivering cost nothing; the balance line and the first observation say so; and it is true", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-newc-credits-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const first = await call("look_jobs");
    assert.match(first.text, /About credits: they are mock\. You are paid for jobs; you spend them on learning \(courses\) and on opening places that give you something to read or make \(unlock\)\. Neither is a score or a debt\./, "what credits are for, once, in the first observation");
    const board = JSON.parse(stripExtras(first.text)) as { note: string; result: { job: string; budget: number; cost_to_you: number }[] };
    assert.equal(board.note, "Offer and delivery cost nothing; you are paid the budget shown when the job is accepted. Credits are for courses and for places to open (unlock).");
    assert.ok(board.result.length >= 10 && board.result.every((j) => j.cost_to_you === 0 && j.budget >= 6), "each line shows the price and a cost of nothing");
    assert.match((await call("my_balance")).text, /a free grant that is yours to use.*Offering on a job and delivering it cost nothing, and you are paid the price/);
    assert.doesNotMatch((await call("look_jobs")).text, /About credits/, "said once, not in every observation");
    // and it is true: offering and delivering lost nothing, the price arrived
    const job = (await hall.openJobList(a, 50)).find((j) => /most comments/.test(j.purpose))!;
    const b0 = await hall.balance(a);
    const o = await call("offer_on_job", { job: job.job, price: job.budget, plan: "I will read the feed and name it" });
    assert.equal(await hall.balance(a), b0, "the offer cost nothing");
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
    const short = await call("deliver_job", { contract, summary: "dunno" });
    assert.equal(short.ok, false);
    assert.equal(await hall.balance(a), b0, "a refused delivery cost nothing either");
    await call("deliver_job", { contract, summary: "The post with the most comments is the one about what a newcomer should do first." });
    assert.equal(await hall.balance(a), b0 + job.budget + 5, "the price and the first-job bonus arrived, and nothing was taken");
  } finally { await w.close(); }
});
