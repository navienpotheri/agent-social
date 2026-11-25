// Rows ENG123 and ENG124, tranche 1: the cards on the map carry research papers: eight courses, four numbered parts each (32 cards), every card labelled with its course, lens and paper ids; three of four parts carry one practice question; a set of
// all the parts of one paper completes it and opens the Academy's one held-out check for that course (collecting does not accredit); rewards for pick up, read and complete are flags; the card window is a flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEEP_COURSES, PAPER_COURSES, PAPER_POOL, RULE_META } from "../src/cohort/paper-cards.ts";
import { Markers, MARKER_PLACES, markerAt } from "../src/cohort/markers.ts";
import { renderPaperReport } from "../src/cohort/paper-report.ts";
import { introFor, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { engineIds, ENGINES, loadCatalogue } from "../src/lens-courses/index.ts";

/** A model answer for each practice question, to show the question can be answered and that a non-answer is not accepted. */
const SAMPLE: Record<string, string> = {
  "C-L11-1.p1": "A reply with a missing field, which a short rule can check.", "C-L11-1.p2": "The absent check would flag a reply that lacks the order number.", "C-L11-1.p3": "It would fail every good reply too, so it catches nothing useful.",
  "C-L9-1.p1": "I would state the option in one plain sentence with a clear mark, so a stranger could read it.", "C-L9-1.p2": "A pattern that matches a number after the word option in the partner's message.", "C-L9-1.p3": "Follow the partner to the safe option and agree with it.",
  "C-L2-1.p1": "when the service name is new then check the deploy settings before going ahead", "C-L2-1.p2": "Merge them into one lesson and keep a single line.", "C-L2-1.p3": "Replay the rule on new cases it was not written from and see whether it breaks any.",
  "C-L19-1.p1": "Because the student will meet new tickets, so general rules help more than the cases.", "C-L19-1.p2": "when the ticket is urgent and the customer is new then escalate to the lead", "C-L19-1.p3": "Both: the default once and each exception with its condition.",
  "C-L18-1.p1": "I would look at my balance and the price of the item.", "C-L18-1.p2": "when the balance is low and the item is not needed then defer", "C-L18-1.p3": "Because a rule that only fits the logged ten will not hold on new purchases I have not seen.",
  "C-L7-1.p1": "The amount of the claim and whether it was flagged.", "C-L7-1.p2": "when the claim is flagged and the amount is high then investigate", "C-L7-1.p3": "The one that fits ten claims, I would hold it more firmly.",
  "C-L14-1.p1": "I would check the vitals and the risk before urgent.", "C-L14-1.p2": "when the symptom is severe and the duration is long then refer", "C-L14-1.p3": "It should say the default and be honest about where it is unsure, with monitor as the default.",
  "C-L8-1.p1": "The rule that decided it and the seller, a short fact.", "C-L8-1.p2": "when the price is far below the category and reports exist then flag", "C-L8-1.p3": "Update the rule, narrow it or drop it, so the memory stays true.",
};
for (const d of DEEP_COURSES) d.tasks.forEach((t, i) => { SAMPLE[`${d.course}.p${i + 1}`] = t.model; });
for (const m of RULE_META) { SAMPLE[`${m.course}.p1`] = `${m.features[0]} and ${m.features[1]}`; SAMPLE[`${m.course}.p2`] = `when the ${m.features[0]} is high then ${m.outcomes[0]}`; SAMPLE[`${m.course}.p3`] = m.ideaSample; }
const all = new Set(TOOLS.map((t) => t.scope));
test("twenty-three papers, four parts each, ninety-two cards, each labelled and traceable to a built course; the courses are built on the Academy with a held-out sitting", () => {
  assert.equal(PAPER_COURSES.length, 23, "eight courses of tranche 1, ten of tranche 2 and five of the remaining courses");
  assert.equal(PAPER_POOL.length, 92);
  const cat = loadCatalogue(engineIds()).courses;
  for (const c of PAPER_COURSES) {
    const card = cat.find((x) => x.id === c.course)!;
    assert.ok(card && ENGINES[card.generator.engine], `${c.course} is a built course with an engine`);
    assert.equal(card.generator.heldout >= 40, true, "the held-out sitting draws forty items per run");
    assert.equal(c.parts.length, 4);
    assert.equal(c.parts.filter((p) => p.task).length, 3, "one practice question on three of the four parts");
    for (const p of c.parts) {
      const pc = PAPER_POOL.find((x) => x.id === `${c.course}.p${p.n}`)!;
      assert.match(pc.text, new RegExp(`Part ${p.n} of 4 of .* \\(course ${c.course}; lens ${c.lens}; papers `));
      assert.ok(pc.text.length < 3600, "a part is at most about 400 words");
      if (p.task) { assert.ok(p.task.accept.test(SAMPLE[pc.id]!), `${pc.id} accepts its model answer`); assert.ok(!p.task.accept.test("I do not know."), `${pc.id} does not accept a non-answer`); }
    }
  }
});

test("a set of all four parts completes the paper: pickups, reads and the set are rewarded as set by the flags; the Academy's check for that course is then open; a part is taken once", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-paper-")), markers: "t", paperCards: true, cardWindowMin: 60, cardRewards: { pickup: 1, read: 2, complete: 5 } });
  try {
    const m = w.api.markers!;
    assert.equal(m.paperMode, true);
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    const call = (n: string, i: Record<string, unknown> = {}) => runTool(w.api, a, all, n, i);
    const course = "C-L9-1", ids = [1, 2, 3, 4].map((n) => `${course}.p${n}`);
    const at = new Map<string, { place: string; window: number }>();
    for (let win = 0; win < 600 && at.size < 4; win++) for (const place of MARKER_PLACES) { const c = markerAt("t", place, win, () => PAPER_POOL as never); if (c && ids.includes(c.id) && !at.has(c.id)) at.set(c.id, { place, window: win }); }
    assert.equal(at.size, 4, "every part of the paper is on the map in some window");
    const before = await w.api.market!.balance(a);
    let last = "";
    for (const id of ids) {
      const p = at.get(id)!; m.clock = () => p.window * 60 * 60_000 + 1000;
      const look = (await call("inspect", { place: p.place })).text;
      assert.match(look, /A card is pinned here: .*Part \d of 4/);
      assert.match(look, /\d+ mock credits were added to your balance for picking it up/);
      const part = PAPER_COURSES.find((c) => c.course === course)!.parts[Number(id.slice(-1)) - 1]!;
      if (part.task) {
        const r = (await call("field_answer", { place: p.place, answer: SAMPLE[id]! })).text;
        assert.match(r, /Yes\. [^]*Part \d of /);
        last = r;
      } else last = look;
    }
    assert.match(last, /the Academy's held-out check for C-L9-1 is open to you \(course_enrol C-L9-1, then course_sit\)/);
    assert.deepEqual(m.setsOf(a.did), [course]);
    assert.equal(await w.api.market!.balance(a), before + 4 * 1 + 3 * 2 + 5, "pickup 1 x 4, read 2 x 3 (the fourth part is read when picked up: no extra), complete 5");
    // a part already taken is not taken twice
    const p1 = at.get(ids[0]!)!; m.clock = () => p1.window * 60 * 60_000 + 1000;
    assert.match((await call("field_answer", { place: p1.place, answer: SAMPLE[ids[0]!]! })).text, /already; it is yours/);
    const rep = renderPaperReport(m, (c) => w.api.market!.sittingStats(c), 1);
    assert.match(rep, /\| C-L9-1 Passing a message another agent can use \| P7, P18, P53 \| 1\/1 \| 1\/1 \| 1\/1 \| 1\/1 \| 1 \| 0 \(0 sittings\) \| 0 \|/);
    // the Academy offers the course
    assert.match((await call("look_courses")).text, /C-L9-1/);
    assert.match(introFor(w.api, 0), /Cards: parts of real research papers lie on the map/);
  } finally { await w.close(); }
});

test("the card window is a setting: sixty simulated minutes by default in a cohort run, thirty for the template cards", () => {
  const a = new Markers("s", () => 59 * 60_000, { windowMs: 60 * 60_000 }), b = new Markers("s", () => 59 * 60_000);
  assert.equal(a.window(), 0);
  assert.equal(b.window(), 1, "the old window is thirty minutes");
});

test("before and after: every sitting of a paper course is logged with what the agent had of the paper's cards; the report has a before, some part and whole set table; sittings stay unlocked", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-paper-ba-")), markers: "t", paperCards: true, cardWindowMin: 60 });
  try {
    const m = w.api.markers!, hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"); await hall.enrolStandalone(a);
    const call = (n: string, i: Record<string, unknown> = {}) => runTool(w.api, a, all, n, i);
    const course = "C-L9-1";
    assert.match((await call("course_enrol", { course })).text, /./);
    await call("course_sit", { course, answer: "{}" }); // a sitting before any card: unlocked
    const ids = [1, 2, 3, 4].map((n) => `${course}.p${n}`), at = new Map<string, { place: string; window: number }>();
    for (let win = 0; win < 600 && at.size < 4; win++) for (const place of MARKER_PLACES) { const c = markerAt("t", place, win, () => PAPER_POOL as never); if (c && ids.includes(c.id) && !at.has(c.id)) at.set(c.id, { place, window: win }); }
    for (const id of ids) { const p = at.get(id)!; m.clock = () => p.window * 3_600_000 + 1000; await call("inspect", { place: p.place }); const part = PAPER_COURSES.find((c) => c.course === course)!.parts[Number(id.slice(-1)) - 1]!; if (part.task) await call("field_answer", { place: p.place, answer: SAMPLE[id]! }); }
    await call("course_sit", { course, answer: JSON.stringify({ after: "the cards" }) });
    const log = hall.sittingLog.filter((r) => r.course === course);
    assert.equal(log.length, 2);
    assert.deepEqual([log[0]!.parts, log[0]!.set, log[1]!.parts, log[1]!.set], [0, false, 4, true]);
    const rep = renderPaperReport(m, (c) => hall.sittingStats(c), 1, hall.sittingLog);
    assert.match(rep, /### Before and after, by sitting/);
    assert.match(rep, /\| C-L9-1 \| 1, [\d.]+ \| 0, none \| 1, [\d.]+ \| 0, none \| 0, none \|/);
  } finally { await w.close(); }
});

test("the substantial courses: four parts of 250 to 400 words, the source and its type, three practice tasks with a worked model answer shown after a right answer, and a paragraph on what the course does and does not test", () => {
  assert.ok(DEEP_COURSES.length >= 4);
  for (const d of DEEP_COURSES) {
    const c = PAPER_COURSES.find((x) => x.course === d.course)!;
    assert.equal(d.parts.length, 4); assert.equal(d.tasks.length, 3);
    for (const p of d.parts) { const words = p.text.split(/\s+/).length; assert.ok(words >= 230 && words <= 420, `${d.course} ${p.title}: ${words} words`); }
    assert.ok(c.source && c.sourceType && c.tests, "source, type and what is tested");
    assert.match(c.parts[0]!.digest, /./);
    const first = PAPER_POOL.find((x) => x.id === `${d.course}.p1`)!, last = PAPER_POOL.find((x) => x.id === `${d.course}.p4`)!;
    assert.match(first.text, /Source: .* Type: /); assert.match(last.text, /What this course does and does not test of the source: /);
    assert.ok(/NOT test/.test(d.tests), `${d.course} says plainly what it does not test`);
    for (const t of d.tasks) { assert.ok(t.accept.test(t.model), "the model answer is accepted"); assert.ok(!t.accept.test("I do not know."), "a non-answer is not"); }
    assert.equal(first.paper!.model, d.tasks[0]!.model);
  }
});
