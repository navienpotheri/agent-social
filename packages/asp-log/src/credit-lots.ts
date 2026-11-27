/**
 * Purchased-credit lots (register row DK1370, ledger part; spec-delta S1413): the second ledger class. A lot is one sale: an amount left, an expiry and an optional refund window. Pure arithmetic over lots, no store and no
 * clock (the caller passes the time), so the log's markers and the property tests use the same rules. Starter and earned credits are not lots: they are whatever of a balance is not in a lot. Credits are accounting entries.
 */
import type { LogTx } from "./store.ts";

export interface Lot { id: string; left: number; expires: string; refundUntil?: string }
/** A lot expires within three years of its sale. */
export const LOT_MAX_MS = 3 * 365 * 86_400_000;

export async function lotsOf(tx: Pick<LogTx, "getMarker">, did: string): Promise<Lot[]> {
  const raw = await tx.getMarker(`plots:${did}`);
  return raw ? (JSON.parse(raw) as Lot[]) : [];
}
/** Everything held in lots, expired or not (expired credits stay locked until the expiry is recorded, so a balance never hides them). */
export const outstanding = (lots: Lot[]): number => lots.reduce((n, l) => n + l.left, 0);
/** What may be spent now: lots not yet expired. */
export const spendable = (lots: Lot[], at: string): number => lots.filter((l) => Date.parse(l.expires) > Date.parse(at)).reduce((n, l) => n + l.left, 0);

/** How `amount` is paid: unexpired lots first (earliest expiry first, then id for a tie), then `free` credits that are in no lot. */
export function drawPlan(lots: Lot[], amount: number, at: string, free: number): { ok: boolean; fromLots: number; fromFree: number; draws: { id: string; take: number }[] } {
  const live = lots.filter((l) => Date.parse(l.expires) > Date.parse(at) && l.left > 0).sort((a, b) => Date.parse(a.expires) - Date.parse(b.expires) || (a.id < b.id ? -1 : 1));
  let rest = amount;
  const draws: { id: string; take: number }[] = [];
  for (const l of live) { if (rest <= 0) break; const take = Math.min(l.left, rest); draws.push({ id: l.id, take }); rest -= take; }
  const fromLots = amount - rest;
  if (rest > free) return { ok: false, fromLots, fromFree: 0, draws };
  return { ok: true, fromLots, fromFree: rest, draws };
}
export function applyDraw(lots: Lot[], draws: { id: string; take: number }[]): Lot[] {
  const by = new Map(draws.map((d) => [d.id, d.take]));
  return lots.map((l) => ({ ...l, left: l.left - (by.get(l.id) ?? 0) })).filter((l) => l.left > 0);
}
