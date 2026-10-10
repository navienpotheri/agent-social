/**
 * The dashboard server (gap U2, U3, U7): `asp dashboard` serves one page and a small JSON API over the log on this machine.
 *
 * It is a local tool, not a service: it listens on 127.0.0.1 only, refuses a request whose Host header is not this machine (so a web page elsewhere cannot
 * reach it through DNS tricks), and every API call needs the token printed when it starts. It reads the log afresh on each request, so what it shows is what
 * `asp market show` would show. The one thing it writes is the principal's answer to a waiting approval, signed with the principal's own key from the ASP home.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { createRecord, type Signer } from "@agent-social/asp-core";
import {
  dashboardAgent, dashboardAlerts, dashboardHome, dashboardInbox, dashboardJob, dashboardMoney, readRunLog, type DashboardLog,
} from "@agent-social/asp-package";
import type { LogHandle } from "@agent-social/asp-package";

export interface DashboardOptions {
  token: string;
  /** Opens the log afresh (a local log is read once when opened). */
  openLog: () => Promise<LogHandle>;
  /** The run log file for a contract, if a gateway or `asp run` kept one. */
  runLogFor: (contract: string) => string | undefined;
  /** The key of a DID on this machine, or undefined. */
  signerFor: (did: string) => Signer | undefined;
  now: () => string;
  /** The page, as text; read from dashboard-ui.html when absent. */
  page?: string;
}

const PAGE = new URL("./dashboard-ui.html", import.meta.url);

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": type, "content-length": Buffer.byteLength(text), "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  });
  res.end(text);
}

async function readJson(req: IncomingMessage, max = 64 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw Object.assign(new Error("request body is too large"), { status: 413 }); chunks.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw Object.assign(new Error("the body is not JSON"), { status: 400 }); }
}

export function createDashboard(opts: DashboardOptions): Server {
  const want = Buffer.from(opts.token);
  const tokenOk = (req: IncomingMessage): boolean => {
    const given = Buffer.from(String(req.headers["x-dashboard-token"] ?? ""));
    return given.length === want.length && timingSafeEqual(given, want);
  };
  const hostOk = (req: IncomingMessage, port: number): boolean => {
    const h = String(req.headers.host ?? "").toLowerCase();
    return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
  };
  let page = opts.page;

  const server = createServer(async (req, res) => {
    try {
      const port = (server.address() as { port: number } | null)?.port ?? 0;
      if (!hostOk(req, port)) return send(res, 403, { error: "this dashboard answers only on this machine" });
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        page ??= readFileSync(PAGE, "utf8");
        return send(res, 200, page, "text/html; charset=utf-8");
      }
      if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
      if (!tokenOk(req)) return send(res, 401, { error: "the dashboard token is missing or wrong; open the address `asp dashboard` printed" });

      const handle = await opts.openLog();
      const log = handle.log as unknown as DashboardLog;

      if (req.method === "GET" && url.pathname === "/api/home") return send(res, 200, await dashboardHome(log));
      if (req.method === "GET" && url.pathname === "/api/inbox") return send(res, 200, await dashboardInbox(log));
      if (req.method === "GET" && url.pathname === "/api/alerts") return send(res, 200, await dashboardAlerts(log));
      if (req.method === "GET" && url.pathname === "/api/money") return send(res, 200, await dashboardMoney(log));
      if (req.method === "GET" && url.pathname === "/api/verify") {
        const r = await handle.log.verify();
        return send(res, 200, { ok: r.ok, records: r.records, head: r.head, ...(r.error ? { error: r.error } : {}) });
      }
      if (req.method === "GET" && url.pathname === "/api/agent") {
        const did = url.searchParams.get("did") ?? "";
        const view = await dashboardAgent(log, did);
        return view ? send(res, 200, view) : send(res, 404, { error: `${did} has no passport in the log` });
      }
      if (req.method === "GET" && url.pathname === "/api/job") {
        const id = url.searchParams.get("id") ?? "";
        const file = opts.runLogFor(id);
        const check = file ? readRunLog(file) : undefined;
        const view = await dashboardJob(log, id, check ? { path: file!, ok: check.ok, ...(check.problem ? { problem: check.problem } : {}), events: check.events, head: check.head } : undefined);
        return view ? send(res, 200, view) : send(res, 404, { error: `contract ${id} is not in the log` });
      }
      if (req.method === "POST" && url.pathname === "/api/resolve") {
        const body = await readJson(req);
        const contract = String(body.contract ?? "");
        const verdict = body.verdict === "approved" ? "approved" : body.verdict === "refused" ? "corrected" : undefined;
        if (!verdict) return send(res, 400, { error: "verdict is approved or refused" });
        const chain = await handle.log.chain(contract);
        const first = chain.find((s) => s.record.type === "asp.contract/v0.2");
        const open = [...chain].reverse().find((s) => s.record.type === "asp.checkpoint/v0.2");
        const info = await handle.log.chainInfo(contract);
        if (!first || !open || info?.state !== "Checkpoint") return send(res, 409, { error: "this job has no approval waiting" });
        const principal = first.record.body.principal as string;
        const signer = opts.signerFor(principal);
        if (!signer) return send(res, 409, { error: `there is no key for ${principal} on this machine, so only that person can answer from their own machine` });
        const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : "refused from the dashboard";
        const record = createRecord({
          type: "attestation", issuer: principal, subject: contract, prev: chain.at(-1)!.id, issued_at: opts.now(),
          body: { kind: "checkpoint_resolution", about: open.id, verdict, ...(verdict === "corrected" ? { correction: reason } : {}) },
        }, signer);
        const out = await handle.append(record);
        return send(res, 200, { ok: true, id: out.id, seq: out.seq, state: out.state, verdict: body.verdict });
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (!res.headersSent) send(res, status, { error: (e as Error).message });
    }
  });
  server.requestTimeout = 30_000;
  return server;
}
