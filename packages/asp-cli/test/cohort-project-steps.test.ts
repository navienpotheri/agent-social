// Diagnosis fix 7 (section 57): the offer on a project lists its steps where the choice is made: what is to be posted, accepted and cited, what it costs (the first posted job is free, the others cost their budgets), and that the job may stay
// open. In the 2026-11-24 run an agent took the project, was refused "needs 3 settled contracts from jobs I post", and left it stuck for hours. A true statement of the steps; nothing is asked. Scripted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("the offer on the project lists its steps; an offer on another job does not", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-ps-")), hardJobs: true });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"); await hall.enrolStandalone(a);
    const open = await hall.openJobList(a, 100);
    const project = open.find((j) => j.purpose.startsWith("[project]"))!, other = open.find((j) => !/^\[(project|specialist|repository|battery)\]|Partner job/.test(j.purpose))!;
    const o = await runTool(w.api, a, all, "offer_on_job", { job: project.job, price: project.budget, plan: "I will post the parts" });
    assert.equal(o.ok, true, o.text);
    assert.match(o.text, /The steps of this project: post three part-jobs \(post_job; the first job you post is free, the others cost their budgets\), have a different agent do each \(accept_offer, then accept_delivery\), then deliver here naming the three contract ids\. Until then the delivery is refused with what is missing, and the job may stay open as long as you like\./);
    assert.doesNotMatch(o.text, /you must|hurry/i);
    const p = await runTool(w.api, a, all, "offer_on_job", { job: other.job, price: other.budget, plan: "I will do it" });
    assert.doesNotMatch(p.text, /steps of this project/);
  } finally { await w.close(); }
});
