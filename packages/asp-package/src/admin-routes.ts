/**
 * The remote admin interface and its audit trail (register row O18): `POST /admin/tenants/<name>/suspend|resume`, `POST /admin/addresses/block|unblock`, `GET /admin/tenants` and `GET /admin/audit`, for a tenant
 * with the admin role only. Every change, by this API or by the local `asp serve suspend|block` commands, is one line of an append-only, hash-chained audit file (who, what, to whom, why, when, by which door), so the
 * record of who suspended whom cannot be changed without breaking the chain, and `verifyAudit` says so. The service holds no signing key, so the trail is chained, not signed: a signed record of a suspension
 * is not possible here (the register row says what is left). Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { withFileLock, type Tenant } from "@agent-social/asp-log";

export interface AuditEntry { seq: number; at: string; by: string; via: "api" | "local"; action: string; target: string; reason?: string; prev: string; hash: string }
const GENESIS = "sha256:" + "0".repeat(64);
const hashOf = (e: Omit<AuditEntry, "hash">) => `sha256:${createHash("sha256").update(JSON.stringify([e.seq, e.at, e.by, e.via, e.action, e.target, e.reason ?? null, e.prev])).digest("hex")}`;

/** The audit trail of operator actions: one JSON line each, each naming the hash of the line before. */
export class AdminAudit {
  private readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): AuditEntry[] { return existsSync(this.path) ? readFileSync(this.path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEntry) : []; }
  /** Appends one entry under the file lock and returns it. */
  add(e: { at: string; by: string; via: "api" | "local"; action: string; target: string; reason?: string }): AuditEntry {
    let out!: AuditEntry;
    withFileLock(this.path, () => {
      const all = this.read();
      const prev = all.at(-1)?.hash ?? GENESIS;
      const base = { seq: (all.at(-1)?.seq ?? 0) + 1, ...e, prev };
      out = { ...base, hash: hashOf(base) };
      appendFileSync(this.path, JSON.stringify(out) + "\n");
    });
    return out;
  }
  /** Whether the chain is whole: consecutive numbers, each line naming the one before, each hash recomputing. The first problem found, or none. */
  verify(): { ok: boolean; entries: number; problem?: string } {
    const all = this.read();
    let prev = GENESIS;
    for (const [i, e] of all.entries()) {
      const { hash, ...rest } = e;
      if (e.seq !== i + 1) return { ok: false, entries: all.length, problem: `entry ${i + 1} is numbered ${e.seq}: a line was removed or added` };
      if (e.prev !== prev) return { ok: false, entries: all.length, problem: `entry ${e.seq} does not follow the one before it` };
      if (hashOf(rest) !== hash) return { ok: false, entries: all.length, problem: `entry ${e.seq} was changed` };
      prev = hash;
    }
    return { ok: true, entries: all.length };
  }
}

export interface AdminOptions { tokensFile: string; blockedFile: string; audit: AdminAudit; now: () => string }

/** Suspends or resumes a tenant in the tokens file (under the file lock sign-up uses), and records it. Returns an error text or undefined. */
export function setSuspension(o: AdminOptions, by: string, via: "api" | "local", name: string, suspend: boolean, reason?: string): string | undefined {
  let problem: string | undefined;
  withFileLock(o.tokensFile, () => {
    const tenants: Tenant[] = JSON.parse(readFileSync(o.tokensFile, "utf8"));
    const t = tenants.find((x) => x.name === name);
    if (!t) { problem = `no tenant called ${name}`; return; }
    if (t.role === "admin") { problem = `${name} is an admin: an admin is not suspended by this interface`; return; }
    if (suspend) t.suspended = { at: o.now(), ...(reason ? { reason } : {}) }; else delete t.suspended;
    writeFileSync(o.tokensFile, JSON.stringify(tenants, null, 2) + "\n");
  });
  if (!problem) o.audit.add({ at: o.now(), by, via, action: suspend ? "suspend" : "resume", target: name, ...(reason ? { reason } : {}) });
  return problem;
}

