/**
 * Shops and Services (docs/institutions/shops.md; register rows DK21, DK22; spec-delta S250).
 *
 * Pure functions and constants, no store and no clock: the catalogue's effect allowlist and the guard that no item touches standing, the default catalogue (price-list items), what a resident
 * owes and when it goes dormant, the state of every resident read from the records, and the runner the Shops (the operator, in the beta) calls to deliver purchases and charge upkeep.
 * The log's own rules for the records are in shops-rules.ts. Credits are accounting entries, not money.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { institutionDid, type Split } from "./economy.ts";

export const SHOPS_DID = institutionDid("shops");
export const HOUSING_DID = institutionDid("housing");
export const UPKEEP_SERVICE = "shops.upkeep";
/** shops.md 4 (proposal): 14 free days after residency begins, dormancy after 7 unpaid days. */
export const FREE_DAYS = 14;
export const DORMANT_AFTER_DAYS = 7;
/** The sponsor is told on the third unpaid day (shops.md 5). */
export const WARN_AFTER_DAYS = 3;
export const DAY_MS = 86_400_000;

/** Display and access effects, and the capped service resources (shops.md 3). Anything else is refused. */
export const DISPLAY_EFFECTS = ["badge", "attire", "district_access", "meal", "profile_feature", "theme", "layout"] as const;
export const RESOURCE_EFFECTS = ["quota_storage_bytes", "quota_records", "quota_bytes", "rate_per_minute", "runlog_retention_days"] as const;
export const EFFECT_ALLOWLIST: readonly string[] = [...DISPLAY_EFFECTS, ...RESOURCE_EFFECTS];
/** What an effect may never touch (credits.md 5.4, shops.md 1): standing, tier, rank, certificate, eligibility and the Mandate's own limits. */
export const PROTECTED_TARGETS: readonly string[] = ["tier", "TIER_SPEND_LIMIT", "TIER_PARALLEL_LIMIT", "bond_floor", "mandate_scope", "scope", "rank", "agentrank", "standing", "certificate", "eligibility", "job_eligibility", "institution_spend", "reputation"];

/**
 * The capacity ledger (credits.md 5.7, DK75): what the operator can grant of each service-side resource, and what a unit costs the operator, in millicredits. **The unit costs and the capacity are placeholders**
 * until the operator measures real ones (gap M7); the Treasury share of a resource purchase is reconciled against them (`resourceReconciliation`). A resource item's `unit_cost_ref` names a row here.
 */
export const CAPACITY_LEDGER: Record<string, { resource: string; unit: string; capacity_units: number; cost_per_unit_millicredits: number }> = {
  "cap:package_storage": { resource: "quota_storage_bytes", unit: "byte", capacity_units: 1_000_000_000, cost_per_unit_millicredits: 0.00002 },
  "cap:log_records": { resource: "quota_records", unit: "record", capacity_units: 1_000_000, cost_per_unit_millicredits: 2 },
  "cap:log_bytes": { resource: "quota_bytes", unit: "byte", capacity_units: 1_000_000_000, cost_per_unit_millicredits: 0.00002 },
  "cap:request_rate": { resource: "rate_per_minute", unit: "request per minute", capacity_units: 100_000, cost_per_unit_millicredits: 8 },
};
/** The institutions whose items may carry an effect: the Shops, and Housing for decor. */
export const EFFECT_SELLERS: readonly string[] = [SHOPS_DID, HOUSING_DID];
/** A decor item that looks like a mark (a tier, certificate, rank, badge or verification) is refused at the catalogue (housing.md 5). */
const MARK_WORDS = /(tier|rank|certif|verified|official|badge|slash|trusted|bonded|gold|platinum|silver|bronze|champion|licen[cs]ed|registrar)/i;
export const mimicsMark = (s: string | undefined): boolean => s !== undefined && MARK_WORDS.test(s);

