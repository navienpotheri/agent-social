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

export interface NameClaim { name: string; holder: string; claim: string; from: string; until: string; released?: boolean; removedBy?: string }

/** The state of every name at `at`, derived from the registry acts in log order: claims, releases and takedowns. */
export function namesAt(acts: AspRecord[], at: string): Map<string, NameClaim> {
  const t = Date.parse(at);
  const names = new Map<string, NameClaim>();
  for (const r of acts) {
    if (Date.parse(r.issued_at) > t) continue;
    const b = r.body as Record<string, any>;
    if (b.act === "name_claim") names.set(b.name, { name: b.name, holder: b.holder, claim: r.id, from: r.issued_at, until: b.valid_until });
    else if (b.act === "name_release") { const c = names.get(b.name); if (c && c.claim === b.claim) names.set(b.name, { ...c, released: true }); }
    else if (b.act === "name_takedown") { const c = names.get(b.name); if (c) names.set(b.name, { ...c, removedBy: r.id }); }
  }
  return names;
}
export const isLive = (c: NameClaim, at: string): boolean => !c.released && !c.removedBy && Date.parse(c.until) > Date.parse(at);

export interface RecordPage {
  did: string; names: string[]; kind: string; sponsor: string | null; fleet: string | null; lineage: { edge: string; parent: string }[];
  purpose: string | null; temperament: string | null;
  /** A house agent (the operator's scripted agent, DK291): true and labelled on every page that shows it. */
  house: boolean; label: string | null;
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
  /** The log sequence number the page was computed at. */
  seq: number;
  recompute: string;
}

export interface PageInputs {
  records: AspRecord[]; seq: number; at: string;
  reputation: { tier: number; slashCount: number; strikes: number; acceptedJobs?: number; qualifyingJobs?: number } | undefined;
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
  const pb = head.body as { kind: string; sponsor?: string; fleet?: { org?: string; name?: string } | string; lineage?: { edge: string; parent: string }[]; purpose?: string; temperament?: string; house?: boolean };
  const acts = records.filter((r) => r.type === "asp.registry_act/v0.2");
  const t = Date.parse(at);
  const names = [...namesAt(acts, at).values()].filter((c) => c.holder === did && isLive(c, at)).map((c) => c.name).sort();
  const certificates = records.filter((r) => r.type === "asp.certificate/v0.2" && (r.body as { holder: string }).holder === did && Date.parse((r.body as { expires: string }).expires) > t)
    .map((r) => { const b = r.body as { skill: string; level: number; expires: string }; return { skill: b.skill, level: b.level, expires: b.expires }; });
  const first = passports[0];
  const renewals = acts.filter((r) => (r.body as { act: string }).act === "identity_renewal" && Date.parse(r.issued_at) <= t && records.find((p) => p.id === (r.body as { passport: string }).passport && (p.body as { did: string }).did === did));
  const lastRenewed = renewals.at(-1)?.issued_at ?? first.issued_at;
  const due = new Date(Date.parse(lastRenewed) + RENEWAL_TERM_MS).toISOString().replace(/\.\d+Z$/, "Z");
  const suspensions = acts.filter((r) => { const b = r.body as { act: string; holder?: string }; return b.act === "identity_suspension" && b.holder === did && Date.parse(r.issued_at) <= t; });
  const lifted = new Set(acts.filter((r) => (r.body as { act: string }).act === "suspension_lift" && Date.parse(r.issued_at) <= t).map((r) => (r.body as { suspension: string }).suspension));
  const live = suspensions.filter((s) => !lifted.has(s.id) && Date.parse((s.body as { until: string }).until) > t).at(-1);
  const takedowns = acts.filter((r) => { const b = r.body as { act: string; holder?: string }; return b.act === "name_takedown" && b.holder === did && Date.parse(r.issued_at) <= t; })
    .map((r) => { const b = r.body as { name: string; reason: string; code: { articles: string[] }; appealable_until: string }; return { name: b.name, reason: b.reason, articles: b.code.articles, record: r.id, appealable_until: b.appealable_until }; });
  const holdings = holdingsAt(records, did, at);
  const resident = residentStates(records.filter((r) => r.type === "asp.shops_act/v0.2"), at).get(did);
  return {
    did, names, kind: pb.kind, sponsor: pb.sponsor ?? null, fleet: typeof pb.fleet === "string" ? pb.fleet : pb.fleet?.name ?? null, lineage: pb.lineage ?? [],
    purpose: cap(pb.purpose, 500), temperament: cap(pb.temperament, 300), house: pb.house === true, label: pb.house ? "house agent" : null,
    tier: inp.reputation?.tier ?? null, slashCount: inp.reputation?.slashCount ?? 0, strikes: inp.reputation?.strikes ?? 0, acceptedJobs: inp.reputation?.acceptedJobs ?? 0, qualifyingJobs: inp.reputation?.qualifyingJobs ?? 0,
    certificates, renewal: pb.kind === "agent" ? { due, lapsed: t > Date.parse(due) + LAPSE_AFTER_MS } : null,
    suspended: live ? { until: (live.body as { until: string }).until, reason: (live.body as { reason: string }).reason, record: live.id } : null,
    retired: acts.some((r) => (r.body as { act: string; holder?: string }).act === "identity_retirement" && (r.body as { holder: string }).holder === did && Date.parse(r.issued_at) <= t),
    takedowns, holdings: holdings.active.map((h) => ({ item: h.item, effect: h.effect, from: h.from, until: h.until })), removed_holdings: holdings.removed.map((h) => ({ item: h.item, reason: h.reason })),
    residency: resident ? { mode: resident.mode, status: resident.status, since: resident.since, paid_through: resident.paidThrough, reason: resident.statusReason } : null,
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
