/**
 * The fleet dashboard routes (register row DK1361), for the tenant that owns the fleet's organisation (or an operator); everyone else gets 403:
 *   GET  /fleet/<fleet>/dashboard[?page=&size=]   the dashboard (HTML for a browser, JSON with `?format=json` or `Accept: application/json`)
 *   GET  /fleet/<fleet>/export[?format=csv|json]  every member, for the organisation's own tools
 *   POST /fleet/<fleet>/freeze | /unfreeze        { member?: <did> | node?: <node> }  the whole fleet, one member, or a node of the tree and everyone under it
 *   POST /fleet/<fleet>/caps                      { member?: <did>, credits?: n, tokens?: n }  a monthly cap (an empty body removes it)
 * `<fleet>` is the fleet's DID or its name. Every change is kept with who made it and when (the audit trail on the dashboard). The guard `fleetGuard` (asp-log) is what refuses a write past a cap or from a frozen member.
 * Roles within an organisation (DK1359) and the fleet tree (DK1372) are not built yet: one role, the owning tenant. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { fleetEvents, fleetHud, fleetLive, LIVE_RANGES, type LiveRange, barChart, emptyState, fleetBadge, fleetCsv, lineGraph, fleetDashboard, fleetDirectory, findFleet, hero, monthOf, shell, shortNameHtml, uiEsc, type FleetControls, type FleetDashboard, type StoredRec } from "@agent-social/asp-log";

import { LIVE_CLIENT_SCRIPT } from "./fleet-live-client.ts";
import { renderFleetHud } from "./fleet-hud-page.ts";

export interface FleetDashboardSource {
  stored: () => Promise<StoredRec[]>;
  controls: FleetControls;
  /** The identities a tenant has written as (the organisation's DID is among them for the tenant that declared the fleet). */
  owned: (tenant: string) => string[];
  now: () => string;
}

