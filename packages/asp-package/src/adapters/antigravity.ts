/**
 * Google Antigravity CLI adapter (`agy`).
 *
 * Built 2026-10-08 from the public docs (https://antigravity.google/docs/cli/headless, /docs/rules, /docs/skills,
 * /docs/permissions, /docs/hooks) and fake-runtime tests. NOT yet run against a real `agy`: tool names and parameter
 * names below are the documented ones plus guesses, to be confirmed on the first live run (docs/live-run-checklist.md).
 *
 * capture: instruction files (AGENTS.md, GEMINI.md, .agents/AGENTS.md, .agents/GEMINI.md), rules (.agents/rules/*.md,
 *   legacy .agent/rules), skills (.agents/skills, legacy .agent/skills); with --include-user also the user's
 *   ~/.gemini/{AGENTS.md,GEMINI.md,config,antigravity-cli} copies of those.
 * materialize: never writes into the project or ~/.gemini. The packed instructions that the project does not already
 *   carry, the skill list and the memory location go in front of the task in the prompt; agy runs in the project
 *   directory in print mode (`-p`) with `--output-format stream-json`, which is what the compliance bridge reads.
 *   Headless agy soft-denies shell commands unless they are pre-approved, so by default it can read and write the
 *   workspace and nothing more; ASP_ANTIGRAVITY_ARGS adds flags (for example `--dangerously-skip-permissions`) for a
 *   run you trust.
 *
 * No pre-call hook yet: agy documents PreToolUse hooks, but only in the workspace's .agents/hooks.json or the user's
 * config, both of which this adapter must not write, and the docs do not say hooks run under `-p`. Until that is
 * checked live, out-of-scope calls are detected and the run stopped, as with Codex.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sha256Id } from "@agent-social/asp-core";
import { copyInto, sha256File, toPosix, writeJson } from "../files.ts";
import { frontmatter } from "../frontmatter.ts";
import type { Capture, Harness, LaunchPlan, RuntimeAdapter } from "../harness.ts";
import { deriveScopeForTool } from "../package.ts";
import { scopeForShellCommand } from "./codex-actions.ts";

export const RUNTIME = "antigravity";

const CONTEXT_FILES = ["AGENTS.md", "GEMINI.md", join(".agents", "AGENTS.md"), join(".agents", "GEMINI.md")];

// ---------- the compliance bridge ----------

const READ_TOOLS = new Set(["view_file", "view_file_outline", "view_code_item", "read_file", "list_dir", "grep_search", "find_by_name", "codebase_search", "search_files", "list_directory"]);
const WRITE_TOOLS = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content", "write_file", "edit_file", "create_file", "delete_file", "apply_patch"]);
const WEB_TOOLS = new Set(["read_url_content", "search_web"]);
/** The agent's own bookkeeping and conversation with the user: touches nothing, never a scope. */
const NO_SCOPE_TOOLS = new Set(["task_boundary", "notify_user", "ask_user", "todo_write", "update_plan", "finish", "think"]);

/** The scope of one agy tool call, or undefined for the agent's own bookkeeping. */
export function scopeForAgyTool(name: string, params: Record<string, unknown> = {}): string | undefined {
  if (NO_SCOPE_TOOLS.has(name)) return undefined;
  if (name === "run_command" || name === "command") {
    const cmd = params.CommandLine ?? params.command ?? params.command_line ?? params.cmd;
    return scopeForShellCommand(typeof cmd === "string" ? cmd : "");
  }
  if (READ_TOOLS.has(name)) return "repo.read";
  if (WRITE_TOOLS.has(name)) return "repo.write";
  if (WEB_TOOLS.has(name)) return "web.read";
  if (name.startsWith("mcp_") || name.startsWith("mcp__")) return deriveScopeForTool(name.startsWith("mcp__") ? name : `mcp__${name.slice(4).replace(/_/, "__")}`, "");
  return `tool.${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
}

/** Per-run parser for `agy -p --output-format stream-json`: one call per tool step, reported when it starts. */
export function agyActionParser(): (line: string) => { id?: string; scope: string; artifact?: { uri: string; sha256: string } }[] | undefined {
  const seen = new Set<string>();
  return (line) => {
    if (!line.includes("step_update")) return undefined;
    let o: any;
    try { o = JSON.parse(line); } catch { return undefined; }
    if (o?.type !== "step_update") return undefined;
    const p = o.payload ?? o;
    if (p.step_type !== "tool") return undefined;
    const info = p.tool_info ?? {};
    const name: string | undefined = info.name ?? p.tool_name;
    if (typeof name !== "string") return undefined;
    const id = p.step_index !== undefined ? `step-${p.step_index}` : undefined;
    if (id && seen.has(id)) return undefined;
    const params = (info.parameters && typeof info.parameters === "object" ? info.parameters : {}) as Record<string, unknown>;
    const scope = scopeForAgyTool(name, params);
    if (id) seen.add(id);
    if (!scope) return undefined;
    return [{ ...(id ? { id } : {}), scope, artifact: { uri: `asp://tool-call/${name}`, sha256: sha256Id(new TextEncoder().encode(JSON.stringify(params))) } }];
  };
}

