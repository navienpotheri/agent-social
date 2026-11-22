// JO1: acceptance-criteria templates and the lint that names a criterion that reads as a judgement, not a check. The lint is advice. Every template passes its own lint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CRITERIA_TEMPLATES, criteriaProblems } from "../src/criteria.ts";

test("JO1: every template has an id, a title, what it is for and checkable criteria, and passes its own lint", () => {
  assert.ok(CRITERIA_TEMPLATES.length >= 5);
  assert.equal(new Set(CRITERIA_TEMPLATES.map((t) => t.id)).size, CRITERIA_TEMPLATES.length, "ids are unique");
  for (const t of CRITERIA_TEMPLATES) {
    assert.ok(t.id && t.title && t.for && t.criteria.length >= 3, t.id);
    assert.deepEqual(criteriaProblems(t.criteria), [], `${t.id} passes its own lint`);
  }
});

test("JO1: a criterion is too short, the purpose again, or a judgement with no measure; a judgement with a measure is a check", () => {
  const p = (c: string, purpose?: string) => criteriaProblems([c], purpose);
  assert.match(p("done")[0]!.problem, /too short/);
  assert.equal(p("12345678901").length, 1, "11 characters are too short");
  assert.equal(p("All tests pass now").length, 0, "18 characters with a measure");
  assert.match(p("Fix the flaky date parser test", "Fix the flaky date parser test")[0]!.problem, /purpose again/);
  assert.match(p("  Fix the FLAKY   date parser test ", "fix the flaky date parser test")[0]!.problem, /purpose again/, "case and spaces do not hide it");
  assert.equal(p("Fix the flaky date parser test", "Fix something else entirely").length, 0, "a different sentence is not the purpose");
  assert.match(p("The code should be clean and good")[0]!.problem, /reads as a judgement \("clean"\)/);
  assert.match(p("Write a nice summary of the report")[0]!.problem, /judgement \("nice"\)/);
  assert.match(p("A professional looking page")[0]!.problem, /judgement \("professional"\)/);
  assert.equal(p("The summary is nice and under 200 words").length, 0, "a number makes it a check");
  assert.equal(p("The page is robust: every form rejects an empty field").length, 0, "an observable state makes it a check");
  assert.equal(p("Return the list sorted by date").length, 0, "no judgement word: left alone");
  const many = criteriaProblems(["done", "All tests pass", "Make it better please"]);
  assert.deepEqual(many.map((x) => x.index), [0, 2], "each problem names its criterion's place");
});
