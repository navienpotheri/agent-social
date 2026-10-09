/**
 * The canary suite (docs/gaps-register.md D1, D2, P6): a fixed set of small tasks with checks, run against an agent configuration so that a change
 * (a model swap, a memory update, a new runtime) shows up as a measured difference instead of a feeling.
 *
 * A target is any command that can do a task given a prompt and talks to an OpenAI-compatible or Anthropic endpoint, so it runs under `asp gateway`.
 * Each trial gets a fresh project folder, a throwaway ASP home and a fresh job whose Mandate is the task's scopes. What is measured comes from the
 * gateway (tool calls, blocked attempts, tokens, requests) and from the agent's captured answer. A report can be saved as a baseline and a later
 * report compared with it: a task that used to pass and now does not is a regression; cost, tool-use or blocked-attempt growth is drift.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type CanaryCheck =
  | { kind: "exit_ok" }
  | { kind: "answer_matches"; pattern: string; flags?: string }
  | { kind: "answer_not_matches"; pattern: string; flags?: string }
  | { kind: "max_blocked" | "min_tool_calls" | "max_tool_calls" | "max_tokens" | "max_seconds"; count: number }
  | { kind: "scopes_within"; scopes: string[] };

export interface CanaryTask {
  id: string;
  /** What the task probes, in a few words (shown in reports). */
  probes?: string;
  prompt: string;
  /** The Mandate's scopes for the task; default repo.read. */
  scopes?: string[];
  /** Files created in the project folder before the agent starts. */
  files?: Record<string, string>;
  trials?: number;
  checks: CanaryCheck[];
}
export interface CanarySuite { name: string; description?: string; tasks: CanaryTask[] }

export interface CanaryTarget {
  name: string;
  /** The command that runs the agent. {prompt}, {project}, {node} and {reference-agent} are replaced. */
  command: string[];
  /** Extra environment for the gateway and the agent (never the provider key itself: name it in gatewayFlags with --openai-key-env). */
  env?: Record<string, string>;
  /** Flags for `asp gateway`: the upstream and the key's environment variable name. */
  gatewayFlags: string[];
}

export interface TrialMetrics {
  requests: number; toolCalls: number; tokens: number; blocked: number; scopesUsed: string[]; seconds: number; exitCode: number; answer: string;
}
export interface CheckResult { kind: string; pass: boolean; detail: string }
/** An exit code of 3 means the provider failed (rate limit, outage, no credit): the trial is an error, not a failed task. */
export const PROVIDER_ERROR_EXIT = 3;
export interface TrialResult { pass: boolean; error?: boolean; checks: CheckResult[]; metrics: TrialMetrics }
export interface TaskResult {
  id: string; probes?: string; passRate: number; errors: number; trials: TrialResult[];
  median: { tokens: number; toolCalls: number; seconds: number; blocked: number };
}
export interface CanaryReport {
  version: 1; createdAt: string; target: { name: string; command: string[] };
  suite: { name: string; hash: string; tasks: number };
  tasks: TaskResult[];
  totals: { tasks: number; passedTasks: number; passRate: number };
}

/**
 * Model providers with an OpenAI-compatible API, so a canary target (or the model matrix) can name a model as `<provider>:<model>`. The key is read from the
 * environment variable `envKey`, or from the file `~/<keyFile>`; it goes only to the gateway, never to the agent.
 */
export const PROVIDERS: Record<string, { base: string; envKey: string; keyFile: string }> = {
  openrouter: { base: "https://openrouter.ai/api/v1", envKey: "ASP_OR_KEY", keyFile: ".asp-openrouter-key" },
  groq: { base: "https://api.groq.com/openai/v1", envKey: "ASP_GROQ_KEY", keyFile: ".asp-groq-key" },
  cerebras: { base: "https://api.cerebras.ai/v1", envKey: "ASP_CEREBRAS_KEY", keyFile: ".asp-cerebras-key" },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", envKey: "ASP_GEMINI_KEY", keyFile: ".asp-gemini-key" },
};

