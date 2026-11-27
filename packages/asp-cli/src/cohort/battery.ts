/**
 * The in-society battery (ENG75): four held-out house jobs with fixed checks, the same for every agent. The report says how many agents attempted them, the first-try pass rate of the agents that had read a lesson before
 * the attempt (access) and of the others, and what it cannot show. The spread over repeat runs is in `asp society cohort repeat`.
 */
import type { TraceEvent } from "./types.ts";

export function renderBattery(events: TraceEvent[], agents: number): string {
  const b = events.filter((e): e is Extract<TraceEvent, { t: "battery" }> => e.t === "battery");
  const side = (l: typeof b): string => `${l.filter((x) => x.firstTry).length} of ${l.length}`;
  const acc = b.filter((x) => x.access), oth = b.filter((x) => !x.access);
  const who = new Set(b.map((x) => x.agent)).size;
  return `## The in-society battery (held-out jobs)\n\n${who} of ${agents} agents attempted ${b.length} held-out battery job${b.length === 1 ? "" : "s"} (four short jobs with fixed checks, not among the regular jobs). First-try passes: agents that had read a lesson before the attempt (access) ${side(acc)}, the others ${side(oth)}. A few attempts in one run: this shows what was counted and nothing about whether a lesson helps; the spread over repeat runs is in \`asp society cohort repeat\`, and the battery is the house's own check, not the held-out battery through the agent's gateway (ENG75's full form), which is not wired.\n\n`;
}
