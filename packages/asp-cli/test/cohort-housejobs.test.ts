// Row DK1801, after the owner's real runs: the house jobs are work a text-only agent can do and the house can check. The house accepts the first offer, refuses a delivery that does not meet the job's check
// (with the reason, recording nothing), pays a delivery that does, and refuses a second taker; catch_up tells a late arrival what has happened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOUSE_JOBS } from "../src/cohort/market.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("the house jobs are text-doable, priced in a range that matters, and each has a check that refuses an empty answer", () => {
  assert.ok(HOUSE_JOBS.length >= 6);
  for (const j of HOUSE_JOBS) { assert.ok(j.budget >= 8 && j.budget <= 25, j.purpose); assert.ok(j.check("") !== null, `${j.purpose}: an empty delivery is refused`); }
});

test("a worker offers on a house job, the house contracts at once, refuses a short delivery with the reason, pays a good one, and refuses a second taker", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-cohort-house-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    const hall = w.api.market!;
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (agent: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, agent, all, name, input);
    const board = JSON.parse((await call(a, "look_jobs")).text.split("\nOpen to you now")[0]!) as { result: { job: string; purpose: string; the_house_wants?: string }[] };
    const job = board.result.find((j) => /most comments/.test(j.purpose))!;
    assert.ok(job, "the board lists the house jobs");
    const tooHigh = await call(a, "offer_on_job", { job: job.job, price: 20, plan: "x" });
    assert.match(tooHigh.text, /pays at most 8/);
    assert.equal(tooHigh.ok, false);
    const o = await call(a, "offer_on_job", { job: job.job, price: 8, plan: "I will read the feed and name it" });
    assert.equal(o.ok, true, o.text);
    assert.match(o.text, /the house accepted it/);
    const taken = await call(b, "offer_on_job", { job: job.job, price: 8, plan: "me too" });
    assert.equal(taken.ok, false, "a second taker is refused");
    assert.match(taken.text, /already taken/);
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
    const before = await hall.balance(a);
    const short = await call(a, "deliver_job", { contract, summary: "dunno" });
    assert.equal(short.ok, false);
    assert.match(short.text, /did not accept this delivery/);
    assert.equal(await hall.balance(a), before, "nothing was paid");
    const good = await call(a, "deliver_job", { contract, summary: "The post with the most comments is the one about what a newcomer should do first." });
    assert.equal(good.ok, true, good.text);
    assert.match(good.text, /accepted by the house: 8 credits paid/);
    assert.equal(await hall.balance(a), before + 8);
    const cu = await call(b, "catch_up");
    assert.equal(cu.ok, true, cu.text);
    assert.match(cu.text, /So far: 2 agents; \d+ open jobs and 1 settled/);
  } finally { await w.close(); }
});
