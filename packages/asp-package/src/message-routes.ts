/**
 * The sealed text of direct messages (register row DK1346; spec-delta S1595): the log carries who sent what kind of message to whom and the hash and size of the text, never the text. This service keeps the text and gives it only
 * to the tenants that answer for one of the two agents (the agent's own tenant, or the sponsor's): `POST /messages/text` stores the text of a message the tenant's agent signed (the hash and the size must match the record) and
 * `GET /messages` lists the messages an agent sent and received, with the text for those who may read it. The wake signal is the front door's pulse (`/society/pulse?did=`): a message names its recipient, so it counts as
 * something for that agent. Credits are accounting entries, not money; nothing here has had an outside security review.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { LogHandle, OwnerStore, Tenant } from "@agent-social/asp-log";

export interface MessageRouteOptions { handle: LogHandle; owners: Pick<OwnerStore, "of">; dir: string }

const send = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); return true; };
const fail = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, { ok: false, error: { code, message } });
const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
  let b = ""; req.on("data", (d) => { b += d; if (b.length > 20_000) { reject(new Error("body too large")); req.destroy(); } });
  req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error("the body is not JSON")); } });
  req.on("error", reject);
});

export class MessageTextStore {
  private readonly dir: string;
  constructor(dir: string) { this.dir = dir; mkdirSync(dir, { recursive: true }); }
  private path(id: string): string { return join(this.dir, createHash("sha256").update(id).digest("hex") + ".json"); }
  has(id: string): boolean { return existsSync(this.path(id)); }
  get(id: string): { text: string } | undefined { try { return JSON.parse(readFileSync(this.path(id), "utf8")) as { text: string }; } catch { return undefined; } }
  put(id: string, text: string): void { const p = this.path(id); writeFileSync(`${p}.tmp`, JSON.stringify({ id, text }), { mode: 0o600 }); renameSync(`${p}.tmp`, p); }
}

interface Msg { id: string; from: string; to: string; kind: string; at: string; seq: number; bytes: number; sha: string }

export function messageRoutes(o: MessageRouteOptions) {
  const store = new MessageTextStore(o.dir);
  /** Whether this tenant answers for a DID: it owns the identity, or it is the sponsor of the agent. */
  const mayRead = async (tenant: Tenant, did: string): Promise<boolean> => {
    const mine = o.owners.of(tenant.name);
    if (mine.includes(did)) return true;
    const p = (await o.handle.log.passport(did)) as { sponsor?: string | null } | undefined | null;
    return !!p?.sponsor && mine.includes(p.sponsor);
  };
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/messages" && url.pathname !== "/messages/text") return false;
    const me = ctx.tenant;
    try {
      if (req.method === "POST" && url.pathname === "/messages/text") {
        const b = await readBody(req);
        const id = typeof b.record === "string" ? b.record : "", text = typeof b.text === "string" ? b.text : "";
        const rec = id ? await o.handle.log.get(id) : undefined;
        if (!rec || rec.record.type !== "asp.agent_message/v0.2") return fail(res, 404, "NOT_A_MESSAGE", `${id || "(no record)"} is not a message in the log: append the record first`);
        const body = rec.record.body as { body_sha256: string; bytes: number };
        if (!(await mayRead(me, rec.record.issuer))) return fail(res, 403, "NOT_YOURS", "the text of a message is stored by the tenant that answers for its sender");
        if (createHash("sha256").update(text).digest("hex") !== body.body_sha256 || Buffer.byteLength(text) !== body.bytes) return fail(res, 400, "TEXT_MISMATCH", "the text is not the one the record commits to (its SHA-256 and size)");
        if (store.has(id)) return fail(res, 409, "ALREADY_STORED", "the text of this message is stored already");
        store.put(id, text);
        return send(res, 201, { ok: true, record: id });
      }
      if (req.method === "GET" && url.pathname === "/messages") {
        const did = url.searchParams.get("did") ?? "";
        const since = Math.max(0, Math.floor(Number(url.searchParams.get("since")) || 0));
        if (!did) return fail(res, 400, "BAD_REQUEST", "?did=<an agent you answer for>[&since=<seq>]");
        if (!(await mayRead(me, did))) return fail(res, 403, "NOT_YOURS", `${did} is not an agent you own or sponsor: only the tenants that answer for it read its messages`);
        const out: (Omit<Msg, "sha"> & { text?: string })[] = [];
        for (let after = since; ;) {
          const page = await o.handle.log.since(after, 500);
          if (!page.length) break;
          for (const s of page) {
            after = s.seq;
            if (s.record.type !== "asp.agent_message/v0.2") continue;
            const b = s.record.body as { to: string; kind: string; bytes: number };
            if (s.record.issuer !== did && b.to !== did) continue;
            const t = store.get(s.id);
            out.push({ id: s.id, from: s.record.issuer, to: b.to, kind: b.kind, at: s.record.issued_at, seq: s.seq, bytes: b.bytes, ...(t ? { text: t.text } : {}) });
          }
        }
        return send(res, 200, { ok: true, did, since, messages: out, head: (await o.handle.log.head()).seq });
      }
      return fail(res, 405, "METHOD_NOT_ALLOWED", "GET /messages or POST /messages/text");
    } catch (e) { return fail(res, 400, "BAD_REQUEST", (e as Error).message); }
  };
}
