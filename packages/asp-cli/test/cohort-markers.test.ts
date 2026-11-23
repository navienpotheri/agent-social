// Rows ENG67 and ENG74: field lessons on the map. The card at a place is a deterministic function of the seed, the place and the 30-minute window of the simulated clock, the same for everyone, drawn from a large pool made
// of template families; nothing is stored. A card is found by looking closely (inspect) and never announced; a right answer is a small once-only reward that points to the Academy, which stays separate; an agent can take a
// given card once, so a return visit in a later window shows another card; a new agent sees the current window's card; the report counts cards seen and taken per window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMITTED_AGENT_LESSONS, GENERATED_POOL, MARKER_PAY, MARKER_PLACES, WINDOW_MS, cardPool, markerAt } from "../src/cohort/markers.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const GOOD = "I would check it with a test on an unseen case, merge or keep one rule, drop what contradicts, give the reason, verify one claim, write the check first, and say what I left out, in the general rule.";

test("the pool has 216 cards from six template families (pattern x topic x level), each with its own question and a house-written cue, and a place for admitted agent lessons that is empty", () => {
  assert.equal(GENERATED_POOL.length, 6 * 12 * 3);
  assert.ok(GENERATED_POOL.length >= 200);
  assert.equal(new Set(GENERATED_POOL.map((c) => c.id)).size, GENERATED_POOL.length, "every card has its own id");
  assert.equal(new Set(GENERATED_POOL.map((c) => c.title)).size, 6 * 12, "a title for each pattern and topic");
  for (const c of GENERATED_POOL) {
    assert.ok(c.text.length < 400 && c.question.length < 140 && !/must|should|have to/i.test(c.text.split(c.topic).join("")), c.id);
    assert.ok(c.accept.test(GOOD), `${c.id} accepts a good answer`);
    assert.ok(c.text.includes(c.topic) && c.question.includes(c.topic), `${c.id} is about its topic`);
  }
  assert.deepEqual(ADMITTED_AGENT_LESSONS, [], "no agent-written lesson is admitted until a review route exists");
  assert.equal(cardPool().length, GENERATED_POOL.length);
});

test("the card at a place is a function of the seed, the place and the window and nothing else: the same for everyone, stable inside a window, different in another, about half of the places hold one", () => {
  assert.equal(markerAt("s", "forum", 3)?.id, markerAt("s", "forum", 3)?.id);
  const grid = (seed: string, w: number) => MARKER_PLACES.map((p) => markerAt(seed, p, w)?.id ?? "-").join(",");
  assert.notEqual(grid("s", 3), grid("s", 4), "the cards change with the window");
  assert.notEqual(grid("s", 3), grid("t", 3), "another seed, another map");
  let held = 0, total = 0;
  for (let w = 0; w < 100; w++) for (const p of MARKER_PLACES) { total++; if (markerAt("s", p, w)) held++; }
  assert.ok(held / total > 0.4 && held / total < 0.6, `${held} of ${total} places hold one`);
  const seen = new Set<string>();
  for (let w = 0; w < 400; w++) for (const p of MARKER_PLACES) { const c = markerAt("s", p, w); if (c) seen.add(c.id); }
  assert.ok(seen.size > 150, `${seen.size} different cards turn up over 400 windows`);
  assert.equal(WINDOW_MS, 30 * 60_000);
});

test("a card is found by inspect and nowhere else; each window shows the same card to everyone; a tip about a card can be checked and goes stale when the window turns; a new agent sees the current card", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mark-world-")), markers: "seed-1" });
  try {
    let ms = 5 * WINDOW_MS + 60_000; // window 5
    w.api.markers!.clock = () => ms;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    const hall = w.api.market!;
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    assert.doesNotMatch((await call(a, "look_map")).text, /\bcard\b|marker/i, "no card is announced");
    const place = MARKER_PLACES.find((p) => markerAt("seed-1", p, 5))!;
    const card = markerAt("seed-1", place, 5)!;
    const seenA = await call(a, "inspect", { place });
    assert.ok(seenA.text.includes(`A card is pinned here: "${card.title}".`) && seenA.text.includes(`(field_answer, place ${place})`));
    assert.equal(seenA.discovery, `marker-found:${card.id}`);
    // the same card for another agent: a tip "the X card is at the Y" can be checked by looking
    assert.ok((await call(b, "inspect", { place })).text.includes(`A card is pinned here: "${card.title}".`), "everyone sees the same card in a window");
    // the window turns: the tip is stale, another card (or none) is there
    ms = 6 * WINDOW_MS + 1000;
    const later = markerAt("seed-1", place, 6);
    const stale = await call(b, "inspect", { place });
    assert.equal(stale.text.includes(`"${card.title}"`), false, "the old card is gone");
    if (later) assert.ok(stale.text.includes(`A card is pinned here: "${later.title}".`));
    // a new agent arriving in window 6 sees window 6's cards
    const c = await w.enrol(2, "agent-03");
    await hall.enrolStandalone(c);
    const place6 = MARKER_PLACES.find((p) => markerAt("seed-1", p, 6))!;
    assert.ok((await call(c, "inspect", { place: place6 })).text.includes(`"${markerAt("seed-1", place6, 6)!.title}"`));
    assert.equal(w.api.markers!.window(), 6);
  } finally { await w.close(); }
});

