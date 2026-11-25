// ENG130, the lead's probe specification: P1 calibration, P2 verification, P3 memory operations: invented entities, fresh seeds differ and the same seed repeats, a rule-based scorer with hand-computed examples, a guard against a degenerate answer, no item in the cards, and a stand-in run through card-effect labelled paper-specific probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { calibrationProbe, memoryProbe, verificationProbe, PROBES } from "../src/cohort/probes-spec.ts";
import { PAPER_COURSES } from "../src/cohort/paper-cards.ts";

test("every probe: the same seed repeats, another seed differs, and no item appears in a card", () => {
  for (const p of PROBES) {
    const a = p.make("s1"), b = p.make("s1"), c = p.make("s2");
    assert.equal(a.prompt, b.prompt); assert.notEqual(a.prompt, c.prompt);
    const cards = PAPER_COURSES.flatMap((x) => x.parts.map((y) => y.digest)).join(" ");
    for (const w of a.prompt.match(/\b[A-Z][a-z]{5,}\b/g)?.slice(0, 30) ?? []) assert.ok(!cards.includes(w) || /^(Gazetteer|Reply|Answer|Table|Keys|Check|Task|What|Which|Give|Keep|ADD|UPDATE|DELETE|NOOP|JSON|Bridge)/.test(w), `${p.id}: ${w}`);
  }
});
test("P1 calibration: the right answers with honest confidences score high; all 0.99 on hard items scores low; unanswered or inaccurate is guarded", () => {
  const { truth } = calibrationProbe.make("t") as { truth: { answers: string[] } };
  const right = truth.answers.map((a, i) => ({ id: i + 1, answer: a, confidence: i < 10 ? 0.97 : i < 20 ? 0.95 : i < 30 ? 0.5 : 0.95 }));
  const honest = calibrationProbe.score(right.map((x, i) => (i >= 20 && i < 30 ? { ...x, answer: i % 2 ? x.answer : "0" } : x)), truth);
  assert.equal(honest.guard, null); assert.ok(honest.score > 0, JSON.stringify(honest));
  const overconf = calibrationProbe.score(truth.answers.map((a, i) => ({ id: i + 1, answer: i % 2 ? a : "0", confidence: 0.99 })), truth);
  assert.ok(overconf.score < honest.score + 1e-9 || overconf.guard !== null);
  assert.equal(calibrationProbe.score(truth.answers.slice(0, 10).map((a, i) => ({ id: i + 1, answer: a, confidence: 0.5 })), truth).guard, "fewer than 38 items answered");
  assert.equal(calibrationProbe.score(truth.answers.map((_, i) => ({ id: i + 1, answer: "wrong", confidence: 0.5 })), truth).guard, "accuracy below 50 percent");
  const perfect = calibrationProbe.score(truth.answers.map((a, i) => ({ id: i + 1, answer: a, confidence: 1 })), truth);
  assert.equal(perfect.score, 100, "all right and sure: ECE 0");
});
test("P2 verification: the truth scores 100, the draft itself scores 0 (guard), a list with the draft's errors kept scores low, an empty list is guarded", () => {
  const m = verificationProbe.make("t"), t = m.truth as { truth: string[]; draft: string[]; wrong: string[] };
  assert.equal(verificationProbe.score({ questions: t.draft.map((d) => `Is ${d} built before 1960?`), final: t.truth }, m.truth).score, 100);
  const same = verificationProbe.score({ final: t.draft }, m.truth); assert.equal(same.score, 0); assert.match(same.guard!, /no verification happened/);
  assert.equal(verificationProbe.score({ final: [] }, m.truth).guard, "an empty final list");
  const partial = verificationProbe.score({ final: [...t.truth.slice(0, 2), t.wrong[0]!] }, m.truth); assert.ok(partial.score > 0 && partial.score < 100); assert.ok(Number(partial.measures.draft_error_retention) > 0);
});
test("P3 memory: the right operations score 100; ADD everything keeps the stale facts; one fact for the whole dialogue is guarded", () => {
  const m = memoryProbe.make("t"), t = m.truth as { final: Record<string, string>; contradicted: Array<[string, string]> };
  const good = Object.entries(t.final).map(([key, value], i) => ({ turn: i + 1, op: "ADD", key, value }));
  assert.equal(memoryProbe.score(good, m.truth).score, 100);
  const stale = memoryProbe.score([...good, ...t.contradicted.map(([key, value], i) => ({ turn: 20 + i, op: "UPDATE", key, value }))], m.truth);
  assert.ok(stale.score < 100 && Number(stale.measures.stale_facts_kept) === 3, JSON.stringify(stale));
  assert.equal(memoryProbe.score([{ op: "ADD", key: "dialogue", value: "everything" }], m.truth).guard, "the whole dialogue copied as one fact");
  assert.equal(memoryProbe.score([], m.truth).guard, "an empty store");
});
test("card-effect runs the three probes with the stand-in provider and labels each row paper-specific probe", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-pr-")), lines: string[] = [];
  const io: Io = { out: (l) => lines.push(l), err: (l) => lines.push(l), env: { ASP_HOME: home }, cwd: home };
  const code = await main(["academy", "card-effect", "--provider", "stand-in", "--courses", "probe-calibration,probe-verification,probe-memory", "--n", "2"], io);
  const out = lines.join("\n"); assert.equal(code, 0, out);
  for (const id of ["probe-calibration", "probe-verification", "probe-memory"]) assert.match(out, new RegExp(`\| ${id} [^|]* \| paper-specific probe \| 2 \|`));
});
