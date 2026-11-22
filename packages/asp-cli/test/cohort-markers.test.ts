// Row ENG67: course markers scattered over the map. A field lesson is found by looking closely at a place (inspect), never announced; which places hold one, and which lesson, is deterministic from the run's seed, the
// agent and the day, so a run is reproducible, agents find different ones and the markers move with the day cycle; a correct answer is a small once-only reward that points to the Academy's course for a measured lift,
// and the Academy's held-out exams are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIELD_LESSONS, MARKER_PAY, MARKER_PLACES, markerAt } from "../src/cohort/markers.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { DAY } from "../src/cohort/day-cycle.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const GOOD = "I would check it with a test on an unseen case, merge or keep one rule, drop what contradicts, give the reason, verify one claim, write the check first, and say what I left out.";

test("the placement is a deterministic function of the seed, the agent, the place and the day: the same inputs give the same marker, other agents and other days give others, and about half of the places hold one", () => {
  assert.equal(markerAt("s", "did:a", "forum", 0)?.id, markerAt("s", "did:a", "forum", 0)?.id);
  const grid = (seed: string, did: string, day: number) => MARKER_PLACES.map((p) => markerAt(seed, did, p, day)?.id ?? "-").join(",");
  assert.notEqual(grid("s", "did:a", 0), grid("s", "did:b", 0), "agents find different ones");
  assert.notEqual(grid("s", "did:a", 0), grid("s", "did:a", 1), "the markers move from day to day");
  assert.notEqual(grid("s", "did:a", 0), grid("t", "did:a", 0), "another seed, another map");
  let held = 0, total = 0;
  for (let i = 0; i < 100; i++) for (const p of MARKER_PLACES) { total++; if (markerAt("s", `did:${i}`, p, 0)) held++; }
  assert.ok(held / total > 0.4 && held / total < 0.6, `${held} of ${total} places hold one`);
  assert.equal(new Set(FIELD_LESSONS.map((l) => l.id)).size, FIELD_LESSONS.length);
  for (const l of FIELD_LESSONS) { assert.ok(l.text.length < 330 && l.question.length < 120 && !/must|should|have to/i.test(l.text), l.id); assert.ok(l.accept.test(GOOD), `${l.id} accepts a good answer`); }
});

