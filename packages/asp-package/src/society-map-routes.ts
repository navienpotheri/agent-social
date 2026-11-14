/**
 * The public live-society routes (register row DK290): `GET /society/map/feed` (JSON: places, agent dots, flows, economy, alarms, world events; `?days=`, `?after=<seq>` for a live poll),
 * `GET /society/map/day/<YYYY-MM-DD>` (the replay of one day, from the records) and `GET /society/map` (the page). Open to anyone, no sign-in, derived from the log's public records only
 * (`societyMap` copies a whitelist of fields), never cached for more than a few seconds. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { dayReplay, flowsOf, societyMap, type MapFeed, type RepLike, type StoredLike } from "@agent-social/asp-log";
import { societyMapPage } from "./society-map-page.ts";

export interface SocietyMapSource {
  /** Every stored record in log order (`log.since(0, ...)`). */
  stored: () => Promise<StoredLike[]>;
  head: () => Promise<{ seq: number; logHash: string }>;
  rep: (did: string) => Promise<RepLike | null | undefined>;
  economy?: () => Promise<MapFeed["economy"]>;
  alarms?: () => Promise<{ id: string; since: string; says: string }[]>;
  events?: () => Promise<{ at: number; type: string; title?: string }[]>;
  operator?: string;
  now: () => string;
}

const MAX_AGENTS = 2000;

export async function buildFeed(o: SocietyMapSource, q: { days?: number; after?: number } = {}): Promise<MapFeed> {
  const stored = await o.stored();
  const head = await o.head();
  const dids = [...new Set(stored.filter((s) => s.record.type === "asp.passport/v0.2" && (s.record.body as { kind?: string }).kind === "agent").map((s) => (s.record.body as { did: string }).did))].slice(0, MAX_AGENTS);
  const rep = new Map<string, RepLike>();
  for (const d of dids) { const r = await o.rep(d); if (r) rep.set(d, r); }
  return societyMap({ stored, head: { seq: head.seq, hash: head.logHash }, now: o.now(), rep, operator: o.operator, economy: o.economy ? await o.economy() : null, alarms: o.alarms ? await o.alarms() : undefined, events: o.events ? await o.events() : [], ...q });
}

export function societyMapRoutes(o: SocietyMapSource) {
  let cache: { at: number; key: string; feed: MapFeed } | undefined;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname.replace(/\/+$/, "");
    if (p !== "/society/map" && p !== "/society/map/feed" && !p.startsWith("/society/map/day/")) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    const json = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*", "x-robots-tag": "noindex" }); res.end(req.method === "HEAD" ? undefined : JSON.stringify(v)); return true; };
    try {
      if (p === "/society/map") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
        res.end(req.method === "HEAD" ? undefined : societyMapPage());
        return true;
      }
      if (p === "/society/map/feed") {
        const days = Math.max(1, Math.min(90, Math.trunc(Number(url.searchParams.get("days") ?? 7)) || 7));
        const after = Math.max(0, Math.trunc(Number(url.searchParams.get("after") ?? 0)) || 0);
        const key = `${days}|${after}`;
        if (!cache || cache.key !== key || Date.now() - cache.at > 4000) cache = { at: Date.now(), key, feed: await buildFeed(o, { days, after }) };
        return json(200, { ok: true, feed: cache.feed });
      }
      const day = p.slice("/society/map/day/".length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return json(400, { ok: false, error: { code: "BAD_REQUEST", message: "the day is YYYY-MM-DD" } });
      const stored = await o.stored();
      const ids = new Set(stored.filter((s) => s.record.type === "asp.passport/v0.2" && (s.record.body as { kind?: string }).kind === "agent").map((s) => (s.record.body as { did: string }).did));
      return json(200, { ok: true, replay: dayReplay(stored, ids, day), note: "the flows of that day as the records carry them: recompute with the log" });
    } catch (e) {
      return json(500, { ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } });
    }
  };
}
void flowsOf;
