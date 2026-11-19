// DK385 (S973): from the time a config record names, a Mandate's scopes and irreversible policy depend on the agent's tier: a tier 1 agent is refused each broader Mandate with its reason, and the same
// Mandate is allowed for a tier 2 agent. Before the time, and with no record, nothing changes. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { breadthProblem, RECOMMENDED_TIER_BREADTH } from "../src/index.ts";
import { DAY, credit, jump, kit, mk, nowIso, operator, owner, refusedBy, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";

test("the recommended numbers: network, push and unchecked irreversible acts need tier 2; checkpoint and forbid are open to all", () => {
  assert.equal(breadthProblem(1, { scopes: ["repo.read", "repo.write"], irreversible: { policy: "checkpoint" } }), undefined);
  assert.equal(breadthProblem(1, { scopes: ["shell.network"] })?.rule, "tier_scope_limit");
  assert.equal(breadthProblem(1, { scopes: ["repo.push"] })?.rule, "tier_scope_limit");
  assert.equal(breadthProblem(1, { scopes: ["repo.read"], irreversible: { policy: "allow" } })?.rule, "tier_irreversible_limit");
  assert.equal(breadthProblem(2, { scopes: ["shell.network", "repo.push"], irreversible: { policy: "allow" } }), undefined);
  assert.equal(breadthProblem(1, { scopes: ["shell.network"] }, { scopeMinTier: { "shell.network": 1 }, irreversibleAllowMinTier: 1 }), undefined, "the numbers are parameters");
  assert.equal(RECOMMENDED_TIER_BREADTH.irreversibleAllowMinTier, 2);
});

test("in the log: a tier 1 agent is refused each broader Mandate with its reason, the same Mandate is allowed at tier 2, and nothing changes before the config time", async () => {
  const k = await kit();
  const sponsor = await k.person("tb-sponsor", 400);
  const low = await k.agent("tb-low", sponsor, { tier: 1, funds: 100 });
  const high = await k.agent("tb-high", sponsor, { tier: 2, funds: 100 });
  let n = 0;
  const attempt = async (agent: Party, over: Record<string, unknown>) => {
    const contract = cosign(mk("contract", sponsor, { principal: sponsor.did, performer: agent.did, bank: bank.did, purpose: `Breadth ${++n}`, price: credit(10), verification: "principal", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: agent.did }), agent as Signer);
    await k.log.append(contract);
    const bond = mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(10), escrow: { payer: sponsor.did, amount: credit(10) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await k.log.append(bond);
    const m = mk("mandate", sponsor, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2027-12-03T18:00:00Z", revocable: true, ...over }, bond.id, { subject: agent.did });
    return refusedBy(k.log.append(m));
  };
  const net = { scopes: ["repo.read", "shell.network"], network: { hosts: ["api.example.org"], rate: { per_host_per_minute: 10 } } };
  // Before any config record nothing changes.
  assert.equal(await attempt(low, { irreversible: { policy: "allow" } }), undefined, "no config record, no tier limit");

  const at = nowIso(), from = new Date(Date.parse(at) + 2 * DAY).toISOString().replace(/\.\d+Z$/, "Z");
  let cfg = mk("config", operator, { key: "tier_breadth_from", value: from }, null, { at, cosigners: [owner] });
  await k.log.append(cfg);
  assert.equal(await attempt(low, { irreversible: { policy: "allow" } }), undefined, "before the time the record names, nothing changes");

  jump(3 * DAY);
  assert.equal(await attempt(low, net), "tier_scope_limit");
  assert.equal(await attempt(low, { scopes: ["repo.read", "repo.push"] }), "tier_scope_limit");
  assert.equal(await attempt(low, { irreversible: { policy: "allow" } }), "tier_irreversible_limit");
  assert.equal(await attempt(low, { irreversible: { policy: "forbid" } }), undefined, "a stricter policy is open to every tier");
  assert.equal(await attempt(high, net), undefined, "the same Mandate is allowed at tier 2");
  assert.equal(await attempt(high, { irreversible: { policy: "allow" } }), undefined);
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal((await k.log.verify()).ok, true, "a replay judges every record the same way");
  void cfg;
});

test("the command writes the record once and the log refuses a second value", async () => {
  const { configCmd } = await import("../../asp-cli/src/config-cmd.ts");
  const k = await kit();
  const parties = new Map<string, Party>([[operator.did, operator as Party], [owner.did, owner as Party]]);
  const lines: string[] = [];
  const handle = { log: k.log, append: (r: never) => k.log.append(r) } as never;
  const run = (value: string) => configCmd("set", { log: handle, io: { out: (l) => lines.push(l) }, now: () => nowIso(), signerFor: (d) => parties.get(d) as Signer, flags: { key: "tier_breadth_from", value, by: operator.did, "cosign-by": owner.did } });
  assert.equal(await run("2027-01-01T00:00:00Z"), 0);
  assert.match(lines.at(-1)!, /tier_breadth_from = 2027-01-01/);
  await assert.rejects(() => run("2027-02-01T00:00:00Z"), /already set/);
});
