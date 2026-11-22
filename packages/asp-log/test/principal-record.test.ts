/**
 * A principal's record as a poster of work (register row AG5; GET /registry/principals/<did>): the jobs it commissioned, how many it accepted and rejected, how each rejection fared before a Court (the greater share
 * of the fault on the principal means the rejection was not justified), the rejections no Court has ruled on, and how long it took to review. Counted from the records, equal to a count taken by hand. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicReply } from "../src/public-pages.ts";
import { jump, kit, mk, type Party } from "./society-kit.ts";

const HOUR = 3_600_000;

async function world() {
  const k = await kit();
  await k.withPrices();
  const principal = await k.person("pr-poster", 50_000);
  const sponsor = await k.person("pr-sponsor", 50);
  const performer = await k.agent("pr-performer", sponsor, { funds: 5000 });
  const judge = await k.person("pr-judge", 10);
  /** A delivered job, then the principal's answer `after` hours later; a rejection may be ruled on with the fault map given. */
  const job = async (after: number, verdict: "accepted" | "rejected", fault?: (p: Party, a: Party) => Record<string, number>, price = 40) => {
    const j = await k.runJob(principal, performer, price, undefined, { settle: false });
    jump(after * HOUR);
    const answer = mk("attestation", principal, { kind: "acceptance", about: j.delivery, verdict, ...(verdict === "rejected" ? { reasons: ["not what I asked for"] } : {}) }, j.delivery, { subject: j.contract });
    await k.log.append(answer);
    if (fault) await k.log.append(mk("attestation", judge, { kind: "ruling", about: j.contract, verdict: "for_principal", fault: fault(principal, performer), reasons: ["decided on the record"], code: { version: "1.0", articles: ["4.1"] } }, answer.id, { subject: j.contract }));
    return j;
  };
  return { k, principal, performer, judge, job };
}

test("AG5: the record counts jobs, acceptances and rejections, how each rejection fared before a Court, and the review time", async () => {
  const w = await world();
  await w.job(2, "accepted");
  await w.job(4, "rejected", (p) => ({ [p.did]: 1000 }));              // the rejection was not justified
  await w.job(6, "rejected", (_p, a) => ({ [a.did]: 1000 }));           // justified
  await w.job(8, "rejected");                                           // no ruling yet
  await w.job(10, "rejected", (p, a) => ({ [p.did]: 500, [a.did]: 500 })); // an even split is not a finding against the principal
  const r = await w.k.log.principalRecord(w.principal.did);
  assert.equal(r.jobs, 5);
  assert.equal(r.accepted, 1);
  assert.equal(r.rejected, 4);
  assert.equal(r.rejectedUnjustified, 1);
  assert.equal(r.rejectedJustified, 2);
  assert.equal(r.rejectedUnruled, 1);
  assert.equal(r.unjustifiedShare, null, "fewer than five rejections: no share is stated");
  assert.equal(r.medianReviewHours, 6, "2, 4, 6, 8 and 10 hours: the median is 6");
  assert.equal(r.slowestReviewHours, 10);
  assert.equal(r.rejectedUnjustified + r.rejectedJustified + r.rejectedUnruled, r.rejected, "every rejection is in exactly one count");
});

test("AG5: with five rejections the unjustified share is stated, and an agent that never posted work has an empty record", async () => {
  const w = await world();
  for (let i = 0; i < 4; i++) await w.job(1, "rejected", (p) => ({ [p.did]: 1000 }));
  await w.job(1, "rejected", (_p, a) => ({ [a.did]: 1000 }));
  const r = await w.k.log.principalRecord(w.principal.did);
  assert.equal(r.rejected, 5);
  assert.equal(r.unjustifiedShare, 800, "four of five, in permille");
  const none = await w.k.log.principalRecord(w.performer.did);
  assert.deepEqual([none.jobs, none.accepted, none.rejected, none.medianReviewHours], [0, 0, 0, null]);
});

test("AG5: another principal's jobs and a performer's answers are not counted", async () => {
  const w = await world();
  await w.job(3, "rejected", (p) => ({ [p.did]: 1000 }));
  const other = await w.k.person("pr-other", 50_000);
  const j = await w.k.runJob(other, w.performer, 40, undefined, { settle: false });
  await w.k.log.append(mk("attestation", other, { kind: "acceptance", about: j.delivery, verdict: "rejected", reasons: ["x"] }, j.delivery, { subject: j.contract }));
  const mine = await w.k.log.principalRecord(w.principal.did);
  assert.equal(mine.jobs, 1);
  assert.equal(mine.rejected, 1);
  assert.equal((await w.k.log.principalRecord(other.did)).rejected, 1);
});

test("AG5: GET /registry/principals/<did> serves the record without a token", async () => {
  const w = await world();
  await w.job(2, "accepted");
  const r = await publicReply(w.k.log, `/registry/principals/${encodeURIComponent(w.principal.did)}`, false) as { status: number; json: { ok: boolean; result: { jobs: number; accepted: number } } };
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.result.jobs, 1);
  assert.equal(r.json.result.accepted, 1);
});
