/**
 * OpenAI Codex CLI adapter.
 *
 * capture: AGENTS.md / AGENTS.override.md (and project_doc_fallback_filenames), repo and user skills
 *   (.agents/skills, $CODEX_HOME/skills), config.toml (project .codex/ and user $CODEX_HOME/): model,
 *   MCP servers, approval and sandbox settings; hooks.json; execpolicy .rules files; with
 *   --include-user, Codex's global memories; and a metadata-only index of this project's sessions.
 * materialize: never writes into the project or $CODEX_HOME. Instructions, skills (listed in Codex's
 *   own skills format, pointing at copies in the run dir), commands, subagent roles and memory go in
 *   developer_instructions; MCP servers go in -c overrides with secrets passed by env var name; memory
 *   is a writable --add-dir so changes can be carried back.
 *
 * Checked against codex-cli 0.157.1 and https://learn.chatgpt.com/docs (2026-09-27): developer_instructions
 * reaches the model as a developer message; skills load only from .agents/skills dirs (skills.config
 * paths and HOME overrides do not add skills), so they are listed in the prompt instead.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { codexActionParser } from "./codex-actions.ts";
import { copyInto, listFiles, sha256File, toPosix, writeJson } from "../files.ts";
import { asList, frontmatter } from "../frontmatter.ts";
import type { Capture, Component, Harness, LaunchPlan, McpServer, RuntimeAdapter, SessionSummary } from "../harness.ts";
import { resolveSecrets, stripSecrets, type Env } from "../secrets.ts";

export const RUNTIME = "codex";

/** Longest developer_instructions passed inline; beyond it the prompt points at the file (Windows caps a command line at 32 KiB). */
const MAX_INLINE_INSTRUCTIONS = 20_000;

// ---------- TOML values for -c overrides ----------

const bareKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));

/** A TOML value on one line: JSON string escapes are valid TOML basic-string escapes. */
export function tomlValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(", ")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${bareKey(k)} = ${tomlValue(x)}`).join(", ")}}`;
  throw new Error(`cannot express ${String(v)} in TOML`);
}

// ---------- capture ----------

interface CodexConfig {
  model?: string;
  approval_policy?: string;
  sandbox_mode?: string;
  project_doc_fallback_filenames?: string[];
  mcp_servers?: Record<string, Record<string, any>>;
  hooks?: Record<string, unknown[]>;
}

function readToml(path: string): CodexConfig | undefined {
  return existsSync(path) ? (parseToml(readFileSync(path, "utf8")) as CodexConfig) : undefined;
}

function readHooks(dir: string, cfg: CodexConfig | undefined): Record<string, unknown[]> {
  const file = join(dir, "hooks.json");
  const fromFile = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).hooks ?? {}) : {};
  return { ...(cfg?.hooks ?? {}), ...fromFile };
}

/** Codex MCP server → harness form. Literal env and header values become placeholders; env-var names stay names. */
function mcpToHarness(server: Record<string, any>, secrets: Set<string>): McpServer {
  const out: McpServer = {};
  if (server.command) out.command = server.command;
  if (server.args) out.args = server.args;
  if (server.url) out.url = server.url;
  const env: Env = stripSecrets(server.env, secrets);
  for (const name of (server.env_vars ?? []) as string[]) { env[name] = { $secret: name }; secrets.add(name); }
  if (Object.keys(env).length) out.env = env;
  const headers: Env = stripSecrets(server.http_headers, secrets);
  for (const [h, name] of Object.entries((server.env_http_headers ?? {}) as Record<string, string>)) { headers[h] = { $secret: name }; secrets.add(name); }
  if (server.bearer_token_env_var) { secrets.add(server.bearer_token_env_var); out.bearer_token_env_var = server.bearer_token_env_var; }
  if (Object.keys(headers).length) out.headers = headers;
  if (server.enabled === false) out.enabled = false;
  return out;
}

const sameDir = (a: string, b: string) => resolve(a).replace(/[\\/]+$/, "").toLowerCase() === resolve(b).replace(/[\\/]+$/, "").toLowerCase();