/** `agy` can exit 0 on some failures; the final result event carries the status. */
export function agyFailure(line: string): string | undefined {
  if (!line.includes('"result"')) return undefined;
  let o: any;
  try { o = JSON.parse(line); } catch { return undefined; }
  if (o?.type !== "result") return undefined;
  const r = o.payload ?? o;
  if (r.status === "ERROR" || r.status === "INVALID") return `agy reported ${r.status}${r.error ? `: ${typeof r.error === "string" ? r.error : r.error.message ?? JSON.stringify(r.error)}` : ""}`;
  return undefined;
}

// ---------- capture ----------

async function capture(opts: { project: string; includeUser: boolean; home?: string; staging: string }): Promise<Capture> {
  const { project, includeUser, staging } = opts;
  const home = opts.home ?? homedir();
  const hdir = join(staging, "harness");
  const warnings: string[] = [];
  const harness: Harness = {
    format: "asp.harness/v0.1", instructions: [], skills: [], subagents: [], commands: [],
    hooks: {}, mcp_servers: {}, permissions: { allow: [], deny: [], ask: [] }, env: {},
  };
  let n = 0;
  const addInstruction = (src: string, name: string, scope: Harness["instructions"][number]["scope"]) => {
    const path = `instructions/${String(n++).padStart(2, "0")}-${name.replace(/[\\/]/g, "__")}`;
    copyInto(src, join(hdir, path));
    harness.instructions.push({ name, scope, path });
  };
  const seen = new Set<string>();
  const addSkills = (dir: string, scope: "project" | "user") => {
    for (const e of existsSync(dir) ? readdirSync(dir).sort() : []) {
      const p = join(dir, e);
      if (e.startsWith(".") || !statSync(p).isDirectory() || !existsSync(join(p, "SKILL.md"))) continue;
      if (seen.has(e)) { warnings.push(`skipped ${scope} skill "${e}": another skill has the same name`); continue; }
      seen.add(e);
      copyInto(p, join(hdir, "skills", e));
      const fm = frontmatter(readFileSync(join(p, "SKILL.md"), "utf8"));
      harness.skills.push({ name: e, path: `skills/${e}`, scope, ...(typeof fm.description === "string" ? { description: fm.description } : {}) });
    }
  };
  const addRules = (dir: string, scope: "project" | "user") => {
    for (const e of existsSync(dir) ? readdirSync(dir).sort() : []) {
      const p = join(dir, e);
      if (e.endsWith(".md") && statSync(p).isFile()) addInstruction(p, `rules/${e}`, scope === "user" ? "user" : "rules");
    }
  };

  for (const f of CONTEXT_FILES) if (existsSync(join(project, f))) addInstruction(join(project, f), f, "project");
  for (const d of [".agents", ".agent"]) { addRules(join(project, d, "rules"), "project"); addSkills(join(project, d, "skills"), "project"); }
  if (existsSync(join(project, ".agents", "hooks.json"))) {
    try { harness.hooks = JSON.parse(readFileSync(join(project, ".agents", "hooks.json"), "utf8")); } catch { warnings.push("skipped .agents/hooks.json: not valid JSON"); }
  }
  if (includeUser) {
    const g = join(home, ".gemini");
    for (const f of ["AGENTS.md", "GEMINI.md", join("config", "AGENTS.md"), join("config", "GEMINI.md")]) if (existsSync(join(g, f))) addInstruction(join(g, f), f, "user");
    for (const r of [join(g, "config", "rules"), join(g, "antigravity-cli", "rules")]) addRules(r, "user");
    for (const s of [join(g, "config", "skills"), join(g, "antigravity-cli", "skills")]) addSkills(s, "user");
  }
  mkdirSync(join(staging, "memory"), { recursive: true });
  mkdirSync(join(staging, "experience"), { recursive: true });
  writeFileSync(join(staging, "experience", "sessions.ndjson"), "");
  warnings.push("Antigravity MCP servers, permission rules and sessions are not captured yet");
  writeJson(join(hdir, "harness.json"), harness);
  return { dir: staging, harness, sessions: 0, warnings, runtime: { name: RUNTIME } };
}

// ---------- materialize ----------

/** The agy executable: ASP_ANTIGRAVITY_BIN, the installer's default on Windows, else `agy` on PATH. */
export function resolveAgy(env: NodeJS.ProcessEnv): string {
  if (env.ASP_ANTIGRAVITY_BIN) return env.ASP_ANTIGRAVITY_BIN;
  const local = env.LOCALAPPDATA;
  if (local) {
    const exe = join(local, "agy", "bin", "agy.exe");
    if (existsSync(exe)) return exe;
  }
  return "agy";
}

