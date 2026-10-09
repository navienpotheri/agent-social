/**
 * Claude Code adapter.
 *
 * capture: reads the agent's "self" from a project and (optionally) the user's ~/.claude:
 *   CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/rules/**, skills, agents,
 *   commands, output styles, settings (permissions, hooks, env, model), .mcp.json, auto memory
 *   (~/.claude/projects/<project>/memory) and a metadata-only index of session transcripts.
 * materialize: never writes into the project. Under the run dir it builds a session-only plugin
 *   (subagents, commands, hooks, MCP, and a hook that gates path-scoped rules), a workspace whose
 *   .claude/skills loads via --add-dir (so skills keep their names), an appended system prompt, and a
 *   settings file whose autoMemoryDirectory points Claude Code's own memory at the run's copy of the
 *   package memory, so the CLI can write changes back.
 *
 * File locations follow https://code.claude.com/docs/en/claude-directory (checked 2026-09-27).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyInto, listFiles, readJsonIfExists, sha256File, writeJson } from "../files.ts";
import { asList, frontmatter } from "../frontmatter.ts";
import type { Capture, Component, Harness, LaunchPlan, McpServer, RuntimeAdapter, SessionSummary } from "../harness.ts";
import { sha256Id } from "@agent-social/asp-core";
import { NO_SCOPE_TOOLS, deriveScopeForTool, isOwnMemoryWrite } from "../package.ts";
import { shellArtifact } from "./codex-actions.ts";
import { resolveSecrets, stripSecrets, toEnvRefs, type Env } from "../secrets.ts";

export const RUNTIME = "claude-code";

/** Claude Code names a project's data dir after its path with every non-alphanumeric character as "-". */
export function projectSlug(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, "-");
}

/** The ~/.claude/projects/<slug> dir for a project. Long paths are truncated by Claude Code, so fall back to a prefix match. */
export function findProjectDataDir(claudeDir: string, projectPath: string): { dir?: string; fuzzy: boolean } {
  const projects = join(claudeDir, "projects");
  const slug = projectSlug(projectPath);
  if (existsSync(join(projects, slug))) return { dir: join(projects, slug), fuzzy: false };
  if (!existsSync(projects)) return { fuzzy: false };
  const prefix = slug.slice(0, 120);
  const matches = readdirSync(projects).filter((d) => slug.length > 120 && d.startsWith(prefix));
  return matches.length === 1 ? { dir: join(projects, matches[0]), fuzzy: true } : { fuzzy: false };
}

interface Settings {
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[]; defaultMode?: string };
  hooks?: Record<string, unknown[]>;
  env?: Record<string, string>;
  model?: string;
}

function mergeSettings(layers: (Settings | undefined)[]) {
  const permissions = { allow: [] as string[], deny: [] as string[], ask: [] as string[], default_mode: undefined as string | undefined };
  const hooks: Record<string, unknown[]> = {};
  const env: Record<string, string> = {};
  let model: string | undefined;
  for (const s of layers) {
    if (!s) continue;
    for (const k of ["allow", "deny", "ask"] as const) {
      for (const rule of s.permissions?.[k] ?? []) if (!permissions[k].includes(rule)) permissions[k].push(rule);
    }
    if (s.permissions?.defaultMode) permissions.default_mode = s.permissions.defaultMode;
    for (const [event, entries] of Object.entries(s.hooks ?? {})) hooks[event] = [...(hooks[event] ?? []), ...entries];
    Object.assign(env, s.env ?? {});
    if (s.model) model = s.model;
  }
  if (!permissions.default_mode) delete permissions.default_mode;
  return { permissions, hooks, env, model };
}

function stripServer(server: McpServer, secrets: Set<string>): McpServer {
  const out: McpServer = { ...server };
  if (server.env) out.env = stripSecrets(server.env as Record<string, string>, secrets);
  if (server.headers) out.headers = stripSecrets(server.headers as Record<string, string>, secrets);
  return out;
}

