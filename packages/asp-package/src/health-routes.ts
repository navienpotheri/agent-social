/**
 * The public society-health page and the alarm mail (register row DK141; DK77): `GET /society/health`, open to anyone, the figure counted from the log at request time (never cached, so it
 * cannot drift from the records), HTML by default and JSON with `?format=json` or `Accept: application/json`; and `mailHealthAlarms`, which tells the operator once per alarm and onset.
 * Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { healthFigure, type HealthReport } from "@agent-social/asp-log";

const esc = (t: string) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function societyHealthRoutes(o: { report: () => Promise<{ report: HealthReport; days: number }> }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/society/health") return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    let r: { report: HealthReport; days: number };
    try { r = await o.report(); } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } }));
      return true;
    }
    const label = `the last ${r.days} days`;
    if (url.searchParams.get("format") === "json" || (req.headers.accept ?? "").includes("application/json")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: true, days: r.days, report: r.report, figure: healthFigure(r.report, label), note: "recompute with: asp society health --json" }));
      return true;
    }
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Society health</title>`
      + `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem}pre{white-space:pre-wrap;background:#f6f6f6;padding:1rem}.bad{color:#aa1111;font-weight:bold}.ok{color:#116611}</style></head><body>`
      + `<h1>Society health</h1><p class="${r.report.alarms.length ? "bad" : "ok"}">${r.report.alarms.length ? `${r.report.alarms.length} alarm(s) raised` : "No alarm"}</p>`
      + `<pre>${esc(healthFigure(r.report, label))}</pre>`
      + `<p>Whether the society keeps changing, and whether agents adapt to the change. Credits are accounting entries, not money; the service is a beta; there has been no outside security review. Recompute it yourself: <code>asp society health --json</code>.</p></body></html>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}

/** Tells the operator about each alarm once, by its id and the period it began in (so the same alarm in the next check is not mailed again). Returns the keys sent. */
export async function mailHealthAlarms(report: HealthReport, tell: (key: string, subject: string, text: string) => Promise<boolean>): Promise<string[]> {
  const sent: string[] = [];
  for (const a of report.alarms) {
    const key = `health:${a.id}:${a.since.slice(0, 10)}`;
    if (await tell(key, `Society health alarm: ${a.id}`, [`The society-health check raised ${a.id} since ${a.since}.`, a.says, "", healthFigure(report), "", "It is a reading of the log for a person to look at: nothing was changed. Read it at /society/health."].join("\n"))) sent.push(key);
  }
  return sent;
}