/** The dashboard's content: tables, charts and graphs (DK1601). Every chart and graph has its table next to it. `fragment` is the content alone, for the live page to swap in. */
export function renderFleetDashboard(d: FleetDashboard, audit: { at: string; by: string; act: string; target?: string; detail?: string }[] = [], o: { fragment?: boolean } = {}): string {
  const esc = uiEsc;
  const rows = d.members.map((m) => `<tr><td><a href="${esc(m.journey)}">${shortNameHtml(m.name)}</a>${m.frozen ? ` <span class="badge">frozen</span>` : ""}</td><td>${esc(m.node)}${m.persona ? ` <small>(${esc(m.persona)})</small>` : ""}</td><td class="num">${m.tier ?? "&ndash;"}</td><td class="num">${m.slashes}</td><td class="num">${m.drift === 0 ? "0" : m.drift === 1 ? "1 (warn)" : "2 (quarantine advised)"}</td><td class="num">${m.credits}${m.capCredits !== null ? ` / ${m.capCredits}` : ""}</td><td class="num">${m.tokens}${m.capTokens !== null ? ` / ${m.capTokens}` : ""}</td></tr>`).join("");
  const alerts = d.alerts.map((a) => `<li class="al-${a.level}"><b>${esc(a.level)}</b> ${esc(a.text)}</li>`).join("");
  const nav = d.page.pages > 1 ? `<p class="mut">Page ${d.page.number} of ${d.page.pages}${d.page.number > 1 ? ` &middot; <a href="?page=${d.page.number - 1}&amp;size=${d.page.size}">previous</a>` : ""}${d.page.number < d.page.pages ? ` &middot; <a href="?page=${d.page.number + 1}&amp;size=${d.page.size}">next</a>` : ""}</p>` : "";
  const sr = d.series;
  // this month's spend so far, cumulative, against the fleet's cap
  let run = 0, runT = 0;
  const monthDays = sr.days.filter((x) => x.slice(0, 7) === d.month);
  const cumCredits = sr.days.map((x, i) => (x.slice(0, 7) === d.month ? (run += sr.credits[i]!) : 0)).filter((_, i) => sr.days[i]!.slice(0, 7) === d.month);
  const cumTokens = sr.days.map((x, i) => (x.slice(0, 7) === d.month ? (runT += sr.tokens[i]!) : 0)).filter((_, i) => sr.days[i]!.slice(0, 7) === d.month);
  const mixRows = (m: Record<string, number>) => Object.entries(m).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([label, value]) => ({ label, value }));
  const frozenTable = `<div class="table-wrap"><table><thead><tr><th>What is frozen</th><th class="num">Count</th></tr></thead><tbody><tr><td>The whole fleet</td><td class="num">${d.controls.frozen ? 1 : 0}</td></tr><tr><td>Nodes of the tree</td><td class="num">${d.tree.filter((t) => t.frozen && t.node !== "root").length}</td></tr><tr><td>Members (in all)</td><td class="num">${d.totals.frozen}</td></tr></tbody></table></div>`;
  const tree = d.tree.length > 1 ? `<div class="table-wrap"><table><thead><tr><th>Node</th><th>Kind</th><th class="num">Members</th><th class="num">Credits / budget</th><th class="num">Tokens / budget</th></tr></thead><tbody>${d.tree.map((t) => `<tr><td style="padding-left:${0.75 + (t.depth - 1) * 1.25}rem">${esc(t.name)}${t.persona ? ` <small>(${esc(t.persona)})</small>` : ""}${t.frozen ? ` <span class="badge">frozen</span>` : ""}</td><td>${esc(t.kind)}</td><td class="num">${t.membersHere}${t.membersUnder !== t.membersHere ? ` (${t.membersUnder} under)` : ""}</td><td class="num">${t.credits}${t.budget.credits !== null ? ` / ${t.budget.credits}` : ""}${t.overBudget ? " !" : ""}</td><td class="num">${t.tokens}${t.budget.tokens !== null ? ` / ${t.budget.tokens}` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="note"><p>The organisation has declared no departments, teams or personas: every member sits at the root.</p></div>`;
  const content = hero({ kicker: "Fleet dashboard (private to its organisation)", title: d.fleet.name, badges: [d.controls.frozen ? "frozen" : "running", d.month], sub: d.fleet.purpose,
      tiles: [{ label: "members", value: d.totals.members }, { label: "credits spent this month", value: d.totals.credits }, { label: "tokens this month", value: d.totals.tokens }, { label: "frozen", value: d.totals.frozen }, { label: "slashes, 30 days", value: d.totals.slashes }, { label: "drifting", value: d.totals.drifting }] })
      + `<p>${fleetBadge({ id: d.fleet.id, name: d.fleet.name })} <a href="/society/fleets/${encodeURIComponent(d.fleet.id)}">The public page of this fleet</a> &middot; <a href="/fleet/${encodeURIComponent(d.fleet.id)}/export?format=csv">Export (CSV)</a></p>`
      + `<h2>First hour</h2><div class="card"><p class="mut">${d.firstHour.done} of ${d.firstHour.of} done.</p><ul class="plain">${d.firstHour.items.map((i) => `<li>${i.done ? "&#10003;" : "&#9744;"} ${esc(i.step)}${i.done ? "" : ` <span class="mut">&rarr; ${esc(i.next)}</span>`}</li>`).join("")}</ul></div>`
      + `<h2>Alerts</h2>${alerts ? `<div class="card"><ul class="plain">${alerts}</ul></div>` : emptyState("No alert", "Caps nearly reached, slashes, drift, a frozen member and concentrated work show here.")}`
      + `<h2>Over time</h2><p class="mut">The last ${sr.days.length} days. Each graph has the table of its numbers under it.</p>`
      + lineGraph({ title: "Credits spent this month against the fleet's cap", labels: monthDays, series: [{ name: "credits spent, cumulative", values: cumCredits }], unit: "credits", ...(d.controls.caps.fleet.credits !== undefined ? { reference: { name: "cap", value: d.controls.caps.fleet.credits } } : {}) })
      + (d.controls.caps.fleet.tokens !== undefined || cumTokens.some((x) => x > 0) ? lineGraph({ title: "Tokens used this month against the fleet's cap", labels: monthDays, series: [{ name: "tokens, cumulative", values: cumTokens }], unit: "tokens", ...(d.controls.caps.fleet.tokens !== undefined ? { reference: { name: "cap", value: d.controls.caps.fleet.tokens } } : {}) }) : "")
      + lineGraph({ title: "Spend a day", labels: sr.days, series: [{ name: "credits", values: sr.credits }, { name: "tokens (hundreds)", values: sr.tokens.map((t) => Math.round(t / 100)) }] })
      + lineGraph({ title: "Members of the fleet", labels: sr.days, series: [{ name: "members", values: sr.members }], unit: "members" })
      + lineGraph({ title: "Slashes and drift a day", labels: sr.days, series: [{ name: "slashes", values: sr.slashes }, { name: "drift diagnoses", values: sr.drift }] })
      + `<h2>Mix</h2><div class="mixgrid">${barChart({ title: "Members by persona", rows: mixRows(d.mix.persona), unit: "Members" })}${barChart({ title: "Members by tier", rows: mixRows(d.mix.tier), unit: "Members" })}${barChart({ title: "Members by node", rows: mixRows(d.mix.node), unit: "Members" })}</div>`
      + `<h2>Freeze state</h2>${frozenTable}`
      + `<h2>Caps and controls</h2><div class="note"><p>Fleet caps this month: credits ${d.controls.caps.fleet.credits ?? "none"}${d.controls.capsUsed.credits !== null ? ` (${d.controls.capsUsed.credits} used)` : ""}, tokens ${d.controls.caps.fleet.tokens ?? "none"}${d.controls.capsUsed.tokens !== null ? ` (${d.controls.capsUsed.tokens} used)` : ""}. Freeze: <code>POST /fleet/&lt;fleet&gt;/freeze</code> and <code>/unfreeze</code> (a member with <code>{"member": "&lt;did&gt;"}</code>, a node of the tree with <code>{"node": "&lt;node&gt;"}</code>); caps: <code>POST /fleet/&lt;fleet&gt;/caps</code> with <code>credits</code> and <code>tokens</code>. A write past a cap, or by a frozen member, is refused.</p></div>`
      + `<h2>Fleet tree</h2>${tree}`
      + `<h2>Members</h2>${rows ? `<div class="table-wrap"><table><thead><tr><th>Agent</th><th>Node</th><th class="num">Tier</th><th class="num">Slashes</th><th class="num">Drift</th><th class="num">Credits</th><th class="num">Tokens</th></tr></thead><tbody>${rows}</tbody></table></div>${nav}` : emptyState("No member yet", "Agents join by naming this fleet on their passport.")}`
      + `<h2>Audit trail</h2>${audit.length ? `<div class="card"><ul class="plain">${audit.slice(-20).reverse().map((a) => `<li>${esc(a.at.slice(0, 16).replace("T", " "))} &middot; ${esc(a.by)} &middot; ${esc(a.act)}${a.target ? ` ${esc(a.target)}` : ""}${a.detail ? ` <code>${esc(a.detail)}</code>` : ""}</li>`).join("")}</ul></div>` : emptyState("No change yet", "Every freeze, unfreeze and cap is kept here with who made it.")}`
      + (d.not_yet.length ? `<h2>Not on this page yet</h2><div class="note"><ul class="plain">${d.not_yet.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "");
  if (o.fragment) return content;
  return shell({ title: `Dashboard: ${d.fleet.name}`, here: "/society/fleets", description: `The dashboard of the fleet ${d.fleet.name}: members, spend, caps, alerts, graphs.`, css: DASH_CSS, body: `<p class="livebar"><a href="/fleet/${encodeURIComponent(d.fleet.id)}/live">Open the live view</a> (updates every 5 seconds)</p>` + content });
}