/** Metadata-only summary of one transcript: counts and timestamps, never message content. */
export function summarizeTranscript(file: string): SessionSummary {
  const s: SessionSummary = {
    session: basename(file, ".jsonl"), runtime: RUNTIME, models: [], prompts: 0, assistant_turns: 0,
    tool_calls: {}, tool_errors: 0, output_tokens: 0,
  };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (typeof o.timestamp === "string") {
      s.started_at ??= o.timestamp;
      s.ended_at = o.timestamp;
    }
    if (typeof o.version === "string") s.runtime_version = o.version;
    const content = o.message?.content;
    if (o.type === "user") {
      if (typeof content === "string") s.prompts++;
      else if (Array.isArray(content)) {
        if (content.some((b: any) => b.type === "text")) s.prompts++;
        s.tool_errors += content.filter((b: any) => b.type === "tool_result" && b.is_error).length;
      }
    } else if (o.type === "assistant") {
      s.assistant_turns++;
      const model = o.message?.model;
      if (model && !s.models.includes(model)) s.models.push(model);
      s.output_tokens += o.message?.usage?.output_tokens ?? 0;
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === "tool_use") s.tool_calls[b.name] = (s.tool_calls[b.name] ?? 0) + 1;
      }
    }
  }
  return s;
}

const mdFiles = (dir: string) => listFiles(dir).filter((f) => f.endsWith(".md"));

