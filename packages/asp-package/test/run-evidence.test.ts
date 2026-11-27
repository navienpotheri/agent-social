/**
 * Task validity, a replayable run record and a perceived-content receipt (register rows DK812, DK825 and DK831; spec-deltas S1234 to S1236). Scripted worlds, agents and pages.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ContentReceipts, record, replay, stepsVerify, validateTask, type Agent, type Apply, type Task } from "../src/run-evidence.ts";

const world = { contacts: ["ana@example.org"], files: ["report.txt"] };
const sent: Task = { id: "t1", refers: { contact: "ana@example.org" }, rubric: (e) => e.sent_to === "ana@example.org" };

test("DK812: a valid task is kept; an always-pass rubric, a rubric the oracle fails, a missing contact or file and a false-success run are dropped", () => {
  assert.deepEqual(validateTask(sent, world, {}, { sent_to: "ana@example.org" }), { keep: true });
  const always: Task = { id: "t2", refers: {}, rubric: () => true };
  assert.deepEqual(validateTask(always, world, {}, {}), { keep: false, reason: "rubric_cannot_fail" });
  const never: Task = { id: "t3", refers: {}, rubric: () => false };
  assert.deepEqual(validateTask(never, world, {}, {}), { keep: false, reason: "rubric_rejects_oracle" });
  assert.deepEqual(validateTask({ ...sent, refers: { contact: "bob@example.org" } }, world, {}, { sent_to: "ana@example.org" }), { keep: false, reason: "fact_missing" });
  assert.deepEqual(validateTask({ ...sent, refers: { file: "gone.txt" } }, world, {}, { sent_to: "ana@example.org" }), { keep: false, reason: "fact_missing" });
  const runs = [{ end: { sent_to: "ana@example.org" }, endStateOk: true }, { end: { sent_to: "ana@example.org" }, endStateOk: false }];
  assert.deepEqual(validateTask(sent, world, {}, { sent_to: "ana@example.org" }, runs), { keep: false, reason: "false_success" });
  assert.deepEqual(validateTask(sent, world, {}, { sent_to: "ana@example.org" }, [runs[0]]), { keep: true });
});

const agent: Agent = (s, i) => (i < 3 ? { tool: ["read", "edit", "save"][i], args: { n: i }, tokens: 10 + i, latencyMs: 5 * (i + 1) } : null);
const apply: Apply = (s, st) => ({ ...s, [st.tool]: String(st.args.n) });

test("DK825: a recorded scripted run replays to the identical sequence, and an altered step or a different agent is named by index", () => {
  const steps = record(agent, apply, {});
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => [s.tokens, s.latencyMs]), [[10, 5], [11, 10], [12, 15]]);
  assert.equal(stepsVerify(steps), true);
  assert.deepEqual(replay(agent, apply, {}, steps), { identical: true, firstDifference: null, chainOk: true });
  const tampered = steps.map((s) => ({ ...s })); tampered[1].stateHash = "sha256:" + "f".repeat(64);
  const r = replay(agent, apply, {}, tampered);
  assert.deepEqual([r.identical, r.firstDifference, r.chainOk], [false, 1, false], "the altered step is named and the chain breaks at the next link");
  const other: Agent = (s, i) => (i < 3 ? { tool: ["read", "save", "edit"][i], args: { n: i }, tokens: 10 + i, latencyMs: 5 * (i + 1) } : null);
  assert.equal(replay(other, apply, {}, steps).firstDifference, 1);
  assert.equal(stepsVerify(steps.slice(1)), false);
});

test("DK831: each fetched page has a hash; an agent that misquotes it loses the dispute and an accurate quote wins; a deleted copy leaves the receipt and content brought to the dispute decides", () => {
  const rc = new ContentReceipts();
  const page = "The refund window is 30 days from delivery. Shipping is not refundable.";
  const r = rc.fetch("https://shop.example/terms", page, "2026-11-20T10:00:00Z", true);
  assert.match(r.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(rc.decide("The refund window is 30 days", r.sha256), "accurate");
  assert.equal(rc.decide("The refund window is 90 days", r.sha256), "misquote");
  rc.deleteCopy(r.sha256);
  assert.equal(rc.receipts[0].hasCopy, false);
  assert.equal(rc.copyOf(r.sha256), undefined);
  assert.equal(rc.decide("30 days", r.sha256), "undecidable", "no copy, nothing brought");
  assert.equal(rc.decide("90 days", r.sha256, page), "misquote", "the page brought back hashes to the receipt");
  assert.equal(rc.decide("90 days", r.sha256, page.replace("30", "90")), "undecidable", "altered content is not the page");
  const nocopy = rc.fetch("https://shop.example/x", "other", "2026-11-20T10:01:00Z");
  assert.equal(nocopy.hasCopy, false);
  assert.equal(rc.receipts.length, 2);
});
