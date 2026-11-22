/**
 * The cohort run (register row DK1801): boots the local society, enrols N agents with throwaway keys, runs each through the restricted tool set against the model provider at the same time, enforces the per-agent
 * and total dollar caps, the wall clock and the stop requests, and writes the trace and the report into the directory the owner names. It registers itself in the ASP home's session index so that `asp stop --all`
 * (which writes a stop file for every running session) ends it, and it also stops on a `STOP` file in the output directory (the quiet kill switch). Only the local society is reached: no hosted service. The
 * provider's key is never seen here (the provider object holds it); nothing in this file reads an environment variable.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent, type Caps, type Shared } from "./agent.ts";
import { logReport, renderLogSections } from "./from-log.ts";
import { analyse, renderReport, type Report } from "./observe.ts";
import { SignedTrace, type SignedTraceSummary } from "./signed-trace.ts";
import { TOOLS } from "./tools.ts";
import type { Provider, TraceEvent } from "./types.ts";
import { bootWorld } from "./world.ts";

export interface CohortOptions {
  /** Where the trace, the report and the local society's files go. */
  out: string;
  /** The ASP home (for the session index and the stop files). */
  home: string;
  agents: number;
  model: string;
  provider: Provider;
  budgetUsd: number;
  totalUsd: number;
  minutes: number;
  priceIn: number;
  priceOut: number;
  maxTurns?: number;
  maxTokens?: number;
  /** Persona text for each agent, in rotation; absent: no persona (the briefing alone). */
  personas?: string[];
  /** Milliseconds between the starts of two agents. */
  staggerMs?: number;
  io: { out: (l: string) => void };
  now?: () => number;
}

export interface CohortResult { report: Report; dir: string; markdownPath: string; sid: string }

const handleOf = (i: number) => `agent-${String(i + 1).padStart(2, "0")}`;

