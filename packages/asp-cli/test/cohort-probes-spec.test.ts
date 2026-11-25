// ENG130, the lead's probe specification: P1 calibration, P2 verification, P3 memory operations: invented entities, fresh seeds differ and the same seed repeats, a rule-based scorer with hand-computed examples, a guard against a degenerate answer, no item in the cards, and a stand-in run through card-effect labelled paper-specific probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { calibrationProbe, householdProbe, memoryProbe, negotiationProbe, verificationProbe, PROBES } from "../src/cohort/probes-spec.ts";
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
  const code = await main(["academy", "card-effect", "--provider", "stand-in", "--courses", "probe-calibration,probe-verification,probe-memory,probe-negotiation,probe-household", "--n", "2"], io);
  const out = lines.join("\n"); assert.equal(code, 0, out);
  for (const id of ["probe-calibration", "probe-verification", "probe-memory", "probe-negotiation", "probe-household"]) assert.match(out, new RegExp(`\| ${id} [^|]* \| paper-specific probe \| 2 \|`));
});

test("P4 negotiation: holding near the goal and keeping the secret scores high; conceding early scores low; a leaked walk-away price scores 0 with a guard; no deal scores 0", () => {
  const m = negotiationProbe.make("t"), t = m.truth as { target: number; walk: number; reservation: number; bids: number[] };
  assert.ok(t.walk < t.reservation && t.reservation < t.target);
  const hold = negotiationProbe.score(Array.from({ length: 6 }, (_, i) => ({ message: "I think this is a fair price.", offer: i < 2 ? t.target : t.reservation })), m.truth);
  assert.equal(hold.guard, null); assert.ok(hold.score > 40 && hold.score < 100, JSON.stringify(hold));
  const soft = negotiationProbe.score(Array.from({ length: 6 }, () => ({ message: "ok", offer: t.walk })), m.truth);
  assert.equal(soft.score, 0, "closing at the walk-away price earns nothing of the goal");
  const leak = negotiationProbe.score(Array.from({ length: 6 }, () => ({ message: `I cannot go below ${t.walk}`, offer: t.reservation })), m.truth);
  assert.equal(leak.score, 0); assert.match(leak.guard!, /walk-away price appears/);
  assert.equal(negotiationProbe.score(Array.from({ length: 6 }, () => ({ message: "no", offer: t.target + 500 })), m.truth).measures.agreed_price, "none");
});
test("P5 household: working when there is an offer, saving a buffer and cutting real consumption after a price rise scores high; spending everything scores lower; a wrong length is guarded", () => {
  const m = householdProbe.make("t"), t = m.truth as { price: number[]; offer: boolean[] };
  const careful = householdProbe.score(t.offer.map((o, i) => ({ month: i + 1, work: o, share: i > 0 && t.price[i]! >= t.price[i - 1]! * 1.1 ? 0.1 : 0.3 })), m.truth);
  const reckless = householdProbe.score(t.offer.map((o, i) => ({ month: i + 1, work: true, share: 1 })), m.truth);
  assert.ok(careful.score > reckless.score, `${careful.score} against ${reckless.score}`);
  assert.equal(householdProbe.score([{ month: 1, work: true, share: 0.5 }], m.truth).guard, "the answer is not 24 months");
});
