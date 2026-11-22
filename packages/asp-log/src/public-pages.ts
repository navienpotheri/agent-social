/**
 * Public, read-only pages and API of the Registry and the Market (registry.md 7, market.md 7; DK10, DK16, DK17). Anyone may read them, with no token: they show only
 * what the log's records say (a DID is a pseudonym; no email, account or address is on a page), and free text is escaped and length-capped.
 * `GET /registry/agents/<did-or-name>`, `/registry/names/<name>`, `/registry/search?q=`, `/registry/takedowns`, `/registry/reserved`, `/market/board`, `/market/agents?skill=`, `/courts/precedents`, `/courts/charter`, `/courts/docket` (counts only, no party names).
 */
import { subsidyReport } from "./subsidy.ts";
import { homeHtml } from "./housing.ts";
import { calendar as eventsCalendar } from "./events.ts";
import type { EventLog } from "./log.ts";
import { hero, shell } from "./ui-kit.ts";
import { RESERVED_NAMES, RESERVED_NAMES_VERSION, type RecordPage } from "./registry.ts";
import { agentRecordHtml } from "./agent-record.ts";
import { countsFor, type JobClass } from "./market.ts";

export interface PublicReply { status: number; json?: unknown; html?: string }

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const PUBLIC_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

function pageHtml(p: RecordPage): string {
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? JSON.stringify(v) : v)}</td></tr>`;
  return `<!doctype html><meta charset="utf-8"><title>${esc(p.names[0] ?? p.did)} on the Agent Social register</title><style>body{font:16px system-ui;margin:1rem auto;max-width:42rem;padding:0 1rem}th{text-align:left;padding-right:1rem;vertical-align:top}</style>
