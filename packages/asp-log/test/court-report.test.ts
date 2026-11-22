/**
 * The Courts' monthly report (DK123, courts.md CT-20; GET /courts/report?month=YYYY-MM): disputes opened, rulings and for whom, the days a ruling took, appeals filed and decided, the share that reversed or varied,
 * and the disputes still open at the month's end, equal to a count taken by hand from the records, and counted in the month each record was issued. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicReply } from "../src/public-pages.ts";
import { DAY, jump, kit, mk, type Party } from "./society-kit.ts";

const CODE = { version: "1.0", articles: ["4.1"] };

async function world() {
  const k = await kit(); // the clock starts on 2026-11-01
  await k.withPrices();
  const principal = await k.person("cr-claimant", 50_000);
  const sponsor = await k.person("cr-sponsor", 50);
  const performer = await k.agent("cr-performer", sponsor, { funds: 5000 });
  const judge = await k.person("cr-judge-a", 10);
  const judge2 = await k.person("cr-judge-b", 10);
  const dispute = async () => {
    const j = await k.runJob(principal, performer, 80, undefined, { settle: false });
    const rej = mk("attestation", principal, { kind: "acceptance", about: j.delivery, verdict: "rejected", reasons: ["not what I asked for"] }, j.delivery, { subject: j.contract });
    await k.log.append(rej);
    return { ...j, rej };
  };
  const rule = async (d: { contract: string; rej: { id: string } }, forPrincipal: boolean) => {
    const r = mk("attestation", judge, { kind: "ruling", about: d.contract, verdict: forPrincipal ? "for_principal" : "for_performer", fault: { [forPrincipal ? performer.did : principal.did]: 1000 }, reasons: ["decided on the record"], code: CODE }, d.rej.id, { subject: d.contract });
    await k.log.append(r);
    return r;
  };
  const appeal = async (by: Party, ruling: string) => {
    const fee = await k.buy(by, "courts.appeal.small", 5);
    const a = mk("court_act", by, { act: "appeal", ruling, grounds: "error_of_law", statement: "Article 4.1 was misapplied to this delivery", fee_paid: fee });
    await k.log.append(a);
    return a;
  };
  const decide = async (a: { id: string }, outcome: "affirmed" | "reversed" | "varied", fault?: Record<string, number>) => {
    const r = mk("court_act", judge2, { act: "appeal_ruling", appeal: a.id, outcome, ...(fault ? { fault } : {}), reasons: ["the appeal panel decided"], code: CODE }, null);
    await k.log.append(r);
  };
  return { k, principal, performer, dispute, rule, appeal, decide };
}

test("DK123: the report counts the month's disputes, rulings, days to a ruling, appeals and what is still open, as a hand count would", async () => {
  const w = await world();
  const d1 = await w.dispute(); const d2 = await w.dispute(); const d3 = await w.dispute(); await w.dispute();
  jump(2 * DAY);
  const r1 = await w.rule(d1, true);               // after 2 days, for the principal
  jump(2 * DAY);
  const r2 = await w.rule(d2, false);              // after 4 days, for the performer
  jump(2 * DAY);
  const r3 = await w.rule(d3, true);               // after 6 days, for the principal
  const a1 = await w.appeal(w.performer, r1.id);
  await w.decide(a1, "reversed", { [w.principal.did]: 1000 });
  const a2 = await w.appeal(w.principal, r2.id);
  await w.decide(a2, "affirmed");
  const a3 = await w.appeal(w.performer, r3.id);
  await w.decide(a3, "varied", { [w.principal.did]: 500, [w.performer.did]: 500 });
  const rep = await w.k.log.courtReport("2026-11");
  assert.equal(rep.disputesOpened, 4);
  assert.equal(rep.rulings, 3);
  assert.equal(rep.forPrincipal, 2);
  assert.equal(rep.forPerformer, 1);
  assert.equal(rep.medianDaysToRuling, 4, "2, 4 and 6 days: the median is 4");
  assert.equal(rep.appealsFiled, 3);
  assert.equal(rep.appealsDecided, 3);
  assert.equal(rep.appealsAffirmed, 1);
  assert.equal(rep.appealsReversed, 1);
  assert.equal(rep.appealsVaried, 1);
  assert.equal(rep.reversedShare, 667, "two of three decided appeals reversed or varied, in permille");
  assert.equal(rep.openAtEnd, 1, "the fourth dispute has no ruling");
  assert.equal(rep.from, "2026-11-01T00:00:00Z");
  assert.equal(rep.to, "2026-12-01T00:00:00Z");
});

test("DK123: a record counts in the month it was issued; an earlier month is empty and a later one still shows what is open", async () => {
  const w = await world();
  const d1 = await w.dispute(); const d2 = await w.dispute();
  jump(3 * DAY);
  await w.rule(d1, true);
  jump(40 * DAY); // into December
  const d3 = await w.dispute();
  jump(DAY);
  await w.rule(d3, false);
  jump(DAY);
  await w.rule(d2, true);  // the second November dispute is ruled in December
  const oct = await w.k.log.courtReport("2026-10");
  assert.deepEqual([oct.disputesOpened, oct.rulings, oct.appealsFiled, oct.openAtEnd], [0, 0, 0, 0]);
  const nov = await w.k.log.courtReport("2026-11");
  assert.deepEqual([nov.disputesOpened, nov.rulings, nov.openAtEnd], [2, 1, 1]);
  const dec = await w.k.log.courtReport("2026-12");
  assert.deepEqual([dec.disputesOpened, dec.rulings, dec.forPerformer, dec.openAtEnd], [1, 2, 1, 0], "the second November dispute is ruled in December, so it was open at the end of November and is not at the end of December");
  assert.equal(dec.reversedShare, null, "no appeal decided: no share");
  assert.equal(dec.medianDaysToRuling, 23, "1 day and 45 days: the median is 23");
});

test("DK123: GET /courts/report serves a month without a token, defaults to the current one, and refuses a bad month", async () => {
  const w = await world();
  const r = await publicReply(w.k.log, "/courts/report?month=2026-11", false) as { status: number; json: { ok: boolean; result: { month: string } } };
  assert.equal(r.status, 200);
  assert.equal(r.json.result.month, "2026-11");
  assert.equal(((await publicReply(w.k.log, "/courts/report?month=2026-13", false)) as { status: number }).status, 400);
  assert.equal(((await publicReply(w.k.log, "/courts/report", false)) as { status: number }).status, 200);
  await assert.rejects(() => w.k.log.courtReport("November"), /YYYY-MM/);
});
