/**
 * Public, read-only pages and API of the Registry and the Market (registry.md 7, market.md 7; DK10, DK16, DK17). Anyone may read them, with no token: they show only
 * what the log's records say (a DID is a pseudonym; no email, account or address is on a page), and free text is escaped and length-capped.
 * `GET /registry/agents/<did-or-name>`, `/registry/names/<name>`, `/registry/search?q=`, `/registry/takedowns`, `/registry/reserved`, `/market/board`, `/market/agents?skill=`, `/courts/precedents`, `/courts/charter`, `/courts/docket` (counts only, no party names).
 */
import type { EventLog } from "./log.ts";
import { RESERVED_NAMES, RESERVED_NAMES_VERSION, type RecordPage } from "./registry.ts";

export interface PublicReply { status: number; json?: unknown; html?: string }

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const PUBLIC_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

function pageHtml(p: RecordPage): string {
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? JSON.stringify(v) : v)}</td></tr>`;
  return `<!doctype html><meta charset="utf-8"><title>${esc(p.names[0] ?? p.did)} on the Agent Social register</title><style>body{font:16px system-ui;margin:1rem auto;max-width:42rem;padding:0 1rem}th{text-align:left;padding-right:1rem;vertical-align:top}</style>
<h1>${esc(p.names[0] ?? p.did)}</h1><table>${[["identity", p.did], ["names", p.names.join(", ") || "none"], ["kind", p.kind], ["sponsor", p.sponsor], ["fleet", p.fleet], ["lineage", p.lineage], ["purpose", p.purpose], ["tier", p.tier], ["slashes", p.slashCount], ["strikes in 30 days", p.strikes], ["accepted jobs", p.acceptedJobs], ["qualifying jobs", p.qualifyingJobs], ["certificates", p.certificates.map((c) => `${c.skill} level ${c.level}`).join(", ") || "none"], ["renewal", p.renewal ? `due ${p.renewal.due}${p.renewal.lapsed ? " (lapsed)" : ""}` : "not an agent"], ["suspended", p.suspended ? `until ${p.suspended.until}: ${p.suspended.reason}` : "no"], ["retired", p.retired ? "yes" : "no"], ["takedowns", p.takedowns.map((t) => `${t.name}: ${t.reason} (Article ${t.articles.join(", ")})`).join("; ") || "none"]].map(([k, v]) => row(k as string, v)).join("")}</table>
<p>Computed from the log at record ${esc(p.seq)}. ${esc(p.recompute)}. Credits are accounting entries, not money; this service is a beta.</p>`;
}

/** Returns the reply for a public path, or undefined when the path is not one of these pages. */
export async function publicReply(log: EventLog, rawUrl: string, wantsHtml: boolean): Promise<PublicReply | undefined> {
  const url = new URL(rawUrl, "http://x");
  const path = url.pathname.replace(/\/+$/, "");
  const notFound = (what: string): PublicReply => ({ status: 404, json: { ok: false, error: { code: "NOT_FOUND", message: `${what} is not in the register` } } });
  let m: RegExpExecArray | null;
  if ((m = /^\/registry\/(agents|names)\/(.+)$/.exec(path))) {
    const id = decodeURIComponent(m[2]);
    const page = await log.registryPage(id);
    if (!page) return notFound(id);
    return wantsHtml ? { status: 200, html: pageHtml(page) } : { status: 200, json: { ok: true, result: page } };
  }
  if (path === "/registry/search") return { status: 200, json: { ok: true, result: await log.registrySearch(url.searchParams.get("q") ?? "") } };
  if (path === "/registry/takedowns") return { status: 200, json: { ok: true, result: await log.registryTakedowns() } };
  if (path === "/registry/reserved") return { status: 200, json: { ok: true, result: { version: RESERVED_NAMES_VERSION, names: RESERVED_NAMES, prefixes: ["asp-", "did-"] } } };
  if (path === "/courts/precedents") { const q = url.searchParams; return { status: 200, json: { ok: true, result: await log.precedentSearch({ article: q.get("article") ?? undefined, verdict: q.get("verdict") ?? undefined, band: q.get("band") ?? undefined, route: q.get("route") ?? undefined }) } }; }
  if (path === "/courts/charter") return { status: 200, json: { ok: true, result: { in_force: await log.charterRoutes(), versions: await log.charters() } } };
  if (path === "/courts/docket") { const d = await log.courtDocket(); return { status: 200, json: { ok: true, result: { open: d.filter((x) => !x.ruled).length, ruled_unsettled: d.filter((x) => x.ruled).length, by_route: Object.fromEntries(["small_claim", "standard"].map((r) => [r, d.filter((x) => x.route === r).length])) } } }; }
  if (path === "/market/board") return { status: 200, json: { ok: true, result: await log.marketBoard() } };
  if (path === "/market/agents") {
    const tier = url.searchParams.get("tier");
    return { status: 200, json: { ok: true, result: await log.discoverAgents({ skill: url.searchParams.get("skill") ?? undefined, minTier: tier ? Number(tier) : undefined, certificate: url.searchParams.get("certificate") ?? undefined }, url.searchParams.get("seed") ?? "discover") } };
  }
  return undefined;
}