const DASH_CSS = ".al-critical b{color:var(--warn)}.al-warn b{color:var(--acc)}.al-critical,.al-warn,.al-info{list-style:none}.mixgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:var(--s3)}";

/** The live page: a shell with no data in it. It asks for the organisation's token (kept in this tab only, never sent in the address), then runs the dynamic client (`fleet-live-client.ts`): a summary and the newest records every 2 seconds, animated numbers, a time range, filters, tooltips, drill-down, a ticker, pause and resume, and a table for every graph. */
export function renderFleetLive(fleet: string): string {
  const esc = uiEsc;
  const script = LIVE_CLIENT_SCRIPT.replace("__FLEET__", JSON.stringify(fleet).replace(/</g, String.fromCharCode(92) + "u003c"));
  const ranges = (Object.keys(LIVE_RANGES) as LiveRange[]).map((r) => `<button type="button" class="chip" data-range="${r}" aria-pressed="false">${r}</button>`).join("");
  return shell({
    title: `Live dashboard: ${fleet}`, here: "/society/fleets", description: "The live dashboard of a fleet: it updates as records are written, with filters, a time range and a table for every graph.", css: DASH_CSS + LIVE_CSS,
    body: `<section class="hero"><p class="kicker">Fleet dashboard (private to its organisation)</p><h1>Live dashboard</h1><p class="sub">${esc(fleet)}. This page holds no data: it asks the service for it with your token and shows what comes back, as it is written.</p>`
      + `<form class="livebar" onsubmit="return false"><label for="tok">Token</label><input id="tok" type="password" autocomplete="off" placeholder="your tenant token (kept in this tab only)"><button id="go" type="button">Start</button><button id="pause" type="button" aria-pressed="false" disabled>Pause</button><button id="stop" type="button" disabled>Stop</button></form>`
      + `<div class="livebar" role="group" aria-label="Time range">${ranges}</div>`
      + `<div class="livebar"><label for="fleetsel">Fleet</label><select id="fleetsel"><option>${esc(fleet)}</option></select><label for="f-persona">Persona</label><select id="f-persona"><option value="">All personas</option></select><label for="f-node">Node</label><select id="f-node"><option value="">All nodes</option></select><label for="f-tier">Tier</label><select id="f-tier"><option value="">All tiers</option></select></div>`
      + `<p id="status" role="status" aria-live="polite" class="mut">Enter your token to start.</p><p id="announce" class="vh" aria-live="polite"></p></section>`
      + `<div class="livegrid"><div id="live"></div><aside aria-label="Live activity"><h2>Live activity</h2><ul id="ticker" class="ticker plain"></ul></aside></div><div id="tip" class="tip" role="tooltip" hidden></div>`,
    script,
  });
}