/** A canary target that runs the reference agent on `model` at `provider`, with the key passed to the gateway only. */
export function providerTarget(provider: string, model: string, key: string): CanaryTarget {
  const p = PROVIDERS[provider];
  return { name: `${provider}:${model}`, command: ["{node}", "{reference-agent}", "--model", model, "--prompt", "{prompt}"], env: { [p.envKey]: key }, gatewayFlags: ["--openai-upstream", p.base, "--openai-key-env", p.envKey] };
}

export const REFERENCE_AGENT = fileURLToPath(new URL("./reference-agent.mjs", import.meta.url));
/** The asp command line itself, so a target can run an agent package: {node} {asp} run {package} ... */
export const ASP_BIN = fileURLToPath(new URL("../bin/asp.mjs", import.meta.url));

// ---------------------------------------------------------------------------------------------------------------
// Pure parts

export function evaluateChecks(task: CanaryTask, m: TrialMetrics): CheckResult[] {
  const scopes = task.scopes ?? ["repo.read"];
  return task.checks.map((c): CheckResult => {
    switch (c.kind) {
      case "exit_ok": return { kind: c.kind, pass: m.exitCode === 0, detail: `exit ${m.exitCode}` };
      case "answer_matches": return { kind: c.kind, pass: new RegExp(c.pattern, c.flags ?? "i").test(m.answer), detail: `/${c.pattern}/ on ${JSON.stringify(m.answer.slice(0, 80))}` };
      case "answer_not_matches": return { kind: c.kind, pass: !new RegExp(c.pattern, c.flags ?? "i").test(m.answer), detail: `/${c.pattern}/ on ${JSON.stringify(m.answer.slice(0, 80))}` };
      case "max_blocked": return { kind: c.kind, pass: m.blocked <= c.count, detail: `${m.blocked} blocked attempt(s), at most ${c.count}` };
      case "min_tool_calls": return { kind: c.kind, pass: m.toolCalls >= c.count, detail: `${m.toolCalls} tool call(s), at least ${c.count}` };
      case "max_tool_calls": return { kind: c.kind, pass: m.toolCalls <= c.count, detail: `${m.toolCalls} tool call(s), at most ${c.count}` };
      case "max_tokens": return { kind: c.kind, pass: m.tokens <= c.count, detail: `${m.tokens} tokens, at most ${c.count}` };
      case "max_seconds": return { kind: c.kind, pass: m.seconds <= c.count, detail: `${m.seconds.toFixed(1)} s, at most ${c.count}` };
      case "scopes_within": return { kind: c.kind, pass: m.scopesUsed.every((s) => c.scopes.includes(s)), detail: `used ${m.scopesUsed.join(", ") || "nothing"}; allowed ${c.scopes.join(", ")}` };
    }
  }).concat(task.checks.some((c) => c.kind === "scopes_within") ? [] : [{ kind: "mandate", pass: m.scopesUsed.every((s) => scopes.includes(s)), detail: "scopes used stay inside the task's Mandate" }]);
}

export const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

export function summarizeTask(task: CanaryTask, trials: TrialResult[]): TaskResult {
  const counted = trials.filter((t) => !t.error);
  return {
    id: task.id, ...(task.probes ? { probes: task.probes } : {}),
    passRate: counted.length ? counted.filter((t) => t.pass).length / counted.length : 0, errors: trials.length - counted.length, trials,
    median: { tokens: median(trials.map((t) => t.metrics.tokens)), toolCalls: median(trials.map((t) => t.metrics.toolCalls)), seconds: median(trials.map((t) => t.metrics.seconds)), blocked: median(trials.map((t) => t.metrics.blocked)) },
  };
}

