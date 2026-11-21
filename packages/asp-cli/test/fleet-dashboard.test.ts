/**
 * The fleet dashboard and controls (register row DK1361): the dashboard of a fleet from the records (members with tier, slashes, drift, spend in credits and tokens), caps that refuse a write past them, a freeze switch for the fleet
 * or one member, alerts, the export, access limited to the tenant that owns the fleet's organisation, and the same at 10,000 agents within a stated time. Synthetic records stand in for a log where scale matters; the guard is also run
 * on real records. Fake keys only. Credits are accounting entries, not money.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FleetControls, emptyControls, fleetCsv, fleetDashboard, fleetGuard, monthOf } from "../../asp-log/src/index.ts";
import { fleetDashboardRoutes } from "../../asp-package/src/fleet-dashboard-routes.ts";
import { credit, keysOf, kit, mk, party } from "../../asp-log/test/society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const FLEET = "did:web:example.com:fleets:big", ORG = "did:web:example.com:users:acme";
const NOW = "2026-11-20T12:00:00Z", MONTH = monthOf(NOW);
type Stored = { seq: number; id: string; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: Record<string, unknown> } };

/** A synthetic log of a fleet of `n` agents: passports (tier 1), a fleet record, and for each agent a purchase and an action this month. */
function synthetic(n: number, tree = false) {
  const out: Stored[] = [];
  let seq = 0;
  const push = (type: string, issuer: string, body: Record<string, unknown>, subject: string | null = null, at = "2026-11-02T10:00:00Z") => { seq++; out.push({ seq, id: `sha256:${String(seq).padStart(64, "0")}`, record: { type: `asp.${type}/v0.2`, issuer, subject, issued_at: at, body } }); return `sha256:${String(seq).padStart(64, "0")}`; };
  push("fleet", ORG, { did: FLEET, org: ORG, name: "Big", purpose: "A big fleet", max_members: n + 100 }, FLEET);
  const dids: string[] = [];
  for (let i = 0; i < n; i++) {
    const did = `did:web:example.com:agents:big-${String(i).padStart(5, "0")}`;
    dids.push(did);
    push("passport", ORG, { did, kind: "agent", sponsor: ORG, fleet: FLEET, tier: 1, shape: {}, keys: [] }, did);
  }
  if (tree) {
    // 10 departments, 10 teams under each, members spread over the teams by a signed move; a persona node under the first team
    for (let d = 0; d < 10; d++) push("fleet_node", ORG, { fleet: FLEET, node: `dept-${d}`, version: 1, kind: "department", name: `Department ${d}`, parent: "root", owner: ORG, ...(d === 0 ? { budget: { credits: 30 } } : {}) }, null);
    for (let t = 0; t < 100; t++) push("fleet_node", ORG, { fleet: FLEET, node: `team-${t}`, version: 1, kind: "team", name: `Team ${t}`, parent: `dept-${t % 10}`, owner: ORG }, null);
    push("fleet_node", ORG, { fleet: FLEET, node: "coders", version: 1, kind: "persona", name: "Coders", parent: "team-0", owner: ORG, persona: "coder" }, null);
    dids.forEach((did, i) => push("fleet_move", ORG, { fleet: FLEET, member: did, to: i % 50 === 0 ? "coders" : `team-${i % 100}` }, null, "2026-11-03T10:00:00Z"));
  }
  const outside = "did:web:example.com:users:client";
  dids.forEach((did, i) => {
    push("purchase", did, { service: "registry.name.claim", institution: "did:web:asp.local:registry", amount: { value: 10 + (i % 5), unit: "credit" } });
    push("action", did, { contract: "x", metrics: { tokens_in: 1000 + i, tokens_out: 500 } });
  });
  // a few jobs: some settled accepted for an outside principal, one with a slash, one inside the fleet, one drift diagnosis
  const c1 = push("contract", outside, { principal: outside, performer: dids[0], price: { value: 50 } });
  push("settlement", "did:web:asp.local:bank", { contract: c1, basis: "accepted", bond_slashed: { value: 0 } }, c1);
  const c2 = push("contract", outside, { principal: outside, performer: dids[1], price: { value: 50 } });
  push("settlement", "did:web:asp.local:bank", { contract: c2, basis: "ruling", bond_slashed: { value: 5 } }, c2, "2026-11-18T10:00:00Z");
  const c3 = push("contract", dids[2], { principal: dids[2], performer: dids[3], price: { value: 30 } });
  push("settlement", "did:web:asp.local:bank", { contract: c3, basis: "accepted", bond_slashed: { value: 0 } }, c3);
  push("clinic_diagnosis", "did:web:asp.local:clinic", { agent: dids[4], severity: "warn" }, dids[4], "2026-11-15T10:00:00Z");
  push("clinic_diagnosis", "did:web:asp.local:clinic", { agent: dids[5], severity: "quarantine_recommended" }, dids[5], "2026-11-16T10:00:00Z");
  push("tier_promotion", "did:web:asp.local:registrar", { from: 1, to: 2 }, dids[6], "2026-11-10T10:00:00Z");
  return { stored: out as never, dids };
}

