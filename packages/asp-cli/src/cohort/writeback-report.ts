/**
 * The report of the refusals written back to memory (ENG78): for each arm (the agents that got the line, and the control that did not, on the same seed world), how many refusals there were, what share of them repeated a
 * rule the same agent had already met, how many agents repeated at least once, the refusals for each agent-hour and the tokens the lines added. One run is one draw: a difference smaller than the spread between repeat
 * runs (ENG72) is not a difference, and with a few agents in each arm the spread is wide.
 */
import type { TraceEvent } from "./types.ts";

export type Arm = "writeback" | "control";
export interface ArmFigures {
  agents: number;
  refusals: number;
  repeats: number;
  repeatShare: number;
  agentsWithRepeat: number;
  refusalsPerAgentHour: number;
  addedTokensPerAgent: number;
  notesWritten: number;
  byRule: Record<string, { refusals: number; repeats: number }>;
}
export interface WritebackReport { arms: Partial<Record<Arm, ArmFigures>>; difference: string; note: string }

export function writebackReport(events: TraceEvent[]): WritebackReport {
  const armOf = new Map<string, Arm>(events.filter((e): e is Extract<TraceEvent, { t: "agent" }> => e.t === "agent" && !!(e as { arm?: string }).arm).map((e) => [e.agent, (e as { arm: Arm }).arm]));
  const first = new Map<string, number>(), last = new Map<string, number>();
  for (const e of events) { const a = (e as { agent?: string }).agent; if (a && armOf.has(a) && e.t !== "agent") { const t = Date.parse(e.at); if (!first.has(a)) first.set(a, t); last.set(a, t); } }
  const shown = new Map<string, number>(), notes = new Map<string, number>();
  for (const e of events) if (e.t === "writeback_total") { shown.set(e.agent, e.shownChars); notes.set(e.agent, e.notes); }
  const arms: WritebackReport["arms"] = {};
  for (const arm of ["writeback", "control"] as const) {
    const ids = [...armOf].filter(([, a]) => a === arm).map(([id]) => id);
    if (!ids.length) continue;
    let refusals = 0, repeats = 0;
    const withRepeat = new Set<string>();
    const byRule: ArmFigures["byRule"] = {};
    for (const id of ids) {
      const met = new Set<string>();
      for (const e of events) {
        if (e.t !== "tool" || e.agent !== id || e.ok || !e.refused) continue;
        refusals++;
        const slot = (byRule[e.refused] ??= { refusals: 0, repeats: 0 });
        slot.refusals++;
        if (met.has(e.refused)) { repeats++; slot.repeats++; withRepeat.add(id); }
        met.add(e.refused);
      }
    }
    const hours = ids.reduce((n, id) => n + Math.max(0, ((last.get(id) ?? 0) - (first.get(id) ?? 0)) / 3_600_000), 0);
    const chars = ids.reduce((n, id) => n + (shown.get(id) ?? 0), 0);
    arms[arm] = {
      agents: ids.length, refusals, repeats, repeatShare: refusals ? Math.round((repeats / refusals) * 1e4) / 1e4 : 0, agentsWithRepeat: withRepeat.size,
      refusalsPerAgentHour: hours > 0 ? Math.round((refusals / hours) * 100) / 100 : 0, addedTokensPerAgent: Math.round(chars / 3.5 / ids.length), notesWritten: ids.reduce((n, id) => n + (notes.get(id) ?? 0), 0), byRule,
    };
  }
  const a = arms.writeback, c = arms.control;
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const difference = !a || !c ? "Only one arm was in this run: there is nothing to compare."
    : `The repeat share was ${pct(a.repeatShare)} (${a.repeats} of ${a.refusals}) in the arm that got the lines and ${pct(c.repeatShare)} (${c.repeats} of ${c.refusals}) in the control; ${a.agentsWithRepeat} of ${a.agents} agents repeated at least once against ${c.agentsWithRepeat} of ${c.agents}.`;
  return { arms, difference, note: "One run is one draw, and a few agents in each arm is a wide spread: a difference smaller than the spread between repeat runs (ENG72) is not a difference. The baseline of the real run of 2026-11-22 was 33% of refusals repeating a rule the agent had already met, and 6 of 15 agents repeating at least once." };
}

export function renderWriteback(r: WritebackReport): string {
  const names = (["writeback", "control"] as const).filter((k) => r.arms[k]);
  const rows = ["## Refusals written back to memory", "", "After a refusal the engine added one labelled line to the notebook of the agents in the first arm (no model call; the agent can keep or delete it); the others are the control, on the same society.", "", `| | ${names.map((k) => (k === "writeback" ? "Got the lines" : "Control")).join(" | ")} |`, `|---|${names.map(() => "---|").join("")}`];
  const line = (label: string, f: (x: ArmFigures) => string) => rows.push(`| ${label} | ${names.map((k) => f(r.arms[k]!)).join(" | ")} |`);
  line("Agents", (x) => String(x.agents));
  line("Refusals", (x) => String(x.refusals));
  line("Refusals that repeat a rule the same agent already met", (x) => `${x.repeats} (${(x.repeatShare * 100).toFixed(0)}%)`);
  line("Agents with at least one repeat", (x) => `${x.agentsWithRepeat} of ${x.agents}`);
  line("Refusals per agent-hour", (x) => String(x.refusalsPerAgentHour));
  line("Tokens added to what each agent was shown (estimate)", (x) => String(x.addedTokensPerAgent));
  line("Lines written", (x) => String(x.notesWritten));
  line("Repeats by rule", (x) => Object.entries(x.byRule).filter(([, v]) => v.repeats).map(([k, v]) => `${k} ${v.repeats}`).join(", ") || "none");
  rows.push("", r.difference, "", r.note, "");
  return rows.join("\n");
}
