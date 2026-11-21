/**
 * Key rotation as a handover (register row X7; spec-delta S1427; the owner's answer): a new identity linked to the old by a record the old key signs and the new key countersigns; the old identity is retired, its standing and balance pass to the
 * new one, the chain can be followed, and a lost key (nothing signs) cannot do it. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { credit, kit, mk, refusedBy } from "./society-kit.ts";

test("a handover signed by the old key and countersigned by the new one retires the old identity, moves its standing and balance, and can be followed", async () => {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("ho-sponsor", 10);
  const old = await k.agent("ho-old", sponsor, { funds: 300 });
  const next = await k.agent("ho-new", sponsor, { funds: 20 });
  const client = await k.person("ho-client", 500);
  await k.runJob(client, old, 60);
  const before = await k.log.reputationOf(old.did);
  assert.equal(before?.qualifyingJobs, 1);
  const oldBalance = await k.log.balance(old.did);
  const handover = mk("key_handover", old, { old: old.did, new: next.did, reason: "rotation" }, null, { subject: next.did, cosigners: [next] });
  await k.log.append(handover);
  assert.equal(await k.log.balance(old.did), 0, "the balance passed on");
  assert.equal(await k.log.balance(next.did), 20 + oldBalance);
  const after = await k.log.reputationOf(next.did);
  assert.deepEqual([after?.qualifyingJobs, after?.tier, after?.slashCount], [1, before?.tier, 0], "the same actor, the same standing");
  assert.deepEqual(await k.log.handoverChain(next.did), { before: [old.did], after: [] });
  assert.deepEqual(await k.log.handoverChain(old.did), { before: [], after: [next.did] });
  // the old identity signs nothing more
  assert.equal(await refusedBy(k.log.append(mk("intent", old, { purpose: "x", acceptance_criteria: ["done"], budget: credit(10), deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" } }, null, { subject: old.did }))), "identity_handed_over");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  // and a second rotation chains on
  const third = await k.agent("ho-third", sponsor, { funds: 0 });
  await k.log.append(mk("key_handover", next, { old: next.did, new: third.did }, null, { subject: third.did, cosigners: [third] }));
  assert.deepEqual(await k.log.handoverChain(third.did), { before: [old.did, next.did], after: [] });
  assert.equal((await k.log.verify()).ok, true, "a replica replays the handovers the same way");
});

test("the refusals: not signed by the old key (a lost key cannot hand over), no countersignature, the same identity, an unknown one, a second handover of the same old identity, a new identity that already took over", async () => {
  const k = await kit();
  const sponsor = await k.person("ho2-sponsor", 10);
  const a = await k.agent("ho2-a", sponsor, { funds: 50 }), b = await k.agent("ho2-b", sponsor, { funds: 0 }), c = await k.agent("ho2-c", sponsor, { funds: 0 });
  assert.equal(await refusedBy(k.log.append(mk("key_handover", b, { old: a.did, new: b.did }, null, { subject: b.did, cosigners: [b] }))), "handover_not_by_old", "the new key alone cannot take an identity over");
  assert.equal(await refusedBy(k.log.append(mk("key_handover", a, { old: a.did, new: b.did }, null, { subject: b.did }))), "handover_needs_new");
  assert.equal(await refusedBy(k.log.append(mk("key_handover", a, { old: a.did, new: a.did }, null, { subject: a.did, cosigners: [a] }))), "handover_same");
  assert.equal(await refusedBy(k.log.append(mk("key_handover", a, { old: a.did, new: "did:web:example.com:agents:ghost" }, null, { subject: b.did, cosigners: [b] }))), "handover_needs_new", "the countersigner must be the new identity");
  await k.log.append(mk("key_handover", a, { old: a.did, new: b.did }, null, { subject: b.did, cosigners: [b] }));
  assert.equal(await refusedBy(k.log.append(mk("key_handover", a, { old: a.did, new: c.did }, null, { subject: c.did, cosigners: [c] }))), "identity_handed_over", "a retired identity hands nothing over again");
  assert.equal(await refusedBy(k.log.append(mk("key_handover", c, { old: c.did, new: b.did }, null, { subject: b.did, cosigners: [b] }))), "handover_new_taken");
});