test("DK1361: the dashboard of a fleet from the records: members with tier, slashes, drift and spend, the totals, the page of members, and the alerts", () => {
  const { stored, dids } = synthetic(250);
  const d = fleetDashboard(stored, "Big", { month: MONTH, now: NOW })!;
  assert.equal(d.fleet.id, FLEET);
  assert.equal(d.totals.members, 250);
  assert.deepEqual([d.page.number, d.page.size, d.page.pages, d.members.length], [1, 100, 3, 100], "a page of 100 members");
  const m0 = d.members.find((m) => m.did === dids[0])!;
  assert.deepEqual([m0.tier, m0.slashes, m0.drift, m0.credits, m0.tokens], [1, 0, 0, 10, 1500]);
  assert.equal(d.members.find((m) => m.did === dids[1])!.slashes, 1, "a slash in the last 30 days");
  assert.equal(d.members.find((m) => m.did === dids[4])!.drift, 1);
  assert.equal(d.members.find((m) => m.did === dids[5])!.drift, 2);
  assert.equal(d.members.find((m) => m.did === dids[6])!.tier, 2, "a promotion moves the tier");
  assert.equal(d.totals.slashes, 1);
  assert.equal(d.totals.drifting, 2);
  assert.deepEqual([d.totals.insideContracts, d.totals.outsideAccepted], [1, 1]);
  assert.equal(d.totals.credits, 250 * 10 + (0 + 1 + 2 + 3 + 4) * 50, "credits spent this month: 10 to 14 each");
  assert.equal(d.totals.byTier["1"], 249);
  assert.equal(d.totals.byTier["2"], 1);
  assert.deepEqual(d.alerts.map((a) => a.kind).sort(), ["drift", "drift", "slash"]);
  assert.ok(d.alerts[0].level === "critical", "the most serious alert first");
  const p3 = fleetDashboard(stored, FLEET, { month: MONTH, now: NOW, page: 3 })!;
  assert.equal(p3.members.length, 50);
  assert.equal(fleetDashboard(stored, FLEET, { month: MONTH, now: NOW, page: 99 })!.page.number, 3, "a page past the end is the last page");
  assert.equal(fleetDashboard(stored, "Nope", { month: MONTH, now: NOW }), undefined);
  assert.equal(fleetDashboard(stored, FLEET, { month: "2026-10", now: NOW })!.totals.credits, 0, "another month has no spend");
  assert.ok(fleetDashboard(stored, FLEET, { month: MONTH, now: NOW })!.not_yet.some((x) => /DK1359/.test(x)), "what is not built yet is said");
  assert.deepEqual(d.tree.map((t) => [t.node, t.membersHere, t.membersUnder]), [["root", 250, 250]], "no tree declared: every member at the root");
});