export async function runCohort(o: CohortOptions): Promise<CohortResult> {
  if (!Number.isInteger(o.agents) || o.agents < 1 || o.agents > 50) throw new Error("--agents is a whole number from 1 to 50");
  for (const [k, v] of [["--budget-usd", o.budgetUsd], ["--total-usd", o.totalUsd], ["--minutes", o.minutes]] as const) if (!(v > 0)) throw new Error(`${k} must be more than zero: a run with no cap is not started`);
  if (o.priceIn < 0 || o.priceOut < 0) throw new Error("the prices are USD per million tokens, not negative");
  const now = o.now ?? Date.now;
  const run = `cohort-${new Date(now()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const dir = join(o.out, run);
  mkdirSync(dir, { recursive: true });
  const tracePath = join(dir, "trace.jsonl");
  const events: TraceEvent[] = [];
  let bridge: SignedTrace | undefined;
  const trace = (e: TraceEvent) => {
    events.push(e); appendFileSync(tracePath, JSON.stringify(e) + "\n");
    // Every tool call also leaves a signed record in the run's own ASP log (signed-trace.ts); the bridge queues and never throws into the loop.
    if (e.t === "tool") bridge?.observe({ agent: e.agent, at: e.at, turn: e.turn, tool: e.tool, input: e.input, ok: e.ok, ...(e.refused ? { refused: e.refused } : {}), scope: e.scope, institution: e.institution, writes: e.writes, ...(e.target ? { target: e.target } : {}), ...(e.targetAuthor ? { targetAuthor: e.targetAuthor } : {}) });
  };
  let signed: SignedTraceSummary | undefined;
  let logPart: Awaited<ReturnType<typeof logReport>> | undefined;
  const stamp = () => new Date(now()).toISOString();
  const shared: Shared = { spentUsd: 0 };

  // The session index of the ASP home, so `asp stop --all` and `asp runs` see this run; the stop file for it is the same one `asp stop` writes for any session.
  const sid = `cohort-${Math.random().toString(36).slice(2, 8)}`;
  const index = join(o.home, "runs.ndjson");
  mkdirSync(o.home, { recursive: true });
  appendFileSync(index, JSON.stringify({ t: "start", pid: process.pid, sid, contract: "cohort", at: stamp(), runtime: "cohort", agent: `cohort of ${o.agents}`, me: "local", bank: "local", purpose: `model cohort ${run}`, scopes: ["read.society", "read.forum", "write.forum"], hosts: ["127.0.0.1"] }) + "\n");
  const stopFile = join(o.home, `stop-${sid}`);
  const quiet = join(dir, "STOP");
  let announced = false;
  const stopRequested = (): string | undefined => {
    const why = existsSync(stopFile) ? "asp stop" : existsSync(quiet) ? "STOP file" : undefined;
    if (why && !announced) { announced = true; shared.stopped = why; trace({ t: "stop", at: stamp(), reason: why }); o.io.out(`stop requested (${why}); the agents end at their next step`); }
    return why;
  };

  const caps: Caps = { perAgentUsd: o.budgetUsd, totalUsd: o.totalUsd, deadlineMs: now() + o.minutes * 60_000, priceIn: o.priceIn, priceOut: o.priceOut, maxTurns: o.maxTurns ?? 60, maxTokens: o.maxTokens ?? 600, windowTurns: 6 };
  trace({ t: "start", at: stamp(), run, model: o.model, provider: o.provider.name, agents: o.agents, capUsdPerAgent: o.budgetUsd, capUsdTotal: o.totalUsd, minutes: o.minutes });
  const world = await bootWorld({ dir: join(dir, "society"), onLine: (l) => o.io.out(l) });
  try {
    const agents = [];
    for (let i = 0; i < o.agents; i++) {
      const persona = o.personas?.length ? o.personas[i % o.personas.length] : undefined;
      const a = await world.enrol(i, handleOf(i), persona);
      agents.push(a);
      trace({ t: "agent", at: stamp(), agent: a.id, did: a.did, handle: a.handle, ...(persona ? { persona: persona.slice(0, 80) } : {}) });
    }
    bridge = await SignedTrace.open({ log: world.log, tools: TOOLS, agents: agents.map((a) => ({ id: a.id, did: a.did, kid: a.kid, seed: a.seed })), now });
    o.io.out(`${o.agents} agent${o.agents === 1 ? "" : "s"} enrolled; model ${o.model}; cap $${o.budgetUsd} each, $${o.totalUsd} in all, ${o.minutes} minutes; stop with: asp stop --all (or create ${quiet})`);
    const watcher = setInterval(() => { stopRequested(); }, 250);
    try {
      await Promise.all(agents.map(async (a, i) => {
        if (o.staggerMs && i) await new Promise((r) => setTimeout(r, o.staggerMs! * i));
        await runAgent({ agent: a, provider: o.provider, world: world.api, caps, shared, trace, stopRequested, now });
      }));
    } finally { clearInterval(watcher); }
    signed = await bridge.close();
    logPart = await logReport(world.log, signed);
  } finally {
    await world.close();
    appendFileSync(index, JSON.stringify({ t: "end", sid, contract: "cohort", at: stamp(), state: "ended", calls: events.filter((e) => e.t === "tool").length, refused: [], tokens: events.reduce((n, e) => n + (e.t === "model" ? e.input + e.output : 0), 0), exitCode: 0 }) + "\n");
  }
  const report = analyse(events);
  const { markdown, json } = renderReport(report);
  const markdownPath = join(dir, "report.md");
  writeFileSync(markdownPath, logPart ? `${markdown}\n${renderLogSections(logPart, { perAgent: report.perAgent })}\n` : markdown);
  if (signed) writeFileSync(join(dir, "signed-trace.json"), JSON.stringify(signed, null, 2) + "\n");
  writeFileSync(join(dir, "report.json"), json);
  o.io.out(`done: ${report.agents} agents, estimated spend $${report.totalUsd.toFixed(4)} of $${o.totalUsd}; report ${markdownPath}`);
  return { report, dir, markdownPath, sid };
}

/** Reads the personas of a persona file: one persona per paragraph (separated by a blank line). */
export function readPersonas(path: string): string[] {
  return readFileSync(path, "utf8").split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
}
