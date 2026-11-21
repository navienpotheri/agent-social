/**
 * The sandbox (DK1382, docs/enterprise-fleets.md): a place where an enterprise tries the platform safely. A sandbox is a service of its own, started with `asp serve --sandbox`, on a log of its own, and the two
 * can never be confused: a log directory carries an ENVIRONMENT marker, a sandbox refuses to open a production log and a production service refuses to open a sandbox log. Everything the sandbox sends is marked
 * (a response header and a banner on every page); test credits are free and unlimited in meaning, capped per request and in all; and `asp serve reset-sandbox` clears the log and the service's state while keeping
 * the tenants. Records the users sign carry no mark (a signature cannot be edited): what separates them is the log they are in. Credits are accounting entries, not money.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogHandle } from "@agent-social/asp-log";
import type { Tenant } from "@agent-social/asp-log";

export const SANDBOX_BANNER = "SANDBOX: test data on a test log, no real consequences. Credits here are free and are not money.";
export const SANDBOX_CREDITS_PER_REQUEST = 10_000;
export const SANDBOX_CREDITS_PER_TENANT = 1_000_000;

/** Reads or writes the environment marker of a log directory; refuses the mix-up either way. */
export function checkEnvironment(dir: string, want: "sandbox" | "production"): void {
  const marker = join(dir, "ENVIRONMENT");
  const has = existsSync(marker) ? readFileSync(marker, "utf8").trim() : undefined;
  if (has && has !== want) throw new Error(`${dir} is a ${has} log: a ${want} service does not open it (a sandbox and production never share a log)`);
  if (!has) {
    if (want === "sandbox" && existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} already holds a log that is not marked as a sandbox: a sandbox starts on a new, empty directory so that it can never be production data`);
    if (want === "sandbox") { mkdirSync(dir, { recursive: true }); writeFileSync(marker, "sandbox\n"); }
  }
}

/** Clears a sandbox: the log and the service's own state (owners, usage, telemetry, starter, credits given), keeping the tenants file. Refuses anything that is not marked sandbox. */
export function resetSandbox(dir: string, tokensFile: string | undefined): { removed: string[] } {
  const marker = join(dir, "ENVIRONMENT");
  if (!existsSync(marker) || readFileSync(marker, "utf8").trim() !== "sandbox") throw new Error(`${dir} is not marked as a sandbox: nothing was removed`);
  const removed: string[] = [];
  for (const f of readdirSync(dir)) if (f !== "ENVIRONMENT") { rmSync(join(dir, f), { recursive: true, force: true }); removed.push(join(dir, f)); }
  if (tokensFile) for (const suffix of [".dids.json", ".usage.json", ".telemetry", ".starter.json", ".sandbox-credits.json", ".keyonly-pending.json"]) { const p = tokensFile + suffix; if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); } }
  return { removed };
}

/** Marks every response of a sandbox: a header on all, a banner on every HTML page. */
export function markSandbox(res: ServerResponse): void {
  res.setHeader("x-asp-environment", "sandbox");
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => ServerResponse;
  const end = res.end.bind(res) as (...a: unknown[]) => ServerResponse;
  let html = false;
  (res as { writeHead: unknown }).writeHead = (status: number, ...rest: unknown[]) => {
    const headers = rest.find((x) => x && typeof x === "object") as Record<string, string> | undefined;
    const type = String(headers?.["content-type"] ?? res.getHeader("content-type") ?? "");
    html = type.startsWith("text/html");
    if (html && headers) { const h = { ...headers }; delete h["content-length"]; rest = rest.map((x) => (x === headers ? h : x)); }
    if (html) res.removeHeader("content-length");
    return writeHead(status, ...rest);
  };
  (res as { end: unknown }).end = (chunk?: unknown, ...rest: unknown[]) => {
    if (html && (typeof chunk === "string" || Buffer.isBuffer(chunk))) {
      const banner = `<div style="background:#b45309;color:#fff;padding:8px 14px;font:600 14px system-ui,sans-serif;text-align:center" role="note">${SANDBOX_BANNER}</div>`;
      const text = chunk.toString("utf8");
      chunk = /<body[^>]*>/i.test(text) ? text.replace(/<body[^>]*>/i, (m) => m + banner) : banner + text;
    }
    return end(chunk, ...rest);
  };
}

export interface SandboxRoutesOptions { handle: LogHandle; owners: { of(tenant: string): string[] }; file?: string }

/** `POST /sandbox/credits { did, amount }`: free test credits for an identity the tenant has written as, capped per request and per tenant. `GET /sandbox` says what this is. */
export function sandboxRoutes(o: SandboxRoutesOptions) {
  const given: Record<string, number> = (() => { try { return o.file && existsSync(o.file) ? JSON.parse(readFileSync(o.file, "utf8")) : {}; } catch { return {}; } })();
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== "/sandbox" && path !== "/sandbox/credits") return false;
    const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(v)); return true; };
    const t = ctx.tenant;
    if (req.method === "GET" && path === "/sandbox") return send(200, { ok: true, environment: "sandbox", banner: SANDBOX_BANNER, credits: { perRequest: SANDBOX_CREDITS_PER_REQUEST, perTenant: SANDBOX_CREDITS_PER_TENANT, given: given[t.name] ?? 0 } });
    if (req.method !== "POST") return send(405, { ok: false, error: { code: "METHOD", message: "GET /sandbox or POST /sandbox/credits" } });
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    let b: { did?: unknown; amount?: unknown } = {};
    try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* empty */ }
    const amount = Number(b.amount);
    if (typeof b.did !== "string" || !Number.isInteger(amount) || amount < 1 || amount > SANDBOX_CREDITS_PER_REQUEST) return send(400, { ok: false, error: { code: "BAD_REQUEST", message: `did and amount (1 to ${SANDBOX_CREDITS_PER_REQUEST}) are needed` } });
    if (!o.owners.of(t.name).includes(b.did)) return send(400, { ok: false, error: { code: "NOT_YOURS", message: `${b.did} is not an identity this tenant has written as; create it through the service first` } });
    if ((given[t.name] ?? 0) + amount > SANDBOX_CREDITS_PER_TENANT) return send(429, { ok: false, error: { code: "SANDBOX_CREDITS_FULL", message: `a sandbox tenant gets at most ${SANDBOX_CREDITS_PER_TENANT} test credits in all; asp serve reset-sandbox starts again` } });
    const balance = await o.handle.mint(b.did, amount);
    given[t.name] = (given[t.name] ?? 0) + amount;
    if (o.file) writeFileSync(o.file, JSON.stringify(given));
    return send(200, { ok: true, did: b.did, credits: amount, balance, note: "Test credits in a sandbox: accounting entries, not money, and they exist nowhere else." });
  };
}
