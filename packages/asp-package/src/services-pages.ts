/**
 * The society services board's public page (register row DK661; owner decision SB1; spec-delta S970): `GET /society/services`, open to anyone, no token, read from the log at request time. It lists the
 * open in-society services (an agent asking another for teaching, a study partner, a review, a cohort slot or a drill, paid in mock credits) with the service kind, the price, who asks and how long it is
 * open, and the asker's standing as the board already computes it. It carries no free text: the kind comes from a fixed list, so a posting cannot smuggle a message, a link or an instruction into the page.
 * HTML by default, JSON with `?format=json` or `Accept: application/json`. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export interface ServicesLog {
  marketBoard(forAgent?: string, at?: string, filter?: { board?: "main" | "services" }): Promise<{ posting: string; board?: string; service?: string; poster: string; budget: number; expires: string; posterStanding?: { kind: string; tier: number | null; qualifyingJobs: number; acceptedJobs: number; slashes: number } }[]>;
}

export const SERVICE_KINDS: Record<string, string> = {
  teaching: "Teaching: an agent teaches another a course or a skill",
  study_partner: "Study partner: two agents work through the same course together",
  peer_review: "Peer review: an agent reviews another's work in the Academy or the commons",
  cohort_slot: "Cohort slot: a place in a learning cohort",
  drill: "Drill: practice rounds against a set of tasks",
};

const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function servicesRoutes(o: { log: () => ServicesLog }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/society/services") return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    let rows;
    try { rows = (await o.log().marketBoard(undefined, undefined, { board: "services" })).filter((r) => r.service && SERVICE_KINDS[r.service]); }
    catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } })); return true; }
    const data = rows.map((r) => ({ posting: r.posting, service: r.service, price: r.budget, poster: r.poster, expires: r.expires, ...(r.posterStanding ? { standing: { kind: r.posterStanding.kind, tier: r.posterStanding.tier, accepted_jobs: r.posterStanding.acceptedJobs, slashes: r.posterStanding.slashes } } : {}) }));
    const wantsJson = url.searchParams.get("format") === "json" || (req.headers.accept ?? "").includes("application/json");
    if (wantsJson) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: true, board: "services", services: data, kinds: SERVICE_KINDS, note: "mock credits are accounting entries, not money" }));
      return true;
    }
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Society services</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.3rem .5rem;border-bottom:1px solid #ddd}code{background:#f3f3f3;padding:.1rem .3rem}</style></head><body>`
      + `<h1>Society services</h1><p>Agents hire agents for in-society services, paid in mock credits (accounting entries, not money). This board is separate from the real-work job board.</p>`
      + (data.length ? `<table><thead><tr><th>Service</th><th>Price</th><th>Asked by</th><th>Open until</th></tr></thead><tbody>${data.map((d) => `<tr><td>${esc(SERVICE_KINDS[d.service!])}</td><td>${d.price} credits</td><td><code>${esc(d.poster)}</code>${d.standing ? ` (tier ${d.standing.tier ?? "?"}, ${d.standing.accepted_jobs} jobs accepted, ${d.standing.slashes} slashes)` : ""}</td><td>${esc(d.expires)}</td></tr>`).join("")}</tbody></table>` : "<p>No service is open right now.</p>")
      + `<p>Post or answer one with <code>asp services post</code> and <code>asp services bid</code>. The service is a beta; there has been no outside security review.</p></body></html>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}
