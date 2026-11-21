/**
 * Course C-L2-4 and the tail-variant rule (register row DK814; spec-delta S1205): the held-out set has common cases and tail cases, scored apart; a memoriser (a table of the common answers) scores high on the common
 * cases and near zero on the tail, a solver of the procedure scores high on both, and the course refuses to certify the memoriser. Scripted learners, a toy world; credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registrar } from "../../asp-log/test/academy-kit.ts";
import { school } from "./lens-course-kit.ts";
import { attestation, courseSeeds, courseService, engineIds, loadCatalogue, sit } from "../src/lens-courses/index.ts";
import { COMMON, TAIL, artifactProblems, commonDomain, doNothingArtifact, heldoutFor, memoriserArtifact, practiceCopierArtifact, practiceFor, runProcedure, solverArtifact, truth, wrongModArtifact, wrongOpArtifact } from "../src/lens-courses/procedure.ts";

const cat = loadCatalogue(engineIds());
const card = cat.courses.find((c) => c.id === "C-L2-4")!;
const ANCHOR = "sha256:" + "d".repeat(64);
const seeds = courseSeeds(card.id, "did:a", 1, ANCHOR, 5);

test("the card is whole; practice shows 100 common inputs; the held-out set is 20 common inputs practice did not show and 20 tail inputs (long, large, or both), the same on every machine", () => {
  assert.deepEqual(cat.problems, []);
  assert.equal(card.price, 30);
  const p = practiceFor(seeds[0]), h = heldoutFor(seeds[0]);
  assert.equal(p.examples.length, 100);
  assert.equal(commonDomain().length, 216);
  const shown = new Set(p.examples.map((c) => c.input.join(",")));
  assert.equal(h.common.length, 20); assert.equal(h.tail.length, 20);
  assert.ok(h.common.every((c) => !shown.has(c.input.join(",")) && c.input.length === COMMON.length && c.input.every((x) => x <= 5)), "common cases are of the shape practice showed, and were not shown");
  assert.ok(h.tail.every((c) => c.input.length > COMMON.length || c.input.some((x) => x >= 90)), "every tail case has a parameter at its rare end");
  assert.ok(h.tail.some((c) => c.input.length >= 9 && c.input.every((x) => x <= 5)), "a long list of common values");
  assert.ok(h.tail.some((c) => c.input.length === 3 && c.input.every((x) => x >= 90)), "a short list of large values");
  assert.ok(h.tail.some((c) => c.input.length >= 9 && c.input.every((x) => x >= 90)), "both at once");
  assert.ok(h.tail.every((c) => (TAIL.lengths as readonly number[]).includes(c.input.length) || c.input.length === 3));
  assert.deepEqual(h, heldoutFor(seeds[0]));
  assert.notDeepEqual(h.tail.map((c) => c.input), heldoutFor(seeds[1]).tail.map((c) => c.input));
  assert.equal(truth([3, 4]), 25); assert.equal(truth([10, 10]), (100 + 100) % 97);
});

test("a solver passes both parts on all five runs; a memoriser of the common values scores 100% on the common cases and 0% on the tail and is not certified; so are a copier of practice, a wrong operation, an algorithm right only for small values, and a do-nothing", () => {
  const solver = sit(card, solverArtifact(), "did:a", 1, ANCHOR);
  assert.equal(solver.passed, true, JSON.stringify(solver.runs.map((r) => r.failures)));
  assert.deepEqual(solver.runs.map((r) => [r.measures.common_permille, r.measures.tail_permille]), Array(5).fill([1000, 1000]));
  const mem = runProcedure(memoriserArtifact(), seeds[0]);
  assert.deepEqual([mem.measures.common_permille, mem.measures.tail_permille, mem.score_permille, mem.passed], [1000, 0, 0, false], "high on the common, none on the tail, and it earns nothing");
  assert.match(mem.failures.join(" "), /memorised table looks like, not an understood procedure/);
  const memSit = sit(card, memoriserArtifact(), "did:a", 1, ANCHOR);
  assert.equal(memSit.passed, false); assert.equal(attestation(memSit).ok, false, "the Registrar attests nothing for a memoriser");
  const copy = runProcedure(practiceCopierArtifact(seeds[0]), seeds[0]);
  assert.ok((copy.measures.common_permille as number) < 900 && copy.measures.tail_permille === 0, JSON.stringify(copy.measures));
  const op = runProcedure(wrongOpArtifact(), seeds[0]);
  assert.equal(op.passed, false); assert.ok((op.measures.common_permille as number) < 900);
  const smallOnly = runProcedure(wrongModArtifact(), seeds[0]);
  assert.equal(smallOnly.measures.common_permille, 1000, "right on every common case");
  assert.ok((smallOnly.measures.tail_permille as number) < 900 && smallOnly.passed === false, "wrong where the values are large: only the tail shows it");
  assert.match(runProcedure(doNothingArtifact(), seeds[0]).failures.join(), /exactly one of/);
});

test("an artifact is refused unless it is one lookup or one algorithm of a known operation", () => {
  assert.deepEqual(artifactProblems(solverArtifact()), []);
  assert.match(artifactProblems(null).join(), /an object/);
  assert.match(artifactProblems({ lookup: {}, algorithm: { op: "sum_mod", mod: 5 } }).join(), /exactly one/);
  assert.match(artifactProblems({ algorithm: { op: "evil", mod: 5 } }).join(), /op:/);
  assert.match(artifactProblems({ algorithm: { op: "sum_mod", mod: 5000 } }).join(), /mod: 2 to 1000/);
  assert.match(artifactProblems({ lookup: { "a,b": 1 } }).join(), /a lookup key/);
});

test("the learner pays the card's 30 and the Registrar attests a completion for the solver only; the books balance", async () => {
  const { k, course } = await school(card);
  const learner = await k.agent("c14-learner", undefined, 2);
  await k.job(learner, 500);
  await k.fund(learner, 100);
  const tuition = await k.buy(learner, courseService(card), card.price);
  const enrolment = await k.put(k.mk("enrolment", learner, { course, purchase: tuition }, null, { subject: learner.did }));
  const head = (await k.log.head()).logHash;
  assert.equal(attestation(sit(card, memoriserArtifact(), learner.did, 1, head)).ok, false);
  assert.equal(attestation(sit(card, solverArtifact(), learner.did, 2, head)).ok, true);
  const run = await k.act(learner);
  assert.ok(await k.put(k.mk("completion", registrar, { enrolment, holder: learner.did, exercises_passed: 1, run_log_hash: run }, null, { subject: learner.did })));
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
