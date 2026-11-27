// Row ENG102, the Academy's held-out check of a lesson, in the society: on deliveries the author did not make after the card was admitted, do the readers (after reading) pass the house check on the first try more often
// than the others? Three deliveries on each side are needed; a lesson whose readers did no better is FLAGGED (it stays admitted); the report says so on the card's line. Seeded traces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heldOutCheck, renderLessonEvidence } from "../src/cohort/lessons-report.ts";
import { LessonShelf } from "../src/cohort/lessons.ts";

const t = (agent: string, tool: string, input: Record<string, unknown>, ok = true) => ({ t: "tool", at: "2026-11-24T10:00:00.000Z", agent, turn: 1, tool, input, ok, chars: 1, institution: "x", scope: "x", writes: false, ms: 0 });
const ag = (agent: string, handle: string) => ({ t: "agent", at: "2026-11-24T10:00:00.000Z", agent, did: "did:" + agent, handle, kind: "sponsored" });
const d = (a: string, c: string, ok: boolean) => t(a, "deliver_job", { contract: c }, ok);
const CARD = { handle: "agent-01", title: "A job pays on the spot" };
const base = [ag("agent-01", "agent-01"), ag("agent-02", "agent-02"), ag("agent-03", "agent-03"), t("agent-01", "lesson_publish", { title: CARD.title }), t("agent-02", "lesson_read", { id: "lesson-001" })];
const run = (readerPass: boolean[], otherPass: boolean[]): never[] => [...base, ...readerPass.map((p, i) => d("agent-02", `r${i}`, p)), ...otherPass.map((p, i) => d("agent-03", `o${i}`, p)), d("agent-01", "own", false)] as never[];

test("readers did better: helped; no better: flagged but not removed; too few: says so; the author's own deliveries and deliveries before admission are not counted", () => {
  const good = heldOutCheck(run([true, true, true], [true, false, false]), CARD, ["agent-02"]);
  assert.deepEqual([good.verdict, good.readers, good.others], ["helped", [3, 3], [1, 3]]);
  assert.match(good.text, /^Held-out check: readers did better than the others on deliveries the author did not make after the card was admitted: readers after reading 3 of 3, others 1 of 3\./);
  const bad = heldOutCheck(run([true, false, false], [true, true, true]), CARD, ["agent-02"]);
  assert.equal(bad.verdict, "flagged");
  assert.match(bad.text, /FLAGGED, readers did no better than the others \(the card stays admitted; it is only flagged\)/);
  const few = heldOutCheck(run([true, true], [true, true, true]), CARD, ["agent-02"]);
  assert.equal(few.verdict, "too few");
  assert.match(few.text, /too few held-out deliveries to say \(three are needed on each side: readers after reading 2 of 2, others 3 of 3\)/);
  const early = heldOutCheck([d("agent-03", "e1", true), d("agent-03", "e2", true), d("agent-03", "e3", true), ...run([true, true, true], [false, false, false])] as never[], CARD, ["agent-02"]);
  assert.deepEqual(early.others, [0, 3], "deliveries before the card was admitted do not count");
});

test("the report puts the held-out line on an admitted card and the card stays admitted", () => {
  const s = new LessonShelf();
  s.noteAct("agent-01", "deliver_job");
  const c = s.submit("agent-01", "agent-01", { title: CARD.title, lesson: "A short house job I took was paid as soon as the house check accepted my delivery.", evidence: "I called deliver_job and was paid." });
  assert.equal(c.decision.admitted, true);
  s.read("agent-02", "agent-02", c.id);
  const md = renderLessonEvidence(s, run([true, false, false], [true, true, true]), [], [], 3);
  assert.match(md, /Gate: ADMITTED[^\n]*\n  - Held-out check: FLAGGED, readers did no better than the others/);
  assert.equal(s.admitted().length, 1, "flagged, not removed");
  assert.match(md, /the held-out check is a few deliveries from one run and does not separate a lesson from the time an agent had to learn anything else/);
});
