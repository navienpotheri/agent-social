/**
 * The fleet HUD and its replay (register row DK1601): the data (groups, nodes, events in order, exact totals, sampling that keeps every flagged record, a window), at 10,000 members within a stated time; the routes (the shell holds no
 * data, the data route is for the owning tenant); and the browser script run against a stand-in browser: cards queued, active and done as the playhead moves, the log in words, the risk matrix, the scorecard, step, scrub, play and
 * reduced motion, a table of the records, and the token handling. Synthetic records; fake keys only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import vm from "node:vm";
import { FleetControls, fleetHud } from "../../asp-log/src/index.ts";
import { fleetDashboardRoutes, fleetLiveRoute } from "../../asp-package/src/fleet-dashboard-routes.ts";
import { renderFleetHud } from "../../asp-package/src/fleet-hud-page.ts";
import { HUD_CLIENT_SCRIPT } from "../../asp-package/src/fleet-hud-client.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const FLEET = "did:web:example.com:fleets:hud", ORG = "did:web:example.com:users:hud-org", NOW = "2026-11-20T12:30:00Z";
type Stored = { seq: number; id: string; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: Record<string, unknown> } };
const PERSONAS = ["reader", "writer", "reviewer"];

function records(n: number, perMember = 3): Stored[] {
  const out: Stored[] = [];
  let seq = 0;
  const push = (type: string, issuer: string, at: string, body: Record<string, unknown>, subject: string | null = null) => { seq++; const id = `sha256:${String(seq).padStart(64, "0")}`; out.push({ seq, id, record: { type: `asp.${type}/v0.2`, issuer, subject, issued_at: at, body } }); return id; };
  push("fleet", ORG, "2026-11-01T00:00:00Z", { did: FLEET, org: ORG, name: "Hud", purpose: "reads and writes", template: { runtime: "claude-code", model: "model-one" }, max_members: n + 10 }, FLEET);
  const dids: string[] = [];
  for (let i = 0; i < n; i++) { const did = `did:web:example.com:agents:hud-${String(i).padStart(5, "0")}`; dids.push(did); push("passport", ORG, "2026-11-02T08:00:00Z", { did, kind: "agent", sponsor: ORG, fleet: FLEET, tier: 1, persona: PERSONAS[i % 3], node: "root", shape: {}, keys: [] }, did); }
  dids.forEach((did, i) => { for (let k = 0; k < perMember; k++) { const at = `2026-11-20T${String(8 + k).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`; push("purchase", did, at, { service: "registry.name.claim", institution: "did:web:asp.local:registry", amount: { value: 2, unit: "credit" } }); push("action", did, at, { metrics: { tokens_in: 1000, tokens_out: 200 } }); } });
  const c = push("contract", "did:web:example.com:users:client", "2026-11-20T10:00:00Z", { principal: "did:web:example.com:users:client", performer: dids[0], price: { value: 40 } });
  push("settlement", "did:web:asp.local:bank", "2026-11-20T11:00:00Z", { contract: c, basis: "ruling", bond_slashed: { value: 3 } }, c);
  const c2 = push("contract", dids[1], "2026-11-20T09:00:00Z", { principal: dids[1], performer: dids[2], price: { value: 10 } });
  push("settlement", "did:web:asp.local:bank", "2026-11-20T09:30:00Z", { contract: c2, basis: "accepted", bond_slashed: { value: 0 } }, c2);
  push("clinic_diagnosis", "did:web:asp.local:clinic", "2026-11-20T12:00:00Z", { agent: dids[1], severity: "warn" }, dids[1]);
  return out;
}
const T = (s: string) => Date.parse(s);

test("DK1601 HUD: the groups are the personas, the events are in order with words, the totals are exact, related-party work and a slash are flagged", () => {
  const h = fleetHud(records(30) as never, "Hud", { from: T("2026-11-20T00:00:00Z"), to: T(NOW), now: NOW })!;
  assert.deepEqual(h.groups.map((g) => g.name).sort(), ["reader", "reviewer", "writer"]);
  assert.equal(h.totals.members, 30);
  assert.equal(h.totals.credits, 30 * 3 * 2);
  assert.equal(h.totals.tokens, 30 * 3 * 1200);
  assert.deepEqual([h.totals.slashes, h.totals.drift, h.totals.related, h.totals.jobsDone, h.totals.jobsTotal], [1, 1, 1, 1, 2]);
  assert.ok(h.events.every((e, i, a) => i === 0 || a[i - 1]!.t <= e.t), "in order");
  assert.ok(h.events.some((e) => e.f & 1 && /slashed 3 credits/.test(e.x)), "the slash in words");
  assert.ok(h.events.some((e) => e.f & 8 && /related/.test(e.x)));
  assert.ok(h.events.some((e) => e.f & 2 && /Clinic found drift/.test(e.x)));
  assert.equal(h.groups.filter((g) => g.flagged).length, 3 - h.groups.filter((g) => !g.flagged).length);
  assert.ok(h.nodes.some((n) => n.kind === "institution") && h.nodes.some((n) => n.kind === "outside") && h.nodes.some((n) => n.kind === "member"));
  assert.ok(h.events.every((e) => h.nodes[e.a] && h.nodes[e.b]), "every edge joins two nodes");
  assert.equal(h.sampled, false);
  assert.equal(h.spark.length, 24);
  assert.equal(h.rail.template, "claude-code / model-one");
});

test("DK1601 HUD: a window holds only its records, the replay of an earlier window differs from now, and an unknown fleet is undefined", () => {
  const stored = records(30) as never;
  const early = fleetHud(stored, "Hud", { from: T("2026-11-20T08:00:00Z"), to: T("2026-11-20T08:59:00Z"), now: NOW })!, all = fleetHud(stored, "Hud", { from: T("2026-11-20T00:00:00Z"), to: T(NOW), now: NOW })!;
  assert.ok(early.events.length > 0 && early.events.length < all.events.length);
  assert.ok(early.events.every((e) => e.t >= early.from && e.t <= early.to));
  assert.equal(early.totals.slashes, 0);
  assert.equal(fleetHud(stored, "Nope", { now: NOW }), undefined);
  assert.equal(fleetHud(stored, "Hud", { from: T("2026-10-01T00:00:00Z"), to: T("2026-10-02T00:00:00Z"), now: NOW })!.events.length, 0);
});

test("DK1601 HUD: a large window is sampled, the totals stay exact and every flagged record is kept", () => {
  const h = fleetHud(records(400, 4) as never, "Hud", { from: T("2026-11-20T00:00:00Z"), to: T(NOW), now: NOW, maxEvents: 200 })!;
  assert.equal(h.sampled, true);
  assert.ok(h.events.length <= 203, `kept ${h.events.length}`);
  assert.equal(h.totals.events, 400 * 4 * 2 + 3);
  assert.equal(h.totals.credits, 400 * 4 * 2);
  assert.ok(h.events.some((e) => e.f & 1) && h.events.some((e) => e.f & 2) && h.events.some((e) => e.f & 8), "slash, drift and related-party kept");
  assert.ok(h.events.every((e, i, a) => i === 0 || a[i - 1]!.t <= e.t));
});

test("DK1601 HUD: 10,000 members: the data for a day comes back within 3 seconds with a bounded size", () => {
  const stored = records(10_000, 2) as never;
  const t0 = performance.now();
  const h = fleetHud(stored, "Hud", { from: T("2026-11-20T00:00:00Z"), to: T(NOW), now: NOW })!;
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `took ${Math.round(ms)} ms`);
  assert.equal(h.totals.members, 10_000);
  assert.ok(h.events.length <= 1210 && h.nodes.length <= 1300, `${h.events.length} events, ${h.nodes.length} nodes`);
  assert.ok(JSON.stringify(h).length < 600_000, "bounded");
  assert.equal(h.totals.credits, 10_000 * 2 * 2);
});

test("DK1601 HUD: routes: the shell holds no data and escapes the name, the data is for the owning tenant, a bad window is refused", async () => {
  const stored = records(12) as never;
  const controls = new FleetControls();
  controls.setCap(FLEET, "hud-org", NOW, { credits: 100 });
  const dash = fleetDashboardRoutes({ stored: async () => stored, controls, owned: (t) => (t === "hud-org" ? [ORG] : []), now: () => NOW });
  const shell = fleetLiveRoute();
  const srv = createServer(async (rq, rs) => { if (await shell(rq, rs)) return; const tenant = String(rq.headers.authorization ?? "").includes("owner") ? { name: "hud-org" } : String(rq.headers.authorization ?? "").includes("other") ? { name: "other" } : { name: "none" }; if (!(await dash(rq, rs, { tenant }))) { rs.writeHead(404); rs.end(); } });
  servers.push(srv); await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const page = await fetch(`${base}/fleet/Hud/hud`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Fleet HUD/);
  assert.ok(!html.includes("did:web:example.com:agents"), "the shell holds no data");
  assert.ok(!/(src|href)="https?:/i.test(html), "no outside origin");
  assert.ok(!renderFleetHud(`x</script><script>alert(1)//`).includes("</script><script>alert"), "the name is escaped inside the script");
  assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
  const q = `from=${T("2026-11-20T00:00:00Z")}&to=${T(NOW)}`;
  assert.equal((await fetch(`${base}/fleet/Hud/hud-data?${q}`, { headers: { authorization: "Bearer none" } })).status, 403);
  assert.equal((await fetch(`${base}/fleet/Hud/hud-data?${q}`, { headers: { authorization: "Bearer other" } })).status, 403);
  const ok = await fetch(`${base}/fleet/Hud/hud-data?${q}`, { headers: { authorization: "Bearer owner" } });
  assert.equal(ok.status, 200);
  const j = (await ok.json()) as { ok: boolean; totals: { members: number; cap: { credits: number } } };
  assert.equal(j.totals.members, 12);
  assert.equal(j.totals.cap.credits, 100);
  const byRange = (await (await fetch(`${base}/fleet/Hud/hud-data?range=1h`, { headers: { authorization: "Bearer owner" } })).json()) as { from: number; to: number };
  assert.equal(byRange.to - byRange.from, 3_600_000, "a range with no times ends at the service clock");
  assert.equal((await fetch(`${base}/fleet/Hud/hud-data?from=5&to=2`, { headers: { authorization: "Bearer owner" } })).status, 400);
  assert.equal((await fetch(`${base}/fleet/Nope/hud-data`, { headers: { authorization: "Bearer owner" } })).status, 404);
  assert.equal((await fetch(`${base}/fleet/Hud/hud-data`, { method: "POST", headers: { authorization: "Bearer owner" } })).status, 405);
});

// ---- the browser script, against a stand-in browser
function fakeEl(id: string) {
  const l: Record<string, ((e?: unknown) => void)[]> = {};
  return { id, innerHTML: "", textContent: "", value: "", max: "", hidden: false, attrs: {} as Record<string, string>, l, addEventListener(t: string, f: (e?: unknown) => void) { (l[t] ??= []).push(f); }, setAttribute(k: string, v: string) { this.attrs[k] = v; }, getAttribute(k: string) { return this.attrs[k] ?? null; }, getBoundingClientRect: () => ({ width: 800, height: 300 }),
    getContext: () => ({ ops: 0, clearRect() { this.ops++; }, fillRect() { this.ops++; }, beginPath() {}, moveTo() {}, bezierCurveTo() { this.ops++; }, stroke() {}, set lineWidth(_: number) {}, set fillStyle(_: string) {}, set strokeStyle(_: string) {}, set globalAlpha(_: number) {} }) };
}
function browser(payload: unknown, o: { reduce?: boolean; hash?: string; fail?: number } = {}) {
  const ids = ["graph", "clock", "day", "scrub", "cards", "risk", "flagged", "score", "rail", "log", "tbl", "status", "scope", "play", "prev", "next", "m-live", "m-replay", "replaybar", "tok", "go"];
  const els: Record<string, ReturnType<typeof fakeEl>> = {}; for (const i of ids) els[i] = fakeEl(i);
  els.graph!.getContext = (() => { const c = fakeEl("c").getContext(); (els.graph as never as { ctx: unknown }).ctx = c; return c; }) as never;
  const btns = ["1h", "24h", "7d", "30d"].map((r) => { const e = fakeEl("r" + r); e.attrs["data-range"] = r; return e; });
  const speeds = [1, 2, 4, 8].map((s) => { const e = fakeEl("s" + s); e.attrs["data-speed"] = String(s); return e; });
  const fetched: { url: string; auth: string }[] = [];
  const frames: ((t: number) => void)[] = [];
  const ctx: Record<string, unknown> = {
    document: { getElementById: (i: string) => els[i], querySelectorAll: (s: string) => (s === "[data-range]" ? btns : s === "[data-speed]" ? speeds : []), documentElement: {}, addEventListener(t: string, f: (e?: unknown) => void) { (els as never as Record<string, unknown>)["doc:" + t] = f; } },
    getComputedStyle: () => ({ getPropertyValue: () => "" }), window: { addEventListener() {}, matchMedia: () => ({ matches: !!o.reduce }) },
    sessionStorage: (() => { const m: Record<string, string> = {}; return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; } }; })(),
    location: { hash: o.hash ?? "", pathname: "/fleet/Hud/hud", search: "" }, history: { replaceState(_a: unknown, _b: unknown, u: string) { (ctx.location as { hash: string }).hash = ""; void u; } },
    fetch: async (url: string, init: { headers: { authorization: string } }) => { fetched.push({ url, auth: init.headers.authorization }); return o.fail ? { ok: false, status: o.fail, json: async () => ({}) } : { ok: true, status: 200, json: async () => payload }; },
    requestAnimationFrame: (f: (t: number) => void) => { frames.push(f); return frames.length; }, setInterval: () => 1, clearInterval() {}, Date, Math, JSON, Array, Number, String, encodeURIComponent, decodeURIComponent, console,
  };
  ctx.window = Object.assign(ctx.window as object, ctx);
  vm.runInNewContext(HUD_CLIENT_SCRIPT.replace("__FLEET__", JSON.stringify("Hud")), ctx);
  const fire = (id: string, t = "click", e?: unknown) => { for (const f of els[id]!.l[t] ?? []) f(e); };
  const tick = async () => { await new Promise((r) => setTimeout(r, 5)); };
  return { els, btns, speeds, fetched, frames, ctx, fire, tick };
}

test("DK1601 HUD client: a token starts it; cards go queued, active, done as the playhead moves; log, risk matrix, scorecard and table follow", async () => {
  const D = fleetHud(records(12) as never, "Hud", { from: T("2026-11-20T00:00:00Z"), to: T(NOW), now: NOW })!;
  const b = browser(D);
  assert.match(b.els.status!.textContent, /Enter your token/);
  b.els.tok!.value = "owner-token"; b.fire("go"); await b.tick();
  assert.equal(b.fetched.length, 1);
  assert.match(b.fetched[0]!.url, /^\/fleet\/Hud\/hud-data\?range=24h&pace=replay$/);
  assert.equal(b.fetched[0]!.auth, "Bearer owner-token");
  assert.equal(b.els.tok!.value, "", "the token field is cleared");
  const hud = (b.ctx.window as { __hud: { state: { P: number; D: { to: number; from: number } }; step: (d: number) => void; render: () => void } }).__hud;
  assert.equal(hud.state.P, hud.state.D.from, "replay starts at the beginning");
  assert.match(b.els.cards!.innerHTML, /queued/i);
  assert.match(b.els.rail!.innerHTML, /reads and writes/);
  assert.match(b.els.rail!.innerHTML, /claude-code \/ model-one/);
  hud.step(1);
  assert.ok(hud.state.P > hud.state.D.from);
  assert.notEqual(b.els.clock!.textContent, "--:--:--");
  b.els.scrub!.value = String(hud.state.D.to - hud.state.D.from); b.fire("scrub", "input", {});
  assert.equal(hud.state.P, hud.state.D.to);
  assert.match(b.els.cards!.innerHTML, /DONE|ACTIVE/);
  assert.match(b.els.cards!.innerHTML, /<h3>reader<small>4 agents<\/small>/);
  assert.match(b.els.log!.innerHTML, /was slashed 3 credits/);
  assert.match(b.els.log!.innerHTML, /Clinic found drift/);
  assert.match(b.els.risk!.innerHTML, /<th scope="row">/);
  assert.match(b.els.flagged!.textContent, /\d of 3 flagged/);
  assert.match(b.els.score!.innerHTML, /jobs done/);
  assert.match(b.els.score!.innerHTML, /1 \/ 2|2 \/ 2/);
  assert.match(b.els.tbl!.innerHTML, /<td>spend<\/td>/);
  assert.ok(((b.els.graph as never as { ctx: { ops: number } }).ctx.ops) > 0, "the graph drew");
  hud.step(-1);
  assert.ok(hud.state.P < hud.state.D.to);
});

test("DK1601 HUD client: play advances the playhead on frames and stops at the end; speed and range buttons; live mode follows the present; the keyboard", async () => {
  const D = fleetHud(records(12) as never, "Hud", { from: T("2026-11-20T00:00:00Z"), to: T(NOW), now: NOW })!;
  const b = browser(D, { hash: "#t=fromhash" });
  await b.tick();
  assert.equal(b.fetched[0]!.auth, "Bearer fromhash", "the token in the address fragment is used");
  assert.equal((b.ctx.location as { hash: string }).hash, "", "and removed from the address");
  const hud = (b.ctx.window as { __hud: { state: { P: number; playing: boolean; speed: number; D: { from: number; to: number } }; play: () => void } }).__hud;
  b.fire("play");
  assert.equal(hud.state.playing, true);
  assert.equal(b.els.play!.attrs["aria-pressed"], "true");
  b.speeds[2]!.l.click![0]!();
  assert.equal(hud.state.speed, 4);
  const p0 = hud.state.P;
  const f1 = b.frames.shift()!; f1(1000); const f2 = b.frames.shift()!; f2(2000);
  assert.ok(hud.state.P > p0, "the playhead moved with the frames");
  for (let t = 3000; t < 200_000 && hud.state.playing; t += 1000) { const f = b.frames.shift(); if (!f) break; f(t); }
  assert.equal(hud.state.playing, false, "it stops at the end of the window");
  assert.equal(hud.state.P, hud.state.D.to);
  b.btns[0]!.l.click![0]!();
  await b.tick();
  assert.match(b.fetched.at(-1)!.url, /range=1h/, "the 1h window");
  b.els["m-live"]!.l.click![0]!(); await b.tick();
  assert.equal(b.els.replaybar!.hidden, true, "no replay bar in live mode");
  assert.match(b.els.status!.textContent, /^LIVE/);
  b.els["m-replay"]!.l.click![0]!(); await b.tick();
  assert.equal(b.els.replaybar!.hidden, false);
});

test("DK1601 HUD client: reduced motion plays as one step to the end; a refused token says so; a name with markup is escaped", async () => {
  const D = fleetHud(records(12) as never, "Hud", { from: T("2026-11-20T00:00:00Z"), to: T(NOW), now: NOW })!;
  const b = browser({ ...D, groups: D.groups.map((g, i) => (i === 0 ? { ...g, name: "<img src=x onerror=alert(1)>" } : g)) }, { reduce: true, hash: "#t=tok" });
  await b.tick();
  const hud = (b.ctx.window as { __hud: { state: { P: number; D: { to: number } }; play: () => void } }).__hud;
  hud.play();
  assert.equal(hud.state.P, hud.state.D.to, "reduced motion: no animation, straight to the end");
  assert.ok(!b.els.cards!.innerHTML.includes("<img"), "the group name is escaped");
  assert.match(b.els.cards!.innerHTML, /&lt;img/);
  const bad = browser(D, { hash: "#t=tok", fail: 403 });
  await bad.tick();
  assert.match(bad.els.status!.textContent, /token was not accepted/);
});
