/**
 * The Academy's monthly report (DK116, academy.md AC-22; GET /academy/report?month=YYYY-MM): courses published, enrolments and completions, exams defined and sat and the share passed, certificates issued and revoked
 * by reason, each equal to a hand count of the records and counted in the month the record was issued. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicReply } from "../src/public-pages.ts";
import { Kit, SERVICES, hashOf, registrar, type Party } from "./academy-kit.ts";

async function world() {
  const k = new Kit(); // the clock starts on 2026-11-01
  await k.priceList();
  const [author, r1, r2] = [await k.agent("rp-author"), await k.agent("rp-rev1"), await k.agent("rp-rev2")];
  const course = async () => k.put(k.mk("course", author, { course: "foundations-rp", title: "Working inside a Mandate", skill: "foundations", level: 1, lessons: [hashOf("a")], exercises: hashOf("e"), exercise_count: 3, price_service: SERVICES.foundations, author_share_permille: 550, reviews: [hashOf("b"), hashOf("c")], reviewers: [r1.did, r2.did] }, null, { subject: null, cosigners: [registrar] }));
  const learn = async (name: string, courseId: string) => {
    const learner = await k.agent(name, undefined, 2);
    await k.job(learner, 500);
    await k.fund(learner, 300);
    const e = await k.put(k.mk("enrolment", learner, { course: courseId, purchase: await k.buy(learner, SERVICES.foundations, 30) }, null, { subject: learner.did }));
    return { learner, e };
  };
  const complete = async (l: { learner: Party; e: string }) => { const run = await k.act(l.learner); return k.put(k.mk("completion", registrar, { enrolment: l.e, holder: l.learner.did, exercises_passed: 3, run_log_hash: run }, null, { subject: l.learner.did })); };
  return { k, course, learn, complete };
}

test("DK116: the report counts the month's courses, enrolments, completions, exams, certificates and revocations, as a hand count would", async () => {
  const w = await world();
  const c = await w.course();
  const a = await w.learn("rp-a", c); const b = await w.learn("rp-b", c); await w.learn("rp-c", c);
  await w.complete(a);
  await w.complete(b);
  const exam = await w.k.defineExam("foundations-rp-v1", "foundations", 1);
  const x = await w.k.agent("rp-x", undefined, 1); await w.k.fund(x, 200);
  const y = await w.k.agent("rp-y", undefined, 1); await w.k.fund(y, 200);
  const z = await w.k.agent("rp-z", undefined, 1); await w.k.fund(z, 200);
  const rx = await w.k.sit(x, exam, 900);                  // passed
  await w.k.sit(y, exam, 500);                             // failed
  const rz = await w.k.sit(z, exam, 850);                  // passed
  const cx = await w.k.put(w.k.certificate(x, "foundations", 1, rx));
  const cz = await w.k.put(w.k.certificate(z, "foundations", 1, rz));
  await w.k.put(w.k.revoke(cx, "error"));
  await w.k.put(w.k.revoke(cz, "error"));
  const rep = await w.k.log.academyReport("2026-11");
  assert.equal(rep.coursesPublished, 1);
  assert.equal(rep.enrolments, 3);
  assert.equal(rep.completions, 2);
  assert.equal(rep.examsDefined, 1);
  assert.equal(rep.sittings, 3);
  assert.equal(rep.sittingsPassed, 2);
  assert.equal(rep.passShare, 667, "two of three sittings, in permille");
  assert.equal(rep.certificatesIssued, 2);
  assert.equal(rep.certificatesRevoked, 2);
  assert.deepEqual(rep.revokedByReason, { error: 2 });
  assert.equal(rep.from, "2026-11-01T00:00:00Z");
  assert.equal(rep.to, "2026-12-01T00:00:00Z");
});

test("DK116: a record counts in the month it was issued; an earlier month is empty and has no pass share", async () => {
  const w = await world();
  const exam = await w.k.defineExam("foundations-rp-v2", "foundations", 1);
  const x = await w.k.agent("rp-dx", undefined, 1); await w.k.fund(x, 200);
  await w.k.sit(x, exam, 900);
  w.k.addDays(40); // into December
  const y = await w.k.agent("rp-dy", undefined, 1); await w.k.fund(y, 200);
  await w.k.sit(y, exam, 400, {}, 800, 0, [], 40);
  const oct = await w.k.log.academyReport("2026-10");
  assert.deepEqual([oct.sittings, oct.examsDefined, oct.coursesPublished, oct.passShare, oct.revokedByReason], [0, 0, 0, null, {}]);
  const nov = await w.k.log.academyReport("2026-11");
  assert.deepEqual([nov.sittings, nov.sittingsPassed, nov.passShare], [1, 1, 1000]);
  const dec = await w.k.log.academyReport("2026-12");
  assert.deepEqual([dec.sittings, dec.sittingsPassed, dec.passShare, dec.examsDefined], [1, 0, 0, 0]);
});

test("DK116: GET /academy/report serves a month without a token, defaults to the current one, and refuses a bad month", async () => {
  const w = await world();
  const r = await publicReply(w.k.log, "/academy/report?month=2026-11", false) as { status: number; json: { ok: boolean; result: { month: string } } };
  assert.equal(r.status, 200);
  assert.equal(r.json.result.month, "2026-11");
  assert.equal(((await publicReply(w.k.log, "/academy/report?month=2026-14", false)) as { status: number }).status, 400);
  assert.equal(((await publicReply(w.k.log, "/academy/report", false)) as { status: number }).status, 200);
  await assert.rejects(() => w.k.log.academyReport("2026"), /YYYY-MM/);
});
