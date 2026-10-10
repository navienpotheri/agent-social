/**
 * The ASP log service (docs/spec-deltas.md S48): one shared log behind HTTP, so many agents, operators and tenants use
 * the same ledger instead of each replaying their own file. It serves the EventLog's own methods over a small
 * allowlisted RPC (POST /rpc), so a client sees exactly the API a local log has. The log still verifies every record's
 * signatures and rules on append; the service adds only access control and limits:
 *  - a bearer token per tenant (stored as a SHA-256 hash), role "tenant" or "admin"; only an admin may mint credits
 *    (a local bootstrap, MOCKS.md #13), and only a tenant or admin may append;
 *  - a body size limit and a request timeout.
 * Private keys never reach the service: records arrive already signed.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { Limits, clientAddress, type LimitOptions, type Verdict } from "./limits.ts";
import { UsageStore } from "./usage.ts";
import type { Signup } from "./signup.ts";
import type { AppendResult } from "./log.ts";
import type { EventLog } from "./log.ts";
import type { AspRecord } from "@agent-social/asp-core";

/** What a log offers its callers, whether it is a local file, a database or a remote service. */
export interface LogHandle {
  log: EventLog;
  append(record: AspRecord): Promise<AppendResult>;
  mint(did: string, amount: number): Promise<number>;
  importRecords(items: { seq: number; record: AspRecord; appendedAt: string }[], expect?: { seq: number; logHash: string }): Promise<{ imported: number; head: { seq: number; logHash: string } }>;
}

export interface Tenant {
  name: string;
  /** SHA-256 hex of the bearer token; the token itself is shown once when created and never stored. */
  tokenSha256: string;
  role: "tenant" | "admin";
  /** Bytes of package storage this tenant may use (the package service falls back to its default). */
  quotaBytes?: number;
  /** Requests per minute for this tenant, replacing the service's default. */
  rateLimitPerMinute?: number;
  /** Records this tenant may write to the log, and bytes of them, replacing the service's defaults (0 for no limit). Admins have none. */
  recordQuota?: number;
  byteQuota?: number;
  /** Set when an operator suspended the tenant: every request is refused with SUSPENDED until it is resumed. */
  suspended?: { at: string; reason?: string };
  createdAt?: string;
  /** Set on a tenant that signed itself up (src/signup.ts): when, a hash of the address, the terms it accepted and an unverified contact line. */
  signup?: { at: string; addressHash: string; termsVersion: string; contact?: string };
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** EventLog methods a client may call: reads, plus verification. Nothing that writes. */
export const LOG_METHODS = new Set([
  "get", "head", "since", "chain", "chainInfo", "passport", "keys", "fleet", "balance", "escrow", "juror", "reputationOf", "mandateOf",
  "verificationOf", "report", "drawPanel", "drawReportPanel", "verify", "verifyCheckpoint", "mints",
]);
const TENANT_HANDLE_METHODS = new Set(["append", "importRecords"]);
const ADMIN_HANDLE_METHODS = new Set(["mint"]);

export interface ServerOptions {
  handle: LogHandle;
  /** Self-serve sign-up (GET /signup, GET /signup/challenge, POST /signup), open to anyone who can reach the service. Absent means no sign-up. */
  signup?: Signup;
  tenants?: Tenant[];
  /** Where to read the tenants from on each request, instead of `tenants`: lets an operator suspend or add a tenant without a restart. */
  tenantSource?: () => Tenant[];
  /** Addresses refused outright (an operator's block list), read on each request. */
  blocked?: () => string[];
  /** Counts of what each tenant has written, and the defaults a tenant without its own quota gets (0 for none). Without a store nothing is counted. */
  usage?: UsageStore;
  defaultRecordQuota?: number;
  defaultByteQuota?: number;
  /** No tokens needed. Only for a service bound to 127.0.0.1. */
  noAuth?: boolean;
  /** Largest request body, bytes (default 4 MB). */
  maxBody?: number;
  /** Serve HTTPS with this certificate and key (PEM). Without it the service speaks plain HTTP: keep it on 127.0.0.1 or behind something that terminates TLS. */
  tls?: { cert: string | Buffer; key: string | Buffer };
  /** Limits per tenant and per address (O2). Absent means none; `asp serve` turns the defaults on. */
  limits?: Limits | LimitOptions;
  /** Read the client's address from X-Forwarded-For (only behind a proxy you control, or anyone can pick their own address). */
  trustProxy?: boolean;
  /** Extra routes, e.g. package storage: return true when handled. */
  extra?: (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }) => Promise<boolean>;
}

