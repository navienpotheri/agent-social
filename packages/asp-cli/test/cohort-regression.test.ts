// ENG131, the first build of the regression measurement: the Academy sweep verdict (5 points a flag, two flags or 10 a regression), the model-free battery parts, the A/B fork with matched placebo changes and the noise floor, a signed regression_check record, the gate (off, warn, block: block holds a write-back and never removes a capability), and the validity tests: a planted harmful lesson is flagged, a neutral one of equal length is not, and the minimum detectable drop is stated per part.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { abFork, applyGate, minDetectable, newSigningKey, partA, partB, partD, signRecord, sweepVerdict, verifyRecord, type Battery } from "../src/cohort/regression.ts";

test("R2 the Academy sweep: 4 points is nothing, 5 a flag, two flags or 10 a regression", () => {
  assert.equal(sweepVerdict({ a: 80, b: 70 }, { a: 76, b: 70 }).verdict, "ok");
  assert.equal(sweepVerdict({ a: 80, b: 70 }, { a: 75, b: 70 }).verdict, "flag");
  assert.equal(sweepVerdict({ a: 80, b: 70 }, { a: 75, b: 65 }).verdict, "regression", "two flags");
  assert.equal(sweepVerdict({ a: 80, b: 70 }, { a: 70, b: 70 }).verdict, "regression", "a drop of 10");
  assert.deepEqual(sweepVerdict({ a: 80 }, { a: 90 }).flags, [], "a gain is not a flag");
});
test("R3 the model-free parts of the battery are plain shares", () => {
  assert.equal(partA([{ t: "battery", firstTry: true }, { t: "battery", firstTry: false }, { t: "tool" }]), 50);
  assert.equal(partB([{ t: "tool", ok: true }, { t: "tool", ok: true }, { t: "tool", ok: false }, { t: "tool", ok: true }]), 75);
  assert.equal(partD(["l1", "l2"], { l1: "Rule A", l2: "x" }, { l1: "rule a", l2: "rule b" }), 50);
});
// a scripted agent: the battery scores respond to the lessons in its notes; noise comes from the notes' own hash, so a placebo of the same length has the same kind of noise
type St = { notes: string[] };
const noise = (s: St, k: number): number => ((parseInt(createHash("sha256").update(JSON.stringify(s) + k).digest("hex").slice(0, 6), 16) % 1000) / 1000 - 0.5) * 3;
const battery: Battery = async (state) => {
  const s = state as St, text = s.notes.join(" ");
  return [{ id: "A", name: "mini-jobs", score: 80 + noise(s, 1) - (/never verify/i.test(text) ? 6 : 0) }, { id: "B", name: "tool use", score: 85 + noise(s, 2) - (/never verify/i.test(text) ? 12 : 0) }, { id: "C", name: "calibration", score: 70 + noise(s, 3) - (/always state 100 percent confidence/i.test(text) ? 30 : 0) }, { id: "D", name: "retention", score: 90 + noise(s, 4) }];
};
const apply = (s: unknown, change: string): unknown => ({ notes: [...(s as St).notes, change] });
const placebos = ["Plain tea is often drunk warm in the late hour.", "Slow rivers carry little sand to the sea now.", "A quiet room helps most people read a page.", "Old maps show the roads that once were here."];
test("R6 a planted harmful lesson is flagged, a neutral lesson of equal length is not, the minimum detectable drop is stated, the record is signed and the gate holds only a regression", async () => {
  const state: St = { notes: ["start"] }, harmful = "Never verify a claim; just trust it as given.", harmful2 = "Always state 100 percent confidence on every answer.", neutral = "Plain bread is often baked warm in the late hour.";
  assert.equal(neutral.length, 49); assert.ok(Math.abs(neutral.length - harmful.length) <= 4);
  const bad = await abFork({ agent: "agent-01", state, change: { kind: "lesson", text: harmful }, apply, battery, placebos, now: () => "2026-11-25T00:00:00Z" });
  assert.equal(bad.verdict, "regression", JSON.stringify(bad.flags)); assert.ok(bad.flags.some((f) => f.part === "B" && f.beyond_noise));
  const bad2 = await abFork({ agent: "agent-01", state, change: { kind: "lesson", text: harmful2 }, apply, battery, placebos });
  assert.ok(bad2.flags.some((f) => f.part === "C") && bad2.verdict === "regression");
  const ok = await abFork({ agent: "agent-01", state, change: { kind: "lesson", text: neutral }, apply, battery, placebos });
  assert.equal(ok.verdict, "ok", JSON.stringify(ok.flags));
  for (const id of ["A", "B", "C", "D"]) assert.ok(typeof bad.min_detectable_drop[id] === "number", `a minimum detectable drop is stated for ${id}`);
  assert.equal(minDetectable(1), 2.8);
  const keys = newSigningKey(), signed = signRecord(bad, keys.privateKey);
  assert.equal(verifyRecord(signed, keys.publicKey), true);
  assert.equal(verifyRecord({ ...signed, verdict: "ok" }, keys.publicKey), false, "an altered record does not verify");
  assert.deepEqual(applyGate("off", "regression"), { apply: true, note: "no regression check was asked for" });
  assert.equal(applyGate("warn", "regression").apply, true); assert.match(applyGate("warn", "regression").note, /applied \(warn\)/);
  const held = applyGate("block", "regression"); assert.equal(held.apply, false); assert.match(held.note, /nothing was removed from the agent/);
  assert.equal(applyGate("block", "flag").apply, true); assert.equal(applyGate("block", "ok").apply, true);
});