/** Metadata-only summary of a Codex rollout file: counts and timestamps, never message content. */
export function summarizeRollout(file: string): SessionSummary & { cwd?: string } {
  const s: SessionSummary & { cwd?: string } = {
    session: basename(file, ".jsonl"), runtime: RUNTIME, models: [], prompts: 0, assistant_turns: 0,
    tool_calls: {}, tool_errors: 0, output_tokens: 0,
  };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (typeof o.timestamp === "string") { s.started_at ??= o.timestamp; s.ended_at = o.timestamp; }
    const p = o.payload ?? {};
    if (o.type === "session_meta") { s.cwd = p.cwd; s.runtime_version = p.cli_version; s.session = p.id ?? s.session; }
    else if (o.type === "turn_context" && p.model && !s.models.includes(p.model)) s.models.push(p.model);
    else if (o.type === "event_msg" && p.type === "user_message") s.prompts++;
    else if (o.type === "event_msg" && p.type === "agent_message") s.assistant_turns++;
    else if (o.type === "event_msg" && p.type === "token_count") s.output_tokens = p.info?.total_token_usage?.output_tokens ?? s.output_tokens;
    else if (o.type === "event_msg" && p.type === "mcp_tool_call_end") {
      const name = `mcp__${p.invocation?.server}__${p.invocation?.tool}`;
      s.tool_calls[name] = (s.tool_calls[name] ?? 0) + 1;
      if (p.result && !("Ok" in p.result)) s.tool_errors++;
    } else if (o.type === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call")) {
      s.tool_calls[p.name] = (s.tool_calls[p.name] ?? 0) + 1;
    }
  }
  return s;
}

function* rollouts(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* rollouts(p);
    else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) yield p;
  }
}

async function capture(opts: { project: string; includeUser: boolean; home?: string; staging: string }): Promise<Capture> {
  const { project, includeUser, staging } = opts;
  const home = opts.home ?? homedir();
  const codexHome = opts.home ? join(home, ".codex") : (process.env.CODEX_HOME ?? join(home, ".codex"));
  const hdir = join(staging, "harness");
  const warnings: string[] = [];
  const secrets = new Set<string>();
  const harness: Harness = {
    format: "asp.harness/v0.1", instructions: [], skills: [], subagents: [], commands: [],
    hooks: {}, mcp_servers: {}, permissions: { allow: [], deny: [], ask: [] }, env: {},
  };

  const userCfg = includeUser ? readToml(join(codexHome, "config.toml")) : undefined;
  const projectCfg = readToml(join(project, ".codex", "config.toml"));
  const cfg: CodexConfig = { ...userCfg, ...projectCfg, mcp_servers: { ...userCfg?.mcp_servers, ...projectCfg?.mcp_servers } };

  // Instructions: user AGENTS(.override).md, then the project's, then fallback names.
  let n = 0;
  const addInstruction = (src: string, name: string, scope: Harness["instructions"][number]["scope"]) => {
    const path = `instructions/${String(n++).padStart(2, "0")}-${name.replace(/[\\/]/g, "__")}`;
    copyInto(src, join(hdir, path));
    const applies = asList(frontmatter(readFileSync(src, "utf8")).paths);
    harness.instructions.push({ name, scope, path, ...(applies ? { applies_to: applies } : {}) });
  };
  const agentsFile = (dir: string) => ["AGENTS.override.md", "AGENTS.md"].find((f) => existsSync(join(dir, f)));
  if (includeUser) {
    const f = agentsFile(codexHome);
    if (f) addInstruction(join(codexHome, f), f, "user");
  }
  const pf = agentsFile(project);
  if (pf) addInstruction(join(project, pf), pf, "project");
  for (const f of cfg.project_doc_fallback_filenames ?? []) {
    if (!pf && existsSync(join(project, f))) addInstruction(join(project, f), f, "project");
  }

  // Skills: repo .agents/skills, then (with --include-user) ~/.agents/skills and $CODEX_HOME/skills. System skills are Codex's own.
  const skillRoots: [string, "project" | "user"][] = [[join(project, ".agents", "skills"), "project"]];
  if (includeUser) skillRoots.push([join(home, ".agents", "skills"), "user"], [join(codexHome, "skills"), "user"]);
  const seen = new Set<string>();
  for (const [root, scope] of skillRoots) {
    for (const name of existsSync(root) ? readdirSync(root).sort() : []) {
      const dir = join(root, name);
      if (name.startsWith(".") || !statSync(dir).isDirectory() || !existsSync(join(dir, "SKILL.md"))) continue;
      if (seen.has(name)) { warnings.push(`skipped ${scope} skill "${name}": another skill has the same name`); continue; }
      seen.add(name);
      copyInto(dir, join(hdir, "skills", name));
      const fm = frontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
      harness.skills.push({ name, path: `skills/${name}`, scope, ...(typeof fm.description === "string" ? { description: fm.description } : {}) } satisfies Component);
    }
  }

  // MCP servers, hooks, model, and Codex-only settings.
  for (const [name, server] of Object.entries(cfg.mcp_servers ?? {})) harness.mcp_servers[name] = mcpToHarness(server, secrets);
  harness.hooks = { ...(includeUser ? readHooks(codexHome, userCfg) : {}), ...readHooks(join(project, ".codex"), projectCfg) };
  if (cfg.model) harness.model = cfg.model;
  const specific: Record<string, unknown> = {};
  if (cfg.approval_policy) specific.approval_policy = cfg.approval_policy;
  if (cfg.sandbox_mode) specific.sandbox_mode = cfg.sandbox_mode;
  const rulesDir = join(project, ".codex", "rules");
  const rules = listFiles(rulesDir).filter((f) => f.endsWith(".rules"));
  for (const f of rules) copyInto(join(rulesDir, f), join(hdir, "codex", "rules", f));
  if (rules.length) specific.rules = rules.map((f) => `codex/rules/${f}`);
  if (Object.keys(specific).length) harness.runtime_specific = { [RUNTIME]: specific };
  if (secrets.size) harness.secrets = [...secrets].sort();

  // Memory: Codex's memories are global across projects, so they come along only with --include-user.
  mkdirSync(join(staging, "memory"), { recursive: true });
  if (includeUser && existsSync(join(codexHome, "memories")) && listFiles(join(codexHome, "memories")).length) {
    copyInto(join(codexHome, "memories"), join(staging, "memory", "codex"));
    warnings.push("included Codex memories, which are shared across all projects on this machine");
  }

  // Experience: metadata-only index of this project's sessions.
  const sessions = [...rollouts(join(codexHome, "sessions"))]
    .map(summarizeRollout)
    .filter((s) => s.cwd && sameDir(s.cwd, project))
    .map(({ cwd: _cwd, ...s }) => s)
    .sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
  mkdirSync(join(staging, "experience"), { recursive: true });
  writeFileSync(join(staging, "experience", "sessions.ndjson"), sessions.map((s) => JSON.stringify(s)).join("\n") + (sessions.length ? "\n" : ""));

  writeJson(join(hdir, "harness.json"), harness);
  const latest = sessions.at(-1);
  return {
    dir: staging, harness, sessions: sessions.length, warnings,
    runtime: { name: RUNTIME, version: latest?.runtime_version, model: harness.model ?? latest?.models.at(-1) },
  };
}