const LIVE_CSS = `.livegrid{display:grid;grid-template-columns:minmax(0,1fr) 19rem;gap:var(--s4);align-items:start}@media (max-width:900px){.livegrid{grid-template-columns:minmax(0,1fr)}}
.ticker{max-height:34rem;overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--s2) var(--s3)}.ticker li{padding:var(--s2) 0;border-top:1px solid var(--line);font-size:.9rem}.ticker li:first-child{border-top:0}.ticker time{color:var(--mut);font-variant-numeric:tabular-nums}
.k-slash a,.k-drift a{color:var(--warn)}.tip{position:fixed;z-index:20;max-width:20rem;background:var(--fg);color:var(--bg);padding:var(--s1) var(--s2);border-radius:6px;font-size:.85rem;pointer-events:none;transform:translate(.6rem,.6rem)}
.pick{cursor:pointer}.pick:hover,.pick:focus-visible{background:var(--acc-bg)}.pick.on{outline:2px solid var(--acc);outline-offset:-2px}.chart .cursor{stroke:var(--mut);stroke-dasharray:3 3}.chart .pt{cursor:pointer}.chart .pt:hover{r:5}
.livebar select{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.35rem .6rem;min-height:2.4rem}.chip[aria-pressed="true"]{background:var(--acc-bg);border-color:var(--acc);color:var(--acc)}
@media (prefers-reduced-motion:no-preference){.ticker li.new{animation:fresh .8s ease-out}@keyframes fresh{from{background:var(--acc-bg);transform:translateY(-.4rem);opacity:.3}to{background:transparent;transform:none;opacity:1}}.chart .pt{transition:r .15s}}
`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";

