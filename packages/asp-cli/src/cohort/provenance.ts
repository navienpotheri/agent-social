/**
 * Run provenance (ENG70): what the run actually was, so that a change of behaviour can be told from a silent change of model or of a tool description. From the trace alone: the model alias asked for, the model
 * snapshot the provider says it ran (and a change of it, named), a hash of each response id (never the id), the settings the run sent (only max_tokens: sampling and thinking are the provider's own defaults, which the
 * run does not set), a hash of the tool definitions offered at every turn (a changed, added or removed definition is named), and the size of the thinking returned for each turn (a count of blocks and characters,
 * never the hidden text). The report also says what it still cannot tell you.
 */
import type { TraceEvent } from "./types.ts";

export interface ProvenanceReport {
  alias: string[];
  snapshots: Record<string, number>;
  responseIdHashes: number;
  settings: Record<string, string | number>;
  toolsHashes: Record<string, number>;
  changes: { agent: string; turn: number; what: string; name: string; from?: string; to?: string }[];
  thinking: { turnsWithThinking: number; blocks: number; medianChars: number; maxChars: number; totalChars: number };
  turns: number;
  cannotTell: string[];
}

const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };

export const CANNOT_TELL = [
  "the provider's own internal version behind a snapshot name, and whether it changed under the same name",
  "the sampling the provider used (temperature and the rest are not sent, so they are the provider's defaults), and the thinking budget it chose (not sent)",
  "what the hidden thinking said: only its size is kept, never the text",
  "the load or the latency of the provider during the run, which can change what a model does",
  "anything the provider adds to the request that the run does not see",
];

export function provenanceOf(events: TraceEvent[]): ProvenanceReport {
  const models = events.filter((e): e is Extract<TraceEvent, { t: "model" }> => e.t === "model");
  const start = events.find((e): e is Extract<TraceEvent, { t: "provenance" }> => e.t === "provenance");
  const snapshots: Record<string, number> = {}, toolsHashes: Record<string, number> = {};
  const ids = new Set<string>();
  for (const m of models) {
    if (m.snapshot) snapshots[m.snapshot] = (snapshots[m.snapshot] ?? 0) + 1;
    if (m.toolsHash) toolsHashes[m.toolsHash] = (toolsHashes[m.toolsHash] ?? 0) + 1;
    if (m.idHash) ids.add(m.idHash);
  }
  const think = models.filter((m) => (m.thinkingBlocks ?? 0) > 0);
  const chars = think.map((m) => m.thinkingChars ?? 0);
  const alias = [...new Set([...(start ? [start.model] : []), ...events.filter((e): e is Extract<TraceEvent, { t: "agent" }> => e.t === "agent" && !!e.model).map((e) => e.model!)])];
  return {
    alias, snapshots, responseIdHashes: ids.size, settings: start?.settings ?? {}, toolsHashes,
    changes: events.filter((e): e is Extract<TraceEvent, { t: "provenance_change" }> => e.t === "provenance_change").map((e) => ({ agent: e.agent, turn: e.turn, what: e.what, name: e.name, ...(e.from ? { from: e.from } : {}), ...(e.to ? { to: e.to } : {}) })),
    thinking: { turnsWithThinking: think.length, blocks: think.reduce((n, m) => n + (m.thinkingBlocks ?? 0), 0), medianChars: median(chars), maxChars: chars.length ? Math.max(...chars) : 0, totalChars: chars.reduce((n, x) => n + x, 0) },
    turns: models.length, cannotTell: CANNOT_TELL,
  };
}

export function renderProvenance(r: ProvenanceReport): string {
  const snap = Object.entries(r.snapshots);
  const rows = [
    "## What this run was, exactly (provenance)", "",
    `- **Model asked for (alias):** ${r.alias.join(", ") || "not recorded"}.`,
    `- **Model the provider says it ran (snapshot):** ${snap.length ? snap.map(([k, v]) => `${k} (${v} turn${v === 1 ? "" : "s"})`).join("; ") : "none returned"}${snap.length > 1 ? " **the snapshot changed during the run**" : ""}. Response ids: ${r.responseIdHashes} distinct, kept only as hashes.`,
    `- **What the run sent:** ${Object.entries(r.settings).map(([k, v]) => `${k} ${v}`).join("; ") || "not recorded"}.`,
    `- **Tool definitions offered each turn:** ${Object.keys(r.toolsHashes).length} distinct hash${Object.keys(r.toolsHashes).length === 1 ? "" : "es"} over ${r.turns} turns (${Object.entries(r.toolsHashes).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}).`,
    `- **Thinking returned:** ${r.thinking.turnsWithThinking} of ${r.turns} turns carried thinking (${r.thinking.blocks} blocks; median ${r.thinking.medianChars} characters a turn, largest ${r.thinking.maxChars}, ${r.thinking.totalChars} in all): sizes only, never the hidden text.`,
  ];
  if (r.changes.length) { rows.push("- **Changes noticed during the run:**"); for (const c of r.changes.slice(0, 12)) rows.push(`  - turn ${c.turn} of ${c.agent}: ${c.what.replace(/_/g, " ")} ${c.name}${c.from ? ` from ${c.from}` : ""}${c.to ? ` to ${c.to}` : ""}`); if (r.changes.length > 12) rows.push(`  - and ${r.changes.length - 12} more`); }
  else rows.push("- **Changes noticed during the run:** none (no snapshot change, no tool definition changed, added or removed).");
  rows.push("", "**What this still cannot tell you:**", ...r.cannotTell.map((x) => `- ${x}`), "");
  return rows.join("\n");
}
