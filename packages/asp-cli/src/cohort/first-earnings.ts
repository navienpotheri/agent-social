/**
 * The first-earnings trajectory (DK1323): how long an agent that joins takes to its first credit earned, its first job, its first message and its first card, read from the trace: the time since the agent's own first moment and the
 * turn number, for each agent that got there, with the median, and how many never did. A credit is "earned" by a call that pays in this society (a delivered house job, a first look at a place, a field card answered), so the figure
 * is an approximation from the calls; the credit economy file has the exact flows. Counts only; it sets no target.
 */
import type { TraceEvent } from "./types.ts";

type ToolEv = Extract<TraceEvent, { t: "tool" }>;
const EARNS = new Set(["deliver_job", "inspect", "field_answer"]);
export const MILESTONES: Array<{ key: string; label: string; hit: (e: ToolEv) => boolean }> = [
  { key: "credit", label: "first credit earned", hit: (e) => e.ok && EARNS.has(e.tool) },
  { key: "job", label: "first job delivered", hit: (e) => e.ok && e.tool === "deliver_job" },
  { key: "message", label: "first message to another agent", hit: (e) => e.ok && e.tool === "send_message" && !String(e.input.to ?? "").startsWith("house-") },
  { key: "card", label: "first card (a field card answered or a lesson card published)", hit: (e) => e.ok && (e.tool === "field_answer" || e.tool === "lesson_publish") },
];

export interface Trajectory { agents: number; rows: Array<{ key: string; label: string; reached: number; medianSeconds: number | null; medianTurn: number | null }> }

const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export function trajectory(events: TraceEvent[]): Trajectory {
  const ids = [...new Set(events.filter((e) => e.t === "agent").map((e) => (e as { agent: string }).agent))];
  const begin = new Map<string, number>();
  for (const e of events) if (e.t === "agent" || e.t === "arrival") { const a = (e as { agent: string }).agent, t = Date.parse(e.at); if (!begin.has(a) || t < begin.get(a)!) begin.set(a, t); }
  const tools = events.filter((e): e is ToolEv => e.t === "tool");
  const rows = MILESTONES.map((m) => {
    const secs: number[] = [], turns: number[] = [];
    for (const a of ids) {
      const hit = tools.find((e) => e.agent === a && m.hit(e));
      if (!hit) continue;
      secs.push(Math.max(0, (Date.parse(hit.at) - (begin.get(a) ?? Date.parse(hit.at))) / 1000)); turns.push(hit.turn);
    }
    return { key: m.key, label: m.label, reached: secs.length, medianSeconds: median(secs), medianTurn: median(turns) };
  });
  return { agents: ids.length, rows };
}

export function renderTrajectory(events: TraceEvent[]): string {
  const t = trajectory(events);
  const L = ["## Time to first earnings, first job, first message, first card", ""];
  L.push(`For each of ${t.agents} agents, the time from its arrival (wall clock of the run) and the turn at which it first reached each point:`);
  for (const r of t.rows) L.push(`- ${r.label}: ${r.reached} of ${t.agents} agents${r.reached ? `, median ${Math.round(r.medianSeconds! * 10) / 10} s and turn ${r.medianTurn}` : ""}${r.reached < t.agents ? `; ${t.agents - r.reached} never got there in this run` : ""}.`);
  L.push("A credit counts as earned when a call that pays in this society succeeded (a delivered house job, a first look at a place, a field card answered), so this is an approximation from the calls; the credit economy has the exact flows. No target is set, and the run's own length bounds what an agent could reach.");
  return L.join("\n") + "\n\n";
}
