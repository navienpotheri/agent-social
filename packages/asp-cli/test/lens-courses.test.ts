/**
 * The course catalogue format and loader (register rows DK600, DK601; docs/lenses/course-template.md): a course card has every field the template requires, the prerequisite graph is whole, and
 * `asp academy lens courses|show` lists the catalogue with prices. Fixture cards only; the real catalogue is checked in lens-courses-catalogue.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { checkCatalogue, checkGraph, courseItem, courseSeeds, courseService, lensContext, prerequisitesMet, validateCourse, type CourseCard } from "../src/lens-courses/catalogue.ts";

const ctx = lensContext(new Set(["fixture-engine"]));
const card = (over: Record<string, unknown> = {}): CourseCard => ({
  id: "C-L11-9", title: "A fixture course", concept: "Two sentences. They say what the idea is.", paper: "P99", lens: "L11-self-improving-harness", cells: [{ institution: "academy", function: "learn" }], prerequisites: [], price: 40,
  free_first_lesson: "read ten failures and group them",
  generator: { engine: "fixture-engine", seed_source: "the log head at the time of the sitting, the holder and the attempt", practice: 20, heldout: 40, runs: 5 },
  scorer: { kind: "code", description: "catch rate and false-fail rate", checker: "a hidden grader the suite is never tuned on" },
  artifact: { kind: "eval_suite", description: "cases, gold answers and graders" },
  gate: { metric: "catch rate", pass_permille: 700, runs: 5, error_bar: true },
  write_back: { target: "skill_library", through_gate: true, note: "the suite goes to the skill library" },
  grading: { mode: "code", note: "deterministic rates" },
  teacher: { share_permille: 200, options: "a peer teacher who has passed it" }, cohort: "a cohort works the same seeds",
  risks: "tuning to the visible tasks", kill_switch: "a signed record withdraws the course", ...over,
}) as unknown as CourseCard;

test("a whole card has no problems, and each missing or wrong field is named", () => {
  assert.deepEqual(validateCourse(card(), ctx), []);
  const bad = (over: Record<string, unknown>, re: RegExp) => assert.match(validateCourse(card(over), ctx).join("\n"), re);
  bad({ id: "course-1" }, /id is C-L/);
  bad({ title: "" }, /title is required/);
  bad({ lens: "L99-nothing" }, /lens L99-nothing is not in docs\/lenses\/lenses\.json/);
  bad({ cells: [{ institution: "academy", function: "dance" }] }, /is not on the 12 x 8 grid/);
  bad({ cells: [] }, /at least one institution x function/);
  bad({ price: 19 }, /price is 20 to 60/);
  bad({ price: 61 }, /price is 20 to 60/);
  bad({ price: 40.5 }, /price is 20 to 60/);
  bad({ generator: { engine: "nope", seed_source: "x", practice: 1, heldout: 1, runs: 1 } }, /engine nope is not a registered engine/);
  bad({ generator: { engine: "fixture-engine", seed_source: "", practice: 1, heldout: 1, runs: 1 } }, /seed_source/);
  bad({ generator: { engine: "fixture-engine", seed_source: "x", practice: 0, heldout: 1, runs: 1 } }, /counts above zero/);
  bad({ scorer: { kind: "model", description: "x", checker: "y" } }, /scorer is by code/);
  bad({ artifact: { kind: "poem", description: "x" } }, /artifact is one of/);
  bad({ gate: { metric: "m", pass_permille: 0, runs: 5, error_bar: true } }, /pass mark in permille/);
  bad({ gate: { metric: "m", pass_permille: 700, runs: 5, error_bar: false } }, /error bar/);
  bad({ write_back: { target: "standing_record", through_gate: true, note: "x" } }, /never the standing record/);
  bad({ write_back: { target: "skill_library", through_gate: false, note: "x" } }, /through the gate/);
  bad({ grading: { mode: "vibes", note: "x" } }, /grading is one of/);
  bad({ teacher: { share_permille: 900, options: "x" } }, /teacher has a share/);
  bad({ free_first_lesson: "" }, /free_first_lesson is required/);
  bad({ also_lenses: ["L77"] }, /also_lenses names L77/);
});

test("the prerequisite graph: every prerequisite exists, there is no cycle, a course appears once, and the order follows the prerequisites", () => {
  const a = card({ id: "C-L11-1" }), b = card({ id: "C-L11-2", prerequisites: ["C-L11-1"] }), c = card({ id: "C-L11-3", prerequisites: ["C-L11-1", "C-L11-2"] });
  const ok = checkGraph([c, a, b]);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.order, ["C-L11-1", "C-L11-2", "C-L11-3"], "a course is listed after what it needs, whatever order the file has");
  assert.match(checkGraph([a, card({ id: "C-L11-2", prerequisites: ["C-L11-7"] })]).problems.join(), /C-L11-2 needs C-L11-7, which is not in the catalogue/);
  const cyc = checkGraph([card({ id: "C-L11-1", prerequisites: ["C-L11-3"] }), card({ id: "C-L11-2", prerequisites: ["C-L11-1"] }), card({ id: "C-L11-3", prerequisites: ["C-L11-2"] })]);
  assert.match(cyc.problems.join(), /a prerequisite cycle: .*C-L11-1/);
  assert.deepEqual(cyc.order, []);
  assert.match(checkGraph([card({ id: "C-L11-1", prerequisites: ["C-L11-1"] })]).problems.join(), /needs itself/);
  assert.match(checkGraph([a, a]).problems.join(), /C-L11-1 appears twice/);
  assert.deepEqual(prerequisitesMet(c, new Set(["C-L11-1"])), { ok: false, missing: ["C-L11-2"] });
  assert.deepEqual(prerequisitesMet(c, new Set(["C-L11-1", "C-L11-2"])), { ok: true, missing: [] });
  assert.deepEqual(prerequisitesMet(a, new Set()), { ok: true, missing: [] }, "a first lesson needs nothing");
});

test("a catalogue is checked as a whole: its cards and its graph, and a file that is not a list is refused", () => {
  assert.deepEqual(checkCatalogue([card({ id: "C-L11-1" }), card({ id: "C-L11-2", prerequisites: ["C-L11-1"] })], ctx).problems, []);
  const mixed = checkCatalogue([card({ id: "C-L11-1", price: 5 }), card({ id: "C-L11-2", prerequisites: ["C-L11-4"] })], ctx);
  assert.equal(mixed.problems.length, 2);
  assert.match(checkCatalogue({ courses: [] }, ctx).problems[0], /a list of course cards/);
});

test("the Academy item for a course carries the price of the card and splits the rest to the Academy and the author, the teacher share", () => {
  const c = card({ id: "C-L11-5", price: 40, teacher: { share_permille: 250, options: "x" } });
  const item = courseItem(c, "did:web:example.com:agents:author");
  assert.equal(courseService(c), "academy.course.c-l11-5");
  assert.equal(item.price, 40);
  assert.deepEqual(item.split.payees.map((p) => p.permille), [550, 250]);
  assert.equal(item.split.treasury_permille + item.split.burn_permille + item.split.payees.reduce((n, p) => n + p.permille, 0), 1000, "the split is whole");
  assert.equal(courseItem(card({ teacher: { share_permille: 0, options: "x" } }), "did:x").split.payees.length, 1, "no teacher, no author payee");
});

test("the seeds of a sitting come from an anchor the learner cannot pick ahead of time: they differ by anchor, holder and attempt, and repeat for the same inputs", () => {
  const s = courseSeeds("C-L11-1", "did:a", 1, "sha256:aaa", 5);
  assert.equal(s.length, 5);
  assert.equal(new Set(s).size, 5);
  assert.deepEqual(s, courseSeeds("C-L11-1", "did:a", 1, "sha256:aaa", 5));
  for (const other of [courseSeeds("C-L11-1", "did:a", 1, "sha256:bbb", 5), courseSeeds("C-L11-1", "did:b", 1, "sha256:aaa", 5), courseSeeds("C-L11-1", "did:a", 2, "sha256:aaa", 5), courseSeeds("C-L11-2", "did:a", 1, "sha256:aaa", 5)]) assert.equal(other.filter((x) => s.includes(x)).length, 0);
});

async function asp(args: string[], env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "asp-lens-"));
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...env }, cwd: home } as Io;
  let code: number;
  const saved = process.env.ASP_LENS_COURSES;
  if (env.ASP_LENS_COURSES) process.env.ASP_LENS_COURSES = env.ASP_LENS_COURSES; // the catalogue file is read from the process environment, like other service-level settings
  try { code = await main(args, io); } catch (e) { code = 1; err.push((e as Error).message); } finally { if (saved === undefined) delete process.env.ASP_LENS_COURSES; else process.env.ASP_LENS_COURSES = saved; }
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp academy lens refuses a catalogue with problems and says them, says so for an empty one, and refuses an unknown course and a missing subcommand", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-cat-"));
  const good = join(dir, "good.json"), bad = join(dir, "bad.json"), empty = join(dir, "none.json");
  // the CLI knows only registered engines: a fixture engine is not one, so the fixture catalogue is refused with that problem
  writeFileSync(good, JSON.stringify([card({ id: "C-L11-1" })]));
  const refused = await asp(["academy", "lens", "courses"], { ASP_LENS_COURSES: good });
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /engine fixture-engine is not a registered engine/);
  writeFileSync(bad, "{ not json");
  assert.match((await asp(["academy", "lens", "courses"], { ASP_LENS_COURSES: bad })).out, /is not JSON/);
  writeFileSync(empty, "[]");
  const none = await asp(["academy", "lens", "courses"], { ASP_LENS_COURSES: empty });
  assert.equal(none.code, 0);
  assert.match(none.out, /no lens course is in the catalogue yet/);
  assert.notEqual((await asp(["academy", "lens", "show", "C-L11-1"], { ASP_LENS_COURSES: empty })).code, 0, "a course that is not in the catalogue is refused");
  assert.notEqual((await asp(["academy", "lens"], { ASP_LENS_COURSES: empty })).code, 0, "a usage line for no subcommand");
});
