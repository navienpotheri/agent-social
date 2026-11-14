import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMandateMail, collectMandateFacts, type Lesson, type MailLog } from "../src/index.ts";

// gap D10: the end-of-Mandate mail's memory section, enriched with what `asp learned` knows about each change (what it added, changed and removed, and
// whether the principal already reviewed it) when the caller passes the agent's package lessons in. Without them the plain lineage description is kept.
type Rec = { id: string; seq: number; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: any } };
const rec = (seq: number, id: string, type: string, issued_at: string, body: any): Rec => ({ id, seq, record: { type, issuer: "did:x", issued_at, body } });

function fakeLog(records: Rec[], states: Record<string, string>): MailLog {
  return {
    chain: async (c) => records.filter((r) => r.id === c || r.record.body?.contract === c),
    chainInfo: async (c) => (states[c] ? { state: states[c] } : undefined),
    since: async () => records,
  };
}

const contract = rec(1, "c1", "asp.contract/v0.2", "2026-10-01T00:00:00Z", { principal: "did:alice", performer: "did:coder", purpose: "Fix the test", price: { value: 100, unit: "credit" } });
const mandate = rec(2, "m1", "asp.mandate/v0.2", "2026-10-01T00:01:00Z", { contract: "c1", scopes: ["repo.read"], spend: { cap: 5, unit: "credit" }, irreversible: { policy: "checkpoint" }, learning: { share_to_commons: false }, expires: "2027-01-01T00:00:00Z" });
const memoryEdge = rec(3, "e1", "asp.lineage/v0.2", "2026-10-02T00:05:00Z", { child: "did:coder", change: { layer: "memory", description: "memory updated during a run: +2" } });

const lesson = (over: Partial<Lesson> = {}): Lesson => ({ edge: "e1", short: "e1", at: "2026-10-02T00:05:00Z", description: "memory updated during a run: +2", files: [{ path: "feedback.md", after: "Run the tests.\n", kept: true }, { path: "tone.md", after: "Short answers.\n", kept: true }], ...over });

test("the end mail's memory section falls back to the plain description with no package lessons", async () => {
  const f = (await collectMandateFacts(fakeLog([contract, mandate, memoryEdge], { c1: "Settled" }), "c1"))!;
  const mail = buildMandateMail(f, { to: "a@b.co" });
  assert.match(mail.text, /memory updated during a run: \+2/);
  assert.doesNotMatch(mail.text, /asp learned/);
});

test("the end mail's memory section uses asp learned's detail and review state when the package lessons are passed in", async () => {
  const f = (await collectMandateFacts(fakeLog([contract, mandate, memoryEdge], { c1: "Settled" }), "c1"))!;
  const notReviewed = buildMandateMail(f, { to: "a@b.co", learned: [lesson()] });
  assert.match(notReviewed.text, /2 added: feedback\.md, tone\.md \(not reviewed yet\)\./);
  assert.match(notReviewed.text, /asp learned --package <the agent's package>/);

  const kept = buildMandateMail(f, { to: "a@b.co", learned: [lesson({ review: { state: "kept", at: "2026-10-03T00:00:00Z" } })] });
  assert.match(kept.text, /\(you kept it\)\./);

  const undone = buildMandateMail(f, { to: "a@b.co", learned: [lesson({ undoneBy: "e2" })] });
  assert.match(undone.text, /\(already taken back\)\./);

  // A lesson for a different change (edge id differs, at/description do not match) is not used.
  const noMatch = buildMandateMail(f, { to: "a@b.co", learned: [lesson({ at: "2026-10-09T00:00:00Z" })] });
  assert.match(noMatch.text, /memory updated during a run: \+2/);
  assert.doesNotMatch(noMatch.text, /added: feedback/);
});
