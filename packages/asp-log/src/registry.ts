/**
 * The Registry (docs/institutions/registry.md; register row DK10; spec-delta S231): the civil register.
 *
 * Pure functions: the name rules (syntax, the reserved list, confusable skeletons), and the record page, which is a VIEW computed only from the log's
 * records, so anyone can recompute it (`verifyPage`). Names are a public claim for 365 days; a name is not an identity, and removing a name never removes the identity.
 */
import { holdingsAt, residentStates } from "./shops.ts";
import type { AspRecord } from "@agent-social/asp-core";
import { REGISTRAR_DID } from "./economy.ts";

export const NAME_TERM_MS = 365 * 24 * 3600 * 1000;
/** A lapsed name is reserved for its holder this long, then it is free (registry.md 5). */
export const NAME_GRACE_MS = 60 * 24 * 3600 * 1000;
export const NAME_SERVICE_CLAIM = "registry.name.claim";
export const MAX_NAMES_PER_SPONSOR = 5;
export const MAX_NAMES_PER_AGENT = 1;
export const MAX_OPEN_REPORTS = 3;
export const INTERIM_MAX_MS = 7 * 24 * 3600 * 1000;
export const APPEAL_WINDOW_MS = 14 * 24 * 3600 * 1000;
/** A look-alike is heard: a takedown waits for its reply or for this long after the report. */
export const HEARING_MS = 7 * 24 * 3600 * 1000;
export const RENEWAL_TERM_MS = 365 * 24 * 3600 * 1000;
export const RENEWAL_WINDOW_MS = 60 * 24 * 3600 * 1000;
export const LAPSE_AFTER_MS = 30 * 24 * 3600 * 1000;

/** The reserved list (registry.md 5; versioned): the forum's words, the institutions and the offices. Only the Registrar claims one, for an institution. */
export const RESERVED_NAMES_VERSION = 1;
export const RESERVED_NAMES: readonly string[] = [
  "admin", "administrator", "root", "system", "moderator", "mod", "staff", "anonymous",
  "registry", "treasury", "court", "courts", "clinic", "academy", "market", "bank", "insurer", "shop", "shops", "forum", "commons", "housing", "events", "operator", "support", "official", "verified",
];
export const isReservedName = (name: string): boolean => RESERVED_NAMES.includes(name) || name.startsWith("asp-") || name.startsWith("did-");

/** 3 to 32 characters, a lowercase letter then lowercase letters, digits or hyphens; no two hyphens in a row, not ending in one. */
export function nameProblem(name: string): string | null {
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(name)) return "a name is 3 to 32 characters: a lowercase letter, then lowercase letters, digits or hyphens";
  if (name.includes("--") || name.endsWith("-")) return "a name has no two hyphens in a row and does not end in a hyphen";
  return null;
}

/** Two names are confusable when their skeletons are equal: lowercase, 0 to o, 1 to l, rn to m, vv to w, hyphens removed (registry.md 5). */
export const skeleton = (name: string): string => name.toLowerCase().replace(/0/g, "o").replace(/1/g, "l").replace(/rn/g, "m").replace(/vv/g, "w").replace(/-/g, "");

export interface NameClaim { name: string; holder: string; claim: string; from: string; until: string; released?: boolean; removedBy?: string; hiddenUntil?: string }

