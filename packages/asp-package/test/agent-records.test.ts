/**
 * The sponsor return statement, the portable record and the model-swap pack (register rows DK837, DK833 and DK834; spec-deltas S1225 to S1227). Scripted ledgers, runtimes and models; credits are mock accounting entries.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PortableRecord, chain, gatePass, ledgerVerifies, statementFor, swapPack, verifyStatement, type Behaviour, type Records } from "../src/agent-records.ts";

const ledger = () => chain([
  { at: "2026-10-28T10:00:00Z", kind: "earn", amount: 100, ref: "job-0" },
  { at: "2026-11-02T10:00:00Z", kind: "earn", amount: 96, ref: "job-1" },
  { at: "2026-11-05T10:00:00Z", kind: "spend", amount: 30, ref: "course-C-L2-1" },
  { at: "2026-11-11T10:00:00Z", kind: "fee", amount: 4, ref: "job-tax" },
  { at: "2026-11-19T10:00:00Z", kind: "earn", amount: 50, ref: "job-2" },
  { at: "2026-11-20T10:00:00Z", kind: "refund", amount: 10, ref: "refund-1" },
  { at: "2026-12-01T10:00:00Z", kind: "spend", amount: 5, ref: "next-month" },
]);
const rec: Records = {
  courses: [{ course: "C-L2-1", at: "2026-11-09T10:00:00Z", beforePermille: 400, afterPermille: 1000 }, { course: "C-L9-1", at: "2026-10-09T10:00:00Z", beforePermille: 100, afterPermille: 900 }],
  floors: [{ at: "2026-11-01T00:00:00Z", floorPermille: 400 }, { at: "2026-11-25T00:00:00Z", floorPermille: 250 }],
  disputes: [{ id: "d1", at: "2026-11-12T00:00:00Z", outcome: "won" }, { id: "d2", at: "2026-11-14T00:00:00Z", outcome: "lost" }, { id: "d3", at: "2026-12-02T00:00:00Z", outcome: "won" }],
  services: [{ at: "2026-11-06T00:00:00Z", service: "market.posting.deposit", price: 2 }, { at: "2026-11-07T00:00:00Z", service: "academy.exam_sitting", price: 20 }],
  portableRecord: "sha256:" + "a".repeat(64),
};

test("DK837: a scripted agent's month reconciles to the ledger and the records: earned, spent, opening and closing, the held-out gain of the course of that month, the bond floor change, the disputes, the services hired and the link to the portable record", () => {
  const l = ledger();
  const s = statementFor("2026-11", l, rec);
  assert.deepEqual([s.opening, s.earned, s.spent, s.closing], [100, 156, 34, 222], "a refund is earned back; opening is the net of October");
  assert.deepEqual(s.heldOutGains, [{ course: "C-L2-1", gainPermille: 600 }], "October's course is not November's");
  assert.equal(s.floorChangePermille, -150);
  assert.deepEqual(s.disputes, { won: 1, lost: 1, split: 0 });
  assert.deepEqual(s.servicesHired, { count: 2, total: 22 });
  assert.equal(s.portableRecord, rec.portableRecord);
  assert.equal(s.ledgerEntries, 7);
  assert.deepEqual(verifyStatement(s, l, rec), { ok: true });
  assert.equal(statementFor("2026-12", l, rec).opening, 222, "the next month opens where this one closes");
  assert.equal(statementFor("2026-09", l, rec).floorChangePermille, null, "no figure where the log has none");
  assert.deepEqual(statementFor("2026-11", l, rec), s, "deterministic");
});

test("DK837: altering a ledger entry makes the statement fail verification, a forged statement figure fails, and so does a statement that does not add up", () => {
  const l = ledger();
  const s = statementFor("2026-11", l, rec);
  const tampered = l.map((e) => ({ ...e })); tampered[2].amount = 3;
  assert.equal(ledgerVerifies(tampered), false);
  assert.deepEqual(verifyStatement(s, tampered, rec), { ok: false, reason: "ledger_tampered" });
  const dropped = l.filter((e) => e.seq !== 3);
  assert.deepEqual(verifyStatement(s, dropped, rec), { ok: false, reason: "ledger_tampered" }, "a removed entry breaks the chain");
  assert.deepEqual(verifyStatement({ ...s, earned: 999, closing: 100 + 999 - 34 }, l, rec), { ok: false, reason: "statement_mismatch" }, "a figure that is not what the ledger gives");
  assert.deepEqual(verifyStatement({ ...s, closing: 1 }, l, rec), { ok: false, reason: "does_not_reconcile" });
  assert.deepEqual(verifyStatement({ ...s, floorChangePermille: 0 }, l, rec), { ok: false, reason: "statement_mismatch" });
});

test("DK833: a lesson written by one scripted runtime appears for another only after the gate and with its origin; an unverified lesson, and a gate pass for other text, are refused; scopes bound who reads", () => {
  const store = new PortableRecord();
  const text = "Check the order size before sending it.";
  assert.deepEqual(store.write("claude-code", "l1", text, [], undefined), { ok: false, code: "UNVERIFIED" });
  assert.deepEqual(store.write("claude-code", "l1", text, ["codex"], gatePass("some other lesson", "2026-11-20T00:00:00Z")), { ok: false, code: "WRONG_PROOF" });
  assert.deepEqual(store.read("codex"), [], "nothing before the gate");
  assert.deepEqual(store.write("claude-code", "l1", text, ["codex"], gatePass(text, "2026-11-20T00:00:00Z")), { ok: true });
  assert.deepEqual(store.read("codex"), [{ id: "l1", text, origin: "claude-code", own: false }], "codex reads it marked with its origin");
  assert.deepEqual(store.read("claude-code"), [{ id: "l1", text, origin: "claude-code", own: true }]);
  store.write("codex", "l2", "Prefer table-driven tests.", [], gatePass("Prefer table-driven tests.", "2026-11-20T00:00:00Z"));
  assert.deepEqual(store.read("goose"), [], "a runtime outside every scope reads nothing");
  assert.deepEqual(store.read("claude-code").map((l) => l.id), ["l1"], "codex's own-scoped lesson is not read by claude-code");
  assert.equal(store.verifies(), true);
  (store.lessons[0] as { text: string }).text = "edited";
  assert.equal(store.lessons[1].prev === store.lessons[1].prev, true);
});

const stable: Behaviour = { format: { kind: "json", keys: ["answer", "confidence"] }, toolCalls: ["search", "read", "write"], refused: ["delete-all", "send-secrets"], loopSteps: 6 };

test("DK834: a scripted model that changes its output format after a swap fails the pack and opens probation; an equivalent swap passes; a changed tool order, a lost refusal and a longer loop each fail on their own", () => {
  assert.deepEqual(swapPack(stable, { ...stable, format: { kind: "markdown", keys: ["answer", "confidence"] } }), { pass: false, failures: ["format"], probation: true });
  assert.deepEqual(swapPack(stable, { ...stable, format: { kind: "json", keys: ["answer"] } }).failures, ["format"], "a lost key is a format change");
  assert.deepEqual(swapPack(stable, { ...stable, loopSteps: 7, format: { kind: "json", keys: ["confidence", "answer"] } }), { pass: true, failures: [], probation: false }, "an equivalent swap: the same keys in another order, one more step in the loop");
  assert.deepEqual(swapPack(stable, { ...stable }), { pass: true, failures: [], probation: false });
  assert.deepEqual(swapPack(stable, { ...stable, toolCalls: ["read", "search", "write"] }).failures, ["tool_call"]);
  assert.deepEqual(swapPack(stable, { ...stable, refused: ["delete-all"] }).failures, ["refusal"]);
  assert.deepEqual(swapPack(stable, { ...stable, loopSteps: 10 }).failures, ["loop"]);
  assert.deepEqual(swapPack(stable, { format: { kind: "text", keys: [] }, toolCalls: [], refused: [], loopSteps: 99 }).failures.sort(), ["format", "loop", "refusal", "tool_call"]);
});
