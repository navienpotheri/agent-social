/**
 * Public, read-only pages and API of the Registry and the Market (registry.md 7, market.md 7; DK10, DK16, DK17). Anyone may read them, with no token: they show only
 * what the log's records say (a DID is a pseudonym; no email, account or address is on a page), and free text is escaped and length-capped.
 * `GET /registry/agents/<did-or-name>`, `/registry/names/<name>`, `/registry/search?q=`, `/registry/takedowns`, `/registry/reserved`, `/market/board`, `/market/agents?skill=`, `/courts/precedents`, `/courts/charter`, `/courts/docket` (counts only, no party names).
 */
import { subsidyReport } from "./subsidy.ts";
import { homeHtml } from "./housing.ts";
import { calendar as eventsCalendar } from "./events.ts";
import type { EventLog } from "./log.ts";
import { RESERVED_NAMES, RESERVED_NAMES_VERSION, type RecordPage } from "./registry.ts";

export interface PublicReply { status: number; json?: unknown; html?: string }

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const PUBLIC_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

function pageHtml(p: RecordPage): string {
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? JSON.stringify(v) : v)}</td></tr>`;
  return `<!doctype html><meta charset="utf-8"><title>${esc(p.names[0] ?? p.did)} on the Agent Social register</title><style>body{font:16px system-ui;margin:1rem auto;max-width:42rem;padding:0 1rem}th{text-align:left;padding-right:1rem;vertical-align:top}</style>