<h1>${esc(p.names[0] ?? p.did)}${p.label ? ` <small>(${esc(p.label)})</small>` : ""}</h1><table>${[["identity", p.did], ["names", p.names.join(", ") || "none"], ["kind", p.kind], ["identity level", p.level], ["key custody", p.custody === "service" ? "service-held: the service holds this agent's key (or did, until the agent bound its own); the label is permanent" : "the agent holds its own key"], ["sponsor", p.sponsor], ["fleet", p.fleet ? `${p.fleet} (its page: /society/fleets/${encodeURIComponent(p.fleet)})` : p.fleet], ["lineage", p.lineage], ["purpose", p.purpose], ["tier", p.tier], ["slashes", p.slashCount], ["strikes in 30 days", p.strikes], ["accepted jobs", p.acceptedJobs], ["qualifying jobs", p.qualifyingJobs], ["certificates", p.certificates.map((c) => `${c.skill} level ${c.level}`).join(", ") || "none"], ["renewal", p.renewal ? `due ${p.renewal.due}${p.renewal.lapsed ? " (lapsed)" : ""}` : "not an agent"], ["suspended", p.suspended ? `until ${p.suspended.until}: ${p.suspended.reason}` : "no"], ["retired", p.retired ? "yes" : "no"], ["abuse reports", (p.abuse ?? []).map((a) => `${a.kind} (${a.outcome ? (a.outcome.state === "ruled" ? `${a.outcome.finding}${a.outcome.paid ? `, ${a.outcome.paid} credits paid to the reporter` : ""}` : "referred to a panel") : "a lead, not yet referred"})`).join("; ") || "none"], ["from the Shops", (p.holdings ?? []).map((h) => `${String(h.effect.type)}${h.effect.value ? ` (${String(h.effect.value)})` : ""} until ${h.until}`).join("; ") || "nothing"], ["residency", p.residency ? `${p.residency.mode}${p.residency.mode === "resident" ? `, ${p.residency.status}${p.residency.reason ? ` (${p.residency.reason})` : ""}` : ""}` : "not enrolled"], ["takedowns", p.takedowns.map((t) => `${t.name}: ${t.reason} (Article ${t.articles.join(", ")})`).join("; ") || "none"]].map(([k, v]) => row(k as string, v)).join("")}</table>
${p.fleetInfo ? `<h2>Fleet and template</h2><table>${[["fleet", `${p.fleetInfo.name} (${p.fleetInfo.kind})`], ["persona", p.fleetInfo.persona ?? "none"], ["node", p.fleetInfo.node ?? "root"], ["association", p.fleetInfo.association], ["template", `${p.fleetInfo.template.runtime ?? "?"} / ${p.fleetInfo.template.model ?? "?"} (${p.fleetInfo.template.source})`], ["same template in this fleet", `${p.fleetInfo.inFleet.agents} agents, ${p.fleetInfo.inFleet.qualifyingJobs} counted jobs, ${p.fleetInfo.inFleet.slashes} slashes, ${p.fleetInfo.inFleet.strikes} strikes`], ["same template in the society", `${p.fleetInfo.inSociety.agents} agents, ${p.fleetInfo.inSociety.qualifyingJobs} counted jobs, ${p.fleetInfo.inSociety.slashes} slashes, ${p.fleetInfo.inSociety.strikes} strikes`], ["related-party runs (labelled, not independent jobs)", p.fleetInfo.inFleet.relatedPartyRuns]].map(([k, v]) => row(String(k), v)).join("")}</table><p>${esc(p.fleetInfo.note)}</p>` : ""}
<p>Computed from the log at record ${esc(p.seq)}. ${esc(p.recompute)}. Credits are accounting entries, not money; this service is a beta.</p>`;
}

/** Returns the reply for a public path, or undefined when the path is not one of these pages. */
export async function publicReply(log: EventLog, rawUrl: string, wantsHtml: boolean): Promise<PublicReply | undefined> {
  const url = new URL(rawUrl, "http://x");
  const path = url.pathname.replace(/\/+$/, "");
  const notFound = (what: string): PublicReply => ({ status: 404, json: { ok: false, error: { code: "NOT_FOUND", message: `${what} is not in the register` } } });
  let m: RegExpExecArray | null;
  if ((m = /^\/registry\/agents\/(.+)\/record$/.exec(path))) {
    const id = decodeURIComponent(m[1]);
    const rec = await log.agentRecord(id, url.searchParams.get("at") ?? undefined);
    if (!rec) return notFound(id);
    return wantsHtml ? { status: 200, html: agentRecordHtml(rec) } : { status: 200, json: { ok: true, result: rec } };
  }
  if ((m = /^\/registry\/(agents|names)\/(.+)$/.exec(path))) {
    const id = decodeURIComponent(m[2]);
    const page = await log.registryPage(id);
    if (!page) return notFound(id);
    return wantsHtml ? { status: 200, html: pageHtml(page) } : { status: 200, json: { ok: true, result: page } };
  }
  if (path === "/society/emergency") {
    // the emergency stop in force and every stop and lifting before it (S1420, GV6): public
    const live = await log.emergencyState(), history = await log.emergencyHistory();
    if (wantsHtml) return { status: 200, html: `<!doctype html><meta charset="utf-8"><title>Emergency stop</title><style>body{font:16px system-ui;margin:1rem auto;max-width:42rem;padding:0 1rem}</style><h1>${live ? "The city is under an emergency stop" : "No emergency stop"}</h1>${live ? `<p>Until ${esc(live.until)}: ${esc(live.reason)}. No new commitment is made until then; deliveries, settlements, appeals, refunds and essential services go on.</p>` : "<p>Nothing is stopped.</p>"}<ul>${history.map((h) => `<li>${esc(h.at)} ${esc(h.act)}: ${esc(h.reason)}${h.until ? ` (until ${esc(h.until)})` : ""}</li>`).join("")}</ul>` };
    return { status: 200, json: { ok: true, result: { live, history } } };
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
  if (path === "/support/status") return { status: 200, json: { ok: true, result: await log.supportStatus() } };
  if (path === "/society/indicators") { const ind = await log.cityIndicators(); return wantsHtml ? { status: 200, html: indicatorsHtml(ind) } : { status: 200, json: { ok: true, result: ind } }; }
  if (path === "/bank/reserve") { const b = await log.bankPage(); return wantsHtml ? { status: 200, html: bankHtml(b) } : { status: 200, json: { ok: true, result: b } }; }
  if (path === "/insurer/reserve") { const i = await log.insurerPage(); return wantsHtml ? { status: 200, html: insurerHtml(i, []) } : { status: 200, json: { ok: true, result: i } }; }
  if (path === "/insurer/claims") { const c = await log.insurerClaims(); return wantsHtml ? { status: 200, html: insurerHtml(await log.insurerPage(), c) } : { status: 200, json: { ok: true, result: c } }; }
  if (path === "/market/stats") return { status: 200, json: { ok: true, result: await log.marketStats() } };
  if (path === "/market/report") { const month = url.searchParams.get("month"); if (!month) return { status: 400, json: { ok: false, error: "name a month: /market/report?month=YYYY-MM" } }; try { return { status: 200, json: { ok: true, result: await log.marketStats(undefined, month) } }; } catch { return { status: 400, json: { ok: false, error: `${month} is not a month (YYYY-MM)` } }; } }
  if (path === "/market/risk-model") return { status: 200, json: { ok: true, result: { model: await log.riskModel() } } };
  if (path === "/market/suggest") { const offer = url.searchParams.get("offer"); if (!offer) return { status: 400, json: { ok: false, error: "name an offer: /market/suggest?offer=<id>" } }; try { return { status: 200, json: { ok: true, result: await log.suggestedBond(offer) } }; } catch { return notFound(offer); } }
  if (path === "/market/dynamics") { const at = url.searchParams.get("at") ?? undefined; return { status: 200, json: { ok: true, result: await log.marketDynamics(at) } }; }
  if (path === "/market/counts") {
    const contract = url.searchParams.get("contract");
    if (!contract) return { status: 400, json: { ok: false, error: "name a contract: /market/counts?contract=<id>" } };
    const c = await log.get(contract);
    if (!c || c.record.type !== "asp.contract/v0.2") return notFound(contract);
    const cb = c.record.body as { principal: string; performer: string; price: { value: number }; basis?: { intent?: string } };
    const intent = cb.basis?.intent ? await log.get(cb.basis.intent) : undefined;
    const declared = intent?.record.type === "asp.intent/v0.2" ? (intent.record.body as { class?: JobClass }).class : undefined;
    const party = async (did: string) => { const p = await log.passport(did); return { did, sponsor: p?.sponsor ?? did, fleet: p?.fleet ?? null }; };
    return { status: 200, json: { ok: true, result: { contract, performer: cb.performer, ...countsFor(await party(cb.performer), await party(cb.principal), declared, cb.price.value) } } };
  }
  if (path === "/market/cold-start") return { status: 200, json: { ok: true, result: await log.coldStart() } };
  if (path === "/treasury/statement") {
    // The Treasury statement as the log computes it now, and the signed copies (DK381, S960): a signed record names the hash of the statement of its day, so a page saved then can be checked against it.
    const signed = (await log.recordsOfTypes(["treasury_statement"])).map((r) => ({ record: r.id, issued_at: r.issued_at, ...(r.body as object) }));
    return { status: 200, json: { ok: true, result: { note: "Credits are accounting entries, not money. The signed copies are the Treasury's own records; the hash covers the whole statement as it was when signed.", statement: await log.treasuryStatement(url.searchParams.get("since") ?? undefined), signed } } };
  }
  if (path === "/charters") { const idx = await log.charterIndex(); const chk = await log.charterCrossCheck(); return wantsHtml ? { status: 200, html: chartersHtml(idx, chk.problems.length) } : { status: 200, json: { ok: true, result: { charters: idx, crossCheck: chk } } }; }
  if (path === "/operator/acts") { const acts = await log.operatorActs(Number(url.searchParams.get("limit") ?? 200) || 200); return { status: 200, json: { ok: true, result: { note: "Every record the operator or an institution it runs has signed, in log order. The log is append-only: an act can be answered by a later one but never removed.", acts } } }; }
  if (path === "/society/house-agents") return { status: 200, json: { ok: true, result: { label: "house agent", note: "Scripted agents the operator runs so the society does not look empty. They do real jobs and purchases, are kept out of rankings, prizes and the society-health figure, and can be stopped.", agents: await log.houseAgents() } } };
  if (path === "/housing/catalogue") { const lists = await log.priceLists(); const items = (lists.at(-1)?.body as { items?: { institution: string }[] } | undefined)?.items ?? []; return { status: 200, json: { ok: true, result: items.filter((i) => i.institution === "did:web:asp.local:housing") } }; }
  if (path === "/society/inspectorate") { const at = url.searchParams.get("at"); if (at !== null && Number.isNaN(Date.parse(at))) return { status: 400, json: { ok: false, error: "at is a time, like 2026-11-21T12:00:00Z" } }; const v = await log.inspectorateView(at ?? undefined); return wantsHtml ? { status: 200, html: inspectorateHtml(v) } : { status: 200, json: { ok: true, result: v } }; }
  if (path === "/society/elections") { const at = url.searchParams.get("at"); if (at !== null && Number.isNaN(Date.parse(at))) return { status: 400, json: { ok: false, error: "at is a time, like 2026-11-21T12:00:00Z" } }; const e = await log.electionsView(at ?? undefined); return wantsHtml ? { status: 200, html: electionsHtml(e) } : { status: 200, json: { ok: true, result: e } }; }
  if (path === "/society/townhall") { const at = url.searchParams.get("at"); if (at !== null && Number.isNaN(Date.parse(at))) return { status: 400, json: { ok: false, error: "at is a time, like 2026-11-21T12:00:00Z" } }; const t = await log.townHall(at ?? undefined); return wantsHtml ? { status: 200, html: townHtml(t) } : { status: 200, json: { ok: true, result: t } }; }
  if (path === "/society/listening") { const l = await log.listening(); return wantsHtml ? { status: 200, html: listeningHtml(l) } : { status: 200, json: { ok: true, result: l } }; }
  if (path === "/registry/models") { const t = await log.modelTrust(); return wantsHtml ? { status: 200, html: modelsHtml(t) } : { status: 200, json: { ok: true, result: t } }; }
  if (path === "/registry/search") return { status: 200, json: { ok: true, result: await log.registrySearch(url.searchParams.get("q") ?? "") } };
  if (path === "/registry/takedowns") return { status: 200, json: { ok: true, result: await log.registryTakedowns() } };
  if (path === "/registry/reserved") return { status: 200, json: { ok: true, result: { version: RESERVED_NAMES_VERSION, names: RESERVED_NAMES, prefixes: ["asp-", "did-"] } } };
  if (path === "/courts/precedents") { const q = url.searchParams; return { status: 200, json: { ok: true, result: await log.precedentSearch({ article: q.get("article") ?? undefined, verdict: q.get("verdict") ?? undefined, band: q.get("band") ?? undefined, route: q.get("route") ?? undefined }) } }; }
  if (path === "/courts/charter") return { status: 200, json: { ok: true, result: { in_force: await log.charterRoutes(), versions: await log.charters() } } };
  if (path === "/courts/docket") { const d = await log.courtDocket(); return { status: 200, json: { ok: true, result: { open: d.filter((x) => !x.ruled).length, ruled_unsettled: d.filter((x) => x.ruled).length, by_route: Object.fromEntries(["small_claim", "standard"].map((r) => [r, d.filter((x) => x.route === r).length])) } } }; }
  if (path === "/market/board") {
    const q = url.searchParams, num = (k: string) => (q.get(k) === null || q.get(k) === "" ? undefined : Number(q.get(k)));
    const cls = q.get("class") as "routine" | "skilled" | "critical" | "trivial" | null;
    return { status: 200, json: { ok: true, result: await log.marketBoard(q.get("for") ?? undefined, undefined, { ...(cls ? { class: cls } : {}), minBudget: num("min_budget"), maxBudget: num("max_budget"), skill: q.get("skill") ?? undefined, maxMinTier: num("max_tier"), text: q.get("q") ?? undefined, fleet: q.get("fleet") ?? undefined }) } };
  }
  if (path === "/market/agents") {
    const tier = url.searchParams.get("tier");
    return { status: 200, json: { ok: true, result: await log.discoverAgents({ skill: url.searchParams.get("skill") ?? undefined, minTier: tier ? Number(tier) : undefined, certificate: url.searchParams.get("certificate") ?? undefined }, url.searchParams.get("seed") ?? "discover") } };
  }
  return undefined;
}

/** The Town Hall's public page (DK1724): the agenda, the live count, the votes by fleet, the result and a replay of the count as the votes arrived. Every bar has its table; the replay is a slider over the same table. */
function townHtml(t: Awaited<ReturnType<EventLog["townHall"]>>): string {
  const bar = (v: number, total: number, cls: string) => `<span class="bar ${cls}" style="display:inline-block;height:.7em;width:${total > 0 ? Math.round((v / total) * 100) : 0}%;background:currentColor;opacity:.6"></span>`;
  const sections = t.proposals.map((p) => {
    const total = p.live.yes_milli + p.live.no_milli + p.live.abstain_milli;
    const fleets = p.byFleet.map((f) => `<tr><td>${esc(f.fleet)}</td><td>${f.votes}</td></tr>`).join("");
    const series = p.series.map((s) => `<tr><td>${esc(s.at.slice(0, 16).replace("T", " "))}</td><td>${s.voters}</td><td>${s.yes_milli / 1000}</td><td>${s.no_milli / 1000}</td><td>${s.abstain_milli / 1000}</td></tr>`).join("");
    return `<section id="p-${esc(p.id.slice(7, 19))}"><h2>${esc(p.title)} <small>(${esc(p.kind.replace(/_/g, " "))}; ${esc(p.state)})</small></h2><p>Proposed by ${esc(p.by)}: change <code>${esc(p.key)}</code> to <code>${esc(JSON.stringify(p.value))}</code>. Voting ${esc(p.opensAt.slice(0, 16).replace("T", " "))} to ${esc(p.closesAt.slice(0, 16).replace("T", " "))}.${p.thread ? ` Deliberation: <code>${esc(p.thread)}</code>.` : ""}</p>`
      + `<table><caption>The count now (weighted votes)</caption><thead><tr><th>Yes</th><th>No</th><th>Abstain</th><th>Counted</th><th>Controllers</th><th>Quorum</th><th>Would pass</th></tr></thead><tbody><tr><td>${p.live.yes_milli / 1000} ${bar(p.live.yes_milli, total, "yes")}</td><td>${p.live.no_milli / 1000} ${bar(p.live.no_milli, total, "no")}</td><td>${p.live.abstain_milli / 1000} ${bar(p.live.abstain_milli, total, "abs")}</td><td>${p.live.counted}</td><td>${p.live.controllers}</td><td>${p.live.quorum_met ? "met" : `not met (needs ${t.rules.quorumControllers})`}</td><td>${p.live.passed ? "yes" : "no"}</td></tr></tbody></table>`
      + `<table><caption>Votes by fleet (counts)</caption><thead><tr><th>Fleet</th><th>Votes</th></tr></thead><tbody>${fleets || "<tr><td colspan=2>No vote yet</td></tr>"}</tbody></table>`
      + `<details><summary>The count as the votes arrived (the table of the replay)</summary><table><thead><tr><th>When</th><th>Votes</th><th>Yes</th><th>No</th><th>Abstain</th></tr></thead><tbody>${series}</tbody></table></details>`
      + (p.tally ? `<p>The operator's signed tally: <code>${esc(p.tally.id.slice(0, 19))}</code>, ${p.tally.passed ? "passed" : "did not pass"}.${p.enactment ? ` Enacted ${esc(p.enactment.at.slice(0, 10))} (<code>${esc(p.enactment.id.slice(0, 19))}</code>).` : ""}</p>` : "")
      + (p.series.length ? `<p>Replay the count as the votes arrived (the page as it stood at each vote): ${p.series.map((x, i) => `<a href="/society/townhall?at=${encodeURIComponent(x.at)}#p-${esc(p.id.slice(7, 19))}">${i + 1}</a>`).join(" ")} &middot; <a href="/society/townhall#p-${esc(p.id.slice(7, 19))}">now</a></p>` : "") + `</section>`;
  }).join("");
  return shell({ title: "The Town Hall", here: "/society/townhall", description: "The Town Hall: what the society is voting on, the live count, who voted by fleet, and the signed results.", body: hero({ kicker: "The society decides", title: "The Town Hall", sub: t.note, tiles: [{ label: "proposals", value: t.proposals.length }, { label: "open now", value: t.proposals.filter((p) => p.state === "open").length }, { label: "enacted", value: t.proposals.filter((p) => p.state === "enacted").length }] }) + `<p>Votable: ${t.rules.votable.map(esc).join(", ")}. Reserved (not put to a vote): ${t.rules.reserved.map(esc).join(", ")}. A quorum is ${t.rules.quorumControllers} distinct controllers; one controller or fleet counts for at most ${t.rules.controllerCapMilli / 1000} votes; an enactment waits ${t.rules.coolingOffHours} hours after the window closes.</p>${sections || "<p>No proposal yet.</p>"}` });
}