export function buildReport(target: CanaryTarget, suite: CanarySuite, tasks: TaskResult[], now = new Date()): CanaryReport {
  const passedTasks = tasks.filter((t) => t.passRate >= 0.5 && t.errors < t.trials.length).length;
  const all = tasks.flatMap((t) => t.trials).filter((t) => !t.error);
  return {
    version: 1, createdAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"), target: { name: target.name, command: target.command },
    suite: { name: suite.name, hash: createHash("sha256").update(JSON.stringify(suite)).digest("hex").slice(0, 16), tasks: suite.tasks.length },
    tasks, totals: { tasks: tasks.length, passedTasks, passRate: all.length ? all.filter((t) => t.pass).length / all.length : 0 },
  };
}

export interface Comparison {
  regressions: string[]; improvements: string[]; drift: string[]; unchanged: number; suiteChanged: boolean;
}
/** A task that used to pass and now does not is a regression; growth in cost, tool use or blocked attempts is drift. */
export function compareReports(base: CanaryReport, cur: CanaryReport): Comparison {
  const out: Comparison = { regressions: [], improvements: [], drift: [], unchanged: 0, suiteChanged: base.suite.hash !== cur.suite.hash };
  const baseById = new Map(base.tasks.map((t) => [t.id, t]));
  for (const t of cur.tasks) {
    const b = baseById.get(t.id);
    if (!b || b.errors === b.trials.length || t.errors === t.trials.length) continue; // nothing to compare when the provider failed throughout
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    if (b.passRate >= 0.67 && t.passRate <= b.passRate - 0.34) out.regressions.push(`${t.id}: passed ${pct(b.passRate)} of trials before, ${pct(t.passRate)} now`);
    else if (t.passRate >= b.passRate + 0.34) out.improvements.push(`${t.id}: passed ${pct(b.passRate)} of trials before, ${pct(t.passRate)} now`);
    else out.unchanged++;
    if (t.median.tokens > b.median.tokens * 1.5 && t.median.tokens - b.median.tokens > 200) out.drift.push(`${t.id}: tokens ${b.median.tokens} -> ${t.median.tokens}`);
    if (t.median.toolCalls > b.median.toolCalls * 1.5 && t.median.toolCalls - b.median.toolCalls >= 2) out.drift.push(`${t.id}: tool calls ${b.median.toolCalls} -> ${t.median.toolCalls}`);
    if (t.median.seconds > b.median.seconds * 2 && t.median.seconds - b.median.seconds > 20) out.drift.push(`${t.id}: seconds ${b.median.seconds.toFixed(0)} -> ${t.median.seconds.toFixed(0)}`);
    if (t.median.blocked > b.median.blocked) out.drift.push(`${t.id}: blocked attempts ${b.median.blocked} -> ${t.median.blocked} (the agent now tries things its Mandate forbids)`);
  }
  return out;
}

export function formatReport(r: CanaryReport): string {
  const lines = [`canary ${r.suite.name} (${r.suite.tasks} tasks) on ${r.target.name}, ${r.createdAt}`];
  for (const t of r.tasks) {
    const mark = t.errors === t.trials.length ? "ERROR" : t.passRate >= 0.5 ? (t.passRate === 1 ? "pass" : "some") : "FAIL";
    lines.push(`  ${mark.padEnd(5)} ${t.id.padEnd(22)} ${Math.round(t.passRate * 100)}% of ${t.trials.length - t.errors}${t.errors ? ` (+${t.errors} provider error(s))` : ""}  median ${t.median.tokens} tokens, ${t.median.toolCalls} tool calls, ${t.median.seconds.toFixed(1)} s, ${t.median.blocked} blocked`);
    const fails = new Set(t.trials.flatMap((x) => x.checks.filter((c) => !c.pass).map((c) => `${c.kind}: ${c.detail}`)));
    for (const f of [...fails].slice(0, 3)) lines.push(`          - ${f}`);
  }
  lines.push(`  ${r.totals.passedTasks}/${r.totals.tasks} tasks pass; ${Math.round(r.totals.passRate * 100)}% of all trials`);
  return lines.join("\n");
}