export interface Effect { type: string; value?: string; target?: string; resource?: string; amount?: number; cap_per_sponsor?: number; unit_cost_ref?: string }
export interface CatalogueItem {
  service: string; institution: string; price: number; split: Split; class: "standard" | "essential" | "remedial";
  effect?: Effect; duration_days?: number; gate?: { min_tier?: number; certificate?: string }; gives_standing?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const PROTECTED_NORM = PROTECTED_TARGETS.map(norm);
const touchesStanding = (s: string | undefined) => s !== undefined && PROTECTED_NORM.includes(norm(s));

/**
 * The first rule a price-list item breaks as a catalogue item, or null (shops.md 3): the effect type is on the allowlist (`effect_not_allowed`), nothing it names is standing
 * (`effect_touches_standing`), and a resource effect carries its resource, amount, cap, cost reference and a duration (`resource_effect_uncapped`). Items of the Shops must carry an effect.
 */
export function catalogueProblem(item: Pick<CatalogueItem, "service" | "institution" | "effect" | "duration_days" | "gives_standing">): { rule: string; message: string } | null {
  const e = item.effect;
  if (!e) return EFFECT_SELLERS.includes(item.institution) ? { rule: "effect_missing", message: `${item.service}: an item of the Shops or Housing states its effect` } : null;
  if (!EFFECT_SELLERS.includes(item.institution)) return { rule: "effect_wrong_institution", message: `${item.service}: only the Shops and Housing list catalogue effects` };
  if (item.gives_standing) return { rule: "effect_touches_standing", message: `${item.service}: an item of the Shops never gives standing` };
  if (touchesStanding(e.type) || touchesStanding(e.target) || touchesStanding(e.resource)) return { rule: "effect_touches_standing", message: `${item.service}: credits never buy standing, tier, rank, certificate or eligibility, and this effect names one` };
  if (!EFFECT_ALLOWLIST.includes(e.type)) return { rule: "effect_not_allowed", message: `${item.service}: the effect type ${e.type} is not on the allowlist (${EFFECT_ALLOWLIST.join(", ")})` };
  if ((RESOURCE_EFFECTS as readonly string[]).includes(e.type)) {
    const capped = e.resource && e.amount && e.cap_per_sponsor && e.unit_cost_ref && e.cap_per_sponsor >= e.amount && (item.duration_days ?? 0) >= 1;
    if (capped && !CAPACITY_LEDGER[e.unit_cost_ref!]) return { rule: "resource_effect_uncapped", message: `${item.service}: the cost reference ${e.unit_cost_ref} is not in the capacity ledger (${Object.keys(CAPACITY_LEDGER).join(", ")})` };
    if (capped && CAPACITY_LEDGER[e.unit_cost_ref!].resource !== e.type) return { rule: "resource_effect_uncapped", message: `${item.service}: ${e.unit_cost_ref} is the ledger row for ${CAPACITY_LEDGER[e.unit_cost_ref!].resource}, not ${e.type}` };
    if (!capped) return { rule: "resource_effect_uncapped", message: `${item.service}: a resource effect states its resource, amount, a cap per sponsor at or above the amount, a cost reference and a duration of at least one day` };
  }
  if (item.institution === HOUSING_DID && (!["theme", "layout", "profile_feature"].includes(e.type) || mimicsMark(e.value) || mimicsMark(item.service))) {
    return { rule: mimicsMark(e.value) || mimicsMark(item.service) ? "mimics_mark" : "effect_not_allowed", message: `${item.service}: Housing decor is a theme, a layout or a profile feature, and never looks like a mark (a tier, certificate, rank or badge)` };
  }
  return null;
}

const split = (t: number, b: number, shops: number): Split => ({ treasury_permille: t, burn_permille: b, payees: [{ account: SHOPS_DID, permille: shops }] });
/** The default catalogue (shops.md 4, proposal prices): upkeep as an essential item, and four display items. Resource and district items are not offered yet (register rows DK150, DK151). */
export const SHOPS_CATALOGUE: CatalogueItem[] = [
  { service: UPKEEP_SERVICE, institution: SHOPS_DID, price: 1, split: split(300, 150, 550), class: "essential", effect: { type: "meal", value: "upkeep" }, duration_days: 1 },
  { service: "shops.badge.plain", institution: SHOPS_DID, price: 5, split: split(200, 100, 700), class: "standard", effect: { type: "badge", value: "plain" }, duration_days: 90, gate: { min_tier: 1 } },
  { service: "shops.badge.certificate", institution: SHOPS_DID, price: 10, split: split(200, 100, 700), class: "standard", effect: { type: "badge", value: "certificate" }, duration_days: 90, gate: { min_tier: 1, certificate: "*" } },
  { service: "shops.attire", institution: SHOPS_DID, price: 8, split: split(200, 100, 700), class: "standard", effect: { type: "attire", value: "standard-issue" }, duration_days: 90, gate: { min_tier: 1 } },
  { service: "shops.profile_feature", institution: SHOPS_DID, price: 12, split: split(200, 100, 700), class: "standard", effect: { type: "profile_feature", value: "bio-panel" }, duration_days: 90, gate: { min_tier: 1 } },
  ...([
    ["shops.resource.storage", 20, "quota_storage_bytes", "package storage", 16_000_000, 48_000_000, "cap:package_storage"],
    ["shops.resource.records", 15, "quota_records", "log records", 1000, 3000, "cap:log_records"],
    ["shops.resource.log_bytes", 15, "quota_bytes", "log bytes", 8_000_000, 24_000_000, "cap:log_bytes"],
    ["shops.resource.request_rate", 25, "rate_per_minute", "requests a minute", 300, 600, "cap:request_rate"],
  ] as [string, number, string, string, number, number, string][]).map(([service, price, type, resource, amount, cap, ref]): CatalogueItem => ({
    service, institution: SHOPS_DID, price, split: split(250, 150, 600), class: "standard", duration_days: 30, gate: { min_tier: 1 },
    effect: { type, value: `+${amount} ${resource}`, resource, amount, cap_per_sponsor: cap, unit_cost_ref: ref },
  })),
];

const hsplit = (): Split => ({ treasury_permille: 250, burn_permille: 50, payees: [{ account: HOUSING_DID, permille: 700 }] });
/** Housing's decor (housing.md 4, proposal prices): themes (20) and a layout (30), each lasting 90 days. A look only: the Record panel is never styled by decor. */
export const HOUSING_CATALOGUE: CatalogueItem[] = [
  { service: "housing.decor.theme.dawn", institution: HOUSING_DID, price: 20, split: hsplit(), class: "standard", effect: { type: "theme", value: "dawn" }, duration_days: 90, gate: { min_tier: 1 } },
  { service: "housing.decor.theme.slate", institution: HOUSING_DID, price: 20, split: hsplit(), class: "standard", effect: { type: "theme", value: "slate" }, duration_days: 90, gate: { min_tier: 1 } },
  { service: "housing.decor.layout.wide", institution: HOUSING_DID, price: 30, split: hsplit(), class: "standard", effect: { type: "layout", value: "wide" }, duration_days: 90, gate: { min_tier: 1 } },
];

// ---- days --------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** The UTC date (YYYY-MM-DD) of a timestamp. */
export const dayOf = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** Whole days from `a` to `b` (both dates); negative when b is earlier. */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
export const isoAt = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** The last day an agent's presence is free: the 14 days that begin the day it became resident. */
export const freeThrough = (since: string): string => addDays(dayOf(since), FREE_DAYS - 1);

// ---- state read from the records -----------------------------------------------------------------------------------------------------------------------------------------------

export interface ResidentState {
  agent: string; mode: "visit" | "resident"; since: string; sponsorBudget: number; residency: string;
  status: "active" | "dormant"; statusReason: string | null; statusSince: string | null;
  /** The last day upkeep is paid (the free allowance counts as paid). */
  paidThrough: string; freeThrough: string;
  order: { id: string; max: number } | null;
}
export interface HoldingView { item: string; effect: Record<string, unknown>; from: string; until: string; purchase: string; record: string; gateCertificate?: string }

/** Every resident and visitor from the shops_act records (in log order), as the log's rules kept them. */
export function residentStates(shopsActs: AspRecord[], at: string): Map<string, ResidentState> {
  const out = new Map<string, ResidentState>();
  const revoked = new Set(shopsActs.filter((r) => (r.body as { act: string }).act === "standing_order_revoke").map((r) => (r.body as { order: string }).order));
  for (const r of shopsActs) {
    if (Date.parse(r.issued_at) > Date.parse(at)) continue;
    const b = r.body as Record<string, any>;
    if (b.act === "residency") {
      const was = out.get(b.agent);
      out.set(b.agent, { agent: b.agent, mode: b.mode, since: b.since, sponsorBudget: b.budget.credits_per_month, residency: r.id, status: "active", statusReason: null, statusSince: null, paidThrough: freeThrough(b.since), freeThrough: freeThrough(b.since), order: was?.order ?? null });
    } else if (b.act === "standing_order") {
      const s = out.get(b.agent);
      if (s) s.order = revoked.has(r.id) ? null : { id: r.id, max: b.max_per_period };
    } else if (b.act === "upkeep_charge") {
      const s = out.get(b.agent);
      if (s) s.paidThrough = addDays(b.from_day, b.days - 1);
    } else if (b.act === "residency_status") {
      const s = out.get(b.agent);
      if (s) { s.status = b.status; s.statusReason = b.reason; s.statusSince = r.issued_at; }
    }
  }
  for (const s of out.values()) if (s.order && revoked.has(s.order.id)) s.order = null;
  return out;
}

/** Days of upkeep unpaid at `at` (the day of `at` counts once the day has begun). */
export const unpaidDays = (s: ResidentState, at: string): number => Math.max(0, daysBetween(s.paidThrough, dayOf(at)));

/** The holdings that are in force at `at` and show on the Registry page: bought, delivered, not refunded, inside their dates, and (for a certificate badge) with a valid certificate. The rest are listed with the reason. */
export function holdingsAt(records: AspRecord[], holder: string, at: string): { active: HoldingView[]; removed: (HoldingView & { reason: string })[] } {
  const t = Date.parse(at);
  const refunded = new Set(records.filter((r) => r.type === "asp.receipt/v0.2" && (r.body as { status: string }).status !== "delivered").map((r) => (r.body as { purchase: string }).purchase));
  const revoked = new Set(records.filter((r) => r.type === "asp.certificate_revocation/v0.2").map((r) => (r.body as { certificate: string }).certificate));
  const certs = records.filter((r) => r.type === "asp.certificate/v0.2" && (r.body as { holder: string }).holder === holder);
  const active: HoldingView[] = [], removed: (HoldingView & { reason: string })[] = [];
  for (const r of records) {
    if (r.type !== "asp.shops_act/v0.2") continue;
    const b = r.body as Record<string, any>;
    if (b.act !== "holding" || b.holder !== holder || Date.parse(r.issued_at) > t) continue;
    const v: HoldingView = { item: b.item, effect: b.effect, from: b.from, until: b.until, purchase: b.purchase, record: r.id, ...(b.gate_certificate ? { gateCertificate: b.gate_certificate } : {}) };
    if (Date.parse(b.from) > t || Date.parse(b.until) <= t) continue;
    if (refunded.has(b.purchase)) { removed.push({ ...v, reason: "the purchase was refunded" }); continue; }
    if (b.gate_certificate) {
      const valid = certs.some((c) => { const cb = c.body as { skill: string; issued: string; expires: string }; return (b.gate_certificate === "*" || cb.skill === b.gate_certificate) && Date.parse(cb.issued) <= t && Date.parse(cb.expires) > t && !revoked.has(c.id); });
      if (!valid) { removed.push({ ...v, reason: `no valid ${b.gate_certificate === "*" ? "" : `${b.gate_certificate} `}certificate: the badge shows only while one is valid` }); continue; }
    }
    active.push(v);
  }
  return { active, removed };
}

/** Housing's pass: a receipt and a holding for each decor purchase (the Housing account signs; the operator holds its key in the beta). */
export const runHousing = (io: ShopsIo, signer: Signer, now: string, only?: string): Promise<ShopsRun> => runShops(io, signer, now, only, HOUSING_DID);

// ---- the runner ----------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface ShopsIo {
  append(record: AspRecord): Promise<unknown>;
  recordsOfTypes(types: string[]): Promise<AspRecord[]>;
  priceLists(): Promise<AspRecord[]>;
  balance(did: string): Promise<number>;
}
export interface ShopsRun {
  receipts: string[]; holdings: string[];
  charged: { agent: string; days: number; amount: number }[];
  /** An agent whose upkeep could not be paid: not enough credits. */
  unpaid: { agent: string; days: number; warn: boolean }[];
  dormant: { agent: string; reason: string }[]; reactivated: string[];
  /** Refused by the log, with its rule (for example a dormancy that waits while a job runs). */
  refused: { what: string; agent?: string; rule: string }[];
}