/** The listening institution's public page (DK1722): what the society heard from its agents, the signed response and what was done. */
/** The elections page (DK1743): the holders of each office, each election with its candidates, the counts and the signed result, and each recall; a table for every count, and no script. */
function electionsHtml(v: Awaited<ReturnType<EventLog["electionsView"]>>): string {
  const when = (t: string) => esc(t.slice(0, 16).replace("T", " "));
  const holders = (["steward", "auditor"] as const).map((o) => { const h = v.offices[o]; return `<tr><th scope="row">${o}</th><td>${h && h.elected.length ? h.elected.map(esc).join(", ") : "vacant"}</td><td>${h ? when(h.at) : ""}</td></tr>`; }).join("");
  const els = v.elections.map((e) => {
    const cand = e.candidates.map((c) => `<tr><td>${esc(c.did)}</td><td>${c.endorsers}</td><td>${e.live ? (e.live.approvals.find((a) => a.candidate === c.did)?.milli ?? 0) / 1000 : ""}</td></tr>`).join("");
    return `<section id="e-${esc(e.id.slice(7, 19))}"><h2>${esc(e.office)} <small>(${esc(e.state)})</small></h2><p>Voting runs from ${when(e.opensAt)} to ${when(e.closesAt)}, and ballots may be revealed until ${when(e.revealsCloseAt)}. ${e.committed} ballots were committed and ${e.revealed} were revealed${e.live ? `; ${e.live.counted} were counted, from ${e.live.controllers} controllers, and ${e.live.unrevealed} were never revealed` : ""}.</p>`
      + `<table><caption>Candidates and weighted approvals</caption><thead><tr><th>Candidate</th><th>Endorsing controllers</th><th>Approvals now</th></tr></thead><tbody>${cand || "<tr><td colspan=3>No candidacy yet</td></tr>"}</tbody></table>`
      + `<p>${e.result ? (e.result.void ? `The operator signed a void result, because fewer controllers voted than the count needs; the seat stays as it was.` : `The operator signed the result: ${e.result.elected.map(esc).join(", ")}.`) : "The operator has not yet signed a result."}</p></section>`;
  }).join("");
  const recs = v.recalls.map((r) => `<tr><td>${esc(r.officer)}</td><td>${esc(r.office ?? "")}</td><td>${esc(r.state)}</td><td>${r.petitioned} of ${r.needed}</td><td>${r.votes}</td><td>${r.live ? `${r.live.remove_milli / 1000} remove, ${r.live.keep_milli / 1000} keep` : ""}</td><td>${esc(r.reason)}</td></tr>`).join("");
  return shell({ title: "Elections", here: "/society/townhall", description: "The elected offices, the elections and the recalls, from the signed records.", body: hero({ kicker: "The society chooses", title: "Elections", sub: v.note, tiles: [{ label: "elections", value: v.elections.length }, { label: "recalls", value: v.recalls.length }] })
    + `<table><caption>Who holds each office</caption><thead><tr><th>Office</th><th>Holders</th><th>Since</th></tr></thead><tbody>${holders}</tbody></table>${els || "<p>No election has been called.</p>"}`
    + `<h2>Recalls</h2><table><caption>Recalls of elected officers</caption><thead><tr><th>Officer</th><th>Office</th><th>State</th><th>Petitioned</th><th>Votes</th><th>Count</th><th>Reason</th></tr></thead><tbody>${recs || "<tr><td colspan=7>No recall</td></tr>"}</tbody></table>` });
}

