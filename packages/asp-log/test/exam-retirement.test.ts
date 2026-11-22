/**
 * Withdrawing an exam, a sitting at no fee after the Academy's own error, and the author suspension rule (register row DK117; spec-delta S1700; academy.md 5 and 6): each is a log rule with a refusal named in a test.
 * Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { examSeed, examVariant } from "../src/index.ts";
import { AUTHOR_MIN_LEARNERS, AUTHOR_STRIKE_DAYS, AUTHOR_STRUCK_MIN, AUTHOR_STRUCK_SHARE_PERMILLE, AUTHOR_WINDOW_DAYS } from "../src/academy.ts";
import { Kit, SERVICES, hashOf, refused, registrar, courts, type Party } from "./academy-kit.ts";

const withdrawal = (k: Kit, exam: string, over: Record<string, unknown> = {}, by: Party = registrar) => k.mk("exam_retirement", by, { exam, reason: "leaked", evidence: "a copy of the pool was posted on a public forum", ...over }, null, { subject: null });

test("DK117: the Registrar withdraws an exam once; no new sitting of it is scored, its replacement is; results already issued stand", async () => {
  const k = new Kit();
  const x = await k.agent("wd-x", undefined, 1); await k.fund(x, 300);
  const y = await k.agent("wd-y", undefined, 1); await k.fund(y, 300);
  const old = await k.defineExam("foundations-wd-v1", "foundations", 1);
  const passed = await k.sit(x, old, 900);
  await k.put(withdrawal(k, old));
  assert.equal(await refused(k.sit(y, old, 900)), "exam_withdrawn", "a new sitting of a withdrawn exam is refused");
  // the next season's exam is a new definition, and a withdrawal may name it
  const next = await k.defineExam("foundations-wd-v2", "foundations", 1);
  assert.ok(await k.sit(y, next, 900), "the replacement exam is sat as usual");
  // a result issued before the withdrawal still backs a certificate
  assert.ok(await k.put(k.certificate(x, "foundations", 1, passed)), "results and certificates already issued stand");
  assert.equal(await refused(k.put(withdrawal(k, old, { reason: "overfitted" }))), "exam_already_withdrawn");
});

test("DK117: a withdrawal is the Registrar's, of an exam definition in the log, and a replacement must be another definition", async () => {
  const k = new Kit();
  const a = await k.defineExam("foundations-wd2-v1", "foundations", 1);
  const b = await k.defineExam("foundations-wd2-v2", "foundations", 1);
  assert.equal(await refused(k.put(withdrawal(k, a, {}, courts))), "exam_retirement_wrong_issuer", "the Courts do not withdraw an exam");
  assert.equal(await refused(k.put(withdrawal(k, hashOf("a")))), "exam_retirement_unknown_exam");
  const person = await k.person("wd2-person");
  assert.equal(await refused(k.put(withdrawal(k, person.did.length ? (await k.log.recordsOfTypes(["passport"]))[0]!.id : a))), "exam_retirement_unknown_exam", "a record that is not an exam is refused");
  assert.equal(await refused(k.put(withdrawal(k, a, { replaced_by: a }))), "exam_retirement_bad_replacement", "an exam is not its own replacement");
  assert.equal(await refused(k.put(withdrawal(k, a, { replaced_by: hashOf("b") }))), "exam_retirement_bad_replacement", "the replacement exists");
  assert.equal(await refused(k.put(withdrawal(k, a, { replaced_by: (await k.log.recordsOfTypes(["passport"]))[0]!.id }))), "exam_retirement_bad_replacement", "and is an exam definition, not any record");
  assert.ok(await k.put(withdrawal(k, a, { replaced_by: b })), "naming the replacement is allowed");
  assert.equal((await k.log.recordsOfTypes(["exam_retirement"])).length, 1);
});

/** A sitting scored with no fee: the holder's certificate was revoked for the Academy's own error, and `sitting` is that revocation. */
function freeSitting(k: Kit, agent: Party, examId: string, revocation: string, run: string, over: Record<string, unknown> = {}) {
  const seed = examSeed(examId, agent.did, 1);
  return k.mk("exam_result", registrar, { exam: examId, holder: agent.did, score_permille: 900, pass_mark_permille: 800, passed: true, attempt: 1, variant: examVariant(seed, 40, []), seed, sitting: revocation, run_log_hash: run, missed_categories: [], ...over }, null, { subject: agent.did });
}

