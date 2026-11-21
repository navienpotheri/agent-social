// Register row DK791 (spec-delta S1350): the log's rules for a forum checkpoint: only the operator signs one, it starts its own chain, and it moves forward. Fake keys only; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kit, mk, operator, refusedBy } from "./society-kit.ts";

const HEAD = "sha256:" + "6".repeat(64);
const body = (seq: number, head = HEAD) => ({ forum_seq: seq, forum_head: head });

test("DK791: the operator's checkpoint is accepted; another issuer, a chained one and one that does not move forward are refused", async () => {
  const k = await kit();
  const other = await k.person("not-the-operator");
  const ok = await k.log.append(mk("forum_checkpoint", operator, body(10), null, { subject: null }));
  assert.ok(ok.id);
  assert.equal(await refusedBy(k.log.append(mk("forum_checkpoint", other, body(11), null, { subject: null }))), "forum_checkpoint_wrong_issuer");
  assert.equal(await refusedBy(k.log.append(mk("forum_checkpoint", operator, body(11), ok.id, { subject: null }))), "forum_checkpoint_not_chained");
  assert.equal(await refusedBy(k.log.append(mk("forum_checkpoint", operator, body(10, "sha256:" + "7".repeat(64)), null, { subject: null, at: "2026-11-03T00:00:00Z" }))), "forum_checkpoint_not_forward", "the same count again is not forward");
  assert.equal(await refusedBy(k.log.append(mk("forum_checkpoint", operator, body(9), null, { subject: null }))), "forum_checkpoint_not_forward");
  assert.ok((await k.log.append(mk("forum_checkpoint", operator, body(11), null, { subject: null }))).id, "a later count is accepted");
  assert.equal((await k.log.recordsOfTypes(["forum_checkpoint"])).length, 2);
  assert.equal((await k.log.creditAudit()).verdict, "balanced", "a checkpoint moves no credit");
  assert.equal((await k.log.verify()).ok, true);
});
