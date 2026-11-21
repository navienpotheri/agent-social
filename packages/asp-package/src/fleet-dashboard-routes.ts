/**
 * The fleet dashboard routes (register row DK1361), for the tenant that owns the fleet's organisation (or an operator); everyone else gets 403:
 *   GET  /fleet/<fleet>/dashboard[?page=&size=]   the dashboard (HTML for a browser, JSON with `?format=json` or `Accept: application/json`)
 *   GET  /fleet/<fleet>/export[?format=csv|json]  every member, for the organisation's own tools
 *   POST /fleet/<fleet>/freeze | /unfreeze        { member?: <did> }  the whole fleet, or one member
 *   POST /fleet/<fleet>/caps                      { member?: <did>, credits?: n, tokens?: n }  a monthly cap (an empty body removes it)
 * `<fleet>` is the fleet's DID or its name. Every change is kept with who made it and when (the audit trail on the dashboard). The guard `fleetGuard` (asp-log) is what refuses a write past a cap or from a frozen member.
 * Roles within an organisation (DK1359) and the fleet tree (DK1372) are not built yet: one role, the owning tenant. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { emptyState, fleetBadge, fleetCsv, fleetDashboard, fleetDirectory, findFleet, hero, monthOf, shell, shortNameHtml, uiEsc, type FleetControls, type FleetDashboard, type StoredRec } from "@agent-social/asp-log";

export interface FleetDashboardSource {
  stored: () => Promise<StoredRec[]>;
  controls: FleetControls;
  /** The identities a tenant has written as (the organisation's DID is among them for the tenant that declared the fleet). */
  owned: (tenant: string) => string[];
  now: () => string;
}