const PREAMBLE_LIMIT = 16_000;

async function materialize(opts: {
  pkgDir: string; harness: Harness; project: string; runDir: string; agentName: string; prompt?: string;
  env: NodeJS.ProcessEnv; model?: string; sourceRuntime?: string;
}): Promise<LaunchPlan> {
  const { pkgDir, harness, project, runDir } = opts;
  const h = join(pkgDir, "harness");
  const notes: string[] = [];
  const files: string[] = [];
  const lib = join(runDir, "agent");
  for (const s of harness.skills) copyInto(join(h, s.path), join(lib, "skills", s.name));
  if (harness.skills.length) files.push("agent/");
  const memDir = join(runDir, "memory");
  if (existsSync(join(pkgDir, "memory"))) copyInto(join(pkgDir, "memory"), memDir);
  mkdirSync(join(memDir, "auto"), { recursive: true });
  files.push("memory/");

  const parts: string[] = [`# Agent: ${opts.agentName}\n\nYou are running as the ASP agent ${opts.agentName}. These are your standing instructions, carried in your agent package.`];
  for (const i of harness.instructions) {
    const src = join(h, i.path);
    // The project's own AGENTS.md / GEMINI.md is loaded by agy itself.
    if (i.scope === "project" && !i.name.startsWith("rules/")) {
      const inProject = join(project, i.name);
      if (existsSync(inProject) && sha256File(inProject) === sha256File(src)) { notes.push(`skipped ${i.name}: Antigravity already loads the project's copy`); continue; }
    }
    if (i.scope === "rules" && existsSync(join(project, ".agents", i.name)) && sha256File(join(project, ".agents", i.name)) === sha256File(src)) {
      notes.push(`skipped ${i.name}: Antigravity already loads the project's copy`); continue;
    }
    parts.push(`## ${i.name}\n\n${readFileSync(src, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()}`);
  }
  const projectSkills = new Set(["project"]);
  const carried = harness.skills.filter((s) => !(projectSkills.has(s.scope ?? "") && existsSync(join(project, ".agents", "skills", s.name))));
  if (carried.length) {
    parts.push(["## Your skills", "A skill is a folder with a `SKILL.md`. When a task matches a skill's description, open its file and follow it.",
      ...carried.map((s) => `- ${s.name}: ${s.description ?? "(no description)"} (file: ${toPosix(join(lib, "skills", s.name, "SKILL.md"))})`)].join("\n"));
  }
  const index = join(memDir, "auto", "MEMORY.md");
  parts.push([
    "## Your memory",
    `Your memory lives in ${toPosix(join(memDir, "auto"))}. MEMORY.md is its index. Write durable lessons there if you are able to; never store secrets.`,
    existsSync(index) ? `The index:\n\n${readFileSync(index, "utf8").trim()}` : "The index is empty.",
  ].join("\n"));
  let preamble = parts.join("\n\n");
  if (preamble.length > PREAMBLE_LIMIT) {
    preamble = preamble.slice(0, PREAMBLE_LIMIT) + "\n\n[the rest of the standing instructions was cut to fit the command line]";
    notes.push(`the standing instructions were cut to ${PREAMBLE_LIMIT} characters to fit the command line`);
  }
  writeFileSync(join(runDir, "instructions.md"), preamble + "\n");
  files.push("instructions.md");

  const model = opts.model;
  const extra = (opts.env.ASP_ANTIGRAVITY_ARGS ?? "").split(/\s+/).filter(Boolean);
  const args: string[] = [];
  if (opts.prompt !== undefined) {
    args.push("-p", `${preamble}\n\n---\n\nYour task:\n\n${opts.prompt}`, "--output-format", "stream-json", "--print-timeout", opts.env.ASP_ANTIGRAVITY_TIMEOUT ?? "15m");
  }
  if (model) args.push("--model", model);
  else if (harness.model && opts.sourceRuntime === RUNTIME) args.push("--model", harness.model);
  args.push(...extra);
  notes.push("headless agy soft-denies shell commands that are not pre-approved; set ASP_ANTIGRAVITY_ARGS=--dangerously-skip-permissions only for a run you trust");
  notes.push("no pre-call hook: an out-of-scope call is detected and the run stopped, not prevented");

  // ASP_ANTIGRAVITY_SCRIPT lets tests run a fake agy under node.
  const finalArgs = opts.env.ASP_ANTIGRAVITY_SCRIPT ? [opts.env.ASP_ANTIGRAVITY_SCRIPT, ...args] : args;
  return {
    command: resolveAgy(opts.env), args: finalArgs, cwd: project, env: {}, files, runDir, memoryDir: memDir, missingSecrets: [], notes,
    ...(opts.prompt !== undefined ? { checkOutputForAction: agyActionParser(), checkOutputForFailure: agyFailure } : {}),
  };
}

export const antigravity: RuntimeAdapter = { name: RUNTIME, capture, materialize };