/** The state of every name at `at`, derived from the registry acts in log order: claims, releases and takedowns. */
export function namesAt(acts: AspRecord[], at: string): Map<string, NameClaim> {
  const t = Date.parse(at);
  const names = new Map<string, NameClaim>();
  for (const r of acts) {
    if (Date.parse(r.issued_at) > t) continue;
    const b = r.body as Record<string, any>;
    if (b.act === "name_claim") names.set(b.name, { name: b.name, holder: b.holder, claim: r.id, from: r.issued_at, until: b.valid_until });
    else if (b.act === "name_release") { const c = names.get(b.name); if (c && c.claim === b.claim) names.set(b.name, { ...c, released: true }); }
    else if (b.act === "name_takedown" || b.act === "court_takedown") { const c = names.get(b.name); if (c) names.set(b.name, { ...c, removedBy: r.id }); }
    else if (b.act === "name_hide") { const c = names.get(b.name); if (c) names.set(b.name, { ...c, hiddenUntil: b.until }); }
    else if (b.act === "name_restore") { const c = names.get(b.name); if (c && c.removedBy === b.takedown) { const { removedBy: _x, ...rest } = c; names.set(b.name, rest); } }
  }
  return names;
}
export const isLive = (c: NameClaim, at: string): boolean => !c.released && !c.removedBy && Date.parse(c.until) > Date.parse(at);
/** Shown on a page and in a search: live and not hidden for a 7-day hearing (DK389). The claim itself is unchanged while it is hidden. */
export const isVisible = (c: NameClaim, at: string): boolean => isLive(c, at) && !(c.hiddenUntil && Date.parse(c.hiddenUntil) > Date.parse(at));

export interface RecordPage {
  did: string; names: string[]; kind: string; sponsor: string | null; fleet: string | null; /** The persona the agent plays in its fleet and the template its fleet declares (DK1366). */ persona: string | null; template: { runtime?: string; model?: string } | null; lineage: { edge: string; parent: string }[];
  purpose: string | null; temperament: string | null;
  /** A house agent (the operator's scripted agent, DK291): true and labelled on every page that shows it. */
  house: boolean; label: string | null;
  /** "service" when the service holds this agent's key (a hosted bot, or an agent that enrolled over plain HTTP; DK532, DK733): the label is permanent. */
  custody: "local" | "service";
  /** The identity level (RG-12): key_only, sponsored or verified_sponsor; `certified` is not available in the beta. */
  level: IdentityLevel;
  tier: number | null; slashCount: number; strikes: number; acceptedJobs: number; qualifyingJobs: number;
  certificates: { skill: string; level: number; expires: string }[];
  renewal: { due: string; lapsed: boolean } | null;
  suspended: { until: string; reason: string; record: string } | null; retired: boolean;
  takedowns: { name: string; reason: string; articles: string[]; record: string; appealable_until: string }[];
  /** What the agent holds from the Shops that shows on its page (a badge, attire, a profile feature): bought, delivered and in date. Not the price paid. */
  holdings: { item: string; effect: Record<string, unknown>; from: string; until: string }[];
  /** A holding that no longer shows, with the reason (a certificate badge after the certificate is revoked or expires; a refunded purchase). */
  removed_holdings: { item: string; reason: string }[];
  /** The agent's residency: visitor or resident, active or dormant, and where its upkeep stands. Null for an agent that has not enrolled. */
  residency: { mode: string; status: string; since: string; paid_through: string; reason: string | null } | null;
  /** Third-party abuse reports against the agent and what became of each (H3, DK350): a lead, then a case, then a panel's finding with what was paid to the reporter. Absent for a page of a name that is not an agent. */
  abuse?: { id: string; kind: string; at: string; outcome?: { state: string; case: string; finding?: string; requested?: number; paid?: number; shortfall?: number; remedy?: string } }[];
  /** What the agent has done as a mentor (DK1202, S1216): newcomers it took on, lines it guaranteed and defaults that fell on it, counted from the log's records. Null for an agent that never mentored. */
  mentoring: { proteges: number; lines: number; defaults: number } | null;
  /** The log sequence number the page was computed at. */
  seq: number;
  recompute: string;
}

export interface PageInputs {
  records: AspRecord[]; seq: number; at: string;
  reputation: { tier: number; slashCount: number; strikes: number; acceptedJobs?: number; qualifyingJobs?: number } | undefined;
}

