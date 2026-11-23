// Rows UC-2209..: ENG84 (scale and difficulty), the first three of the owner's four directions: (a) a project of three dependent parts with a prize of 50 mock credits that cannot be finished alone (it is delivered by citing three
// settled jobs the holder posted that three different agents did), (b) a specialist job that asks for a course certificate, (c) repository tasks over read-only copies of real documents with answers the house checks.
// (d) the helper tool is a design note only. Scripted only; the checks are the house's and the same for everyone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const all = new Set(TOOLS.map((t) => t.scope));
type W = Awaited<ReturnType<typeof bootWorld>>;
const setup = async (n: number): Promise<{ w: W; agents: Awaited<ReturnType<W["enrol"]>>[]; call: (i: number, name: string, input?: Record<string, unknown>) => ReturnType<typeof runTool> }> => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-hard-")), hardJobs: true });
  const agents: Awaited<ReturnType<W["enrol"]>>[] = [];
  for (let i = 0; i < n; i++) { const x = await w.enrol(i, `agent-0${i + 1}`); await w.api.market!.enrolStandalone(x); agents.push(x); }
  return { w, agents, call: (i, name, input = {}) => runTool(w.api, agents[i]!, all, name, input) };
};
const jobId = async (w: W, who: Awaited<ReturnType<W["enrol"]>>, tag: string): Promise<{ job: string; budget: number }> => (await w.api.market!.openJobList(who, 200)).find((j) => j.purpose.startsWith(tag))!;

test("(a) a project is delivered by citing three settled jobs the holder posted that three different agents did; fewer is refused with what to do; the prize is paid by the house", async () => {
  const { w, agents, call } = await setup(4);
  try {
    const hall = w.api.market!;
    const project = await jobId(w, agents[0]!, "[project]");
    assert.equal(project.budget, 50);
    const taken = await call(0, "offer_on_job", { job: project.job, price: 50, plan: "I will post the three parts" });
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(taken.text)![1]!;
    assert.equal((await call(0, "deliver_job", { contract, summary: "I did it all myself, here is the guide: a job is a request." })).ok, false);
    const cited: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const posted = await call(0, "post_job", { purpose: `Write part ${k} of the field guide to the Market in two sentences`, budget: 10, criterion: "two sentences" });
      const offer = await call(k, "offer_on_job", { job: /sha256:[0-9a-f]+/.exec(posted.text)![0], price: 10, plan: "I will write it" });
      const acc = await call(0, "accept_offer", { offer: /sha256:[0-9a-f]+/.exec(offer.text)![0] });
      const c = /contract is (sha256:[0-9a-f]+)/.exec(acc.text)![1]!;
      assert.equal((await call(k, "deliver_job", { contract: c, summary: `Part ${k}: a market part, written by agent ${k}. It has two sentences.` })).ok, true);
      assert.equal((await call(0, "accept_delivery", { contract: c })).ok, true);
      cited.push(c);
      if (k === 2) { const few = await call(0, "deliver_job", { contract, summary: `Sources: ${cited.join(" ")}` }); assert.equal(few.ok, false); assert.match(few.text, /you cited 2\); nothing was recorded: post the parts as jobs/); }
    }
    const before = await hall.balance(agents[0]!);
    const done = await call(0, "deliver_job", { contract, summary: `The field guide, in three parts by three agents. Sources: ${cited.join(" ")}` });
    assert.equal(done.ok, true, done.text);
    assert.equal(await hall.balance(agents[0]!), before + 50 + 5, "the house pays the prize of 50 and the first-job bonus of 5");
    assert.deepEqual([hall.hardStats["project"]!.taken, hall.hardStats["project"]!.delivered], [1, 1]);
    assert.equal(hall.agentJobStats().accepted, 3, "three agent-to-agent settlements");
    assert.equal((await w.log.log.creditAudit()).verdict, "balanced");
  } finally { await w.close(); }
});

test("(b) the specialist job is refused without the certificate of the course, taken with it, and the check is the same for everyone", async () => {
  const { w, agents, call } = await setup(2);
  try {
    const hall = w.api.market!;
    const job = await jobId(w, agents[0]!, "[specialist]");
    const no = await call(0, "offer_on_job", { job: job.job, price: job.budget, plan: "I will review it" });
    assert.equal(no.ok, false);
    assert.match(no.text, /this job asks for the certificate of the course C-L2-1: look_courses shows it, course_enrol and course_sit earn it/);
    hall.certify(agents[1]!.did, "C-L2-1", true);
    const yes = await call(1, "offer_on_job", { job: job.job, price: job.budget, plan: "I will review it" });
    assert.equal(yes.ok, true, yes.text);
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(yes.text)![1]!;
    assert.equal((await call(1, "deliver_job", { contract, summary: "A learner could not yet plan a lesson." })).ok, false, "three sentences are asked for");
    assert.equal((await call(1, "deliver_job", { contract, summary: "A learner could not yet plan a lesson. They could not yet check their own work. They could not yet teach it to another agent." })).ok, true);
    assert.deepEqual([hall.hardStats["specialist"]!.refused, hall.hardStats["specialist"]!.taken, hall.hardStats["specialist"]!.delivered], [1, 1, 1]);
  } finally { await w.close(); }
});

test("(c) repository tasks: the documents are read-only copies of real text, the answer is checked against them, and a wrong one is refused with what is missing", async () => {
  const { w, agents, call } = await setup(1);
  try {
    assert.match((await call(0, "repo_read")).text, /^Documents \(read-only copies of real project documents\): about-asp: About Agent Social/);
    assert.match((await call(0, "repo_read", { doc: "about-asp" })).text, /ASP, version 0\.2/);
    assert.equal((await call(0, "repo_read", { doc: "nope" })).ok, false);
    const job = await jobId(w, agents[0]!, "[repository] Read the document about-asp");
    const c = /contract is (sha256:[0-9a-f]+)/.exec((await call(0, "offer_on_job", { job: job.job, price: job.budget, plan: "I will read it" })).text)![1]!;
    const bad = await call(0, "deliver_job", { contract: c, summary: "The protocol gives an agent a signed identity and a way to settle disputes." });
    assert.equal(bad.ok, false);
    assert.match(bad.text, /name the protocol's version number \(it is in the document\)/);
    assert.equal((await call(0, "deliver_job", { contract: c, summary: "ASP version 0.2 gives an agent a signed identity, a Mandate and a bond." })).ok, true);
  } finally { await w.close(); }
});

test("the report says what came of the harder jobs and that no helper was built; a run without --hard-jobs has none of it", async () => {
  const o = { out: mkdtempSync(join(tmpdir(), "asp-hard-out-")), home: mkdtempSync(join(tmpdir(), "asp-hard-home-")), agents: 1, model: "stand-in", provider: standInProvider(() => "silent", { latencyMs: 4 }), staggerMs: 0, budgetUsd: 2, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 20, io: { out: () => undefined }, hardJobs: true } as CohortOptions;
  const md = readFileSync((await runCohort(o)).markdownPath, "utf8");
  assert.match(md, /## Harder jobs: projects, certificates, repository tasks\n\nProject \(three parts by three other agents, a prize of 50 mock credits\): taken by 0 agents, delivered 0 times\. Delegation: 0 of 1 agents posted a job, 0 jobs were posted by agents and 0 settled agent to agent\./);
  assert.match(md, /Helpers: none were built or started in this run \(the helper tool is a design note only\)\./);
  assert.doesNotMatch(readFileSync((await runCohort({ ...o, hardJobs: false })).markdownPath, "utf8"), /## Harder jobs/);
});
