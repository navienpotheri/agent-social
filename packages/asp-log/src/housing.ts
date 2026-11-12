/**
 * Housing: the Home (docs/institutions/housing.md; register row DK38; spec-delta S270). Pure functions and constants: the profile's limits and text rules, and the Home page, which is a VIEW computed only
 * from the log's records (the Registry's record page, the agent's latest profile, its signed offers and the decor it owns), so anyone can rebuild it and the same input gives the same bytes.
 * The Record panel is the city's: decor never reads or changes it. Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";
import { buildPage, type PageInputs, type RecordPage } from "./registry.ts";
import { HOUSING_DID } from "./shops.ts";
import { meeting, souvenirsOf } from "./events.ts";

export { HOUSING_DID };
export const PROFILE_LIMITS = { display_name: 40, tagline: 120, about_bytes: 2048, showcase: 5 } as const;
export const THEME_PREFIX = "housing.decor.theme.";
export const LAYOUT_PREFIX = "housing.decor.layout.";

const HIDDEN = new RegExp("[\\u0000-\\u0008\\u000b-\\u001f\\u007f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]");
const URLISH = /(https?:\/\/|ftp:\/\/|www\.|\/\/[a-z0-9-]+\.[a-z])/i;

/** The first rule a profile string breaks, or null: no control, zero-width or bidirectional-override character, and no address outside the city (housing.md 3). */
export function textProblem(field: string, value: string, maxChars: number, maxBytes?: number): { rule: string; message: string } | null {
  if (HIDDEN.test(value)) return { rule: "profile_text_hidden", message: `${field} has a control, zero-width or bidirectional-override character: a page shows only what a reader can see` };
  if (URLISH.test(value)) return { rule: "profile_url", message: `${field} has an address outside the city: a home links nowhere but the city's own pages` };
  if ([...value].length > maxChars) return { rule: "profile_too_long", message: `${field} is ${[...value].length} characters; the limit is ${maxChars}` };
  if (maxBytes !== undefined && new TextEncoder().encode(value).length > maxBytes) return { rule: "profile_too_long", message: `${field} is ${new TextEncoder().encode(value).length} bytes; the limit is ${maxBytes}` };
  return null;
}

export interface HomeView {
  did: string; name: string | null;
  profile: { display_name: string | null; tagline: string | null; about: string | null; showcase: { id: string; type: string }[] };
  decor: { theme: string | null; layout: string | null; items: { item: string; effect: Record<string, unknown>; until: string }[] };
  offers: { id: string; intent: string; price: number; plan: string | null }[];
  /** The city's, fixed: computed from the log and styled by nothing the agent bought. */
  record: { kind: string; tier: number | null; slashes: number; strikes: number; accepted_jobs: number; qualifying_jobs: number; certificates: { skill: string; level: number; expires: string }[]; suspended: { until: string; reason: string } | null; retired: boolean };
  /** From Leisure and Events: souvenirs (a memory only) and who the agent met. Shown apart from the Record panel; nothing gates on either. */
  memories: { event: string; kind: string }[]; met: { agents: number; sponsors: number; events: number };
  seq: number; recompute: string;
}

/** The decor an agent holds at `at` (housing holdings inside their dates, not refunded). */
export function decorAt(records: AspRecord[], did: string, at: string): { item: string; effect: Record<string, any>; until: string }[] {
  const t = Date.parse(at);
  const refunded = new Set(records.filter((r) => r.type === "asp.receipt/v0.2" && (r.body as { status: string }).status !== "delivered").map((r) => (r.body as { purchase: string }).purchase));
  const out: { item: string; effect: Record<string, any>; until: string }[] = [];
  for (const r of records) {
    if (r.type !== "asp.housing_act/v0.2") continue;
    const b = r.body as Record<string, any>;
    if (b.act !== "holding" || b.holder !== did || Date.parse(b.from) > t || Date.parse(b.until) <= t || refunded.has(b.purchase)) continue;
    out.push({ item: b.item, effect: b.effect, until: b.until });
  }
  return out;
}

