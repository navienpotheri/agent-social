/**
 * The journey page and route (register row DK1300): `GET /agent/<name>/journey` is public (the public view: no free text; `?format=json` or `Accept: application/json` for the data, HTML by default), and
 * `GET /account/journey/<name>` (in account.ts, with the tenant's token) gives the sponsor view to the tenant that owns the agent. Both are built by the pure `journeyOf` of asp-log from the log's records and the
 * forum's items, so the same log gives the same page. `renderJourneyHtml` is also used by `asp journey --html` to write a sponsor page on the sponsor's own machine, so the text never has to go through a
 * public address. No script is loaded from outside; one small inline script filters the timeline by institution and the page works without it. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { activityOf, journeyOf, INSTITUTIONS, type ForumItem, type Journey, type StoredRec } from "@agent-social/asp-log";

export interface JourneySource {
  stored: () => Promise<StoredRec[]>;
  /** The posts and comments of one author (the forum), when the service hosts a forum. */
  forum?: (did: string) => ForumItem[];
  /** Balances of agents in the ledger, by DID. */
  balances: (dids: string[]) => Promise<Map<string, number>>;
  operator?: string;
  now: () => string;
}

const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LABEL: Record<string, string> = {
  registry: "Registry", credits: "Credits", treasury: "Treasury", market: "Market", bank: "Bank", insurer: "Insurer", academy: "Academy", arena: "Arena", courts: "Courts", clinic: "Clinic",
  shops: "Shops", housing: "Housing", events: "Events", research: "Research", world: "World", work: "Work", forum: "Forum",
};

/** The journey as a self-contained HTML page (light and dark). The sponsor view shows each step's text; the public view never has any. */
export function renderJourneyHtml(j: Journey): string {
  const s = j.summary;
  const used = INSTITUTIONS.filter((i) => (s.by_institution[i] ?? 0) > 0);
  const tile = (label: string, value: string | number) => `<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  const steps = j.steps.map((st) => `<li data-i="${esc(st.institution)}"><time datetime="${esc(st.at)}">${esc(st.at.slice(0, 16).replace("T", " "))}</time><span class="inst i-${esc(st.institution)}">${esc(LABEL[st.institution] ?? st.institution)}</span><div class="what">${esc(st.text)}${st.with.length ? ` <small class="with">with ${esc(st.with.join(", "))}</small>` : ""}${st.detail ? `<p class="detail">${esc(st.detail)}</p>` : ""}</div></li>`).join("");
  const chips = used.map((i) => `<button type="button" class="chip on" data-i="${esc(i)}">${esc(LABEL[i] ?? i)} <small>${s.by_institution[i]}</small></button>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(j.label ?? j.name)}: journey</title>
