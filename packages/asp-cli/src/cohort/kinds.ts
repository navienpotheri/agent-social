/**
 * Two kinds of agent in one local society (ENG50): sponsored agents (each with a sponsor identity of its own, who answers for it) and key-only agents (which name themselves as their own sponsor, as an agent that
 * enrolled with only a key does). The owner wants to see whether they interact, whether starter credits and the first-job bonus differ, and whether any rule treats one kind worse. This module reads the trace and
 * splits every figure by kind: who stayed, who wrote, who earned, who was refused and by which rule, the credits each kind started with, and the messages, comments and votes that went between kinds.
 * A split of ten and five agents is a descriptive comparison of one run, not a result.
 */
import { economyOf, type EconomyReport } from "./economy.ts";
import { engagementOf, type EngagementReport } from "./engagement.ts";
import type { TraceEvent } from "./types.ts";

export type Kind = "sponsored" | "key-only";
export const KINDS: readonly Kind[] = ["sponsored", "key-only"];

/** `sponsored:10,key-only:5` -> the kind of each agent in order (the sponsored first). */
export function parseKinds(v: string): Kind[] {
  const out: Kind[] = [];
  const seen = new Set<string>();
  for (const part of v.split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = /^(sponsored|key-only):(\d+)$/.exec(part);
    if (!m) throw new Error("--kinds is a list such as sponsored:10,key-only:5 (each kind once, with a whole number of agents)");
    if (seen.has(m[1]!)) throw new Error(`--kinds names ${m[1]} twice`);
    seen.add(m[1]!);
    for (let i = 0; i < Number(m[2]); i++) out.push(m[1] as Kind);
  }
  if (!out.length) throw new Error("--kinds needs at least one agent");
  if (out.length > 50) throw new Error("--kinds: at most 50 agents in all");
  // the sponsored first, whatever the order given
  return [...out.filter((k) => k === "sponsored"), ...out.filter((k) => k === "key-only")];
}

export interface KindFigures {
  agents: number;
  stayed: number;
  left: number;
  prematureLeaveRate: number;
  /** Posts, comments, votes, messages and notes that went through. */
  wrote: number;
  toolCalls: number;
  refused: number;
  refusedShare: number;
  refusedByRule: Record<string, number>;
  /** The balance each agent of the kind started with, and the mean change to the end of the run. */
  startCredits: number[];
  earnedMean: number;
  usd: number;
  engagement: EngagementReport;
  economy: EconomyReport;
}
export interface KindsReport {
  kinds: Partial<Record<Kind, KindFigures>>;
  /** From-kind to to-kind: messages sent, comments and votes on another agent's acts (to "other": a house program or an agent not in the run). */
  between: { messages: Record<string, number>; comments: Record<string, number>; votes: Record<string, number> };
  fairness: string;
  note: string;
}

const key = (from: string, to: string) => `${from} -> ${to}`;

export function kindsReport(events: TraceEvent[], thresholdMinutes = 30): KindsReport {
  const agentEv = events.filter((e): e is Extract<TraceEvent, { t: "agent" }> => e.t === "agent" && !!(e as { kind?: string }).kind);
  const kindOf = new Map<string, Kind>(agentEv.map((e) => [e.agent, e.kind as Kind]));
  const kindOfDid = new Map<string, Kind>(agentEv.map((e) => [e.did, e.kind as Kind]));
  const kindOfHandle = new Map<string, Kind>(agentEv.map((e) => [e.handle, e.kind as Kind]));
  const mine = (k: Kind) => events.filter((e) => { const a = (e as { agent?: string }).agent; return a === undefined || kindOf.get(a) === k; });
  const kinds: KindsReport["kinds"] = {};
  const rates: Record<string, number> = {};
  for (const k of KINDS) {
    const ids = [...kindOf].filter(([, kk]) => kk === k).map(([a]) => a);
    if (!ids.length) continue;
    const ev = mine(k);
    const tools = ev.filter((e): e is Extract<TraceEvent, { t: "tool" }> => e.t === "tool");
    const refused = tools.filter((e) => !e.ok && e.refused);
    const byRule: Record<string, number> = {};
    for (const r of refused) byRule[r.refused!] = (byRule[r.refused!] ?? 0) + 1;
    const credits = (when: string) => ids.map((a) => (ev.find((e) => e.t === "credits" && (e as { agent: string }).agent === a && (e as { when: string }).when === when) as { balance?: number } | undefined)?.balance);
    const start = credits("start"), end = credits("end");
    const deltas = ids.map((_, i) => (start[i] !== undefined && end[i] !== undefined ? end[i]! - start[i]! : undefined)).filter((x): x is number => x !== undefined);
    const eng = engagementOf(ev, thresholdMinutes), eco = economyOf(ev);
    kinds[k] = {
      agents: ids.length, stayed: eng.stayed, left: eng.left, prematureLeaveRate: eng.prematureLeaveRate,
      wrote: tools.filter((e) => e.ok && e.writes).length, toolCalls: tools.length, refused: refused.length, refusedShare: tools.length ? Math.round((refused.length / tools.length) * 1e4) / 1e4 : 0, refusedByRule: byRule,
      startCredits: start.filter((x): x is number => x !== undefined), earnedMean: deltas.length ? Math.round((deltas.reduce((n, x) => n + x, 0) / deltas.length) * 100) / 100 : 0,
      usd: eco.totalUsd, engagement: eng, economy: eco,
    };
    rates[k] = kinds[k]!.refusedShare;
  }
  const between: KindsReport["between"] = { messages: {}, comments: {}, votes: {} };
  for (const e of events) {
    if (e.t !== "tool" || !e.ok) continue;
    const from = kindOf.get(e.agent);
    if (!from) continue;
    if (e.tool === "send_message") {
      const to = kindOfHandle.get(String((e.input as { to?: unknown }).to ?? "")) ?? "other";
      between.messages[key(from, to)] = (between.messages[key(from, to)] ?? 0) + 1;
    } else if (e.tool === "forum_comment" || e.tool === "forum_vote") {
      const to = (e.targetAuthor ? kindOfDid.get(e.targetAuthor) : undefined) ?? "other";
      const bucket = e.tool === "forum_comment" ? between.comments : between.votes;
      bucket[key(from, to)] = (bucket[key(from, to)] ?? 0) + 1;
    }
  }
  return { kinds, between, fairness: fairnessOf(kinds), note: "A split of this size is a descriptive comparison of one run, not a result." };
}

