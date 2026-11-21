/**
 * The telemetry store's routes for a tenant (owner answer TM1; row DK651). All need the tenant's own token; a machine token may store content but not turn collection off or delete (those stay with the person).
 *   GET    /telemetry                 plain words: on or off, how much is stored, and the notice
 *   POST   /telemetry/opt-out|opt-in  refused with 410 TELEMETRY_NOT_OPTIONAL (DK1303): there is no off switch
 *   POST   /telemetry/opt-in          turn it back on
 *   POST   /telemetry/content         { kind, content, did? } stores it unless off, and answers with the hash the signed log may carry
 *   GET    /telemetry/content         the list (hashes, kinds, dates; never the text)
 *   GET    /telemetry/content/<hash>  the text, or "deleted" with the hash kept
 *   DELETE /telemetry/content/<hash>  removes the text and keeps the hash
 *   POST   /telemetry/delete-all      removes all the text and keeps every hash; the answer carries a deletion receipt (DK1378)
 *   GET    /telemetry/receipts        the tenant's deletion receipts
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
        return send(200, { ok: true, on: !t.minor, minor: !!t.minor, stored: entries.filter((e) => !e.deletedAt).length, deleted: entries.filter((e) => e.deletedAt).length, notice: TELEMETRY_NOTICE, say: t.minor ? "Nothing is stored for this tenant: it is held for a young person." : "Telemetry is ON. It is not optional for an agent; you can list what is stored and delete it (asp telemetry delete --all)." });
      }
      if (req.method === "POST" && (url.pathname === "/telemetry/opt-out" || url.pathname === "/telemetry/opt-in")) return fail(410, "TELEMETRY_NOT_OPTIONAL", "telemetry is not optional for an agent (owner decision, DK1303): there is no off switch; you can list what is stored and delete it with asp telemetry delete --all");
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
      if (req.method === "GET" && url.pathname === "/telemetry/receipts") return send(200, { ok: true, receipts: o.store.receipts(t.name) });
      if ((m && req.method === "DELETE") || (req.method === "POST" && url.pathname === "/telemetry/delete-all")) {
        if (!person) return fail(403, "FORBIDDEN", "a machine token cannot delete telemetry");
        if (m) {
          const r = o.store.deleteWithReceipt(t.name, o.now(), [m[1]]);
          return r.deleted ? send(200, { ok: true, deleted: 1, receipt: r.receipt, say: "The text was deleted. The hash is kept. A receipt of the deletion is attached." }) : fail(404, "NOT_FOUND", "nothing stored (or already deleted) with that hash");
        }
        const r = o.store.deleteWithReceipt(t.name, o.now());
        return send(200, { ok: true, deleted: r.deleted, ...(r.receipt ? { receipt: r.receipt } : {}), say: `${r.deleted} item(s) deleted. The hashes are kept.${r.receipt ? " A receipt of the deletion is attached." : ""}` });
      }
      return fail(405, "METHOD_NOT_ALLOWED", "see asp help telemetry");
    } catch (e) { return fail((e as { status?: number }).status ?? 500, "ERROR", (e as Error).message); }
  };
}
