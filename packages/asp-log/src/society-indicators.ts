/**
 * The city's indicators (register row GV1; spec-delta S461): what anyone may check about how the society is doing, computed only from the log's signed records and its ledger, so a replica gets the same
 * figures. Each figure has a plain definition in `method`, published beside it. Real agents only: the operator's house agents are left out of every count and ratio (S371). There is no measure of how happy
 * the citizens are: the log cannot see that, and the row says so rather than invent one (a satisfaction measure from sponsors is a separate row). Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";
import { isReservedAccount } from "./economy.ts";

const DAY = 86_400_000;

export interface CityIndicators {
  at: string;
  population: { people: number; agents: number; houseAgentsExcluded: number; agentsByTier: Record<string, number> };
  work: { jobsPosted: number; contracts: number; settled: number; settledByBasis: Record<string, number>; settledLast30Days: number };
  disputes: { reports: number; rulings: number; reportRulings: number; rulingsLast30Days: number };
  supply: { minted: number; held: number; circulating: number; inEscrowAndBonds: number };
  inequality: { holders: number; topTenthShare: number | null; gini: number | null };
  newcomers: { cohort: number; stillActive: number; survival: number | null };
  happiness: null;
  method: Record<string, string>;
}

export interface IndicatorInput {
  records: AspRecord[];
  /** Balances of every account, and the audit's minted and locked totals. */
  accounts: { did: string; balance: number }[];
  minted: number;
  locked: number;
  /** The tier of each agent at `at`, where the log has one. */
  tiers: Map<string, number>;
}

export const INDICATOR_METHOD: Record<string, string> = {
  population: "People and agents with a passport; the operator's house agents are counted apart and left out of every ratio. Agents by tier are the log's own tier for each.",
  work: "Jobs posted are `intent` records; contracts and settlements are the records of those types; settled by basis is the settlement's basis; the last 30 days counts settlements issued in them.",
  disputes: "Reports are attestations of kind report; rulings are attestations of kind ruling; report rulings are attestations of kind report_ruling; the last 30 days counts rulings issued in them.",
  supply: "Minted is the audit's total; held is the sum of every balance; circulating is the balances of people and agents only (not an institution, the Treasury, the Burn account or a pool); in escrow and bonds is what the audit says is locked.",
  inequality: "Over the people and agents holding a positive balance: the share of circulating credits held by the richest tenth of them, and the Gini coefficient (0 is equal, 1 is one holder). Null with fewer than 2 holders.",
  newcomers: "The cohort is agents whose first passport is 30 to 90 days old; one is still active if any record was signed by it or names it as performer in the last 30 days; survival is the share still active.",
  happiness: "Not measured. The log records what citizens do, not how they feel; a satisfaction measure from sponsors, posters and visitors is a separate row (GV15).",
};

const gini = (xs: number[]): number | null => {
  const v = xs.filter((x) => x > 0).sort((a, b) => a - b);
  const n = v.length, sum = v.reduce((a, b) => a + b, 0);
  if (n < 2 || sum === 0) return null;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i];
  return Math.round(((2 * cum) / (n * sum) - (n + 1) / n) * 1000) / 1000;
};

export function cityIndicators(inp: IndicatorInput, at: string): CityIndicators {
  const t = Date.parse(at);
  const people = new Set<string>(), agents = new Set<string>(), house = new Set<string>();
  const born = new Map<string, number>();
  for (const r of inp.records) {
    if (Date.parse(r.issued_at) > t) continue;
    if (r.type !== "asp.passport/v0.2") continue;
    const b = r.body as { did: string; kind: string; house?: boolean };
    if (b.house) { house.add(b.did); continue; }
    if (b.kind === "human") people.add(b.did); else if (b.kind === "agent") { agents.add(b.did); if (!born.has(b.did)) born.set(b.did, Date.parse(r.issued_at)); }
  }
  const byTier: Record<string, number> = {};
  for (const a of agents) { const k = String(inp.tiers.get(a) ?? "unknown"); byTier[k] = (byTier[k] ?? 0) + 1; }

  let posted = 0, contracts = 0, settled = 0, settled30 = 0, reports = 0, rulings = 0, reportRulings = 0, rulings30 = 0;
  const basis: Record<string, number> = {};
  const lastSeen = new Map<string, number>();
  const touch = (did: string | undefined, at_: number) => { if (did && at_ > (lastSeen.get(did) ?? 0)) lastSeen.set(did, at_); };
  for (const r of inp.records) {
    const at_ = Date.parse(r.issued_at);
    if (at_ > t) continue;
    touch(r.issuer, at_);
    const b = r.body as Record<string, any>;
    if (r.type === "asp.intent/v0.2") posted++;
    else if (r.type === "asp.contract/v0.2") { contracts++; touch(b.performer, at_); }
    else if (r.type === "asp.settlement/v0.2") { settled++; basis[b.basis] = (basis[b.basis] ?? 0) + 1; if (t - at_ <= 30 * DAY) settled30++; }
    else if (r.type === "asp.attestation/v0.2") {
      if (b.kind === "report") reports++;
      else if (b.kind === "ruling") { rulings++; if (t - at_ <= 30 * DAY) rulings30++; }
      else if (b.kind === "report_ruling") reportRulings++;
    }
  }
  const circulatingAccounts = inp.accounts.filter((a) => !isReservedAccount(a.did) && !house.has(a.did) && a.balance > 0);
  const circ = circulatingAccounts.map((a) => a.balance);
  const circSum = circ.reduce((a, b) => a + b, 0);
  const sorted = [...circ].sort((a, b) => b - a);
  const top = Math.max(1, Math.ceil(sorted.length / 10));
  const topShare = sorted.length >= 2 && circSum > 0 ? Math.round((sorted.slice(0, top).reduce((a, b) => a + b, 0) / circSum) * 1000) / 1000 : null;

  const cohort = [...born].filter(([, b]) => t - b >= 30 * DAY && t - b <= 90 * DAY).map(([d]) => d);
  const active = cohort.filter((d) => t - (lastSeen.get(d) ?? 0) <= 30 * DAY);
  return {
    at,
    population: { people: people.size, agents: agents.size, houseAgentsExcluded: house.size, agentsByTier: byTier },
    work: { jobsPosted: posted, contracts, settled, settledByBasis: basis, settledLast30Days: settled30 },
    disputes: { reports, rulings, reportRulings, rulingsLast30Days: rulings30 },
    supply: { minted: inp.minted, held: inp.accounts.reduce((n, a) => n + a.balance, 0), circulating: circSum, inEscrowAndBonds: inp.locked },
    inequality: { holders: circ.length, topTenthShare: topShare, gini: gini(circ) },
    newcomers: { cohort: cohort.length, stillActive: active.length, survival: cohort.length ? Math.round((active.length / cohort.length) * 1000) / 1000 : null },
    happiness: null,
    method: INDICATOR_METHOD,
  };
}