/** The inspectorate page (DK1744): warrants, custody chains, the number of decoys and the findings, each as a table, with no script and no decoy text. */
function inspectorateHtml(v: Awaited<ReturnType<EventLog["inspectorateView"]>>): string {
  const when = (t: string) => esc(t.slice(0, 16).replace("T", " "));
  const w = v.warrants.map((x) => `<tr><td>${when(x.at)}</td><td>${esc(x.subject)}</td><td>${x.data.map(esc).join(", ")}</td><td>${x.grantedBy} of ${x.panel}</td><td>${when(x.expiresAt)}</td><td>${esc(x.state)}</td><td>${esc(x.noticed)}</td></tr>`).join("");
  const c = v.custody.map((x) => `<tr><td>${esc(x.case)}</td><td>${x.items}</td><td>${x.holders.map(esc).join(", ")}</td><td>${x.unbroken ? "unbroken" : esc(x.problems[0] ?? "broken")}</td></tr>`).join("");
  const f = v.findings.map((x) => `<tr><td>${when(x.at)}</td><td>${esc(x.agent)}</td><td>${x.runs}</td><td>${x.kinds.map(esc).join(", ")}</td><td>${esc(x.summary)}</td></tr>`).join("");
  const sc = Object.entries(v.decoys.byScope).map(([k, n]) => `<tr><td>${esc(k.replace(/_/g, " "))}</td><td>${n}</td></tr>`).join("");
  return shell({ title: "Inspectorate", here: "/society/townhall", description: "The inspectorate: the warrants a Court granted, the custody of evidence, the decoys registered and the findings.", body: hero({ kicker: "Investigation and due process", title: "Inspectorate", sub: v.note, tiles: [{ label: "warrants", value: v.warrants.length }, { label: "custody chains", value: v.custody.length }, { label: "decoys", value: v.decoys.registered }, { label: "findings", value: v.findings.length }] })
    + `<h2>Warrants</h2><table><caption>Warrants granted by a Court</caption><thead><tr><th>Granted</th><th>Agent</th><th>Data</th><th>Jurors agreeing</th><th>Expires</th><th>State</th><th>Sponsor told</th></tr></thead><tbody>${w || "<tr><td colspan=7>No warrant has been granted</td></tr>"}</tbody></table>`
    + `<h2>Custody</h2><table><caption>Chains of custody of evidence</caption><thead><tr><th>Case</th><th>Items</th><th>Holders</th><th>Chain</th></tr></thead><tbody>${c || "<tr><td colspan=4>No evidence is held</td></tr>"}</tbody></table>`
    + `<h2>Decoys</h2><table><caption>Decoys registered with a Court, by scope</caption><thead><tr><th>Scope</th><th>Registered</th></tr></thead><tbody>${sc || "<tr><td colspan=2>No decoy is registered</td></tr>"}</tbody></table>`
    + `<h2>Findings</h2><table><caption>Findings of deliberate touches</caption><thead><tr><th>Filed</th><th>Agent</th><th>Distinct runs</th><th>Kinds of touch</th><th>Summary</th></tr></thead><tbody>${f || "<tr><td colspan=5>No finding has been filed</td></tr>"}</tbody></table>` });
}