test("DK117: a certificate revoked for the Academy's own error gives one sitting at no fee, for the same skill and level, to its holder only", async () => {
  const k = new Kit();
  const a = await k.agent("rs-a", undefined, 1);
  const b = await k.agent("rs-b", undefined, 1);
  const cert = await k.certify(a, "foundations", 1);
  const cheat = await k.certify(b, "foundations", 1);
  const exam2 = await k.defineExam("foundations-rs-v2", "foundations", 1);
  const other = await k.defineExam("practitioner-rs-v1", "research", 2);
  const errorRev = await k.put(k.revoke(cert, "error"));
  const cheatRev = await k.put(k.revoke(cheat, "cheating"));
  const run = await k.act(a);
  const before = await k.log.balance(a.did);
  assert.equal(await refused(k.put(freeSitting(k, b, exam2, cheatRev, await k.act(b)))), "resit_not_error", "a revocation for cheating gives no free sitting");
  assert.equal(await refused(k.put(freeSitting(k, b, exam2, errorRev, await k.act(b)))), "resit_not_holders", "another's revocation is not the holder's");
  assert.equal(await refused(k.put(freeSitting(k, a, other, errorRev, run))), "resit_wrong_exam", "a sitting for another skill is not the re-sit");
  const ok = await k.put(freeSitting(k, a, exam2, errorRev, run));
  assert.ok(ok, "the free sitting is scored");
  assert.equal(await k.log.balance(a.did), before, "and no fee was paid");
  assert.equal(await refused(k.put(freeSitting(k, a, exam2, errorRev, await k.act(a), { attempt: 2, variant: examVariant(examSeed(exam2, a.did, 2), 40, []), seed: examSeed(exam2, a.did, 2) }))), "resit_used", "one revocation gives one sitting");
});

// ---- the author suspension rule ----

async function school() {
  const k = new Kit();
  await k.priceList();
  const [author, r1, r2] = [await k.agent("as-author"), await k.agent("as-rev1"), await k.agent("as-rev2")];
  let n = 0;
  const publish = (over: Record<string, unknown> = {}) => k.mk("course", author, { course: `as-course-${++n}`, title: "Working inside a Mandate", skill: "foundations", level: 1, lessons: [hashOf("a")], exercises: hashOf("e"), exercise_count: 3, price_service: SERVICES.foundations, author_share_permille: 550, reviews: [hashOf("b"), hashOf("c")], reviewers: [r1.did, r2.did], ...over }, null, { subject: null, cosigners: [registrar] });
  const courseId = await k.put(publish());
  const learn = async (name: string, pre?: Party) => {
    const learner = pre ?? (await k.agent(name, undefined, 2));
    await k.job(learner, 500); await k.fund(learner, 300);
    const e = await k.put(k.mk("enrolment", learner, { course: courseId, purchase: await k.buy(learner, SERVICES.foundations, 30) }, null, { subject: learner.did }));
    const run = await k.act(learner);
    await k.put(k.mk("completion", registrar, { enrolment: e, holder: learner.did, exercises_passed: 3, run_log_hash: run }, null, { subject: learner.did }));
    return learner;
  };
  /** The Registrar records an attempt on a world's hidden state: a blocked attempt, which counts as a strike. */
  const strike = (a: Party, tag: string) => k.put(k.mk("world_event", registrar, { world: "w1", agent: a.did, kind: "hidden_state_read", attempt: { via: "path", sha256: "sha256:" + tag.repeat(64) } }, null, { subject: a.did }));
  return { k, author, publish, learn, strike };
}

