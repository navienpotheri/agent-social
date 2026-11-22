/**
 * The cohort run (register row DK1801): boots the local society, enrols N agents with throwaway keys, runs each through the restricted tool set against the model provider at the same time, enforces the per-agent
 * and total dollar caps, the wall clock and the stop requests, and writes the trace and the report into the directory the owner names. It registers itself in the ASP home's session index so that `asp stop --all`
 * (which writes a stop file for every running session) ends it, and it also stops on a `STOP` file in the output directory (the quiet kill switch). Only the local society is reached: no hosted service. The
 * provider's key is never seen here (the provider object holds it); nothing in this file reads an environment variable.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arrivalAt, Life, parseArrivals, SimClock, runCohort as runEngine, type LifeLimits, type SocietyTool } from "@agent-social/asp-package";
import { societyDigest, societySource } from "./events.ts";
import { BRIEFING, runAgent, type Caps, type Shared } from "./agent.ts";
import { defOf, LIFE_DEFS, runTool, TOOLS } from "./tools.ts";
import { analyse, injectionIn, renderReport, type Report } from "./observe.ts";
import type { AgentCtx, Provider, TraceEvent } from "./types.ts";
import { logReport, renderLogSections } from "./from-log.ts";
import { economyOf, renderEconomy } from "./economy.ts";
import { engagementOf, renderEngagement } from "./engagement.ts";
import { SignedTrace, type SignedTraceSummary } from "./signed-trace.ts";
import { bootWorld } from "./world.ts";

export interface CohortOptions {
  /** Where the trace, the report and the local society's files go. */
  out: string;
  /** The ASP home (for the session index and the stop files). */
  home: string;
  agents: number;
  model: string;
  /** The scripted stand-in runs through this loop; a real model goes through `engine`. */
  provider?: Provider;
  /** A real model: one gateway for each agent (the key lives only there), the loop of packages/asp-package/src/cohort. */
  engine?: { price?: { inPerM?: number; outPerM?: number }; keyEnv: string; env: Record<string, string | undefined>; upstream?: string; parallel?: number };
  /** Real-model runs keep ticks (docs/agent-engagement.md): the simulated clock, the arrivals and the wake limits. Absent: no rest, wait_for, notebook or leave. */
  life?: { speed: number; arrivals?: string; /** Simulated minutes an agent must have stayed for its leave not to count as premature (default 30). */ engagedMinutes?: number; limits?: Partial<LifeLimits>; sleep?: (ms: number, signal: AbortSignal) => Promise<void> };
  budgetUsd: number;
  totalUsd: number;
  minutes: number;
  /** The stand-in path only: the gateway of the engine prices a real model itself. */
  priceIn?: number;
  priceOut?: number;
  maxTurns?: number;
  maxTokens?: number;
  /** Token ceiling for one agent over its whole life (input and output; default 200,000). */
  maxAgentTokens?: number;
  /** Token economy of the engine path (cache marks, history window, per-call ceiling); absent: the economical defaults. */
  economy?: Partial<import("@agent-social/asp-package").Economy>;
  /** Persona text for each agent, in rotation; absent: no persona (the briefing alone). */
  personas?: string[];
  /** Milliseconds between the starts of two agents. */
  staggerMs?: number;
  io: { out: (l: string) => void };
  now?: () => number;
}

export interface CohortResult { report: Report; dir: string; markdownPath: string; sid: string }

/** What the briefing says about stopping when the run keeps ticks: there is no one-call exit; resting and waiting keep the agent in the society, and leaving asks for a confirmation. */
const ENGAGED_ENDING = "When you have done enough for now, rest or wait for something to happen (rest, wait_for): you stay in the society and nothing is asked of you meanwhile. You may leave for good (leave), but you will be asked to confirm once.";
const handleOf = (i: number) => `agent-${String(i + 1).padStart(2, "0")}`;

