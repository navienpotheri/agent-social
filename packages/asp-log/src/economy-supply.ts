/**
 * The nightly audit and the public supply page (docs/institutions/economy/credits.md 6.4; register row DK9; CR-18).
 *
 * `runNightlyAudit` is the job: it reads the credit audit, appends one record to a small history file (the same pattern `asp serve`'s mailer
 * uses for its own state: a JSON file beside the tenants file), and says whether this is a *new* mismatch (the verdict just turned from
 * balanced to mismatch), so a caller alerts the operator once per break rather than on every pass while it is still unfixed. `asp serve`
 * calls it on an interval (`--economy-audit-interval`); running it at all on the hosted service, and wiring the interval to a real operator
 * address, is the part only the operator can do (docs/owner-checklist.md).
 *
 * `economySupplyRoutes` serves GET /economy/supply (a page) and GET /economy/supply.json (the same figures as JSON): minted, burned, in
 * circulation, locked, the Treasury, institution accounts, the verdict, the log head, the guard measures (guard-monitor.ts) and, if a
 * history file is given, the last nightly audit and up to 30 days of it. The figures are always computed live from the log; nothing here
 * is cached in a way that could go stale without saying so. No individual account or DID is listed (credit-audit.ts never exposes that).
 * Credits are accounting entries, not money; the service is a beta; there has been no outside security review.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CreditAudit } from "./credit-audit.ts";
import { computeGuardReport, type GuardReport } from "./guard-monitor.ts";
import type { LogHandle } from "./server.ts";

export interface NightlyAuditRecord {
  at: string;
  head: { seq: number; hash: string };
  verdict: "balanced" | "mismatch";
  problems: string[];
  minted: number;
  mintedSigned: number;
  mintedUnsigned: number;
  burned: number;
  treasury: number;
  circulating: number;
}

export interface NightlyAuditResult {
  record: NightlyAuditRecord;
  history: NightlyAuditRecord[];
  /** True only the first time the verdict turns to mismatch; stays false on later passes while it is still unfixed. */
  isNewMismatch: boolean;
}

const HISTORY_LIMIT = 30;

const toRecord = (a: CreditAudit, at: string): NightlyAuditRecord => ({
  at, head: { seq: a.head.seq, hash: a.head.logHash }, verdict: a.verdict, problems: a.problems,
  minted: a.minted, mintedSigned: a.mintedSigned, mintedUnsigned: a.mintedUnsigned,
  burned: a.burned, treasury: a.treasury, circulating: a.circulating,
});

function loadHistory(path: string): NightlyAuditRecord[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveHistory(path: string, records: NightlyAuditRecord[]): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(records, null, 2) + "\n");
  renameSync(tmp, path);
}

/** One pass of the nightly audit: read the ledger, record the verdict, say whether this is a new break. Read-only on the log; it writes only its own history file. */
export async function runNightlyAudit(o: { handle: LogHandle; path?: string; now?: () => number }): Promise<NightlyAuditResult> {
  const now = o.now ? o.now() : Date.now();
  const audit = await o.handle.log.creditAudit();
  const record = toRecord(audit, new Date(now).toISOString());
  const history = o.path ? loadHistory(o.path) : [];
  const wasMismatch = history.length > 0 && history[history.length - 1].verdict === "mismatch";
  const isNewMismatch = record.verdict === "mismatch" && !wasMismatch;
  const next = [...history, record].slice(-HISTORY_LIMIT);
  if (o.path) saveHistory(o.path, next);
  return { record, history: next, isNewMismatch };
}

const esc = (t: unknown): string => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface SupplyBody {
  at: string;
  head: { seq: number; hash: string };
  minted: number; mintedSigned: number; mintedUnsigned: number;
  burned: number; treasury: number; circulating: number;
  institutions: { did: string; balance: number }[];
  locked: { escrow: number; bond: number; feeReserves: number; jurorStakes: number; reportDeposits: number; total: number };
  verdict: "balanced" | "mismatch";
  problems: string[];
  notYet: string[];
  lastNightlyAudit: { at: string; verdict: string } | null;
  series: NightlyAuditRecord[];
  guard: Pick<GuardReport, "measures" | "unavailable" | "anyTriggered">;
}

