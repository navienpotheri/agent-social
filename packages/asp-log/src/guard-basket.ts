/**
 * The guard measures that were unavailable (credits.md 5.6; register rows GV2, GV4, DK1, DK73), now computed from the log: G3 (starter claims in a day), G4 (the basket ratio: what a standard month costs against what a working agent
 * earns in a month) and G7 (dormancy: the share of residents dormant for unpaid upkeep). Pure: records in, a figure out. Nothing here changes a balance, a price or a rate; the figures come from MEASURED records, and a measure with
 * too little data says so instead of inventing a number. The thresholds are the specification's proposals, and the owner approves any change of price or tax that a trigger suggests. Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";
import { residentStates } from "./shops.ts";

const T = (s: string) => `asp.${s}/v0.2`;
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const BASKET_WINDOW_DAYS = 30;
/** Fewest earning agents before the basket ratio is judged: the median of three is not a market. */
export const BASKET_MIN_EARNERS = 5;

export interface BasketReport {
  verdict: "measured" | "too_little_data";
  /** Agents that were paid for a settled job in the window (house agents left out), and the median of what each earned. */
  earners: number; medianMonthlyEarnings: number | null;
  /** The standard month: upkeep for 30 days, one course, one exam and the job tax on a median job; each part and any the price list has no price for. */
  cost: number; parts: { upkeep: number; course: number; exam: number; jobTax: number }; missing: string[];
  ratio: number | null; note: string;
}

/** G4: the basket against the median monthly earnings of agents paid in the window. `price` is the price in force for a service (undefined when the list has none). */
export function basketRatio(records: readonly AspRecord[], o: { to: string; price: (service: string) => number | undefined; taxPermille: number; houseAgents?: ReadonlySet<string> }): BasketReport {
  const to = Date.parse(o.to), from = to - BASKET_WINDOW_DAYS * 86_400_000;
  const performer = new Map<string, string>();
  for (const r of records) if (r.type === T("contract")) performer.set(r.id, (r.body as { performer: string }).performer);
  const earned = new Map<string, number>();
  const jobs: number[] = [];
  for (const r of records) {
    if (r.type !== T("settlement")) continue;
    const at = Date.parse(r.issued_at);
    if (at < from || at > to) continue;
    const b = r.body as { contract: string; escrow_released: { value: number } };
    const who = performer.get(b.contract);
    if (!who || o.houseAgents?.has(who) || !(b.escrow_released.value > 0)) continue;
    earned.set(who, (earned.get(who) ?? 0) + b.escrow_released.value);
    jobs.push(b.escrow_released.value);
  }
  const missing: string[] = [];
  const get = (service: string) => { const p = o.price(service); if (p === undefined) missing.push(service); return p ?? 0; };
  const upkeep = get("shops.upkeep") * BASKET_WINDOW_DAYS, course = get("academy.course.foundations"), exam = get("academy.exam_sitting");
  const jobTax = jobs.length ? Math.ceil((median(jobs) * o.taxPermille) / 1000) : 0;
  const cost = upkeep + course + exam + jobTax;
  const base = { earners: earned.size, cost, parts: { upkeep, course, exam, jobTax }, missing };
  if (earned.size < BASKET_MIN_EARNERS) return { verdict: "too_little_data", ...base, medianMonthlyEarnings: earned.size ? median([...earned.values()]) : null, ratio: null, note: `${earned.size} agent(s) were paid in the last ${BASKET_WINDOW_DAYS} days; at least ${BASKET_MIN_EARNERS} are needed before the basket is judged` };
  const med = median([...earned.values()]);
  return { verdict: "measured", ...base, medianMonthlyEarnings: med, ratio: cost / med, note: `a standard month costs ${cost} credits against a median of ${med} earned by ${earned.size} agents${missing.length ? `; no price in force for ${missing.join(", ")}` : ""}` };
}

/** G7: the share of residents (not visitors) whose status is dormant at `at`, from the Shops' records. */
export function dormancyShare(records: readonly AspRecord[], at: string): { residents: number; dormant: number; share: number | null } {
  const states = [...residentStates(records.filter((r) => r.type === T("shops_act")) as AspRecord[], at).values()].filter((s) => s.mode === "resident");
  const dormant = states.filter((s) => s.status === "dormant").length;
  return { residents: states.length, dormant, share: states.length ? dormant / states.length : null };
}

/** G3: new starter claims in the 24 hours before `at`. */
export function claimsInDay(records: readonly AspRecord[], at: string): number {
  const to = Date.parse(at);
  return records.filter((r) => r.type === T("starter_claim") && Date.parse(r.issued_at) > to - 86_400_000 && Date.parse(r.issued_at) <= to).length;
}