export function renderFleetDashboard(d: FleetDashboard, audit: { at: string; by: string; act: string; target?: string; detail?: string }[] = []): string {
  const esc = uiEsc;
  const rows = d.members.map((m) => `<tr><td><a href="${esc(m.journey)}">${shortNameHtml(m.name)}</a>${m.frozen ? ` <span class="badge">frozen</span>` : ""}</td><td class="num">${m.tier ?? "&ndash;"}</td><td class="num">${m.slashes}</td><td class="num">${m.drift === 0 ? "0" : m.drift === 1 ? "1 (warn)" : "2 (quarantine advised)"}</td><td class="num">${m.credits}${m.capCredits !== null ? ` / ${m.capCredits}` : ""}</td><td class="num">${m.tokens}${m.capTokens !== null ? ` / ${m.capTokens}` : ""}</td></tr>`).join("");
  const alerts = d.alerts.map((a) => `<li class="al-${a.level}"><b>${esc(a.level)}</b> ${esc(a.text)}</li>`).join("");
  const nav = d.page.pages > 1 ? `<p class="mut">Page ${d.page.number} of ${d.page.pages}${d.page.number > 1 ? ` &middot; <a href="?page=${d.page.number - 1}&amp;size=${d.page.size}">previous</a>` : ""}${d.page.number < d.page.pages ? ` &middot; <a href="?page=${d.page.number + 1}&amp;size=${d.page.size}">next</a>` : ""}</p>` : "";
  return shell({
    title: `Dashboard: ${d.fleet.name}`, here: "/society/fleets", description: `The dashboard of the fleet ${d.fleet.name}: members, spend, caps, alerts.`, css: ".al-critical b{color:var(--warn)}.al-warn b{color:var(--acc)}.al-critical,.al-warn,.al-info{list-style:none}",
    body: hero({ kicker: "Fleet dashboard (private to its organisation)", title: d.fleet.name, badges: [d.controls.frozen ? "frozen" : "running", d.month], sub: d.fleet.purpose,
      tiles: [{ label: "members", value: d.totals.members }, { label: "credits spent this month", value: d.totals.credits }, { label: "tokens this month", value: d.totals.tokens }, { label: "frozen", value: d.totals.frozen }, { label: "slashes, 30 days", value: d.totals.slashes }, { label: "drifting", value: d.totals.drifting }] })
      + `<p>${fleetBadge({ id: d.fleet.id, name: d.fleet.name })} <a href="/society/fleets/${encodeURIComponent(d.fleet.id)}">The public page of this fleet</a> &middot; <a href="/fleet/${encodeURIComponent(d.fleet.id)}/export?format=csv">Export (CSV)</a></p>`
      + `<h2>Alerts</h2>${alerts ? `<div class="card"><ul class="plain">${alerts}</ul></div>` : emptyState("No alert", "Caps nearly reached, slashes, drift, a frozen member and concentrated work show here.")}`
      + `<h2>Caps and controls</h2><div class="note"><p>Fleet caps this month: credits ${d.controls.caps.fleet.credits ?? "none"}${d.controls.capsUsed.credits !== null ? ` (${d.controls.capsUsed.credits} used)` : ""}, tokens ${d.controls.caps.fleet.tokens ?? "none"}${d.controls.capsUsed.tokens !== null ? ` (${d.controls.capsUsed.tokens} used)` : ""}. Freeze: <code>POST /fleet/&lt;fleet&gt;/freeze</code> and <code>/unfreeze</code> (a member with <code>{"member": "&lt;did&gt;"}</code>); caps: <code>POST /fleet/&lt;fleet&gt;/caps</code> with <code>credits</code> and <code>tokens</code>. A write past a cap, or by a frozen member, is refused.</p></div>`
      + `<h2>Members</h2>${rows ? `<div class="table-wrap"><table><thead><tr><th>Agent</th><th class="num">Tier</th><th class="num">Slashes</th><th class="num">Drift</th><th class="num">Credits</th><th class="num">Tokens</th></tr></thead><tbody>${rows}</tbody></table></div>${nav}` : emptyState("No member yet", "Agents join by naming this fleet on their passport.")}`
      + `<h2>Audit trail</h2>${audit.length ? `<div class="card"><ul class="plain">${audit.slice(-20).reverse().map((a) => `<li>${esc(a.at.slice(0, 16).replace("T", " "))} &middot; ${esc(a.by)} &middot; ${esc(a.act)}${a.target ? ` ${esc(a.target)}` : ""}${a.detail ? ` <code>${esc(a.detail)}</code>` : ""}</li>`).join("")}</ul></div>` : emptyState("No change yet", "Every freeze, unfreeze and cap is kept here with who made it.")}`
      + `<h2>Not on this page yet</h2><div class="note"><ul class="plain">${d.not_yet.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`,
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
        return wantsJson ? send(200, "application/json", JSON.stringify({ ...d, audit: controls.audit.slice(-50) })) : send(200, "text/html; charset=utf-8", renderFleetDashboard(d, controls.audit));
      }
      if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return true; }
      let body: Record<string, unknown> = {};
      try { const chunks: Buffer[] = []; let n = 0; for await (const c of req) { n += (c as Buffer).length; if (n > 16 * 1024) return fail(413, "TOO_LARGE", "the body is JSON, at most 16 KB"); chunks.push(c as Buffer); } const t = Buffer.concat(chunks).toString("utf8"); body = t ? JSON.parse(t) : {}; } catch { return fail(400, "BAD_REQUEST", "the body is JSON"); }
      const member = typeof body.member === "string" ? body.member : undefined;
      if (member && !f.members.some((x) => x.did === member)) return fail(404, "NO_SUCH_MEMBER", "that identity is not a member of this fleet");
      const by = ctx.tenant.name;
      if (op === "freeze") o.controls.freeze(f.id, by, now, member, typeof body.reason === "string" ? body.reason : undefined);
      else if (op === "unfreeze") o.controls.unfreeze(f.id, by, now, member);
      else {
        const pick = (k: "credits" | "tokens") => (body[k] === undefined || body[k] === null ? undefined : Number(body[k]));
        try { o.controls.setCap(f.id, by, now, { ...(pick("credits") !== undefined ? { credits: pick("credits")! } : {}), ...(pick("tokens") !== undefined ? { tokens: pick("tokens")! } : {}) }, member); } catch (e) { return fail(400, "BAD_CAP", (e as Error).message); }
      }
      const c = o.controls.get(f.id);
      return send(200, "application/json", JSON.stringify({ ok: true, fleet: f.id, frozen: c.frozen, frozenMembers: c.frozenMembers, caps: c.caps }));
    } catch (e) { return fail(500, "SERVER_ERROR", (e as Error).message); }
  };
}