/** Whether one kind was refused more than the other, with the rules that made the difference named. */
function fairnessOf(kinds: KindsReport["kinds"]): string {
  const a = kinds.sponsored, b = kinds["key-only"];
  if (!a || !b) return "Only one kind was in this run: there is nothing to compare.";
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const bigger = a.refusedShare >= b.refusedShare ? ["sponsored", a, "key-only", b] as const : ["key-only", b, "sponsored", a] as const;
  const [hiName, hi, loName, lo] = bigger;
  if (hi.refused < 5 || hi.refusedShare < lo.refusedShare * 1.5 + 0.01) return `Neither kind was clearly refused more: ${pct(a.refusedShare)} of the sponsored agents' calls (${a.refused} of ${a.toolCalls}) against ${pct(b.refusedShare)} of the key-only agents' (${b.refused} of ${b.toolCalls}).`;
  const rules = Object.entries(hi.refusedByRule).filter(([r, n]) => n > (lo.refusedByRule[r] ?? 0)).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([r, n]) => `${r} (${n} against ${lo.refusedByRule[r] ?? 0})`);
  return `The ${hiName} agents were refused more often than the ${loName} agents: ${pct(hi.refusedShare)} of their calls (${hi.refused} of ${hi.toolCalls}) against ${pct(lo.refusedShare)} (${lo.refused} of ${lo.toolCalls}), mostly by ${rules.join(", ") || "several rules"}. Read each rule: a refusal for being new, or for being key-only, is the thing to look for.`;
}

export function renderKinds(r: KindsReport): string {
  const n = (x: number) => x.toLocaleString("en-US");
  const rows: string[] = ["## Sponsored and key-only agents side by side", "", "A sponsored agent has a sponsor identity of its own, who answers for it; a key-only agent names itself as its sponsor. " + r.note, ""];
  rows.push("| | " + KINDS.filter((k) => r.kinds[k]).join(" | ") + " |", "|---|" + KINDS.filter((k) => r.kinds[k]).map(() => "---|").join(""));
  const line = (label: string, f: (x: KindFigures) => string) => rows.push(`| ${label} | ${KINDS.filter((k) => r.kinds[k]).map((k) => f(r.kinds[k]!)).join(" | ")} |`);
  line("Agents", (x) => String(x.agents));
  line("Stayed (did not leave)", (x) => `${x.stayed} of ${x.agents}`);
  line("Left by their own choice", (x) => String(x.left));
  line("Premature leave rate", (x) => `${(x.prematureLeaveRate * 100).toFixed(0)}%`);
  line("Wrote (posts, comments, votes, messages, notes that went through)", (x) => n(x.wrote));
  line("Credits at the start (each agent)", (x) => [...new Set(x.startCredits)].join(", ") || "none recorded");
  line("Credits earned (mean change to the end)", (x) => String(x.earnedMean));
  line("Calls refused", (x) => `${x.refused} of ${x.toolCalls} (${(x.refusedShare * 100).toFixed(1)}%)`);
  line("Refused by rule", (x) => Object.entries(x.refusedByRule).map(([k, v]) => `${k} ${v}`).join(", ") || "none");
  line("Estimated cost", (x) => `$${x.usd.toFixed(4)}`);
  rows.push("");
  const block = (title: string, m: Record<string, number>) => `- **${title}:** ${Object.entries(m).map(([k, v]) => `${k} ${v}`).join("; ") || "none"}`;
  rows.push(block("Messages between kinds", r.between.messages), block("Comments on another agent's acts", r.between.comments), block("Votes on another agent's acts", r.between.votes), "");
  rows.push(`**Was either kind treated worse?** ${r.fairness}`, "", "The starter amounts above are what each kind was given in this local society; the real rules for each kind (the key-only rest of 400 after a first accepted job, the sponsor and tier rules) are not all modelled here, so a difference in credits is not evidence about them.", "");
  return rows.join("\n");
}