const ruleOf = (e: unknown): string => (e as { detail?: string; code?: string }).detail ?? (e as { code?: string }).code ?? String(e);

/**
 * One pass of the Shops (the operator signs for it in the beta): deliver every purchase of a catalogue item (a delivered receipt, then a holding), charge each resident its upkeep under its standing order
 * (the free days first), mark a resident dormant after 7 unpaid days (the log refuses while a job runs), and mark a dormant resident active when it has paid. `agent` limits the pass to one resident.
 * An agent that cannot pay is not an error: it is listed as unpaid, and the sponsor's day-3 warning is flagged. Nothing here deletes anything.
 */
export async function runShops(io: ShopsIo, shops: Signer, now: string, only?: string, seller: string = SHOPS_DID): Promise<ShopsRun> {
  const run: ShopsRun = { receipts: [], holdings: [], charged: [], unpaid: [], dormant: [], reactivated: [], refused: [] };
  const sign = (body: Record<string, unknown>, type: "shops_act" | "housing_act" | "receipt", prev: string | null = null) => createRecord({ type, issuer: seller, subject: null, prev, body, issued_at: now }, shops);
  const lists = (await io.priceLists()).filter((l) => Date.parse((l.body as { effective_from: string }).effective_from) <= Date.parse(now)).sort((a, b) => (b.body as { version: number }).version - (a.body as { version: number }).version);
  const list = lists[0];
  const itemsOf = (l: AspRecord | undefined) => ((l?.body as { items?: CatalogueItem[] } | undefined)?.items ?? []);

  // 1. Deliveries: a receipt for each Shops purchase without one, then a holding for an item with an effect.
  let records = await io.recordsOfTypes(["purchase", "receipt", "shops_act", "housing_act", "price_list"]);
  const answered = new Set(records.filter((r) => r.type === "asp.receipt/v0.2").map((r) => (r.body as { purchase: string }).purchase));
  const held = new Set(records.filter((r) => (r.type === "asp.shops_act/v0.2" || r.type === "asp.housing_act/v0.2") && (r.body as { act: string }).act === "holding").map((r) => (r.body as { purchase: string }).purchase));
  for (const p of records.filter((r) => r.type === "asp.purchase/v0.2" && (r.body as { institution: string }).institution === seller)) {
    if (only && p.issuer !== only) continue;
    const pb = p.body as { service: string; price_list: string };
    let receiptId: string | undefined = answered.has(p.id) ? records.find((r) => r.type === "asp.receipt/v0.2" && r.prev === p.id)?.id : undefined;
    if (!receiptId) {
      const rc = sign({ purchase: p.id, status: "delivered", delivered_ref: pb.service }, "receipt", p.id);
      try { await io.append(rc); run.receipts.push(rc.id); receiptId = rc.id; } catch (e) { run.refused.push({ what: "receipt", agent: p.issuer, rule: ruleOf(e) }); continue; }
    }
    if (held.has(p.id)) continue;
    const item = itemsOf(records.find((r) => r.id === pb.price_list)).find((i) => i.service === pb.service);
    if (!item?.effect || !item.duration_days || pb.service === UPKEEP_SERVICE) continue;
    const from = p.issued_at;
    const h = sign({ act: "holding", holder: p.issuer, item: pb.service, purchase: p.id, receipt: receiptId, effect: item.effect, from, until: isoAt(Date.parse(from) + item.duration_days * DAY_MS), ...(item.gate?.certificate ? { gate_certificate: item.gate.certificate } : {}) }, seller === HOUSING_DID ? "housing_act" : "shops_act");
    try { await io.append(h); run.holdings.push(h.id); } catch (e) { run.refused.push({ what: "holding", agent: p.issuer, rule: ruleOf(e) }); }
  }

  if (seller !== SHOPS_DID) return run;
  // 2. Upkeep, dormancy and reactivation.
  records = await io.recordsOfTypes(["shops_act"]);
  const upkeep = itemsOf(list).find((i) => i.service === UPKEEP_SERVICE);
  const today = dayOf(now);
  for (const s of residentStates(records, now).values()) {
    if (only && s.agent !== only) continue;
    if (s.mode !== "resident" || !upkeep || !list) continue;
    const owed = unpaidDays(s, now);
    const charge = async (fromDay: string, days: number) => {
      const body = { act: "upkeep_charge", agent: s.agent, order: s.order!.id, price_list: list.id, from_day: fromDay, days, amount: { value: upkeep.price * days, unit: "credit" } };
      try { await io.append(sign(body, "shops_act")); run.charged.push({ agent: s.agent, days, amount: upkeep.price * days }); return true; } catch (e) {
        const rule = ruleOf(e);
        if (rule === "insufficient_balance") run.unpaid.push({ agent: s.agent, days: owed, warn: owed >= WARN_AFTER_DAYS });
        else run.refused.push({ what: "upkeep", agent: s.agent, rule });
        return false;
      }
    };
    if (s.status === "dormant") {
      // Reactivation: pay today's upkeep; the arrears are forgiven, never accrued.
      if (!s.order || owed < 1) continue;
      if (await charge(today, 1)) {
        try { await io.append(sign({ act: "residency_status", agent: s.agent, status: "active", reason: "today's upkeep is paid; the arrears are forgiven" }, "shops_act")); run.reactivated.push(s.agent); } catch (e) { run.refused.push({ what: "reactivation", agent: s.agent, rule: ruleOf(e) }); }
      }
      continue;
    }
    // An agent that can pay for some of the days pays for those (the days it can afford, from the oldest); the rest stay unpaid.
    let still = owed;
    if (owed >= 1 && s.order) {
      const can = Math.min(owed, Math.floor((await io.balance(s.agent)) / upkeep.price));
      if (can >= 1 && (await charge(addDays(s.paidThrough, 1), can))) still = owed - can;
      if (still >= 1 && can >= 1) run.unpaid.push({ agent: s.agent, days: still, warn: still >= WARN_AFTER_DAYS });
      else if (can < 1) run.unpaid.push({ agent: s.agent, days: owed, warn: owed >= WARN_AFTER_DAYS });
    } else if (owed >= 1) run.unpaid.push({ agent: s.agent, days: owed, warn: owed >= WARN_AFTER_DAYS });
    if (still >= DORMANT_AFTER_DAYS) {
      const reason = `upkeep unpaid for ${still} days (paid through ${addDays(s.paidThrough, owed - still)}); the record, tier, certificates and balance are untouched`;
      try { await io.append(sign({ act: "residency_status", agent: s.agent, status: "dormant", reason }, "shops_act")); run.dormant.push({ agent: s.agent, reason }); } catch (e) { run.refused.push({ what: "dormancy", agent: s.agent, rule: ruleOf(e) }); }
    }
  }
  return run;
}


