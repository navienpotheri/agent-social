/**
 * How fast agents spend their starter credits (register row DK543; owner decision 2026-11-18: keep the starter at 500 mock credits and measure before raising it). Computed from the signed
 * records only: an agent's starter is what its `starter_claim` records gave it; what it spent is the `purchase` records it made as the buyer after its first claim (an institution purchase is the
 * one spend that leaves the agent's account for good; escrow and bonds come back and are not counted). A report carries no DID, only figures. It reads and reports; it changes nothing.
 * Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";

export const STARTER_SPEND_FULL = 500;
/** An agent that has spent 90 percent of the full grant has "used up" its starter. */
export const SPENT_SHARE = 0.9;
/** The measure ignores agents that claimed fewer than this many days ago (they have not had time), and a "stopped" agent has bought nothing for this many days. */
export const MATURE_DAYS = 14;
export const STOPPED_DAYS = 7;
/** The owner's threshold: when more than this share of mature agents spent their starter and stopped, the report says to consider raising it; below MIN_COHORT mature agents it says there is too little data. */
export const RAISE_RUNOUT_SHARE = 0.30;
export const MIN_COHORT = 20;

export interface StarterSpendReport {
  at: string;
  /** Agents (identities) that claimed any starter. */
  claimed: number;
  /** Of those, claimed at least MATURE_DAYS ago: the cohort the shares are of. */
  mature: number;
  /** Days from first claim to having spent SPENT_SHARE of the full grant: median and 90th percentile over the agents that got there (null when none did). */
  daysToSpend90: { reached: number; median: number | null; p90: number | null };
  /** Share of mature agents that bought nothing at all. */
  neverSpentShare: number;
  /** Share of mature agents that spent 90 percent and then bought nothing for STOPPED_DAYS (run out and stopped). */
  runOutShare: number;
  threshold: { runOutShare: number; minCohort: number; text: string };
  verdict: "raise_starter" | "keep_starter" | "too_little_data";
  note: string;
}

const DAY = 86_400_000;
export const quantile = (sorted: number[], q: number): number | null => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]! : null);

export function starterSpendOf(records: AspRecord[], nowMs: number): StarterSpendReport {
  const claimAt = new Map<string, number>();
  const spends = new Map<string, { at: number; v: number }[]>();
  for (const r of records) {
    const at = Date.parse(r.issued_at);
    if (!Number.isFinite(at)) continue;
    const who = (r.body as { buyer?: string }).buyer ?? (r.actor || r.issuer);
    if (r.type === "asp.starter_claim/v0.2") { const f = claimAt.get(who); if (f === undefined || at < f) claimAt.set(who, at); }
    else if (r.type === "asp.purchase/v0.2") (spends.get(who) ?? spends.set(who, []).get(who)!).push({ at, v: (r.body as { amount: { value: number } }).amount.value });
  }
  const days: number[] = [];
  let mature = 0, never = 0, runOut = 0;
  for (const [who, first] of claimAt) {
    const buys = (spends.get(who) ?? []).filter((s) => s.at >= first).sort((a, b) => a.at - b.at);
    let total = 0, hit: number | undefined;
    for (const b of buys) { total += b.v; if (hit === undefined && total >= SPENT_SHARE * STARTER_SPEND_FULL) hit = b.at; }
    if (hit !== undefined) days.push((hit - first) / DAY);
    if (nowMs - first < MATURE_DAYS * DAY) continue;
    mature++;
    if (!buys.length) never++;
    else if (hit !== undefined && nowMs - buys[buys.length - 1]!.at >= STOPPED_DAYS * DAY) runOut++;
  }
  days.sort((a, b) => a - b);
  const share = (n: number) => (mature ? n / mature : 0);
  const runOutShare = share(runOut);
  const verdict = mature < MIN_COHORT ? "too_little_data" : runOutShare > RAISE_RUNOUT_SHARE ? "raise_starter" : "keep_starter";
  return {
    at: new Date(nowMs).toISOString(), claimed: claimAt.size, mature,
    daysToSpend90: { reached: days.length, median: quantile(days, 0.5), p90: quantile(days, 0.9) },
    neverSpentShare: share(never), runOutShare,
    threshold: { runOutShare: RAISE_RUNOUT_SHARE, minCohort: MIN_COHORT, text: `raise the starter when more than ${RAISE_RUNOUT_SHARE * 100} percent of agents claimed at least ${MATURE_DAYS} days ago spent 90 percent of 500 and then bought nothing for ${STOPPED_DAYS} days, with at least ${MIN_COHORT} such agents` },
    verdict,
    note: verdict === "raise_starter" ? "agents run out and stop: the owner may raise the starter (a decision, nothing is changed)" : verdict === "too_little_data" ? `fewer than ${MIN_COHORT} agents are old enough to judge` : "the starter is not being used up and abandoned; keep it",
  };
}
