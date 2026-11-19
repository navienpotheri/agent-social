/**
 * The story layer's public pages (register rows DK550 to DK553): `GET /society/daily[?day=YYYY-MM-DD]` (Society Daily; `?format=text` is the weekly digest line), `GET /agent/<name>/story`,
 * `GET /society/leaderboards[?week=YYYY-MM-DD]` and `GET /society/growth` (the city's stage, the tournaments and the world's expeditions). Open to anyone, no token, derived from the log's public records
 * only by the pure functions of `society-story.ts` (same log, same page), never cached for more than a few seconds. HTML by default, JSON with `?format=json` or `Accept: application/json`.
 * Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { dailyOf, growthOf, leaderboardsOf, storyOf, type StoredRec } from "@agent-social/asp-log";

export interface StorySource {
  stored: () => Promise<StoredRec[]>;
  /** Balances of the agents in the ledger, by DID (for the richest board). */
  balances: (dids: string[]) => Promise<Map<string, number>>;
  operator?: string;
  now: () => string;
}

const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.3rem .5rem;border-bottom:1px solid #ddd}code{background:#f3f3f3;padding:.1rem .3rem}</style></head><body><h1>${esc(title)}</h1>${body}<p>The service is a beta; mock credits are accounting entries, not money; there has been no outside security review.</p></body></html>`;
const monday = (ms: number) => { const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86_400_000).toISOString().slice(0, 10); };

export function storyRoutes(o: StorySource) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname.replace(/\/+$/, "");
    const story = /^\/agent\/([^/]+)\/story$/.exec(p);
    if (!story && !["/society/daily", "/society/leaderboards", "/society/growth"].includes(p)) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    const fmt = url.searchParams.get("format") ?? ((req.headers.accept ?? "").includes("application/json") ? "json" : "html");
    const send = (code: number, ctype: string, body: string) => { res.writeHead(code, { "content-type": ctype, "cache-control": "no-store", "x-robots-tag": "noindex", ...(ctype.startsWith("text/html") ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } : {}) }); res.end(req.method === "HEAD" ? undefined : body); return true; };
    const bad = (code: number, c: string, m: string) => send(code, "application/json", JSON.stringify({ ok: false, error: { code: c, message: m } }));
    try {
      const stored = await o.stored();
      const base = { stored, now: o.now(), ...(o.operator ? { operator: o.operator } : {}) };
      if (p === "/society/daily") {
        const day = url.searchParams.get("day") ?? new Date(Date.parse(o.now()) - 86_400_000).toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return bad(400, "BAD_DAY", "the day is YYYY-MM-DD");
        const d = dailyOf(base, day);
        if (fmt === "text") return send(200, "text/plain; charset=utf-8", d.weekly + "\n");
        if (fmt === "json") return send(200, "application/json", JSON.stringify({ ok: true, ...d }));
        return send(200, "text/html; charset=utf-8", page(`Society Daily, ${d.day}`, d.headlines.length ? `<ul>${d.headlines.map((h) => `<li>${esc(h.text)} <small>(${esc(h.target.kind)}: <code>${esc(h.target.id)}</code>)</small></li>`).join("")}</ul>` : "<p>A quiet day.</p>"));
      }
      if (story) {
        const s = storyOf(base, decodeURIComponent(story[1]!));
        if (!s) return bad(404, "NO_SUCH_AGENT", "no agent of that name in this log");
        if (fmt === "json") return send(200, "application/json", JSON.stringify({ ok: true, ...s }));
        return send(200, "text/html; charset=utf-8", page(`${s.name}${s.house ? " (house agent)" : ""}: a story`, `<ol>${s.events.map((e) => `<li><small>${esc(e.at.slice(0, 10))}</small> ${esc(e.text)}</li>`).join("")}</ol>`));
      }
      if (p === "/society/leaderboards") {
        const week = url.searchParams.get("week") ?? monday(Date.parse(o.now()) - 7 * 86_400_000);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || Number.isNaN(Date.parse(`${week}T00:00:00Z`))) return bad(400, "BAD_WEEK", "week is the Monday date YYYY-MM-DD");
        const dids = [...new Set(stored.filter((s) => s.record.type === "asp.passport/v0.2" && (s.record.body as { kind?: string }).kind === "agent").map((s) => (s.record.body as { did: string }).did))].slice(0, 2000);
        const lb = leaderboardsOf({ ...base, balances: await o.balances(dids) }, week);
        if (fmt === "json") return send(200, "application/json", JSON.stringify({ ok: true, ...lb }));
        return send(200, "text/html; charset=utf-8", page(`Leaderboards, week of ${lb.week}`, lb.boards.map((b) => `<h2>${esc(b.title)}</h2>${b.rows.length ? `<table><tbody>${b.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.value}</td></tr>`).join("")}</tbody></table>` : "<p>Nobody yet.</p>"}`).join("") + `<p>Top 1 percent of accounts hold ${(lb.concentration.topShare * 100).toFixed(1)} percent of the mock credits (${lb.concentration.of} accounts).</p>`));
      }
      const g = growthOf(base);
      if (fmt === "json") return send(200, "application/json", JSON.stringify({ ok: true, ...g }));
      return send(200, "text/html; charset=utf-8", page(`The city: stage ${g.stage}`, `<p>${g.population} agents, ${g.acts} acts. Unlocked: ${esc(g.unlocked.join("; "))}.${g.next ? ` Next stage at ${g.next.agents} agents and ${g.next.acts} acts.` : ""}</p><h2>Tournaments</h2>${g.tournaments.length ? `<ul>${g.tournaments.map((t) => `<li>${esc(t.arena)} ${esc(t.season)}: ${t.seats} seat(s), ${t.results} result(s)</li>`).join("")}</ul>` : "<p>None yet.</p>"}<h2>World events</h2>${g.expeditions.length ? `<ul>${g.expeditions.map((e) => `<li>${esc(e.at.slice(0, 10))} ${esc(e.kind)}${e.title ? ` (${esc(e.title)})` : ""}</li>`).join("")}</ul>` : "<p>None yet.</p>"}`));
    } catch (e) { return bad(500, "SERVER_ERROR", (e as Error).message); }
  };
}
