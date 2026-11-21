/**
 * Serves the live dashboard, the society pages with graphs and the fleet page from a synthetic month on 127.0.0.1, for looking at them and for the screenshots in docs/prototypes/dk1601 (register row DK1601):
 * `node scripts/demo-live.ts [port]` (the demo keeps writing records, so the live page at /fleet/Atlas/live#t=demo shows them arrive). The records are made up in memory (fake names, fake keys); nothing is stored and nothing leaves the machine. The demo has no sign-in: every request is the organisation's own.
 * Pages: /fleet/Atlas/dashboard, /fleet/Atlas/live, /society/fleets/Atlas, /society/daily?day=2026-11-20.
 */
import { createServer } from "node:http";
import { FleetControls } from "../packages/asp-log/src/index.ts";
import { fleetDashboardRoutes, fleetLiveRoute } from "../packages/asp-package/src/fleet-dashboard-routes.ts";
import { fleetRoutes } from "../packages/asp-package/src/fleet-pages.ts";
import { storyRoutes } from "../packages/asp-package/src/story-pages.ts";

const port = Number(process.argv[2] ?? 8810);
const FLEET = "did:web:example.com:fleets:atlas", ORG = "did:web:example.com:users:atlas-org", NOW = "2026-11-20T12:00:00Z";
type Rec = { seq: number; id: string; record: { type: string; issuer: string; subject: string | null; issued_at: string; body: Record<string, unknown> } };
const out: Rec[] = [];
let seq = 0;
const push = (type: string, issuer: string, at: string, body: Record<string, unknown>, subject: string | null = null) => { seq++; const id = `sha256:${String(seq).padStart(64, "0")}`; out.push({ seq, id, record: { type: `asp.${type}/v0.2`, issuer, subject, issued_at: at, body } }); return id; };
const day = (n: number, h = 10) => `2026-11-${String(n).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`;
push("fleet", ORG, day(1), { did: FLEET, org: ORG, name: "Atlas", purpose: "Reads papers and writes short summaries for the research team", template: { runtime: "claude-code", model: "model-one" }, max_members: 60 }, FLEET);
push("fleet_node", ORG, day(1), { fleet: FLEET, node: "root", version: 1, kind: "fleet", name: "Atlas", owner: ORG }, null);
for (const [node, name, parent] of [["research", "Research", "root"], ["ops", "Operations", "root"], ["readers", "Readers", "research"], ["writers", "Writers", "research"]] as const) push("fleet_node", ORG, day(1), { fleet: FLEET, node, version: 1, kind: node === "readers" || node === "writers" ? "team" : "department", name, parent, owner: ORG }, null);
const dids: string[] = [];
const personas = ["reader", "writer", "reviewer", "planner"];
for (let i = 0; i < 26; i++) {
  const did = `did:web:example.com:agents:atlas-${String(i + 1).padStart(2, "0")}`;
  dids.push(did);
  push("passport", ORG, day(1 + Math.floor((i * 19) / 26)), { did, kind: "agent", sponsor: ORG, fleet: FLEET, tier: i % 5 === 0 ? 2 : 1, persona: personas[i % 4], node: i % 3 === 0 ? "ops" : i % 2 ? "writers" : "readers", shape: {}, keys: [] }, did);
}
dids.forEach((did, i) => {
  for (let d = 2 + (i % 5); d <= 20; d += 3 + (i % 3)) {
    push("purchase", did, day(d, 11), { service: "registry.name.claim", institution: "did:web:asp.local:registry", amount: { value: 2 + ((d + i) % 5), unit: "credit" } });
    push("action", did, day(d, 12), { metrics: { tokens_in: 4000 + ((d * 37 + i * 91) % 3000), tokens_out: 900 + ((d * 17 + i * 13) % 500) } });
  }
});
for (const d of [6, 11, 15]) { const c = push("contract", "did:web:example.com:users:client", day(d), { principal: "did:web:example.com:users:client", performer: dids[d % 5], price: { value: 40 } }); push("settlement", "did:web:asp.local:bank", day(d, 14), { contract: c, basis: d === 11 ? "ruling" : "accepted", bond_slashed: { value: d === 11 ? 4 : 0 } }, c); }
for (const [d, i, sev] of [[9, 3, "warn"], [14, 7, "warn"], [14, 8, "quarantine_recommended"], [18, 3, "warn"]] as const) push("clinic_diagnosis", "did:web:asp.local:clinic", day(d), { agent: dids[i], severity: sev }, dids[i]);
const controls = new FleetControls();
controls.setCap(FLEET, "atlas-org", NOW, { credits: 400, tokens: 700_000 });
controls.setCap(FLEET, "atlas-org", NOW, { credits: 40 }, dids[4]);
controls.freeze(FLEET, "atlas-org", "2026-11-19T09:00:00Z", dids[8], "the Clinic recommended quarantine");
controls.freezeNode(FLEET, "atlas-org", "2026-11-19T09:05:00Z", "ops", "an incident in Operations");
const stored = async () => out as never;
let clock = Date.parse(NOW);
const iso = () => new Date(clock).toISOString().replace(/\.\d{3}Z$/, "Z");
const dash = fleetDashboardRoutes({ stored, controls, owned: () => [], now: iso });
// The demo is alive: every 2 seconds a few new records are written (spend, runs, now and then a slash or a drift diagnosis), so the live page can show them arriving.
let tickN = 0;
setInterval(() => {
  clock += 20_000; tickN++;
  const n = 1 + (tickN % 3);
  for (let k = 0; k < n; k++) {
    const did = dids[(tickN * 7 + k * 5) % dids.length]!;
    if ((tickN + k) % 2) push("purchase", did, iso(), { service: "registry.name.claim", institution: "did:web:asp.local:registry", amount: { value: 2 + ((tickN + k) % 5), unit: "credit" } });
    else push("action", did, iso(), { metrics: { tokens_in: 3000 + ((tickN * 131 + k * 17) % 4000), tokens_out: 700 + ((tickN * 29) % 600) } });
  }
  if (tickN % 11 === 0) push("clinic_diagnosis", "did:web:asp.local:clinic", iso(), { agent: dids[tickN % dids.length]!, severity: "warn" }, dids[tickN % dids.length]!);
  if (tickN % 17 === 0) { const c = push("contract", "did:web:example.com:users:client", iso(), { principal: "did:web:example.com:users:client", performer: dids[tickN % 9]!, price: { value: 40 } }); push("settlement", "did:web:asp.local:bank", iso(), { contract: c, basis: "ruling", bond_slashed: { value: 3 } }, c); }
}, 2000);
const routes = [fleetLiveRoute(), (rq: any, rs: any) => dash(rq, rs, { tenant: { name: "demo", role: "admin" } }), fleetRoutes({ stored }), storyRoutes({ stored, balances: async () => new Map(), now: iso })];
createServer(async (req, res) => { for (const r of routes) if (await r(req, res)) return; res.writeHead(404); res.end("not found"); }).listen(port, "127.0.0.1", () => console.log(`live demo on http://127.0.0.1:${port}/fleet/Atlas/dashboard`));
