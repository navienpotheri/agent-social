/**
 * A log reached over HTTP (the ASP log service, packages/asp-log/src/server.ts): the same surface as a local log, so the
 * CLI does not care where the log lives. Calls go to POST /rpc with the tenant's bearer token; the service re-verifies
 * every record, so a client cannot append anything a local log would refuse.
 */
import { AspError, type AspErrorCode, type AspRecord } from "@agent-social/asp-core";
import type { AppendResult, EventLog, LogHandle } from "@agent-social/asp-log";
import { fetchRetry } from "./http-retry.ts";

export class RemoteLog implements LogHandle {
  readonly log: EventLog;
  private readonly url: string;
  private readonly token: string | undefined;

  constructor(url: string, token?: string) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.log = new Proxy({}, {
      get: (_t, method) => (typeof method === "string" && method !== "then" ? (...args: unknown[]) => this.call("log", method, args) : undefined),
    }) as unknown as EventLog;
  }

  private async call(target: "log" | "handle", method: string, args: unknown[]): Promise<any> {
    let res: Response;
    // A 429 means the service refused the call before running it, so it is safe to repeat after the wait it asks for.
    try {
      res = await fetchRetry(`${this.url}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: JSON.stringify({ target, method, args }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new Error(`cannot reach the log service at ${this.url}: ${(e as Error).message}`);
    }
    if (res.status === 429) {
      const b: any = await res.json().catch(() => undefined);
      throw new Error(`the log service is rate limiting this client: ${b?.error?.message ?? "too many requests"} (try again in ${res.headers.get("retry-after") ?? "a few"} seconds)`);
    }
    let body: any;
    try { body = await res.json(); } catch { throw new Error(`the log service at ${this.url} answered ${res.status} with no JSON`); }
    if (body.ok) return body.undefined ? undefined : body.result;
    const e = body.error ?? {};
    if (res.status === 401) throw new Error(`the log service refused the request: ${e.message ?? res.status} (set ASP_LOG_TOKEN)`);
    if (res.status === 403) throw new Error(`the log service refused the request: ${e.message ?? res.status}${e.code ? ` (${e.code})` : ""}`);
    if (e.name === "AspError" && e.code) throw new AspError(e.code as AspErrorCode, String(e.message).replace(/^[A-Z_]+: /, ""), e.detail);
    throw new Error(e.message ?? `the log service answered ${res.status}`);
  }

  append(record: AspRecord): Promise<AppendResult> { return this.call("handle", "append", [record]); }
  mint(did: string, amount: number): Promise<number> { return this.call("handle", "mint", [did, amount]); }
  importRecords(items: { seq: number; record: AspRecord; appendedAt: string }[], expect?: { seq: number; logHash: string }) {
    return this.call("handle", "importRecords", [items, expect]);
  }
}