test("a marker is found by inspect and nowhere else: look_map does not mention it; the card gives a short lesson and one question; a wrong answer costs nothing, a right one pays once and points to the Academy, which stays separate", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mark-world-")), markers: "seed-1" });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const first = await call("look_map");
    assert.doesNotMatch(first.text, /card|field lesson|marker/i, "nothing announces them");
    const place = MARKER_PLACES.find((p) => markerAt("seed-1", a.did, p, 0))!;
    assert.ok(place, "this agent has a marker somewhere");
    const lesson = markerAt("seed-1", a.did, place, 0)!;
    const seen = await call("inspect", { place });
    assert.ok(seen.text.includes(`A card is pinned here: "${lesson.title}".`));
    assert.ok(seen.text.includes(`(field_answer, place ${place})`));
    assert.equal(seen.discovery, `marker-found:${lesson.id}`);
    assert.equal(w.api.markers!.foundBy(a.did), 1);
    assert.equal((await call("inspect", { place })).discovery, undefined, "found once");
    const b0 = await hall.balance(a);
    const wrong = await call("field_answer", { place, answer: "no idea at all really" });
    assert.match(wrong.text, /^Not quite\. Read the card again and answer in your own words: .* You can try again; nothing is lost\./);
    assert.equal(await hall.balance(a), b0);
    const none = MARKER_PLACES.find((p) => !markerAt("seed-1", a.did, p, 0))!;
    assert.match((await call("field_answer", { place: none, answer: "an answer of some length" })).text, /There is no field lesson at .* for you now\. Looking closely at a place \(inspect\) is how you find one\./);
    const right = await call("field_answer", { place, answer: GOOD });
    assert.ok(right.text.startsWith(`Yes. "${lesson.title}" is yours, and ${MARKER_PAY} mock credits were added to your balance.`));
    assert.match(right.text, /The Academy's course C-L2-1 teaches this at more length and measures what you can do on tasks you have not seen \(course_enrol\); this field lesson is not measured\./);
    assert.equal(await hall.balance(a), b0 + MARKER_PAY);
    assert.equal(right.discovery, `marker-taken:${lesson.id}`);
    assert.match((await call("field_answer", { place, answer: "the same answer again, at some length" })).text, /already; it is yours\./);
    assert.equal(await hall.balance(a), b0 + MARKER_PAY, "paid once");
    assert.equal(w.api.markers!.paid, MARKER_PAY);
    assert.match((await call("my_progress")).text, /Field lessons: found 1, taken 1 \(a field lesson is not a course and is not measured\)\./);
    assert.equal(hall.sittingsOf(a.did, "C-L2-1").length, 0, "no Academy sitting was touched");
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

test("with a day cycle the markers move: the same place holds another lesson, or none, on another day; without markers inspect shows nothing of the kind", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mark-day-")), markers: "seed-2", dayCycle: true });
  try {
    const a = await w.enrol(0, "agent-01");
    await w.api.market!.enrolStandalone(a);
    const grid = (day: number) => MARKER_PLACES.map((p) => markerAt("seed-2", a.did, p, day)?.id ?? "-").join(",");
    assert.equal(w.api.markers!.day, 0);
    await w.api.dayCycle!.due(0, 2 * DAY + 10 * 3_600_000);
    assert.equal(w.api.markers!.day, 2, "the day cycle moved the markers to day 3");
    assert.notEqual(grid(0), grid(2));
    const p = MARKER_PLACES.find((x) => markerAt("seed-2", a.did, x, 2))!;
    assert.ok((await runTool(w.api, a, all, "inspect", { place: p })).text.includes(`A card is pinned here: "${markerAt("seed-2", a.did, p, 2)!.title}"`));
  } finally { await w.close(); }
  const plain = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mark-none-")) });
  try {
    const a = await plain.enrol(0, "agent-01");
    await plain.api.market!.enrolStandalone(a);
    for (const p of MARKER_PLACES) assert.doesNotMatch((await runTool(plain.api, a, all, "inspect", { place: p })).text, /card is pinned/);
    assert.match((await runTool(plain.api, a, all, "field_answer", { place: "forum", answer: "an answer of some length" })).text, /There are no field lessons in this society/);
  } finally { await plain.close(); }
});

test("a scripted explorer looks closely at every place, finds the cards that are there, answers them, and the report counts who found and who took one; agents with different identities find different cards", async () => {
  const r = await runCohort({ out: mkdtempSync(join(tmpdir(), "asp-mark-out-")), home: mkdtempSync(join(tmpdir(), "asp-mark-home-")), agents: 3, model: "stand-in", provider: standInProvider(() => "marker-hunter", { latencyMs: 5 }), staggerMs: 40, budgetUsd: 2, totalUsd: 6, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 80, io: { out: () => undefined }, markers: "seed-3" } as CohortOptions);
  for (const s of r.report.perAgent) {
    const found = s.discoveries.filter((d) => d.startsWith("marker-found")), taken = s.discoveries.filter((d) => d.startsWith("marker-taken"));
    assert.ok(found.length >= 3, `${s.handle} found ${found.length}`);
    assert.equal(taken.length, found.length, "each card found was answered");
    assert.equal(s.endReason, "stopped_exploring");
  }
  const sets = r.report.perAgent.map((s) => s.discoveries.filter((d) => d.startsWith("marker-found")).join("|"));
  assert.equal(new Set(sets).size, 3, "three agents, three different sets");
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /Field lessons on the map: 3 of 3 agents found one and 3 took one \(/);
  const credit = JSON.parse(readFileSync(join(r.dir, "credit-economy.json"), "utf8")) as { audit: { verdict: string } };
  assert.equal(credit.audit.verdict, "balanced");
});