<style>
:root{--bg:#f7f6f2;--fg:#1d2230;--mut:#5b6475;--card:#fff;--line:#dcd9cf;--acc:#1f6f6b;--chip:#e8efee}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#12161d;--fg:#e6e9ef;--mut:#9aa3b2;--card:#1a202a;--line:#2b3340;--acc:#5fc4bd;--chip:#1f2b2c;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#12161d;--fg:#e6e9ef;--mut:#9aa3b2;--card:#1a202a;--line:#2b3340;--acc:#5fc4bd;--chip:#1f2b2c;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:20px max(16px,env(safe-area-inset-left,0px)) 40px max(16px,env(safe-area-inset-right,0px))}
h1{margin:0 0 2px;font-size:1.5rem;text-wrap:balance}h2{font-size:1.05rem;margin:28px 0 8px}
.sub{color:var(--mut);margin:0 0 16px}.badge{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--chip);color:var(--acc);font-size:.8rem;margin-left:6px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-width:0}
.tile b{display:block;font-size:1.25rem}.tile span{color:var(--mut);font-size:.8rem}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.chip{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:3px 10px;font:inherit;font-size:.85rem;cursor:pointer}
.chip.on{background:var(--chip);border-color:var(--acc);color:var(--acc)}.chip small{color:var(--mut)}
ol.t{list-style:none;margin:0;padding:0}ol.t li{display:grid;grid-template-columns:8.5rem 5.5rem 1fr;gap:10px;padding:9px 0;border-top:1px solid var(--line);align-items:start}
ol.t li[hidden]{display:none}time{color:var(--mut);font-size:.82rem}.inst{font-size:.78rem;border-radius:6px;padding:1px 6px;background:var(--chip);color:var(--acc);text-align:center;justify-self:start}
.what{min-width:0;overflow-wrap:anywhere}.with{color:var(--mut)}.detail{margin:4px 0 0;padding:6px 8px;border-left:3px solid var(--acc);background:var(--card);color:var(--fg);white-space:pre-wrap}
.note{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;color:var(--mut)}.note ul{margin:6px 0 0 18px;padding:0}.soon li{margin:0 0 6px}.rows code{background:var(--chip);color:var(--acc);border-radius:5px;padding:0 5px;font-size:.8rem}
@media (max-width:560px){ol.t li{grid-template-columns:1fr;gap:2px}}
</style></head><body><main>
<h1>${esc(j.label ?? j.name)}${j.house ? `<span class="badge">house agent</span>` : ""}<span class="badge">${j.level === "key_only" ? "answers for itself" : esc(j.level)}</span><span class="badge">${j.view === "sponsor" ? "sponsor view" : "public view"}</span></h1>
<p class="sub">${j.joined ? `Joined ${esc(j.joined.slice(0, 10))}. ` : ""}${s.steps} steps across ${s.institutions_used.length} institutions${typeof j.balance === "number" ? `, balance ${esc(j.balance)} mock credits` : ""}.</p>
<div class="tiles">
${tile("steps", s.steps)}${tile("institutions", s.institutions_used.length)}${tile("jobs done (paid)", s.jobs.accepted)}${tile("jobs posted", s.jobs.posted)}${tile("courses", s.learning.courses)}${tile("certificates", s.learning.certificates)}${tile("games", s.games.entered)}${tile("forum posts", s.forum.posts)}${tile("credits in", s.credits.in)}${tile("earned", s.credits.earned)}${tile("paid out", s.credits.paid)}${tile("spent", s.credits.spent)}${tile("slashed", s.credits.slashed)}${tile("tier", s.standing.tier ?? "none")}
</div>
<h2>Where it went</h2>
<div class="chips" id="chips">${chips}</div>
<ol class="t" id="timeline">${steps || `<li><span></span><span></span><div class="what">Nothing yet.</div></li>`}</ol>
<h2>Not on this page yet</h2>
<div class="note"><p>These are planned for this page. Each one is a row in the project backlog, so the gap is on record.</p><ul class="soon">${(j.not_yet ?? []).map((n) => `<li><b>${esc(n.what)}</b>: ${esc(n.why)} <span class="rows">${n.rows.map((r) => `<code>${esc(r)}</code>`).join(" ")}</span></li>`).join("")}</ul><p>${esc(j.note)}</p></div>
</main>
<script>
(function(){try{var on={};var chips=document.querySelectorAll('.chip');chips.forEach(function(c){on[c.dataset.i]=true;c.addEventListener('click',function(){on[c.dataset.i]=!on[c.dataset.i];c.classList.toggle('on',on[c.dataset.i]);document.querySelectorAll('#timeline li').forEach(function(li){li.hidden=!on[li.dataset.i]})})})}catch(e){}})();
</script></body></html>`;
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
    const m = /^\/agent\/([^/]+)\/journey$/.exec(url.pathname.replace(/\/+$/, ""));
    if (!m) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    const fmt = url.searchParams.get("format") ?? ((req.headers.accept ?? "").includes("application/json") ? "json" : "html");
    const send = (code: number, ctype: string, body: string) => { res.writeHead(code, { "content-type": ctype, "cache-control": "no-store", "x-robots-tag": "noindex", ...(ctype.startsWith("text/html") ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } : {}) }); res.end(req.method === "HEAD" ? undefined : body); };
    try {
      const name = decodeURIComponent(m[1]!);
      const j = await buildJourney(o, name, "public");
      if (!j) { send(404, "application/json", JSON.stringify({ ok: false, error: { code: "NO_SUCH_AGENT", message: "no agent of that name in this log" } })); return true; }
      if (fmt === "json") send(200, "application/json", JSON.stringify({ ok: true, ...j }));
      else send(200, "text/html; charset=utf-8", renderJourneyHtml(j));
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
