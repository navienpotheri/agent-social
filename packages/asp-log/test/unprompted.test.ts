/**
 * Unprompted work on the log (register row DK1232, from DK822; spec-delta S1606): a Mandate says whether the performer may act on its own initiative and how many such Actions a day; an Action with `unprompted: true` is
 * refused where the Mandate forbids it (a Mandate that says nothing forbids it) and past the daily cap (UTC); every Action is counted so a report shows the share. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { Kit, bankP, credit, hashOf, type Party } from "./academy-kit.ts";

async function job(unprompted: Record<string, unknown> | undefined, n: number) {
  const kit = new Kit();
  const principal = await kit.person(`up-principal-${n}`);
  const sponsor = await kit.person(`up-sponsor-${n}`);
  const agent = await kit.agent(`up-agent-${n}`, sponsor);
  await kit.priceList();
  await kit.mint(principal.did, 100); await kit.mint(agent.did, 20);
  const contract = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `Unprompted job ${n}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
  await kit.put(contract);
  const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await kit.put(bond);
  const mandate = kit.mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, ...(unprompted ? { unprompted } : {}) }, bond.id, { subject: agent.did });
  await kit.put(mandate);
  const act = (over: Record<string, unknown> = {}) => kit.mk("action", agent as Party, { contract: contract.id, scopes_used: [], summary: "run", assurance: "gateway_observed", ...over }, null, { subject: contract.id });
  return { kit, agent, contract: contract.id, act };
}
const refusedBy = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return ((e as { detail?: string }).detail ?? (e as { code?: string }).code ?? String(e)); } };

test("DK1232: a Mandate that says nothing forbids unprompted work; one that allows it lets it through, and the share is counted", async () => {
  const none = await job(undefined, 1);
  assert.equal(await refusedBy(none.kit.log.append(none.act({ unprompted: true }))), "unprompted_not_allowed", "no word on it means no");
  assert.equal(await refusedBy(none.kit.log.append(none.act({ unprompted: false }))), "", "prompted work is always fine");
  const forbidden = await job({ allowed: false }, 2);
  assert.equal(await refusedBy(forbidden.kit.log.append(forbidden.act({ unprompted: true }))), "unprompted_not_allowed");
  const ok = await job({ allowed: true }, 3);
  await ok.kit.log.append(ok.act({ unprompted: true }));
  await ok.kit.log.append(ok.act());
  await ok.kit.log.append(ok.act());
  await ok.kit.log.append(ok.act({ unprompted: true }));
  assert.deepEqual(await ok.kit.log.unpromptedShare(ok.contract), { actions: 4, unprompted: 2, permille: 500 });
  assert.deepEqual(await none.kit.log.unpromptedShare(none.contract), { actions: 1, unprompted: 0, permille: 0 }, "the refused Action was not counted");
  assert.equal((await ok.kit.log.verify()).ok, true);
});

test("DK1232: the daily cap is in force from the first Action over it, and a new UTC day starts again", async () => {
  const w = await job({ allowed: true, per_day_cap: 2 }, 4);
  await w.kit.log.append(w.act({ unprompted: true }));
  await w.kit.log.append(w.act({ unprompted: true }));
  assert.equal(await refusedBy(w.kit.log.append(w.act({ unprompted: true }))), "unprompted_cap", "the third on one day");
  await w.kit.log.append(w.act()); // prompted work is not limited by it
  w.kit.addDays(1);
  await w.kit.log.append(w.act({ unprompted: true }));
  assert.deepEqual(await w.kit.log.unpromptedShare(w.contract), { actions: 4, unprompted: 3, permille: 750 });
});
