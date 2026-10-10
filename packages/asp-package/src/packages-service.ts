/**
 * Per-tenant package storage for the log service (docs/spec-deltas.md S51).
 *
 *   PUT    /packages/<name>   body = a .aspkg.tgz; If-Match: <etag> to replace, If-None-Match: * to create
 *   GET    /packages/<name>   the archive, with an ETag
 *   GET    /packages          the tenant's packages and its storage use
 *   DELETE /packages/<name>   (If-Match optional)
 *
 * Every upload is unpacked and verified (verifyPackage) before it is stored, so the service never holds a
 * package that does not check out. The ETag is the SHA-256 of the stored bytes; an upload that names a stale
 * ETag is refused with 412, so one copy never silently overwrites a newer one. Each tenant has its own
 * folder and a byte quota; an admin may read another tenant's packages with ?tenant=<name>.
 */
import { packageMeta, packageMetaOf, readMetaSidecar, writeMetaSidecar } from "./package-meta.ts";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tenant } from "@agent-social/asp-log";
import { unpackToTemp } from "./archive.ts";
import { verifyPackage } from "./package.ts";

export interface PackageServiceOptions {
  root: string;
  /** Largest single package, in bytes. Default 64 MiB. */
  maxPackageBytes?: number;
  /** Storage per tenant when its entry has no quotaBytes. Default 256 MiB. */
  defaultQuotaBytes?: number;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SUFFIX = ".aspkg.tgz";
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | number> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...headers });
  res.end(text);
}
const fail = (res: ServerResponse, status: number, code: string, message: string, extra: object = {}) =>
  send(res, status, { ok: false, error: { code, message, ...extra } });

async function readRaw(req: IncomingMessage, max: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) return undefined;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

function usage(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(SUFFIX)).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
}

/** The `extra` hook for createLogServer: returns true when it handled the request. */
export function packageRoutes(opts: PackageServiceOptions) {
  const maxPackage = opts.maxPackageBytes ?? 64 * 1024 * 1024;
  const defaultQuota = opts.defaultQuotaBytes ?? 256 * 1024 * 1024;
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/packages" && !url.pathname.startsWith("/packages/")) return false;
    const me = ctx.tenant;
    const asked = url.searchParams.get("tenant");
    if (asked && asked !== me.name && me.role !== "admin") { fail(res, 403, "FORBIDDEN", "only an admin may use another tenant's packages"); return true; }
    const owner = asked ?? me.name;
    if (!NAME.test(owner)) { fail(res, 400, "BAD_TENANT", "tenant name is not usable as a folder"); return true; }
    const dir = join(opts.root, owner);
    const quota = (owner === me.name ? me.quotaBytes : undefined) ?? defaultQuota;
    const method = req.method ?? "GET";

    if (url.pathname === "/packages") {
      if (method !== "GET") { fail(res, 405, "METHOD", "GET /packages"); return true; }
      const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(SUFFIX)) : [];
      const packages = [];
      for (const f of names) {
        const p = join(dir, f);
        const etag = sha256(readFileSync(p));
        // What the package says about its agent (S88): from the sidecar written at upload, or read once now for a package stored before sidecars existed.
        let meta = readMetaSidecar(p, etag);
        if (!meta) { try { meta = await packageMetaOf(p); writeMetaSidecar(p, etag, meta); } catch { /* an archive that is not readable has no meta */ } }
        packages.push({ name: f.slice(0, -SUFFIX.length), etag, bytes: statSync(p).size, updatedAt: statSync(p).mtime.toISOString(), ...(meta ? { agent: meta.agent, meta } : {}) });
      }
      send(res, 200, { ok: true, tenant: owner, usedBytes: usage(dir), quotaBytes: quota, packages });
      return true;
    }

    const name = decodeURIComponent(url.pathname.slice("/packages/".length));
    if (!NAME.test(name)) { fail(res, 400, "BAD_NAME", "a package name is letters, digits, . _ - (up to 100)"); return true; }
    const file = join(dir, name + SUFFIX);
    const current = existsSync(file) ? sha256(readFileSync(file)) : undefined;
    const ifMatch = req.headers["if-match"]?.toString().replace(/"/g, "");
    const ifNone = req.headers["if-none-match"]?.toString();

    if (method === "GET") {
      if (!current) { fail(res, 404, "NOT_FOUND", `no package ${name}`); return true; }
      const bytes = readFileSync(file);
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": bytes.length, etag: `"${current}"` });
      res.end(bytes);
      return true;
    }

    if (owner !== me.name && me.role === "admin" && method !== "DELETE") { fail(res, 403, "FORBIDDEN", "an admin reads another tenant's packages but does not write them"); return true; }

    if (method === "DELETE") {
      if (!current) { fail(res, 404, "NOT_FOUND", `no package ${name}`); return true; }
      if (ifMatch && ifMatch !== current) { fail(res, 412, "STALE", "the stored copy has changed", { etag: current }); return true; }
      rmSync(file);
      rmSync(file + ".meta.json", { force: true });
      send(res, 200, { ok: true });
      return true;
    }

    if (method !== "PUT") { fail(res, 405, "METHOD", "PUT, GET or DELETE"); return true; }
    if (!ifMatch && ifNone !== "*") { fail(res, 428, "PRECONDITION_REQUIRED", "send If-Match: <etag> to replace a package, or If-None-Match: * to create one"); return true; }
    const bytes = await readRaw(req, maxPackage);
    if (!bytes) { fail(res, 413, "TOO_LARGE", `a package may be at most ${maxPackage} bytes`); return true; }
    if (current && ifNone === "*") { fail(res, 412, "EXISTS", `package ${name} already exists; pull it, merge, and push with If-Match`, { etag: current }); return true; }
    if (!current && ifMatch) { fail(res, 412, "STALE", `package ${name} does not exist`); return true; }
    if (current && ifMatch !== current) { fail(res, 412, "STALE", "the service holds a different copy than the one you started from", { etag: current }); return true; }
    if (usage(dir) - (current ? statSync(file).size : 0) + bytes.length > quota) { fail(res, 413, "QUOTA", `this would exceed ${owner}'s storage quota of ${quota} bytes`); return true; }

    const tmp = mkdtempSync(join(tmpdir(), "asp-upload-"));
    try {
      const archive = join(tmp, "upload.tgz");
      writeFileSync(archive, bytes);
      let unpacked: string;
      try { unpacked = await unpackToTemp(archive); } catch { fail(res, 422, "NOT_A_PACKAGE", "the body is not a gzipped tar archive"); return true; }
      try {
        const report = await verifyPackage(unpacked);
        if (!report.ok) { fail(res, 422, "INVALID_PACKAGE", "the package does not verify", { checks: report.checks.filter((c) => c.status === "fail") }); return true; }
        mkdirSync(dir, { recursive: true });
        writeFileSync(file + ".part", bytes); // same folder, so the rename is atomic
        renameSync(file + ".part", file);
        try { writeMetaSidecar(file, sha256(bytes), packageMeta(unpacked)); } catch { /* a listing will read it from the archive instead */ }
        send(res, 200, { ok: true, name, etag: sha256(bytes), bytes: bytes.length, agent: report.agent }, { etag: `"${sha256(bytes)}"` });
      } finally { rmSync(unpacked, { recursive: true, force: true }); }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
    return true;
  };
}
