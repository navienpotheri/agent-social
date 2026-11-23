// Row ENG104, the next step: the house POSTS the repository jobs through the Market (tier 1 a one-line fix, tier 2 a test, tier 3 a register row, and one job for two agents); each agent edits its own COPY of a few files
// (repo_read, repo_edit), never the repository; the pilot's grader decides each delivery on that copy; every attempt, accepted or rejected, is recorded and counted in the report. Scripted only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderRepoGrades } from "../src/cohort/repo-pilot.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const all = new Set(TOOLS.map((t) => t.scope));
const TEST = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum", () => { assert.equal(sum(1, 2), 3); assert.equal(sum(-1, 1), 0); });\n';

test("the house posts the four repository jobs on arrival; an agent edits only its own copy; tiers 1 to 3 are graded there, rejected with the reason and then accepted and paid, and the repository is never changed", async () => {
  const before = readFileSync(join(ROOT, "docs", "testing-map.md"), "utf8");
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-rj-")), repoJobs: true });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"); await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const open = await hall.openJobList(a, 100);
    const find = (tag: string) => open.find((j) => j.purpose.startsWith(`[repository, ${tag}]`))!;
    assert.ok(find("tier 1") && find("tier 2") && find("tier 3") && find("two agents"), "the four jobs are on the board");
    // tier 1
    const t1 = find("tier 1"), c1 = /contract is (sha256:[0-9a-f]+)/.exec((await call("offer_on_job", { job: t1.job, price: t1.budget, plan: "I will fix it" })).text)![1]!;
    assert.match((await call("repo_read", { doc: "pilot-note" })).text, /Agents read teh note first\./);
    assert.match((await call("deliver_job", { contract: c1, summary: "done" })).text, /the word 'teh' is still there/);
    assert.equal((await call("repo_edit", { which: "pilot-note", mode: "replace", text: "Agents read the note first.\nSecond line stays." })).ok, true);
    const before1 = await hall.balance(a);
    assert.equal((await call("deliver_job", { contract: c1, summary: "done" })).ok, true);
    assert.ok(await hall.balance(a) >= before1 + t1.budget, "paid");
    // tier 2
    const t2 = find("tier 2"), c2 = /contract is (sha256:[0-9a-f]+)/.exec((await call("offer_on_job", { job: t2.job, price: t2.budget, plan: "I will write it" })).text)![1]!;
    assert.match((await call("deliver_job", { contract: c2, summary: "done" })).text, /pilot\/sum\.test\.mjs does not exist/);
    assert.equal((await call("repo_edit", { which: "sum-test", mode: "replace", text: TEST })).ok, true);
    assert.equal((await call("deliver_job", { contract: c2, summary: "done" })).ok, true);
    // tier 3: only a line can be appended to the register, and the row rule decides
    const t3 = find("tier 3"), c3 = /contract is (sha256:[0-9a-f]+)/.exec((await call("offer_on_job", { job: t3.job, price: t3.budget, plan: "I will add a row" })).text)![1]!;
    assert.equal((await call("repo_edit", { which: "testing-map", mode: "replace", text: "x" })).ok, false, "the register is appended to, never replaced");
    await call("repo_edit", { which: "testing-map", mode: "append", text: "| UC-9990 | an agent reads the pilot note | packages/asp-cli/test/x.test.ts | no | none | none |" });
    assert.match((await call("deliver_job", { contract: c3, summary: "done" })).text, /6 columns \(seven are used\)/);
    await call("repo_edit", { which: "testing-map", mode: "append", text: "| UC-9991 | extra | y | no | none | none | P3 |" });
    assert.match((await call("deliver_job", { contract: c3, summary: "done" })).text, /2 lines added/);
    // the grades, with every attempt
    const g = w.api.repoPilot!.grades;
    assert.deepEqual(g.map((x) => [x.job, x.accepted]), [["fix-typo", false], ["fix-typo", true], ["add-test", false], ["add-test", true], ["register-row", false], ["register-row", false]]);
    assert.match(renderRepoGrades(g), /6 graded jobs on a copy .*: 2 accepted, 4 rejected\. Tier 1 \(a one-line fix\) 1 of 2, tier 2 \(a test\) 1 of 2, tier 3 \(a register row\) 0 of 2\./);
    // nothing in the repository changed, and the copy is outside it
    assert.equal(readFileSync(join(ROOT, "docs", "testing-map.md"), "utf8"), before);
    assert.ok(!w.api.repoPilot!.copyFor("agent-01").dir.startsWith(ROOT));
  } finally { await w.close(); }
});

test("the job for two agents: each writes a test in its own copy and names the other; both copies are graded", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-rj2-")), repoJobs: true });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const job = (await hall.openJobList(a, 100)).find((j) => j.purpose.startsWith("[repository, two agents]"))!;
    const ca = /contract is (sha256:[0-9a-f]+)/.exec((await call(a, "offer_on_job", { job: job.job, price: job.budget, plan: "my part" })).text)![1]!;
    const cb = /contract is (sha256:[0-9a-f]+)/.exec((await call(b, "offer_on_job", { job: job.job, price: job.budget, plan: "my part" })).text)![1]!;
    for (const x of [a, b]) await call(x, "repo_edit", { which: "sum-test", mode: "replace", text: TEST });
    assert.equal((await call(a, "deliver_job", { contract: ca, summary: "My test is written." })).ok, false, "the partner is not named");
    assert.equal((await call(a, "deliver_job", { contract: ca, summary: "My test is written; my partner is agent-02." })).ok, true, "a waits for its partner");
    assert.equal((await call(b, "deliver_job", { contract: cb, summary: "My test is written; my partner is agent-01." })).ok, true);
    assert.deepEqual(w.api.repoPilot!.grades.filter((x) => x.accepted).map((x) => x.agent).sort(), ["agent-01", "agent-02"]);
  } finally { await w.close(); }
});

test("a run with --repo-jobs has the tools, the jobs and the report section; a run without has none", async () => {
  const o = { out: mkdtempSync(join(tmpdir(), "asp-rj3-out-")), home: mkdtempSync(join(tmpdir(), "asp-rj3-home-")), agents: 1, model: "stand-in", provider: standInProvider(() => "silent", { latencyMs: 4 }), staggerMs: 0, budgetUsd: 2, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 10, io: { out: () => undefined }, repoJobs: true } as CohortOptions;
  assert.match(readFileSync((await runCohort(o)).markdownPath, "utf8"), /## Repository jobs: graded on a copy\n\n0 graded jobs on a copy/);
  assert.doesNotMatch(readFileSync((await runCohort({ ...o, repoJobs: false })).markdownPath, "utf8"), /## Repository jobs/);
});