async function capture(opts: { project: string; includeUser: boolean; home?: string; staging: string }): Promise<Capture> {
  const { project, includeUser, staging } = opts;
  const claudeDir = join(opts.home ?? homedir(), ".claude");
  const hdir = join(staging, "harness");
  const warnings: string[] = [];
  const secrets = new Set<string>();
  const harness: Harness = {
    format: "asp.harness/v0.1", instructions: [], skills: [], subagents: [], commands: [],
    hooks: {}, mcp_servers: {}, permissions: { allow: [], deny: [], ask: [] }, env: {},
  };

  // Instructions, in Claude Code's load order: user, project, local, rules.
  let n = 0;
  const addInstruction = (src: string, name: string, scope: Harness["instructions"][number]["scope"]) => {
    if (!existsSync(src)) return;
    const path = `instructions/${String(n++).padStart(2, "0")}-${name.replace(/[\\/]/g, "__")}`;
    copyInto(src, join(hdir, path));
    const applies = asList(frontmatter(readFileSync(src, "utf8")).paths);
    harness.instructions.push({ name, scope, path, ...(applies ? { applies_to: applies } : {}) });
  };
  if (includeUser) {
    addInstruction(join(claudeDir, "CLAUDE.md"), "CLAUDE.md", "user");
    for (const f of mdFiles(join(claudeDir, "rules"))) addInstruction(join(claudeDir, "rules", f), `rules/${f}`, "user");
  }
  addInstruction(join(project, "CLAUDE.md"), "CLAUDE.md", "project");
  addInstruction(join(project, ".claude", "CLAUDE.md"), ".claude/CLAUDE.md", "project");
  addInstruction(join(project, "AGENTS.md"), "AGENTS.md", "project");
  addInstruction(join(project, "CLAUDE.local.md"), "CLAUDE.local.md", "local");
  for (const f of mdFiles(join(project, ".claude", "rules"))) addInstruction(join(project, ".claude", "rules", f), `rules/${f}`, "rules");

  // Skills (a directory each), subagents, commands. Project wins on a name clash.
  const roots: [string, "project" | "user"][] = [[join(project, ".claude"), "project"]];
  if (includeUser) roots.push([claudeDir, "user"]);
  const seen = { skills: new Set<string>(), subagents: new Set<string>(), commands: new Set<string>() };
  for (const [root, scope] of roots) {
    const skillsDir = join(root, "skills");
    for (const name of existsSync(skillsDir) ? readdirSync(skillsDir).sort() : []) {
      const dir = join(skillsDir, name);
      if (!statSync(dir).isDirectory() || !existsSync(join(dir, "SKILL.md")) || name.startsWith(".")) continue;
      if (seen.skills.has(name)) { warnings.push(`skipped ${scope} skill "${name}": a project skill has the same name`); continue; }
      seen.skills.add(name);
      copyInto(dir, join(hdir, "skills", name));
      const fm = frontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
      harness.skills.push(component(name, fm, `skills/${name}`, scope));
    }
    for (const [kind, sub] of [["subagents", "agents"], ["commands", "commands"]] as const) {
      for (const f of mdFiles(join(root, sub))) {
        const name = f.replace(/\.md$/, "");
        if (seen[kind].has(name)) { warnings.push(`skipped ${scope} ${kind} "${name}": a project one has the same name`); continue; }
        seen[kind].add(name);
        copyInto(join(root, sub, f), join(hdir, sub, f));
        const fm = frontmatter(readFileSync(join(root, sub, f), "utf8"));
        harness[kind].push(component(name, fm, `${sub}/${f}`, scope));
      }
    }
  }

  // Output styles have no neutral form yet.
  const styles: string[] = [];
  for (const [root] of roots) {
    for (const f of mdFiles(join(root, "output-styles"))) {
      copyInto(join(root, "output-styles", f), join(hdir, "claude-code", "output-styles", f));
      styles.push(`claude-code/output-styles/${f}`);
    }
  }
  if (styles.length) harness.runtime_specific = { [RUNTIME]: { output_styles: styles } };

  // Settings: user < project < local.
  const merged = mergeSettings([
    includeUser ? readJsonIfExists<Settings>(join(claudeDir, "settings.json")) : undefined,
    readJsonIfExists<Settings>(join(project, ".claude", "settings.json")),
    readJsonIfExists<Settings>(join(project, ".claude", "settings.local.json")),
  ]);
  harness.permissions = merged.permissions;
  harness.hooks = merged.hooks;
  harness.env = stripSecrets(merged.env, secrets);
  if (merged.model) harness.model = merged.model;

  // MCP servers: project .mcp.json; with --include-user also ~/.claude.json (user and this project's local servers).
  const mcp: Record<string, McpServer> = {};
  if (includeUser) {
    // ~/.claude.json also holds OAuth tokens: read only the mcpServers entries.
    const global = readJsonIfExists<any>(join(opts.home ?? homedir(), ".claude.json"));
    Object.assign(mcp, global?.mcpServers ?? {}, global?.projects?.[project]?.mcpServers ?? {});
  }
  Object.assign(mcp, readJsonIfExists<any>(join(project, ".mcp.json"))?.mcpServers ?? {});
  for (const [name, server] of Object.entries(mcp)) harness.mcp_servers[name] = stripServer(server, secrets);
  if (secrets.size) harness.secrets = [...secrets].sort();

  // Memory: Claude Code's auto memory for this project, plus project subagent memory.
  const { dir: dataDir, fuzzy } = findProjectDataDir(claudeDir, project);
  if (fuzzy) warnings.push(`matched the project's Claude Code data dir by prefix: ${dataDir}`);
  if (dataDir && existsSync(join(dataDir, "memory"))) copyInto(join(dataDir, "memory"), join(staging, "memory", "auto"));
  if (existsSync(join(project, ".claude", "agent-memory"))) copyInto(join(project, ".claude", "agent-memory"), join(staging, "memory", "agent-memory"));
  mkdirSync(join(staging, "memory"), { recursive: true });

  // Experience: metadata-only index of this project's sessions.
  const sessions = dataDir ? readdirSync(dataDir).filter((f) => f.endsWith(".jsonl")).sort().map((f) => summarizeTranscript(join(dataDir, f))) : [];
  sessions.sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
  mkdirSync(join(staging, "experience"), { recursive: true });
  writeFileSync(join(staging, "experience", "sessions.ndjson"), sessions.map((s) => JSON.stringify(s)).join("\n") + (sessions.length ? "\n" : ""));

  writeJson(join(hdir, "harness.json"), harness);

  const latest = sessions.at(-1);
  const modelCounts = new Map<string, number>();
  for (const s of sessions) for (const m of s.models) modelCounts.set(m, (modelCounts.get(m) ?? 0) + s.assistant_turns);
  const topModel = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    dir: staging, harness, sessions: sessions.length, warnings,
    runtime: { name: RUNTIME, version: latest?.runtime_version, model: harness.model ?? topModel },
  };
}

function component(name: string, fm: Record<string, string | string[]>, path: string, scope: "project" | "user"): Component {
  const description = typeof fm.description === "string" ? fm.description : undefined;
  return { name, path, scope, ...(description ? { description } : {}) };
}

