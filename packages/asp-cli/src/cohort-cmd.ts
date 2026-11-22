/**
 * `asp cohort run` (register row DK1801; docs/society-models-run.md): runs the model-backed society cohort with the driver of packages/asp-package/src/cohort. The society's tool set is a module of the society worker's, named
 * with --toolset: it exports `toolsetFor(agent)` (and may export `agents`, `setup()` and `close()`). The provider key is read by the driver from the environment variable named by --key-env and from nowhere else; this command
 * never reads it, prints it or writes it (it says only that the variable is set and how long its value is). Without --yes the command prints the plan and the most it could cost and stops: nothing is called.
 *
 * The run is a session of this machine's index, so `asp runs` lists it and `asp stop --all` ends it: the stop file is watched and every loop stops at its next turn, the call in flight is aborted.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { runCohort, type AgentOutcome, type DriverEvent, type SocietyToolSet } from "@agent-social/asp-package";

export class CohortUsage extends Error {}

export interface CohortHooks {
  sessionStart(sid: string, purpose: string): void;
  sessionEnd(sid: string, state: string, calls: number, refused: string[], tokens: number, exitCode: number, runLog?: string): void;
}
interface Flags { toolset?: string; agents?: string; "agent-prefix"?: string; model?: string; "key-env"?: string; "per-agent-usd"?: string; "total-usd"?: string; "max-turns"?: string; minutes?: string; parallel?: string; "run-dir"?: string; upstream?: string; yes?: boolean; json?: boolean }
interface IoLike { out(l: string): void; err(l: string): void; env: Record<string, string | undefined>; cwd: string }
interface ToolsetModule { toolsetFor?: (agent: string) => SocietyToolSet; agents?: string[]; setup?: () => Promise<void> | void; close?: () => Promise<void> | void; default?: ToolsetModule }

const usd = (n: number) => "$" + n.toFixed(4);

export async function cohortCommand(home: string, sub: string | undefined, v: Flags, io: IoLike, hooks: CohortHooks, now: () => string): Promise<number> {
  if (sub !== "run") throw new CohortUsage("asp cohort run --toolset <module> [--agents 15] [--model claude-haiku-5-5] [--key-env ANTHROPIC_API_KEY] [--per-agent-usd 0.40] [--total-usd 6] [--max-turns n] [--minutes n] [--parallel n] [--run-dir <dir>] [--yes]");
  if (!v.toolset) throw new CohortUsage("--toolset <module> names the society worker's tool set (a module that exports toolsetFor(agent))");
  const n = Math.trunc(Number(v.agents ?? "15"));
  if (!(n >= 1 && n <= 200)) throw new CohortUsage("--agents is a whole number from 1 to 200");
  const perAgent = Number(v["per-agent-usd"] ?? "0.40"), total = Number(v["total-usd"] ?? "6");
  if (!(perAgent > 0) || !(total > 0)) throw new CohortUsage("--per-agent-usd and --total-usd are positive dollar figures");
  const keyEnv = v["key-env"] ?? "ANTHROPIC_API_KEY";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv)) throw new CohortUsage("--key-env is the NAME of an environment variable, not the key");
  const model = v.model ?? "claude-haiku-5-5";
  const mod0 = (await import(pathToFileURL(resolve(io.cwd, v.toolset)).href)) as ToolsetModule;
  const mod: ToolsetModule = typeof mod0.toolsetFor === "function" ? mod0 : (mod0.default ?? {});
  if (typeof mod.toolsetFor !== "function") throw new CohortUsage(`${v.toolset} does not export toolsetFor(agent)`);
  const prefix = v["agent-prefix"] ?? "citizen";
  const agents = mod.agents?.length ? mod.agents.slice(0, n) : Array.from({ length: n }, (_x, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);
  const key = io.env[keyEnv];
  io.out(`cohort plan: ${agents.length} agent(s) on ${model}, ${usd(perAgent)} each, ${usd(total)} in all (the most it could cost: ${usd(Math.min(total, perAgent * agents.length))}); an estimate from the tokens each reply reports, never the provider's bill`);
  io.out(`  key      ${key ? `set in ${keyEnv} (${key.length} characters; never printed, never written)` : `NOT set in ${keyEnv}`}`);
  io.out(`  tools    ${v.toolset}`);
  io.out(`  limits   ${v["max-turns"] ?? "60"} turns and ${v.minutes ?? "30"} minutes for each agent`);
  if (!v.yes) { io.out("nothing was called. Run again with --yes to start; asp stop --all ends it."); return 0; }
  if (!key) throw new CohortUsage(`${keyEnv} is not set in this window: set it for this window only (the cohort reads it from there and from nowhere else), then run again`);
  const runDir = resolve(io.cwd, v["run-dir"] ?? join(home, "cohort", now().replace(/[:]/g, "")));
  mkdirSync(runDir, { recursive: true });
  const sid = randomBytes(4).toString("hex");
  const stopFile = join(home, `stop-${sid}`);
  hooks.sessionStart(sid, `model-backed society cohort of ${agents.length} on ${model}`);
  if (mod.setup) await mod.setup();
  const ac = new AbortController();
  const watch = setInterval(() => { if (existsSync(stopFile)) { io.err("  stop requested (asp stop): every agent ends at its next turn"); ac.abort(); } }, 500);
  const printEvent = (e: DriverEvent) => { if (e.kind === "end") io.err(`  ${e.agent.padEnd(18)} ${e.outcome.stopped.padEnd(15)} ${String(e.outcome.turns).padStart(3)} turns ${String(e.outcome.toolCalls).padStart(3)} calls ${String(e.outcome.refused).padStart(2)} refused ${usd(e.outcome.usd)}`); else if (e.kind === "retry") io.err(`  ${e.agent}: the provider answered ${e.status || "no connection"}; waiting ${Math.round(e.waitMs / 1000)}s (try ${e.attempt})`); };
  let outcomes: AgentOutcome[] = [], spent = 0, stopped = "failed", failure: string | undefined;
  try {
    const r = await runCohort({
      agents, toolsetFor: mod.toolsetFor, model, keyEnv, perAgentUsd: perAgent, totalUsd: total, runDir, signal: ac.signal, onEvent: printEvent,
      ...(v.upstream ? { upstream: v.upstream } : {}), ...(v.parallel ? { parallel: Math.trunc(Number(v.parallel)) } : {}),
      limits: { ...(v["max-turns"] ? { maxTurns: Math.trunc(Number(v["max-turns"])) } : {}), ...(v.minutes ? { wallClockMs: Math.round(Number(v.minutes) * 60_000) } : {}) },
      env: io.env,
    });
    outcomes = r.outcomes; spent = r.usd; stopped = r.stopped;
  } catch (e) { failure = (e as Error).message; }
  finally { clearInterval(watch); if (mod.close) await Promise.resolve(mod.close()).catch(() => undefined); }
  const calls = outcomes.reduce((x, o) => x + o.toolCalls, 0), refused = outcomes.reduce((x, o) => x + o.refused, 0);
  const tokens = outcomes.reduce((x, o) => x + o.tokens.input + o.tokens.output, 0);
  writeFileSync(join(runDir, "outcomes.json"), JSON.stringify({ model, agents: agents.length, perAgentUsd: perAgent, totalUsd: total, spentUsd: spent, stopped, failure: failure ?? null, outcomes, note: "estimates from the tokens each reply reports, never the provider's bill; credits are accounting entries, not money" }, null, 2) + "\n");
  hooks.sessionEnd(sid, failure ? "failed" : stopped === "stopped" ? "stopped" : "ended", calls, outcomes.flatMap((o) => (o.refused ? [`${o.agent}: ${o.refused}`] : [])), tokens, failure ? 1 : 0, runDir);
  if (failure) { io.err(`the cohort could not run: ${failure}`); return 1; }
  if (v.json) io.out(JSON.stringify({ spentUsd: spent, stopped, outcomes }, null, 2));
  else {
    io.out(`cohort ${stopped}: ${outcomes.length} agent(s), ${usd(spent)} estimated of ${usd(total)}, ${calls} society tool call(s), ${refused} refused`);
    const by: Record<string, number> = {}; for (const o of outcomes) by[o.stopped] = (by[o.stopped] ?? 0) + 1;
    io.out(`  ended: ${Object.entries(by).map(([k, c]) => `${c} ${k}`).join(", ")}; outcomes and run logs in ${runDir}`);
  }
  return 0;
}
