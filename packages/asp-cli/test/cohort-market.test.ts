// Row DK1801, slice 2: the Market of the local society. Two scripted agents hire each other through the tools (post a job from its own credits, offer, accept, deliver, accept the delivery, pay), every step a signed record of
// the local log and the credits moving through the log's own escrow and settlement; the log verifies and the audit balances; the report shows the offer, the hire and the payment as edges; refusals come back with the log's rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("DK1801 slice 2: a poster and a worker hire each other through the tools and the credits move through the log's escrow and settlement", async () => {
  const out = mkdtempSync(join(tmpdir(), "asp-cohort-mkt-")), home = mkdtempSync(join(tmpdir(), "asp-cohort-mkthome-"));
  const r = await runCohort({ out, home, agents: 2, model: "stand-in", provider: standInProvider((i) => (i === 0 ? "hirer" : "worker"), { latencyMs: 25 }), staggerMs: 150, budgetUsd: 1, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined } });
  const [poster, worker] = [r.report.perAgent[0], r.report.perAgent[1]];
  assert.equal(poster.endReason, "stopped_exploring", `${poster.endReason}`);
  assert.equal(worker.endReason, "stopped_exploring", `${worker.endReason}`);
  assert.ok(Object.keys(poster.institutions).includes("market") && Object.keys(worker.institutions).includes("market"));
  const e = (from: string, to: string) => r.report.edges.find((x) => x.from === from && x.to === to);
  assert.equal(e("agent-02", "agent-01")?.offers, 1, "the worker offered on the poster's job");
  assert.equal(e("agent-01", "agent-02")?.hires, 1, "the poster hired the worker");
  assert.equal(e("agent-01", "agent-02")?.paid, 1, "and paid it");
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /agent-01 → agent-02: hired 1 time, paid 1 time/);
  assert.match(md, /agent-02 → agent-01: 1 offer on a job/);
  assert.equal(r.report.refusedByRule["tool_not_in_set"] ?? 0, 0);
  // the credits table: the poster paid the 20-credit price and the 2-credit posting deposit; the worker was paid the price; the job tax of a 20-credit job is below one credit
  assert.deepEqual([poster.creditsStart, poster.creditsEnd, worker.creditsStart, worker.creditsEnd], [100, 78, 100, 120]);
  assert.match(md, /\| agent-01 \| 100 \| 78 \| -22 \|/);
  assert.match(md, /\| agent-02 \| 100 \| 120 \| \+20 \|/);
  assert.match(md, /## What the agents said while they acted/);
  assert.match(md, /No agent said anything alongside its calls/, "the stand-in says nothing alongside its calls");
});

test("DK1801 slice 2: the hall's steps are signed records, the balances move by the price, the log verifies and the audit balances, and the log's own rules refuse what they refuse", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-cohort-hall-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02"), c = await w.enrol(2, "agent-03");
    const hall = w.api.market!;
    for (const x of [a, b, c]) await hall.enrolStandalone(x);
    assert.deepEqual([await hall.balance(a), await hall.balance(b)], [100, 100]);
    const call = (agent: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, agent, all, name, input);
    const posted = await call(a, "post_job", { purpose: "Check the README for broken links", budget: 20, criterion: "a list of broken links" });
    assert.equal(posted.ok, true, posted.text);
    const intent = /Its id is (sha256:[0-9a-f]+)/.exec(posted.text)![1]!;
    assert.equal(await hall.balance(a), 98, "the 2-credit posting deposit");
    const tooBig = await call(c, "post_job", { purpose: "x", budget: 50, criterion: "y" });
    assert.equal(tooBig.ok, true, "50 credits are within 100");
    const ghost = await call(c, "offer_on_job", { job: "sha256:" + "9".repeat(64), price: 10, plan: "x" });
    assert.equal(ghost.ok, false, "an offer on a job that is not in the log");
    assert.match(ghost.refused ?? "", /^market_/);
    const offered = await call(b, "offer_on_job", { job: intent, price: 20, plan: "I will check each link" });
    assert.equal(offered.ok, true, offered.text);
    assert.equal(offered.targetAuthor, a.did, "the offer is addressed to the poster");
    assert.equal((await call(a, "offer_on_job", { job: intent, price: 10, plan: "x" })).ok, false, "not on your own job");
    const offerId = /sha256:[0-9a-f]+/.exec(offered.text)![0];
    const notMine = await call(c, "accept_offer", { offer: offerId });
    assert.equal(notMine.ok, false, "only the poster accepts");
    const accepted = await call(a, "accept_offer", { offer: offerId });
    assert.equal(accepted.ok, true, accepted.text);
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(accepted.text)![1]!;
    const early = await call(a, "accept_delivery", { contract });
    assert.deepEqual([early.ok, early.refused], [false, "market_refused"]);
    assert.match(early.text, /nothing has been delivered yet/);
    const wrongWorker = await call(a, "deliver_job", { contract, summary: "x" });
    assert.match(wrongWorker.text, /not the performer/);
    assert.equal(wrongWorker.refused, "market_refused", "refused by the hall before the log is asked");
    const wrongPoster = await call(b, "accept_delivery", { contract });
    assert.match(wrongPoster.text, /not the principal/);
    const d = await w.enrol(3, "agent-04");
    await hall.enrolStandalone(d);
    const second = await call(d, "offer_on_job", { job: intent, price: 15, plan: "me too" });
    const secondOffer = /sha256:[0-9a-f]+/.exec(second.text)![0];
    assert.match((await call(a, "accept_offer", { offer: secondOffer })).text, /already has a contract/);
    assert.equal((await call(b, "deliver_job", { contract, summary: "Three links are broken." })).ok, true);
    const settled = await call(a, "accept_delivery", { contract });
    assert.equal(settled.ok, true, settled.text);
    assert.equal(await hall.balance(a), 78);
    assert.equal(await hall.balance(b), 120);
    assert.match((await call(a, "accept_delivery", { contract })).text, /already settled/, "settled once");
    const again = await call(b, "deliver_job", { contract, summary: "again" });
    assert.match(again.text, /already has a delivery/);
    assert.match((await call(b, "my_jobs")).text, /you are the worker.*settled/);
    assert.match((await call(a, "read_history")).text, /intent|market_act|contract/);
    const log = (w as unknown as { api: { market: unknown } }).api.market as { log: { log: { verify(): Promise<{ ok: boolean }>; creditAudit(): Promise<{ verdict: string }> } } };
    assert.equal((await log.log.log.verify()).ok, true, "the log verifies");
    assert.equal((await log.log.log.creditAudit()).verdict, "balanced");
    assert.ok(((await w.api.get("/market/board")).text.match(/"intent"/g) ?? []).length >= 3, "the board lists the house jobs and the agents' postings");
  } finally { await w.close(); }
});
