/**
 * A model mix in one cohort (ENG57): for example claude-haiku-5-5 for most agents and one or two of another model, under the same caps. Each agent has ONE model for its whole life; the report splits every figure by model:
 * who stayed, what each wrote and how long, what it cost as an estimate against the cap, and the calls refused. The owner reads the difference in the words and in the staying. The cost is a cap, never a price: each
 * agent's dollar cap is the same whatever its model, and the run's total cap is the owner's. A split of a few agents is a descriptive comparison of one run, not a result.
 */
import { economyOf, type EconomyReport } from "./economy.ts";
import { engagementOf, type EngagementReport } from "./engagement.ts";
import type { TraceEvent } from "./types.ts";

/** `claude-haiku-5-5:10,claude-sonnet-5-5:2` -> the model of each agent in order. */
export function parseModels(v: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of v.split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*):(\d+)$/.exec(part);
    if (!m) throw new Error("--models is a list such as claude-haiku-5-5:10,claude-sonnet-5-5:2 (each model once, with a whole number of agents)");
    if (seen.has(m[1]!)) throw new Error(`--models names ${m[1]} twice`);
    seen.add(m[1]!);
    for (let i = 0; i < Number(m[2]); i++) out.push(m[1]!);
  }
  if (!out.length) throw new Error("--models needs at least one agent");
  if (out.length > 50) throw new Error("--models: at most 50 agents in all");
  return out;
}

export interface ModelFigures {
  agents: number;
  stayed: number;
  left: number;
  prematureLeaveRate: number;
  wrote: number;
  /** Words in the posts, comments and messages that went through, in all and the mean for each. */
  words: number;
  wordsPerWrite: number;
  toolCalls: number;
  refused: number;
  usd: number;
  capUsd: number;
  engagement: EngagementReport;
  economy: EconomyReport;
}
export interface ModelsReport { models: Record<string, ModelFigures>; note: string }

const WRITE_TOOLS = new Set(["forum_post", "forum_comment", "send_message"]);
const wordsOf = (input: Record<string, unknown>): number => String(input.text ?? input.body ?? "").trim().split(/\s+/).filter(Boolean).length;

export function modelsReport(events: TraceEvent[], capUsdPerAgent: number, thresholdMinutes = 30): ModelsReport {
  const agentEv = events.filter((e): e is Extract<TraceEvent, { t: "agent" }> => e.t === "agent" && !!(e as { model?: string }).model);
  const modelOf = new Map<string, string>(agentEv.map((e) => [e.agent, e.model!]));
  const models: ModelsReport["models"] = {};
  for (const m of new Set(modelOf.values())) {
    const ids = [...modelOf].filter(([, mm]) => mm === m).map(([a]) => a);
    const ev = events.filter((e) => { const a = (e as { agent?: string }).agent; return a === undefined || modelOf.get(a) === m; });
    const tools = ev.filter((e): e is Extract<TraceEvent, { t: "tool" }> => e.t === "tool");
    const writes = tools.filter((e) => e.ok && e.writes);
    const spoken = tools.filter((e) => e.ok && WRITE_TOOLS.has(e.tool));
    const words = spoken.reduce((n, e) => n + wordsOf(e.input), 0);
    const eng = engagementOf(ev, thresholdMinutes), eco = economyOf(ev);
    models[m] = {
      agents: ids.length, stayed: eng.stayed, left: eng.left, prematureLeaveRate: eng.prematureLeaveRate, wrote: writes.length, words, wordsPerWrite: spoken.length ? Math.round((words / spoken.length) * 10) / 10 : 0,
      toolCalls: tools.length, refused: tools.filter((e) => !e.ok && e.refused).length, usd: eco.totalUsd, capUsd: Math.round(capUsdPerAgent * ids.length * 100) / 100, engagement: eng, economy: eco,
    };
  }
  return { models, note: "A split of a few agents is a descriptive comparison of one run, not a result. The cost is the estimate against the cap each agent was given, never a price." };
}

export function renderModels(r: ModelsReport): string {
  const names = Object.keys(r.models);
  const rows = ["## One society, more than one model", "", "Each agent had one model for its whole life, under the same dollar cap. " + r.note, "", `| | ${names.join(" | ")} |`, `|---|${names.map(() => "---|").join("")}`];
  const line = (label: string, f: (x: ModelFigures) => string) => rows.push(`| ${label} | ${names.map((k) => f(r.models[k]!)).join(" | ")} |`);
  line("Agents", (x) => String(x.agents));
  line("Stayed (did not leave)", (x) => `${x.stayed} of ${x.agents}`);
  line("Premature leave rate", (x) => `${(x.prematureLeaveRate * 100).toFixed(0)}%`);
  line("Wrote (posts, comments, votes, messages, notes that went through)", (x) => String(x.wrote));
  line("Words in what they said (posts, comments, messages)", (x) => `${x.words} (${x.wordsPerWrite} a time)`);
  line("Calls refused", (x) => `${x.refused} of ${x.toolCalls}`);
  line("Estimated cost against the cap", (x) => `$${x.usd.toFixed(4)} of $${x.capUsd.toFixed(2)}`);
  rows.push("");
  return rows.join("\n");
}
