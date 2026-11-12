// The handback and the handover cycle (register row DK84; spec-delta S303; residency.md 9): an agent is dispatched, changes while it lives in the city, is handed back with a record the log checks (delegation no
// longer live, the agent's own edges in order from the version sent, the log's tier, the host's signed subsidy), and is dispatched again from the edited version. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, cosign, staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, CITY_BUDGET_DID, HOST_DID } from "../src/index.ts";
import { issueDelegation, newNodeKey, recallDelegation } from "../../asp-package/src/residency-host.ts";
import { Kit, bankP, clinic, courts, operator, owner, party, refused, registrar, treasury, type Party } from "./academy-kit.ts";

const city = party(CITY_BUDGET_DID, 57);
const host = party(HOST_DID, 58);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const SHA = "sha256:" + "3".repeat(64);
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function world() {
  let ref: Kit | undefined;
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, city, host].map((p) => [p.kid, p.publicKey])));
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver, now: () => new Date(ref!.now()) }));
  ref = kit;
  const sponsor = await kit.person("hb-sponsor");
  const root = party("did:web:example.com:agents:hb-agent", 79);
  const version = await kit.put(kit.mk("passport", sponsor, { did: root.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: [{ id: root.kid, type: "Ed25519", public_key: b64urlEncode(root.publicKey) }] }, null, { subject: root.did }));
  const job = await kit.job(root);
  const budget = await kit.put(kit.mk("subsidy_budget" as never, city, { period: "2026-12", units: "tokens", total: 1000, published_at: kit.now(), classes: [{ class: "newcomer", per_agent_cap: 400, per_sponsor_cap: 3 }] }, null, { subject: null }));
  const grant = await kit.put(kit.mk("subsidy_grant" as never, city, { agent: root.did, class: "newcomer", budget, daily_cap: 150, period_cap: 300, from: "2026-12-01T00:00:00Z", until: "2027-01-01T00:00:00Z" }, null, { subject: root.did }));
  const allowance = await kit.put(kit.mk("sponsor_allowance" as never, sponsor, { sponsor: sponsor.did, agent: root.did, period: "2026-12", tokens_per_day: 100, tokens_total: 250, credits_per_month: 0, source: "sponsor_gateway", completion_reserve_permille: 100 }, null, { subject: root.did }));
  const node = newNodeKey(root.did, "hb-node");
  const t = kit.tick();
  const grantRec = issueDelegation(root, root.did, node, { mandate: job.mandate, host: HOST_DID, expires: iso(Date.parse(t) + 20 * 3_600_000), issuedAt: t });
  const delegation = await kit.put(grantRec);
  const dispatchBody = (over: Record<string, unknown> = {}) => clean({ agent: root.did, version, package_sha256: SHA, mandate: job.mandate, sponsor_allowance: allowance, subsidy_grant: grant, delegation, mode: "city", host: HOST_DID, from: kit.now(), until: iso(Date.parse(kit.now()) + 30 * 86_400_000), recall_deadline_seconds: 60, ...over });
  const dispatch = (over: Record<string, unknown> = {}) => kit.mk("dispatch" as never, sponsor, dispatchBody(over), null, { subject: root.did, cosigners: [host] });
  /** A lineage edge of the agent (a memory change), signed by the agent's key, following `prev`. */
  const edge = (description: string, prev: string | null, by: Party = root) => kit.mk("lineage" as never, by, { edge: "update", child: by.did, parents: [by.did], change: { layer: "memory", description } }, prev, { subject: by.did });
  const handback = (dispatchId: string, edges: string[], over: Record<string, unknown> = {}, by: Party = host, cosigners: Party[] = [root]) =>
    kit.mk("handback" as never, by, { dispatch: dispatchId, package_sha256_after: "sha256:" + "6".repeat(64), lineage_edges: edges, lessons: edges.map((e) => ({ edge: e, description: "a lesson" })), tier_before: 1, tier_after: 1, strikes: 0, slashes: 0, credits_earned: 0, usage: { tokens_by_source: { sponsor: 0, subsidy: 0 }, host_seconds: 0, wakes: 0, ceilings_hit: [], refusals: 0 }, diff_sha256: "sha256:" + "7".repeat(64), ...over }, null, { subject: root.did, cosigners });
  return { kit, sponsor, root, version, grant, allowance, grantRec, dispatch, edge, handback, job };
}

