// Diagnosis fix 6 (section 57): the course line names the open jobs that ask for its certificate and what they pay, so that the choice to enrol is made with its use in view (the one agent that sat a course in the 2026-11-24 run
// did so for exactly such a job). Only when there is such a job; a true clause, nothing asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invitationsFor, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("with the specialist job on the board the course lines say what its certificate is for; without it they do not; once the job is taken the clause goes", async () => {
  for (const hard of [false, true]) {
    const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-cu-")), ...(hard ? { hardJobs: true } : {}) });
    try {
      const hall = w.api.market!;
      const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
      for (const x of [a, b]) await hall.enrolStandalone(x);
      w.api.groups = new Set(["agenda", "repo"]);
      const course = hall.courseList()[0]!;
      const inv = (await invitationsFor(w.api, a)).find((l) => /^A course is open/.test(l))!;
      const agenda = (await runTool(w.api, a, all, "my_agenda", {})).text;
      if (!hard) { assert.doesNotMatch(inv + agenda, /certificate is also what/); continue; }
      const clause = `; its certificate is also what this job asks for: "Review a short lesson plan for the Academy and say what a learner would still be" pays 40`;
      assert.equal(inv, `A course is open: ${course.title}, ${course.price} credits (course_enrol ${course.id})${clause}`);
      assert.ok(agenda.includes(`a course: ${course.title}, ${course.price} mock credits to enrol; what it taught shows in my_progress${clause} (course_enrol ${course.id})`), agenda);
      // taken by an agent that holds the certificate: the clause goes
      hall.certify(b.did, course.id, true);
      const job = (await hall.openJobList(b, 100)).find((j) => j.purpose.startsWith("[specialist]"))!;
      assert.equal((await runTool(w.api, b, all, "offer_on_job", { job: job.job, price: job.budget, plan: "I will review it" })).ok, true);
      assert.doesNotMatch((await invitationsFor(w.api, a)).join(" "), /certificate is also what/);
    } finally { await w.close(); }
  }
});
