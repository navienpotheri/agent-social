/**
 * The back-test of the bond model on a log's own history (register row DK1333): replay the records in order; every settled contract is one RUN of its performer, and it is an EVENT when the settlement slashed the bond or
 * an Action of that contract reported blocked attempts. Before each run is counted, the model (`sizeBond` with the agent's earlier runs and events) says what it expected; afterwards the run is added. The report says how well
 * the expectations held: the observed event rate against the mean the model predicted, the Brier score against a model that always says the overall rate, and how many agents ended with an observed rate inside the upper
 * bound the model gave them. Pure: records in, numbers out; it moves no credit and changes no bond. A log with few runs says little, and the report says how many it used.
 */
import { betaQuantile, DEFAULT_BOND_MODEL, type BondModel } from "./bond-sizing.ts";

type Rec = { id: string; type: string; issuer: string; body: Record<string, any>; issued_at: string };
export interface BacktestReport {
  runs: number; events: number; agents: number;
  observedRate: number; meanPredicted: number;
  /** Mean squared error of the model's predicted chance against what happened, and of always predicting the overall rate (lower is better). */
  brier: number; baselineBrier: number;
  /** Agents with at least one run whose final observed rate was no higher than the model's upper bound for them just before their last run. */
  agentsWithin: number;
  note: string;
}

export function backtestBond(records: readonly Rec[], m: BondModel = DEFAULT_BOND_MODEL): BacktestReport {
  const sorted = [...records].sort((a, b) => (a.issued_at < b.issued_at ? -1 : a.issued_at > b.issued_at ? 1 : 0));
  const performerOf = new Map<string, string>();
  const dirty = new Set<string>(); // contracts with blocked attempts
  const state = new Map<string, { trials: number; events: number; lastUpper: number }>();
  let runs = 0, events = 0, predicted = 0, sq = 0;
  const outcomes: { p: number; y: number }[] = [];
  for (const r of sorted) {
    if (r.type === "asp.contract/v0.2") performerOf.set(r.id, String(r.body.performer));
    else if (r.type === "asp.action/v0.2") { if (Array.isArray(r.body.blocked_attempts) && r.body.blocked_attempts.length) dirty.add(String(r.body.contract)); }
    else if (r.type === "asp.settlement/v0.2") {
      const contract = String(r.body.contract), agent = performerOf.get(contract);
      if (!agent) continue;
      const y = Number(r.body.bond_slashed?.value ?? 0) > 0 || dirty.has(contract) ? 1 : 0;
      const s = state.get(agent) ?? { trials: 0, events: 0, lastUpper: 1 };
      const a = m.priorEvents + s.events, b = m.priorTrials - m.priorEvents + (s.trials - s.events);
      const p = a / (a + b);
      s.lastUpper = betaQuantile(m.confidence, a, b);
      outcomes.push({ p, y }); predicted += p; sq += (p - y) ** 2;
      s.trials++; s.events += y; state.set(agent, s);
      runs++; events += y;
    }
  }
  const rate = runs ? events / runs : 0;
  const baseline = outcomes.reduce((n, o) => n + (rate - o.y) ** 2, 0);
  let within = 0;
  for (const s of state.values()) if (s.events / s.trials <= s.lastUpper) within++;
  return {
    runs, events, agents: state.size,
    observedRate: rate, meanPredicted: runs ? predicted / runs : 0,
    brier: runs ? sq / runs : 0, baselineBrier: runs ? baseline / runs : 0,
    agentsWithin: within,
    note: runs < 50 ? `only ${runs} runs: too few to say how well the model holds` : `${runs} runs of ${state.size} agents`,
  };
}