function json(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) throw Object.assign(new Error(`request body is larger than ${max} bytes`), { status: 413 });
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const NO_AUTH_TENANT: Tenant = { name: "local", tokenSha256: "", role: "admin" };

export function authenticate(req: IncomingMessage, opts: Pick<ServerOptions, "tenants" | "tenantSource" | "noAuth">): Tenant | undefined {
  if (opts.noAuth) return NO_AUTH_TENANT;
  const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ""));
  if (!m) return undefined;
  const given = Buffer.from(hashToken(m[1]), "hex");
  for (const t of opts.tenantSource?.() ?? opts.tenants ?? []) {
    const want = Buffer.from(t.tokenSha256, "hex");
    if (want.length === given.length && timingSafeEqual(want, given)) return t;
  }
  return undefined;
}

function tooMany(res: ServerResponse, v: Verdict) {
  const retryAfterSec = v.retryAfterSec ?? 1;
  const text = JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: v.why ?? "too many requests", retryAfterSec } });
  res.writeHead(429, { "content-type": "application/json", "content-length": Buffer.byteLength(text), "retry-after": String(retryAfterSec) });
  res.end(text);
}

export function createLogServer(opts: ServerOptions): Server {
  const maxBody = opts.maxBody ?? 4 * 1024 * 1024;
  const limits = opts.limits instanceof Limits ? opts.limits : opts.limits ? new Limits(opts.limits) : undefined;
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    let leave: (() => void) | undefined;
    try {
      if (opts.tls) res.setHeader("strict-transport-security", "max-age=31536000");
      const address = clientAddress(req, !!opts.trustProxy);
      if (opts.blocked?.().includes(address)) return json(res, 403, { ok: false, error: { code: "BLOCKED", message: "this address is blocked by the operator" } });
      if (limits) { const v = limits.checkAddress(address); if (!v.ok) return tooMany(res, v); }
      if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
      if (opts.signup && (req.url === "/signup" || req.url === "/signup/challenge")) {
        if (req.method === "GET" && req.url === "/signup") return json(res, 200, { ok: true, ...opts.signup.info() });
        if (req.method === "GET") return json(res, 200, { ok: true, ...opts.signup.challenge(address) });
        if (req.method === "POST" && req.url === "/signup") {
          let body: unknown;
          try { body = JSON.parse(await readBody(req, 8 * 1024)); } catch { return json(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "the body is JSON, at most 8 KB" } }); }
          const r = opts.signup.register(address, body);
          if (!r.ok) {
            if (r.retryAfterSec) res.setHeader("retry-after", String(r.retryAfterSec));
            return json(res, r.status, { ok: false, error: { code: r.code, message: r.message, ...(r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}) } });
          }
          return json(res, 201, { ok: true, tenant: r.tenant, token: r.token, quotas: r.quotas, termsVersion: r.termsVersion });
        }
        return json(res, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "GET or POST" } });
      }
      const tenant = authenticate(req, opts);
      if (!tenant) {
        limits?.authFailed(address);
        return json(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "a valid bearer token is required" } });
      }
      if (tenant.suspended) return json(res, 403, { ok: false, error: { code: "SUSPENDED", message: `this tenant is suspended${tenant.suspended.reason ? `: ${tenant.suspended.reason}` : ""}` } });
      if (limits) {
        const v = limits.checkTenant(tenant.name, tenant.rateLimitPerMinute);
        if (!v.ok) return tooMany(res, v);
        leave = limits.enter(tenant.name);
        if (!leave) return tooMany(res, { ok: false, retryAfterSec: 1, why: "this tenant has too many requests in flight" });
        res.on("close", leave);
      }
      if (opts.extra && (await opts.extra(req, res, { tenant }))) return;
      if (req.method !== "POST" || req.url !== "/rpc") return json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "POST /rpc, GET /health" } });
      let call: { target?: string; method?: string; args?: unknown[] };
      try { call = JSON.parse(await readBody(req, maxBody)); } catch (e) {
        return json(res, (e as { status?: number }).status ?? 400, { ok: false, error: { code: "BAD_REQUEST", message: (e as Error).message } });
      }
      const { target, method } = call;
      const args = Array.isArray(call.args) ? call.args : [];
      let fn: ((...a: unknown[]) => unknown) | undefined;
      const isWrite = target === "handle" && typeof method === "string" && TENANT_HANDLE_METHODS.has(method);
      if (limits && isWrite) {
        const v = limits.checkWrite(tenant.name);
        if (!v.ok) return tooMany(res, v);
      }
      // A tenant's quota on what it has written (admins have none): refused before the call runs, and not worth repeating.
      const incoming = isWrite ? { records: method === "importRecords" ? ((args[0] as unknown[] | undefined)?.length ?? 0) : 1, bytes: JSON.stringify(args).length } : undefined;
      if (opts.usage && incoming && tenant.role !== "admin") {
        const used = opts.usage.get(tenant.name);
        const recordQuota = tenant.recordQuota ?? opts.defaultRecordQuota ?? 0;
        const byteQuota = tenant.byteQuota ?? opts.defaultByteQuota ?? 0;
        if (recordQuota > 0 && used.records + incoming.records > recordQuota) return json(res, 403, { ok: false, error: { code: "QUOTA_EXCEEDED", message: `this tenant has used its quota of ${recordQuota} records (${used.records} written)` } });
        if (byteQuota > 0 && used.bytes + incoming.bytes > byteQuota) return json(res, 403, { ok: false, error: { code: "QUOTA_EXCEEDED", message: `this tenant has used its quota of ${byteQuota} bytes of records (${used.bytes} written)` } });
      }
      if (target === "log" && typeof method === "string" && LOG_METHODS.has(method)) fn = (opts.handle.log as any)[method]?.bind(opts.handle.log);
      else if (target === "handle" && typeof method === "string" && TENANT_HANDLE_METHODS.has(method)) fn = (opts.handle as any)[method]?.bind(opts.handle);
      else if (target === "handle" && typeof method === "string" && ADMIN_HANDLE_METHODS.has(method)) {
        if (tenant.role !== "admin") return json(res, 403, { ok: false, error: { code: "FORBIDDEN", message: `${method} needs an admin token` } });
        fn = (opts.handle as any)[method]?.bind(opts.handle);
      }
      if (!fn) return json(res, 404, { ok: false, error: { code: "UNKNOWN_METHOD", message: `${target}.${method} is not available` } });
      try {
        const result = await fn(...args);
        if (opts.usage && incoming) opts.usage.add(tenant.name, method === "importRecords" ? ((result as { imported?: number } | undefined)?.imported ?? incoming.records) : 1, incoming.bytes);
        return json(res, 200, result === undefined ? { ok: true, undefined: true } : { ok: true, result });
      } catch (e) {
        const err = e as { name?: string; code?: string; detail?: string; message?: string };
        return json(res, 200, { ok: false, error: { name: err.name, code: err.code ?? "ERROR", detail: err.detail, message: err.message ?? String(e) } });
      }
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (!res.headersSent) json(res, status, { ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } });
    }
  };
  const server = (opts.tls ? createHttpsServer({ cert: opts.tls.cert, key: opts.tls.key }, handler) : createServer(handler)) as unknown as Server;
  server.on("close", () => opts.usage?.flush());
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  return server;
}