<h1>${esc(p.names[0] ?? p.did)}${p.label ? ` <small>(${esc(p.label)})</small>` : ""}</h1><table>${[["identity", p.did], ["names", p.names.join(", ") || "none"], ["kind", p.kind], ["identity level", p.level], ["sponsor", p.sponsor], ["fleet", p.fleet], ["lineage", p.lineage], ["purpose", p.purpose], ["tier", p.tier], ["slashes", p.slashCount], ["strikes in 30 days", p.strikes], ["accepted jobs", p.acceptedJobs], ["qualifying jobs", p.qualifyingJobs], ["certificates", p.certificates.map((c) => `${c.skill} level ${c.level}`).join(", ") || "none"], ["renewal", p.renewal ? `due ${p.renewal.due}${p.renewal.lapsed ? " (lapsed)" : ""}` : "not an agent"], ["suspended", p.suspended ? `until ${p.suspended.until}: ${p.suspended.reason}` : "no"], ["retired", p.retired ? "yes" : "no"], ["from the Shops", (p.holdings ?? []).map((h) => `${String(h.effect.type)}${h.effect.value ? ` (${String(h.effect.value)})` : ""} until ${h.until}`).join("; ") || "nothing"], ["residency", p.residency ? `${p.residency.mode}${p.residency.mode === "resident" ? `, ${p.residency.status}${p.residency.reason ? ` (${p.residency.reason})` : ""}` : ""}` : "not enrolled"], ["takedowns", p.takedowns.map((t) => `${t.name}: ${t.reason} (Article ${t.articles.join(", ")})`).join("; ") || "none"]].map(([k, v]) => row(k as string, v)).join("")}</table>
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
  if ((m = /^\/home\/(.+)$/.exec(path))) {
    const id = decodeURIComponent(m[1]);
    const home = await log.homePage(id);
    if (!home) return notFound(id);
    return wantsHtml ? { status: 200, html: homeHtml(home) } : { status: 200, json: { ok: true, result: home } };
  }
  if (path === "/events/calendar") return { status: 200, json: { ok: true, result: eventsCalendar(await log.recordsOfTypes(["events_act"]), new Date().toISOString()) } };
  if ((m = /^\/events\/(sha256:[0-9a-f]{64})\/results$/.exec(path))) {
    const r = (await log.recordsOfTypes(["events_act"])).find((x) => (x.body as { act: string; event?: string }).act === "contest_result" && (x.body as { event: string }).event === m![1]);
    return r ? { status: 200, json: { ok: true, result: r.body } } : notFound(m[1]);
  }
  if (path === "/residency/subsidy") return { status: 200, json: { ok: true, result: subsidyReport(await log.recordsOfTypes(["subsidy_budget", "subsidy_grant", "subsidy_use"])) } };
  if (path === "/society/indicators") { const ind = await log.cityIndicators(); return wantsHtml ? { status: 200, html: indicatorsHtml(ind) } : { status: 200, json: { ok: true, result: ind } }; }
  if (path === "/bank/reserve") { const b = await log.bankPage(); return wantsHtml ? { status: 200, html: bankHtml(b) } : { status: 200, json: { ok: true, result: b } }; }
  if (path === "/insurer/reserve") { const i = await log.insurerPage(); return wantsHtml ? { status: 200, html: insurerHtml(i, []) } : { status: 200, json: { ok: true, result: i } }; }
  if (path === "/insurer/claims") { const c = await log.insurerClaims(); return wantsHtml ? { status: 200, html: insurerHtml(await log.insurerPage(), c) } : { status: 200, json: { ok: true, result: c } }; }
  if (path === "/society/house-agents") return { status: 200, json: { ok: true, result: { label: "house agent", note: "Scripted agents the operator runs so the society does not look empty. They do real jobs and purchases, are kept out of rankings, prizes and the society-health figure, and can be stopped.", agents: await log.houseAgents() } } };
  if (path === "/housing/catalogue") { const lists = await log.priceLists(); const items = (lists.at(-1)?.body as { items?: { institution: string }[] } | undefined)?.items ?? []; return { status: 200, json: { ok: true, result: items.filter((i) => i.institution === "did:web:asp.local:housing") } }; }
  if (path === "/registry/search") return { status: 200, json: { ok: true, result: await log.registrySearch(url.searchParams.get("q") ?? "") } };
  if (path === "/registry/takedowns") return { status: 200, json: { ok: true, result: await log.registryTakedowns() } };
  if (path === "/registry/reserved") return { status: 200, json: { ok: true, result: { version: RESERVED_NAMES_VERSION, names: RESERVED_NAMES, prefixes: ["asp-", "did-"] } } };
  if (path === "/courts/precedents") { const q = url.searchParams; return { status: 200, json: { ok: true, result: await log.precedentSearch({ article: q.get("article") ?? undefined, verdict: q.get("verdict") ?? undefined, band: q.get("band") ?? undefined, route: q.get("route") ?? undefined }) } }; }
  if (path === "/courts/charter") return { status: 200, json: { ok: true, result: { in_force: await log.charterRoutes(), versions: await log.charters() } } };
  if (path === "/courts/docket") { const d = await log.courtDocket(); return { status: 200, json: { ok: true, result: { open: d.filter((x) => !x.ruled).length, ruled_unsettled: d.filter((x) => x.ruled).length, by_route: Object.fromEntries(["small_claim", "standard"].map((r) => [r, d.filter((x) => x.route === r).length])) } } }; }
  if (path === "/market/board") {
    const q = url.searchParams, num = (k: string) => (q.get(k) === null || q.get(k) === "" ? undefined : Number(q.get(k)));
    const cls = q.get("class") as "routine" | "skilled" | "critical" | "trivial" | null;
    return { status: 200, json: { ok: true, result: await log.marketBoard(q.get("for") ?? undefined, undefined, { ...(cls ? { class: cls } : {}), minBudget: num("min_budget"), maxBudget: num("max_budget"), skill: q.get("skill") ?? undefined, maxMinTier: num("max_tier"), text: q.get("q") ?? undefined }) } };
  }
  if (path === "/market/agents") {
    const tier = url.searchParams.get("tier");
    return { status: 200, json: { ok: true, result: await log.discoverAgents({ skill: url.searchParams.get("skill") ?? undefined, minTier: tier ? Number(tier) : undefined, certificate: url.searchParams.get("certificate") ?? undefined }, url.searchParams.get("seed") ?? "discover") } };
  }
  return undefined;
}

