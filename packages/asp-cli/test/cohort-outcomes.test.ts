// The tool-call OUTCOME measure: not only that a call succeeded or was refused, but whether its result was correct, where the job has a checker (a delivery the house accepts, a course
// sitting that is passed, a card answer that earns), and "not measurable" everywhere else. The verdicts are read from the real tool results of the local society, not from invented text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outcomesReport, renderOutcomes, verdictOf, CHECKERS } from "../src/cohort/outcomes.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import type { TraceEvent } from "../src/cohort/types.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("verdicts from the real results of the house: a delivery the house refuses is a fail, one it pays is a pass, a read has no checker", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-outcomes-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    await w.api.market!.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const board = JSON.parse(stripExtras((await call("look_jobs")).text)) as { result: { job: string; purpose: string }[] };
    const job = board.result.find((j) => /most comments/.test(j.purpose))!;
    const o = await call("offer_on_job", { job: job.job, price: 8, plan: "read the feed and name it" });
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
    const bad = await call("deliver_job", { contract, summary: "dunno" });
    assert.equal(bad.ok, false);
    assert.equal(verdictOf("deliver_job", bad.ok, bad.text, bad.discovery), "fail", "ran, and the house's check did not accept it");
    const good = await call("deliver_job", { contract, summary: "The post with the most comments is the one about what a newcomer should do first." });
    assert.equal(verdictOf("deliver_job", good.ok, good.text, good.discovery), "pass");
    const read = await call("forum_read");
    assert.equal(verdictOf("forum_read", read.ok, read.text), undefined, "a read has no checker: not measurable");
    assert.equal(verdictOf("deliver_job", true, "Delivered: abc. The poster can accept it now."), undefined, "a delivery on an agent's job waits for its poster: not measurable");
  } finally { await w.close?.(); }
});

test("course sittings and card answers: the checker's own words decide; an answer that earns nothing is a fail, an unavailable one is not measurable", () => {
  assert.equal(verdictOf("course_sit", true, "PASSED. held-out score 0.8"), "pass");
  assert.equal(verdictOf("course_sit", true, "Not passed. held-out score 0.2"), "fail");
  assert.equal(verdictOf("course_sit", false, "Refused (sitting_refused): not enrolled"), undefined);
  assert.equal(verdictOf("field_answer", true, "Good.", "marker-taken:m1"), "pass");
  assert.equal(verdictOf("field_answer", true, "Not quite."), "fail");
  assert.equal(verdictOf("field_answer", false, "Refused"), undefined);
  assert.deepEqual(Object.keys(CHECKERS).sort(), ["course_sit", "deliver_job", "field_answer"]);
});

const tool = (agent: string, name: string, ok: boolean, extra: Record<string, unknown> = {}): TraceEvent => ({ t: "tool", at: "2026-11-23T09:00:00.000Z", agent, turn: 1, tool: name, input: {}, ok, chars: 1, institution: "x", scope: "x", writes: false, ms: 1, ...extra }) as TraceEvent;

test("the report separates succeeded from correct: a call that ran and failed its check, a pass rate over the checked calls only, and the rest not measurable", () => {
  const ev = [
    tool("a", "deliver_job", false, { refused: "x", outcome: "fail" }), tool("a", "deliver_job", true, { outcome: "pass" }),
    tool("b", "course_sit", true, { outcome: "fail" }), tool("b", "course_sit", true, { outcome: "pass" }), tool("b", "course_sit", true, { outcome: "pass" }),
    tool("a", "forum_read", true), tool("a", "forum_read", true), tool("a", "forum_post", false, { refused: "bad_input" }),
  ];
  const r = outcomesReport(ev);
  assert.deepEqual([r.total.calls, r.total.succeeded, r.total.refused, r.total.checked, r.total.pass, r.total.fail, r.total.succeededButFailed, r.total.notMeasurable], [8, 6, 2, 5, 3, 2, 1, 2]);
  assert.equal(r.total.passRate, 3 / 5, "over the checked calls only, never over all eight");
  assert.equal(r.byTool.forum_read!.passRate, null, "nothing to check: no rate is invented");
  assert.equal(r.byTool.course_sit!.succeededButFailed, 1);
  const md = renderOutcomes(r);
  assert.match(md, /5 had a checker: 3 passed it and 2 failed it \(1 of those ran without error and were still wrong\)\. 2 more succeeded with no checker and are not measurable/);
  assert.match(md, /\| course_sit \| the Academy's held-out grading of a sitting \| 3 \| 2 \| 1 \| 67% \|/);
  assert.match(md, /What this cannot tell you: whether an unchecked call was useful/);
  assert.match(renderOutcomes(outcomesReport([tool("a", "forum_read", true)])), /No call in this run had a checker/);
});
