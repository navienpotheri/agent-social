/**
 * The Courts (docs/institutions/courts.md; register rows DK12 precedent, DK13 routes, charter and appeals; spec-delta S232).
 *
 * Pure functions: the court charter's numbers and the route a dispute takes (a small claim has one juror and a flat fee; anything larger has a panel and a fee
 * scaled to the claim), and the precedent store, which is a VIEW over the log's rulings: rulings indexed by Article, verdict, route and price band, and the closest
 * precedents to a dispute by a published, deterministic score. A precedent is persuasive, not binding; a panel that departs from one says why (`departs_from`).
 */
import type { AspRecord } from "@agent-social/asp-core";
import { independent } from "./qualifying.ts";

export interface CourtRoutes {
  small_claim_max_price: number; small_claim_panel: number; small_claim_fee: number; standard_panel: number; appeal_panel: number;
  appeal_window_days: number; appeal_fee_small: number; appeal_fee_standard: number; appeal_small_max_price: number; claimant_open_cap: number;
}
export const ROUTE_KEYS: (keyof CourtRoutes)[] = ["small_claim_max_price", "small_claim_panel", "small_claim_fee", "standard_panel", "appeal_panel", "appeal_window_days", "appeal_fee_small", "appeal_fee_standard", "appeal_small_max_price", "claimant_open_cap"];
/** courts.md 5 (proposals): the first charter's numbers. Appeals use these even before a charter is published; the small-claim route and the caseload cap apply once one is in force. */
export const DEFAULT_ROUTES: CourtRoutes = { small_claim_max_price: 50, small_claim_panel: 1, small_claim_fee: 2, standard_panel: 3, appeal_panel: 5, appeal_window_days: 14, appeal_fee_small: 5, appeal_fee_standard: 20, appeal_small_max_price: 100, claimant_open_cap: 3 };
export const APPEAL_SERVICE_SMALL = "courts.appeal.small";
export const APPEAL_SERVICE_STANDARD = "courts.appeal.standard";
export const CHARTER_NOTICE_MS = 72 * 3600 * 1000;

export type CourtRoute = "small_claim" | "standard";
/** The route a contract's dispute takes, decided by its price alone, so no extra record is needed. */
export function routeFor(price: number, r: CourtRoutes): { route: CourtRoute; panel: number; flatFee: number | null } {
  return price <= r.small_claim_max_price ? { route: "small_claim", panel: r.small_claim_panel, flatFee: r.small_claim_fee } : { route: "standard", panel: r.standard_panel, flatFee: null };
}

export type PriceBand = "under_20" | "20_to_59" | "60_to_199" | "200_plus";
export const priceBand = (price: number): PriceBand => (price >= 200 ? "200_plus" : price >= 60 ? "60_to_199" : price >= 20 ? "20_to_59" : "under_20");

export interface RulingEntry {
  id: string; contract: string; verdict: string; route: CourtRoute | "small_claim" | "appeal" | "standard"; band: PriceBand; articles: string[]; at: string;
  signers: string[]; principal: string; performer: string; reasons: string[];
  /** The appeal outcome, when the ruling was appealed. */
  appeal?: { id: string; outcome: string; articles: string[] };
  precedents: string[];
}

/**
 * Every ruling in the log as a precedent entry. Rulings between linked parties (one sponsor, one fleet, or one sponsoring the other: the independence rule
 * of credits.md 5.4) are left out, so staged disputes cannot make a precedent. `records` are the contracts, passports, rulings and court acts in log order;
 * `signers` maps a record id to the DIDs that signed it (the log knows them from the key registry).
 */