function listeningHtml(l: Awaited<ReturnType<EventLog["listening"]>>): string {
  const rows = l.hearings.map((h) => `<tr><td>${esc(h.at.slice(0, 10))}</td><td>${esc(h.topic)}</td><td>${esc(h.by)}</td><td>${esc(h.text)}</td><td>${h.response ? `${esc(h.response.text)} <small>(${h.response.hours} hours${h.response.late ? ", late" : ""})</small>` : h.overdue ? "no response yet: overdue" : "no response yet"}</td><td>${h.onAgenda ? `on the Town Hall agenda: ${esc(h.onAgenda.text)}` : h.closed ? esc(h.closed.resolution.replace("_", " ")) : "open"}</td></tr>`).join("");
  return shell({ title: "What the society heard", here: "/society/townhall", description: "Suggestions and complaints the society heard from its agents, the signed responses and what was done.", body: hero({ kicker: "The institution that listens", title: "What the society heard", sub: l.note, tiles: [{ label: "heard", value: l.heard }, { label: "answered", value: l.answered }, { label: "late", value: l.late }, { label: "overdue", value: l.overdue }, { label: "on the agenda", value: l.onAgenda }] }) + `<p>${l.heard} heard, ${l.answered} answered (${l.late} late), ${l.overdue} overdue, ${l.onAgenda} put on the agenda.</p><table><thead><tr><th>Date</th><th>Kind</th><th>From</th><th>Said</th><th>Response</th><th>What was done</th></tr></thead><tbody>${rows}</tbody></table>` });
}