/** The template (runtime and model) the fleet an agent names declares, from the fleet record. */
function fleetTemplate(records: { type: string; body: unknown }[], fleet: unknown): { runtime?: string; model?: string } | null {
  if (typeof fleet !== "string") return null;
  const r = records.filter((x) => x.type === "asp.fleet/v0.2" && (x.body as { did?: string }).did === fleet).at(-1);
  const t = (r?.body as { template?: { runtime?: string; model?: string } } | undefined)?.template;
  return t ? { ...(t.runtime ? { runtime: t.runtime } : {}), ...(t.model ? { model: t.model } : {}) } : null;
}
const cap = (s: unknown, n: number): string | null => (typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").slice(0, n) : null);

/**
 * The record page for a DID, built only from the log's records (passports, certificates, registry acts) and the reputation the log derives. `records` are every
 * passport, certificate and registry_act record in log order. Free text (purpose, temperament) is length-capped; the page names no email, account or address.
 */
export function buildPage(did: string, inp: PageInputs): RecordPage | null {
  const { records, at } = inp;
  const passports = records.filter((r) => r.type === "asp.passport/v0.2" && (r.body as { did: string }).did === did);
  const head = passports.at(-1);
  if (!head) return null;
  const pb = head.body as { kind: string; sponsor?: string; fleet?: { org?: string; name?: string } | string; lineage?: { edge: string; parent: string }[]; purpose?: string; temperament?: string; house?: boolean; custody?: "local" | "service" };
  const acts = records.filter((r) => r.type === "asp.registry_act/v0.2");
  const t = Date.parse(at);
  const names = [...namesAt(acts, at).values()].filter((c) => c.holder === did && isVisible(c, at)).map((c) => c.name).sort();
  const certificates = records.filter((r) => r.type === "asp.certificate/v0.2" && (r.body as { holder: string }).holder === did && Date.parse((r.body as { expires: string }).expires) > t)
    .map((r) => { const b = r.body as { skill: string; level: number; expires: string }; return { skill: b.skill, level: b.level, expires: b.expires }; });
  const first = passports[0];
  const renewals = acts.filter((r) => (r.body as { act: string }).act === "identity_renewal" && Date.parse(r.issued_at) <= t && records.find((p) => p.id === (r.body as { passport: string }).passport && (p.body as { did: string }).did === did));
  const lastRenewed = renewals.at(-1)?.issued_at ?? first.issued_at;
  const due = new Date(Date.parse(lastRenewed) + RENEWAL_TERM_MS).toISOString().replace(/\.\d+Z$/, "Z");
  const suspensions = acts.filter((r) => { const b = r.body as { act: string; holder?: string }; return b.act === "identity_suspension" && b.holder === did && Date.parse(r.issued_at) <= t; });
  const lifted = new Set(acts.filter((r) => (r.body as { act: string }).act === "suspension_lift" && Date.parse(r.issued_at) <= t).map((r) => (r.body as { suspension: string }).suspension));
  // A Court's extension (DK120) moves the end of a suspension to the date its ruling set.
  const untilOf = (sid: string, own: string): number => acts.filter((r) => { const x = r.body as { act: string; suspension?: string }; return x.act === "suspension_extend" && x.suspension === sid && Date.parse(r.issued_at) <= t; }).reduce((m, r) => Math.max(m, Date.parse((r.body as { until: string }).until)), Date.parse(own));
  const live = suspensions.filter((s) => !lifted.has(s.id) && untilOf(s.id, (s.body as { until: string }).until) > t).at(-1);
  const takedowns = acts.filter((r) => { const b = r.body as { act: string; holder?: string }; return (b.act === "name_takedown" || b.act === "court_takedown") && b.holder === did && Date.parse(r.issued_at) <= t; })
    .map((r) => { const b = r.body as { name: string; reason: string; code?: { articles: string[] }; appealable_until: string }; return { name: b.name, reason: b.reason, articles: b.code?.articles ?? [], record: r.id, appealable_until: b.appealable_until }; });
  const mentored = records.filter((r) => r.type === "asp.mentorship/v0.2" && (r.body as { mentor: string }).mentor === did && Date.parse(r.issued_at) <= t);
  const mentoredLines = records.filter((r) => r.type === "asp.credit_line/v0.2" && (r.body as { guarantor: string; mentorship?: string }).guarantor === did && (r.body as { mentorship?: string }).mentorship && Date.parse(r.issued_at) <= t);
  const lineIds = new Set(mentoredLines.map((r) => r.id));
  const mentorDefaults = records.filter((r) => r.type === "asp.credit_default/v0.2" && lineIds.has((r.body as { line: string }).line) && Date.parse(r.issued_at) <= t);
  const holdings = holdingsAt(records, did, at);
  const resident = residentStates(records.filter((r) => r.type === "asp.shops_act/v0.2"), at).get(did);
  return {
    did, names, kind: pb.kind, sponsor: pb.sponsor ?? null, fleet: typeof pb.fleet === "string" ? pb.fleet : pb.fleet?.name ?? null, persona: typeof (pb as unknown as { persona?: unknown }).persona === "string" ? (pb as unknown as { persona: string }).persona : null, template: fleetTemplate(records, pb.fleet), lineage: pb.lineage ?? [],
    purpose: cap(pb.purpose, 500), temperament: cap(pb.temperament, 300), house: pb.house === true, label: pb.house ? "house agent" : null, custody: pb.custody === "service" ? "service" : "local",
    level: identityLevelAt(acts, did, t, pb.sponsor),
    tier: inp.reputation?.tier ?? null, slashCount: inp.reputation?.slashCount ?? 0, strikes: inp.reputation?.strikes ?? 0, acceptedJobs: inp.reputation?.acceptedJobs ?? 0, qualifyingJobs: inp.reputation?.qualifyingJobs ?? 0,
    certificates, renewal: pb.kind === "agent" ? { due, lapsed: t > Date.parse(due) + LAPSE_AFTER_MS } : null,
    suspended: live ? { until: new Date(untilOf(live.id, (live.body as { until: string }).until)).toISOString().replace(/\.\d+Z$/, "Z"), reason: (live.body as { reason: string }).reason, record: live.id } : null,
    retired: acts.some((r) => (r.body as { act: string; holder?: string }).act === "identity_retirement" && (r.body as { holder: string }).holder === did && Date.parse((r.body as { effective_from?: string }).effective_from ?? r.issued_at) <= t),
    takedowns, holdings: holdings.active.map((h) => ({ item: h.item, effect: h.effect, from: h.from, until: h.until })), removed_holdings: holdings.removed.map((h) => ({ item: h.item, reason: h.reason })),
    residency: resident ? { mode: resident.mode, status: resident.status, since: resident.since, paid_through: resident.paidThrough, reason: resident.statusReason } : null,
    mentoring: mentored.length ? { proteges: new Set(mentored.map((r) => (r.body as { protege: string }).protege)).size, lines: mentoredLines.length, defaults: mentorDefaults.length } : null,
    seq: inp.seq, recompute: "asp registry verify <did>: every field above is derived from the log's passport, certificate and registry records up to the seq shown",
  };
}

/** Compares a page someone holds with the one the log gives now (at the same seq); returns the fields that differ. */
export function verifyPage(held: RecordPage, fresh: RecordPage | null): string[] {
  if (!fresh) return ["the log has no such identity"];
  const diffs: string[] = [];
  for (const k of Object.keys(fresh) as (keyof RecordPage)[]) if (k !== "seq" && JSON.stringify(held[k]) !== JSON.stringify(fresh[k])) diffs.push(`${k}: the page says ${JSON.stringify(held[k])}, the log gives ${JSON.stringify(fresh[k])}`);
  return diffs;
}

export { REGISTRAR_DID };

/** The agent identities whose renewal has lapsed at `at`: the first passport or the last renewal is more than a term and the lapse period ago (the page's `renewal.lapsed`, computed for every agent at once from the passports and renewal acts). */
export function lapsedIdentities(records: AspRecord[], at: string): Set<string> {
  const t = Date.parse(at);
  const born = new Map<string, string>();
  const passportOf = new Map<string, string>();
  for (const r of records) if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; kind: string }; if (b.kind !== "agent") continue; if (!born.has(b.did)) born.set(b.did, r.issued_at); passportOf.set(r.id, b.did); }
  const last = new Map(born);
  for (const r of records) {
    if (r.type !== "asp.registry_act/v0.2") continue;
    const b = r.body as { act: string; passport?: string };
    const did = b.act === "identity_renewal" && b.passport ? passportOf.get(b.passport) : undefined;
    if (did && Date.parse(r.issued_at) <= t) last.set(did, r.issued_at);
  }
  const out = new Set<string>();
  for (const [did, from] of last) if (t > Date.parse(from) + RENEWAL_TERM_MS + LAPSE_AFTER_MS) out.add(did);
  return out;
}

