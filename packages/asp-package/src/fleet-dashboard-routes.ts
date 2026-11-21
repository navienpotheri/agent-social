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
import { barChart, emptyState, fleetBadge, fleetCsv, lineGraph, fleetDashboard, fleetDirectory, findFleet, hero, monthOf, shell, shortNameHtml, uiEsc, type FleetControls, type FleetDashboard, type StoredRec } from "@agent-social/asp-log";

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

/** The live page: a shell with no data in it. It asks for the organisation's token (kept in this tab only, never in the address), fetches the dashboard's content with it every 5 seconds and swaps it in; a screen reader is told of each update politely. */
export function renderFleetLive(fleet: string): string {
  const esc = uiEsc;
  const script = `(function(){var F=${JSON.stringify(fleet).replace(/</g, String.fromCharCode(92) + "u003c")},K="asp-fleet-token",box=document.getElementById("live"),st=document.getElementById("status"),inp=document.getElementById("tok"),btn=document.getElementById("go"),stop=document.getElementById("stop"),timer=null,tok="";try{tok=sessionStorage.getItem(K)||""}catch(e){}
function open(){var o=[];box.querySelectorAll("details").forEach(function(d,i){if(d.open)o.push(i)});return o}
function reopen(o){var ds=box.querySelectorAll("details");o.forEach(function(i){if(ds[i])ds[i].open=true})}
function load(){if(!tok){st.textContent="Enter your token to start.";return}
fetch("/fleet/"+encodeURIComponent(F)+"/dashboard?fragment=1",{headers:{authorization:"Bearer "+tok,accept:"text/html"},cache:"no-store"}).then(function(r){if(!r.ok)throw r.status;return r.text()}).then(function(h){var o=open();box.innerHTML=h;reopen(o);st.textContent="Live: updated "+new Date().toLocaleTimeString()+", every 5 seconds."}).catch(function(e){st.textContent="Could not update ("+e+")."+(e===401||e===403?" Check the token.":" Trying again.");if(e===401||e===403)halt()})}
function run(){halt();load();timer=setInterval(function(){if(!document.hidden)load()},5000);stop.disabled=false}
function halt(){if(timer){clearInterval(timer);timer=null}stop.disabled=true}
btn.addEventListener("click",function(){tok=inp.value.trim();if(!tok){st.textContent="Enter your token to start.";return}try{sessionStorage.setItem(K,tok)}catch(e){}inp.value="";run()});
stop.addEventListener("click",function(){halt();st.textContent="Stopped. Start again with your token."});
if(tok)run();else st.textContent="Enter your token to start."})();`;
  return shell({
    title: `Live dashboard: ${fleet}`, here: "/society/fleets", description: "The live dashboard of a fleet: tables, charts and graphs that update by themselves.", css: DASH_CSS,
    body: `<section class="hero"><p class="kicker">Fleet dashboard (private to its organisation)</p><h1>Live dashboard</h1><p class="sub">${esc(fleet)}. This page holds no data: it asks the service for it with your token and shows what comes back.</p>`
      + `<form class="livebar" onsubmit="return false"><label for="tok">Token</label><input id="tok" type="password" autocomplete="off" placeholder="your tenant token (kept in this tab only)"><button id="go" type="button">Start</button><button id="stop" type="button" disabled>Stop</button></form><p id="status" role="status" aria-live="polite" class="mut">Enter your token to start.</p></section><div id="live"></div>`,
    script,
  });
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";

export function fleetDashboardRoutes(o: FleetDashboardSource) {
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: { name: string; role?: string } }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = /^\/fleet\/([^/]+)\/(dashboard|export|freeze|unfreeze|caps)\/?$/.exec(url.pathname);
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
    const m = /^\/fleet\/([^/]+)\/live\/?$/.exec(url.pathname);
    if (!m) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    let fleet = m[1]!;
    try { fleet = decodeURIComponent(fleet); } catch { /* keep the raw text */ }
    const body = renderFleetLive(fleet.slice(0, 300));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}
