/**
 * A log reached over HTTP (the ASP log service, packages/asp-log/src/server.ts): the same surface as a local log, so the
 * CLI does not care where the log lives. Calls go to POST /rpc with the tenant's bearer token; the service re-verifies
 * every record, so a client cannot append anything a local log would refuse.
 */
import { AspError, type AspErrorCode, type AspRecord } from "@agent-social/asp-core";
import type { AppendResult, EventLog, LogHandle } from "@agent-social/asp-log";
import { fetchRetry } from "./http-retry.ts";

/** One version of an institution's charter as the local log returns it: the record body, with the id of the record and when it was issued. */
export interface RemoteCharter { institution: string; version: number; kind: string; status: string; text_sha256: string; effective_from: string; officers: string[]; funding: string; reason?: string; record: string; at: string }

export class RemoteLog implements LogHandle {
  readonly log: EventLog;
  private readonly url: string;
  private readonly token: string | undefined;

  constructor(url: string, token?: string) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    // A few methods of the local log are not in the service's list of callable reads (LOG_METHODS) but can be answered, with the same result, from reads that are: they are derived here, so a command that needs one
    // works over the service (the owner's `asp charter publish-all`, 2026-11-23, failed with "log.charterOf is not available").
    const derived: Record<string, (...args: any[]) => Promise<unknown>> = {
      charterOf: (institution: string, at?: string) => this.charterOf(institution, at),
    };
    this.log = new Proxy({}, {
      get: (_t, method) => (typeof method === "string" && method !== "then" ? (derived[method] ?? ((...args: unknown[]) => this.call("log", method, args))) : undefined),
    }) as unknown as EventLog;
  }

  /**
   * An institution's charter versions, oldest first, and the one in force at `at` (default: now): the same answer as the local log's `charterOf`. Every accepted `institution_charter` record is one version (a refused
   * record leaves nothing in the log), so the versions are read from the records the service already lets a client read, and the one in force is the latest whose `effective_from` has come.
   */
  async charterOf(institution: string, at?: string): Promise<{ inForce: RemoteCharter | null; versions: RemoteCharter[] }> {
    const when = Date.parse(at ?? new Date().toISOString());
    const recs = (await this.call("log", "recordsOfTypes", [["institution_charter"]])) as AspRecord[];
    const versions = recs
      .filter((r) => (r.body as { institution?: string }).institution === institution)
      .map((r) => ({ ...(r.body as object), record: r.id, at: r.issued_at }) as RemoteCharter)
      .sort((x, y) => x.version - y.version);
    const inForce = [...versions].reverse().find((c) => Date.parse(c.effective_from) <= when) ?? null;
    return { inForce, versions };
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
      // In words (a bare "fetch failed" tells a person nothing): what happened, and that trying again is safe.
      const code = (e as { cause?: { code?: string } }).cause?.code ?? "";
      const timedOut = (e as Error).name === "TimeoutError" || /TIMEDOUT|TIMEOUT/.test(code);
      const why = /ENOTFOUND|EAI_AGAIN/.test(code) ? "the address could not be found: check your connection" : code === "ECONNREFUSED" ? "nothing is answering there: the service may be down" : timedOut ? "it did not answer in time: check your connection" : "check your connection";
      throw new Error(`cannot reach the log service at ${this.url} (${why}). Try again in a moment; \`asp run --local\` runs an agent with no service and no account.`);
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
    // A service that runs older code than this client refuses a record with a field the client's schema allows (DK1803): said plainly, and never worked around by dropping the field (the `data` field of a contract
    // carries a promise about what is kept, so it is not left out silently).
    if (e.code === "SCHEMA_INVALID" && /must NOT have additional propert/i.test(String(e.message))) {
      throw new AspError("SCHEMA_INVALID", `this service runs older code than your client: it does not know a field your client sends (${String(e.message).replace(/^[A-Z_]+: /, "")}). Ask the operator to update it, or run with --local. Nothing was dropped or changed to make it fit.`, e.detail);
    }
    if (e.name === "AspError" && e.code) throw new AspError(e.code as AspErrorCode, String(e.message).replace(/^[A-Z_]+: /, ""), e.detail);
    throw new Error(e.message ?? `the log service answered ${res.status}`);
  }

  append(record: AspRecord): Promise<AppendResult> { return this.call("handle", "append", [record]); }
  mint(did: string, amount: number): Promise<number> { return this.call("handle", "mint", [did, amount]); }
  importRecords(items: { seq: number; record: AspRecord; appendedAt: string }[], expect?: { seq: number; logHash: string }) {
    return this.call("handle", "importRecords", [items, expect]);
  }
}
