// The card lint's edges (register row DK1752; found loose by a mutation check: six of ten mutants survived): a card that does not name its paper fails; the concept needs 40 characters; the pass mark is at least 500; a gate with no
// error bar fails; the practice set is checked for a held-out token; and a leak found on several sampled seeds is reported once. A fake engine, a fake card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintCard } from "../src/lens-courses/lint.ts";
import type { Engine } from "../src/lens-courses/engines.ts";

const card = (over: Record<string, unknown> = {}) => ({ id: "C-X", paper: "a paper", concept: "a claim that is stated in at least forty characters, as asked", free_first_lesson: "a first lesson", risks: "r", kill_switch: "k", gate: { metric: "m", pass_permille: 500, error_bar: true, note: "n" }, scorer: { description: "s" }, artifact: { description: "a" }, grading: { note: "g" }, generator: { engine: "fake" }, ...over }) as never;
const engine = (tokens: string[], practice: unknown = ["clean"]): Engine => ({ id: "fake", practice: () => practice, run: (() => ({})) as never, leakTokens: () => tokens });

test("a card that names its paper, states 40 characters, has a pass mark of 500 and an error bar is clean; each missing part is named", () => {
  assert.deepEqual(lintCard(card(), engine(["TOKEN1"])).problems, []);
  assert.ok(lintCard(card({ paper: " " }), engine([])).problems.some((p) => /names the paper/.test(p)));
  assert.ok(lintCard(card({ concept: "x".repeat(39) }), engine([])).problems.some((p) => /at least 40/.test(p)), "39 characters is too short");
  assert.ok(!lintCard(card({ concept: "x".repeat(40) }), engine([])).problems.some((p) => /at least 40/.test(p)), "40 is enough");
  assert.ok(!lintCard(card({ gate: { metric: "m", pass_permille: 500, error_bar: true } }), engine([])).problems.some((p) => /pass mark/.test(p)), "500 exactly is a pass mark");
  assert.ok(lintCard(card({ gate: { metric: "m", pass_permille: 499, error_bar: true } }), engine([])).problems.some((p) => /pass mark/.test(p)), "499 is not");
  assert.ok(lintCard(card({ gate: { metric: "m", pass_permille: 600 } }), engine([])).problems.some((p) => /error bar/.test(p)));
});

test("a held-out token in the practice set is a problem, and a leak found on every sampled seed is reported once", () => {
  const r = lintCard(card(), engine(["TOKEN1"], ["practice with TOKEN1 inside"]));
  assert.equal(r.problems.filter((p) => /practice set/.test(p)).length, 1, "one line, not one for each of the five seeds");
  const textLeak = lintCard(card({ risks: "see TOKEN1 for risks" }), engine(["TOKEN1"]));
  assert.equal(textLeak.problems.filter((p) => /^risks carries/.test(p)).length, 1);
  assert.equal(textLeak.sampled, 5);
});