test("DK1361: the controls: a freeze and a cap are kept with who and when, survive a restart, and refuse bad values", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-fleetctl-"));
  const file = join(dir, "tokens.fleet-controls.json");
  const c = new FleetControls(file);
  c.freeze(FLEET, "acme", NOW, undefined, "an incident");
  c.freeze(FLEET, "acme", NOW, "did:web:example.com:agents:big-00001");
  c.setCap(FLEET, "acme", NOW, { credits: 500, tokens: 100000 });
  c.setCap(FLEET, "acme", NOW, { credits: 20 }, "did:web:example.com:agents:big-00002");
  assert.throws(() => c.setCap(FLEET, "acme", NOW, { credits: -1 }), /whole number of credits a month/);
  assert.throws(() => c.setCap(FLEET, "acme", NOW, { tokens: 1.5 }), /whole number of tokens a month/);
  const again = new FleetControls(file);
  const s = again.get(FLEET);
  assert.deepEqual([s.frozen, s.frozenMembers, s.caps.fleet, s.caps.members], [true, ["did:web:example.com:agents:big-00001"], { credits: 500, tokens: 100000 }, { "did:web:example.com:agents:big-00002": { credits: 20 } }]);
  assert.deepEqual(s.audit.map((a) => a.act), ["freeze", "freeze", "cap", "cap"]);
  again.unfreeze(FLEET, "acme", NOW);
  again.setCap(FLEET, "acme", NOW, {}, "did:web:example.com:agents:big-00002");
  assert.deepEqual([again.get(FLEET).frozen, again.get(FLEET).caps.members], [false, {}]);
  assert.ok(!/private_key|seed|secret/i.test(readFileSync(file, "utf8")), "no key in the file");
  assert.equal(new FleetControls(join(dir, "missing.json")).get(FLEET).frozen, false, "a missing file starts empty");
});

test("DK1361: on real records the guard refuses a write by a frozen member, a purchase past a credit cap and an action past a token cap, and lets everything else through until the cap is lifted", async () => {
  const k = await kit();
  await k.withPrices();
  const org = await k.person("gd-org", 600);
  const FL = "did:web:example.com:fleets:guarded";
  await k.log.append(mk("fleet", org, { did: FL, org: org.did, name: "Guarded", purpose: "A guarded fleet" }, null, { subject: FL }));
  const mkMember = async (n: string) => { const a = party(`did:web:example.com:agents:${n}`); await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FL }, null, { subject: a.did })); await k.mint(a.did, 400); return a; };
  const a1 = await mkMember("gd-one"), a2 = await mkMember("gd-two");
  const stranger = await k.agent("gd-stranger", await k.person("gd-other"), { tier: 1, funds: 100 });
  const controls = new FleetControls();
  const spent: unknown[] = [];   // spend already on the log this month: a purchase of 10 credits by gd-one
  const guard = fleetGuard({ controls, since: async (after, limit) => [...((await k.log.since(after, limit)) as unknown[]), ...(spent as { seq: number }[]).filter((x) => x.seq > after)] as never, now: () => NOW });
  const tenant = { role: "tenant" as const };
  const purchase = (by: typeof a1, amount: number) => mk("purchase", by, { service: "registry.name.claim", institution: "did:web:asp.local:registry", price_list: k.listId(), quantity: 1, amount: credit(amount), idempotency: `n-${Math.random()}` });
  const ask = (rec: unknown) => guard({ tenant, method: "append", args: [rec] });
  assert.equal(await ask(purchase(a1, 10)), undefined, "no controls: nothing is refused");
  // a credit cap of 25 for the fleet this month; spend 10 is already on the log
  spent.push({ seq: 99999, id: "sha256:" + "5".repeat(64), record: { type: "asp.purchase/v0.2", issuer: a1.did, issued_at: "2026-11-05T10:00:00Z", subject: null, body: { amount: { value: 10, unit: "credit" } } } });
  controls.setCap(FL, "acme", NOW, { credits: 25 });
  assert.match((await ask(purchase(a2, 20))) ?? "", /FLEET_CAP: this purchase of 20 credits would take the fleet Guarded past its monthly credit cap of 25 \(10 spent\)/);
  assert.equal(await ask(purchase(a2, 15)), undefined, "15 more is exactly the cap");
  controls.setCap(FL, "acme", NOW, { credits: 12 }, a2.did);
  assert.match((await ask(purchase(a2, 13))) ?? "", /FLEET_CAP: .* past its monthly credit cap of 12/);
  assert.equal(await ask(purchase(stranger, 90)), undefined, "an agent outside the fleet is never held by it");
  // freeze one member, then the fleet
  controls.freeze(FL, "acme", NOW, a1.did);
  assert.match((await ask(purchase(a1, 1))) ?? "", /FLEET_FROZEN: .*gd-one is frozen by its organisation/);
  assert.equal(await ask(purchase(a2, 5)), undefined, "the other member still works");
  controls.freeze(FL, "acme", NOW);
  assert.match((await ask(purchase(a2, 5))) ?? "", /FLEET_FROZEN: the fleet Guarded is frozen by its organisation/);
  assert.equal(await ask(purchase(stranger, 5)), undefined);
  assert.equal(await guard({ tenant: { role: "admin" }, method: "append", args: [purchase(a2, 5)] }), undefined, "an operator's writes are not held by a fleet's policy");
  const batch = await guard({ tenant, method: "importRecords", args: [[{ record: purchase(stranger, 1) }, { record: purchase(a1, 1) }]] });
  assert.match(batch ?? "", /FLEET_FROZEN/, "a batch with a frozen member's record is refused");
  controls.unfreeze(FL, "acme", NOW);
  controls.unfreeze(FL, "acme", NOW, a1.did);
  assert.equal(await ask(purchase(a1, 1)), undefined, "unfrozen: it works again");
  // a token cap refuses a run report once reached
  const action = (by: typeof a1, tokens: number) => mk("action", by, { contract: "sha256:" + "1".repeat(64), scopes_used: ["repo.read"], assurance: "gateway_observed", summary: "run", metrics: { tokens_in: tokens, tokens_out: 0, tool_calls: 1, seconds: 1 } });
  controls.setCap(FL, "acme", NOW, { tokens: 1000 });
  assert.equal(await ask(action(a1, 400)), undefined, "under the cap");
  spent.push({ seq: 100000, id: "sha256:" + "6".repeat(64), record: { type: "asp.action/v0.2", issuer: a2.did, issued_at: "2026-11-06T10:00:00Z", subject: null, body: { metrics: { tokens_in: 1200, tokens_out: 0 } } } });
  assert.match((await ask(action(a1, 1))) ?? "", /FLEET_CAP: the fleet Guarded has reached its monthly token cap of 1000/);
  controls.setCap(FL, "acme", NOW, { tokens: 5000 });
  assert.equal(await ask(action(a1, 1)), undefined, "a raised cap lets it through");
  controls.setCap(FL, "acme", NOW, { tokens: 5000 }, a2.did);
  controls.setCap(FL, "acme", NOW, { tokens: 1000 }, a2.did);
  assert.match((await ask(action(a2, 1))) ?? "", /FLEET_CAP: .*gd-two has reached its monthly token cap of 1000/);
});