function renderSupplyPage(b: SupplyBody): string {
  const row = (k: string, v: unknown) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
  const institutions = b.institutions.map((i) => row(i.did, i.balance)).join("") || `<tr><td colspan="2">none registered</td></tr>`;
  const measures = b.guard.measures
    .map((m) => `<tr><td>${esc(m.id)}</td><td>${esc(m.label)}</td><td>${m.value.toFixed(4)}</td><td>${esc(m.threshold)}</td><td>${m.triggered ? "<strong>TRIGGERED</strong>" : "ok"}</td></tr>`)
    .join("");
  const unavailable = b.guard.unavailable.map((u) => `<li><strong>${esc(u.id)}</strong> (${esc(u.label)}): ${esc(u.reason)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Social: the credit supply</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;margin:.5rem 0}td{border-bottom:1px solid #ddd;padding:.25rem .5rem;vertical-align:top}.bad{color:#b00}</style>
</head><body>
<h1>The credit supply</h1>
<p>Credits are accounting entries, not money; they cannot be bought, sold or redeemed. The service is a beta; there has been no outside security review.
This page, and <a href="/economy/supply.json">the JSON it is built from</a>, are computed from the signed log alone: recompute them by replaying the
log (<code>asp credits audit</code>, or <code>auditLedger()</code> in <code>packages/asp-log/src/credit-audit.ts</code>).</p>
<p>Verdict: <strong class="${b.verdict === "balanced" ? "" : "bad"}">${esc(b.verdict)}</strong>${b.problems.length ? `<br>${b.problems.map(esc).join("<br>")}` : ""}
at log head ${b.head.seq} (${esc(b.head.hash.slice(0, 19))}...), read at ${esc(b.at)}.</p>
<table>
${row("Minted, signed records", b.mintedSigned)}
${row("Minted, old unsigned (not reproducible from the log alone)", b.mintedUnsigned)}
${row("Minted total", b.minted)}
${row("Burned", b.burned)}
${row("Treasury", b.treasury)}
${row("In circulation", b.circulating)}
${row("Locked (escrow, bond, court-fee reserves, juror stakes, report deposits)", b.locked.total)}
</table>
<h2>Institution accounts</h2>
<table>${institutions}</table>
<h2>Guard measures</h2>
<table><tr><td><strong>id</strong></td><td><strong>measure</strong></td><td><strong>value</strong></td><td><strong>threshold</strong></td><td><strong>state</strong></td></tr>${measures}</table>
<p>Not measured here yet:</p><ul>${unavailable}</ul>
<p>${b.lastNightlyAudit ? `Last nightly audit: ${esc(b.lastNightlyAudit.at)}, ${esc(b.lastNightlyAudit.verdict)}.` : "No nightly audit has run against this log yet (asp serve --economy-audit-interval runs it)."}
${b.series.length ? ` ${b.series.length} day(s) of history at the JSON endpoint.` : ""}</p>
</body></html>`;
}

/** `publicRoutes` for createLogServer: GET /economy/supply (a page) and GET /economy/supply.json (the same figures). */
export function economySupplyRoutes(o: { handle: LogHandle; historyPath?: string; now?: () => number }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const path = (req.url ?? "/").split("?")[0];
    if (path !== "/economy/supply" && path !== "/economy/supply.json") return false;
    const now = o.now ? o.now() : Date.now();
    const audit = await o.handle.log.creditAudit();
    const guard = await computeGuardReport({ handle: o.handle, ...(o.now ? { now: o.now } : {}) });
    const history = o.historyPath ? loadHistory(o.historyPath) : [];
    const last = history.at(-1);
    const body: SupplyBody = {
      at: new Date(now).toISOString(), head: { seq: audit.head.seq, hash: audit.head.logHash },
      minted: audit.minted, mintedSigned: audit.mintedSigned, mintedUnsigned: audit.mintedUnsigned,
      burned: audit.burned, treasury: audit.treasury, circulating: audit.circulating,
      institutions: audit.institutions, locked: audit.locked, verdict: audit.verdict, problems: audit.problems, notYet: audit.notYet,
      lastNightlyAudit: last ? { at: last.at, verdict: last.verdict } : null, series: history,
      guard: { measures: guard.measures, unavailable: guard.unavailable, anyTriggered: guard.anyTriggered },
    };
    if (path === "/economy/supply.json") {
      const text = JSON.stringify(body, null, 2);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : text);
      return true;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : renderSupplyPage(body));
    return true;
  };
}
