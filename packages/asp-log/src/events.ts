/**
 * Leisure and Events (docs/institutions/leisure-events.md; register rows DK36, DK37; spec-delta S272). Pure functions and constants: the entry item, the meeting view (who an agent met, of how many sponsors),
 * the calendar, the reconciliation of fees and prizes, and the Events office's pass (receipts, refunds, souvenirs). The log's rules are in events-rules.ts.
 * **Recreation never changes standing**: nothing here reads or writes a tier, strike, bond floor, qualifying-job count or certificate. Credits are accounting entries, not money.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { institutionDid, splitParts, type Split } from "./economy.ts";
import type { CatalogueItem, ShopsIo } from "./shops.ts";

export const EVENTS_DID = institutionDid("events");
export const ENTRY_SERVICE = "events.contest.entry";
export const EVENT_NOTICE_MS = 72 * 3_600_000;
/** Proposals (leisure-events.md 4, 5, 11 decision 4): at least 4 distinct sponsors for a prize, 3 entries and 2 seats per sponsor. */
export const MIN_SPONSORS = 4;
export const MAX_ENTRIES_PER_SPONSOR = 3;
export const DEFAULT_SEATS_PER_SPONSOR = 2;

const entrySplit = (): Split => ({ treasury_permille: 100, burn_permille: 50, payees: [{ account: EVENTS_DID, permille: 850 }] });
/** The contest entry (20 credits): the provider part (850 permille) goes to the prize pool, which is the Events account. */
export const EVENTS_CATALOGUE: CatalogueItem[] = [
  { service: ENTRY_SERVICE, institution: EVENTS_DID, price: 20, split: entrySplit(), class: "standard" },
];

export interface EventBody {
  form: "gathering" | "contest" | "festival"; title: string; place: string; starts: string; ends: string; opens: string; entries_close: string;
  capacity: number; per_sponsor_cap: number; min_tier: number; entry_service?: string; rules_sha256: string;
  judging?: { kind: "scored" | "panel"; scorer_sha256?: string; panel_size?: number; min_sponsors: number };
  prizes?: { rank: number; amount: number }[]; parent?: string;
}

const actOf = (r: AspRecord): Record<string, any> => r.body as Record<string, any>;
const isAct = (r: AspRecord) => r.type === "asp.events_act/v0.2";

/** The default prize table (leisure-events.md 4): 50, 30 and 20 percent of a pool, to ranks 1 to 3. */
export function defaultPrizes(pool: number): { rank: number; amount: number }[] {
  const first = Math.floor(pool / 2), second = Math.floor((pool * 3) / 10);
  return [{ rank: 1, amount: first }, { rank: 2, amount: second }, { rank: 3, amount: pool - first - second }].filter((p) => p.amount >= 1);
}

// ---- views --------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export type EventState = "scheduled" | "open" | "running" | "closed" | "results" | "cancelled";
export interface EventView { id: string; form: string; title: string; place: string; starts: string; ends: string; state: EventState; entries: number; rsvps: number; prizes: { rank: number; amount: number }[]; parent: string | null; rules_sha256: string }

/** The calendar at `at`: each event with its state, derived from the records. */
export function calendar(records: AspRecord[], at: string): EventView[] {
  const t = Date.parse(at);
  const acts = records.filter(isAct);
  const cancelled = new Set(acts.filter((r) => actOf(r).act === "event_cancel").map((r) => actOf(r).event));
  const resulted = new Set(acts.filter((r) => actOf(r).act === "contest_result").map((r) => actOf(r).event));
  return acts.filter((r) => actOf(r).act === "event").map((r) => {
    const b = actOf(r) as EventBody & { act: string };
    const state: EventState = cancelled.has(r.id) ? "cancelled" : resulted.has(r.id) ? "results" : t < Date.parse(b.opens) ? "scheduled" : t < Date.parse(b.starts) ? "open" : t < Date.parse(b.ends) ? "running" : "closed";
    return { id: r.id, form: b.form, title: b.title, place: b.place, starts: b.starts, ends: b.ends, state, entries: acts.filter((x) => actOf(x).act === "entry" && actOf(x).event === r.id).length, rsvps: acts.filter((x) => actOf(x).act === "rsvp" && actOf(x).event === r.id).length, prizes: b.prizes ?? [], parent: b.parent ?? null, rules_sha256: b.rules_sha256 };
  });
}

/**
 * The meeting view (leisure-events.md 3, DK37): the agents `agent` has an `interact` with, where both attended the event, and the number of distinct sponsors among them. Deterministic from the records; a display and
 * discovery signal only: no gate, price, bond or promotion reads it.
 */
