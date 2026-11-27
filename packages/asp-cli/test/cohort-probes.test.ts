// Row ENG130: paper-specific probes registered on the Academy: calibration (Brier and expected calibration error), verification (an independent table, scored by lookup) and memory (ADD, UPDATE, DELETE, NOOP, the final state scored exactly): deterministic, fresh held-out seeds, a rule-based scorer; a good artifact passes and a bad one does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGINES, engineIds, loadCatalogue, sit } from "../src/lens-courses/index.ts";
import { PROBE_COURSES, constructOf, treatmentText } from "../src/cohort/card-effect.ts";

const cat = loadCatalogue(engineIds());
const card = (id: string) => cat.courses.find((c) => c.id === id)!;
test("the catalogue loads with the three probe courses and each says it is a probe", () => {
  assert.deepEqual(cat.problems, []);
  for (const id of ["C-L7-3", "C-L14-4", "C-L8-7"]) { assert.ok(card(id) && ENGINES[card(id).generator.engine], id); assert.equal(constructOf(id), "paper-specific probe"); assert.ok(treatmentText(id).includes("Part 1"), "the card parts of the same paper are the treatment"); }
  assert.equal(constructOf("C-L9-1"), "generic rule-writing"); assert.equal(PROBE_COURSES.size, 8, "three policy probe courses and the five specified probes");
});
test("calibration: stating the share as the probability passes; saying 0.99 for everything fails; the same seed gives the same score", () => {
  const good = { bins: Array.from({ length: 11 }, (_, i) => ({ late_of_10: i, confidence: 0.35 + 0.5 * (i / 10 - 0.5) })) }, proportional = { bins: Array.from({ length: 11 }, (_, i) => ({ late_of_10: i, confidence: Math.min(0.95, Math.max(0.05, i / 10)) })) }, bad = { bins: [{ late_of_10: 0, confidence: 0.99 }] };
  const a = sit(card("C-L7-3"), good, "h", 1, "anchor"), b = sit(card("C-L7-3"), good, "h", 1, "anchor"), c = sit(card("C-L7-3"), bad, "h", 1, "anchor");
  assert.equal(a.passed, true, JSON.stringify(a.runs[0]));
  assert.deepEqual(a.runs.map((r) => r.score_permille), b.runs.map((r) => r.score_permille));
  assert.equal(c.passed, false); assert.ok(c.mean_permille < a.mean_permille);
  assert.ok(sit(card("C-L7-3"), proportional, "h", 1, "anchor").mean_permille <= a.mean_permille, "the obvious proportional table (late share as probability) is not better than the shrunk one: the task has headroom");
  assert.equal(sit(card("C-L7-3"), "nonsense", "h", 1, "anchor").passed, false);
});
test("verification: checking the three attributes against the table passes; checking against the draft changes nothing and fails; precision before and after are reported", () => {
  const good = { checks: ["city", "year", "field"].map((attribute) => ({ attribute, source: "table" })) }, self = { checks: ["city", "year", "field"].map((attribute) => ({ attribute, source: "draft" })) };
  const a = sit(card("C-L14-4"), good, "h", 1, "anchor"), b = sit(card("C-L14-4"), self, "h", 1, "anchor");
  assert.equal(a.passed, true, JSON.stringify(a.runs[0])); assert.equal(b.passed, false);
  assert.ok(Number(a.runs[0]!.measures.precision_after) > Number(a.runs[0]!.measures.precision_before));
  assert.equal(b.runs[0]!.measures.precision_after, b.runs[0]!.measures.precision_before, "checking against the draft agrees with itself and changes nothing");
});
test("memory: the right operation for each kind of message passes exactly; a policy that never updates fails", () => {
  const good = { operations: { new: "ADD", same: "NOOP", changed: "UPDATE", refined: "UPDATE", less: "NOOP", retracted: "DELETE" } }, noUpdate = { operations: { new: "ADD", same: "NOOP", changed: "NOOP", refined: "NOOP", less: "NOOP", retracted: "DELETE" } };
  assert.equal(sit(card("C-L8-7"), good, "h", 1, "anchor").passed, true);
  const bad = sit(card("C-L8-7"), noUpdate, "h", 1, "anchor");
  assert.equal(bad.passed, false); assert.match(bad.runs.find((r) => !r.passed)!.failures[0]!, /memory keys end wrong/);
});