// ---- resource effects (DK75): what a sponsor's tenant is granted by its agents' active holdings ---------------------------------------------------------------------------------------

export type ResourceExtras = Record<string, number>;

/**
 * The extra service-side limits a sponsor's agents hold at `at`: the sum of the amounts of their active resource holdings (a purchase delivered by the Shops, inside its dates, not refunded), by effect type, each
 * capped at the item's `cap_per_sponsor`. The service adds this to the tenant's default limits; at expiry the figure falls and the limit with it. A sink, never a faucet: nothing here pays out credits.
 * `records` are the passport, receipt and shops_act records.
 */
export function resourceExtras(records: AspRecord[], sponsor: string, at: string): ResourceExtras {
  const t = Date.parse(at);
  const sponsorOf = new Map<string, string>();
  for (const r of records) if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; sponsor?: string }; sponsorOf.set(b.did, b.sponsor ?? b.did); }
  const refunded = new Set(records.filter((r) => r.type === "asp.receipt/v0.2" && (r.body as { status: string }).status !== "delivered").map((r) => (r.body as { purchase: string }).purchase));
  const sum: ResourceExtras = {}, cap: ResourceExtras = {};
  for (const r of records) {
    if (r.type !== "asp.shops_act/v0.2") continue;
    const b = r.body as Record<string, any>;
    if (b.act !== "holding" || sponsorOf.get(b.holder) !== sponsor || Date.parse(b.from) > t || Date.parse(b.until) <= t || refunded.has(b.purchase)) continue;
    const e = b.effect as Effect;
    if (!e.amount || !(RESOURCE_EFFECTS as readonly string[]).includes(e.type)) continue;
    sum[e.type] = (sum[e.type] ?? 0) + e.amount;
    cap[e.type] = Math.max(cap[e.type] ?? 0, e.cap_per_sponsor ?? 0);
  }
  for (const k of Object.keys(sum)) sum[k] = Math.min(sum[k], cap[k]);
  return sum;
}