test("DK84 done: dispatched, changed in the city, handed back with a checked record, edited by the sponsor, and dispatched again from the edited version", async () => {
  const w = await world();
  const { kit, root } = w;
  const first = await kit.put(w.dispatch());

  // While it lives in the city the agent learns: one change that is good, one that drifted. Both are signed lineage edges.
  const e1 = await kit.put(w.edge("memory updated during a run: +1 (a good rule)", null));
  const e2 = await kit.put(w.edge("memory updated during a run: +1 (a drifted rule)", e1));

  // The handback is refused until the cycle is in order.
  assert.equal(await refused(kit.put(w.handback("sha256:" + "9".repeat(64), [e1, e2]))), "handback_unknown_dispatch");
  assert.equal(await refused(kit.put(w.handback(first, [e1, e2], {}, w.sponsor))), "handback_wrong_issuer", "a city residency is handed back by the host");
  assert.equal(await refused(kit.put(w.handback(first, [e1, e2], {}, host, []))), "handback_needs_agent", "the agent countersigns");
  assert.equal(await refused(kit.put(w.handback(first, [e1, e2]))), "delegation_still_live", "the sponsor recalls the delegation first");
  await kit.put(recallDelegation(root, root.did, w.grantRec, kit.tick()));
  assert.equal(await refused(kit.put(w.handback(first, [e2, e1]))), "package_chain_broken", "the edges are listed in order");
  assert.equal(await refused(kit.put(w.handback(first, []))), "package_chain_broken", "no edge listed, but the package hash differs from the one sent");
  const stranger = await kit.agent("hb-other", w.sponsor, 1);
  assert.equal(await refused(kit.put(w.handback(first, [await kit.put(w.edge("another agent's change", null, stranger)), e2]))), "package_chain_broken", "an edge of another agent is not this agent's history");
  assert.equal(await refused(kit.put(w.handback(first, [e1, e2], { tier_after: 2 }))), "handback_ledger_mismatch", "the tier is the log's");
  assert.equal(await refused(kit.put(w.handback(first, [e1, e2], { usage: { tokens_by_source: { sponsor: 0, subsidy: 7 }, host_seconds: 0, wakes: 0, ceilings_hit: [], refusals: 0 } }))), "handback_ledger_mismatch", "the subsidy is what the host signed");
  const back = await kit.put(w.handback(first, [e1, e2]));
  assert.equal(await refused(kit.put(w.handback(first, [e1, e2]))), "handback_dispatch_closed", "a dispatch is closed once");

  // The sponsor reviews: it undoes the drifted change (a new signed edge that names what it reverts) and keeps the good one (its own note). Then the edited version is dispatched again.
  const e3 = await kit.put(kit.mk("lineage" as never, root, { edge: "update", child: root.did, parents: [root.did], change: { layer: "memory", description: "undo: took back the drifted rule", reverts: e2 } }, e2, { subject: root.did }));
  assert.equal(await refused(kit.put(w.dispatch({ previous: first, version: e3 }))), "dispatch_delegation_not_live", "the old delegation was recalled: a fresh one is issued");
  const n2 = newNodeKey(root.did, "hb-node-2");
  const t2 = kit.tick();
  const g2 = issueDelegation(root, root.did, n2, { mandate: w.job.mandate, host: HOST_DID, expires: iso(Date.parse(t2) + 20 * 3_600_000), issuedAt: t2 });
  const d2 = await kit.put(g2);
  assert.equal(await refused(kit.put(w.dispatch({ previous: "sha256:" + "8".repeat(64), version: e3, delegation: d2 }))), "dispatch_previous_not_closed");
  const second = await kit.put(w.dispatch({ previous: first, version: e3, delegation: d2 }));
  assert.equal(await refused(kit.put(w.dispatch({ previous: first, version: e3, delegation: d2 }))), "already_dispatched");

  // The second cycle's handback starts from the edited version: its first edge must follow e3.
  const e4 = await kit.put(w.edge("memory updated during a run: +1 (after the edit)", e3));
  await kit.put(recallDelegation(root, root.did, g2, kit.tick()));
  assert.equal(await refused(kit.put(w.handback(second, [e1]))), "package_chain_broken", "the edges of the first cycle are not the second's");
  await kit.put(w.handback(second, [e4], { package_sha256_after: "sha256:" + "5".repeat(64) }));
  assert.equal((await kit.log.verify()).ok, true);
  void back;
});
