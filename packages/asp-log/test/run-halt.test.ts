/**
 * The signed halt of a run (register row DK1230; spec-delta S1422): the agent (its gateway), its sponsor or the operator records that a run was halted; from the record on, the Mandate of that contract buys nothing, so credits stop draining; a new
 * contract and Mandate are a fresh start; the record is a fact, never a slash or a strike. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { kit, mk, refusedBy, operator } from "./society-kit.ts";

test("a halted run buys nothing more: before the halt a purchase goes through, after it the Mandate is refused with the reason, essentials are not blocked, and a new Mandate is a fresh start", async () => {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("rh-sponsor", 10);
  const a = await k.agent("rh-agent", sponsor, { funds: 300 });
  const mandate = await k.openMandate(a);
  const contract = ((await k.log.get(mandate))!.record.body as { contract: string }).contract;
  await k.buy(a, "registry.name.claim", 10, { mandate });
  const before = await k.log.balance(a.did);
  const halt = mk("run_halt", a, { contract, agent: a.did, reason: "equivalent_calls", detail: "Read was called 8 times with the same arguments", count: 8, limit: 8, tool: "Read" }, null, { subject: contract });
  await k.log.append(halt);
  assert.equal(await k.log.runHaltOf(contract), halt.id);
  assert.equal(await refusedBy(k.buy(a, "registry.name.claim", 10, { mandate })), "run_halted", "credits stop draining");
  assert.equal(await k.log.balance(a.did), before, "nothing was spent after the halt");
  assert.equal((await k.log.reputationOf(a.did))?.slashCount, 0, "a halt is a fact, not a slash");
  assert.equal(await refusedBy(k.buy(a, "courts.appeal.small", 5)), undefined, "an essential service is not blocked");
  const fresh = await k.openMandate(a);
  await k.buy(a, "registry.name.claim", 10, { mandate: fresh });
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal((await k.log.verify()).ok, true);
});

test("who may record a halt: the agent, its sponsor or the operator, for a contract the agent performs, once", async () => {
  const k = await kit();
  const sponsor = await k.person("rh2-sponsor", 10);
  const other = await k.person("rh2-other", 10);
  const a = await k.agent("rh2-agent", sponsor, { funds: 100 });
  const b = await k.agent("rh2-other-agent", other, { funds: 100 });
  const mandate = await k.openMandate(a);
  const contract = ((await k.log.get(mandate))!.record.body as { contract: string }).contract;
  const halt = (by: typeof a, over: Record<string, unknown> = {}) => mk("run_halt", by, { contract, agent: a.did, reason: "token_cap", detail: "5000 tokens against a daily cap of 4000", count: 5000, limit: 4000, ...over }, null, { subject: contract });
  assert.equal(await refusedBy(k.log.append(halt(b))), "run_halt_wrong_issuer", "another agent cannot halt it");
  assert.equal(await refusedBy(k.log.append(halt(other as never))), "run_halt_wrong_issuer", "another sponsor cannot either");
  assert.equal(await refusedBy(k.log.append(halt(a, { contract: "sha256:" + "5".repeat(64) }))), "run_halt_unknown_contract");
  assert.equal(await refusedBy(k.log.append(halt(a, { agent: b.did }))), "run_halt_not_performer");
  await k.log.append(halt(sponsor as never)); // the sponsor may
  assert.equal(await refusedBy(k.log.append(halt(a))), "run_halt_known", "once");
  const m2 = await k.openMandate(b);
  const c2 = ((await k.log.get(m2))!.record.body as { contract: string }).contract;
  await k.log.append(mk("run_halt", operator, { contract: c2, agent: b.did, reason: "cycle", detail: "an agent-to-agent cycle", count: 2 }, null, { subject: c2 })); // the operator may
  assert.equal(await k.log.runHaltOf(c2) !== undefined, true);
});
