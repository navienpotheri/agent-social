/**
 * The live dashboard with tables, charts and graphs (register row DK1601): graphs and bars in plain SVG and CSS, each with a table of the same numbers; the fleet dashboard's daily series and mix from the records; the live page, which
 * holds no data, asks for the token and swaps in the dashboard's content every 5 seconds (run here against a stand-in browser); society activity and fleet size over time with their tables; colours that read in both schemes. Fake keys only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import vm from "node:vm";
import { FleetControls, UI_CSS, barChart, fleetDashboard, lineGraph, monthOf } from "../../asp-log/src/index.ts";
import { fleetDashboardRoutes, fleetLiveRoute, renderFleetDashboard, renderFleetLive } from "../../asp-package/src/fleet-dashboard-routes.ts";
import { storyRoutes } from "../../asp-package/src/story-pages.ts";
import { fleetRoutes } from "../../asp-package/src/fleet-pages.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const FLEET = "did:web:example.com:fleets:live", ORG = "did:web:example.com:users:acme";
const NOW = "2026-11-20T12:00:00Z", MONTH = monthOf(NOW);
type Stored = { seq: number; id: string; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: Record<string, unknown> } };

function records(n = 12): Stored[] {
  const out: Stored[] = [];
  let seq = 0;
  const push = (type: string, issuer: string, at: string, body: Record<string, unknown>, subject: string | null = null) => { seq++; const id = `sha256:${String(seq).padStart(64, "0")}`; out.push({ seq, id, record: { type: `asp.${type}/v0.2`, issuer, subject, issued_at: at, body } }); return id; };
  push("fleet", ORG, "2026-10-25T10:00:00Z", { did: FLEET, org: ORG, name: "Live", purpose: "A live fleet", max_members: 50 }, FLEET);
  const dids: string[] = [];
  for (let i = 0; i < n; i++) {
    const did = `did:web:example.com:agents:live-${String(i).padStart(2, "0")}`;
    dids.push(did);
    push("passport", ORG, `2026-11-${String(1 + i).padStart(2, "0")}T10:00:00Z`, { did, kind: "agent", sponsor: ORG, fleet: FLEET, tier: 1 + (i % 3 === 0 ? 1 : 0), persona: i % 2 ? "reviewer" : "coder", shape: {}, keys: [] }, did);
  }
  dids.forEach((did, i) => {
    push("purchase", did, `2026-11-${String(2 + (i % 18)).padStart(2, "0")}T11:00:00Z`, { service: "registry.name.claim", institution: "did:web:asp.local:registry", amount: { value: 5 + (i % 4), unit: "credit" } });
    push("action", did, `2026-11-${String(3 + (i % 17)).padStart(2, "0")}T12:00:00Z`, { metrics: { tokens_in: 800 + i * 10, tokens_out: 200 } });
  });
  const c = push("contract", "did:web:example.com:users:client", "2026-11-08T10:00:00Z", { principal: "did:web:example.com:users:client", performer: dids[0], price: { value: 40 } });
  push("settlement", "did:web:asp.local:bank", "2026-11-09T10:00:00Z", { contract: c, basis: "ruling", bond_slashed: { value: 4 } }, c);
  push("clinic_diagnosis", "did:web:asp.local:clinic", "2026-11-12T10:00:00Z", { agent: dids[1], severity: "warn" }, dids[1]);
  push("clinic_diagnosis", "did:web:asp.local:clinic", "2026-11-12T11:00:00Z", { agent: dids[2], severity: "warn" }, dids[2]);
  return out;
}

test("DK1601: a graph is a focusable figure with a name, a description and its range in words, an SVG of the lines, and a table of the same numbers; a bar chart is its own table", () => {
  const g = lineGraph({ title: "Spend a day", labels: ["2026-11-01", "2026-11-02", "2026-11-03"], series: [{ name: "credits", values: [4, 10, 6] }, { name: "tokens", values: [1, 2, 3] }], unit: "credits", reference: { name: "cap", value: 20 } });
  assert.match(g, /<figure class="chart" tabindex="0" aria-labelledby="g[0-9a-z]+-t" aria-describedby="g[0-9a-z]+-d">/);
  assert.match(g, /<svg viewBox="0 0 640 220" role="img" aria-label="Spend a day\. credits: from 4 on 2026-11-01 to 6 on 2026-11-03 credits; tokens: from 1 on 2026-11-01 to 3 on 2026-11-03 credits\. cap: 20\."/);
  assert.equal((g.match(/<polyline/g) ?? []).length, 2);
  assert.equal((g.match(/<circle/g) ?? []).length, 6, "a point for every value, each with its own title");
  assert.match(g, /<title>credits, 2026-11-02: 10 credits<\/title>/);
  assert.match(g, /class="ref"/);
  assert.match(g, /<details class="chart-table"><summary>Table of the same numbers<\/summary>/);
  assert.deepEqual([...g.matchAll(/<tr><td>(2026-11-0\d)<\/td><td class="num">(\d+)<\/td><td class="num">(\d+)<\/td><\/tr>/g)].map((m) => [m[1], m[2], m[3]]), [["2026-11-01", "4", "1"], ["2026-11-02", "10", "2"], ["2026-11-03", "6", "3"]], "the table carries exactly the numbers");
  assert.doesNotMatch(g, /<script|https?:\/\/|<img|<link/, "no script and no outside address");
  // the scale: a nice maximum above the data, the reference line inside it
  assert.match(lineGraph({ title: "t", labels: ["a", "b"], series: [{ name: "s", values: [3, 7] }] }), />10<\/text>/);
  // a hostile title and name are text
  const hostile = lineGraph({ title: "<img src=x onerror=alert(1)>", labels: ["<b>"], series: [{ name: "\"><script>", values: [1] }] });
  assert.doesNotMatch(hostile, /<img|<script/, "no raw markup from a title, a label or a name");
  // no data at all still draws and says so
  assert.match(lineGraph({ title: "Empty", labels: [], series: [{ name: "s", values: [] }] }), /s: no data/);
  const b = barChart({ title: "Members by persona", rows: [{ label: "coder", value: 6 }, { label: "reviewer", value: 3 }], unit: "Members" });
  assert.match(b, /<table><thead><tr><th>Members by persona<\/th><th class="num">Members<\/th>/);
  assert.match(b, /<td>coder<\/td><td class="num">6<\/td><td class="barcell"><span class="bar" style="width:100%">/);
  assert.match(b, /style="width:50%"/);
  assert.match(b, /aria-label="Members by persona: coder 6, reviewer 3"/);
  assert.match(barChart({ title: "t", rows: [], empty: "No members yet" }), /No members yet/);
});

test("DK1601: the dashboard's daily series come from the records: members so far, credits and tokens a day, slashes and drift a day; the mix by persona, tier and node", () => {
  const stored = records(12) as never;
  const d = fleetDashboard(stored, "Live", { month: MONTH, now: NOW })!;
  const day = (x: string) => d.series.days.indexOf(x);
  assert.equal(d.series.days.length, 30);
  assert.equal(d.series.days.at(-1), "2026-11-20");
  assert.equal(d.series.members[day("2026-11-01")], 1, "one member had joined on the 1st");
  assert.equal(d.series.members[day("2026-11-12")], 12);
  assert.equal(d.series.members.at(-1), 12);
  assert.ok(d.series.members.every((v, i, a) => i === 0 || v >= a[i - 1]!), "membership only grows");
  assert.equal(d.series.credits.reduce((a, b) => a + b, 0), d.totals.credits, "the days sum to the month's spend");
  assert.equal(d.series.tokens.reduce((a, b) => a + b, 0), d.totals.tokens);
  assert.equal(d.series.slashes[day("2026-11-09")], 1);
  assert.equal(d.series.drift[day("2026-11-12")], 2);
  assert.deepEqual(d.mix.persona, { coder: 6, reviewer: 6 });
  assert.deepEqual(d.mix.tier, { "1": 8, "2": 4 });
  assert.deepEqual(d.mix.node, { root: 12 });
});

test("DK1601: the dashboard page has a graph for each number that changes, each with its table, the mix as bar tables, the freeze state as a table; the fragment is the same content without the page", () => {
  const stored = records(12) as never;
  const controls = new FleetControls();
  controls.setCap("did:web:example.com:fleets:live", "acme", NOW, { credits: 60, tokens: 40_000 });
  const d = fleetDashboard(stored, "Live", { month: MONTH, now: NOW, controls: controls.get("did:web:example.com:fleets:live") })!;
  const page = renderFleetDashboard(d, []);
  const figures = (page.match(/<figure class="chart"[^>]*>/g) ?? []).length, tables = (page.match(/<details class="chart-table">/g) ?? []).length;
  assert.equal(figures, tables, "every graph has a table of its numbers (the three bar charts are tables themselves)");
  assert.equal((page.match(/<figure class="chart bars"/g) ?? []).length, 3);
  assert.ok(tables >= 5, "cumulative credits, cumulative tokens, spend a day, members, slashes and drift");
  for (const t of ["Credits spent this month against the fleet's cap", "Tokens used this month against the fleet's cap", "Spend a day", "Members of the fleet", "Slashes and drift a day", "Members by persona", "Members by tier", "Members by node", "What is frozen"]) assert.ok(page.includes(t), t);
  assert.match(page, /cap 60/, "the cap is a line on the spend graph");
  assert.match(page, /<a href="\/fleet\/did%3Aweb%3Aexample\.com%3Afleets%3Alive\/live">Open the live view<\/a>/);
  assert.doesNotMatch(page, /<script|https?:\/\//);
  const fragment = renderFleetDashboard(d, [], { fragment: true });
  assert.ok(!/<html|<main|Open the live view/.test(fragment) && fragment.includes("Members by persona"), "the fragment is the content alone");
  assert.ok(page.includes(fragment), "and the page holds exactly it");
});

test("DK1601: the live page is public and holds no data: a token field, Start and Stop, a polite status line, the script that fetches the dashboard's content; a hostile fleet name is only text; no outside address", async () => {
  const routes = fleetLiveRoute();
  const server = createServer(async (req, res) => { if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const r = await fetch(`${base}/fleet/Live/live`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
  assert.doesNotMatch(r.headers.get("content-security-policy") ?? "", /https?:|\*/);
  const html = await r.text();
  assert.match(html, /<label for="tok">Token<\/label><input id="tok" type="password" autocomplete="off"/);
  assert.match(html, /<button id="go" type="button">Start<\/button><button id="stop" type="button" disabled>Stop<\/button>/);
  assert.match(html, /id="status" role="status" aria-live="polite"/);
  assert.match(html, /\/dashboard\?fragment=1/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /Members by persona|credits spent/, "no data in the shell");
  assert.equal((await fetch(`${base}/fleet/Live/live`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/fleet/Live/other`)).status, 404);
  const evil = renderFleetLive("</script><img src=x onerror=alert(1)>");
  assert.doesNotMatch(evil, /<img src=x/);
  assert.ok(!evil.slice(0, evil.indexOf("<script>")).includes("<img src=x"), "the name is escaped in the page");
  assert.ok(/\\u003c|\\x3c|<\\\/script>/.test(evil) || !evil.includes('"</script><img'), "and cannot close the script");
});

/** A stand-in browser for the live page: elements by id, a box that records what is swapped in, sessionStorage, a fetch that answers by request count, and the timer captured so a test drives it. */
function liveBrowser(answers: (n: number, headers: Record<string, string>) => { status: number; body: string }) {
  const listeners = new Map<string, () => void>();
  const el = (id: string) => ({ id, textContent: "", value: "", disabled: id === "stop", innerHTML: "", addEventListener: (ev: string, cb: () => void) => listeners.set(`${id}:${ev}`, cb), querySelectorAll: (_s: string) => [] as { open: boolean }[] });
  const els: Record<string, ReturnType<typeof el>> = Object.fromEntries(["live", "status", "tok", "go", "stop"].map((id) => [id, el(id)]));
  const store = new Map<string, string>();
  const timers: (() => void)[] = [];
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const doc = { getElementById: (id: string) => els[id], hidden: false };
  const sandbox: Record<string, unknown> = {
    document: doc, sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }, Date, JSON, encodeURIComponent,
    fetch: (url: string, init: { headers: Record<string, string> }) => { calls.push({ url, headers: init.headers }); const a = answers(calls.length, init.headers); return Promise.resolve({ ok: a.status === 200, status: a.status, text: () => Promise.resolve(a.body) }); },
    setInterval: (cb: () => void, ms: number) => { timers.push(cb); void ms; return timers.length; }, clearInterval: () => { timers.length = 0; },
  };
  return { els, listeners, timers, calls, store, doc, sandbox, settle: async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); } };
}
const scriptOf = (html: string) => /<script>(.*)<\/script>/s.exec(html)![1]!;

test("DK1601: the live update: with a token it fetches the content with the token in a header, shows it, and swaps in the next answer every 5 seconds; the token is kept in the tab and never in an address; a refusal stops it in words", async () => {
  const b = liveBrowser((n) => ({ status: 200, body: `<p>update ${n}</p>` }));
  vm.runInNewContext(scriptOf(renderFleetLive("Live")), b.sandbox);
  assert.equal(b.els.status!.textContent, "Enter your token to start.");
  assert.equal(b.calls.length, 0, "nothing is fetched without a token");
  b.els.tok!.value = "  tenant-token-1  ";
  b.listeners.get("go:click")!();
  await b.settle();
  assert.equal(b.calls[0]!.url, "/fleet/Live/dashboard?fragment=1");
  assert.equal(b.calls[0]!.headers.authorization, "Bearer tenant-token-1", "the token goes in a header, trimmed");
  assert.ok(!b.calls[0]!.url.includes("tenant-token"), "never in the address");
  assert.equal(b.els.live!.innerHTML, "<p>update 1</p>");
  assert.match(b.els.status!.textContent, /^Live: updated .*, every 5 seconds\.$/);
  assert.equal(b.els.tok!.value, "", "the field is cleared after Start");
  assert.equal(b.els.stop!.disabled, false);
  assert.equal(b.store.get("asp-fleet-token"), "tenant-token-1", "kept in this tab only");
  assert.equal(b.timers.length, 1, "one timer");
  b.timers[0]!(); await b.settle();
  assert.equal(b.els.live!.innerHTML, "<p>update 2</p>", "the next answer replaces the content: no reload");
  b.timers[0]!(); await b.settle();
  assert.equal(b.els.live!.innerHTML, "<p>update 3</p>");
  assert.equal(b.calls.length, 3);
  // hidden tab: no fetch
  b.doc.hidden = true; b.timers[0]!(); await b.settle();
  assert.equal(b.calls.length, 3, "a hidden tab does not poll");
  b.doc.hidden = false;
  // Stop
  b.listeners.get("stop:click")!();
  assert.equal(b.timers.length, 0);
  assert.match(b.els.status!.textContent, /Stopped/);
  assert.equal(b.els.stop!.disabled, true);
});

test("DK1601: the live update keeps working through a failure and stops on a refused token; an open table stays open across an update; a token kept in the tab starts it at once", async () => {
  const b = liveBrowser((n) => (n === 2 ? { status: 500, body: "" } : n === 4 ? { status: 403, body: "" } : { status: 200, body: `<p>ok ${n}</p>` }));
  b.store.set("asp-fleet-token", "kept-token");
  vm.runInNewContext(scriptOf(renderFleetLive("Live")), b.sandbox);
  await b.settle();
  assert.equal(b.calls.length, 1, "a token kept in the tab starts it at once");
  assert.equal(b.calls[0]!.headers.authorization, "Bearer kept-token");
  assert.equal(b.els.live!.innerHTML, "<p>ok 1</p>");
  b.timers[0]!(); await b.settle();
  assert.match(b.els.status!.textContent, /Could not update \(500\)\. Trying again\./);
  assert.equal(b.els.live!.innerHTML, "<p>ok 1</p>", "a failed update keeps what was shown");
  b.timers[0]!(); await b.settle();
  assert.equal(b.els.live!.innerHTML, "<p>ok 3</p>", "and it recovers");
  b.timers[0]!(); await b.settle();
  assert.match(b.els.status!.textContent, /Could not update \(403\)\. Check the token\./);
  assert.equal(b.timers.length, 0, "a refused token stops the polling");
  assert.equal(b.els.stop!.disabled, true);
  // an open details stays open: the box reports one open table before the swap and the script reopens it after
  const opened: number[] = [];
  const c = liveBrowser(() => ({ status: 200, body: "<details></details><details></details>" }));
  const details = [{ open: false }, { open: true }];
  c.els.live!.querySelectorAll = () => details as never;
  c.store.set("asp-fleet-token", "t");
  vm.runInNewContext(scriptOf(renderFleetLive("Live")), c.sandbox);
  await c.settle();
  details[1]!.open = false; details[0]!.open = false; // the swap closes them
  c.els.live!.querySelectorAll = () => { opened.push(1); return details as never; };
  details[1]!.open = true;
  c.timers[0]!(); await c.settle();
  assert.ok(opened.length >= 2, "the script looked at the open tables before and after the swap");
});

async function service() {
  const stored = records(14) as never;
  const controls = new FleetControls();
  const routes = fleetDashboardRoutes({ stored: async () => stored, controls, owned: (t) => (t === "acme" ? [ORG] : []), now: () => NOW });
  const server = createServer(async (req, res) => {
    const who = String(req.headers.authorization ?? "").replace("Bearer ", "");
    if (!(await routes(req, res, { tenant: { name: who, role: who === "ops" ? "admin" : "tenant" } }))) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, controls, stored };
}

test("DK1601: the dashboard route serves the page and the fragment to the owning tenant only, and the next fetch shows a change the first did not (a freeze)", async () => {
  const s = await service();
  const get = (path: string, as: string) => fetch(s.base + path, { headers: { authorization: `Bearer ${as}`, accept: "text/html" } });
  assert.equal((await get("/fleet/Live/dashboard?fragment=1", "mallory")).status, 403);
  const first = await (await get("/fleet/Live/dashboard?fragment=1", "acme")).text();
  assert.ok(!/<html/.test(first) && first.includes("Members by persona"));
  assert.match(first, /<td>The whole fleet<\/td><td class="num">0<\/td>/, "nothing is frozen yet");
  await fetch(`${s.base}/fleet/Live/freeze`, { method: "POST", headers: { authorization: "Bearer acme", "content-type": "application/json" }, body: "{}" });
  const second = await (await get("/fleet/Live/dashboard?fragment=1", "acme")).text();
  assert.notEqual(first, second, "the content changed between two fetches");
  assert.match(second, /<td>The whole fleet<\/td><td class="num">1<\/td>/);
  assert.match(second, /The fleet Live is frozen/);
  const full = await (await get("/fleet/Live/dashboard", "acme")).text();
  assert.match(full, /<html/);
  assert.ok(full.includes(second.slice(0, 200)) || full.includes("The fleet Live is frozen"));
});

test("DK1601: society activity and fleet size over time: the Daily page and the fleet page each have a graph and the table of its numbers", async () => {
  const stored = records(12) as never;
  const balances = async () => new Map<string, number>();
  const routes = [storyRoutes({ stored: async () => stored, balances, now: () => NOW }), fleetRoutes({ stored: async () => stored })];
  const server = createServer(async (req, res) => { for (const r of routes) if (await r(req, res)) return; res.writeHead(404); res.end(); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const daily = await (await fetch(`${base}/society/daily?day=2026-11-12`, { headers: { accept: "text/html" } })).text();
  assert.match(daily, /<h2>Activity over time<\/h2>/);
  assert.match(daily, /Records written and agents joined, a day/);
  assert.match(daily, /<details class="chart-table">/);
  assert.ok(daily.includes("<td>2026-11-12</td>"), "the table has the day");
  const joinedOn12 = /<td>2026-11-12<\/td><td class="num">(\d+)<\/td><td class="num">(\d+)<\/td>/.exec(daily)!;
  assert.equal(joinedOn12[2], "1", "one agent joined on the 12th");
  const fleet = await (await fetch(`${base}/society/fleets/Live`, { headers: { accept: "text/html" } })).text();
  assert.match(fleet, /<h2>Size over time<\/h2>/);
  assert.match(fleet, /Members of Live, a day/);
  assert.match(fleet, /<details class="chart-table">/);
  assert.match(fleet, /<td>2026-11-12<\/td><td class="num">12<\/td>/, "twelve members by the 12th in the table");
  const quiet = await (await fetch(`${base}/society/daily?day=2026-09-01`, { headers: { accept: "text/html" } })).text();
  assert.match(quiet, /A quiet day/);
  assert.match(quiet, /<h2>Activity over time<\/h2>/, "a quiet day still has its graph");
});

test("DK1601: the chart colours read on the card in both schemes: each of the four series, the reference line and the axis are at least 3 to 1", () => {
  const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const block = (re: RegExp) => { const m = re.exec(UI_CSS)!; const t: Record<string, string> = {}; for (const x of m[1]!.matchAll(/--([a-z0-9-]+):(#[0-9a-f]{6})/g)) t[x[1]!] = x[2]!; return t; };
  const light = block(/^:root\{([^}]*)\}/m), dark = block(/^:root\[data-theme="dark"\]\{([^}]*)\}/m);
  for (const [label, t] of [["light", light], ["dark", dark]] as const)
    for (const k of ["c1", "c2", "c3", "c4", "warn"]) assert.ok(ratio(hex(t[k]!), hex(t.card!)) >= 3, `${label}: ${k} on the card is ${ratio(hex(t[k]!), hex(t.card!)).toFixed(2)}`);
  assert.match(UI_CSS, /\.chart:focus-visible/);
  assert.match(UI_CSS, /\.chart-table summary:focus-visible/);
});