test("a right answer pays once and points to the Academy; an agent can take a given card once, so a card that comes round again pays nothing the second time; the Academy's sittings are untouched", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mark-take-")), markers: "seed-2" });
  try {
    let ms = 0;
    w.api.markers!.clock = () => ms;
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    // find a place and two windows that show the same card
    let place = "", w1 = -1, w2 = -1;
    outer: for (const p of MARKER_PLACES) for (let x = 0; x < 3000; x++) { const c = markerAt("seed-2", p, x); if (!c) continue; for (let y = x + 1; y < 3000; y++) if (markerAt("seed-2", p, y)?.id === c.id) { place = p; w1 = x; w2 = y; break outer; } }
    assert.ok(place, "a card comes round again at a place");
    const card = markerAt("seed-2", place, w1)!;
    ms = w1 * WINDOW_MS;
    await call("inspect", { place });
    const b0 = await hall.balance(a);
    const wrong = await call("field_answer", { place, answer: "no idea at all really" });
    assert.match(wrong.text, /^Not quite\. Read the card again and answer in your own words: .* You can try again; nothing is lost\./);
    assert.equal(await hall.balance(a), b0);
    const right = await call("field_answer", { place, answer: GOOD });
    assert.ok(right.text.startsWith(`Yes. "${card.title}" is yours, and ${MARKER_PAY} mock credits were added to your balance.`));
    assert.match(right.text, /The Academy's course C-L2-1 teaches this kind of thing at more length and measures what you can do on tasks you have not seen \(course_enrol\); this field lesson is not measured\./);
    assert.equal(await hall.balance(a), b0 + MARKER_PAY);
    assert.match((await call("field_answer", { place, answer: GOOD })).text, /already; it is yours\./);
    // it comes round again in a later window: the same card, taken once, pays nothing
    ms = w2 * WINDOW_MS;
    assert.ok((await call("inspect", { place })).text.includes(`"${card.title}"`));
    const b1 = await hall.balance(a);
    assert.match((await call("field_answer", { place, answer: GOOD })).text, /already; it is yours\./);
    assert.equal(await hall.balance(a), b1, "taken once, wherever and whenever it is met");
    // a place with no card now
    const none = MARKER_PLACES.find((p) => !markerAt("seed-2", p, w2))!;
    assert.match((await call("field_answer", { place: none, answer: "an answer of some length" })).text, /There is no field lesson at .* now\. Looking closely at a place \(inspect\) is how you find one; the cards change as time passes\./);
    assert.match((await call("my_progress")).text, /Field lessons: found \d+, taken 1 \(a field lesson is not a course and is not measured\)\./);
    assert.equal(hall.sittingsOf(a.did, "C-L2-1").length, 0, "no Academy sitting was touched");
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

test("without markers inspect shows nothing of the kind and field_answer says there are none", async () => {
  const plain = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-mark-none-")) });
  try {
    const a = await plain.enrol(0, "agent-01");
    await plain.api.market!.enrolStandalone(a);
    for (const p of MARKER_PLACES) assert.doesNotMatch((await runTool(plain.api, a, all, "inspect", { place: p })).text, /card is pinned/);
    assert.match((await runTool(plain.api, a, all, "field_answer", { place: "forum", answer: "an answer of some length" })).text, /There are no field lessons in this society/);
  } finally { await plain.close(); }
});

test("a scripted explorer finds and takes cards, two agents in one window find the same cards, and the report counts the cards seen and taken in each window", async () => {
  const r = await runCohort({ out: mkdtempSync(join(tmpdir(), "asp-mark-out-")), home: mkdtempSync(join(tmpdir(), "asp-mark-home-")), agents: 2, model: "stand-in", provider: standInProvider(() => "marker-hunter", { latencyMs: 5 }), staggerMs: 40, budgetUsd: 2, totalUsd: 4, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 80, io: { out: () => undefined }, markers: "seed-3" } as CohortOptions);
  const sets = r.report.perAgent.map((s) => s.discoveries.filter((d) => d.startsWith("marker-found")).sort().join("|"));
  assert.ok(sets[0]!.length > 0);
  assert.equal(sets[0], sets[1], "in one window everyone finds the same cards (the run is far shorter than 30 minutes)");
  for (const s of r.report.perAgent) assert.equal(s.discoveries.filter((d) => d.startsWith("marker-taken")).length, s.discoveries.filter((d) => d.startsWith("marker-found")).length);
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /## Cards by window of the simulated clock\n\nThe card at a place changes every 30 simulated minutes and is the same for everyone in a window\. 1 window had a card looked at: window \d+: \d+ cards? seen, \d+ taken\./);
  assert.match(md, /Field lessons on the map: 2 of 2 agents found one and 2 took one \(what they wrote: /);
  const credit = JSON.parse(readFileSync(join(r.dir, "credit-economy.json"), "utf8")) as { audit: { verdict: string } };
  assert.equal(credit.audit.verdict, "balanced");
});