export function meeting(records: AspRecord[], agent: string): { contacts: string[]; sponsor_contacts: number; events: number } {
  const sponsorOf = new Map<string, string>();
  for (const r of records) if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; sponsor?: string }; sponsorOf.set(b.did, b.sponsor ?? b.did); }
  const attended = new Set(records.filter((r) => isAct(r) && actOf(r).act === "attend").map((r) => `${actOf(r).event}|${r.issuer}`));
  const contacts = new Set<string>(), events = new Set<string>();
  for (const r of records) {
    if (!isAct(r) || actOf(r).act !== "interact") continue;
    const b = actOf(r);
    const other = r.issuer === agent ? b.with : b.with === agent ? r.issuer : undefined;
    if (!other || !attended.has(`${b.event}|${agent}`) || !attended.has(`${b.event}|${other}`)) continue;
    contacts.add(other); events.add(b.event);
  }
  return { contacts: [...contacts].sort(), sponsor_contacts: new Set([...contacts].map((c) => sponsorOf.get(c) ?? c)).size, events: events.size };
}

/** An agent's souvenirs (the Memories panel): cosmetic, never read by a price, gate or promotion. */
export function souvenirsOf(records: AspRecord[], agent: string): { event: string; kind: string; issued: string }[] {
  return records.filter((r) => isAct(r) && actOf(r).act === "souvenir" && actOf(r).agent === agent).map((r) => ({ event: actOf(r).event, kind: actOf(r).kind, issued: r.issued_at }));
}

/**
 * The reconciliation of the Events pool (credits.md 4, DK36): entry fees split by the price list (provider part to the pool, Treasury, burn), Treasury payments in, prizes paid out, refunds paid back, and the pool's
 * balance as the records give it. `balanced` is true when grants plus pool shares minus awards minus pool refunds equal the balance given. `records`: purchase, price_list, receipt, treasury_payment and events_act records.
 */
export function eventsReconciliation(records: AspRecord[], poolBalance: number): { entries: number; fees: number; pool_share: number; treasury_share: number; burned: number; grants: number; awards: number; refunded_from_pool: number; reserved: number; balanced: boolean } {
  const lists = new Map(records.filter((r) => r.type === "asp.price_list/v0.2").map((r) => [r.id, (r.body as { items: CatalogueItem[] }).items]));
  const purchases = new Map<string, AspRecord>();
  let fees = 0, pool = 0, treasury = 0, burned = 0, entries = 0;
  for (const p of records) {
    if (p.type !== "asp.purchase/v0.2") continue;
    const pb = p.body as { service: string; price_list: string; amount: { value: number }; institution: string };
    if (pb.institution !== EVENTS_DID) continue;
    const item = lists.get(pb.price_list)?.find((i) => i.service === pb.service);
    if (!item) continue;
    const parts = splitParts(pb.amount.value, item.split);
    fees += pb.amount.value; pool += parts.payees.reduce((n, x) => n + x.amount, 0); treasury += parts.treasury; burned += parts.burn; entries += 1;
    purchases.set(p.id, p);
  }
  const grants = records.filter((r) => r.type === "asp.treasury_payment/v0.2" && (r.body as { to: string }).to === EVENTS_DID).reduce((n, r) => n + (r.body as { amount: { value: number } }).amount.value, 0);
  const awards = records.filter((r) => isAct(r) && actOf(r).act === "contest_result").reduce((n, r) => n + (actOf(r).awards as { amount: number }[]).reduce((m, a) => m + a.amount, 0), 0);
  let refunded = 0;
  for (const rc of records) {
    if (rc.type !== "asp.receipt/v0.2" || (rc.body as { status: string }).status === "delivered") continue;
    const p = purchases.get((rc.body as { purchase: string }).purchase);
    if (!p) continue;
    const pb = p.body as { service: string; price_list: string; amount: { value: number } };
    const item = lists.get(pb.price_list)!.find((i) => i.service === pb.service)!;
    const parts = splitParts(pb.amount.value, item.split);
    const refund = (rc.body as { refund_amount?: { value: number } }).refund_amount?.value ?? 0;
    const refundable = parts.treasury + parts.payees.reduce((n, x) => n + x.amount, 0);
    refunded += Math.floor((refund * parts.payees.reduce((n, x) => n + x.amount, 0)) / refundable);
  }
  const reserved = records.filter((r) => isAct(r) && actOf(r).act === "event").reduce((n, r) => n + ((actOf(r).prizes ?? []) as { amount: number }[]).reduce((m, p) => m + p.amount, 0), 0);
  const resultsOrCancelled = new Set(records.filter((r) => isAct(r) && (actOf(r).act === "contest_result" || actOf(r).act === "event_cancel")).map((r) => actOf(r).event));
  const stillReserved = records.filter((r) => isAct(r) && actOf(r).act === "event" && !resultsOrCancelled.has(r.id)).reduce((n, r) => n + ((actOf(r).prizes ?? []) as { amount: number }[]).reduce((m, p) => m + p.amount, 0), 0);
  void reserved;
  return { entries, fees, pool_share: pool, treasury_share: treasury, burned, grants, awards, refunded_from_pool: refunded, reserved: stillReserved, balanced: grants + pool - awards - refunded === poolBalance };
}

