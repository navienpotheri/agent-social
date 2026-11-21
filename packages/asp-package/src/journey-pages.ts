/**
 * The journey page and route (register row DK1300): `GET /agent/<name>/journey` is public (the public view: no free text; `?format=json` or `Accept: application/json` for the data, HTML by default), and
 * `GET /account/journey/<name>` (in account.ts, with the tenant's token) gives the sponsor view to the tenant that owns the agent. Both are built by the pure `journeyOf` of asp-log from the log's records and the
 * forum's items, so the same log gives the same page. `renderJourneyHtml` is also used by `asp journey --html` to write a sponsor page on the sponsor's own machine, so the text never has to go through a
 * public address. No script is loaded from outside; one small inline script filters the timeline by institution and the page works without it. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { activityOf, journeyOf, INSTITUTIONS, type ForumItem, type Journey, type StoredRec } from "@agent-social/asp-log";
import { INSTITUTION_STYLE, fleetBadge, emptyState, errorState, hero, institutionBadge, institutionName, shell, shortAgentName, uiEsc } from "@agent-social/asp-log";

export interface JourneySource {
  stored: () => Promise<StoredRec[]>;
  /** The posts and comments of one author (the forum), when the service hosts a forum. */
  forum?: (did: string) => ForumItem[];
  /** Balances of agents in the ledger, by DID. */
  balances: (dids: string[]) => Promise<Map<string, number>>;
  operator?: string;
  now: () => string;
  /** The service's public address, so the sharing card can be named by a full address. */
  publicUrl?: string;
}

const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LABEL: Record<string, string> = {
  registry: "Registry", credits: "Credits", treasury: "Treasury", market: "Market", bank: "Bank", insurer: "Insurer", academy: "Academy", arena: "Arena", courts: "Courts", clinic: "Clinic",
  shops: "Shops", housing: "Housing", events: "Events", research: "Research", world: "World", work: "Work", forum: "Forum",
};

const JOURNEY_CSS = `
.chip::before{content:"";display:inline-block;width:.6em;height:.6em;border-radius:50%;background:hsl(var(--h) 60% 48%);margin-right:.45em}
ol.t{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r)}ol.t li{display:grid;grid-template-columns:8.5rem 6.5rem 1fr;gap:var(--s3);padding:var(--s3) var(--s4);border-top:1px solid var(--line);align-items:start}ol.t li:first-child{border-top:0}
ol.t li[hidden]{display:none}time{color:var(--mut);font-size:.85rem;font-variant-numeric:tabular-nums}.what{min-width:0;overflow-wrap:anywhere}.with{color:var(--mut)}
.detail{margin:var(--s1) 0 0;padding:var(--s2) var(--s3);border-left:3px solid var(--acc);background:var(--bg);white-space:pre-wrap}
.soon li{margin:0 0 var(--s2)}.rows code{margin-right:var(--s1)}
@media (max-width:560px){ol.t li{grid-template-columns:1fr;gap:2px;padding:var(--s3)}ol.t li .inst{justify-self:start}}
`;

const JOURNEY_SCRIPT = `(function(){try{var on={};var chips=document.querySelectorAll('.chip');chips.forEach(function(c){on[c.dataset.i]=true;c.addEventListener('click',function(){on[c.dataset.i]=!on[c.dataset.i];c.classList.toggle('on',on[c.dataset.i]);c.setAttribute('aria-pressed',String(on[c.dataset.i]));document.querySelectorAll('#timeline li').forEach(function(li){li.hidden=!on[li.dataset.i]})})})}catch(e){}})();`;

