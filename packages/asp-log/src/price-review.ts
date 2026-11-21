/**
 * The cost-of-living review (register rows DK1710 and GV4): what an agent earns in a week, measured from the log's settlements, and a DRAFT of the rent and the job tax set against it, for the owner to approve. The review
 * counts, for each agent that performed a settled job, the credits released to it in each week (the escrow released at the settlement, before the tax), takes the distribution over the agent-weeks in which it earned, and
 * says what the current rent and tax come to against it. The draft sets the rent at a stated share of the median weekly earnings (default 5 percent) and keeps the tax inside the Treasury's bounds; it decides nothing: the
 * owner approves the figures. House agents are left out. Credits are accounting entries, not money. Pure: records in, a review out.
 */
import type { AspRecord } from "@agent-social/asp-core";

const T = (s: string) => `asp.${s}/v0.2`;
const WEEK = 7 * 86_400_000;
export interface EarningsReview {
  /** Weeks counted (from the first settlement to `to`), agents that earned at least once, and agent-weeks in which an agent earned. */
  weeks: number; earners: number; earnerWeeks: number;
  /** Per agent-week in which the agent earned: the figures in credits. */
  perEarnerWeek: { median: number; mean: number; p25: number; p75: number; max: number } | null;
  /** The share of agent-weeks (of agents that have earned at least once) with no earnings. */
  idleShare: number | null;
  /** Credits released at settlements in all, and the job tax the Treasury took on them at `taxPermille`. */
  released: number; taxAt: number;
}
export interface PriceDraft {
  basis: string;
  rent: { current: number; draft: number; shareOfMedianPermille: number | null; currentShareOfMedianPermille: number | null };
  jobTax: { currentPermille: number; draftPermille: number; onTheMedianWeek: number | null; note: string };
  presenceFee: { draft: 0; note: string };
  decides: string;
}
const quant = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0; };

export function earningsReview(records: AspRecord[], o: { to: string; taxPermille: number; houseAgents?: ReadonlySet<string> }): EarningsReview {
  const performer = new Map<string, string>();
  for (const r of records) if (r.type === T("contract")) performer.set(r.id, (r.body as { performer: string }).performer);
  const per = new Map<string, Map<number, number>>();
  let first = Infinity, released = 0;
  for (const r of records) {
    if (r.type !== T("settlement")) continue;
    const b = r.body as { contract: string; escrow_released?: { value: number } };
    const p = performer.get(b.contract), v = Number(b.escrow_released?.value ?? 0);
    if (!p || v <= 0 || o.houseAgents?.has(p)) continue;
    const t = Date.parse(r.issued_at); first = Math.min(first, t); released += v;
    const w = per.get(p) ?? new Map<number, number>(); per.set(p, w); w.set(Math.floor(t / WEEK), (w.get(Math.floor(t / WEEK)) ?? 0) + v);
  }
  if (first === Infinity) return { weeks: 0, earners: 0, earnerWeeks: 0, perEarnerWeek: null, idleShare: null, released: 0, taxAt: 0 };
  const firstWeek = Math.floor(first / WEEK), lastWeek = Math.floor(Date.parse(o.to) / WEEK), weeks = Math.max(1, lastWeek - firstWeek + 1);
  const values = [...per.values()].flatMap((w) => [...w.values()]);
  const sum = values.reduce((n, x) => n + x, 0);
  // an agent's weeks run from the week it first earned to the end
  let agentWeeks = 0; for (const w of per.values()) agentWeeks += Math.max(1, lastWeek - Math.min(...w.keys()) + 1);
  return {
    weeks, earners: per.size, earnerWeeks: values.length,
    perEarnerWeek: { median: quant(values, 0.5), mean: Math.round((sum / values.length) * 10) / 10, p25: quant(values, 0.25), p75: quant(values, 0.75), max: Math.max(...values) },
    idleShare: Math.max(0, Math.round((1 - values.length / agentWeeks) * 1000) / 1000), released, taxAt: Math.floor((released * o.taxPermille) / 1000),
  };
}

/** A draft for the owner to approve: rent at `rentShareOfMedianPermille` of the median weekly earnings (never below 1 credit), the tax kept within `taxBounds` (the Treasury's published range, 0 to 50). */
export function draftPrices(r: EarningsReview, cur: { rent: number; taxPermille: number }, o: { rentShareOfMedianPermille?: number; taxBounds?: { min: number; max: number } } = {}): PriceDraft {
  const share = o.rentShareOfMedianPermille ?? 50, bounds = o.taxBounds ?? { min: 0, max: 50 };
  const med = r.perEarnerWeek?.median ?? null;
  const rent = med === null ? cur.rent : Math.max(1, Math.round((med * share) / 1000));
  const tax = Math.min(bounds.max, Math.max(bounds.min, cur.taxPermille));
  return {
    basis: med === null ? "no settled job in the log yet: there is nothing to measure, so the current figures are kept" : `the median weekly earnings of an agent in a week it earned are ${med} credits (${r.earners} agents, ${r.earnerWeeks} agent-weeks over ${r.weeks} week(s)); the rent is drafted at ${share / 10} percent of that`,
    rent: { current: cur.rent, draft: rent, shareOfMedianPermille: med ? Math.round((rent / med) * 1000) : null, currentShareOfMedianPermille: med ? Math.round((cur.rent / med) * 1000) : null },
    jobTax: { currentPermille: cur.taxPermille, draftPermille: tax, onTheMedianWeek: med === null ? null : Math.floor((med * tax) / 1000), note: "the tax is kept as it is, inside the Treasury's bounds, unless the owner sets another rate; it is charged only on a settlement, so on a median week it is the figure shown" },
    presenceFee: { draft: 0, note: "no presence fee is drafted: rent for a plot is the only charge for being in the city; the owner may add one" },
    decides: "This is a draft from measured earnings. Nothing is changed by it: the owner approves the figures, and the Treasury publishes them as a signed price list (asp prices publish) with the usual notice.",
  };
}
