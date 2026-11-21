/**
 * The fleet-wide runaway breaker (register row DK1477; spec-delta S1423): a spend spiral at a tree node trips against its prorated budget and halts that node's running contracts with signed records while sibling nodes go on; a normal busy fleet does
 * not trip; an agent-to-agent cycle among the fleet's hires is found and halted; the tree shows the halted node. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { credit, kit, keysOf, mk, nowIso, operator, party, refusedBy, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";
import { allowedInWindow, hireCycles, tripped } from "../src/fleet-breaker.ts";

const FLEET = "did:web:example.com:orgs:fb-co:fleets:all";

test("the pure arithmetic: a monthly budget prorated to the window times the multiple, and cycles of two to four agents found once", () => {
  assert.deepEqual(allowedInWindow({ windowMs: 3_600_000, multiple: 4, budget: { tokens: 720_000, credits: 360 } }), { tokens: 4000, credits: 2 }, "a 30-day month is 720 hours: 1,000 tokens an hour, 4,000 at four times the pace");
  assert.deepEqual(allowedInWindow({ windowMs: 3_600_000, multiple: 4, budget: {} }), {}, "no budget, no pace to compare with");
  assert.deepEqual(tripped({ credits: 0, tokens: 4000 }, { tokens: 4000 }), [], "at the allowance is not over it");
  assert.equal(tripped({ credits: 3, tokens: 10 }, { tokens: 4000, credits: 2 }).length, 1);
  const h = (principal: string, performer: string, contract: string) => ({ principal, performer, at: 0, contract });
  const two = hireCycles([h("a", "b", "c1"), h("b", "a", "c2")]);
  assert.deepEqual(two.map((c) => [c.agents, c.contracts.sort()]), [[["a", "b"], ["c1", "c2"]]]);
  assert.equal(hireCycles([h("a", "b", "c1"), h("b", "c", "c2"), h("c", "d", "c3"), h("d", "a", "c4")]).length, 1, "a ring of four");
  assert.equal(hireCycles([h("a", "b", "c1"), h("b", "c", "c2"), h("a", "c", "c3")]).length, 0, "a chain is not a cycle");
});

async function world() {
  const k = await kit();
  await k.withPrices();
  const org = party("did:web:example.com:orgs:fb-co");
  await k.log.append(mk("passport", org, { did: org.did, kind: "org", keys: keysOf(org) }, null, { subject: org.did, cosigners: [operator] }));
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "All", purpose: "everything" }, null, { subject: FLEET }));
  const node = (id: string, kind: string, parent: string | undefined, budget?: Record<string, number>) => mk("fleet_node", org, { fleet: FLEET, node: id, version: 1, kind, name: id, ...(parent ? { parent } : {}), owner: org.did, ...(budget ? { budget } : {}) }, null, { subject: FLEET });
  await k.log.append(node("root", "fleet", undefined));
  await k.log.append(node("eng", "department", "root", { tokens: 720_000, credits: 7200 }));
  await k.log.append(node("ops", "department", "root", { tokens: 720_000, credits: 7200 }));
  const join = async (name: string, at: string): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${name}`);
    await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET, node: at }, null, { subject: a.did }));
    await k.mint(a.did, 500);
    return a;
  };
  let n = 0;
  const running = async (principal: Party, a: Party): Promise<string> => {
    const contract = cosign(mk("contract", principal, { principal: principal.did, performer: a.did, bank: bank.did, purpose: `fb run ${++n}`, price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: a.did }), a as Signer);
    await k.log.append(contract);
    const bond = mk("bond", principal, { contract: contract.id, backer: principal.did, amount: credit(2), escrow: { payer: principal.did, amount: credit(10) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await k.log.append(bond);
    await k.log.append(mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true }, bond.id, { subject: a.did }));
    return contract.id;
  };
  const burn = async (a: Party, contract: string, tokens: number) => { await k.log.append(mk("action", a, { contract, scopes_used: [], summary: "work", metrics: { tokens_in: tokens, tokens_out: 0 } }, null, { subject: contract })); };
  const client = await k.person("fb-client", 500);
  return { ...k, org, join, running, burn, client };
}

test("a spiral at one node trips against its prorated budget, halts that node's running contracts with signed records and leaves the sibling node and a normal busy fleet alone; the tree shows the halted node", async () => {
  const w = await world();
  const e1 = await w.join("fb-eng-1", "eng"), e2 = await w.join("fb-eng-2", "eng"), o1 = await w.join("fb-ops-1", "ops");
  const [c1, c2, c3] = [await w.running(w.client, e1), await w.running(w.client, e2), await w.running(w.client, o1)];
  await w.burn(e1, c1, 1500); await w.burn(o1, c3, 1500);
  const calm = await w.log.fleetBreaker(FLEET, { node: "eng", at: nowIso(), windowMs: 3_600_000, multiple: 4 });
  assert.deepEqual([calm.reasons, calm.contracts, calm.used.tokens, calm.allowed.tokens], [[], [], 1500, 4000], "a normal busy hour does not trip");
  await w.burn(e1, c1, 60_000); await w.burn(e2, c2, 60_000);
  const spiral = await w.log.fleetBreaker(FLEET, { node: "eng", at: nowIso(), windowMs: 3_600_000, multiple: 4 });
  assert.match(spiral.reasons[0], /121500 tokens against 4000 allowed/);
  assert.deepEqual(spiral.contracts.map((c) => c.contract).sort(), [c1, c2].sort(), "the eng contracts, not the ops one");
  const ops = await w.log.fleetBreaker(FLEET, { node: "ops", at: nowIso(), windowMs: 3_600_000, multiple: 4 });
  assert.deepEqual(ops.reasons, [], "the sibling node is untouched");
  for (const c of spiral.contracts) await w.log.append(mk("run_halt", w.org, { contract: c.contract, agent: c.agent, reason: "fleet_spend", detail: spiral.reasons[0], node: "eng" }, null, { subject: c.contract }));
  assert.ok((await w.log.runHaltOf(c1)) && (await w.log.runHaltOf(c2)));
  assert.equal(await w.log.runHaltOf(c3), undefined, "the ops run goes on");
  const again = await w.log.fleetBreaker(FLEET, { node: "eng", at: nowIso(), windowMs: 3_600_000, multiple: 4 });
  assert.deepEqual(again.contracts, [], "already halted: nothing more to halt");
  const tree = (await w.log.fleetTree(FLEET))!;
  const eng = tree.nodes.find((n) => n.node === "eng")!;
  assert.deepEqual([eng.halt?.reason, tree.nodes.find((n) => n.node === "ops")!.halt], ["fleet_spend", undefined], "the tree (and the dashboard that reads it) shows the halted node");
  assert.equal((await w.log.verify()).ok, true);
});

test("an agent-to-agent cycle among the fleet's hires is found and its contracts halted; hires that are not a cycle are not flagged", async () => {
  const w = await world();
  const a = await w.join("fb-cyc-a", "eng"), b = await w.join("fb-cyc-b", "eng"), c = await w.join("fb-cyc-c", "ops");
  const ab = await w.running(a, b);
  const bc = await w.running(b, c);
  assert.deepEqual((await w.log.fleetBreaker(FLEET, { at: nowIso() })).cycles, [], "A hires B hires C: a chain, not a cycle");
  const ba = await w.running(b, a);
  const r = await w.log.fleetBreaker(FLEET, { at: nowIso() });
  assert.equal(r.cycles.length, 1);
  assert.deepEqual(r.cycles[0].agents.slice().sort(), [a.did, b.did].sort());
  assert.deepEqual(r.cycles[0].contracts.sort(), [ab, ba].sort());
  for (const ct of r.cycles[0].contracts) {
    const performer = ((await w.log.get(ct))!.record.body as { performer: string }).performer;
    await w.log.append(mk("run_halt", w.org, { contract: ct, agent: performer, reason: "cycle", detail: "an agent-to-agent cycle" }, null, { subject: ct }));
  }
  assert.ok((await w.log.runHaltOf(ab)) && (await w.log.runHaltOf(ba)));
  assert.equal(await w.log.runHaltOf(bc), undefined, "the third agent's contract is not part of the cycle");
  assert.equal(await refusedBy(w.log.append(mk("run_halt", w.org, { contract: ab, agent: b.did, reason: "cycle", detail: "again" }, null, { subject: ab }))), "run_halt_known");
});