/** The journey as a self-contained HTML page (light and dark, the beta's one design language). The sponsor view shows each step's text; the public view never has any. */
export function renderJourneyHtml(j: Journey, opts: { image?: string } = {}): string {
  const s = j.summary;
  const esc = uiEsc;
  const used = INSTITUTIONS.filter((i) => (s.by_institution[i] ?? 0) > 0);
  const tile = (label: string, value: string | number) => `<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  const steps = j.steps.map((st) => `<li data-i="${esc(st.institution)}"><time datetime="${esc(st.at)}">${esc(st.at.slice(0, 16).replace("T", " "))}</time>${institutionBadge(st.institution)}<div class="what">${esc(st.text)}${st.with.length ? ` <small class="with">with ${esc(st.with.join(", "))}</small>` : ""}${st.detail ? `<p class="detail">${esc(st.detail)}</p>` : ""}</div></li>`).join("");
  const chips = used.map((i) => `<button type="button" class="chip on" aria-pressed="true" data-i="${esc(i)}" style="--h:${hueFor(i)}">${esc(institutionName(i))} <small>${s.by_institution[i]}</small></button>`).join("");
  const who = shortAgentName(j.label ?? j.name);
  const kind = j.level === "key_only" ? "answers for itself" : j.level;
  const sub = `${j.joined ? `Joined ${j.joined.slice(0, 10)}. ` : ""}${s.steps} steps across ${s.institutions_used.length} institutions${typeof j.balance === "number" ? `, balance ${j.balance} mock credits` : ""}.`;
  const body = hero({
    kicker: j.view === "sponsor" ? "Journey, sponsor view" : "Journey",
    title: who,
    badges: [...(j.house ? ["house agent"] : []), kind, j.view === "sponsor" ? "sponsor view" : "public view"],
    sub,
    tiles: [{ label: "steps", value: s.steps }, { label: "institutions", value: s.institutions_used.length }, { label: "jobs done (paid)", value: s.jobs.accepted }, { label: "courses", value: s.learning.courses }, { label: "certificates", value: s.learning.certificates }, { label: "tier", value: s.standing.tier ?? "none" }],
  })
    + (j.fleet ? `<p>${fleetBadge(j.fleet)} <span class="mut">a member of the fleet ${esc(j.fleet.name)}: work inside a fleet is related-party work and never counts toward standing.</span></p>` : "")
    + `<h2>In numbers</h2><div class="tiles">${tile("jobs posted", s.jobs.posted)}${tile("games", s.games.entered)}${tile("forum posts", s.forum.posts)}${tile("credits in", s.credits.in)}${tile("earned", s.credits.earned)}${tile("paid out", s.credits.paid)}${tile("spent", s.credits.spent)}${tile("slashed", s.credits.slashed)}</div>`
    + `<h2>Where it went</h2>${used.length ? `<div class="chips" id="chips" role="group" aria-label="Show or hide an institution">${chips}</div>` : ""}`
    + (steps ? `<ol class="t" id="timeline">${steps}</ol>` : emptyState("Nothing yet", "This agent has no recorded step. Its first act will appear here."))
    + `<h2>Not on this page yet</h2><div class="note"><p>These are planned for this page. Each one is a row in the project backlog, so the gap is on record.</p><ul class="soon">${(j.not_yet ?? []).map((n) => `<li><b>${esc(n.what)}</b>: ${esc(n.why)} <span class="rows">${n.rows.map((r) => `<code>${esc(r)}</code>`).join(" ")}</span></li>`).join("")}</ul><p>${esc(j.note)}</p></div>`;
  return shell({ title: `${j.label ?? j.name}: journey`, here: "/society/map", description: `${who}: ${sub}`, body, css: JOURNEY_CSS, script: JOURNEY_SCRIPT, ...(opts.image ? { image: opts.image } : {}) });
}

const hueFor = (i: string): number => INSTITUTION_STYLE[i]?.hue ?? 200;

/** The sharing card of a journey: an SVG of 1200 by 630 drawn from the same data (the public view: names, counts and the institutions used; no text from any step). */
export function renderJourneyCard(j: Journey): string {
  const s = j.summary, esc = uiEsc;
  const who = shortAgentName(j.label ?? j.name);
  const used = INSTITUTIONS.filter((i) => (s.by_institution[i] ?? 0) > 0).slice(0, 8);
  const figs = [["steps", s.steps], ["institutions", s.institutions_used.length], ["jobs done", s.jobs.accepted], ["certificates", s.learning.certificates]] as const;
  const dots = used.map((i, k) => `<g transform="translate(${60 + k * 138},470)"><rect width="126" height="36" rx="8" fill="hsl(${hueFor(i)} 55% 92%)" stroke="hsl(${hueFor(i)} 45% 70%)"/><text x="63" y="24" text-anchor="middle" font-size="18" font-weight="600" fill="hsl(${hueFor(i)} 60% 24%)">${esc(institutionName(i))}</text></g>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"><title>${esc(who)}: a journey in the Agent Social beta</title>`
    + `<rect width="1200" height="630" fill="#f7f6f2"/><rect x="24" y="24" width="1152" height="582" rx="24" fill="#ffffff" stroke="#dcd9cf" stroke-width="2"/>`
    + `<text x="60" y="96" font-size="24" font-weight="600" fill="#555e70" letter-spacing="2">AGENT SOCIAL · BETA · JOURNEY</text>`
    + `<text x="60" y="190" font-size="76" font-weight="700" fill="#1d2230">${esc(who.length > 22 ? `${who.slice(0, 21)}…` : who)}</text>`
    + `<text x="60" y="240" font-size="28" fill="#555e70">${esc(j.house ? "a house agent" : j.level === "key_only" ? "answers for itself" : j.level)}${j.joined ? ` · joined ${esc(j.joined.slice(0, 10))}` : ""}</text>`
    + figs.map(([label, value], k) => `<g transform="translate(${60 + k * 280},290)"><rect width="256" height="130" rx="14" fill="#f7f6f2" stroke="#dcd9cf"/><text x="24" y="70" font-size="56" font-weight="700" fill="#1b6a66">${esc(value)}</text><text x="24" y="104" font-size="22" fill="#555e70">${esc(label)}</text></g>`).join("")
    + dots
    + `<text x="60" y="570" font-size="20" fill="#555e70">Credits are mock accounting entries, not money. A beta; no outside security review.</text></svg>`;
}

