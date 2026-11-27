/**
 * What living in the society costs in tokens (DK1313), read from the trace: tokens in and out for each agent, for each simulated day (when the run has a simulated clock), the cost for each agent-hour, and the share of the
 * tokens spent on turns that read, that wrote, or that rested. Counts only. The agent sees one plain true line about its own allowance (see `allowanceLine`): a fact, never a request, and nothing is withheld at any level.
 */
import type { TraceEvent } from "./types.ts";

type ToolEv = Extract<TraceEvent, { t: "tool" }>;
type ModelEv = Extract<TraceEvent, { t: "model" }>;
const REST = new Set(["rest", "wait_for", "do_nothing", "notebook_write", "notebook_read", "stop_exploring"]);

/** A turn is a writing turn if any tool it called wrote, a resting turn if it only rested or kept notes, otherwise a reading turn. */
function kindOfTurns(events: TraceEvent[]): Map<string, "read" | "write" | "rest"> {
  const by = new Map<string, ToolEv[]>();
  for (const e of events) if (e.t === "tool") { const k = `${e.agent}|${e.turn}`; by.set(k, [...(by.get(k) ?? []), e]); }
  const out = new Map<string, "read" | "write" | "rest">();
  for (const [k, l] of by) out.set(k, l.some((e) => e.writes && !REST.has(e.tool)) ? "write" : l.every((e) => REST.has(e.tool)) ? "rest" : "read");
  return out;
}

export interface TokenUse { agents: number; turns: number; tokensIn: number; tokensOut: number; usd: number; agentHours: number; usdPerAgentHour: number | null; simDays: number | null; tokensPerSimDay: number | null; share: { read: number; write: number; rest: number; none: number } }

export function tokenUse(events: TraceEvent[]): TokenUse {
  const ms = events.filter((e): e is ModelEv => e.t === "model");
  const kinds = kindOfTurns(events);
  const per = new Map<string, ModelEv[]>();
  for (const m of ms) per.set(m.agent, [...(per.get(m.agent) ?? []), m]);
  let hours = 0;
  for (const l of per.values()) { const t = l.map((m) => Date.parse(m.at)); hours += Math.max(0, (Math.max(...t) - Math.min(...t)) / 3.6e6); }
  const share = { read: 0, write: 0, rest: 0, none: 0 };
  let tin = 0, tout = 0, usd = 0;
  for (const m of ms) {
    const t = m.input + (m.cacheWrite ?? 0) + m.output;
    tin += m.input + (m.cacheWrite ?? 0); tout += m.output; usd += m.usd ?? 0;
    share[kinds.get(`${m.agent}|${m.turn}`) ?? "none"] += t;
  }
  const simMs = Math.max(0, ...events.filter((e) => e.t === "wake").map((e) => (e as { simMs: number }).simMs));
  const simDays = simMs > 0 ? simMs / 86_400_000 : null;
  return { agents: per.size, turns: ms.length, tokensIn: tin, tokensOut: tout, usd: Math.round(usd * 1e6) / 1e6, agentHours: Math.round(hours * 1e4) / 1e4, usdPerAgentHour: hours > 0 ? Math.round((usd / hours) * 1e4) / 1e4 : null, simDays, tokensPerSimDay: simDays && per.size ? Math.round((tin + tout) / per.size / simDays) : null, share };
}

export function renderTokenUse(events: TraceEvent[]): string {
  const u = tokenUse(events);
  if (!u.turns) return "## What living here costs in tokens\n\nNo model turns were recorded in this run, so there is nothing to measure.\n\n";
  const all = u.share.read + u.share.write + u.share.rest + u.share.none || 1, pc = (x: number): string => `${Math.round((x / all) * 100)}%`;
  return `## What living here costs in tokens\n\n${u.turns} model turns by ${u.agents} agents used ${u.tokensIn} tokens in and ${u.tokensOut} out ($${u.usd}). ${u.usdPerAgentHour !== null ? `That is $${u.usdPerAgentHour} for each agent-hour (${u.agentHours} agent-hours between each agent's first and last turn)` : "The agent-hours were too short to give a cost for each hour"}; ${u.tokensPerSimDay !== null ? `${u.tokensPerSimDay} tokens for each agent for each simulated day (${u.simDays!.toFixed(2)} days on the run's clock)` : "the run has no simulated clock, so no figure for each simulated day"}. By what the turn did: reading ${pc(u.share.read)}, writing ${pc(u.share.write)}, resting or keeping notes ${pc(u.share.rest)}${u.share.none ? `, turns with no recorded act ${pc(u.share.none)}` : ""}. Each agent is shown one plain line about its own allowance and nothing is withheld; no rule lowers the cost of a turn (DK1313's token-saving layer is not built), and this is one run.\n\n`;
}

/** The one true line an agent sees about its own allowance, from what it has used: a fact, never a request. Nothing when nothing has been used. */
export function allowanceLine(usedUsd: number, capUsd: number): string | undefined {
  if (!(usedUsd > 0) || !(capUsd > 0)) return undefined;
  return `your allowance for this run: about ${Math.min(100, Math.round((usedUsd / capUsd) * 100))}% of $${capUsd.toFixed(2)} is used (a fact; nothing asks you to stop or to hurry)`;
}