export function fleetDashboardRoutes(o: FleetDashboardSource) {
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: { name: string; role?: string } }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.replace(/\/+$/, "") === "/fleets/mine") {
      const sendMine = (body: unknown) => { const t = JSON.stringify(body); res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(t); return true; };
      const dir = fleetDirectory(await o.stored());
      return sendMine({ ok: true, fleets: dir.fleets.filter((x) => ctx.tenant.role === "admin" || o.owned(ctx.tenant.name).includes(x.org)).map((x) => ({ id: x.id, name: x.name, members: x.members.length })) });
    }
    const m = /^\/fleet\/([^/]+)\/(dashboard|export|freeze|unfreeze|caps|summary|events|hud-data)\/?$/.exec(url.pathname);
    if (!m) return false;
    const send = (code: number, ctype: string, body: string) => { res.writeHead(code, { "content-type": ctype, "cache-control": "no-store", "x-robots-tag": "noindex", ...(ctype.startsWith("text/html") ? { "content-security-policy": CSP } : {}) }); res.end(req.method === "HEAD" ? undefined : body); return true; };
    const fail = (code: number, c: string, msg: string) => send(code, "application/json", JSON.stringify({ ok: false, error: { code: c, message: msg } }));
    const [, rawFleet, op] = m;
    try {
      const stored = await o.stored();
      const f = findFleet(fleetDirectory(stored), decodeURIComponent(rawFleet!));
      if (!f) return fail(404, "NO_SUCH_FLEET", "no fleet of that name or id in this log");
      if (ctx.tenant.role !== "admin" && !o.owned(ctx.tenant.name).includes(f.org)) return fail(403, "NOT_YOURS", "the dashboard and the controls of a fleet are for the tenant that owns the fleet's organisation");
      const now = o.now(), month = monthOf(now);
      const wantsJson = url.searchParams.get("format") === "json" || String(req.headers.accept ?? "").includes("application/json");
      if (op === "hud-data") {
        if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
        const nowMs = Date.parse(now), num = (k: string) => { const raw = url.searchParams.get(k); const v = Number(raw); return raw !== null && Number.isFinite(v) ? v : undefined; };
        const rg = LIVE_RANGES[(url.searchParams.get("range") ?? "24h") as LiveRange], span = rg ? rg.ms * rg.buckets : 24 * 3_600_000;
        const to = Math.min(num("to") ?? nowMs, nowMs + 60_000), from = Math.max(num("from") ?? to - span, to - 31 * 86_400_000);
        if (from >= to) return fail(400, "BAD_WINDOW", "from must be before to, both in milliseconds");
        return send(200, "application/json", JSON.stringify(fleetHud(stored, f.id, { from, to, now, controls: o.controls.get(f.id) })));
      }
      if (op === "summary" || op === "events") {
        if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
        if (op === "events") { const since = Math.max(0, Math.trunc(Number(url.searchParams.get("since") ?? 0)) || 0); return send(200, "application/json", JSON.stringify({ ok: true, ...fleetEvents(stored, f.id, since, 40)! })); }
        const range = (url.searchParams.get("range") ?? "24h") as LiveRange;
        if (!LIVE_RANGES[range]) return fail(400, "BAD_RANGE", "the range is 1h, 24h, 7d or 30d");
        const tierQ = url.searchParams.get("tier");
        const filter = { ...(url.searchParams.get("persona") ? { persona: url.searchParams.get("persona")! } : {}), ...(url.searchParams.get("node") ? { node: url.searchParams.get("node")! } : {}), ...(tierQ && Number.isInteger(Number(tierQ)) ? { tier: Number(tierQ) } : {}) };
        return send(200, "application/json", JSON.stringify(fleetLive(stored, f.id, { range, now, filter, controls: o.controls.get(f.id) })));
      }
      if (op === "dashboard" || op === "export") {
        if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
        const controls = o.controls.get(f.id);
        if (op === "export") {
          if (url.searchParams.get("format") === "json") return send(200, "application/json", JSON.stringify(fleetDashboard(stored, f.id, { month, now, all: true, controls })));
          return send(200, "text/csv; charset=utf-8", fleetCsv(stored, f.id, { month, now, controls })!);
        }
        const d = fleetDashboard(stored, f.id, { month, now, page: Number(url.searchParams.get("page") ?? 1), pageSize: Number(url.searchParams.get("size") ?? 100), controls })!;
        return wantsJson ? send(200, "application/json", JSON.stringify({ ...d, audit: controls.audit.slice(-50) })) : send(200, "text/html; charset=utf-8", renderFleetDashboard(d, controls.audit, { fragment: url.searchParams.get("fragment") === "1" }));
      }
      if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return true; }
      let body: Record<string, unknown> = {};
      try { const chunks: Buffer[] = []; let n = 0; for await (const c of req) { n += (c as Buffer).length; if (n > 16 * 1024) return fail(413, "TOO_LARGE", "the body is JSON, at most 16 KB"); chunks.push(c as Buffer); } const t = Buffer.concat(chunks).toString("utf8"); body = t ? JSON.parse(t) : {}; } catch { return fail(400, "BAD_REQUEST", "the body is JSON"); }
      const member = typeof body.member === "string" ? body.member : undefined;
