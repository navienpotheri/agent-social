/**
 * The cohort demo, step 1 (register row DK750; spec-delta S990): about 24 scripted agents on a fresh log, a cohort of 12 takes course C-L2-1 and 12 do not. The story is signed records; the held-out score before and
 * after and the lift are computed from held-out cases only. Same seed, same log. The control never enrols; a no-op course shows no lift; a copied or leaked answer fails and writes nothing back; books balance.
 * Scripted agents, toy world, credits are accounting entries, not money, nothing changes model weights.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { COHORT_SCOPE, heldoutScore, liftStat, runCohort, runCohortWithLog } from "../src/lens-courses/cohort.ts";

test("the same seed gives the same log, the same cohort and the same numbers; another seed gives another log and another cohort", async () => {
  const a = await runCohortWithLog({ seed: "alpha" }), b = await runCohortWithLog({ seed: "alpha" }), c = await runCohortWithLog({ seed: "beta" });
  assert.equal(a.story.head, b.story.head, "the log head hash is the same");
  assert.deepEqual(a.story, b.story);
  assert.notEqual(a.story.head, c.story.head);
  assert.notDeepEqual(a.story.agents.filter((x) => x.group === "cohort").map((x) => x.id), c.story.agents.filter((x) => x.group === "cohort").map((x) => x.id));
  assert.equal(a.story.records, (await a.k.log.head()).seq);
  assert.equal((await a.k.log.verify()).ok, true);
});

test("24 agents: a mix of sponsored, key-only and labelled house agents; 12 in the cohort and 12 in the control, with other society activity (a job, a service bought, a game)", async () => {
  const { story, k } = await runCohortWithLog();
  assert.equal(story.agents.length, 24);
  assert.equal(story.summary.cohort, 12);
  assert.equal(story.summary.control, 12);
  const levels = new Set(story.agents.map((a) => a.level));
  assert.deepEqual([...levels].sort(), ["house", "key_only", "sponsored"]);
  const passports = (await k.log.recordsOfTypes(["passport"])).map((r) => r.body as { did: string; kind: string; sponsor?: string; house?: true });
  for (const a of story.agents) {
    const mine = passports.filter((p) => p.did === a.id);
    assert.ok(mine.length >= 1, a.id);
    if (a.level === "house") assert.ok(mine.every((p) => p.house === true), "a house agent is labelled on every passport");
    else assert.ok(mine.every((p) => !p.house));
    if (a.level === "key_only") assert.ok(mine.every((p) => p.sponsor === a.id), "a key-only agent names no one but itself");
  }
  const kinds = new Set(story.agents.flatMap((a) => a.other));
  assert.deepEqual([...kinds].sort(), ["game", "job", "service"]);
  assert.ok(story.flows.some((f) => f.kind === "job") && story.flows.some((f) => f.kind === "game") && story.flows.some((f) => f.kind === "purchase"));
});

test("the control is excluded from the course: no enrolment, no tuition, no completion, no learning record, and its score does not move", async () => {
  const { story, k } = await runCohortWithLog();
  const cohort = new Set(story.agents.filter((a) => a.group === "cohort").map((a) => a.id));
  const enrolled = (await k.log.recordsOfTypes(["enrolment"])).map((r) => r.issuer);
  assert.equal(enrolled.length, 12);
  assert.ok(enrolled.every((d) => cohort.has(d)));
  const completed = (await k.log.recordsOfTypes(["completion"])).map((r) => (r.body as { holder: string }).holder);
  assert.ok(completed.every((d) => cohort.has(d)));
  const learned = (await k.log.recordsOfTypes(["passport"])).filter((r) => (r.body as { learning_record?: unknown }).learning_record).map((r) => (r.body as { did: string }).did);
  assert.ok(learned.every((d) => cohort.has(d)));
  assert.equal(learned.length, story.summary.passed, "one learning record for each agent that passed");
  for (const a of story.agents.filter((x) => x.group === "control")) { assert.equal(a.enrolled, false); assert.equal(a.paid, 0); assert.equal(a.lift, 0); assert.deepEqual(a.lessons, []); assert.equal(a.script, undefined); }
});

test("the lift is computed from held-out scores only: it equals the mean change of each agent's held-out accuracy, recomputed here from the lessons and the seed, and does not depend on what was paid or who was sponsored", async () => {
  const s = await runCohort({ seed: "gamma" });
  const co = s.agents.filter((a) => a.group === "cohort"), ct = s.agents.filter((a) => a.group === "control");
  const again = liftStat(co.map((a) => a.after - a.before), ct.map((a) => a.after - a.before));
  assert.deepEqual(s.summary.lift, again);
  for (const a of co.filter((x) => x.written_back)) {
    // an agent's seed is from its sitting; the same held-out cases give the same before and after
    const memory = a.lessons;
    assert.equal(a.after - a.before, heldoutScore(memory, a.heldout_seed).accuracy - heldoutScore([], a.heldout_seed).accuracy);
  }
  assert.ok(s.summary.lift.difference > 0 && s.summary.lift.t > 3, JSON.stringify(s.summary.lift));
  assert.equal(s.summary.lift.mean_lift_control, 0);
  assert.match(s.summary.lift.method, /Welch/);
  assert.ok(s.summary.cost_per_point! > 0, "credits per percentage point of lift");
  // changing nothing about the held-out cases but the tuition would not change the lift: the stat is a function of the two lists only
  assert.deepEqual(liftStat([1, 2, 3], [0, 0, 0]), liftStat([1, 2, 3], [0, 0, 0]));
});

test("a no-op course shows no lift: every cohort agent writes nothing, nobody completes, the lift and the t value are zero and there is no cost per point", async () => {
  const s = await runCohort({ seed: "alpha", noop: true });
  assert.equal(s.summary.completed, 0);
  assert.equal(s.summary.after_cohort, s.summary.before_cohort);
  assert.equal(s.summary.lift.difference, 0);
  assert.equal(s.summary.lift.t, 0);
  assert.equal(s.summary.cost_per_point, null);
  assert.ok(s.agents.every((a) => a.lift === 0));
});

test("a copied answer, a leaked held-out name, over-broad rules and a halfway set each fail the sitting, write nothing back and leave the memory and the score unchanged; only the honest agents pass", async () => {
  const s = await runCohort();
  const by = (script: string) => s.agents.filter((a) => a.script === script);
  for (const script of ["copier", "leaker", "overbroad", "halfway"]) {
    for (const a of by(script)) { assert.equal(a.passed, false, script); assert.equal(a.written_back, false, script); assert.deepEqual(a.lessons, [], script); assert.equal(a.lift, 0, script); assert.ok(a.failures.length > 0, script); }
  }
  assert.match(by("copier")[0].failures.join(" "), /a lesson is `when/);
  assert.match(by("leaker")[0].failures.join(" "), /a service of the held-out tasks/);
  assert.match(by("overbroad")[0].failures.join(" "), /too broad|right on/);
  for (const a of by("honest")) { assert.equal(a.passed, true); assert.equal(a.written_back, true); assert.equal(a.lift, 600); assert.equal(a.regressions, 0); }
  assert.equal(s.summary.passed, by("honest").length);
  assert.equal(s.summary.pass_rate_permille, Math.round((by("honest").length / 12) * 1000));
});

test("the books balance: every mock credit is accounted for, tuition is paid by the cohort only (30 each), and the story carries its honest scope", async () => {
  const { story, k } = await runCohortWithLog();
  assert.equal(story.books, "balanced");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal(story.summary.tuition, 12 * story.price);
  assert.equal(story.agents.reduce((n, a) => n + a.paid, 0), 12 * 30);
  assert.equal(story.scope, COHORT_SCOPE);
  assert.match(story.scope, /not money/);
  assert.match(story.scope, /no real model/);
});
