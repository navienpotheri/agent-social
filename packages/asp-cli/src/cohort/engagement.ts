/**
 * The engagement of a cohort run: how many agents left by their own choice, and how many of those left too soon (the owner's 2026-11-22 worry: all eighteen agents of the first real runs ended themselves within nine
 * seconds). `premature_leave_rate` is the share of the run's agents that confirmed a leave before T simulated minutes of their own stay (default 30) with nothing waiting for them. The target for the rungs from v2 is
 * under 10 percent; this module only MEASURES it, from the trace. A stop that reads like "there is no task" is counted as a candidate for a premature stop, whether it came by leave, by a message with no tool call,
 * or by the old one-call exit.
 */
import type { TraceEvent } from "./types.ts";

export interface EngagementReport {
  agents: number;
  left: number;
  /** Left before `thresholdMinutes` of simulated time since arrival, with no event waiting. */
  prematureLeaves: number;
  prematureLeaveRate: number;
  thresholdMinutes: number;
  /** Stops whose reason is of the form "no task / nothing needs action", by the way they were made. */
  prematureStopCandidates: { leave: number; text: number; stop_exploring: number };
  /** Leaves that came after an exit check and were honoured at the second call. */
  confirmedAfterCheck: number;
  /** Agents still in the society when the run ended (not left). */
  stayed: number;
  /** The target for rungs v2 and later; measured here, not claimed. */
  target: number;
}

export function engagementOf(events: TraceEvent[], thresholdMinutes = 30): EngagementReport {
  const agents = new Set(events.filter((e) => e.t === "agent").map((e) => (e as { agent: string }).agent));
  const leaves = events.filter((e): e is Extract<TraceEvent, { t: "leave" }> => e.t === "leave");
  const premature = leaves.filter((l) => l.sinceArrivalMs < thresholdMinutes * 60_000 && l.pending === 0);
  const cands = events.filter((e): e is Extract<TraceEvent, { t: "premature_stop_candidate" }> => e.t === "premature_stop_candidate");
  const n = agents.size || 1;
  return {
    agents: agents.size, left: new Set(leaves.map((l) => l.agent)).size, prematureLeaves: new Set(premature.map((l) => l.agent)).size,
    prematureLeaveRate: Math.round((new Set(premature.map((l) => l.agent)).size / n) * 1e4) / 1e4, thresholdMinutes,
    prematureStopCandidates: { leave: cands.filter((c) => c.via === "leave").length, text: cands.filter((c) => c.via === "text").length, stop_exploring: cands.filter((c) => c.via === "stop_exploring").length },
    confirmedAfterCheck: leaves.filter((l) => l.afterCheck).length, stayed: Math.max(0, agents.size - new Set(leaves.map((l) => l.agent)).size), target: 0.1,
  };
}

export function renderEngagement(r: EngagementReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  return [
    "## Did they stay? (engagement)",
    "",
    `- **Agents:** ${r.agents}; ${r.left} left by their own confirmed choice, ${r.stayed} did not leave (they rested, waited, or the run ended).`,
    `- **Premature leave rate:** ${pct(r.prematureLeaveRate)} (${r.prematureLeaves} of ${r.agents} agents left before ${r.thresholdMinutes} simulated minutes of their own stay with nothing waiting for them). The target for the rungs from v2 is under 10%: this is a measurement of this run, not a claim.`,
    `- **Stops of the form "no task / nothing needs action":** ${r.prematureStopCandidates.leave + r.prematureStopCandidates.text + r.prematureStopCandidates.stop_exploring} (${r.prematureStopCandidates.leave} by leave, ${r.prematureStopCandidates.text} by a message with no tool call, ${r.prematureStopCandidates.stop_exploring} by the old one-call exit).`,
    `- **Leaves honoured after the exit check:** ${r.confirmedAfterCheck} (the first leave call only shows what is open and records the reason; the second confirms).`,
    "",
  ].join("\n");
}
