/**
 * The halted-node line (register row DK1477, its Done line "and the dashboard line"): a signed run_halt from the fleet breaker (reasons cycle, fleet_spend, breach) shows on the fleet dashboard as a critical alert, a badge in the
 * tree table and a halted node in the tree data, and on the HUD's rail; the sibling node is untouched; a halt for a reason that is not a breaker (a per-run loop) does not show. Synthetic records; fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fleetDashboard, fleetHud } from "../../asp-log/src/index.ts";
import { renderFleetDashboard } from "../../asp-package/src/fleet-dashboard-routes.ts";
import { HUD_CLIENT_SCRIPT } from "../../asp-package/src/fleet-hud-client.ts";

const FLEET = "did:web:example.com:fleets:halt", ORG = "did:web:example.com:users:halt-org", NOW = "2026-11-20T12:00:00Z";
type Rec = { seq: number; id: string; record: { type: string; issuer: string; subject: string | null; issued_at: string; body: Record<string, unknown> } };
function records(): Rec[] {
  const out: Rec[] = []; let seq = 0;
  const push = (type: string, issuer: string, at: string, body: Record<string, unknown>, subject: string | null = null) => { seq++; out.push({ seq, id: `sha256:${String(seq).padStart(64, "0")}`, record: { type: `asp.${type}/v0.2`, issuer, subject, issued_at: at, body } }); };
  push("fleet", ORG, "2026-11-01T00:00:00Z", { did: FLEET, org: ORG, name: "Halt", purpose: "x", max_members: 20 }, FLEET);
  push("fleet_node", ORG, "2026-11-01T00:00:00Z", { fleet: FLEET, node: "root", version: 1, kind: "fleet", name: "Halt", owner: ORG }, null);
  for (const n of ["ops", "research"]) push("fleet_node", ORG, "2026-11-01T00:00:00Z", { fleet: FLEET, node: n, version: 1, kind: "department", name: n === "ops" ? "Operations" : "Research", parent: "root", owner: ORG }, null);
  for (let i = 0; i < 4; i++) { const did = `did:web:example.com:agents:halt-${i}`; push("passport", ORG, "2026-11-02T00:00:00Z", { did, kind: "agent", sponsor: ORG, fleet: FLEET, tier: 1, node: i < 2 ? "ops" : "research", shape: {}, keys: [] }, did); }
  const halt = (agent: string, reason: string, over: Record<string, unknown> = {}) => push("run_halt", "did:web:asp.local:operator", "2026-11-20T11:00:00Z", { contract: "sha256:" + "9".repeat(64), agent, reason, detail: "the node spent four times its pace", ...over });
  halt("did:web:example.com:agents:halt-0", "fleet_spend", { node: "ops" });
  halt("did:web:example.com:agents:halt-1", "fleet_spend", { node: "ops" });
  halt("did:web:example.com:agents:halt-2", "near_repeat");   // a per-run loop breaker: not the fleet breaker
  return out;
}

test("DK1477: a halted node shows on the dashboard (alert, tree data, badge) and the sibling does not; a per-run halt does not", () => {
  const d = fleetDashboard(records() as never, "Halt", { month: "2026-11", now: NOW })!;
  const ops = d.tree.find((t) => t.node === "ops")!, research = d.tree.find((t) => t.node === "research")!;
  assert.deepEqual(ops.halted, { reason: "fleet_spend", at: "2026-11-20T11:00:00Z", runs: 2 });
  assert.equal(research.halted, null, "the sibling is untouched; a per-run loop halt is not the breaker");
  const a = d.alerts.find((x) => x.kind === "node_halted")!;
  assert.equal(a.level, "critical");
  assert.match(a.text, /The department Operations was halted by the fleet breaker \(fleet spend\) on 2026-11-20: 2 run\(s\) were stopped, and the rest of the tree is untouched/);
  assert.equal(d.alerts.filter((x) => x.kind === "node_halted").length, 1);
  const html = renderFleetDashboard(d, [], { fragment: true });
  assert.match(html, /<span class="badge">halted: fleet spend, 2 run\(s\)<\/span>/);
  assert.match(html, /al-critical"><b>critical<\/b> The department Operations was halted/);
  const none = fleetDashboard(records().filter((r) => r.record.type !== "asp.run_halt/v0.2") as never, "Halt", { month: "2026-11", now: NOW })!;
  assert.ok(none.tree.every((t) => t.halted === null) && !none.alerts.some((x) => x.kind === "node_halted"), "no halt, no line");
});

test("DK1477: the HUD names the halted node on its rail", () => {
  const h = fleetHud(records() as never, "Halt", { from: Date.parse("2026-11-20T00:00:00Z"), to: Date.parse(NOW), now: NOW })!;
  assert.deepEqual(h.totals.halted, [{ node: "ops", reason: "fleet_spend", at: "2026-11-20T11:00:00Z", runs: 2 }]);
  assert.match(HUD_CLIENT_SCRIPT, /<h2>Halted<\/h2>/);
  assert.match(HUD_CLIENT_SCRIPT, /no node halted/);
});