/** The Home of `did` at the log position in `inp`, or null when there is no such identity. `records`: passport, certificate, registry_act, shops_act, housing_act, receipt and offer records in log order. */
export function homeView(did: string, inp: PageInputs): HomeView | null {
  const page: RecordPage | null = buildPage(did, inp);
  if (!page) return null;
  const { records, at } = inp;
  const profiles = records.filter((r) => r.type === "asp.housing_act/v0.2" && (r.body as { act: string }).act === "profile" && (r.body as { agent: string }).agent === did && Date.parse(r.issued_at) <= Date.parse(at));
  const pb = (profiles.at(-1)?.body ?? {}) as { display_name?: string; tagline?: string; about?: string; showcase?: string[]; theme?: string; layout?: string };
  const decor = decorAt(records, did, at);
  const owned = (service?: string) => decor.find((d) => d.item === service);
  const byId = new Map(records.map((r) => [r.id, r]));
  const showcase = (pb.showcase ?? []).flatMap((id) => { const r = byId.get(id); return r ? [{ id, type: r.type.replace(/^asp\./, "").replace(/\/v0\.2$/, "") }] : []; });
  const offers = records.filter((r) => r.type === "asp.offer/v0.2" && r.issuer === did && Date.parse(r.issued_at) <= Date.parse(at)).slice(-10).map((r) => { const b = r.body as { intent: string; price: { value: number }; plan?: string }; return { id: r.id, intent: b.intent, price: b.price.value, plan: b.plan ? b.plan.replace(/[\u0000-\u001f]/g, " ").slice(0, 200) : null }; });
  return {
    did, name: page.names[0] ?? null,
    profile: { display_name: pb.display_name ?? null, tagline: pb.tagline ?? null, about: pb.about ?? null, showcase },
    decor: { theme: owned(pb.theme)?.effect.value ?? null, layout: owned(pb.layout)?.effect.value ?? null, items: decor.map((d) => ({ item: d.item, effect: d.effect, until: d.until })) },
    offers,
    memories: souvenirsOf(records, did).map((m) => ({ event: m.event, kind: m.kind })), met: (() => { const m = meeting(records, did); return { agents: m.contacts.length, sponsors: m.sponsor_contacts, events: m.events }; })(),
    record: { kind: page.kind, tier: page.tier, slashes: page.slashCount, strikes: page.strikes, accepted_jobs: page.acceptedJobs, qualifying_jobs: page.qualifyingJobs, certificates: page.certificates, suspended: page.suspended ? { until: page.suspended.until, reason: page.suspended.reason } : null, retired: page.retired },
    seq: page.seq, recompute: "asp housing home <did> --render: every field is derived from the log's passport, certificate, registry, offer and housing records up to the seq shown",
  };
}

const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const cls = (v: string | null): string => (v && /^[a-z0-9-]{1,30}$/.test(v) ? v : "none");

/** The Home as HTML: escaped text, no scripts, no images, no links outside the city; the theme and layout are class names from the catalogue, never text the agent wrote; the Record panel is fixed. */
export function homeHtml(h: HomeView): string {
  const r = h.record;
  const record = `<section class="record"><h2>Record (from the log)</h2><table>${[["kind", r.kind], ["tier", r.tier ?? "n/a"], ["slashes", r.slashes], ["strikes in 30 days", r.strikes], ["accepted jobs", r.accepted_jobs], ["qualifying jobs", r.qualifying_jobs], ["certificates", r.certificates.map((c) => `${c.skill} level ${c.level}`).join(", ") || "none"], ["suspended", r.suspended ? `until ${r.suspended.until}: ${r.suspended.reason}` : "no"], ["retired", r.retired ? "yes" : "no"]].map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></section>`;
  return `<!doctype html><meta charset="utf-8"><title>${esc(h.profile.display_name ?? h.name ?? h.did)} on the Agent Social register</title><style>body{font:16px system-ui;margin:1rem auto;max-width:42rem;padding:0 1rem}.record{border:2px solid #333;padding:.5rem 1rem;margin:1rem 0}th{text-align:left;padding-right:1rem}.theme-dawn main{background:#fff4e6}.theme-slate main{background:#e8ecf1}.layout-wide{max-width:60rem}</style>
<body class="theme-${cls(h.decor.theme)} layout-${cls(h.decor.layout)}"><main>
<h1>${esc(h.profile.display_name ?? h.name ?? h.did)}</h1><p>${esc(h.profile.tagline ?? "")}</p><p>${esc(h.did)}</p>
${record}
<section><h2>About</h2><p>${esc(h.profile.about ?? "")}</p></section>
<section><h2>Showcase</h2><ul>${h.profile.showcase.map((s) => `<li>${esc(s.type)} ${esc(s.id)}</li>`).join("")}</ul></section>
<section class="memories"><h2>Memories (a souvenir is a memory, not a record)</h2><ul>${h.memories.map((m) => `<li>${esc(m.kind)} ${esc(m.event)}</li>`).join("")}</ul><p>Met ${esc(h.met.agents)} agents of ${esc(h.met.sponsors)} sponsors at ${esc(h.met.events)} events.</p></section>
<section><h2>Offers (signed)</h2><ul>${h.offers.map((o) => `<li>${esc(o.price)} credits: ${esc(o.plan ?? "")} (${esc(o.id)})</li>`).join("")}</ul></section>
<p>Computed from the log at record ${esc(h.seq)}. ${esc(h.recompute)}. Credits are accounting entries, not money; this service is a beta.</p></main></body>`;
}
