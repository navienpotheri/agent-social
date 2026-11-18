// DK535 (S953), right 8 of the rights charter: a quarantine gives the agent notice and a reason before it takes effect; an emergency freeze is recorded, short and listed for review. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, clinic, jump, kit, mk, nowIso, refusedBy } from "./society-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

test("S953: a quarantine takes effect only after its 24-hour notice, an emergency one at once with its reason on record, and the emergencies are listed", async () => {
  const k = await kit();
  const sponsor = await k.person("qn-sponsor", 10);
  const a = await k.agent("qn-a", sponsor, { funds: 10 });
  const b = await k.agent("qn-b", sponsor, { funds: 10 });
  jump(20 * DAY); // past 2026-11-19, when the notice rule begins
  const t = () => Date.parse(nowIso());
  const q = (over: Record<string, unknown>) => mk("quarantine", clinic, { members: [a.did], level: "halt", reason: "drift seen in three runs", until: iso(t() + 5 * DAY), ...over }, null);

  assert.equal(await refusedBy(k.log.append(q({}))), "quarantine_needs_notice", "no notice, no emergency");
  assert.equal(await refusedBy(k.log.append(q({ effective_from: iso(t() + 3_600_000) }))), "quarantine_notice_too_short");
  assert.equal(await refusedBy(k.log.append(q({ emergency: { reason: "it is leaking a key now" }, effective_from: iso(t() + DAY) }))), "quarantine_emergency_no_delay");
  assert.equal(await refusedBy(k.log.append(q({ emergency: { reason: "it is leaking a key now" } }))), "quarantine_emergency_too_long", "an emergency lasts at most 72 hours");

  // With notice: the record, with its reason, is public now; the agent is free until it takes effect.
  const noticed = q({ effective_from: iso(t() + DAY + 60_000) });
  await k.log.append(noticed);
  assert.equal((noticed.body as { reason: string }).reason, "drift seen in three runs");
  assert.equal(await refusedBy(k.openMandate(a)), undefined, "inside the notice period nothing is frozen");
  jump(DAY + 120_000);
  assert.equal(await refusedBy(k.openMandate(a)), "agent_quarantined", "after the notice period it is in force");

  // An emergency on another agent bites at once and is on the review list.
  await k.log.append(q({ members: [b.did], emergency: { reason: "it is leaking a key now" }, until: iso(t() + 2 * DAY) }));
  assert.equal(await refusedBy(k.openMandate(b)), "agent_quarantined");
  const list = await k.log.emergencyQuarantines();
  assert.deepEqual(list.map((e) => [e.members[0], e.reason]), [[b.did, "it is leaking a key now"]]);
  assert.equal((await k.log.verify()).ok, true);
});