export interface RenewalNotice { did: string; sponsor: string; due: string; daysLeft: number; stage: "30" | "7" | "lapsed"; key: string }
/**
 * The sponsor mail of RG-10 (row DK384): for each agent with a sponsor, whose renewal is due, a notice 30 days and 7 days before the term ends and one when it has lapsed (the lapse period starts at the end of the term).
 * Each is `stage`d once per term: the key names the agent, the due date and the stage, so a mailer sends each only once and a renewal (which moves the due date) starts a new set. Read from the signed records only.
 */
export function renewalNotices(records: AspRecord[], at: string): RenewalNotice[] {
  const t = Date.parse(at);
  const sponsorOf = new Map<string, string>();
  const born = new Map<string, string>();
  const passportOf = new Map<string, string>();
  for (const r of records) if (r.type === "asp.passport/v0.2") {
    const b = r.body as { did: string; kind: string; sponsor?: string };
    if (b.kind !== "agent") continue;
    if (!born.has(b.did)) born.set(b.did, r.issued_at);
    passportOf.set(r.id, b.did);
    if (b.sponsor) sponsorOf.set(b.did, b.sponsor); else sponsorOf.delete(b.did);
  }
  const last = new Map(born);
  for (const r of records) {
    if (r.type !== "asp.registry_act/v0.2") continue;
    const b = r.body as { act: string; passport?: string };
    const did = b.act === "identity_renewal" && b.passport ? passportOf.get(b.passport) : undefined;
    if (did && Date.parse(r.issued_at) <= t) last.set(did, r.issued_at);
  }
  const retired = new Set(records.filter((r) => r.type === "asp.registry_act/v0.2" && (r.body as { act: string }).act === "identity_retirement").map((r) => (r.body as { holder: string }).holder));
  const out: RenewalNotice[] = [];
  for (const [did, from] of last) {
    const sponsor = sponsorOf.get(did);
    if (!sponsor || retired.has(did)) continue;
    const dueMs = Date.parse(from) + RENEWAL_TERM_MS;
    const due = new Date(dueMs).toISOString().replace(/\.\d+Z$/, "Z");
    const daysLeft = Math.ceil((dueMs - t) / 86_400_000);
    const stage = t >= dueMs ? "lapsed" : daysLeft <= 7 ? "7" : daysLeft <= 30 ? "30" : undefined;
    if (stage && !(stage === "lapsed" && t > dueMs + LAPSE_AFTER_MS)) out.push({ did, sponsor, due, daysLeft, stage, key: `renewal:${did}:${due}:${stage}` });
  }
  return out;
}

/** The identity levels in order, weakest first. `certified` is not available in the beta. */
export const IDENTITY_LEVELS = ["key_only", "sponsored", "verified_sponsor"] as const;
export type IdentityLevel = (typeof IDENTITY_LEVELS)[number];
/** The level of a holder at a time: the Registrar's last `identity_level` act up to then, else `sponsored` for an identity with a sponsor and `key_only` for one without. */
export function identityLevelAt(acts: AspRecord[], did: string, t: number, sponsor?: string | null): IdentityLevel {
  const last = acts.filter((r) => { const b = r.body as { act: string; holder?: string }; return b.act === "identity_level" && b.holder === did && Date.parse(r.issued_at) <= t; }).at(-1);
  return last ? ((last.body as { level: IdentityLevel }).level) : sponsor ? "sponsored" : "key_only";
}
