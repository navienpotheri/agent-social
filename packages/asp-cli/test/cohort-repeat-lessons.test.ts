// Row ENG72 with ENG102: the repeat report carries the lesson and job-outcome figures (lessons cited, first-try acceptance of deliveries, the readers' change after reading minus before) with their spread over repeat runs,
// and reads the readers' change against that spread: a change smaller than the spread is not called a difference.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headlineOf, outcomeFigures, renderRepeat, repeatReport } from "../src/cohort/repeat.ts";

const t = (agent: string, tool: string, input: Record<string, unknown>, ok = true) => ({ t: "tool", at: "2026-11-24T10:00:00.000Z", agent, turn: 1, tool, input, ok, chars: 1, institution: "x", scope: "x", writes: false, ms: 0 });
const d = (a: string, c: string, ok: boolean) => t(a, "deliver_job", { contract: c }, ok);
// reader r: fails twice before reading, passes twice after; a control c passes all four
const run = (after: boolean) => [d("r", "1", false), d("r", "2", false), t("r", "lesson_read", { id: "lesson-001" }), t("r", "lesson_cite", { id: "lesson-001" }), d("r", "3", after), d("r", "4", after), d("c", "5", true), d("c", "6", true)] as never[];

test("the outcome figures: first-try acceptance overall and the readers' change after reading minus before", () => {
  assert.deepEqual(outcomeFigures(run(true)), { firstTry: 0.6667, readerChange: 1 });
  assert.deepEqual(outcomeFigures(run(false)), { firstTry: 0.3333, readerChange: 0 });
  assert.deepEqual(outcomeFigures([d("c", "1", true)] as never[]), { firstTry: 1, readerChange: null }, "no reader: no change to report");
  assert.equal(headlineOf(run(true)).lessonCites, 1);
});

test("the repeat report shows the spread of the readers' change and reads it against that spread", () => {
  const big = repeatReport([headlineOf(run(true)), headlineOf(run(true)), headlineOf(run(true))]);
  assert.deepEqual(big.figures["readerChange"]!.spread!.values, [1, 1, 1]);
  assert.match(renderRepeat(big), /Readers: first-try acceptance after reading minus before .*\| 1 \| 0 \| 0 \|/);
  assert.match(renderRepeat(big), /The readers' change in first-try acceptance averaged 1 over the runs, and its spread between runs is 0: the change is larger than the spread \(and still a few deliveries in a few runs, not a claim\)\./);
  const noisy = repeatReport([headlineOf(run(true)), headlineOf(run(false)), headlineOf(run(true))]);
  assert.match(renderRepeat(noisy), /averaged 0\.6667 over the runs, and its spread between runs is 1: the change is not larger than the spread, so it is not called a difference\./);
  const none = repeatReport([headlineOf(run(true)), headlineOf([d("c", "1", true)] as never[])]);
  assert.match(renderRepeat(none), /The readers' change could not be compared with a spread: not every run had a reader that delivered both before and after reading\./);
});