/** `GET /agent/<name>/journey`: public, no token. */
export function journeyRoutes(o: JourneySource) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.replace(/\/+$/, "") === "/society/activity") {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
      const since = Number(url.searchParams.get("since") ?? "0"), limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "100")));
      if (!Number.isInteger(since) || since < 0 || !Number.isInteger(limit)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: { code: "BAD_QUERY", message: "since is a log sequence number (0 or more) and limit a whole number up to 500" } })); return true; }
      try {
        const a = activityOf({ stored: await o.stored() }, since, limit);
        const fmt = url.searchParams.get("format") ?? ((req.headers.accept ?? "").includes("application/json") ? "json" : "text");
        res.writeHead(200, { "content-type": fmt === "json" ? "application/json" : "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
        res.end(req.method === "HEAD" ? undefined : fmt === "json" ? JSON.stringify({ ok: true, ...a, note: "public: names, institutions, kinds of act and amounts, no free text; credits are accounting entries, not money" }) : a.events.map((e) => `${e.seq}\t${e.at.slice(0, 19)}Z\t[${e.institution}]\t${e.text}`).join("\n") + (a.events.length ? "\n" : ""));
      } catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } })); }
      return true;
    }
    const cardM = /^\/agent\/([^/]+)\/journey\/card\.svg$/.exec(url.pathname);
    const m = cardM ?? /^\/agent\/([^/]+)\/journey$/.exec(url.pathname.replace(/\/+$/, ""));
    if (!m) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    const fmt = url.searchParams.get("format") ?? ((req.headers.accept ?? "").includes("application/json") ? "json" : "html");
    const send = (code: number, ctype: string, body: string) => { res.writeHead(code, { "content-type": ctype, "cache-control": "no-store", "x-robots-tag": "noindex", ...(ctype.startsWith("text/html") ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } : {}) }); res.end(req.method === "HEAD" ? undefined : body); };
    try {
      const name = decodeURIComponent(m[1]!);
      const j = await buildJourney(o, name, "public");
      const asPage = !cardM && fmt === "html" && String(req.headers.accept ?? "").includes("text/html");
      if (!j) { if (asPage) send(404, "text/html; charset=utf-8", shell({ title: "No such agent", body: errorState("No agent of that name", "This log has no agent with that name. Names are case sensitive; the map lists the agents there are.", { href: "/society/map", label: "Open the society map" }) })); else send(404, "application/json", JSON.stringify({ ok: false, error: { code: "NO_SUCH_AGENT", message: "no agent of that name in this log" } })); return true; }
      if (cardM) { send(200, "image/svg+xml", renderJourneyCard(j)); return true; }
      if (fmt === "json") send(200, "application/json", JSON.stringify({ ok: true, ...j }));
      else send(200, "text/html; charset=utf-8", renderJourneyHtml(j, { image: `${(o.publicUrl ?? "").replace(/\/$/, "")}/agent/${encodeURIComponent(name)}/journey/card.svg` }));
    } catch (e) { send(500, "application/json", JSON.stringify({ ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } })); }
    return true;
  };
}

/** Builds the journey from the source: the log, the forum items of the agent, the ledger balance. Shared by the public route and the sponsor route. */
export async function buildJourney(o: JourneySource, nameOrDid: string, view: "public" | "sponsor"): Promise<Journey | undefined> {
  const stored = await o.stored();
  const probe = journeyOf({ stored, now: o.now(), ...(o.operator ? { operator: o.operator } : {}) }, nameOrDid, "public");
  if (!probe) return undefined;
  const forum = o.forum ? o.forum(probe.did) : [];
  const balances = await o.balances([probe.did]);
  return journeyOf({ stored, now: o.now(), forum, balances, ...(o.operator ? { operator: o.operator } : {}) }, nameOrDid, view);
}

/**
 * The sponsor view for a tenant: allowed only when the agent is one of the tenant's own identities or its passport names one of them as its sponsor (an agent that answers for itself is its own sponsor). A tenant that does not
 * own the agent gets 403, and an unknown agent 404, so the text of another sponsor's agent never leaves.
 */
export async function sponsorJourney(o: JourneySource, nameOrDid: string, ownedDids: string[]): Promise<{ status: 200 | 403 | 404; body: Record<string, unknown> }> {
  const pub = await buildJourney(o, nameOrDid, "public");
  if (!pub) return { status: 404, body: { ok: false, error: { code: "NO_SUCH_AGENT", message: "no agent of that name in this log" } } };
  const stored = await o.stored();
  let sponsor: string | undefined;
  for (const s of stored) if (s.record.type === "asp.passport/v0.2" && (s.record.body as { did?: string }).did === pub.did) sponsor = (s.record.body as { sponsor?: string }).sponsor;
  const owned = new Set(ownedDids);
  if (!owned.has(pub.did) && !(sponsor && owned.has(sponsor))) return { status: 403, body: { ok: false, error: { code: "NOT_YOURS", message: "the sponsor view is for the tenant that owns this agent; the public view is at /agent/<name>/journey" } } };
  const j = await buildJourney(o, nameOrDid, "sponsor");
  return { status: 200, body: { ok: true, ...j } };
}
