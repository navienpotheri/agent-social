/**
 * Missions on the log (register row DK1240, from DK813; spec-delta S1612): funders pool credits, the verifier records contributions and settles; a verified goal pays the pool by recorded units (a free-rider gets nothing), an
 * unverified one returns each funder what it put in, and the credit audit holds throughout. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { kit, mk, nowIso, refusedBy, DAY, credit, type Party } from "./society-kit.ts";

async function world(id: string) {
  const k = await kit();
  const verifier = await k.person(`${id}-verifier`);
  const f1 = await k.person(`${id}-f1`, 100), f2 = await k.person(`${id}-f2`, 100);
  const c1 = await k.person(`${id}-c1`), c2 = await k.person(`${id}-c2`), c3 = await k.person(`${id}-c3`), rider = await k.person(`${id}-rider`);
  const closes = new Date(Date.parse(nowIso()) + 7 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const mission = (by: Party = verifier, over: Record<string, unknown> = {}) => mk("mission", by, { mission: id, goal_sha256: "8".repeat(64), verifier: verifier.did, closes_at: closes, ...over }, null, { subject: null });
  const fund = (by: Party, n: number) => mk("mission_fund", by, { mission: id, amount: credit(n) }, null, { subject: null });
  const contrib = (who: Party, units: number, by: Party = verifier) => mk("mission_contribution", by, { mission: id, contributor: who.did, units }, null, { subject: null });
  const settle = (verified: boolean, by: Party = verifier) => mk("mission_settle", by, { mission: id, verified }, null, { subject: null });
  const audit = async () => { const a = await k.log.creditAudit(); assert.equal(a.verdict, "balanced", a.problems.join("; ")); };
  return { k, verifier, f1, f2, c1, c2, c3, rider, mission, fund, contrib, settle, audit };
}

test("DK1240: contributors split the pool by their recorded units, a free-rider gets nothing, and the audit holds", async () => {
  const w = await world("find-the-bug");
  const { k } = w;
  assert.equal(await refusedBy(k.log.append(w.fund(w.f1, 50))), "mission_unknown");
  await k.log.append(w.mission());
  assert.equal(await refusedBy(k.log.append(w.mission())), "mission_known");
  assert.equal(await refusedBy(k.log.append(w.fund(w.f1, 500))), "insufficient_balance");
  await k.log.append(w.fund(w.f1, 50));
  await k.log.append(w.fund(w.f2, 50));
  assert.equal((await k.log.balance(w.f1.did)), 50, "the funder paid from its own account");
  assert.deepEqual(await k.log.missionState("find-the-bug"), { state: "open", verifier: w.verifier.did, funded: 100, funders: 2, units: {} });
  await w.audit();
  assert.equal(await refusedBy(k.log.append(w.contrib(w.c1, 3, w.f1))), "mission_contribution_wrong_issuer", "only the verifier records contributions");
  assert.equal(await refusedBy(k.log.append(w.settle(true))), "mission_no_contribution", "no one to pay");
  await k.log.append(w.contrib(w.c1, 2));
  await k.log.append(w.contrib(w.c1, 1)); // recorded again: the units add up to 3
  await k.log.append(w.contrib(w.c2, 1));
  assert.equal(await refusedBy(k.log.append(w.settle(true, w.f1))), "mission_settle_wrong_issuer");
  await k.log.append(w.settle(true));
  assert.deepEqual([await k.log.balance(w.c1.did), await k.log.balance(w.c2.did), await k.log.balance(w.rider.did)], [75, 25, 0], "75 and 25 by units 3 and 1; the free-rider nothing");
  assert.equal(await refusedBy(k.log.append(w.settle(true))), "mission_settled");
  assert.equal(await refusedBy(k.log.append(w.fund(w.f1, 10))), "mission_closed");
  await w.audit();
  assert.equal((await k.log.verify()).ok, true);
});

test("DK1240: the largest remainder pays every credit; an unverified goal returns each funder what it put in", async () => {
  const w = await world("three-way");
  const { k } = w;
  await k.log.append(w.mission());
  await k.log.append(w.fund(w.f1, 10));
  for (const c of [w.c1, w.c2, w.c3]) await k.log.append(w.contrib(c, 1));
  await k.log.append(w.settle(true));
  assert.deepEqual([await k.log.balance(w.c1.did), await k.log.balance(w.c2.did), await k.log.balance(w.c3.did)].sort(), [3, 3, 4], "10 over three equal shares pays 4, 3 and 3");
  await w.audit();
  const u = await world("no-result");
  await u.k.log.append(u.mission());
  await u.k.log.append(u.fund(u.f1, 30));
  await u.k.log.append(u.fund(u.f2, 70));
  await u.k.log.append(u.contrib(u.c1, 5));
  await u.k.log.append(u.settle(false));
  assert.deepEqual([await u.k.log.balance(u.f1.did), await u.k.log.balance(u.f2.did), await u.k.log.balance(u.c1.did)], [100, 100, 0], "each funder has its credits back; the contributor of an unmet goal is paid nothing");
  await u.audit();
});

test("DK1240: a mission needs a known verifier and a closing time in the future; a contributor needs a passport; funding stops when it closes", async () => {
  const w = await world("rules");
  const { k } = w;
  assert.equal(await refusedBy(k.log.append(w.mission(w.verifier, { verifier: "did:web:example.com:users:ghost" }))), "mission_unknown_verifier");
  assert.equal(await refusedBy(k.log.append(w.mission(w.verifier, { closes_at: new Date(Date.parse(nowIso()) - DAY).toISOString().replace(/\.\d{3}Z$/, "Z") }))), "mission_closes_in_past");
  await k.log.append(w.mission());
  assert.equal(await refusedBy(k.log.append(mk("mission_contribution", w.verifier, { mission: "rules", contributor: "did:web:example.com:users:ghost", units: 1 }, null, { subject: null }))), "mission_contributor_unknown");
  const { jump } = await import("./society-kit.ts");
  jump(8 * DAY);
  assert.equal(await refusedBy(k.log.append(w.fund(w.f1, 10))), "mission_closed", "funding closes at the closing time");
});
