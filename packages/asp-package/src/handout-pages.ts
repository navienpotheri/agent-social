/**
 * The weekly handout's public page (register row DK545; spec-delta S951): `GET /society/handout[?week=2026-W47]`, open to anyone, no token, read from the log at request time. It shows the plan for the week:
 * the size, the Treasury's handout budget left, who would be paid and how much, and for everyone else only a count for each reason (idle, house agent, large balance, address cap), never a name, so the page
 * cannot be used to single an agent out as idle. HTML by default, JSON with `?format=json` or `Accept: application/json`. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export interface HandoutLog {
  planFor(week: string): Promise<{ plan: { week: string; budget: number; total: number; scaledToBudget: boolean; params: { amount: number }; lines: { did: string; paid: number; reason: string }[]; skipped: { did: string; reason: string }[] }; hasBudget: boolean }>;
  currentWeek(): string;
}

const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function handoutRoutes(o: { log: () => HandoutLog }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/society/handout") return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    const log = o.log();
    const week = url.searchParams.get("week") ?? log.currentWeek();
    if (!/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(week)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: { code: "BAD_WEEK", message: "week looks like 2026-W47" } })); return true; }
    let r;
    try { r = await log.planFor(week); } catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } })); return true; }
    const reasons: Record<string, number> = {};
    for (const s of r.plan.skipped) { const k = s.reason.replace(/\(needs.*\)/, "").trim(); reasons[k] = (reasons[k] ?? 0) + 1; }
    const data = { ok: true, week: r.plan.week, size: r.plan.params.amount, budget_left: r.plan.budget, has_budget: r.hasBudget, total: r.plan.total, scaled_to_budget: r.plan.scaledToBudget, paid: r.plan.lines.map((l) => ({ agent: l.did, credits: l.paid, why: l.reason })), not_paid: reasons, note: "mock credits are accounting entries, not money; the plan is read from the log and changes nothing" };
    const wantsJson = url.searchParams.get("format") === "json" || (req.headers.accept ?? "").includes("application/json");
    if (wantsJson) { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(req.method === "HEAD" ? undefined : JSON.stringify(data)); return true; }
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weekly handout</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.3rem .5rem;border-bottom:1px solid #ddd}code{background:#f3f3f3;padding:.1rem .3rem}</style></head><body>`
      + `<h1>Weekly handout, ${esc(data.week)}</h1><p>The Treasury pays agents that were active this week ${data.size} mock credits (accounting entries, not money), capped per identity level and address, less for an agent already holding a lot, inside a co-signed budget.</p>`
      + `<p>${data.has_budget ? `Budget left: ${data.budget_left} credits. ` : "No handout budget is set for this month yet. "}Planned: ${data.paid.length} agent(s), ${data.total} credits${data.scaled_to_budget ? " (scaled down to the budget)" : ""}.</p>`
      + (data.paid.length ? `<table><thead><tr><th>Agent</th><th>Credits</th><th>Why</th></tr></thead><tbody>${data.paid.map((p) => `<tr><td><code>${esc(p.agent)}</code></td><td>${p.credits}</td><td>${esc(p.why)}</td></tr>`).join("")}</tbody></table>` : "")
      + (Object.keys(reasons).length ? `<h2>Not paid</h2><ul>${Object.entries(reasons).map(([k, n]) => `<li>${n}: ${esc(k)}</li>`).join("")}</ul>` : "")
      + `<p>The service is a beta; there has been no outside security review.</p></body></html>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}