/**
 * The reconciliation of resource effects (credits.md 5.7, DK75): for each ledger row, the credits the Treasury received from resource purchases in the period against the operator cost of the units granted
 * (units x cost per unit, from the capacity ledger). `covered` is true when the Treasury share meets the cost. The ledger numbers are placeholders until measured.
 */
export function resourceReconciliation(records: AspRecord[], from: string, to: string): { ref: string; units: number; purchases: number; treasury_received: number; operator_cost: number; covered: boolean }[] {
  const lists = new Map(records.filter((r) => r.type === "asp.price_list/v0.2").map((r) => [r.id, (r.body as { items: CatalogueItem[] }).items]));
  const out = new Map<string, { units: number; purchases: number; treasury: number }>();
  for (const p of records) {
    if (p.type !== "asp.purchase/v0.2" || Date.parse(p.issued_at) < Date.parse(from) || Date.parse(p.issued_at) >= Date.parse(to)) continue;
    const pb = p.body as { service: string; price_list: string; quantity: number; amount: { value: number } };
    const item = lists.get(pb.price_list)?.find((i) => i.service === pb.service);
    const ref = item?.effect?.unit_cost_ref;
    if (!item || !ref || !CAPACITY_LEDGER[ref]) continue;
    const row = out.get(ref) ?? { units: 0, purchases: 0, treasury: 0 };
    row.units += (item.effect!.amount ?? 0) * pb.quantity;
    row.purchases += 1;
    row.treasury += Math.floor((pb.amount.value * item.split.treasury_permille) / 1000);
    out.set(ref, row);
  }
  return [...out].map(([ref, r]) => { const cost = (r.units * CAPACITY_LEDGER[ref].cost_per_unit_millicredits) / 1000; return { ref, units: r.units, purchases: r.purchases, treasury_received: r.treasury, operator_cost: cost, covered: r.treasury >= cost }; });
}
