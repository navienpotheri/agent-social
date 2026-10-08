/** Client for the package routes of the log service (packages-service.ts; docs/spec-deltas.md S51). */

/** A refusal from the package service: `code` is its error code (STALE, EXISTS, QUOTA, INVALID_PACKAGE, ...). */
export class PackageServiceError extends Error {
  readonly code: string;
  readonly etag?: string;
  constructor(code: string, message: string, etag?: string) { super(message); this.name = "PackageServiceError"; this.code = code; this.etag = etag; }
}

export interface RemotePackage { name: string; etag: string; bytes: number; updatedAt: string }
export interface RemoteListing { tenant: string; usedBytes: number; quotaBytes: number; packages: RemotePackage[] }

export class PackagesClient {
  private url: string;
  private token?: string;
  private tenant?: string;
  constructor(url: string, token?: string, tenant?: string) { this.url = url; this.token = token; this.tenant = tenant; }

  private async call(method: string, path: string, init: { body?: Buffer; headers?: Record<string, string> } = {}) {
    const u = new URL(path, this.url.endsWith("/") ? this.url : this.url + "/");
    if (this.tenant) u.searchParams.set("tenant", this.tenant);
    const res = await fetch(u, {
      method,
      headers: { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...init.headers },
      ...(init.body ? { body: new Uint8Array(init.body) } : {}),
      signal: AbortSignal.timeout(120_000),
    });
    return res;
  }

  private async fail(res: Response): Promise<never> {
    if (res.status === 401 || res.status === 403) throw new Error("the package service refused the request (set ASP_LOG_TOKEN to a token for this service)");
    let body: any;
    try { body = await res.json(); } catch { /* not json */ }
    const e = body?.error;
    const detail = e?.checks ? ` (${e.checks.map((c: any) => `${c.name}: ${c.detail}`).join("; ")})` : "";
    throw new PackageServiceError(e?.code ?? `HTTP_${res.status}`, `${e?.message ?? res.statusText}${detail}`, e?.etag);
  }

  async list(): Promise<RemoteListing> {
    const res = await this.call("GET", "packages");
    if (!res.ok) return this.fail(res);
    return (await res.json()) as RemoteListing;
  }

  /** Uploads an archive. `etag` is the copy it was based on, or undefined to create a new package. */
  async push(name: string, archive: Buffer, etag?: string): Promise<{ etag: string; bytes: number; agent?: string }> {
    const res = await this.call("PUT", `packages/${encodeURIComponent(name)}`, {
      body: archive,
      headers: { "content-type": "application/octet-stream", ...(etag ? { "if-match": `"${etag}"` } : { "if-none-match": "*" }) },
    });
    if (!res.ok) return this.fail(res);
    return (await res.json()) as { etag: string; bytes: number; agent?: string };
  }

  async pull(name: string): Promise<{ etag: string; bytes: Buffer }> {
    const res = await this.call("GET", `packages/${encodeURIComponent(name)}`);
    if (!res.ok) return this.fail(res);
    return { etag: (res.headers.get("etag") ?? "").replace(/"/g, ""), bytes: Buffer.from(await res.arrayBuffer()) };
  }

  async remove(name: string, etag?: string): Promise<void> {
    const res = await this.call("DELETE", `packages/${encodeURIComponent(name)}`, { headers: etag ? { "if-match": `"${etag}"` } : {} });
    if (!res.ok) return this.fail(res);
  }
}