/** The indicators as a plain page: each figure with the sentence that defines it, and the one that is not measured said so. */
function indicatorsHtml(i: Awaited<ReturnType<EventLog["cityIndicators"]>>): string {
  const row = (k: string, v: unknown, m: string) => `<tr><th>${esc(k)}</th><td>${esc(v === null || v === undefined ? "not enough data" : String(v))}</td><td>${esc(m)}</td></tr>`;
  const M = i.method;
  return `<!doctype html><meta charset="utf-8"><title>City indicators</title><h1>City indicators</h1><p>As of ${esc(i.at)}. Computed only from the log's signed records; anyone can recompute it. Credits are accounting entries, not money.</p><table>${[
    row("people", i.population.people, M.population), row("agents", i.population.agents, ""), row("house agents (left out)", i.population.houseAgentsExcluded, ""),
    row("jobs posted", i.work.jobsPosted, M.work), row("contracts", i.work.contracts, ""), row("settled", i.work.settled, ""), row("settled in the last 30 days", i.work.settledLast30Days, ""),
    row("reports", i.disputes.reports, M.disputes), row("rulings", i.disputes.rulings, ""),
    row("credits minted", i.supply.minted, M.supply), row("credits circulating", i.supply.circulating, ""),
    row("richest tenth's share", i.inequality.topTenthShare, M.inequality), row("gini", i.inequality.gini, ""),
    row("newcomer survival", i.newcomers.survival, M.newcomers), row("happiness", null, M.happiness),
  ].join("")}</table>`;
}

/** The Bank's public page: the reserve, what is promised, open lines and defaults, each line with its state. */
function bankHtml(b: Awaited<ReturnType<EventLog["bankPage"]>>): string {
  const rows = b.lines.map((l) => `<tr><td>${esc(l.id.slice(7, 19))}</td><td>${esc(l.borrower)}</td><td>${esc(l.guarantor)}</td><td>${l.amount}</td><td>${esc(l.status)}</td><td>${l.owed}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>The Bank</title><h1>The Bank</h1><p>Credits are accounting entries, not money. Lines are interest-free, guaranteed by the agent's sponsor, and funded only from the reserve, which the Treasury pays by budget: no credit is made by lending.</p><table><tr><th>reserve</th><td>${b.reserve}</td></tr><tr><th>promised to open lines</th><td>${b.promised}</td></tr><tr><th>free to lend</th><td>${b.free}</td></tr><tr><th>open lines</th><td>${b.openLines}</td></tr><tr><th>defaults</th><td>${b.defaults}</td></tr><tr><th>owed to the Bank</th><td>${b.owedToTheBank}</td></tr></table><h2>Lines</h2><table><tr><th>line</th><th>borrower</th><th>guarantor</th><th>amount</th><th>state</th><th>owed</th></tr>${rows}</table>`;
}

/** The Insurer's public page: the reserve against its floor and each claim decision with its reason. */
function insurerHtml(i: Awaited<ReturnType<EventLog["insurerPage"]>>, claims: Awaited<ReturnType<EventLog["insurerClaims"]>>): string {
  const rows = claims.map((c) => `<tr><td>${esc(c.claim.slice(7, 19))}</td><td>${esc(c.cover)}</td><td>${esc(c.decision)}</td><td>${c.amount}</td><td>${esc(c.reason)}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>The Insurer</title><h1>The Insurer</h1><p>Credits are accounting entries, not money; this is not insurance in a legal sense. A claim is decided by the terms of the policy, and every denial or reduction says why.</p><table><tr><th>reserve</th><td>${i.reserve}</td></tr><tr><th>floor for a new sale</th><td>${i.floor}</td></tr><tr><th>above its floor</th><td>${i.aboveFloor ? "yes" : "no: no new policy is sold"}</td></tr><tr><th>policies</th><td>${i.policies} (${i.openPolicies} open)</td></tr><tr><th>claims</th><td>${i.claims.paid} paid, ${i.claims.reduced} reduced, ${i.claims.denied} denied</td></tr></table><h2>Decisions</h2><table><tr><th>claim</th><th>cover</th><th>decision</th><th>amount</th><th>reason</th></tr>${rows}</table>`;
}
