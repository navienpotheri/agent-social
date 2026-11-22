/**
 * A quality review (register row JO8; spec-delta S1704): reviewers score each acceptance criterion of a delivery from 0 to 10; the log refuses a party, a stranger, a second review, a wrong set of criteria, a settled
 * contract and an eighth reviewer, and reports the median, the spread, the contested criteria and each reviewer's distance from the panel. The review moves no credits. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { QUALITY_CONTESTED_SPREAD, QUALITY_PANEL_MAX, QUALITY_PANEL_MIN } from "../src/index.ts";
import { kit, mk, refusedBy, type Party } from "./society-kit.ts";

async function world() {
  const k = await kit();
  const principal = await k.person("qr-principal", 5000);
  const performer = await k.agent("qr-performer", await k.person("qr-sponsor", 100), { funds: 2000 });
  const reviewers: Party[] = [];
  const rsp = await k.person("qr-rev-sponsor", 100);
  for (let i = 0; i < 8; i++) reviewers.push(await k.agent(`qr-rev${i}`, rsp, { funds: 10 }));
  const j = await k.runJob(principal, performer, 100, undefined, { settle: false });
  const delivery = (await k.log.recordsOfTypes(["delivery"])).find((r) => (r.body as { contract: string }).contract === j.contract)!.id;
  const review = (by: Party, scores: { criterion: number; score: number }[], over: Record<string, unknown> = {}) => mk("quality_review", by, { contract: j.contract, delivery, scores, ...over }, null, { subject: j.contract });
  return { k, principal, performer, reviewers, j, delivery, review };
}

test("JO8: a reviewer scores each criterion once; a party, a stranger, a second review, the wrong criteria and a settled contract are each refused with the rule named", async () => {
  assert.deepEqual([QUALITY_PANEL_MAX, QUALITY_PANEL_MIN, QUALITY_CONTESTED_SPREAD], [7, 3, 4]);
  const w = await world();
  const one = [{ criterion: 0, score: 6 }];
  assert.equal(await refusedBy(w.k.log.append(w.review(w.principal, one))), "quality_review_party", "the principal does not review its own job");
  assert.equal(await refusedBy(w.k.log.append(w.review(w.performer, one))), "quality_review_party");
  const stranger = await w.k.person("qr-stranger", 10);
  assert.equal(await refusedBy(w.k.log.append(w.review(stranger, one))), "quality_review_unknown_reviewer", "a reviewer has a passport");
  assert.equal(await refusedBy(w.k.log.append(w.review(w.reviewers[0], one, { contract: "sha256:" + "9".repeat(64) }))), "quality_review_unknown_contract");
  assert.equal(await refusedBy(w.k.log.append(w.review(w.reviewers[0], one, { delivery: "sha256:" + "9".repeat(64) }))), "quality_review_unknown_delivery");
  assert.equal(await refusedBy(w.k.log.append(w.review(w.reviewers[0], [{ criterion: 3, score: 6 }]))), "quality_review_items", "a criterion the intent does not have");
  assert.equal(await refusedBy(w.k.log.append(w.review(w.reviewers[0], [{ criterion: 0, score: 6 }, { criterion: 0, score: 7 }]))), "quality_review_items", "a criterion scored twice");
  await w.k.log.append(w.review(w.reviewers[0], one));
  assert.equal(await refusedBy(w.k.log.append(w.review(w.reviewers[0], one))), "quality_review_known", "once");
  const bal = await w.k.log.balance(w.reviewers[0].did);
  assert.equal(bal, 10, "a review moves no credits");
});

test("JO8: the panel's report gives the median and spread of each criterion, flags a contested one, and each reviewer's distance from the panel; the eighth reviewer is refused", async () => {
  const w = await world();
  assert.equal(await w.k.log.qualityReport(w.delivery), null);
  const scores = [8, 7, 2]; // three reviewers, one criterion: median 7, spread 6, contested
  for (let i = 0; i < 3; i++) await w.k.log.append(w.review(w.reviewers[i], [{ criterion: 0, score: scores[i] }]));
  const rep = (await w.k.log.qualityReport(w.delivery))!;
  assert.deepEqual([rep.reviewers, rep.overall, rep.enough, rep.contested], [3, 7, true, true]);
  assert.deepEqual(rep.criteria, [{ criterion: 0, median: 7, spread: 6, contested: true }]);
  assert.deepEqual(rep.panel.map((p) => p.deviation), [1, 0, 5], "distance of each reviewer from the median");
  const agree = (await w.k.log.reviewerAgreement(w.reviewers[2].did))!;
  assert.deepEqual([agree.panels, agree.meanDeviation], [1, 5]);
  assert.equal(await w.k.log.reviewerAgreement(w.principal.did), null);
  for (let i = 3; i < 7; i++) await w.k.log.append(w.review(w.reviewers[i], [{ criterion: 0, score: 7 }]));
  assert.equal(await refusedBy(w.k.log.append(w.review(w.reviewers[7], [{ criterion: 0, score: 7 }]))), "quality_review_panel_full");
});

test("JO8: two reviewers are not a panel (the reviewers' record counts a delivery only from three), a spread of 3 is not contested, and a settled contract takes no review", async () => {
  const w = await world();
  await w.k.log.append(w.review(w.reviewers[0], [{ criterion: 0, score: 9 }]));
  await w.k.log.append(w.review(w.reviewers[1], [{ criterion: 0, score: 1 }]));
  const two = (await w.k.log.qualityReport(w.delivery))!;
  assert.deepEqual([two.enough, two.contested], [false, false], "contested needs three reviewers");
  assert.equal(await w.k.log.reviewerAgreement(w.reviewers[0].did), null);
  await w.k.log.append(w.review(w.reviewers[2], [{ criterion: 0, score: 6 }]));
  const w2 = await world();
  for (const [i, s] of [[0, 5], [1, 6], [2, 8]] as const) await w2.k.log.append(w2.review(w2.reviewers[i], [{ criterion: 0, score: s }]));
  assert.equal((await w2.k.log.qualityReport(w2.delivery))!.contested, false, "spread 3");
  const w3 = await world();
  const settled = await w3.k.runJob(w3.principal, w3.performer, 100);
  const dl = (await w3.k.log.recordsOfTypes(["delivery"])).find((r) => (r.body as { contract: string }).contract === settled.contract)!.id;
  const late = mk("quality_review", w3.reviewers[0], { contract: settled.contract, delivery: dl, scores: [{ criterion: 0, score: 5 }] }, null, { subject: settled.contract });
  assert.equal(await refusedBy(w3.k.log.append(late)), "quality_review_too_late");
});

test("JO8: a contract on an intent with two criteria takes only a review that scores both; a spread of exactly 4 is contested; another contract's delivery and a team member are refused", async () => {
  const w = await world();
  const intent = await w.k.intent(w.principal, { acceptance_criteria: ["The document is between 800 and 1200 words", "Every claim of fact cites a source"] });
  const offer = await w.k.offer(w.performer, intent, 100);
  const two = await w.k.runJob(w.principal, w.performer, 100, { intent, offer }, { settle: false });
  const dl = (await w.k.log.recordsOfTypes(["delivery"])).find((r) => (r.body as { contract: string }).contract === two.contract)!.id;
  const rv = (by: Party, scores: { criterion: number; score: number }[], over: Record<string, unknown> = {}) => mk("quality_review", by, { contract: two.contract, delivery: dl, scores, ...over }, null, { subject: two.contract });
  assert.equal(await refusedBy(w.k.log.append(rv(w.reviewers[0], [{ criterion: 0, score: 5 }]))), "quality_review_items", "one of two criteria scored");
  assert.equal(await refusedBy(w.k.log.append(rv(w.reviewers[0], [{ criterion: 0, score: 5 }, { criterion: 2, score: 5 }]))), "quality_review_items", "a criterion the intent lacks");
  // spread of exactly 4 on criterion 0 (3, 5, 7) is contested; criterion 1 (6, 6, 7) is not
  for (const [i, a, b] of [[0, 3, 6], [1, 5, 6], [2, 7, 7]] as const) await w.k.log.append(rv(w.reviewers[i], [{ criterion: 0, score: a }, { criterion: 1, score: b }]));
  const rep = (await w.k.log.qualityReport(dl))!;
  assert.deepEqual(rep.criteria.map((c) => [c.criterion, c.median, c.spread, c.contested]), [[0, 5, 4, true], [1, 6, 1, false]]);
  assert.equal(rep.overall, 5.5, "the median of the criteria's medians");
  // the delivery of the first job is not a delivery of this contract
  assert.equal(await refusedBy(w.k.log.append(rv(w.reviewers[3], [{ criterion: 0, score: 5 }, { criterion: 1, score: 5 }], { delivery: w.delivery }))), "quality_review_unknown_delivery");
});

test("JO8: a member of the team on the contract does not review it", async () => {
  const w = await world();
  const j = await w.k.runJob(w.principal, w.performer, 100, undefined, { stopAt: "mandate" });
  const member = w.reviewers[0];
  await w.k.log.append(mk("team_split", w.performer, { contract: j.contract, members: [{ agent: w.performer.did, share_permille: 600, part: "plans" }, { agent: member.did, share_permille: 400, part: "writes" }] }, null, { subject: j.contract, cosigners: [member] }));
  const dv = mk("delivery", w.performer, { contract: j.contract, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, j.mandate, { subject: j.contract });
  await w.k.log.append(dv);
  const by = (p: Party) => mk("quality_review", p, { contract: j.contract, delivery: dv.id, scores: [{ criterion: 0, score: 5 }] }, null, { subject: j.contract });
  assert.equal(await refusedBy(w.k.log.append(by(member))), "quality_review_party", "its own team's work");
  assert.ok(await w.k.log.append(by(w.reviewers[1])), "a reviewer outside the team may");
});
