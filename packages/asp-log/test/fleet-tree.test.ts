/**
 * The fleet tree (register row DK1372; spec-delta S1409): fleet > departments, teams, personas > members, each node with a Mandate, a monthly budget in credits and tokens, and an owner. A child's Mandate may only narrow
 * its parent's, at every level; moving an agent between nodes is a signed act; a budget at a node bounds what its members spend; a tree of 10,000 members is built and read within a stated time. Fake keys only.
 * Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { credit, jump, kit, keysOf, mk, operator, party, refusedBy, type Party } from "./society-kit.ts";

const FLEET = "did:web:example.com:orgs:acme:fleets:tree";
const BASE = {
  purpose: "Work for the enterprise", floor: "asp.floor/v1", scopes: ["repo.read", "repo.write", "pr.*"], forbidden_means: [] as string[], spend: { cap: 100, unit: "credit" }, irreversible: { policy: "checkpoint" },
  subcontract: { allowed: false }, nodes: { max_parallel: 4 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [] as string[],
  expires: "2040-01-01T00:00:00Z", revocable: true,
};
const M = (over: Record<string, unknown> = {}) => ({ ...BASE, ...over });

async function world() {
  const k = await kit();
  await k.withPrices();
  // a verified organisation (its passport is countersigned by the operator), so it may open any number of agents a day (S1406)
  const org = party("did:web:example.com:orgs:acme-tree");
  await k.log.append(mk("passport", org, { did: org.did, kind: "org", keys: keysOf(org) }, null, { subject: org.did, cosigners: [operator] }));
  const lead = await k.person("dept-lead");
  const client = await k.person("client-tree", 5000);
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "Acme", purpose: "all of Acme's agents" }, null, { subject: FLEET }));
  const node = (id: string, kind: string, parent: string | undefined, o: { version?: number; owner?: Party; budget?: Record<string, number>; mandate?: Record<string, unknown>; by?: Party; persona?: string; fleet?: string } = {}) =>
    mk("fleet_node", o.by ?? org, { fleet: o.fleet ?? FLEET, node: id, version: o.version ?? 1, kind, name: `${id} node`, ...(parent ? { parent } : {}), owner: (o.owner ?? lead).did, ...(o.budget ? { budget: o.budget } : {}), ...(o.mandate ? { mandate: o.mandate } : {}), ...(o.persona ? { persona: o.persona } : {}) }, null, { subject: FLEET });
  const join = async (name: string, nodeId?: string, o: { funds?: number } = {}): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${name}`);
    await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET, ...(nodeId ? { node: nodeId } : {}) }, null, { subject: a.did }));
    if (o.funds) await k.mint(a.did, o.funds);
    return a;
  };
  const move = (member: Party, to: string, by: Party = org) => mk("fleet_move", by, { fleet: FLEET, member: member.did, to }, null, { subject: member.did });
  return { ...k, org, lead, client, node, join, move };
}
type W = Awaited<ReturnType<typeof world>>;
const declare = async (w: W) => {
  await w.log.append(w.node("root", "fleet", undefined, { owner: w.org }));
  await w.log.append(w.node("eng", "department", "root"));
  await w.log.append(w.node("platform", "team", "eng"));
  await w.log.append(w.node("coder", "persona", "platform", { persona: "coder" }));
};

describe("the shape of the tree", () => {
  test("only the organisation signs it, for a fleet that exists, with an owner the log knows, version by version; the root comes first and parents before children", async () => {
    const w = await world();
    const stranger = await w.person("stranger-tree");
    assert.equal(await refusedBy(w.log.append(w.node("root", "fleet", undefined, { by: stranger }))), "fleet_node_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(w.node("root", "fleet", undefined, { fleet: "did:web:example.com:none" }))), "fleet_node_fleet_unknown");
    assert.equal(await refusedBy(w.log.append(w.node("root", "fleet", undefined, { owner: party("did:web:example.com:users:ghost") }))), "fleet_node_owner_unknown");
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root"))), "fleet_node_parent_unknown", "no root yet");
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org }));
    assert.equal(await refusedBy(w.log.append(w.node("root", "fleet", undefined, { owner: w.org }))), "fleet_node_version", "a version is signed once");
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { version: 2 }))), "fleet_node_version", "the first version is 1");
    assert.equal(await refusedBy(w.log.append(w.node("a", "department", "missing"))), "fleet_node_parent_unknown");
    await w.log.append(w.node("eng", "department", "root"));
    await w.log.append(w.node("eng", "department", "root", { version: 2 })); // an amendment
    assert.equal(await refusedBy(w.log.append(w.node("eng", "team", "root", { version: 3 }))), "fleet_node_immutable", "a node never changes kind");
    await w.log.append(w.node("ops", "department", "root"));
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "ops", { version: 3 }))), "fleet_node_immutable", "a node never changes parent");
    assert.equal((await w.log.verify()).ok, true);
  });

  test("kinds nest: a persona is a leaf, a department sits under the fleet or a department, and a tree is at most eight levels deep", async () => {
    const w = await world();
    await declare(w);
    assert.equal(await refusedBy(w.log.append(w.node("x", "persona", "coder"))), "fleet_node_kind", "a persona holds nothing");
    assert.equal(await refusedBy(w.log.append(w.node("d2", "department", "platform"))), "fleet_node_kind", "a team holds no department");
    assert.equal(await refusedBy(w.log.append(w.node("p2", "department", "root", { persona: "x" }))), "fleet_node_persona_kind");
    let parent = "platform";
    for (let i = 4; i <= 8; i++) { await w.log.append(w.node(`t${i}`, "team", parent)); parent = `t${i}`; }
    assert.equal(await refusedBy(w.log.append(w.node("t9", "team", parent))), "fleet_node_too_deep");
    assert.ok(await refusedBy(w.log.append(mk("fleet_node", w.org, { fleet: FLEET, node: "other-root", version: 1, kind: "fleet", name: "x", owner: w.org.did }, null, { subject: FLEET }))), "the schema allows no second root: the node id of a fleet is root");
  });
});

describe("a child's Mandate may only narrow its parent's, at every level", () => {
  test("the root within the fleet's template; a department within the root; a team within the department; a node with no Mandate passes the nearest one down; every widening names its fields", async () => {
    const w = await world();
    await w.log.append(mk("mandate_template", w.org, { fleet: FLEET, version: 1, mandate: M() }, null, { subject: FLEET }));
    assert.equal(await refusedBy(w.log.append(w.node("root", "fleet", undefined, { owner: w.org, mandate: M({ scopes: ["repo.read", "shell.exec"] }) }))), "node_mandate_widens", "the root may not go beyond the fleet's template");
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org, mandate: M({ scopes: ["repo.read", "repo.write"], spend: { cap: 80, unit: "credit" } }) }));
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { mandate: M({ scopes: ["repo.read", "pr.open"] }) }))), "node_mandate_widens", "pr.open is outside the root's scopes");
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { mandate: M({ scopes: ["repo.read"], spend: { cap: 81, unit: "credit" } }) }))), "node_mandate_widens", "the cap is above the root's");
    await w.log.append(w.node("eng", "department", "root", { mandate: M({ scopes: ["repo.read", "repo.write"], spend: { cap: 60, unit: "credit" } }) }));
    await w.log.append(w.node("platform", "team", "eng")); // no Mandate of its own: it holds the department's
    assert.equal(await refusedBy(w.log.append(w.node("coder", "persona", "platform", { mandate: M({ scopes: ["repo.read"], spend: { cap: 61, unit: "credit" } }) }))), "node_mandate_widens", "through a node with no Mandate, the department's cap still binds");
    await w.log.append(w.node("coder", "persona", "platform", { mandate: M({ scopes: ["repo.read"], spend: { cap: 20, unit: "credit" } }) }));
    await w.log.append(w.node("support", "department", "root", { mandate: M({ scopes: ["repo.read"], spend: { cap: 10, unit: "credit" } }) })); // siblings are independent
    assert.equal(await refusedBy(w.log.append(w.node("triage", "team", "support", { mandate: M({ scopes: ["repo.read", "repo.write"] }) }))), "node_mandate_widens", "a team cannot take what its department does not have");
  });

  test("an amendment may not go under a node below it, and the fleet's template may not be amended under the tree; narrowing an amendment further is fine", async () => {
    const w = await world();
    await w.log.append(mk("mandate_template", w.org, { fleet: FLEET, version: 1, mandate: M() }, null, { subject: FLEET }));
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org, mandate: M() }));
    await w.log.append(w.node("eng", "department", "root", { mandate: M({ scopes: ["repo.read", "repo.write"] }) }));
    await w.log.append(w.node("platform", "team", "eng", { mandate: M({ scopes: ["repo.write"] }) }));
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { version: 2, mandate: M({ scopes: ["repo.read"] }) }))), "node_mandate_below", "the team under it needs repo.write");
    await w.log.append(w.node("eng", "department", "root", { version: 2, mandate: M({ scopes: ["repo.write"] }) }));
    assert.equal(await refusedBy(w.log.append(mk("mandate_template", w.org, { fleet: FLEET, version: 2, mandate: M({ scopes: ["repo.read"] }) }, null, { subject: FLEET }))), "template_below_node", "the root and the nodes below hold repo.write");
    await w.log.append(mk("mandate_template", w.org, { fleet: FLEET, version: 2, mandate: M({ spend: { cap: 100, unit: "credit" }, nodes: { max_parallel: 6 } }) }, null, { subject: FLEET }));
    assert.equal((await w.log.verify()).ok, true, "a replica replays the tree the same way");
  });
});

describe("a Mandate signed for a member stays within its node", () => {
  test("a client's Mandate beyond the node's is refused naming the node; a move to a node that allows it lets the same job through; the member's own narrowing may not widen the node", async () => {
    const w = await world();
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org }));
    await w.log.append(w.node("readers", "team", "root", { mandate: M({ scopes: ["repo.write"] }) }));
    await w.log.append(w.node("writers", "team", "root", { mandate: M({ scopes: ["repo.read"] }) }));
    const a = await w.join("tree-member-a", "readers");
    const refused = async (m: Party) => { try { await w.runJob(w.client, m, 60); return undefined; } catch (e) { return (e as { detail?: string }).detail; } };
    assert.equal(await refused(a), "mandate_exceeds_node", "the job's Mandate asks repo.read; the node holds repo.write");
    assert.equal((await w.log.mandateCeiling(a.did))!.node, "readers");
    await w.log.append(w.move(a, "writers"));
    assert.equal(await refused(a), undefined, "on a node that allows repo.read the same job runs");
    assert.deepEqual((await w.log.deriveMemberMandate(a.did, "sha256:" + "6".repeat(64)))!.scopes, ["repo.read"], "the derived Mandate comes from the node now");
    await w.log.append(mk("mandate_narrowing", a, { fleet: FLEET, member: a.did, narrow: { scopes: ["repo.read"] } }, null, { subject: a.did }));
    assert.equal(await refusedBy(w.log.append(mk("mandate_narrowing", a, { fleet: FLEET, member: a.did, narrow: { scopes: ["repo.read", "repo.write"] } }, null, { subject: a.did }))), "narrowing_widens");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });
});

describe("moving an agent between nodes is a signed act", () => {
  test("by the organisation, the owner of the node it moves to or the member's sponsor; not by a stranger; counts follow the member; a passport cannot move it", async () => {
    const w = await world();
    await declare(w);
    const deptHead = await w.person("owner-of-ops");
    await w.log.append(w.node("ops", "department", "root", { owner: deptHead }));
    const a = await w.join("tree-mv-a", "platform"), b = await w.join("tree-mv-b"), c = await w.join("tree-mv-c", "coder");
    const t0 = (await w.log.fleetTree(FLEET))!;
    const row = (t: typeof t0, id: string) => t.nodes.find((n) => n.node === id)!;
    assert.deepEqual([row(t0, "root").members, row(t0, "platform").members, row(t0, "coder").members], [1, 1, 1], "a member that names no node sits at the root");
    assert.equal(row(t0, "eng").subtreeMembers, 2, "the department holds its team's and persona's members");
    const stranger = await w.person("stranger-mv");
    assert.equal(await refusedBy(w.log.append(w.move(a, "ops", stranger))), "fleet_move_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(w.move(a, "ops", w.lead))), "fleet_move_wrong_issuer", "the owner of eng is not the owner of ops");
    await w.log.append(w.move(a, "ops", deptHead)); // the owner of the node it moves to
    await w.log.append(w.move(b, "eng", w.org)); // the organisation
    await w.log.append(w.move(c, "root", w.org)); // back to the root
    assert.equal(await refusedBy(w.log.append(w.move(c, "root", w.org))), "fleet_move_same_node");
    assert.equal(await refusedBy(w.log.append(w.move(a, "nowhere", w.org))), "node_unknown");
    const outsider = await w.person("outsider-mv");
    assert.equal(await refusedBy(w.log.append(mk("fleet_move", w.org, { fleet: FLEET, member: outsider.did, to: "ops" }, null, { subject: outsider.did }))), "fleet_move_not_a_member");
    assert.deepEqual((await w.log.nodeOf(a.did))!.path, ["ops", "root"]);
    assert.deepEqual((await w.log.nodeOf(b.did))!.path, ["eng", "root"]);
    const t1 = (await w.log.fleetTree(FLEET))!;
    assert.deepEqual([row(t1, "root").members, row(t1, "eng").members, row(t1, "ops").members, row(t1, "platform").members, row(t1, "coder").members], [1, 1, 1, 0, 0]);
    assert.equal(t1.moves, 3);
    assert.equal(t1.members, 3, "a move changes no member count");
    // a passport cannot move a member, and a node needs a fleet
    const head = (await w.log.passport(a.did))!.head;
    const pass = (body: Record<string, unknown>) => mk("passport", w.org, { did: a.did, kind: "agent", sponsor: w.org.did, tier: 1, shape: {}, keys: keysOf(a), ...body }, head, { subject: a.did });
    assert.equal(await refusedBy(w.log.append(pass({ fleet: FLEET, node: "eng" }))), "node_use_fleet_move");
    const lone = party("did:web:example.com:agents:tree-lone");
    assert.equal(await refusedBy(w.log.append(mk("passport", w.org, { did: lone.did, kind: "agent", sponsor: w.org.did, tier: 1, shape: {}, keys: keysOf(lone), node: "eng" }, null, { subject: lone.did }))), "node_needs_fleet");
    const ghost = party("did:web:example.com:agents:tree-ghost");
    assert.equal(await refusedBy(w.log.append(mk("passport", w.org, { did: ghost.did, kind: "agent", sponsor: w.org.did, tier: 1, shape: {}, keys: keysOf(ghost), fleet: FLEET, node: "nope" }, null, { subject: ghost.did }))), "node_unknown");
    assert.equal((await w.log.verify()).ok, true);
  });
});

describe("a budget at a node", () => {
  test("a member may spend exactly its node's budget, and not one credit more", async () => {
    const w = await world();
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org, budget: { credits: 20 } }));
    await w.log.append(w.node("eng", "department", "root", { budget: { credits: 10 } }));
    const a = await w.join("tree-edge-a", "eng", { funds: 200 });
    const m = await w.openMandate(a);
    await w.buy(a, "registry.name.claim", 10, { mandate: m }); // exactly the department's 10
    assert.equal(await refusedBy(w.buy(a, "registry.name.claim", 10, { mandate: m })), "node_budget_exceeded");
  });

  test("the children take no more than the parent has, a node states its share where the parent states a field, and a budget cannot fall below what the children hold", async () => {
    const w = await world();
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org, budget: { credits: 100, tokens: 1000 } }));
    await w.log.append(w.node("eng", "department", "root", { budget: { credits: 60, tokens: 600 } }));
    assert.equal(await refusedBy(w.log.append(w.node("ops", "department", "root", { budget: { credits: 41, tokens: 400 } }))), "node_budget_exceeds_parent", "60 + 41 is over 100");
    assert.equal(await refusedBy(w.log.append(w.node("ops", "department", "root", { budget: { credits: 40 } }))), "node_budget_needed", "the root states tokens, so ops states its share");
    await w.log.append(w.node("ops", "department", "root", { budget: { credits: 40, tokens: 400 } }));
    await w.log.append(w.node("platform", "team", "eng", { budget: { credits: 30, tokens: 300 } }));
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { version: 2, budget: { credits: 20, tokens: 600 } }))), "node_budget_below_children", "its team takes 30");
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { version: 2, budget: { credits: 29, tokens: 600 } }))), "node_budget_below_children", "one short of what its team takes");
    await w.log.append(w.node("eng", "department", "root", { version: 2, budget: { credits: 30, tokens: 600 } }));
    assert.equal(await refusedBy(w.log.append(w.node("ops", "department", "root", { version: 2, budget: { credits: 80, tokens: 400 } }))), "node_budget_exceeds_parent");
  });

  test("credits a member spends at the institutions count against its node and every node above; a purchase over any budget is refused and leaves the books alone; a new month starts again; a move carries the member's later spend", async () => {
    const w = await world();
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org, budget: { credits: 40 } }));
    await w.log.append(w.node("eng", "department", "root", { budget: { credits: 25 } }));
    await w.log.append(w.node("platform", "team", "eng", { budget: { credits: 12 } }));
    await w.log.append(w.node("ops", "department", "root", { budget: { credits: 15 } }));
    const a = await w.join("tree-spend-a", "platform", { funds: 200 }), b = await w.join("tree-spend-b", "ops", { funds: 200 });
    const ma = await w.openMandate(a), mb = await w.openMandate(b);
    const buy = (by: Party, m: string, n: number) => w.buy(by, "registry.name.claim", n * 10, { mandate: m });
    await buy(a, ma, 1); // 10 of the team's 12
    assert.equal(await refusedBy(buy(a, ma, 1)), "node_budget_exceeded", "20 would be over the team's 12");
    const balance = async (d: string) => w.log.balance(d);
    const before = JSON.stringify(await balance(a.did));
    assert.equal(await refusedBy(buy(a, ma, 1)), "node_budget_exceeded");
    assert.equal(JSON.stringify(await balance(a.did)), before, "a refused purchase leaves the balance alone");
    const t = (await w.log.fleetTree(FLEET, new Date(Date.parse("2026-11-01T00:00:00Z") + 3_600_000).toISOString()))!;
    assert.deepEqual(t.nodes.map((n) => [n.node, n.usage.credits.spent]), [["root", 10], ["eng", 10], ["platform", 10], ["ops", 0]], "the spend counts at the node and every node above it");
    assert.deepEqual(t.nodes.find((n) => n.node === "platform")!.usage.credits, { spent: 10, budget: 12, left: 2 });
    await buy(b, mb, 1); // root: 20 of 40
    // the root has 40 and the departments 25 and 15 add up to it, so the root fills only when its children do: move a into ops, whose budget is 15
    await w.log.append(w.move(a, "ops"));
    assert.equal(await refusedBy(buy(b, mb, 1)), "node_budget_exceeded", "ops holds b's 10 and would take 10 more over its 15");
    await w.log.append(w.node("ops", "department", "root", { version: 2, budget: { credits: 15 } })); // an amendment changes nothing it already holds
    // a new month starts again
    jump(35 * 86_400_000);
    await buy(a, ma, 1);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("model tokens from Actions count at the node and above, and a node over its token budget is flagged, never refused", async () => {
    const w = await world();
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org, budget: { tokens: 1000 } }));
    await w.log.append(w.node("eng", "department", "root", { budget: { tokens: 500 } }));
    const a = await w.join("tree-tok-a", "eng");
    const mandate = await w.openMandate(a);
    const contract = ((await w.log.get(mandate))!.record.body as { contract: string }).contract;
    const act = (n: number) => mk("action", a, { contract, scopes_used: [], summary: `run ${n}`, metrics: { tokens_in: 200, tokens_out: 120 } }, null, { subject: contract });
    await w.log.append(act(1));
    let eng = (await w.log.fleetTree(FLEET))!.nodes.find((n) => n.node === "eng")!;
    assert.deepEqual(eng.usage.tokens, { used: 320, budget: 500, over: false });
    await w.log.append(act(2));
    eng = (await w.log.fleetTree(FLEET))!.nodes.find((n) => n.node === "eng")!;
    assert.deepEqual(eng.usage.tokens, { used: 640, budget: 500, over: true }, "reported over the budget; the gateway is where it is enforced");
    assert.equal((await w.log.fleetTree(FLEET))!.nodes.find((n) => n.node === "root")!.usage.tokens.used, 640);
  });
});

describe("a tree of 10,000 members", () => {
  test("is built through the log and read within a stated time: 10,000 members on 111 nodes in under 4 minutes, the tree and a member's path in under 2 seconds", { timeout: 600_000 }, async () => {
    const w = await world();
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org }));
    const teams: string[] = [];
    for (let d = 0; d < 10; d++) {
      await w.log.append(w.node(`dept-${d}`, "department", "root"));
      for (let t = 0; t < 10; t++) { await w.log.append(w.node(`team-${d}-${t}`, "team", `dept-${d}`)); teams.push(`team-${d}-${t}`); }
    }
    const t0 = Date.now();
    let last!: Party;
    for (let i = 0; i < 10_000; i++) last = await w.join(`tree-big-${i}`, teams[i % teams.length]);
    const built = Date.now() - t0;
    assert.ok(built < 240_000, `10,000 members took ${built} ms to place`);
    const r0 = Date.now();
    const tree = (await w.log.fleetTree(FLEET))!;
    const path = await w.log.nodeOf(last.did);
    const read = Date.now() - r0;
    assert.ok(read < 2000, `reading the tree took ${read} ms`);
    assert.equal(tree.members, 10_000);
    assert.equal(tree.nodes.length, 111);
    assert.equal(tree.nodes.find((n) => n.node === "root")!.subtreeMembers, 10_000);
    assert.equal(tree.nodes.find((n) => n.node === "dept-3")!.subtreeMembers, 1000);
    assert.equal(tree.nodes.find((n) => n.node === "team-3-4")!.members, 100);
    assert.equal(path!.path.length, 3);
    console.log(`10,000 members placed in ${built} ms; tree and path read in ${read} ms`);
  });
});
void credit;

describe("a token budget in the Mandate (DK1476, S1421)", () => {
  test("a token budget only narrows: the fleet template, a node and a member may lower it, never raise it or drop a limit it states", async () => {
    const w = await world();
    const TB = (per_run?: number, per_month?: number) => ({ token_budget: { ...(per_run ? { per_run } : {}), ...(per_month ? { per_month } : {}) } });
    await w.log.append(mk("mandate_template", w.org, { fleet: FLEET, version: 1, mandate: M(TB(50_000, 1_000_000)) }, null, { subject: FLEET }));
    await w.log.append(w.node("root", "fleet", undefined, { owner: w.org, mandate: M(TB(50_000, 1_000_000)) }));
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { mandate: M(TB(60_000, 1_000_000)) }))), "node_mandate_widens", "a higher per-run budget");
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { mandate: M(TB(50_000, 2_000_000)) }))), "node_mandate_widens", "a higher monthly budget");
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { mandate: M(TB(50_000)) }))), "node_mandate_widens", "dropping the monthly limit the ceiling states");
    assert.equal(await refusedBy(w.log.append(w.node("eng", "department", "root", { mandate: M() }))), "node_mandate_widens", "no budget at all");
    await w.log.append(w.node("eng", "department", "root", { mandate: M(TB(40_000, 800_000)) }));
    assert.equal(await refusedBy(w.log.append(w.node("platform", "team", "eng", { mandate: M(TB(45_000, 700_000)) }))), "node_mandate_widens", "a team cannot have more than its department");
    await w.log.append(w.node("platform", "team", "eng", { mandate: M(TB(20_000, 500_000)) }));
    // a member's own narrowing and a client's Mandate
    const a = await w.join("tb-member", "platform");
    assert.equal(await refusedBy(w.log.append(mk("mandate_narrowing", a, { fleet: FLEET, member: a.did, narrow: TB(30_000, 500_000) }, null, { subject: a.did }))), "narrowing_widens");
    await w.log.append(mk("mandate_narrowing", a, { fleet: FLEET, member: a.did, narrow: TB(10_000, 400_000) }, null, { subject: a.did }));
    const c = (await w.log.mandateCeiling(a.did))!;
    assert.deepEqual(c.mandate.token_budget, { per_run: 10_000, per_month: 400_000 }, "the derived Mandate carries the member's budget");
    // an amendment of the fleet template under a node below it is refused
    assert.equal(await refusedBy(w.log.append(mk("mandate_template", w.org, { fleet: FLEET, version: 2, mandate: M(TB(15_000, 1_000_000)) }, null, { subject: FLEET }))), "template_below_node");
  });
});