export async function runCohort(o: CohortOptions): Promise<CohortResult> {
  if (!Number.isInteger(o.agents) || o.agents < 1 || o.agents > 50) throw new Error("--agents is a whole number from 1 to 50");
  for (const [k, v] of [["--budget-usd", o.budgetUsd], ["--total-usd", o.totalUsd], ["--minutes", o.minutes]] as const) if (!(v > 0)) throw new Error(`${k} must be more than zero: a run with no cap is not started`);
  if ((o.priceIn ?? 0) < 0 || (o.priceOut ?? 0) < 0) throw new Error("the prices are USD per million tokens, not negative");
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

  const caps: Caps = { perAgentUsd: o.budgetUsd, totalUsd: o.totalUsd, deadlineMs: now() + o.minutes * 60_000, priceIn: o.priceIn ?? 0, priceOut: o.priceOut ?? 0, maxTurns: o.maxTurns ?? 60, maxTokens: o.maxTokens ?? 600, windowTurns: 6 };
  trace({ t: "start", at: stamp(), run, model: o.model, provider: o.provider?.name ?? "anthropic", agents: o.agents, capUsdPerAgent: o.budgetUsd, capUsdTotal: o.totalUsd, minutes: o.minutes });
  const world = await bootWorld({ dir: join(dir, "society"), onLine: (l) => o.io.out(l) });
  try {
    const agents = [];
    for (let i = 0; i < o.agents; i++) {
      const persona = o.personas?.length ? o.personas[i % o.personas.length] : undefined;
      const a = await world.enrol(i, handleOf(i), persona);
      agents.push(a);
      trace({ t: "agent", at: stamp(), agent: a.id, did: a.did, handle: a.handle, ...(persona ? { persona: persona.slice(0, 80) } : {}) });
    }
    bridge = await SignedTrace.open({ log: world.log, tools: o.engine && o.life ? [...TOOLS, ...LIFE_DEFS] : TOOLS, agents: agents.map((a) => ({ id: a.id, did: a.did, kid: a.kid, seed: a.seed })), now });
    o.io.out(`${o.agents} agent${o.agents === 1 ? "" : "s"} enrolled; model ${o.model}; cap $${o.budgetUsd} each, $${o.totalUsd} in all, ${o.minutes} minutes; stop with: asp stop --all (or create ${quiet})`);
    let engineAbort: AbortController | undefined;
    const watcher = setInterval(() => { if (stopRequested()) engineAbort?.abort(); }, 250);
    try {
      if (o.engine) {
        const ac = new AbortController(); engineAbort = ac;
        const pending = new Map<string, Extract<TraceEvent, { t: "model" }>>();
        const lastUsd = new Map<string, number>();
        const flush = (id: string) => { const m = pending.get(id); if (m) { trace(m); pending.delete(id); } };
        const byId = new Map<string, AgentCtx>(agents.map((a) => [a.id, a]));
        const allow = new Set([...TOOLS, ...LIFE_DEFS].map((t) => t.scope));
        const clock = o.life ? new SimClock({ speed: o.life.speed, now }) : undefined;
        const arrivals = o.life?.arrivals ? parseArrivals(o.life.arrivals) : undefined;
        const life = o.life && clock ? new Life({ clock, source: societySource({ world: world.api, didOf: (id) => byId.get(id)?.did, clock }), ...(o.life.limits ? { limits: o.life.limits } : {}), notebookDir: join(dir, "notebooks"), digest: () => societyDigest(world.api),
          onWake: (w) => trace({ t: "wake", at: stamp(), agent: w.agent, simMs: Math.round(w.simAt), because: w.because, kinds: w.kinds, events: w.events, delayedSimMs: Math.round(w.delayedSimMs) }),
          onNote: (n) => {
            if (n.kind === "premature_stop_candidate") trace({ t: "premature_stop_candidate", at: stamp(), agent: n.agent, via: n.via, text: n.text, simMs: Math.round(n.simAt) });
            else trace({ t: "leave", at: stamp(), agent: n.agent, simMs: Math.round(n.simAt), sinceArrivalMs: Math.round(n.sinceArrivalSimMs), pending: n.pending, afterCheck: n.afterCheck, reason: n.reason });
          }, ...(o.life.sleep ? { sleep: o.life.sleep } : {}) }) : undefined;
        await life?.refreshDigest(true);
        const deadline = setTimeout(() => { shared.stopped ??= `the run's ${o.minutes} minutes are up`; trace({ t: "stop", at: stamp(), reason: shared.stopped }); ac.abort(); }, o.minutes * 60_000);
        deadline.unref?.();
        const toolsetFor = (id: string) => {
          const a = byId.get(id)!;
          const tools: SocietyTool[] = TOOLS.filter((t) => !(life && t.name === "stop_exploring")).map((t) => ({
            name: t.name, description: t.description, input_schema: t.input_schema as unknown as Record<string, unknown>,
            run: async (args, ctx) => {
              const t0 = now();
              flush(id);
              const r = await runTool(world.api, a, allow, t.name, args);
              if (t.name === "stop_exploring") trace({ t: "premature_stop_candidate", at: stamp(), agent: id, via: "stop_exploring", text: String(args.why ?? "").slice(0, 200) });
              life?.agent(id).noteAction(t.name, r.ok, typeof args.title === "string" ? args.title : undefined);
              trace({ t: "tool", at: stamp(), agent: id, turn: ctx.turn, tool: t.name, input: args, ok: r.ok, ...(r.refused ? { refused: r.refused } : {}), chars: r.text.length, institution: t.institution, scope: t.scope, writes: !!t.writes, ...(r.target ? { target: r.target } : {}), ...(r.targetAuthor ? { targetAuthor: r.targetAuthor } : {}), ...(r.ok && injectionIn(r.text) ? { injectionSeen: true } : {}), ...(t.writes && injectionIn(JSON.stringify(args)) ? { injectionWritten: true } : {}), ms: now() - t0 } as TraceEvent);
              return { ok: r.ok, text: r.text, ...(r.end ? { end: true } : {}) };
            },
          }));
          const mine = life?.agent(id);
          const lifeTools: SocietyTool[] = mine ? mine.tools().map((lt) => ({
            ...lt,
            run: async (args, ctx) => {
              const t0 = now(); flush(id);
              const r = await lt.run(args, ctx);
              const d = defOf(lt.name)!;
              mine.noteAction(lt.name, r.ok, typeof args.reason === "string" ? args.reason : typeof args.until === "string" ? args.until : typeof args.max_wait === "string" ? `up to ${args.max_wait}` : undefined);
              trace({ t: "tool", at: stamp(), agent: id, turn: ctx.turn, tool: lt.name, input: args, ok: r.ok, ...(r.refused ? { refused: r.refused } : {}), chars: r.text.length, institution: d.institution, scope: d.scope, writes: !!d.writes, ms: now() - t0 } as TraceEvent);
              return r;
            },
          })) : [];
          return { tools: [...tools, ...lifeTools], summary: () => mine?.summaryText(), ...(mine ? { idle: (_agent: string, text: string, signal: AbortSignal) => mine.idle(text, signal) } : {}), system: () => (life ? BRIEFING.replace("When you have done enough, use stop_exploring.", ENGAGED_ENDING) : BRIEFING) + (a.persona ? `

${a.persona}` : ""), opening: () => (mine ? mine.observation("You are here now. Begin whenever you like. You may rest, wait for things to happen, keep a notebook, or leave for good; none of it is required.") : "You are here now. Begin whenever you like.") };
        };
        const res = await runEngine({
          agents: agents.map((a) => a.id), toolsetFor, model: o.model, keyEnv: o.engine.keyEnv, env: o.engine.env, perAgentUsd: o.budgetUsd, totalUsd: o.totalUsd,
          ...(o.engine.price ? { price: o.engine.price } : {}),
          ...(o.engine.parallel ? { parallel: o.engine.parallel } : {}), ...(o.engine.upstream ? { upstream: o.engine.upstream } : {}),
          limits: { maxTurns: o.maxTurns ?? 60, wallClockMs: o.minutes * 60_000, maxResultChars: 2000, maxTokens: o.maxAgentTokens ?? 200_000 }, ...(o.economy ? { economy: o.economy } : {}), runDir: join(dir, "agents"), signal: ac.signal,
          ...(life && clock ? { loop: { equivalentCalls: 40, nearRepeats: 60 }, beforeStart: async (a: string, i: number, sig: AbortSignal) => { if (arrivals) { const ms = clock.realMsUntil(arrivalAt(arrivals, i)); if (ms > 0) await life.sleep(ms, sig); } trace({ t: "arrival", at: stamp(), agent: a, simMs: Math.round(clock.now()) }); } } : {}),
          onEvent: (e) => {
            if (e.kind === "turn") {
              flush(e.agent);
              const prev = lastUsd.get(e.agent) ?? 0; lastUsd.set(e.agent, e.usd);
              pending.set(e.agent, { t: "model", at: stamp(), agent: e.agent, turn: e.turn, input: e.input ?? 0, output: e.output ?? 0, ...(e.cacheRead ? { cacheRead: e.cacheRead } : {}), ...(e.cacheWrite ? { cacheWrite: e.cacheWrite } : {}), usd: Math.round((e.usd - prev) * 1e6) / 1e6 });
            } else if (e.kind === "text") { const m = pending.get(e.agent); if (m) m.text = ((m.text ? m.text + " " : "") + e.text).slice(0, 400); }
            else if (e.kind === "tool" && e.refused) {
              flush(e.agent);
              const name = e.tool.replace(/^mcp__society__/, ""); const d = defOf(name);
              trace({ t: "tool", at: stamp(), agent: e.agent, turn: e.turn, tool: name, input: {}, ok: false, refused: "gateway", chars: 0, institution: d?.institution ?? "none", scope: d?.scope ?? "none", writes: !!d?.writes, ms: 0 });
            } else if (e.kind === "end") {
              flush(e.agent);
              const oc = e.outcome;
              trace({ t: "end", at: stamp(), agent: e.agent, reason: oc.stopped === "stopped" && shared.stopped ? `stopped: ${shared.stopped}` : `${oc.stopped}${oc.detail ? `: ${oc.detail}` : ""}`, turns: oc.turns, usd: oc.usd });
              shared.spentUsd += oc.usd;
            }
          },
        });
        void res;
        clearTimeout(deadline);
      } else await Promise.all(agents.map(async (a, i) => {
        if (o.staggerMs && i) await new Promise((r) => setTimeout(r, o.staggerMs! * i));
        await runAgent({ agent: a, provider: o.provider!, world: world.api, caps, shared, trace, stopRequested, now });
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
  const eco = economyOf(events);
  const eng = engagementOf(events, o.life?.engagedMinutes ?? 30);
  writeFileSync(markdownPath, (logPart ? `${markdown}\n${renderLogSections(logPart, { perAgent: report.perAgent })}\n` : markdown) + `\n${renderEconomy(eco)}` + (o.life ? `\n${renderEngagement(eng)}` : ""));
  if (o.life) writeFileSync(join(dir, "engagement.json"), JSON.stringify(eng, null, 2) + "\n");
  writeFileSync(join(dir, "economy.json"), JSON.stringify(eco, null, 2) + "\n");
  if (signed) writeFileSync(join(dir, "signed-trace.json"), JSON.stringify(signed, null, 2) + "\n");
  writeFileSync(join(dir, "report.json"), json);
  o.io.out(`done: ${report.agents} agents, estimated spend $${report.totalUsd.toFixed(4)} of $${o.totalUsd}; report ${markdownPath}`);
  return { report, dir, markdownPath, sid };
}

/** Reads the personas of a persona file: one persona per paragraph (separated by a blank line). */
export function readPersonas(path: string): string[] {
  return readFileSync(path, "utf8").split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
}