// ---- the Events office's pass --------------------------------------------------------------------------------------------------------------------------------------------------

export interface EventsRun { receipts: string[]; refunds: string[]; souvenirs: string[]; refused: { what: string; agent?: string; rule: string }[] }
const ruleOf = (e: unknown): string => (e as { detail?: string; code?: string }).detail ?? (e as { code?: string }).code ?? String(e);

/**
 * One pass of the Events office (the operator signs for it in the beta): for each event that has a result, a delivered receipt for each entry purchase and a souvenir for each attendance, entry and placing; for a
 * cancelled event, a refunded receipt for each entry purchase (the price less the burned part: credits.md 4.3). It deletes and changes nothing else.
 */
export async function runEvents(io: ShopsIo, events: Signer, now: string): Promise<EventsRun> {
  const run: EventsRun = { receipts: [], refunds: [], souvenirs: [], refused: [] };
  const records = await io.recordsOfTypes(["purchase", "receipt", "events_act", "price_list"]);
  const acts = records.filter(isAct);
  const resulted = new Map(acts.filter((r) => actOf(r).act === "contest_result").map((r) => [actOf(r).event as string, r]));
  const cancelled = new Set(acts.filter((r) => actOf(r).act === "event_cancel").map((r) => actOf(r).event as string));
  const answered = new Set(records.filter((r) => r.type === "asp.receipt/v0.2").map((r) => (r.body as { purchase: string }).purchase));
  const lists = new Map(records.filter((r) => r.type === "asp.price_list/v0.2").map((r) => [r.id, (r.body as { items: CatalogueItem[] }).items]));
  const sign = (body: Record<string, unknown>, type: "receipt" | "events_act", prev: string | null = null) => createRecord({ type, issuer: EVENTS_DID, subject: null, prev, body, issued_at: now }, events);
  const have = new Set(acts.filter((r) => actOf(r).act === "souvenir").map((r) => `${actOf(r).event}|${actOf(r).agent}|${actOf(r).kind}`));
  const souvenir = async (event: string, agent: string, kind: string) => {
    if (have.has(`${event}|${agent}|${kind}`)) return;
    have.add(`${event}|${agent}|${kind}`);
    const s = sign({ act: "souvenir", event, agent, kind }, "events_act");
    try { await io.append(s); run.souvenirs.push(s.id); } catch (e) { run.refused.push({ what: "souvenir", agent, rule: ruleOf(e) }); }
  };
  for (const entry of acts.filter((r) => actOf(r).act === "entry")) {
    const b = actOf(entry), ev = b.event as string;
    const p = records.find((r) => r.id === b.purchase);
    if (!p || answered.has(p.id)) continue;
    if (resulted.has(ev)) {
      const rc = sign({ purchase: p.id, status: "delivered", delivered_ref: ev }, "receipt", p.id);
      try { await io.append(rc); run.receipts.push(rc.id); answered.add(p.id); } catch (e) { run.refused.push({ what: "receipt", agent: entry.issuer, rule: ruleOf(e) }); }
    } else if (cancelled.has(ev)) {
      const pb = p.body as { service: string; price_list: string; amount: { value: number } };
      const item = lists.get(pb.price_list)!.find((i) => i.service === pb.service)!;
      const parts = splitParts(pb.amount.value, item.split);
      const rc = sign({ purchase: p.id, status: "refunded", refund_amount: { value: pb.amount.value - parts.burn, unit: "credit" } }, "receipt", p.id);
      try { await io.append(rc); run.refunds.push(rc.id); answered.add(p.id); } catch (e) { run.refused.push({ what: "refund", agent: entry.issuer, rule: ruleOf(e) }); }
    }
  }
  for (const r of acts) {
    const b = actOf(r);
    if (b.act === "attend" && !cancelled.has(b.event)) await souvenir(b.event, r.issuer, "attended");
    if (b.act === "entry" && resulted.has(b.event)) await souvenir(b.event, r.issuer, "entered");
  }
  for (const [ev, res] of resulted) for (const a of actOf(res).awards as { agent: string; amount: number }[]) { const rank = (actOf(res).ranking as { agent: string; rank: number }[]).find((x) => x.agent === a.agent)?.rank; if (rank) await souvenir(ev, a.agent, `placed:${rank}`); }
  return run;
}

export type { ShopsIo as EventsIo };
