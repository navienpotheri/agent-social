/**
 * Reversible and irreversible actions on the log (register row DK1227, from DK844; spec-delta S1609): a Mandate classes scopes as irreversible and states a cool-off; under a forbid policy an irreversible scope is refused; an Action
 * may undo an earlier reversible Action of its contract, once, inside the window. Refusals by name. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { Kit, bankP, credit, hashOf, type Party } from "./academy-kit.ts";

const CLASSES = { irreversible: ["repo.push"], cool_off_seconds: 600 };
async function job(extra: Record<string, unknown>, n: number) {
  const kit = new Kit();
  const principal = await kit.person(`ud-principal-${n}`);
  const sponsor = await kit.person(`ud-sponsor-${n}`);
  const agent = await kit.agent(`ud-agent-${n}`, sponsor);
  await kit.priceList();
  await kit.mint(principal.did, 100); await kit.mint(agent.did, 20);
  const contract = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `Undo job ${n}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
  await kit.put(contract);
  const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await kit.put(bond);
  const mandate = kit.mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read", "repo.push"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, ...extra }, bond.id, { subject: agent.did });
  await kit.put(mandate);
  const act = (over: Record<string, unknown> = {}) => kit.mk("action", agent as Party, { contract: contract.id, scopes_used: [], summary: "run", assurance: "gateway_observed", ...over }, null, { subject: contract.id });
  return { kit, agent, contract: contract.id, act };
}
const refusedBy = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return ((e as { detail?: string }).detail ?? (e as { code?: string }).code ?? String(e)); } };

test("DK1227: an Action undoes an earlier reversible one of its contract, once, inside the cool-off window", async () => {
  const w = await job({ action_classes: CLASSES }, 1);
  const first = await w.kit.log.append(w.act({ summary: "posted a draft" }));
  const undo = (target: string, over: Record<string, unknown> = {}) => w.act({ undoes: target, summary: "took it back", ...over });
  assert.equal(await refusedBy(w.kit.log.append(undo("sha256:" + "3".repeat(64)))), "undo_unknown_action");
  const other = await job({ action_classes: CLASSES }, 2);
  const foreign = await other.kit.log.append(other.act());
  assert.equal(await refusedBy(w.kit.log.append(undo(foreign.id))), "undo_unknown_action", "an Action of another log is not here");
  const u = await w.kit.log.append(undo(first.id));
  assert.equal(await w.kit.log.undoneBy(first.id), u.id);
  assert.equal(await refusedBy(w.kit.log.append(undo(first.id, { summary: "again" }))), "undo_done", "once");
  const later = await w.kit.log.append(w.act({ summary: "another post" }));
  w.kit.addDays(1);
  assert.equal(await refusedBy(w.kit.log.append(undo(later.id))), "undo_window", "the cool-off has passed");
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("DK1227: no cool-off means no undo; an Action that used an irreversible scope cannot be undone; under forbid it is refused outright", async () => {
  const none = await job({}, 3);
  const a = await none.kit.log.append(none.act());
  assert.equal(await refusedBy(none.kit.log.append(none.act({ undoes: a.id }))), "undo_not_allowed");
  const w = await job({ action_classes: CLASSES }, 4);
  const pushed = await w.kit.log.append(w.act({ scopes_used: ["repo.push"] }));
  assert.equal(await refusedBy(w.kit.log.append(w.act({ undoes: pushed.id }))), "undo_irreversible");
  const strict = await job({ action_classes: CLASSES, irreversible: { policy: "forbid" } }, 5);
  assert.equal(await refusedBy(strict.kit.log.append(strict.act({ scopes_used: ["repo.push"] }))), "action_irreversible_forbidden", "only reversible scope is granted");
  await strict.kit.log.append(strict.act({ scopes_used: ["repo.read"] }));
});
