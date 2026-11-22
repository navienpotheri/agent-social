/**
 * The cohort runner (register row DK1801; docs/society-models-run.md): one gateway for each agent, in this process, and the agent loops run against them, a few at a time. Each gateway holds the provider key (read ONCE
 * from the environment variable the owner names, kept in memory, never written to a file, a log or an event), the agent's dollar cap, a token cap, the loop limits, the scopes of the society's tools and nothing else,
 * and a run log of its own. The cohort has a total cap as well: when the agents' estimated spend together reaches it, every loop stops.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createGateway, type Gateway } from "../gateway/server.ts";
import { RunRecorder } from "../gateway/runlog.ts";
import { DEFAULT_LIMITS, runAgent, type Economy, type AgentLimits, type AgentOutcome, type DriverEvent, type SocietyToolSet } from "./driver.ts";

export interface CohortOptions {
  agents: string[];
  toolsetFor(agent: string): SocietyToolSet;
  model: string;
  /** A model mix (ENG57): the model of one agent; absent or undefined, `model`. */
  modelFor?: (agent: string) => string | undefined;
  /** The NAME of the environment variable that holds the provider key. The key is read from it once and never stored anywhere. */
  keyEnv: string;
  perAgentUsd: number;
  totalUsd: number;
  /** How many agents run at once (default: all of them). */
  parallel?: number;
  limits?: Partial<AgentLimits>;
  /** Token economy (cache marks, history window, per-call ceiling); the defaults are the economical ones. */
  economy?: Partial<Economy>;
  runDir: string;
  signal: AbortSignal;
  onEvent?: (e: DriverEvent) => void;
  /** The provider's address (default https://api.anthropic.com); the tests point it at a stand-in. */
  upstream?: string;
  env?: Record<string, string | undefined>;
  /** Loop breaker limits for each agent (defaults: 6 identical calls, 8 near repeats). */
  loop?: { equivalentCalls?: number; nearRepeats?: number };
  /** Passed to every agent loop (tests: a quick sleep). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  maxStrikes?: number;
  /** Overrides the price table for the model (USD per million tokens); needed only for a model the table does not know. */
  price?: { inPerM?: number; outPerM?: number };
  /** Called before an agent starts (arrivals: wait for the agent's simulated arrival time); it returns when the agent may begin, or at once when the signal aborts. */
  beforeStart?: (agent: string, index: number, signal: AbortSignal) => Promise<void>;
  /** How long one tool may run (default 30 seconds). */
  toolTimeoutMs?: number;
}

const safe = (agent: string) => agent.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "agent";

export async function runCohort(o: CohortOptions): Promise<{ outcomes: AgentOutcome[]; usd: number; stopped: string }> {
  const key = (o.env ?? process.env)[o.keyEnv];
  if (!key) throw new Error(`the environment variable ${o.keyEnv} is not set: the cohort reads the provider key from it and from nowhere else`);
  if (!(o.perAgentUsd > 0) || !(o.totalUsd > 0)) throw new Error("perAgentUsd and totalUsd must be positive");
  mkdirSync(o.runDir, { recursive: true });
  const limits: AgentLimits = { ...DEFAULT_LIMITS, ...(o.limits ?? {}), usd: o.perAgentUsd };
  const gateways = new Map<string, { g: Gateway; url: string; runLog: string; stopped?: string }>();
  const total = new AbortController();
  let totalStopped: string | undefined;
  const onAbort = () => total.abort();
  o.signal.addEventListener("abort", onAbort, { once: true });
  const spendNow = () => [...gateways.values()].reduce((n, x) => n + x.g.summary().spendUsd, 0);
  const emit = (e: DriverEvent) => {
    o.onEvent?.(e);
    if (e.kind === "turn" && !totalStopped && spendNow() >= o.totalUsd) { totalStopped = `the cohort's total of $${o.totalUsd.toFixed(2)} was reached`; total.abort(); }
  };
  try {
    const outcomes: AgentOutcome[] = new Array(o.agents.length);
    let next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= o.agents.length) return;
        const agent = o.agents[i];
        if (o.beforeStart) await o.beforeStart(agent, i, total.signal);
        const toolset = o.toolsetFor(agent);
        const dir = join(o.runDir, safe(agent));
        mkdirSync(dir, { recursive: true });
        const runLogPath = join(dir, "run-log.ndjson");
        const entry = { g: undefined as unknown as Gateway, url: "", runLog: runLogPath, stopped: undefined as string | undefined };
        const g = createGateway({
          anthropicUpstream: (o.upstream ?? "https://api.anthropic.com").replace(/\/$/, ""),
          openaiUpstream: "http://127.0.0.1:9/v1",
          anthropicKey: key,
          scopes: toolset.tools.map((t) => `mcp.society.${t.name}`),
          usdCap: o.perAgentUsd,
          ...(o.price ? { price: o.price } : {}),
          tokenCap: limits.maxTokens,
          loop: { equivalentCalls: o.loop?.equivalentCalls ?? 6, nearRepeats: o.loop?.nearRepeats ?? 8 },
          runLog: new RunRecorder(runLogPath),
          maxStrikes: o.maxStrikes ?? 5,
          onStop: (reason) => { entry.stopped = reason; },
        });
        entry.g = g;
        const port = await g.listen(0, "127.0.0.1");
        entry.url = `http://127.0.0.1:${port}`;
        gateways.set(agent, entry);
        let out: AgentOutcome;
        try {
          out = await runAgent({
            agent, toolset, model: o.modelFor?.(agent) ?? o.model, gatewayUrl: entry.url, limits, signal: total.signal, ...(o.economy ? { economy: o.economy } : {}),
            ...(o.sleep ? { sleep: o.sleep } : {}),
            ...(o.toolTimeoutMs ? { toolTimeoutMs: o.toolTimeoutMs } : {}),
            observe: () => { const s = g.summary(); return { spendUsd: s.spendUsd, tokens: s.tokens, refused: s.blocked.reduce((n, b) => n + b.count, 0), ...(entry.stopped ? { stopped: entry.stopped } : {}), runLog: runLogPath }; },
            onEvent: (e) => { if (e.kind !== "end") emit(e); },
          });
        } finally { /* the gateway stays open until the cohort ends: its summary is read below */ }
        if (out.stopped === "stopped" && totalStopped && !o.signal.aborted) out = { ...out, stopped: "usd_cap", detail: totalStopped };
        outcomes[i] = out;
        o.onEvent?.({ kind: "end", agent, outcome: out });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(o.parallel ?? o.agents.length, o.agents.length)) }, worker));
    const usd = spendNow();
    return { outcomes, usd: Math.round(usd * 1e6) / 1e6, stopped: totalStopped ?? (o.signal.aborted ? "stopped" : "finished") };
  } finally {
    o.signal.removeEventListener("abort", onAbort);
    for (const x of gateways.values()) await x.g.close().catch(() => undefined);
  }
}
