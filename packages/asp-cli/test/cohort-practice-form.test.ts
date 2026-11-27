// From 2026-11-25 the exact form of the answer is in the practice object a sitting agent receives from course_enrol (every engine), and an answer in the wrong form is refused naming the form and does not use up a sitting (the earlier runs had the form hidden: their sitting scores are not comparable).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formHint, formProblem } from "../src/cohort/form-hint.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { engineIds, loadCatalogue } from "../src/lens-courses/index.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("every course of the catalogue has a stated form, including the policy-style probe courses", () => {
  for (const c of loadCatalogue(engineIds()).courses) assert.match(formHint(c), /^Form: /, c.id);
});
test("the practice object carries the form; a wrong-form answer is refused with the form named and uses up no sitting; the right form is sat", async () => {
  for (const course of ["C-L2-1", "C-L19-1", "C-L11-1"]) {
    const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-form-")), markers: "s", paperCards: true });
    try {
      const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
      const call = (n: string, i: Record<string, unknown> = {}) => runTool(w.api, a, all, n, i);
      const en = (await call("course_enrol", { course })).text;
      assert.match(en, /"form":"Form: /, `${course}: the practice object states the form`);
      const bad = (await call("course_sit", { course, answer: JSON.stringify({ rules: [{ rule: "x" }] }) })).text;
      assert.match(bad, /refused \(wrong_form\)/); assert.match(bad, /Form: /); assert.match(bad, /No sitting was used up/);
      assert.equal(w.api.market!.sittingStats(course).attempts, 0, `${course}: no sitting was used`);
      if (course === "C-L2-1") {
        const ok = (await call("course_sit", { course, answer: JSON.stringify({ lessons: ["when change=migrate and queue=draining then wait", "when change=restart and load=high then drain_first"] }) })).text;
        assert.doesNotMatch(ok, /wrong_form/); assert.equal(w.api.market!.sittingStats(course).attempts, 1);
      }
    } finally { await w.close(); }
  }
});
test("formProblem names the shape that is wrong", () => {
  const cat = loadCatalogue(engineIds()).courses, c2 = cat.find((c) => c.id === "C-L2-1")!, c11 = cat.find((c) => c.id === "C-L11-1")!;
  assert.match(formProblem(c2, { lessons: [1] })!, /list called lessons of strings/); assert.equal(formProblem(c2, { lessons: ["when a=b then c"] }), undefined);
  assert.match(formProblem(c11, { graders: [] })!, /"grader": \{"kind": "code"\}/); assert.equal(formProblem(c11, { grader: { kind: "code" }, graders: [{ id: "g", kind: "absent", pattern: "x" }] }), undefined);
});
