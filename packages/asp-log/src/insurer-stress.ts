/**
 * BI-18: the Insurer's stress replay and its "still moving" line (bank-insurer.md 14.1 and 14.4; register rows DK491, DK185). Pure functions: records in, a published figure out; they write nothing.
 * The stress replay runs IN SIMULATION ONLY (14.3: a stress replay is never run live): the past 90 days of premiums and paid claims, with the claims multiplied (2 is "double the slash rate"), to see whether the
 * reserve would hold. Credits are accounting entries, not money.
 */
import { reserveFloor } from "./insurer.ts";

export interface StressEvent { at: string; kind: "premium" | "claim"; /** For a premium the part that reaches the reserve; for a claim the amount paid from it. */ amount: number; insured?: number }
export interface StressOptions { /** The harshness: claims paid are multiplied by this (2 is "double the slash rate"). */ multiplier?: number; windowDays?: number }
export interface StressResult {
  windowDays: number; multiplier: number; events: number; premiums: number; claimsPaid: number;
  /** The reserve at the start of the window (the reserve now less what the window added), the lowest it reached as it happened, and the lowest under the stress. */
  startReserve: number; minActual: number; minStressed: number; endStressed: number;
  /** The floor under the stress at the end (10 x the largest insured amount, 1.5 x the stressed 30-day claims, 500). */
  floorStressed: number;
  verdict: "holds" | "sales_stop" | "runs_dry";
  note: string;
}

/**
 * Each premium adds its reserve share, each claim paid takes its amount times the multiplier. The verdict: `holds` (the reserve ends at or above its floor), `sales_stop` (it stays above zero but ends below the floor, so no
 * new policy would be sold until it recovers) or `runs_dry` (it would go below zero, so claims would be paid down to what it holds). `reserveNow` is the reserve today, from which the start of the window is worked back.
 */
export function stressReplay(events: readonly StressEvent[], reserveNow: number, at: string, o: StressOptions = {}): StressResult {
  const windowDays = o.windowDays ?? 90, multiplier = o.multiplier ?? 2;
  const to = Date.parse(at), from = to - windowDays * 86_400_000;
  const inWindow = events.filter((e) => Date.parse(e.at) >= from && Date.parse(e.at) <= to).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const premiums = inWindow.filter((e) => e.kind === "premium").reduce((n, e) => n + e.amount, 0);
  const claimsPaid = inWindow.filter((e) => e.kind === "claim").reduce((n, e) => n + e.amount, 0);
  const startReserve = reserveNow - premiums + claimsPaid;
  let actual = startReserve, stressed = startReserve, minActual = startReserve, minStressed = startReserve;
  for (const e of inWindow) {
    if (e.kind === "premium") { actual += e.amount; stressed += e.amount; } else { actual -= e.amount; stressed -= e.amount * multiplier; }
    minActual = Math.min(minActual, actual); minStressed = Math.min(minStressed, stressed);
  }
  const largest = Math.max(0, ...inWindow.map((e) => e.insured ?? 0));
  const last30 = inWindow.filter((e) => e.kind === "claim" && Date.parse(e.at) >= to - 30 * 86_400_000).reduce((n, e) => n + e.amount * multiplier, 0);
  const floorStressed = reserveFloor(largest, last30 * 3);
  const verdict = minStressed < 0 ? "runs_dry" : stressed < floorStressed ? "sales_stop" : "holds";
  const what = `with claims ${multiplier} times what they were`;
  return { windowDays, multiplier, events: inWindow.length, premiums, claimsPaid, startReserve, minActual, minStressed, endStressed: stressed, floorStressed, verdict,
    note: verdict === "holds" ? `${what}, the reserve ends at ${stressed} against a floor of ${floorStressed}: it holds` : verdict === "sales_stop" ? `${what}, the reserve ends at ${stressed}, under its floor of ${floorStressed}: no new policy would be sold until it recovers` : `${what}, the reserve would reach ${minStressed}: claims would be paid down to what it holds` };
}

export interface DynamicsLine { policies: number; claims: number; claimsPer100: number | null; premiumDispersion: number | null; reserveStatus: "moving" | "frozen" | "too_little_data"; note: string }

/**
 * The "still moving" line (14.4): claims per 100 policies, the dispersion of the rate paid (premium divided by insured amount; near zero means the rating no longer tracks behaviour), and whether the reserve moved over
 * the weeks of the window (flat for eight weeks is frozen; fewer than eight weeks is not judged).
 */
export function dynamicsLine(rates: readonly { premium: number; insured: number }[], claims: number, weeklyReserve: readonly number[]): DynamicsLine {
  const policies = rates.length;
  const r = rates.filter((x) => x.insured > 0).map((x) => x.premium / x.insured);
  const mean = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
  const cv = r.length >= 2 && mean > 0 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length) / mean : null;
  const top = weeklyReserve.length ? Math.max(...weeklyReserve) : 0;
  const frozen = weeklyReserve.length >= 8 && top - Math.min(...weeklyReserve) <= 0.01 * Math.max(1, top);
  const status = weeklyReserve.length < 8 ? "too_little_data" : frozen ? "frozen" : "moving";
  return { policies, claims, claimsPer100: policies ? (100 * claims) / policies : null, premiumDispersion: cv, reserveStatus: status,
    note: `${policies} polic${policies === 1 ? "y" : "ies"}, ${claims} claim(s)${policies ? ` (${((100 * claims) / policies).toFixed(1)} per 100)` : ""}; rate dispersion ${cv === null ? "not measurable" : cv.toFixed(2)}; the reserve is ${status === "too_little_data" ? "not yet judged (fewer than 8 weeks of history)" : status}` };
}