// ---------- materialize ----------

/** How to launch Codex: the native codex.exe, the npm shim's codex.js under node (avoids cmd.exe quoting), or `codex`. */
export function resolveCodexCommand(env: NodeJS.ProcessEnv): { command: string; prefix: string[] } {
  if (env.ASP_CODEX_BIN) return { command: env.ASP_CODEX_BIN, prefix: env.ASP_CODEX_SCRIPT ? [env.ASP_CODEX_SCRIPT] : [] };
  if (process.platform === "win32") {
    for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) {
      if (existsSync(join(dir, "codex.exe"))) return { command: join(dir, "codex.exe"), prefix: [] };
      const js = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (existsSync(join(dir, "codex.cmd")) && existsSync(js)) return { command: process.execPath, prefix: [js] };
    }
  }
  return { command: "codex", prefix: [] };
}

const envName = (...parts: string[]) => parts.join("_").toUpperCase().replace(/[^A-Z0-9_]/g, "_");

async function materialize(opts: {
  pkgDir: string; harness: Harness; project: string; runDir: string; agentName: string; prompt?: string;
  env: NodeJS.ProcessEnv; model?: string; endpoint?: string; apiKeyEnv?: string; sourceRuntime?: string;
}): Promise<LaunchPlan> {
  const { pkgDir, harness, project, runDir } = opts;
  const h = join(pkgDir, "harness");
  const notes: string[] = [];
  const files: string[] = [];
  const posix = (p: string) => toPosix(p);

  // Copies the agent's files into the run dir so the prompt can point at them.
  const lib = join(runDir, "agent");
  for (const s of harness.skills) copyInto(join(h, s.path), join(lib, "skills", s.name));
  for (const a of harness.subagents) copyInto(join(h, a.path), join(lib, a.path));
  for (const c of harness.commands) copyInto(join(h, c.path), join(lib, c.path));
  if (harness.skills.length + harness.subagents.length + harness.commands.length) files.push("agent/");

  const memDir = join(runDir, "memory");
  if (existsSync(join(pkgDir, "memory"))) copyInto(join(pkgDir, "memory"), memDir);
  mkdirSync(join(memDir, "auto"), { recursive: true });
  files.push("memory/");

  // developer_instructions: everything the agent carries, in the order Codex would present it.
  const parts: string[] = [`# Agent: ${opts.agentName}\n\nYou are running as the ASP agent ${opts.agentName}. These are your standing instructions, carried in your agent package.`];
  for (const i of harness.instructions) {
    const src = join(h, i.path);
    if (i.scope !== "user" && (i.name === "AGENTS.md" || i.name === "AGENTS.override.md")) {
      const inProject = join(project, i.name);
      if (existsSync(inProject) && sha256File(inProject) === sha256File(src)) {
        notes.push(`skipped ${i.name}: Codex already loads the project's copy`);
        continue;
      }
    }
    const text = readFileSync(src, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    parts.push(`## ${i.name}${i.applies_to ? ` (applies only when working on files matching ${i.applies_to.join(", ")})` : ""}\n\n${text}`);
  }
  if (harness.instructions.some((i) => i.applies_to)) notes.push("path-scoped rules are in the prompt with their globs; Codex has no per-file rule loading");

  if (harness.skills.length) {
    parts.push([
      "## Your skills",
      "A skill is a set of local instructions stored in a `SKILL.md` file. When a task matches a skill's description, open its file and follow it.",
      ...harness.skills.map((s) => `- ${s.name}: ${s.description ?? "(no description)"} (file: ${posix(join(lib, "skills", s.name, "SKILL.md"))})`),
    ].join("\n"));
  }
  if (harness.commands.length) {
    parts.push([
      "## Your commands",
      "When the user asks for one of these by name (e.g. `/ship`), open its file and follow it.",
      ...harness.commands.map((c) => `- /${c.name}${c.description ? `: ${c.description}` : ""} (file: ${posix(join(lib, c.path))})`),
    ].join("\n"));
  }
  if (harness.subagents.length) {
    parts.push([
      "## Your subagent roles",
      "These are specialist roles you can delegate to, or adopt yourself when delegation is unavailable. Each file holds the role's instructions.",
      ...harness.subagents.map((a) => `- ${a.name}${a.description ? `: ${a.description}` : ""} (file: ${posix(join(lib, a.path))})`),
    ].join("\n"));
  }
  if (harness.permissions.deny.length || harness.permissions.ask.length) {
    parts.push([
      "## Limits set by your principal",
      ...harness.permissions.deny.map((r) => `- Never: ${r}`),
      ...harness.permissions.ask.map((r) => `- Ask the user first: ${r}`),
    ].join("\n"));
    notes.push("permission rules are stated in the prompt; Codex enforces only its sandbox and approval policy");
  }
  const index = join(memDir, "auto", "MEMORY.md");
  parts.push([
    "## Your memory",
    `Your memory lives in ${posix(join(memDir, "auto"))}. MEMORY.md is its index; each entry links a topic file.`,
    "When you learn something durable about this project or your principal's preferences, write or update a topic file there and add a one-line pointer to MEMORY.md. Never store secrets.",
    existsSync(index) ? `The index:\n\n${readFileSync(index, "utf8").trim()}` : "The index is empty.",
  ].join("\n\n"));

  const instructions = parts.join("\n\n") + "\n";
  writeFileSync(join(runDir, "instructions.md"), instructions);
  files.push("instructions.md");
  const developer = instructions.length <= MAX_INLINE_INSTRUCTIONS
    ? instructions
    : `# Agent: ${opts.agentName}\n\nYour standing instructions are too long to inline. Before doing anything else, read ${posix(join(runDir, "instructions.md"))} in full and follow it.`;
  if (developer !== instructions) notes.push(`instructions exceed ${MAX_INLINE_INSTRUCTIONS} characters; the prompt points at instructions.md instead`);

  // Config overrides. Secrets are passed by env var name; values go only into the child's environment.
  const overrides: [string, unknown][] = [["developer_instructions", developer]];
  const env: Record<string, string> = {};
  const missing = new Set<string>();
  const need = (name: string, as = name) => {
    const v = opts.env[name];
    if (v === undefined) missing.add(name);
    else env[as] = v;
  };
  for (const [name, s] of Object.entries(harness.mcp_servers)) {
    const key = `mcp_servers.${bareKey(name)}`;
    if (s.command) overrides.push([`${key}.command`, s.command]);
    if (s.args) overrides.push([`${key}.args`, s.args]);
    if (s.url) overrides.push([`${key}.url`, s.url]);
    const envVars: string[] = [];
    const literalEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.env ?? {})) {
      if (typeof v === "string") literalEnv[k] = v;
      else { need(v.$secret, k); envVars.push(k); }
    }
    if (Object.keys(literalEnv).length) overrides.push([`${key}.env`, literalEnv]);
    if (envVars.length) overrides.push([`${key}.env_vars`, envVars]);
    const literalHeaders: Record<string, string> = {};
    const envHeaders: Record<string, string> = {};
    for (const [hname, v] of Object.entries(s.headers ?? {})) {
      if (typeof v === "string") literalHeaders[hname] = v;
      else { const as = envName("ASP", name, hname); need(v.$secret, as); envHeaders[hname] = as; }
    }
    if (Object.keys(literalHeaders).length) overrides.push([`${key}.http_headers`, literalHeaders]);
    if (Object.keys(envHeaders).length) overrides.push([`${key}.env_http_headers`, envHeaders]);
    if (typeof s.bearer_token_env_var === "string") { need(s.bearer_token_env_var); overrides.push([`${key}.bearer_token_env_var`, s.bearer_token_env_var]); }
    if (s.enabled === false) overrides.push([`${key}.enabled`, false]);
  }
  Object.assign(env, resolveSecrets(harness.env, opts.env).values);
  for (const k of Object.keys(harness.env)) if (!(k in env)) missing.add((harness.env[k] as any).$secret ?? k);

  const specific = (harness.runtime_specific?.[RUNTIME] ?? {}) as { sandbox_mode?: string; approval_policy?: string; rules?: string[] };
  if (specific.approval_policy) overrides.push(["approval_policy", specific.approval_policy]);
  if (specific.rules?.length) notes.push("the agent's execpolicy .rules files are not loaded (Codex reads them only from the project and $CODEX_HOME)");
  if (Object.keys(harness.hooks).length) notes.push("hooks are not carried to Codex yet: Codex runs only hooks you have reviewed and trusted");
  const writes = harness.permissions.allow.some((r) => /^(Edit|Write|MultiEdit|NotebookEdit)\b/.test(r));
  const sandbox = specific.sandbox_mode ?? (harness.permissions.allow.length === 0 || writes ? "workspace-write" : "read-only");

  const model = opts.model ?? (opts.sourceRuntime === RUNTIME ? harness.model : undefined);
  if (!opts.model && harness.model && opts.sourceRuntime !== RUNTIME) notes.push(`not using the packed model ${harness.model} (a ${opts.sourceRuntime} model); Codex uses its default unless you pass --model`);

  if (opts.endpoint && !model) notes.push("--endpoint has no effect without --model");
  if (model && opts.endpoint) {
    const p = "model_providers.asp_open";
    overrides.push(["model_provider", "asp_open"], [`${p}.name`, "ASP open-weight endpoint"], [`${p}.base_url`, opts.endpoint], [`${p}.wire_api`, "responses"]);
    if (opts.apiKeyEnv) { need(opts.apiKeyEnv); overrides.push([`${p}.env_key`, opts.apiKeyEnv]); }
    notes.push(`model served from ${opts.endpoint} through a custom Codex provider (Responses API; current Codex no longer supports chat completions)`);
  }

  const { command, prefix } = resolveCodexCommand(opts.env);
  const args = [...prefix];
  if (opts.prompt !== undefined) args.push("exec", "--json");
  args.push("-C", project, "-s", sandbox, "--add-dir", memDir);
  if (model) args.push("-m", model);
  for (const [k, v] of overrides) args.push("-c", `${k}=${tomlValue(v)}`);
  if (opts.prompt !== undefined) args.push(opts.prompt);

  return {
    command, args, cwd: project, env, files, runDir, memoryDir: memDir, missingSecrets: [...missing].sort(), notes,
    ...(opts.prompt !== undefined ? { checkOutputForAction: codexActionParser() } : {}),
  };
}

export const codex: RuntimeAdapter = { name: RUNTIME, capture, materialize };
