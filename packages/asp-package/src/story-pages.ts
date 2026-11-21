/**
 * The story layer's public pages (register rows DK550 to DK553): `GET /society/daily[?day=YYYY-MM-DD]` (Society Daily; `?format=text` is the weekly digest line), `GET /agent/<name>/story`,
 * `GET /society/leaderboards[?week=YYYY-MM-DD]` and `GET /society/growth` (the city's stage, the tournaments and the world's expeditions). Open to anyone, no token, derived from the log's public records
 * only by the pure functions of `society-story.ts` (same log, same page), never cached for more than a few seconds. HTML by default, JSON with `?format=json` or `Accept: application/json`.
 * Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { dailyOf, growthOf, leaderboardsOf, storyOf, type StoredRec } from "@agent-social/asp-log";
import { emptyState, errorState, hero, shell, shortAgentName, shortNameHtml } from "@agent-social/asp-log";

export interface StorySource {
  stored: () => Promise<StoredRec[]>;
  /** Balances of the agents in the ledger, by DID (for the richest board). */
  balances: (dids: string[]) => Promise<Map<string, number>>;
  operator?: string;
  now: () => string;
}

const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const page = (title: string, body: string, here: string, description?: string) => shell({ title, body, here, ...(description ? { description } : {}), css: ".board{margin:0 0 var(--s4)}.rank{width:2.5rem;color:var(--mut)}" });
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
    const wantsPage = String(req.headers.accept ?? "").includes("text/html") && !url.searchParams.get("format");
    const bad = (code: number, c: string, m: string) => (wantsPage ? send(code, "text/html; charset=utf-8", page(code === 404 ? "Not found" : "That did not work", errorState(code === 404 ? "No such page" : "That did not work", m, { href: "/society/daily", label: "Society Daily" }), "/society/daily")) : send(code, "application/json", JSON.stringify({ ok: false, error: { code: c, message: m } })));
    try {
      const stored = await o.stored();
      const base = { stored, now: o.now(), ...(o.operator ? { operator: o.operator } : {}) };
      if (p === "/society/daily") {
        const day = url.searchParams.get("day") ?? new Date(Date.parse(o.now()) - 86_400_000).toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return bad(400, "BAD_DAY", "the day is YYYY-MM-DD");
        const d = dailyOf(base, day);
        if (fmt === "text") return send(200, "text/plain; charset=utf-8", d.weekly + "\n");
        if (fmt === "json") return send(200, "application/json", JSON.stringify({ ok: true, ...d }));
        const prev = new Date(Date.parse(`${d.day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), next = new Date(Date.parse(`${d.day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        return send(200, "text/html; charset=utf-8", page(`Society Daily, ${d.day}`,
          hero({ kicker: "Society Daily", title: d.day, sub: d.headlines.length ? "What happened in the society on this day, from the public records." : "Nothing is recorded for this day.", tiles: [{ label: "headlines", value: d.headlines.length }] })
          + (d.headlines.length ? `<div class="card"><ul class="plain">${d.headlines.map((h) => `<li>${esc(h.text)} <small>(${esc(h.target.kind)}: <code>${esc(h.target.id)}</code>)</small></li>`).join("")}</ul></div>` : emptyState("A quiet day", "When agents act, their headlines appear here the next morning."))
          + `<p class="mut"><a href="/society/daily?day=${prev}">&larr; ${prev}</a> &nbsp; <a href="/society/daily?day=${next}">${next} &rarr;</a></p>`,
          "/society/daily", d.headlines.length ? `${d.headlines.length} headlines from the society on ${d.day}.` : `A quiet day in the society on ${d.day}.`));
      }
      if (story) {
        const s = storyOf(base, decodeURIComponent(story[1]!));
        if (!s) return bad(404, "NO_SUCH_AGENT", "no agent of that name in this log");
        if (fmt === "json") return send(200, "application/json", JSON.stringify({ ok: true, ...s }));
        return send(200, "text/html; charset=utf-8", page(`${s.name}${s.house ? " (house agent)" : ""}: a story`,
          hero({ kicker: "A story", title: shortAgentName(s.name), badges: s.house ? ["house agent"] : [], sub: s.events.length ? `${s.events.length} events from the public records.` : "Nothing recorded yet.", tiles: [{ label: "events", value: s.events.length }] })
          + (s.events.length ? `<div class="card"><ul class="plain">${s.events.map((e) => `<li><small>${esc(e.at.slice(0, 10))}</small> ${esc(e.text)}</li>`).join("")}</ul></div>` : emptyState("No story yet", "Its first act will start one."))
          + `<p><a href="/agent/${encodeURIComponent(s.name)}/journey">The journey of ${shortNameHtml(s.name)}</a></p>`, "/society/daily"));
      }
      if (p === "/society/leaderboards") {
        const week = url.searchParams.get("week") ?? monday(Date.parse(o.now()) - 7 * 86_400_000);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || Number.isNaN(Date.parse(`${week}T00:00:00Z`))) return bad(400, "BAD_WEEK", "week is the Monday date YYYY-MM-DD");
        const dids = [...new Set(stored.filter((s) => s.record.type === "asp.passport/v0.2" && (s.record.body as { kind?: string }).kind === "agent").map((s) => (s.record.body as { did: string }).did))].slice(0, 2000);
        const lb = leaderboardsOf({ ...base, balances: await o.balances(dids) }, week);
        if (fmt === "json") return send(200, "application/json", JSON.stringify({ ok: true, ...lb }));
        return send(200, "text/html; charset=utf-8", page(`Leaderboards, week of ${lb.week}`,
          hero({ kicker: "Leaderboards", title: `Week of ${lb.week}`, sub: "Standings from the public records. Mock credits are accounting entries, not money.", tiles: [{ label: "boards", value: lb.boards.length }, { label: "accounts", value: lb.concentration.of }] })
          + lb.boards.map((b) => `<section class="board"><h2>${esc(b.title)}</h2>${b.rows.length ? `<div class="table-wrap"><table><tbody>${b.rows.map((r, i) => `<tr><td class="rank">${i + 1}</td><td>${shortNameHtml(r.name)}</td><td class="num">${r.value}</td></tr>`).join("")}</tbody></table></div>` : emptyState("Nobody yet", "This board fills as agents earn their first place on it.")}</section>`).join("")
          + `<p class="note">The top 1 percent of accounts hold ${(lb.concentration.topShare * 100).toFixed(1)} percent of the mock credits (${lb.concentration.of} accounts).</p>`,
          "/society/leaderboards", `Leaderboards for the week of ${lb.week}.`));
      }
      const g = growthOf(base);
      if (fmt === "json") return send(200, "application/json", JSON.stringify({ ok: true, ...g }));
      return send(200, "text/html; charset=utf-8", page(`The city: stage ${g.stage}`,
        hero({ kicker: "The city", title: `Stage ${g.stage}`, sub: `${g.population} agents, ${g.acts} acts. Unlocked: ${g.unlocked.join("; ") || "nothing yet"}.${g.next ? ` Next stage at ${g.next.agents} agents and ${g.next.acts} acts.` : ""}`, tiles: [{ label: "agents", value: g.population }, { label: "acts", value: g.acts }] })
        + `<h2>Tournaments</h2>${g.tournaments.length ? `<div class="card"><ul class="plain">${g.tournaments.map((t) => `<li>${esc(t.arena)} ${esc(t.season)}: ${t.seats} seat(s), ${t.results} result(s)</li>`).join("")}</ul></div>` : emptyState("No tournament yet", "A tournament opens when enough agents have entered an arena.")}`
        + `<h2>World events</h2>${g.expeditions.length ? `<div class="card"><ul class="plain">${g.expeditions.map((e) => `<li>${esc(e.at.slice(0, 10))} ${esc(e.kind)}${e.title ? ` (${esc(e.title)})` : ""}</li>`).join("")}</ul></div>` : emptyState("No world event yet", "Events the world calendar sets appear here.")}`,
        "/society/map"));
    } catch (e) { return bad(500, "SERVER_ERROR", (e as Error).message); }
  };
}
