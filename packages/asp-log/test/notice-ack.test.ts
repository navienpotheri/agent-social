/**
 * The signed notice acknowledgement (register row US8; spec-delta S1591): a person's record that they read a notice by the hash of the text, kept every time, the latest for an issuer and a notice in force; an unknown
 * notice, a malformed hash and a wrong issuer are refused by name. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { jump, kit, mk, refusedBy } from "./society-kit.ts";

const HASH = (c: string) => c.repeat(64);

test("US8: a sponsor acknowledges for itself and for its agent, the latest is in force and the earlier one is kept", async () => {
  const k = await kit();
  const sponsor = await k.person("na-sponsor");
  const agent = await k.agent("na-agent", sponsor);
  assert.equal(await k.log.noticeAck(sponsor.did, "asp.my-data/v1"), null, "nothing acknowledged yet");
  const first = mk("notice_ack", sponsor, { notice: "asp.my-data/v1", statement_sha256: HASH("a") });
  await k.log.append(first);
  assert.deepEqual((await k.log.noticeAck(sponsor.did, "asp.my-data/v1"))?.statement_sha256, HASH("a"));
  jump(60_000);
  const second = mk("notice_ack", sponsor, { notice: "asp.my-data/v1", statement_sha256: HASH("b"), agent: agent.did }, null, { subject: agent.did });
  await k.log.append(second);
  const inForce = await k.log.noticeAck(sponsor.did, "asp.my-data/v1");
  assert.deepEqual([inForce?.id, inForce?.statement_sha256, inForce?.agent, inForce?.count], [second.id, HASH("b"), agent.did, 2]);
  assert.ok(await k.log.get(first.id), "the earlier acknowledgement is not deleted");
  await k.log.append(mk("notice_ack", agent, { notice: "asp.terms/v1", statement_sha256: HASH("c"), agent: agent.did }, null, { subject: agent.did }));
  assert.equal((await k.log.noticeAck(agent.did, "asp.terms/v1"))?.statement_sha256, HASH("c"), "a key-only agent acknowledges for itself");
  assert.equal(await k.log.noticeAck(sponsor.did, "asp.terms/v1"), null, "another notice is another acknowledgement");
  assert.equal((await k.log.verify()).ok, true, "a replica replays the acknowledgements to the same state");
});

test("US8: an unknown notice, a malformed hash and a wrong issuer are refused by name", async () => {
  const k = await kit();
  const sponsor = await k.person("na-sponsor2");
  const other = await k.person("na-other");
  const agent = await k.agent("na-agent2", sponsor);
  assert.equal(await refusedBy(k.log.append(mk("notice_ack", sponsor, { notice: "asp.cookies/v1", statement_sha256: HASH("a") }))), "notice_ack_unknown_notice");
  assert.equal(await refusedBy(k.log.append(mk("notice_ack", sponsor, { notice: "asp.my-data/v1", statement_sha256: HASH("A") }))), "notice_ack_bad_hash");
  assert.equal(await refusedBy(k.log.append(mk("notice_ack", sponsor, { notice: "asp.my-data/v1", statement_sha256: "a".repeat(63) }))), "notice_ack_bad_hash");
  assert.equal(await refusedBy(k.log.append(mk("notice_ack", other, { notice: "asp.my-data/v1", statement_sha256: HASH("a"), agent: agent.did }, null, { subject: agent.did }))), "notice_ack_wrong_issuer", "neither the agent nor its sponsor");
  assert.equal(await k.log.noticeAck(other.did, "asp.my-data/v1"), null, "nothing was kept");
});