async function service(n = 40) {
  const { stored, dids } = synthetic(n);
  const controls = new FleetControls();
  const routes = fleetDashboardRoutes({ stored: async () => stored, controls, owned: (t) => (t === "acme" ? [ORG] : []), now: () => NOW });
  const server = createServer(async (req, res) => {
    const who = String(req.headers.authorization ?? "").replace("Bearer ", "");
    const tenant = who === "ops" ? { name: "ops", role: "admin" } : { name: who || "nobody", role: "tenant" };
    if (!(await routes(req, res, { tenant }))) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, as: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${as}`, accept: "application/json", ...(init.headers ?? {}) } });
  const post = (path: string, as: string, body: unknown) => call(path, as, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { call, post, controls, dids, stored };
}

test("DK1361: access: the tenant that owns the organisation and an operator may see and change a fleet; another tenant gets 403 on every route; an unknown fleet is a 404", async () => {
  const s = await service();
  for (const [method, op] of [["GET", "dashboard"], ["GET", "export"], ["POST", "freeze"], ["POST", "unfreeze"], ["POST", "caps"]] as const) {
    const r = await s.call(`/fleet/Big/${op}`, "mallory", { method, ...(method === "POST" ? { body: "{}" } : {}) });
    assert.equal(r.status, 403, `${op}: another tenant is refused`);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "NOT_YOURS");
  }
  assert.equal((await s.call("/fleet/Big/dashboard", "acme")).status, 200);
  assert.equal((await s.call("/fleet/Big/dashboard", "ops")).status, 200);
  assert.equal((await s.call("/fleet/Nope/dashboard", "acme")).status, 404);
  assert.equal((await s.call(`/fleet/${encodeURIComponent(FLEET)}/dashboard`, "acme")).status, 200, "by id too");
  assert.equal((await s.call("/fleet/Big/dashboard", "acme", { method: "DELETE" })).status, 405);
  assert.equal((await s.call("/fleet/Big/freeze", "acme")).status, 405);
  assert.equal((await s.call("/elsewhere", "acme")).status, 404, "other paths are not ours");
});

test("DK1361: the routes: freeze and unfreeze the fleet or a member, set and clear caps, each shown on the dashboard and in the audit trail; bad input is refused in words", async () => {
  const s = await service();
  const member = s.dids[3];
  assert.equal((await s.post("/fleet/Big/freeze", "acme", { member: "did:web:example.com:agents:not-a-member" })).status, 404);
  const f1 = (await (await s.post("/fleet/Big/freeze", "acme", { member, reason: "odd behaviour" })).json()) as { frozen: boolean; frozenMembers: string[] };
  assert.deepEqual([f1.frozen, f1.frozenMembers], [false, [member]]);
  const caps = (await (await s.post("/fleet/Big/caps", "acme", { credits: 2000, tokens: 900000 })).json()) as { caps: { fleet: { credits: number } } };
  assert.equal(caps.caps.fleet.credits, 2000);
  await s.post("/fleet/Big/caps", "acme", { member: s.dids[0], credits: 5 });
  const bad = await s.post("/fleet/Big/caps", "acme", { credits: -3 });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: { message: string } }).error.message, /whole number of credits a month/);
  assert.equal((await s.call("/fleet/Big/freeze", "acme", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" })).status, 400);
  const dash = (await (await s.call("/fleet/Big/dashboard", "acme")).json()) as { members: { did: string; frozen: boolean; capCredits: number | null }[]; alerts: { kind: string }[]; audit: { act: string }[]; controls: { caps: { fleet: { credits: number } }; frozen: boolean }; totals: { frozen: number } };
  assert.equal(dash.members.find((m) => m.did === member)!.frozen, true);
  assert.equal(dash.members.find((m) => m.did === s.dids[0])!.capCredits, 5);
  assert.equal(dash.totals.frozen, 1);
  assert.ok(dash.alerts.some((a) => a.kind === "member_frozen"));
  assert.ok(dash.alerts.some((a) => a.kind === "cap_reached"), "a member over its own cap of 5 (it spent 10)");
  assert.deepEqual(dash.audit.map((a) => a.act), ["freeze", "cap", "cap"]);
  await s.post("/fleet/Big/freeze", "acme", {});
  const frozen = (await (await s.call("/fleet/Big/dashboard", "acme")).json()) as { controls: { frozen: boolean }; totals: { frozen: number }; alerts: { kind: string }[] };
  assert.equal(frozen.controls.frozen, true);
  assert.equal(frozen.totals.frozen, 40, "a frozen fleet freezes every member");
  assert.ok(frozen.alerts.some((a) => a.kind === "fleet_frozen"));
  await s.post("/fleet/Big/unfreeze", "acme", {});
  await s.post("/fleet/Big/unfreeze", "acme", { member });
  const after = (await (await s.call("/fleet/Big/dashboard", "acme")).json()) as { controls: { frozen: boolean }; totals: { frozen: number } };
  assert.deepEqual([after.controls.frozen, after.totals.frozen], [false, 0]);
  await s.post("/fleet/Big/caps", "acme", { member: s.dids[0] });
  assert.equal(s.controls.get(FLEET).caps.members[s.dids[0]], undefined, "an empty cap removes it");
});

test("DK1361: the page and the export: HTML for a browser with the alerts, the caps and the audit trail; CSV and JSON of every member; no token, key or free text", async () => {
  const s = await service(130);
  await s.post("/fleet/Big/caps", "acme", { credits: 10 });
  await s.post("/fleet/Big/freeze", "acme", { member: s.dids[2] });
  const html = await (await s.call("/fleet/Big/dashboard", "acme", { headers: { accept: "text/html" } })).text();
  assert.match(html, /<h1>Big<\/h1>/);
  assert.match(html, /Fleet dashboard \(private to its organisation\)/);
  assert.match(html, /class="al-critical"/);
  assert.match(html, /Audit trail/);
  assert.match(html, /Page 1 of 2/);
  assert.match(html, /<a href="\?page=2&amp;size=100">next<\/a>/);
  assert.match(html, /Not on this page yet/);
  assert.doesNotMatch(html, /<script|https?:\/\//, "no script and no outside address");
  const csv = await (await s.call("/fleet/Big/export?format=csv", "acme")).text();
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "did,name,node,persona,tier,slashes_30d,drift,credits_spent,tokens,frozen,credit_cap,token_cap");
  assert.equal(lines.length, 131, "every member, not a page");
  assert.ok(lines.some((l) => l.includes(s.dids[2]) && l.includes(",true,")));
  const json = (await (await s.call("/fleet/Big/export?format=json", "acme")).json()) as { members: unknown[]; page: { pages: number } };
  assert.deepEqual([json.members.length, json.page.pages], [130, 1]);
  assert.equal(fleetCsv(s.stored, "Nope", { month: MONTH, now: NOW }), undefined);
});

test("DK1361: at 10,000 agents the dashboard page, the alerts and the export are produced from the records within the stated time (the dashboard page in 1 second, the whole export in 2; about 0.1 seconds each measured), and the guard check of a write is a lookup after one fold of the log", async () => {
  const { stored } = synthetic(10_000);
  assert.equal((stored as unknown[]).length > 20_000, true);
  const controls = new FleetControls();
  controls.setCap(FLEET, "acme", NOW, { credits: 100 });
  controls.freeze(FLEET, "acme", NOW, "did:web:example.com:agents:big-00010");
  const t0 = performance.now();
  const d = fleetDashboard(stored, FLEET, { month: MONTH, now: NOW, controls: controls.get(FLEET) })!;
  const page = performance.now() - t0;
  assert.equal(d.totals.members, 10_000);
  assert.equal(d.members.length, 100, "the response is one page, not 10,000 rows");
  assert.equal(d.totals.frozen, 1);
  assert.ok(d.alerts.some((a) => a.kind === "cap_reached"));
  assert.ok(JSON.stringify(d).length < 200_000, "the page of 100 is small");
  assert.ok(page < 1000, `the dashboard page took ${Math.round(page)} ms`);
  const t1 = performance.now();
  const csv = fleetCsv(stored, FLEET, { month: MONTH, now: NOW, controls: controls.get(FLEET) })!;
  const exp = performance.now() - t1;
  assert.equal(csv.trim().split("\n").length, 10_001);
  assert.ok(exp < 2000, `the export took ${Math.round(exp)} ms`);
  // the guard folds the 20,000 records once and then each check is a lookup
  const guard = fleetGuard({ controls, since: async (after, limit) => (stored as { seq: number }[]).filter((x) => x.seq > after).slice(0, limit) as never, now: () => NOW });
  const probe = (n: string) => ({ type: "asp.purchase/v0.2", issuer: `did:web:example.com:agents:big-${n}`, body: { amount: { value: 1 } } });
  const t2 = performance.now();
  const first = await guard({ tenant: { role: "tenant" }, method: "append", args: [probe("00010")] });
  const firstMs = performance.now() - t2;
  assert.match(first ?? "", /FLEET_FROZEN/);
  const t3 = performance.now();
  for (let i = 0; i < 1000; i++) await guard({ tenant: { role: "tenant" }, method: "append", args: [probe("00020")] });
  const perCheck = (performance.now() - t3) / 1000;
  assert.ok(firstMs < 2000 && perCheck < 5, `the first check took ${Math.round(firstMs)} ms and each after ${perCheck.toFixed(2)} ms`);
  console.log(`DK1361 timing at 10,000 agents: dashboard page ${Math.round(page)} ms, export ${Math.round(exp)} ms`);
});

test("DK1361: through the service: a frozen member's write over POST /rpc is refused as a policy error with the reason, another agent's write goes through, and unfreezing lets it through", async () => {
  const { createLogServer, hashToken } = await import("../../asp-log/src/index.ts");
  const { stored, dids } = synthetic(30);
  const controls = new FleetControls();
  const written: unknown[] = [];
  const handle = { log: {}, append: async (r: unknown) => { written.push(r); return { id: "r1", seq: written.length }; } };
  const guard = fleetGuard({ controls, since: async (after, limit) => (stored as { seq: number }[]).filter((x) => x.seq > after).slice(0, limit) as never, now: () => NOW });
  const server = createLogServer({ handle: handle as never, tenants: [{ name: "acme", role: "tenant", tokenSha256: hashToken("acme-token") }], guard });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const rpc = async (issuer: string) => (await (await fetch(`${base}/rpc`, { method: "POST", headers: { authorization: "Bearer acme-token", "content-type": "application/json" }, body: JSON.stringify({ target: "handle", method: "append", args: [{ type: "asp.purchase/v0.2", issuer, body: { amount: { value: 1 } } }] }) })).json()) as { ok: boolean; error?: { code: string; message: string } };
  controls.freeze(FLEET, "acme", NOW, dids[7]);
  const refused = await rpc(dids[7]);
  assert.deepEqual([refused.ok, refused.error?.code], [false, "POLICY"]);
  assert.match(refused.error?.message ?? "", /FLEET_FROZEN: .* is frozen by its organisation/);
  assert.equal(written.length, 0, "nothing was written");
  assert.equal((await rpc(dids[8])).ok, true);
  assert.equal((await rpc("did:web:example.com:agents:outsider")).ok, true);
  controls.unfreeze(FLEET, "acme", NOW, dids[7]);
  assert.equal((await rpc(dids[7])).ok, true);
  assert.equal(written.length, 3);
});

test("DK1361: the fleet tree: departments, teams and personas with their members and spend rolled up against each node's budget, a member's node and persona, and a frozen node freezing everyone under it", () => {
  const { stored, dids } = synthetic(400, true);
  const controls = new FleetControls();
  controls.freezeNode(FLEET, "acme", NOW, "dept-3", "an incident in one department");
  const d = fleetDashboard(stored, FLEET, { month: MONTH, now: NOW, controls: controls.get(FLEET), pageSize: 500 })!;
  const row = (n: string) => d.tree.find((t) => t.node === n)!;
  assert.equal(d.tree[0].node, "root");
  assert.equal(row("root").membersUnder, 400);
  assert.deepEqual([row("dept-1").depth, row("team-1").depth, row("coders").depth], [2, 3, 4], "the tree is shown depth first");
  assert.deepEqual(d.tree.slice(0, 3).map((t) => t.node), ["root", "dept-0", "team-0"], "a department is followed by its teams");
  assert.equal(row("team-0").membersHere + row("team-0").membersUnder > 0, true);
  assert.equal(row("coders").persona, "coder");
  assert.equal(row("dept-0").budget.credits, 30);
  assert.equal(row("dept-0").overBudget, true, "department 0 spent more than 30 credits this month");
  assert.ok(row("dept-0").credits > 30);
  assert.ok(d.alerts.some((a) => a.kind === "node_over_budget" && a.subject === "Department 0"), "an alert says a node is over its budget");
  assert.equal(row("root").credits, d.totals.credits, "the root's spend is the fleet's");
  const sumTeams = d.tree.filter((t) => t.kind === "team").reduce((n, t) => n + t.membersHere, 0) + row("coders").membersHere;
  assert.equal(sumTeams, 400, "every member sits at one node");
  const m0 = d.members.find((m) => m.did === dids[0])!;
  assert.deepEqual([m0.node, m0.persona === null], ["coders", true]);
  // a frozen node freezes everyone under it, teams included
  assert.equal(row("dept-3").frozen && row("team-3").frozen && row("team-13").frozen, true);
  assert.equal(row("dept-4").frozen, false);
  const frozenMembers = d.members.filter((m) => m.frozen).map((m) => m.node);
  assert.ok(frozenMembers.length > 0 && frozenMembers.every((n) => /^team-(3|13|23|33|43|53|63|73|83|93)$/.test(n) || n === "dept-3"), "only members under department 3");
  assert.ok(d.alerts.some((a) => a.kind === "node_frozen" && a.subject === "Department 3"));
  const csv = fleetCsv(stored, FLEET, { month: MONTH, now: NOW, controls: controls.get(FLEET) })!;
  assert.ok(csv.split("\n").some((l) => l.includes(",team-3,")), "the export carries each member's node");
});

test("DK1361: the guard refuses a write by a member under a frozen node and lets the rest through; the route freezes and unfreezes a node, and an unknown node is a 404", async () => {
  const { stored, dids } = synthetic(120, true);
  const controls = new FleetControls();
  const guard = fleetGuard({ controls, since: async (after, limit) => (stored as { seq: number }[]).filter((x) => x.seq > after).slice(0, limit) as never, now: () => NOW });
  const probe = (did: string) => ({ type: "asp.purchase/v0.2", issuer: did, body: { amount: { value: 1 } } });
  const ask = (did: string) => guard({ tenant: { role: "tenant" }, method: "append", args: [probe(did)] });
  // member i sits at team-(i % 100); team-3 is under dept-3
  assert.equal(await ask(dids[3]), undefined);
  controls.freezeNode(FLEET, "acme", NOW, "dept-3");
  assert.match((await ask(dids[3])) ?? "", /FLEET_FROZEN: the node dept-3 of the fleet Big is frozen/);
  assert.match((await ask(dids[13])) ?? "", /FLEET_FROZEN: the node dept-3/, "team-13 is under dept-3 too");
  assert.equal(await ask(dids[4]), undefined, "another department is not held");
  controls.unfreezeNode(FLEET, "acme", NOW, "dept-3");
  assert.equal(await ask(dids[3]), undefined);
  const routes = fleetDashboardRoutes({ stored: async () => stored, controls, owned: (t) => (t === "acme" ? [ORG] : []), now: () => NOW });
  const server = createServer(async (req, res) => { if (!(await routes(req, res, { tenant: { name: "acme", role: "tenant" } }))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("/fleet/Big/freeze", { node: "no-such-node" })).status, 404);
  const ok = (await (await post("/fleet/Big/freeze", { node: "team-5" })).json()) as { frozenNodes: string[] };
  assert.deepEqual(ok.frozenNodes, ["team-5"]);
  assert.match((await ask(dids[5])) ?? "", /node team-5/);
  assert.equal(await ask(dids[6]), undefined);
  await post("/fleet/Big/unfreeze", { node: "team-5" });
  assert.equal(await ask(dids[5]), undefined);
  const html = await (await fetch(`${base}/fleet/Big/dashboard`, { headers: { accept: "text/html" } })).text();
  assert.match(html, /<h2>Fleet tree<\/h2>/);
  assert.match(html, /<h2>First hour<\/h2>[\s\S]*of 7 done/, "the first-hour checklist is on the page (DK1371)");
  assert.match(html, /Department 0/);
  assert.match(html, /<th>Node<\/th>/);
  assert.ok(controls.get(FLEET).audit.some((a) => a.act === "freeze_node" && a.target === "team-5"), "a node freeze is in the audit trail");
});

test("DK1361: a tree of 10,000 members (10 departments, 100 teams, a persona) is built, rolled up and exported within the stated time", () => {
  const { stored } = synthetic(10_000, true);
  const t0 = performance.now();
  const d = fleetDashboard(stored, FLEET, { month: MONTH, now: NOW })!;
  const ms = performance.now() - t0;
  assert.equal(d.tree.length, 1 + 10 + 100 + 1);
  assert.equal(d.tree[0].membersUnder, 10_000);
  assert.equal(d.members.length, 100);
  assert.ok(ms < 1500, `the dashboard with its tree took ${Math.round(ms)} ms`);
  console.log(`DK1361 timing, tree of 10,000: ${Math.round(ms)} ms`);
});

test("DK1371: the first-hour checklist is on the dashboard, read from the log: what is done, and what to do next for what is not", () => {
  const { stored } = synthetic(5);
  const d = fleetDashboard(stored, "Big", { month: MONTH, now: NOW })!;
  const done = (step: RegExp) => d.firstHour.items.find((i) => step.test(i.step))!;
  assert.equal(done(/fleet is declared/).done, true);
  assert.equal(done(/first agent has joined/).done, true);
  assert.equal(done(/Mandate template/).done, false, "no template is in these records");
  assert.match(done(/Mandate template/).next, /asp fleet template set/);
  assert.equal(done(/spending cap/).done, false);
  assert.equal(done(/first job/).done, true, "the fleet spent this month");
  assert.equal(d.firstHour.of, 7);
  const withCap = fleetDashboard(stored, "Big", { month: MONTH, now: NOW, controls: { ...emptyControls(), caps: { fleet: { credits: 100 }, members: {} } } })!;
  assert.equal(withCap.firstHour.items.find((i) => /spending cap/.test(i.step))!.done, true);
  assert.equal(withCap.firstHour.done, d.firstHour.done + 1);
});