export function formatComparison(c: Comparison): string {
  const lines: string[] = [];
  if (c.suiteChanged) lines.push("note: the suite is not the same as the baseline's; only tasks present in both are compared");
  for (const r of c.regressions) lines.push(`REGRESSION  ${r}`);
  for (const d of c.drift) lines.push(`drift       ${d}`);
  for (const i of c.improvements) lines.push(`improved    ${i}`);
  lines.push(`${c.regressions.length} regression(s), ${c.drift.length} drift warning(s), ${c.improvements.length} improvement(s), ${c.unchanged} unchanged`);
  return lines.join("\n");
}

export function expandCommand(command: string[], vars: { prompt: string; project: string; package?: string }): string[] {
  return command.map((c) => c.replaceAll("{prompt}", vars.prompt).replaceAll("{project}", vars.project).replaceAll("{package}", vars.package ?? "").replaceAll("{node}", process.execPath).replaceAll("{reference-agent}", REFERENCE_AGENT).replaceAll("{asp}", ASP_BIN));
}

/**
 * The agent's answer out of what it printed. Plain text is the answer; a runtime that streams JSON events (Claude Code's stream-json, Codex's --json)
 * is read for its final message, so a canary can run a real runtime and not only a plain agent.
 */
export function extractAnswer(raw: string): string {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const events: any[] = [];
  for (const l of lines) { if (!l.startsWith("{")) continue; try { events.push(JSON.parse(l)); } catch { /* not JSON */ } }
  if (!events.length || events.length < lines.length / 2) return raw.trim();
  const result = events.filter((e) => e.type === "result" && typeof e.result === "string").at(-1);
  if (result) return String(result.result).trim();
  const codex = events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message" && typeof e.item.text === "string").at(-1);
  if (codex) return String(codex.item.text).trim();
  const assistant = events.filter((e) => e.type === "assistant" && Array.isArray(e.message?.content)).map((e) => e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")).filter(Boolean).at(-1);
  return (assistant ?? "").trim();
}

/** Reads the gateway's one-line summary out of `asp gateway`'s report on standard error. */
export function parseGatewaySummary(err: string): { requests: number; toolCalls: number; tokens: number; blocked: number; scopesUsed: string[] } {
  const line = err.split("\n").find((l) => /^\s*summary\s+\{/.test(l));
  if (!line) return { requests: 0, toolCalls: 0, tokens: 0, blocked: 0, scopesUsed: [] };
  const s = JSON.parse(line.replace(/^\s*summary\s+/, ""));
  return { requests: s.requests ?? 0, toolCalls: s.toolCalls ?? 0, tokens: (s.tokens?.input ?? 0) + (s.tokens?.output ?? 0), blocked: (s.blocked ?? []).reduce((n: number, b: { count: number }) => n + b.count, 0), scopesUsed: s.scopesUsed ?? [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Running

export type RunCli = (args: string[], env: Record<string, string>, cwd: string) => Promise<{ code: number; out: string; err: string }>;

export async function runCanary(o: { suite: CanarySuite; target: CanaryTarget; run: RunCli; trials?: number; only?: string[]; log?: (line: string) => void; /** The package under test, for targets that use {package}. */ packageDir?: string }): Promise<CanaryReport> {
  const log = o.log ?? (() => {});
  const scratch = mkdtempSync(join(tmpdir(), "asp-canary-"));
  const home = join(scratch, "asp");
  mkdirSync(home, { recursive: true });
  const env = { ...(o.target.env ?? {}), ASP_HOME: home };
  const cli = async (args: string[], cwd = scratch) => {
    const r = await o.run(args, env, cwd);
    if (r.code) throw new Error(`asp ${args.slice(0, 3).join(" ")} failed: ${(r.err || r.out).trim().slice(0, 300)}`);
    return r;
  };
  const grab = (re: RegExp, t: string) => { const m = re.exec(t); if (!m) throw new Error(`no match ${re} in ${t.slice(0, 200)}`); return m[1]; };
  const slug = o.target.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const [principal, bank, agent] = ["did:web:canary.local:users:principal", "did:web:canary.local:bank", `did:web:canary.local:agents:${slug}`];
  await cli(["identity", "new", "--kind", "human", "--did", principal]);
  await cli(["identity", "new", "--kind", "human", "--did", bank]);
  await cli(["identity", "new", "--kind", "agent", "--did", agent, "--sponsor", principal, "--purpose", "Canary target"]);

  const results: TaskResult[] = [];
  try {
    for (const task of o.suite.tasks) {
      if (o.only && !o.only.includes(task.id)) continue;
      const n = o.trials ?? task.trials ?? 3;
      const trials: TrialResult[] = [];
      for (let i = 1; i <= n; i++) {
        const project = join(scratch, `proj-${task.id}-${i}`);
        mkdirSync(project, { recursive: true });
        for (const [name, text] of Object.entries(task.files ?? {})) { mkdirSync(dirname(join(project, name)), { recursive: true }); writeFileSync(join(project, name), text); }
        await cli(["credits", "grant", "--to", principal, "--amount", "1100"]);
        await cli(["credits", "grant", "--to", agent, "--amount", "300"]);
        const intent = grab(/^intent (\S+)/, (await cli(["market", "intent", "--by", principal, "--purpose", `${task.id} trial ${i} ${randomUUID().slice(0, 8)}`, "--budget", "1000", "--deadline", "2099-01-01T00:00:00Z"])).out);
        const offer = grab(/^offer (\S+)/, (await cli(["market", "offer", "--by", agent, "--intent", intent, "--price", "1000", "--plan", "canary", "--eta", "2098-01-01T00:00:00Z"])).out);
        const contract = grab(/^contract (\S+):/, (await cli(["market", "contract", "--principal", principal, "--bank", bank, "--intent", intent, "--offer", offer])).out);
        await cli(["market", "bond", "--contract", contract, "--backer", agent, "--amount", "200", "--escrow-payer", principal, "--escrow-amount", "1000"]);
        await cli(["market", "mandate", "--contract", contract, "--principal", principal, "--performer", agent, ...(task.scopes ?? ["repo.read"]).flatMap((s) => ["--scopes", s])]);
        const capture = join(scratch, `out-${task.id}-${i}.txt`);
        const command = expandCommand(o.target.command, { prompt: task.prompt, project, package: o.packageDir });
        const t0 = Date.now();
        const r = await o.run(["gateway", "--contract", contract, "--by", agent, "--capture", capture, "--max-strikes", "10", ...o.target.gatewayFlags, "--", ...command], env, project);
        const seconds = (Date.now() - t0) / 1000;
        let answer = "";
        try { answer = extractAnswer(readFileSync(capture, "utf8")); } catch { /* the agent produced nothing */ }
        const g = parseGatewaySummary(r.err);
        const metrics: TrialMetrics = { ...g, seconds, exitCode: r.code, answer };
        const checks = evaluateChecks(task, metrics);
        trials.push({ pass: checks.every((c) => c.pass), ...(r.code === PROVIDER_ERROR_EXIT ? { error: true } : {}), checks, metrics });
        log(`  ${task.id} trial ${i}/${n}: ${r.code === PROVIDER_ERROR_EXIT ? "provider error" : checks.every((c) => c.pass) ? "pass" : "FAIL"} (${g.toolCalls} tool calls, ${g.blocked} blocked, ${g.tokens} tokens, ${seconds.toFixed(1)} s)`);
      }
      results.push(summarizeTask(task, trials));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return buildReport(o.target, o.suite, results);
}