export function indexRulings(records: AspRecord[], signersOf: (r: AspRecord) => string[], routes: CourtRoutes = DEFAULT_ROUTES): RulingEntry[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const passports = new Map<string, { sponsor: string | null; fleet: string | null }>();
  for (const r of records) if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; sponsor?: string; fleet?: string | { name?: string } }; passports.set(b.did, { sponsor: b.sponsor ?? null, fleet: typeof b.fleet === "string" ? b.fleet : b.fleet?.name ?? null }); }
  const facts = (did: string) => ({ did, sponsor: passports.get(did)?.sponsor ?? did, fleet: passports.get(did)?.fleet ?? null });
  const appeals = new Map<string, { id: string; outcome: string; articles: string[] }>();
  for (const r of records) {
    const b = r.body as Record<string, any>;
    if (r.type === "asp.court_act/v0.2" && b.act === "appeal_ruling") { const a = byId.get(b.appeal); if (a) appeals.set((a.body as { ruling: string }).ruling, { id: r.id, outcome: b.outcome, articles: b.code.articles }); }
  }
  const out: RulingEntry[] = [];
  for (const r of records) {
    const b = r.body as Record<string, any>;
    if (r.type !== "asp.attestation/v0.2" || b.kind !== "ruling") continue;
    const c = byId.get(b.about);
    if (!c) continue;
    const cb = c.body as { principal: string; performer: string; price: { value: number } };
    if (!independent(facts(cb.principal), facts(cb.performer))) continue;
    out.push({
      id: r.id, contract: c.id, verdict: b.verdict, route: b.route ?? routeFor(cb.price.value, routes).route, band: priceBand(cb.price.value), articles: b.code?.articles ?? [], at: r.issued_at,
      signers: signersOf(r), principal: cb.principal, performer: cb.performer, reasons: b.reasons ?? [], precedents: b.precedents ?? [], ...(appeals.has(r.id) ? { appeal: appeals.get(r.id)! } : {}),
    });
  }
  return out;
}

export interface PrecedentQuery { articles?: string[]; verdict?: string; band?: PriceBand; route?: string }
export interface PrecedentHit { ruling: RulingEntry; score: number; why: string[] }

/** courts.md 3: +3 per shared Article, +2 the same verdict, +1 the same price band, +1 the same route; the closest 5 with a score above 3; ties by newest then id. */
export function closestPrecedents(q: PrecedentQuery, rulings: RulingEntry[], limit = 5, floor = 3): PrecedentHit[] {
  const hits: PrecedentHit[] = [];
  for (const ruling of rulings) {
    const shared = (q.articles ?? []).filter((a) => ruling.articles.includes(a));
    const why: string[] = [];
    let score = 0;
    if (shared.length) { score += 3 * shared.length; why.push(`Article ${shared.join(", ")} (+${3 * shared.length})`); }
    if (q.verdict && q.verdict === ruling.verdict) { score += 2; why.push(`verdict ${ruling.verdict} (+2)`); }
    if (q.band && q.band === ruling.band) { score += 1; why.push(`price band ${ruling.band} (+1)`); }
    if (q.route && q.route === ruling.route) { score += 1; why.push(`route ${ruling.route} (+1)`); }
    if (score > floor) hits.push({ ruling, score, why });
  }
  return hits.sort((a, b) => b.score - a.score || (a.ruling.at < b.ruling.at ? 1 : a.ruling.at > b.ruling.at ? -1 : a.ruling.id < b.ruling.id ? -1 : 1)).slice(0, limit);
}

/** A search over the store (courts.md 7 `precedent search`): every filter given must match; newest first. */
export function searchRulings(f: { article?: string; verdict?: string; band?: string; route?: string }, rulings: RulingEntry[]): RulingEntry[] {
  return rulings.filter((r) => (!f.article || r.articles.includes(f.article)) && (!f.verdict || r.verdict === f.verdict) && (!f.band || r.band === f.band) && (!f.route || r.route === f.route))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : 1));
}

/** The Articles a party cites in free text ("Article 4.1", "clause 8.3"), so a pending dispute can be matched to precedent. */
export const articlesIn = (texts: string[]): string[] => [...new Set(texts.flatMap((t) => [...t.matchAll(/\b(?:Article|Articles|clause)\s+((?:1[0-2]|[1-9])(?:\.[0-9]{1,2})?)\b/gi)].map((m) => m[1])))];
