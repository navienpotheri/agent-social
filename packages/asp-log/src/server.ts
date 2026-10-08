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
  createdAt?: string;
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
  tenants?: Tenant[];
  /** No tokens needed. Only for a service bound to 127.0.0.1. */
  noAuth?: boolean;
  /** Largest request body, bytes (default 4 MB). */
  maxBody?: number;
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

export function authenticate(req: IncomingMessage, opts: Pick<ServerOptions, "tenants" | "noAuth">): Tenant | undefined {
  if (opts.noAuth) return NO_AUTH_TENANT;
  const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ""));
  if (!m) return undefined;
  const given = Buffer.from(hashToken(m[1]), "hex");
  for (const t of opts.tenants ?? []) {
    const want = Buffer.from(t.tokenSha256, "hex");
    if (want.length === given.length && timingSafeEqual(want, given)) return t;
  }
  return undefined;
}

export function createLogServer(opts: ServerOptions): Server {
  const maxBody = opts.maxBody ?? 4 * 1024 * 1024;
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
      const tenant = authenticate(req, opts);
      if (!tenant) return json(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "a valid bearer token is required" } });
      if (opts.extra && (await opts.extra(req, res, { tenant }))) return;
      if (req.method !== "POST" || req.url !== "/rpc") return json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "POST /rpc, GET /health" } });
      let call: { target?: string; method?: string; args?: unknown[] };
      try { call = JSON.parse(await readBody(req, maxBody)); } catch (e) {
        return json(res, (e as { status?: number }).status ?? 400, { ok: false, error: { code: "BAD_REQUEST", message: (e as Error).message } });
      }
      const { target, method } = call;
      const args = Array.isArray(call.args) ? call.args : [];
      let fn: ((...a: unknown[]) => unknown) | undefined;
      if (target === "log" && typeof method === "string" && LOG_METHODS.has(method)) fn = (opts.handle.log as any)[method]?.bind(opts.handle.log);
      else if (target === "handle" && typeof method === "string" && TENANT_HANDLE_METHODS.has(method)) fn = (opts.handle as any)[method]?.bind(opts.handle);
      else if (target === "handle" && typeof method === "string" && ADMIN_HANDLE_METHODS.has(method)) {
        if (tenant.role !== "admin") return json(res, 403, { ok: false, error: { code: "FORBIDDEN", message: `${method} needs an admin token` } });
        fn = (opts.handle as any)[method]?.bind(opts.handle);
      }
      if (!fn) return json(res, 404, { ok: false, error: { code: "UNKNOWN_METHOD", message: `${target}.${method} is not available` } });
      try {
        const result = await fn(...args);
        return json(res, 200, result === undefined ? { ok: true, undefined: true } : { ok: true, result });
      } catch (e) {
        const err = e as { name?: string; code?: string; detail?: string; message?: string };
        return json(res, 200, { ok: false, error: { name: err.name, code: err.code ?? "ERROR", detail: err.detail, message: err.message ?? String(e) } });
      }
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (!res.headersSent) json(res, status, { ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } });
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  return server;
}
