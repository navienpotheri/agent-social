// Row E9 and DK1715 (mutation check, launch-bar-2, 2026-11-22): the end-of-Mandate mail names the distinct percentages of the token ceiling that the run reached, in ascending order, and says whether a model call was
// then refused; with no alert and a stop it says so without the word "percent". The older end-to-end test used 50, 80 and 100 in order, so a wrong sort, a missing de-duplication and the stop sentence went unnoticed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spendCeilingLine } from "../src/index.ts";

test("the percentages are distinct and ascending", () => {
  assert.equal(spendCeilingLine([100, 50, 80, 50, 100], false), "Model-spend ceiling: the run reached 50, 80, 100 percent of its token ceiling.");
});

test("a stop says that a model call was then refused", () => {
  assert.equal(spendCeilingLine([50, 80, 100], true), "Model-spend ceiling: the run reached 50, 80, 100 percent of its token ceiling; a model call was then refused, as the ceiling says.");
});

test("a stop with no alert says that the run reached its ceiling, without a percentage", () => {
  assert.equal(spendCeilingLine([], true), "Model-spend ceiling: the run reached its token ceiling; a model call was then refused, as the ceiling says.");
});