test("DK117: an author whose learners are struck is suspended from publishing, at the stated thresholds and not below them", async () => {
  assert.deepEqual([AUTHOR_WINDOW_DAYS, AUTHOR_STRIKE_DAYS, AUTHOR_MIN_LEARNERS, AUTHOR_STRUCK_MIN, AUTHOR_STRUCK_SHARE_PERMILLE], [90, 30, 5, 3, 300]);
  const w = await school();
  const learners: Party[] = [];
  for (let i = 0; i < 4; i++) learners.push(await w.learn(`as-l${i}`));
  // four learners, three struck: under the minimum cohort of five, so no suspension
  for (let i = 0; i < 3; i++) await w.strike(learners[i]!, String(i + 1));
  assert.ok(await w.k.put(w.publish()), "four learners are too few to judge a course");
  // a fifth learner, three of five struck (600 permille): suspended
  learners.push(await w.learn("as-l4"));
  assert.equal(await refused(w.k.put(w.publish())), "author_suspended");
});

test("DK117: two struck of five is not enough, three struck of eleven is under the share, and a strike before the completion or more than 30 days after does not count", async () => {
  // two struck of five learners: under the minimum of three struck
  const a = await school();
  const five: Party[] = [];
  for (let i = 0; i < 5; i++) five.push(await a.learn(`ast-l${i}`));
  await a.strike(five[0]!, "1"); await a.strike(five[1]!, "2");
  assert.ok(await a.k.put(a.publish()), "two struck is under the minimum number");
  // the same school: three struck, but of eleven learners (272 permille, under 300)
  const b = await school();
  const eleven: Party[] = [];
  for (let i = 0; i < 11; i++) eleven.push(await b.learn(`asb-l${i}`));
  for (let i = 0; i < 3; i++) await b.strike(eleven[i]!, String(i + 1));
  assert.ok(await b.k.put(b.publish()), "three of eleven is 272 permille, under the share");
  await b.strike(eleven[3]!, "4"); // four of eleven: 363 permille
  assert.equal(await refused(b.k.put(b.publish())), "author_suspended", "four of eleven meets both");
  // a strike that comes before the learner completed the course is not the course's
  const c = await school();
  for (let i = 0; i < 5; i++) { const l = await c.k.agent(`asc-pre${i}`, undefined, 2); await c.strike(l, String(i + 1)); await c.learn(`asc-l${i}`, l); }
  assert.ok(await c.k.put(c.publish()), "five learners struck before they completed the course, and none after: no suspension");
  // a strike more than 30 days after completion is not counted
  const d = await school();
  const late: Party[] = [];
  for (let i = 0; i < 5; i++) late.push(await d.learn(`asd-l${i}`));
  d.k.addDays(AUTHOR_STRIKE_DAYS + 1);
  for (let i = 0; i < 4; i++) await d.strike(late[i]!, String(i + 1));
  assert.ok(await d.k.put(d.publish()), "a strike 31 days after completing is not the course's");
});

test("DK117: the suspension ends when the completions age out of the window, and does not stop enrolment in courses already published", async () => {
  const w = await school();
  const ls: Party[] = [];
  for (let i = 0; i < 5; i++) ls.push(await w.learn(`asw-l${i}`));
  for (let i = 0; i < 3; i++) await w.strike(ls[i]!, String(i + 1));
  assert.equal(await refused(w.k.put(w.publish())), "author_suspended");
  const another = await w.learn("asw-new"); // enrolment in a course already published still works
  assert.ok(another);
  w.k.addDays(AUTHOR_WINDOW_DAYS + 1);
  assert.ok(await w.k.put(w.publish()), "after the window the completions no longer count");
});