if (member && !f.members.some((x) => x.did === member)) return fail(404, "NO_SUCH_MEMBER", "that identity is not a member of this fleet");
      const node = typeof body.node === "string" ? body.node : undefined;
      if (node && node !== "root" && !stored.some((x) => x.record.type === "asp.fleet_node/v0.2" && (x.record.body as { fleet?: string; node?: string }).fleet === f.id && (x.record.body as { node?: string }).node === node)) return fail(404, "NO_SUCH_NODE", "that node is not in this fleet's tree");
      const by = ctx.tenant.name;
      if (op === "freeze") { if (node) o.controls.freezeNode(f.id, by, now, node, typeof body.reason === "string" ? body.reason : undefined); else o.controls.freeze(f.id, by, now, member, typeof body.reason === "string" ? body.reason : undefined); }
      else if (op === "unfreeze") { if (node) o.controls.unfreezeNode(f.id, by, now, node); else o.controls.unfreeze(f.id, by, now, member); }
      else {
        const pick = (k: "credits" | "tokens") => (body[k] === undefined || body[k] === null ? undefined : Number(body[k]));
        try { o.controls.setCap(f.id, by, now, { ...(pick("credits") !== undefined ? { credits: pick("credits")! } : {}), ...(pick("tokens") !== undefined ? { tokens: pick("tokens")! } : {}) }, member); } catch (e) { return fail(400, "BAD_CAP", (e as Error).message); }
      }
      const c = o.controls.get(f.id);
      return send(200, "application/json", JSON.stringify({ ok: true, fleet: f.id, frozen: c.frozen, frozenMembers: c.frozenMembers, frozenNodes: c.frozenNodes, caps: c.caps }));
    } catch (e) { return fail(500, "SERVER_ERROR", (e as Error).message); }
  };
}

/** `GET /fleet/<fleet>/live`: the live page's shell, public because it holds no data (the data comes from the authenticated dashboard route with the token the visitor types). */
export function fleetLiveRoute() {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = /^\/fleet\/([^/]+)\/(live|hud)\/?$/.exec(url.pathname);
    if (!m) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    let fleet = m[1]!;
    try { fleet = decodeURIComponent(fleet); } catch { /* keep the raw text */ }
    const body = m[2] === "hud" ? renderFleetHud(fleet.slice(0, 300)) : renderFleetLive(fleet.slice(0, 300));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}
