/**
 * The token economy of a cohort run (ENG15): what the run cost the person who pays for it, from the trace alone. Median tokens per tick (a tick is one model call), tokens per useful action (an act that changed
 * something: a post, a comment, a vote, a note), the cost per engaged hour, and how much of the input came from the provider's cache. Input tokens are counted as the provider counts them: uncached input,
 * cache reads (a tenth of the price) and cache writes (a quarter more); "billed-equivalent" weighs them that way. Dollar figures are estimates from the token counts, never the provider's bill.
 */
import type { TraceEvent } from "./types.ts";

export interface EconomyReport {
  calls: number;
  /** Whole input of a call (uncached + cache read + cache write), median and largest. */
  medianInputPerCall: number; maxInputPerCall: number;
  medianOutputPerCall: number;
  /** Uncached input + output + cache writes x 1.25 + cache reads x 0.1: the input that is paid for at the full price, in tokens. */
  billedEquivalentTokens: number;
  /** Share of all input tokens that were read from the cache (0 to 1). */
  cacheHitShare: number;
  usefulActions: number;
  billedTokensPerUsefulAction: number | undefined;
  engagedHours: number;
  usdPerEngagedHour: number | undefined;
  totalUsd: number;
}

const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };

export function economyOf(events: TraceEvent[]): EconomyReport {
  const models = events.filter((e): e is Extract<TraceEvent, { t: "model" }> => e.t === "model");
  const inputs = models.map((m) => m.input + (m.cacheRead ?? 0) + (m.cacheWrite ?? 0));
  const input = models.reduce((n, m) => n + m.input, 0), read = models.reduce((n, m) => n + (m.cacheRead ?? 0), 0), write = models.reduce((n, m) => n + (m.cacheWrite ?? 0), 0), output = models.reduce((n, m) => n + m.output, 0);
  const billed = Math.round(input + output + write * 1.25 + read * 0.1);
  const useful = events.filter((e) => e.t === "tool" && e.ok && e.writes).length;
  // Engaged time: from an agent's first event to its end, per agent, in real hours.
  const first = new Map<string, number>(), last = new Map<string, number>();
  for (const e of events) { if ("agent" in e && typeof e.agent === "string" && e.t !== "agent") { const t = Date.parse(e.at); if (!first.has(e.agent)) first.set(e.agent, t); last.set(e.agent, t); } }
  const hours = [...first].reduce((n, [a, t]) => n + Math.max(0, (last.get(a)! - t) / 3_600_000), 0);
  const usd = models.reduce((n, m) => n + m.usd, 0);
  return {
    calls: models.length, medianInputPerCall: median(inputs), maxInputPerCall: inputs.length ? Math.max(...inputs) : 0, medianOutputPerCall: median(models.map((m) => m.output)),
    billedEquivalentTokens: billed, cacheHitShare: input + read + write ? read / (input + read + write) : 0,
    usefulActions: useful, billedTokensPerUsefulAction: useful ? Math.round(billed / useful) : undefined,
    engagedHours: Math.round(hours * 1e4) / 1e4, usdPerEngagedHour: hours > 0 ? Math.round((usd / hours) * 1e4) / 1e4 : undefined, totalUsd: Math.round(usd * 1e6) / 1e6,
  };
}

export function renderEconomy(r: EconomyReport): string {
  const n = (x: number) => x.toLocaleString("en-US");
  return [
    "## What it cost the person who pays (token economy)",
    "",
    `- **Ticks (model calls):** ${n(r.calls)}; median input ${n(r.medianInputPerCall)} tokens a tick (largest ${n(r.maxInputPerCall)}), median output ${n(r.medianOutputPerCall)}.`,
    `- **Cache:** ${(r.cacheHitShare * 100).toFixed(0)}% of the input tokens came from the provider's cache (a tenth of the price).`,
    `- **Billed-equivalent tokens:** ${n(r.billedEquivalentTokens)} (uncached input and output at full price, cache writes at 1.25, cache reads at 0.1).`,
    `- **Per useful action** (a post, a comment, a vote or a note that went through): ${r.billedTokensPerUsefulAction === undefined ? "no useful action yet" : `${n(r.billedTokensPerUsefulAction)} billed-equivalent tokens, over ${n(r.usefulActions)} action(s)`}.`,
    `- **Per engaged hour:** ${r.usdPerEngagedHour === undefined ? "too short a run to say" : `$${r.usdPerEngagedHour.toFixed(4)} an agent-hour (${r.engagedHours} agent-hours in real time)`}; total estimated $${r.totalUsd.toFixed(4)}. Estimates from token counts, not the provider's bill.`,
    "",
  ].join("\n");
}
