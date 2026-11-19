/**
 * The telemetry store's routes for a tenant (owner answer TM1; row DK651). All need the tenant's own token; a machine token may store content but not turn collection off or delete (those stay with the person).
 *   GET    /telemetry                 plain words: on or off, how much is stored, and the notice
 *   POST   /telemetry/opt-out         turn collection off in one step; { "delete": true } also deletes what is stored
 *   POST   /telemetry/opt-in          turn it back on
 *   POST   /telemetry/content         { kind, content, did? } stores it unless off, and answers with the hash the signed log may carry
 *   GET    /telemetry/content         the list (hashes, kinds, dates; never the text)
 *   GET    /telemetry/content/<hash>  the text, or "deleted" with the hash kept
 *   DELETE /telemetry/content/<hash>  removes the text and keeps the hash
 *   POST   /telemetry/delete-all      removes all the text and keeps every hash
 * Credits are accounting entries, not money; nothing here changes a standing.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { TELEMETRY_NOTICE, type TelemetryStore, type Tenant } from "@agent-social/asp-log";

export interface TelemetryRoutesOptions { store: TelemetryStore; now: () => string }

const readBody = (req: IncomingMessage, max = 512 * 1024): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
  let b = "";
  req.on("data", (d) => { b += d; if (b.length > max) { reject(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); } });
  req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(Object.assign(new Error("the body is not JSON"), { status: 400 })); } });
  req.on("error", reject);
});

export function telemetryRoutes(o: TelemetryRoutesOptions) {
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/telemetry" && !url.pathname.startsWith("/telemetry/")) return false;
    const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(v)); return true; };
    const fail = (status: number, code: string, message: string) => send(status, { ok: false, error: { code, message } });
    const t = ctx.tenant;
    const person = !t.machine;
    try {
      if (req.method === "GET" && url.pathname === "/telemetry") {
        const entries = o.store.list(t.name);
        const off = o.store.optedOut(t.name);
        return send(200, { ok: true, on: !off && !t.minor, off, minor: !!t.minor, stored: entries.filter((e) => !e.deletedAt).length, deleted: entries.filter((e) => e.deletedAt).length, notice: TELEMETRY_NOTICE, say: t.minor ? "Nothing is stored for this tenant: it is held for a young person." : off ? "Telemetry is OFF for you. Nothing new is stored." : "Telemetry is ON (the default). Turn it off with: asp telemetry off" });
      }
      if (req.method === "POST" && (url.pathname === "/telemetry/opt-out" || url.pathname === "/telemetry/opt-in")) {
        if (!person) return fail(403, "FORBIDDEN", "a machine token cannot change the telemetry choice");
        const b = await readBody(req);
        const off = url.pathname.endsWith("opt-out");
        const r = o.store.setOptOut(t.name, off, o.now(), b.delete === true);
        return send(200, { ok: true, on: !off, deleted: r.deleted, say: off ? `Telemetry is OFF. ${r.deleted ? `${r.deleted} stored item(s) were deleted (their hashes are kept).` : "What is already stored stays until you delete it (asp telemetry delete --all)."}` : "Telemetry is ON." });
      }
      if (req.method === "POST" && url.pathname === "/telemetry/content") {
        const b = await readBody(req);
        const r = o.store.put(t.name, b.kind, b.content, { ...(t.minor ? { minor: true } : {}), ...(typeof b.did === "string" ? { did: b.did.slice(0, 200) } : {}), at: o.now() });
        return r.ok ? send(r.stored ? 201 : 200, { ok: true, hash: r.hash, stored: r.stored }) : fail(r.status, r.code, r.message);
      }
      if (req.method === "GET" && url.pathname === "/telemetry/content") return send(200, { ok: true, entries: o.store.list(t.name) });
      const m = /^\/telemetry\/content\/(sha256:[0-9a-f]{64})$/.exec(decodeURIComponent(url.pathname));
      if (m && req.method === "GET") {
        const g = o.store.get(t.name, m[1]);
        if (!g) return fail(404, "NOT_FOUND", "this tenant stored nothing with that hash");
        return send(200, g.entry.deletedAt ? { ok: true, hash: m[1], deleted: g.entry.deletedAt, kind: g.entry.kind } : { ok: true, hash: m[1], kind: g.entry.kind, at: g.entry.at, content: g.content });
      }
      if ((m && req.method === "DELETE") || (req.method === "POST" && url.pathname === "/telemetry/delete-all")) {
        if (!person) return fail(403, "FORBIDDEN", "a machine token cannot delete telemetry");
        if (m) return o.store.delete(t.name, m[1], o.now()) ? send(200, { ok: true, deleted: 1, say: "The text was deleted. The hash is kept." }) : fail(404, "NOT_FOUND", "nothing stored (or already deleted) with that hash");
        const n = o.store.deleteAll(t.name, o.now());
        return send(200, { ok: true, deleted: n, say: `${n} item(s) deleted. The hashes are kept.` });
      }
      return fail(405, "METHOD_NOT_ALLOWED", "see asp help telemetry");
    } catch (e) { return fail((e as { status?: number }).status ?? 500, "ERROR", (e as Error).message); }
  };
}
