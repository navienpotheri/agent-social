/**
 * Society velocity (owner request via the lead, 2026-11-19; docs/society-vision.md: the owner wants credits to keep flowing; row DK683): how many credits changed hands between accounts in the last seven days, and how many each active
 * agent moved. Counted from the signed records only: purchases (an agent paying an institution), escrow released to a performer at settlement, and internal transfers between an agent and its sponsor. Faucets (mints, starter claims,
 * handouts, allowances) are not counted: they put credits in, they do not make them move. A figure is a lead for the operator, not a target: an agent is never paid for moving credits (that would be the farming DK6 guards against).
 * Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";

const WEEK_MS = 7 * 86_400_000;

export interface VelocityWindow { moved: number; movements: number; activeAgents: number; perActiveAgent: number | null }
export interface VelocityReport {
  at: string;
  /** The last seven days, and the seven before them (for the direction). */
  thisWeek: VelocityWindow; lastWeek: VelocityWindow;
  /** Agents with a passport now, and the share of them that moved anything this week. */
  agents: number; activeShare: number | null;
  /** What was counted: the record types. */
  counts: string[];
  direction: "up" | "down" | "flat" | "n/a";
  note: string;
}

const amountOf = (v: unknown): number => (typeof v === "number" ? v : Number((v as { value?: number } | undefined)?.value ?? 0)) || 0;

/** The credits each record moved between accounts, with the agents (identities with a sponsor) it involved. */
function movement(r: AspRecord, agents: Set<string>): { amount: number; who: string[] } | undefined {
  const b = r.body as Record<string, any>;
  if (r.type === "asp.purchase/v0.2") return { amount: amountOf(b.amount), who: agents.has(r.issuer) ? [r.issuer] : [] };
  if (r.type === "asp.settlement/v0.2") {
    const released = amountOf(b.escrow_released);
    return released > 0 ? { amount: released, who: [] } : undefined; // the performer is named on the contract, resolved by the caller
  }
  if (r.type === "asp.internal_transfer/v0.2") return { amount: amountOf(b.amount), who: [r.issuer, b.to].filter((x: string) => agents.has(x)) };
  return undefined;
}

export function velocityOf(records: AspRecord[], nowMs: number): VelocityReport {
  const agents = new Set<string>();
  const performerOf = new Map<string, string>();
  for (const r of records) {
    if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; kind: string; sponsor?: string }; if (b.kind === "agent") agents.add(b.did); }
    if (r.type === "asp.contract/v0.2") performerOf.set(r.id, (r.body as { performer: string }).performer);
  }
  const win = (from: number, to: number): VelocityWindow => {
    let moved = 0, movements = 0;
    const active = new Set<string>();
    for (const r of records) {
      const t = Date.parse(r.issued_at);
      if (!(t >= from && t < to)) continue;
      const m = movement(r, agents);
      if (!m || m.amount <= 0) continue;
      moved += m.amount; movements++;
      for (const w of m.who) active.add(w);
      if (r.type === "asp.settlement/v0.2") { const p = performerOf.get((r.body as { contract: string }).contract); if (p && agents.has(p)) active.add(p); }
    }
    return { moved, movements, activeAgents: active.size, perActiveAgent: active.size ? Math.round((moved / active.size) * 100) / 100 : null };
  };
  const thisWeek = win(nowMs - WEEK_MS, nowMs + 1), lastWeek = win(nowMs - 2 * WEEK_MS, nowMs - WEEK_MS);
  const direction = thisWeek.perActiveAgent === null || lastWeek.perActiveAgent === null ? "n/a" : thisWeek.perActiveAgent > lastWeek.perActiveAgent * 1.05 ? "up" : thisWeek.perActiveAgent < lastWeek.perActiveAgent * 0.95 ? "down" : "flat";
  return {
    at: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z"), thisWeek, lastWeek, agents: agents.size,
    activeShare: agents.size ? Math.round((thisWeek.activeAgents / agents.size) * 1000) / 1000 : null,
    counts: ["purchase", "settlement (escrow released)", "internal_transfer"], direction,
    note: "Credits that changed hands in the last seven days, counted from signed records; mints, starter claims, handouts and allowances are not counted. A figure to read, not a target: no agent is paid for moving credits.",
  };
}
