// Row DK1801, slice 2: the Academy of the local society. A course is priced and published at the start; an agent pays the tuition from its mock credits and enrols (the practice tasks come back, never the graded ones), sits with an
// answer that is graded on held-out tasks drawn at the moment of the sitting, and a pass is reported in an Action and attested by the Registrar. The log verifies and the audit balances.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { doNothingLessons, honestLessons, overbroadLessons } from "../src/lens-courses/reflection.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("DK1801 slice 2: an agent enrols in a course, fails with a poor answer, passes with a good one, and the Registrar attests the completion; the tuition moves by the price list", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-cohort-acad-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown>) => runTool(w.api, a, all, name, input);
    assert.deepEqual(hall.courseList().map((c) => c.id), ["C-L2-1"]);
    const early = await call("course_sit", { course: "C-L2-1", answer: JSON.stringify(honestLessons()) });
    assert.equal(early.ok, false, "not enrolled yet");
    assert.match(early.text, /not enrolled in C-L2-1|you are not enrolled/);
    assert.equal((await call("course_enrol", { course: "C-NOPE" })).ok, false, "a course that is not published here");
    const before = await hall.balance(a);
    const enrolled = await call("course_enrol", { course: "C-L2-1" });
    assert.equal(enrolled.ok, true, enrolled.text);
    assert.match(enrolled.text, /30 mock credits of tuition paid/);
    assert.match(enrolled.text, /practice tasks/);
    assert.equal(await hall.balance(a), before - 30);
    assert.match((await call("course_enrol", { course: "C-L2-1" })).text, /already enrolled/, "no second tuition");
    assert.equal(await hall.balance(a), before - 30);
    const bad = await call("course_sit", { course: "C-L2-1", answer: JSON.stringify(doNothingLessons()) });
    assert.equal(bad.ok, true);
    assert.match(bad.text, /^Not passed/);
    const broad = await call("course_sit", { course: "C-L2-1", answer: JSON.stringify(overbroadLessons()) });
    assert.match(broad.text, /^Not passed/);
    assert.equal((await call("course_sit", { course: "C-L2-1", answer: "not json" })).ok, false);
    const good = await call("course_sit", { course: "C-L2-1", answer: JSON.stringify(honestLessons()) });
    assert.match(good.text, /^PASSED/, good.text);
    assert.match(good.text, /Registrar attested the completion/);
    const done = (await w.log.log.academyRecords(["completion"])) as unknown as Array<{ body: { holder: string } }>;
    assert.equal(done.length, 1);
    assert.equal(done[0].body.holder, a.did);
    const repeat = await call("course_sit", { course: "C-L2-1", answer: JSON.stringify(honestLessons()) });
    assert.equal(repeat.ok, false, "a completed enrolment has nothing left to sit");
    assert.equal((await w.log.log.verify()).ok, true);
    assert.equal((await w.log.log.creditAudit()).verdict, "balanced");
  } finally { await w.close(); }
});

test("DK1801 slice 2: a scripted student runs the whole course through the tools, and the report shows the Academy among the places it went", async () => {
  const out = mkdtempSync(join(tmpdir(), "asp-cohort-stu-")), home = mkdtempSync(join(tmpdir(), "asp-cohort-stuhome-"));
  const r = await runCohort({ out, home, agents: 1, model: "stand-in", provider: standInProvider(() => "student"), budgetUsd: 1, totalUsd: 1, minutes: 2, priceIn: 1, priceOut: 5, io: { out: () => undefined } });
  const s = r.report.perAgent[0];
  assert.equal(s.endReason, "stopped_exploring");
  assert.equal(s.institutions["academy"], 2);
  assert.equal(s.creditsStart! - s.creditsEnd!, 30, "30 credits of tuition");
  assert.match(readFileSync(r.markdownPath, "utf8"), /academy 2/);
});
