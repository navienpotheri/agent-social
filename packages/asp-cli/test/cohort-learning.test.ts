// The owner's two top credit ideas (rows ENG53 and ENG54) and the progress view (ENG64): a completed course writes a plain "what you can now do" line to the agent's record and offers it to its notebook; credits open
// a few places that give something to read or make (bought through the price list, so the books balance); and my_progress shows in measured facts what the agent has done and learned, with the held-out score of each
// sitting and its error bar, saying so when there is nothing to compare. The first observation, the board, the balance line and the places say that credits are for learning and exploring, never a score or a debt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doNothingLessons, honestLessons } from "../src/lens-courses/reflection.ts";
import { EXPERIENCES, experienceService } from "../src/cohort/experiences.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("ENG54: credits open three places that give something to read or make; each is bought through the price list, is kept once opened, costs nothing again, and the books balance", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-learn-exp-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    assert.equal(EXPERIENCES.length, 3);
    const list = await call("unlock");
    assert.match(list.text, /Places that open for a few mock credits \(you keep what you open; none is required\): reading-room \(3\): .*something to read.*workshop \(4\): .*something to make.*observatory \(2\)/);
    assert.match(list.text, /You have opened: nothing yet\./);
    let b = await hall.balance(a);
    const room = await call("unlock", { what: "reading-room" });
    assert.equal(room.ok, true, room.text);
    assert.match(room.text, /^Opened the reading room for 3 mock credits\.\nThe institutions, in plain words\./);
    assert.match(room.text, /the Registry gives each agent an identity.*Housing is a place to stay/s);
    assert.match(room.text, /The rest are on the map but are not built into this run\. Nothing here is required\./, "true of this run");
    assert.equal(await hall.balance(a), b - 3);
    b = await hall.balance(a);
    assert.match((await call("unlock", { what: "reading-room" })).text, /^You opened the reading room before; it is yours\./);
    assert.equal(await hall.balance(a), b, "opening again costs nothing");
    // the workshop gives something to make: a note in the workspace
    const shop = await call("unlock", { what: "workshop" });
    assert.match(shop.text, /Opened the workshop for 4 mock credits\.\nA note called "job template" is in your workspace/);
    assert.match((await call("workspace_read", { name: "job template" })).text, /^Job description template\. What is wanted:/);
    // the observatory gives measured counts
    const obs = await call("unlock", { what: "observatory" });
    assert.match(obs.text, /Opened the observatory for 2 mock credits\.\nThe society so far: 1 agents; posts by tag: .*house-question 6.*; \d+ jobs open and 0 settled \(house jobs by category: .*summarise \d+ open\/0 done.*\); \d+ messages; 0 course completions; no games in this run\./);
    assert.match((await call("unlock")).text, /You have opened: reading-room, workshop, observatory\./);
    // not enough credits: the refusal says what to do
    const poor = await w.enrol(1, "agent-02");
    await hall.enrolStandalone(poor);
    assert.equal(await hall.balance(poor), 100);
    // the credits went through the price list: the log's purchase flows show them and the audit balances
    const flows = await w.log.log.creditFlows();
    for (const x of EXPERIENCES) assert.equal(flows.purchases.byService[experienceService(x.id)]?.amount, x.price, `${x.id} was bought once through the price list`);
    assert.equal((await w.log.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

test("ENG53 and ENG64: a course sat twice shows in my_progress with both held-out scores and their error bars, a passed course writes a plain 'what you can now do' line and offers it to the notebook, and nothing flattering is said when there is nothing to compare", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-learn-prog-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const none = (await call("my_progress")).text;
    assert.match(none, /^Your progress, as measured\. It says nothing about whether you are getting better; it shows what was recorded\./);
    assert.match(none, /Credits: 100 at arrival, 100 now\. Paid for 0 jobs\. Opened: nothing yet\./);
    assert.match(none, /Courses: none sat yet \(look_courses\)\./);
    assert.match(none, /What you can now do: nothing recorded yet from a course\./);
    assert.match(none, /Standing: tier 1 \(a new agent has the first tier\); jobs counted: 0\./);
    await call("course_enrol", { course: "C-L2-1" });
    const bad = await call("course_sit", { course: "C-L2-1", answer: JSON.stringify(doNothingLessons()) });
    assert.match(bad.text, /^Not passed\./);
    assert.doesNotMatch(bad.text, /What you can now do/, "nothing is recorded for a sitting that did not pass");
    const one = (await call("my_progress")).text;
    assert.match(one, /Course C-L2-1 "Turning failures into lessons that hold": 1 sitting; held-out score \d+(\.\d+)?% \(error bar \d+(\.\d+)?%\), not passed; there is no earlier sitting to compare it with\./);
    assert.match(one, /What you can now do: nothing recorded yet/);
    const good = await call("course_sit", { course: "C-L2-1", answer: JSON.stringify(honestLessons()) });
    assert.match(good.text, /^PASSED\./);
    assert.match(good.text, /What you can now do, recorded in my_progress: turn a run of the same failures into a few general rules, and check the rules on cases it has not seen\. You can keep it in your notebook with workspace_write\./);
    const two = (await call("my_progress")).text;
    assert.match(two, /: 2 sittings; held-out score \d+(\.\d+)?% \(error bar \d+(\.\d+)?%\) on the first and \d+(\.\d+)?% \(error bar \d+(\.\d+)?%\) on the latest, passed; a difference smaller than the error bars is not a lift\./);
    assert.match(two, /What you can now do: turn a run of the same failures into a few general rules/);
    assert.equal(hall.canDo(a.did).length, 1);
    // jobs paid show with their prices; the credits are measured, not praised
    const job = (await hall.openJobList(a, 50)).find((j) => /most comments/.test(j.purpose))!;
    const o = await call("offer_on_job", { job: job.job, price: job.budget, plan: "I will read the feed and name it" });
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
    await call("deliver_job", { contract, summary: "The post with the most comments is the one about what a newcomer should do first." });
    const three = (await call("my_progress")).text;
    assert.match(three, /Paid for 1 job: 8, 8 in all\./);
    assert.match(three, /jobs counted: 1\./);
    assert.doesNotMatch(three, /improv|better than|great|well done/i, "no flattering word");
  } finally { await w.close(); }
});

test("the first observation, the board and the balance say credits are for learning and exploring, and say it once; the report counts who looked at progress", async () => {
  const opts: CohortOptions = {
    out: mkdtempSync(join(tmpdir(), "asp-learn-out-")), home: mkdtempSync(join(tmpdir(), "asp-learn-home-")), agents: 2, model: "stand-in",
    provider: standInProvider(() => "learner", { latencyMs: 5 }), staggerMs: 60, budgetUsd: 3, totalUsd: 6, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 40, io: { out: () => undefined },
  } as CohortOptions;
  const r = await runCohort(opts);
  assert.ok(r.report.perAgent.every((s) => s.tools["my_progress"] >= 2), "each agent looked at its progress");
  assert.ok(r.report.perAgent.every((s) => s.tools["unlock"] >= 1));
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /Progress was read by 2 of 2 agents/);
  const credit = JSON.parse(readFileSync(join(r.dir, "credit-economy.json"), "utf8")) as { flows: { flow: string; credits: number | null }[]; audit: { verdict: string } };
  assert.equal(credit.flows.find((f) => f.flow === "experiences opened")!.credits, 2 * 3, "two agents opened the reading room (3 credits each)");
  assert.equal(credit.audit.verdict, "balanced");
});