const pluginName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asp-agent";

async function materialize(opts: {
  pkgDir: string; harness: Harness; project: string; runDir: string; agentName: string; prompt?: string; env: NodeJS.ProcessEnv;
  model?: string; sourceRuntime?: string; mandateScopes?: string[];
  mandateGate?: { scopes: string[]; mode: "ask" | "deny"; waitSeconds: number };
  mandateKnownBad?: { fingerprint: string; report: string }[];
}): Promise<LaunchPlan> {
  const { pkgDir, harness, project, runDir } = opts;
  const h = join(pkgDir, "harness");
  const plugin = join(runDir, "plugin");
  const workspace = join(runDir, "workspace");
  const name = pluginName(opts.agentName);
  const notes: string[] = [];
  const files: string[] = [];
  const put = (rel: string, write: () => void) => { write(); files.push(rel); };

  // Plugin: subagents, commands, output styles, hooks and MCP servers.
  put("plugin/.claude-plugin/plugin.json", () => writeJson(join(plugin, ".claude-plugin", "plugin.json"), {
    name, version: "0.0.0-asp", description: `ASP agent ${opts.agentName}, materialized from an agent package`,
  }));
  for (const a of harness.subagents) put(`plugin/${a.path}`, () => copyInto(join(h, a.path), join(plugin, a.path)));
  for (const c of harness.commands) put(`plugin/${c.path}`, () => copyInto(join(h, c.path), join(plugin, c.path)));
  const styles = ((harness.runtime_specific?.[RUNTIME] as any)?.output_styles ?? []) as string[];
  for (const s of styles) put(`plugin/output-styles/${basename(s)}`, () => copyInto(join(h, s), join(plugin, "output-styles", basename(s))));
  if (harness.subagents.length || harness.commands.length) notes.push(`subagents and commands load namespaced as "${name}:<name>"`);

  // Skills: a workspace dir added with --add-dir, so they keep their own names.
  for (const s of harness.skills) put(`workspace/.claude/skills/${s.name}`, () => copyInto(join(h, s.path), join(workspace, ".claude", "skills", s.name)));

  // Instructions: one appended system prompt. Path-scoped rules are gated by a hook instead.
  const skip = (i: Harness["instructions"][number]) => {
    const inProject = i.scope === "rules" ? join(project, ".claude", i.name) : i.scope === "user" ? undefined : join(project, i.name);
    if (inProject && existsSync(inProject) && sha256File(inProject) === sha256File(join(h, i.path))) {
      notes.push(`skipped ${i.name}: the project already has the same file`);
      return true;
    }
    return false;
  };
  const parts: string[] = [`# Agent: ${opts.agentName}\n\nYou are running as the ASP agent ${opts.agentName}. These are your standing instructions, carried in your agent package.`];
  const scoped: { name: string; globs: string[]; text: string }[] = [];
  for (const i of harness.instructions) {
    if (skip(i)) continue;
    const text = stripFrontmatter(readFileSync(join(h, i.path), "utf8"));
    if (i.applies_to?.length) scoped.push({ name: i.name, globs: i.applies_to, text });
    else parts.push(`## ${i.name}\n\n${text}`);
  }
  put("instructions.md", () => writeFileSync(join(runDir, "instructions.md"), parts.join("\n\n") + "\n"));

  const hooks = structuredClone(harness.hooks) as Record<string, unknown[]>;
  if (scoped.length) {
    put("plugin/asp-rules.json", () => writeJson(join(plugin, "asp-rules.json"), scoped));
    put("plugin/scripts/asp-rules.mjs", () => copyInto(RULES_HOOK, join(plugin, "scripts", "asp-rules.mjs")));
    hooks.PreToolUse = [...(hooks.PreToolUse ?? []), {
      matcher: "Read|Edit|Write|MultiEdit|NotebookEdit",
      hooks: [{ type: "command", command: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/asp-rules.mjs"` }],
    }];
    notes.push(`${scoped.length} path-scoped rule(s) load when the agent first touches a matching file`);
  }
  if (opts.mandateScopes) {
    // The pre-call half of the kill switch: block any call whose scope the Mandate doesn't grant,
    // before it runs. Listed first; Claude Code runs every PreToolUse hook and any block wins.
    const gate = opts.mandateGate && opts.mandateGate.scopes.length ? opts.mandateGate : undefined;
    put("plugin/asp-mandate.json", () => writeJson(join(plugin, "asp-mandate.json"), {
      scopes: [...opts.mandateScopes!].sort(),
      memoryDir: join(runDir, "memory"),
      ...(opts.mandateKnownBad?.length ? { knownBad: opts.mandateKnownBad } : {}),
      ...(gate ? { gate: { scopes: [...gate.scopes].sort(), mode: gate.mode, waitSeconds: gate.waitSeconds } } : {}),
    }));
    put("plugin/scripts/asp-mandate.mjs", () => copyInto(MANDATE_HOOK, join(plugin, "scripts", "asp-mandate.mjs")));
    // The same script records which calls actually ran (post-call events), so a call the runtime's own
    // permissions refused is never mistaken for one that ran.
    const record = { matcher: "*", hooks: [{ type: "command", command: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/asp-mandate.mjs"`, timeout: 10 }] };
    hooks.PostToolUse = [record, ...(hooks.PostToolUse ?? [])];
    hooks.PostToolUseFailure = [record, ...(hooks.PostToolUseFailure ?? [])];
    hooks.PreToolUse = [{
      matcher: "*",
      hooks: [{ type: "command", command: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/asp-mandate.mjs"`, timeout: gate?.mode === "ask" ? gate.waitSeconds + 30 : 10 }],
    }, ...(hooks.PreToolUse ?? [])];
    if (gate) notes.push(`${gate.mode === "ask" ? "approval needed from the principal" : "forbidden by the Mandate"} for: ${gate.scopes.join(", ")}${gate.mode === "ask" ? ` (waits up to ${gate.waitSeconds}s per call)` : ""}`);
    notes.push(`pre-call Mandate hook active: calls outside ${opts.mandateScopes.length ? opts.mandateScopes.join(", ") : "an empty scope list"} are blocked before they run`);
  }
  if (Object.keys(hooks).length) put("plugin/hooks/hooks.json", () => writeJson(join(plugin, "hooks", "hooks.json"), { hooks }));
  if (Object.keys(harness.mcp_servers).length) {
    // Secrets stay out of files: "${NAME}" references, expanded by Claude Code from the child's environment.
    const servers = Object.fromEntries(Object.entries(harness.mcp_servers).map(([k, s]) => [k, {
      ...s, ...(s.env ? { env: toEnvRefs(s.env) } : {}), ...(s.headers ? { headers: toEnvRefs(s.headers) } : {}),
    }]));
    put("plugin/.mcp.json", () => writeJson(join(plugin, ".mcp.json"), { mcpServers: servers }));
  }

  // Memory: the package's memory becomes Claude Code's own auto memory for this run, so the agent
  // reads it natively and what it writes can be carried back into the package afterwards.
  const memDir = join(runDir, "memory");
  if (existsSync(join(pkgDir, "memory"))) copyInto(join(pkgDir, "memory"), memDir);
  mkdirSync(join(memDir, "auto"), { recursive: true });
  files.push("memory/");

  const settings: Record<string, unknown> = {
    permissions: {
      allow: harness.permissions.allow, deny: harness.permissions.deny, ask: harness.permissions.ask,
      ...(harness.permissions.default_mode ? { defaultMode: harness.permissions.default_mode } : {}),
    },
    autoMemoryEnabled: true,
    autoMemoryDirectory: join(memDir, "auto"),
  };
  const model = opts.model ?? (opts.sourceRuntime === undefined || opts.sourceRuntime === RUNTIME ? harness.model : undefined);
  if (model) settings.model = model;
  else if (harness.model) notes.push(`not using the packed model ${harness.model} (a ${opts.sourceRuntime} model); Claude Code uses its default unless you pass --model`);
  put("settings.json", () => writeJson(join(runDir, "settings.json"), settings));

  // Resolve every secret into the child's environment only.
  const env: Record<string, string> = {};
  const secretEnv: Env = {};
  for (const secret of harness.secrets ?? []) secretEnv[secret] = { $secret: secret };
  const r = resolveSecrets(secretEnv, opts.env);
  Object.assign(env, r.values, resolveSecrets(harness.env, opts.env).values);

  // ASP_CLAUDE_BIN / ASP_CLAUDE_SCRIPT let tests substitute a fake runtime.
  const command = opts.env.ASP_CLAUDE_BIN ?? "claude";
  const args: string[] = opts.env.ASP_CLAUDE_SCRIPT ? [opts.env.ASP_CLAUDE_SCRIPT] : [];
  if (opts.prompt !== undefined) args.push("-p", opts.prompt, "--output-format", "stream-json", "--verbose");
  args.push("--plugin-dir", plugin, "--append-system-prompt-file", join(runDir, "instructions.md"), "--settings", join(runDir, "settings.json"));
  if (harness.skills.length) args.push("--add-dir", workspace);

  return { command, args, cwd: project, env, files, runDir, memoryDir: memDir, missingSecrets: r.missing.sort(), notes, checkOutputForAction: (line: string) => checkOutputForAction(line, memDir), checkOutputForResult, ...(opts.mandateScopes ? { preventsCalls: true, executedCallsFile: join(runDir, "executed-calls.ndjson") } : {}),
    ...(opts.mandateScopes && opts.mandateGate?.mode === "ask" && opts.mandateGate.scopes.length ? { approvalsDir: join(runDir, "approvals") } : {}) };
}

/**
 * The compliance bridge (docs/backlog.md): `--output-format stream-json` (already used for
 * `-p` runs) emits one JSON object per line, in the same shape as the session JSONL
 * `summarizeTranscript` reads at pack time — so a live tool_use block is detectable the same way,
 * as it happens, not just after the fact from a finished transcript.
 */
function checkOutputForAction(line: string, memoryDir?: string): { id?: string; scope: string; artifact?: { uri: string; sha256: string } }[] | undefined {
  let o: any;
  try { o = JSON.parse(line); } catch { return undefined; }
  if (o.type !== "assistant" || !Array.isArray(o.message?.content)) return undefined;
  const calls = o.message.content.filter((b: any) => b.type === "tool_use" && !NO_SCOPE_TOOLS.includes(b.name) && !isOwnMemoryWrite(b.name, b.input, memoryDir));
  if (!calls.length) return undefined;
  return calls.map((b: any) => {
    const arg = typeof b.input?.command === "string" ? b.input.command : "";
    const inputJson = JSON.stringify(b.input ?? {});
    return {
      ...(typeof b.id === "string" ? { id: b.id } : {}),
      scope: deriveScopeForTool(b.name, arg),
      artifact: (b.name === "Bash" || b.name === "PowerShell") && arg ? shellArtifact(arg) : { uri: `asp://tool-call/${b.name}`, sha256: sha256Id(new TextEncoder().encode(inputJson)) },
    };
  });
}

/**
 * A tool_use's outcome, from the `tool_result` that answers it. The pre-call Mandate hook's refusal
 * comes back as that result, carrying its own "ASP Mandate" text; anything else means the call ran.
 */
function checkOutputForResult(line: string): { id: string; blocked: boolean }[] | undefined {
  if (!line.includes("tool_result")) return undefined;
  let o: any;
  try { o = JSON.parse(line); } catch { return undefined; }
  if (o.type !== "user" || !Array.isArray(o.message?.content)) return undefined;
  const out = o.message.content.filter((b: any) => b.type === "tool_result" && typeof b.tool_use_id === "string").map((b: any) => {
    const text = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((c: any) => c?.text ?? "").join(" ") : "";
    return { id: b.tool_use_id as string, blocked: text.includes("ASP Mandate") };
  });
  return out.length ? out : undefined;
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

const RULES_HOOK = fileURLToPath(new URL("./claude-code-rules-hook.mjs", import.meta.url));
const MANDATE_HOOK = fileURLToPath(new URL("./claude-code-mandate-hook.mjs", import.meta.url));

export const claudeCode: RuntimeAdapter = { name: RUNTIME, capture, materialize };