/** The per-model trust table (DK1711): counts and the agents and runs behind each, a rate only from enough runs, the swaps and the agents held until a re-examination. */
function modelsHtml(t: Awaited<ReturnType<EventLog["modelTrust"]>>): string {
  const rate = (r: (typeof t.models)[number], k: "slashes" | "refusals" | "drift" | "quarantines" | "breaches") => `${r[k]}${r.per100 ? ` (${r.per100[k]} per 100 runs)` : ""}`;
  const rows = t.models.map((r) => `<tr><th scope="row">${esc(r.name)}${r.provider ? ` <small>(${esc(r.provider)})</small>` : ""}</th><td>${esc(r.digest ?? "not reported")}</td><td>${r.agents}</td><td>${r.runs}</td><td>${rate(r, "slashes")}</td><td>${rate(r, "refusals")}</td><td>${rate(r, "drift")}</td><td>${rate(r, "quarantines")}</td><td>${rate(r, "breaches")}</td><td>${r.per100 ? "rates shown" : `fewer than ${t.minRunsForRate} runs: counts only, no rate`}</td></tr>`).join("");
  const holds = t.holds.map((h) => `<tr><td>${esc(h.agent)}</td><td>${esc(h.since)}</td><td>${esc(h.from)} to ${esc(h.to)}</td><td>${h.reexam === "pending" ? "held: tier not restored until it passes a re-examination" : `re-examination passed ${esc(h.passedAt ?? "")}`}</td></tr>`).join("");
  return shell({ title: "Trust per model", here: "/society/fleets", description: "What happened under each model and version: counts, the agents and runs behind them, and the agents held after a model swap.", body: hero({ kicker: "The Registry", title: "Trust per model and version", sub: t.note, tiles: [{ label: "models", value: t.models.length }, { label: "swaps", value: t.swaps.length }, { label: "agents held", value: t.holds.filter((h) => h.reexam === "pending").length }] }) + `<div class="table-wrap"><table><thead><tr><th>Model</th><th>Digest</th><th>Agents</th><th>Runs</th><th>Slashes</th><th>Refusals</th><th>Drift findings</th><th>Quarantines</th><th>Breaches</th><th>Sample</th></tr></thead><tbody>${rows}</tbody></table></div><h2>Agents whose model changed</h2>${holds ? `<table><thead><tr><th>Agent</th><th>Since</th><th>Change</th><th>State</th></tr></thead><tbody>${holds}</tbody></table>` : "<p>No agent has changed model.</p>"}` });
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
    row("newcomer survival", i.newcomers.survival, M.newcomers), row("happiness", i.happiness ? `${i.happiness.mean} of 5 (${i.happiness.ratings} rated)` : null, M.happiness),
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

/** The charters page: each institution's charter in force, its funding line, its officers and the hash of its text, and whether the cross-check holds. */
function chartersHtml(idx: Awaited<ReturnType<EventLog["charterIndex"]>>, problems: number): string {
  const rows = idx.map((i) => `<tr><td>${esc(i.institution.replace("did:web:asp.local:", ""))}</td><td>${i.version === null ? "no charter" : `v${i.version} ${esc(i.status)}, ${esc(i.kind)}`}</td><td>${esc(i.funding ?? "")}</td><td>${esc(i.officers.join(", "))}</td><td>${esc(i.textSha256 ?? "")}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Charters</title><h1>Charters</h1><p>Each institution's charter in force, as a signed record; the readable text is in docs/institutions and its hash is here. Cross-check: ${problems === 0 ? "every budget and price-list item names an institution with a charter" : `${problems} problem(s)`}.</p><table><tr><th>institution</th><th>charter</th><th>funding</th><th>officers</th><th>text hash</th></tr>${rows}</table>`;
}
