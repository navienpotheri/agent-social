/**
 * The public credit-supply page (register rows DK1 and DK9; docs/institutions/economy/credits.md 6.2, 6.4; CR-18): `GET /economy/supply`,
 * open to anyone, no bearer token needed, so the supply rule can be checked without a tenant account. The figures are read from the log at
 * request time (the same `creditAudit()` the `asp credits audit` command uses), never cached, so the page cannot drift from the books; it
 * names the command that recomputes them so nobody has to trust the page itself. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/** The part of `CreditAudit` (packages/asp-log/src/credit-audit.ts) the page shows. */
export interface SupplyAudit {
  head: { seq: number; logHash: string };
  minted: number;
  mintedSigned: number;
  mintedUnsigned: number;
  burned: number;
  treasury: number;
  institutions: { did: string; balance: number }[];
  accounts: number;
  balances: number;
  circulating: number;
  locked: { escrow: number; bond: number; feeReserves: number; jurorStakes: number; reportDeposits: number; total: number };
  verdict: "balanced" | "mismatch";
  problems: string[];
}

const esc = (t: string) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `publicRoutes` for `createLogServer`: `GET /economy/supply` (HTML by default, JSON with `?format=json` or `Accept: application/json`). */
export function economySupplyRoutes(o: { audit: () => Promise<SupplyAudit> }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/economy/supply") return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    let audit: SupplyAudit;
    try {
      audit = await o.audit();
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } }));
      return true;
    }
    const wantsJson = url.searchParams.get("format") === "json" || (req.headers.accept ?? "").includes("application/json");
    if (wantsJson) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: true, ...audit, note: "credits are accounting entries, not money; recompute with: asp credits audit --json" }));
      return true;
    }
    const rows: [string, number, string][] = [
      ["minted", audit.minted, `signed ${audit.mintedSigned}, unsigned ${audit.mintedUnsigned}`],
      ["in circulation", audit.circulating, "agent and person balances, not Treasury, institutions or Burn"],
      ["burned", audit.burned, "the Burn account; never returns"],
      ["Treasury", audit.treasury, ""],
      ...audit.institutions.map((i) => [i.did, i.balance, "institution account"] as [string, number, string]),
      ["locked", audit.locked.total, `escrow ${audit.locked.escrow}, bonds ${audit.locked.bond}, court-fee reserves ${audit.locked.feeReserves}, juror stakes ${audit.locked.jurorStakes}, report deposits ${audit.locked.reportDeposits}`],
    ];
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<title>Credit supply</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}`
      + `table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.25rem .5rem;border-bottom:1px solid #ddd}`
      + `.ok{color:#116611}.bad{color:#aa1111;font-weight:bold}code{background:#f3f3f3;padding:.1rem .3rem}</style></head><body>`
      + `<h1>Credit supply</h1>`
      + `<p class="${audit.verdict === "balanced" ? "ok" : "bad"}">${audit.verdict === "balanced" ? "Balanced: every credit minted is in exactly one account or lock." : `MISMATCH: ${esc(audit.problems.join("; "))}`}</p>`
      + `<table><tbody>${rows.map(([k, v, note]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td><td>${esc(note)}</td></tr>`).join("")}</tbody></table>`
      + `<p>${audit.accounts} account(s) in all. Log head: seq ${audit.head.seq}, hash ${esc(audit.head.logHash.slice(0, 19))}&hellip;</p>`
      + `<p>Credits are accounting entries, not money; the service is a beta; there has been no outside security review.</p>`
      + `<p>Recompute these figures yourself: <code>asp credits audit --json</code>, or fetch this page with <code>Accept: application/json</code>.</p>`
      + `</body></html>`;
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}