export function setBlock(o: AdminOptions, by: string, via: "api" | "local", address: string, block: boolean, minutes?: number, reason?: string): void {
  withFileLock(o.blockedFile, () => {
    const list: { address: string; at: string; until?: string; reason?: string }[] = existsSync(o.blockedFile) ? JSON.parse(readFileSync(o.blockedFile, "utf8")) : [];
    const rest = list.filter((b) => b.address !== address);
    if (block) rest.push({ address, at: o.now(), ...(minutes ? { until: new Date(Date.parse(o.now()) + minutes * 60_000).toISOString() } : {}), ...(reason ? { reason } : {}) });
    writeFileSync(o.blockedFile, JSON.stringify(rest, null, 2) + "\n");
  });
  o.audit.add({ at: o.now(), by, via, action: block ? "block" : "unblock", target: address, ...(reason ? { reason: `${reason}${minutes ? ` (${minutes} minutes)` : ""}` } : minutes ? { reason: `${minutes} minutes` } : {}) });
}

const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
  let b = "";
  req.on("data", (d) => { b += d; if (b.length > 10_000) { reject(new Error("body too large")); req.destroy(); } });
  req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error("the body is not JSON")); } });
  req.on("error", reject);
});

/** The `extra` routes of the log service for the admin interface: refused unless the caller's token is an admin tenant's. */
export function adminRoutes(o: AdminOptions) {
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/admin/")) return false;
    const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(v)); return true; };
    if (ctx.tenant.role !== "admin") return send(403, { ok: false, error: { code: "FORBIDDEN", message: "the admin interface needs an admin token" } });
    const by = ctx.tenant.name;
    try {
      if (req.method === "GET" && url.pathname === "/admin/audit") {
        const limit = Math.max(1, Math.min(1000, Math.trunc(Number(url.searchParams.get("limit") ?? 100)) || 100));
        return send(200, { ok: true, chain: o.audit.verify(), entries: o.audit.read().slice(-limit) });
      }
      if (req.method === "GET" && url.pathname === "/admin/tenants") {
        const tenants: Tenant[] = JSON.parse(readFileSync(o.tokensFile, "utf8"));
        return send(200, { ok: true, tenants: tenants.map((t) => ({ name: t.name, role: t.role, suspended: t.suspended ?? null })) });
      }
      if (req.method !== "POST") return send(405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "GET or POST" } });
      const body = await readBody(req);
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : undefined;
      const m = /^\/admin\/tenants\/([^/]+)\/(suspend|resume)$/.exec(url.pathname);
      if (m) {
        const problem = setSuspension(o, by, "api", decodeURIComponent(m[1]), m[2] === "suspend", reason);
        return problem ? send(404, { ok: false, error: { code: "REFUSED", message: problem } }) : send(200, { ok: true, tenant: decodeURIComponent(m[1]), action: m[2] });
      }
      const b = /^\/admin\/addresses\/(block|unblock)$/.exec(url.pathname);
      if (b) {
        const address = typeof body.address === "string" ? body.address : "";
        const minutes = body.minutes === undefined ? undefined : Number(body.minutes);
        if (!/^[0-9a-fA-F:.]{3,45}$/.test(address)) return send(400, { ok: false, error: { code: "BAD_REQUEST", message: "address is an IP address" } });
        if (minutes !== undefined && !(minutes > 0 && minutes <= 525_600)) return send(400, { ok: false, error: { code: "BAD_REQUEST", message: "minutes is a positive number" } });
        setBlock(o, by, "api", address, b[1] === "block", minutes, reason);
        return send(200, { ok: true, address, action: b[1] });
      }
      return send(404, { ok: false, error: { code: "NOT_FOUND", message: "POST /admin/tenants/<name>/suspend|resume, POST /admin/addresses/block|unblock, GET /admin/tenants, GET /admin/audit" } });
    } catch (e) {
      return send(400, { ok: false, error: { code: "BAD_REQUEST", message: (e as Error).message } });
    }
  };
}
