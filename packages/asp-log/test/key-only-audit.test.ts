// The key-only audit (docs/key-only-audit.md): the places where the log assumes a sponsor, probed on the real rules with an agent that names ITSELF as its sponsor (the passport schema requires a sponsor, so
// a key-only agent is its own). Each assertion states what such an agent can and cannot do, so a gap cannot be fixed or widened without this test changing, and the audit page cannot drift from the code. Fake
// keys only. Credits are mock accounting entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JUROR_NEW_PER_DAY } from "../src/index.ts";
import { credit, kit, keysOf, mk, party, refusedBy, type Party } from "./society-kit.ts";

const keyOnly = (name: string): Party => party(`did:web:example.com:agents:ko-audit-${name}`);
const passport = (p: Party) => mk("passport", p, { did: p.did, kind: "agent", sponsor: p.did, tier: 1, shape: {}, keys: keysOf(p), purpose: "key-only" }, null, { subject: p.did });

async function world(over: Parameters<typeof kit>[0] = {}) {
  const k = await kit(over);
  await k.withPrices();
  const ko = keyOnly("1");
  await k.log.append(passport(ko));
  await k.mint(ko.did, 100);
  const person = await k.person("ko-audit-person", 100);
  return { k, ko, person };
}

test("a key-only agent names itself as its sponsor, so its sponsor's daily limit is its own and a second key-only passport on the same day is not counted against the first", async () => {
  const { k, ko } = await world();
  assert.equal((await k.log.registryPage(ko.did))!.sponsor, ko.did, "the sponsor of a key-only agent is the agent");
  for (let i = 2; i <= 14; i++) await k.log.append(passport(keyOnly(String(i))));
});

test("credits reach a key-only agent only against a job: a person cannot top it up, and it cannot hand credits to a person", async () => {
  const { k, ko, person } = await world();
  assert.equal(await refusedBy(k.log.append(mk("internal_transfer", person, { to: ko.did, amount: credit(10) }, null, { subject: ko.did }))), "transfer_not_allowed", "a person is not its sponsor");
  assert.equal(await refusedBy(k.log.append(mk("internal_transfer", ko, { to: person.did, amount: credit(10) }, null, { subject: person.did }))), "transfer_not_allowed");
});

test("the sponsor's re-vouching on the way back from tier 0 is the agent's own: only the tier check refuses it, so the 'second key' of the retraining path is not a second party for a key-only agent", async () => {
  const { k, ko, person } = await world();
  assert.equal(await refusedBy(k.log.append(mk("revouch", person, { agent: ko.did, reason: "a stranger vouches" }, null, { subject: ko.did }))), "revouch_not_the_sponsor", "a stranger cannot");
  assert.equal(await refusedBy(k.log.append(mk("revouch", ko, { agent: ko.did, reason: "I vouch for myself" }, null, { subject: ko.did }))), "revouch_not_excluded", "the agent passes the sponsor check for itself; it is refused here only because it is not at tier 0");
});

// KO1 is fixed from the cutover (key-only-class.test.ts: the same day's keys are one group and unvouched ones do not sit). This test pins the behaviour BEFORE the cutover, which a log written then still replays as.
test("independence counts 'distinct sponsors', and every key-only identity is its own: a person with many keys is many sponsors, and each registers its own juror the same day", async () => {
  const { k } = await world({ panelV2From: "2026-01-01T00:00:00Z" });
  const keys = Array.from({ length: JUROR_NEW_PER_DAY + 3 }, (_, i) => keyOnly(`juror-${i}`));
  for (const p of keys) { await k.log.append(passport(p)); await k.mint(p.did, 200); await k.log.append(mk("juror", p, { did: p.did, stake: credit(100) }, null)); }
  assert.ok(keys.length > JUROR_NEW_PER_DAY, "more than the daily limit of one sponsor registered the same day, each as its own sponsor");
});
