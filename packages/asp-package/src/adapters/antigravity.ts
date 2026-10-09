/**
 * Google Antigravity CLI adapter (`agy`).
 *
 * Built 2026-10-08 from the public docs (https://antigravity.google/docs/cli/headless, /docs/rules, /docs/skills,
 * /docs/permissions, /docs/hooks), then checked against a real agy 1.3.1: the stream-json event shape and the 58 tool
 * names are the ones it reports (docs/live-run-checklist.md A5).
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
 * Pre-call hook (under a contract, `asp run --contract`): agy runs PreToolUse hooks under `-p` and a "deny" blocks the
 * call (checked live on agy 1.3.1; a hook that crashes also blocks it). Its hook file must live in the workspace root,
 * which this adapter must not write into the project, so under a contract agy runs in a scratch workspace in the run
 * dir (holding .agents/hooks.json) and the project is added with --add-dir. An "allow" from the hook does not override
 * agy's own permission checks. Detected-and-stopped is not enough here: agy auto-allows workspace writes, and the first
 * live run showed the file written before the kill landed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Id } from "@agent-social/asp-core";
import { copyInto, sha256File, toPosix, writeJson } from "../files.ts";
import { frontmatter } from "../frontmatter.ts";
import type { Capture, Harness, LaunchPlan, RuntimeAdapter } from "../harness.ts";
import { deriveScopeForTool } from "../package.ts";
import { scopeForShellCommand, shellArtifact } from "./codex-actions.ts";

export const RUNTIME = "antigravity";

const CONTEXT_FILES = ["AGENTS.md", "GEMINI.md", join(".agents", "AGENTS.md"), join(".agents", "GEMINI.md")];

// ---------- the compliance bridge ----------

// The tool names below are the 58 agy 1.3.1 reports in its init event (checked live 2026-10-08).
const READ_TOOLS = new Set(["view_file", "list_dir", "grep_search", "find_by_name", "list_resources", "read_resource"]);
const WRITE_TOOLS = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"]);
/** Running code: a shell command, input to a running one, a notebook cell, a workflow. */
const EXEC_TOOLS = new Set(["send_command_input", "notebook_execution", "run_workflow"]);
const WEB_TOOLS = new Set(["read_url_content", "search_web", "search_marketplace"]);
/** Looking at a browser page changes nothing; clicking, typing, opening a page or running script does. */
const BROWSER_READ = new Set(["read_browser_page", "browser_get_dom", "browser_get_network_request", "browser_list_network_requests", "list_browser_pages", "capture_browser_console_logs", "capture_browser_screenshot"]);
/** The agent's own bookkeeping, questions to the user, waiting and subagent housekeeping: no side effect on its own. */
const NO_SCOPE_TOOLS = new Set([
  "ask_permission", "ask_custom_permission", "ask_question", "command_status", "finish", "list_permissions", "list_plugin_accounts",
  "manage_task", "manage_inbox", "send_message", "wait", "wait_5_seconds", "manage_subagents", "define_subagent",
]);

/** The scope of one agy tool call, or undefined for the agent's own bookkeeping. */
export function scopeForAgyTool(name: string, params: Record<string, unknown> = {}): string | undefined {
  if (NO_SCOPE_TOOLS.has(name)) return undefined;
  if (name === "run_command") {
    const cmd = params.CommandLine ?? params.command ?? params.command_line ?? params.cmd;
    return scopeForShellCommand(typeof cmd === "string" ? cmd : "");
  }
  if (READ_TOOLS.has(name)) return "repo.read";
  if (WRITE_TOOLS.has(name)) return "repo.write";
  if (EXEC_TOOLS.has(name)) return "shell.exec";
  if (WEB_TOOLS.has(name)) return "web.read";
  if (BROWSER_READ.has(name)) return "web.read";
  if (name === "open_browser_url" || name === "execute_browser_javascript" || name.startsWith("browser_") || name === "click_browser_pixel") return "browser.use";
  if (name === "call_mcp_tool") {
    const server = String(params.ServerName ?? params.server ?? params.server_name ?? "unknown");
    const tool = String(params.ToolName ?? params.tool ?? params.tool_name ?? "");
    return deriveScopeForTool(`mcp__${server}__${tool}`, "");
  }
  return `tool.${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`; // unknown, or invoke_subagent, generate_image, schedule...: not assumed harmless
}

/** The payload of a stream-json event: agy writes {"event": "step_update", "step_update": {...}}. */
function payloadOf(o: any, kind: string): any {
  if (o?.event === kind) return o[kind] ?? o;
  if (o?.type === kind) return o.payload ?? o; // an older or assumed shape
  return undefined;
}

/** Per-run parser for `agy -p --output-format stream-json`: one call per tool step, reported when it starts. */
export function agyActionParser(): (line: string) => { id?: string; scope: string; artifact?: { uri: string; sha256: string } }[] | undefined {
  const seen = new Set<string>();
  return (line) => {
    if (!line.includes("step_update")) return undefined;
    let o: any;
    try { o = JSON.parse(line); } catch { return undefined; }
    const p = payloadOf(o, "step_update");
    if (!p || p.step_type !== "tool") return undefined;
    const info = p.tool_info ?? {};
    const name: string | undefined = info.name ?? p.tool_name;
    if (typeof name !== "string") return undefined;
    const id = p.step_index !== undefined ? `step-${p.step_index}` : undefined;
    if (id && seen.has(id)) return undefined;
    const params = (info.parameters && typeof info.parameters === "object" ? info.parameters : {}) as Record<string, unknown>;
    const scope = scopeForAgyTool(name, params);
    if (id) seen.add(id);
    if (!scope) return undefined;
    if (name === "run_command") {
      const cmd = params.CommandLine ?? params.command ?? params.command_line ?? params.cmd;
      if (typeof cmd === "string") return [{ ...(id ? { id } : {}), scope, artifact: shellArtifact(cmd) }];
    }
    return [{ ...(id ? { id } : {}), scope, artifact: { uri: `asp://tool-call/${name}`, sha256: sha256Id(new TextEncoder().encode(JSON.stringify(params))) } }];
  };
}

/** `agy` can exit 0 on some failures; the final result event carries the status. */
export function agyFailure(line: string): string | undefined {
  if (!line.includes('"result"')) return undefined;
  let o: any;
  try { o = JSON.parse(line); } catch { return undefined; }
  const r = payloadOf(o, "result");
  if (!r) return undefined;
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
const MANDATE_HOOK = fileURLToPath(new URL("./antigravity-mandate-hook.mjs", import.meta.url));

/** The hook script's path as agy can run it unquoted (see materialize). */
export function hookPathFor(path: string, notes: string[]): string {
  const posix = toPosix(path);
  if (!/\s/.test(posix) || process.platform !== "win32") return posix;
  try {
    const short = execFileSync("cmd", ["/c", `for %I in ("${path}") do @echo %~sI`], { encoding: "utf8" }).trim();
    if (short && !/\s/.test(short)) return toPosix(short);
  } catch { /* fall through */ }
  notes.push(`the hook path ${posix} has spaces and no short form: agy cannot run the hook, so every call will be blocked (fail closed); use an ASP home without spaces`);
  return posix;
}

/** A tool step's outcome from the stream: `blocked` means the pre-call hook denied it before it ran. */
export function agyResultParser(): (line: string) => { id: string; blocked: boolean }[] | undefined {
  return (line) => {
    if (!line.includes("step_update") || !(line.includes('"DONE"') || line.includes('"ERROR"'))) return undefined;
    let o: any;
    try { o = JSON.parse(line); } catch { return undefined; }
    const p = payloadOf(o, "step_update");
    // A call the hook denied ends as state ERROR (checked live), after its ACTIVE event; a subagent step ends as step_type subagent.
    if (!p || (p.step_type !== "tool" && p.step_type !== "subagent") || (p.state !== "DONE" && p.state !== "ERROR") || p.step_index === undefined) return undefined;
    const msg = String(p.tool_info?.error?.message ?? "");
    return [{ id: `step-${p.step_index}`, blocked: msg.includes("ASP Mandate") || msg.includes("denied by pre-tool hook") }];
  };
}

async function materialize(opts: {
  pkgDir: string; harness: Harness; project: string; runDir: string; agentName: string; prompt?: string;
  env: NodeJS.ProcessEnv; model?: string; sourceRuntime?: string; mandateScopes?: string[];
  mandateGate?: { scopes: string[]; mode: "ask" | "deny"; waitSeconds: number };
  mandateKnownBad?: { fingerprint: string; report: string }[];
  mandateHosts?: string[];
}): Promise<LaunchPlan> {
  const { pkgDir, harness, project, runDir } = opts;
  // Under a contract agy runs in a scratch workspace holding the hook; the project is an added directory.
  const hooked = opts.mandateScopes !== undefined && opts.prompt !== undefined;
  const workspace = join(runDir, "workspace");
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
    // The project's own AGENTS.md / GEMINI.md is loaded by agy itself, unless the project is only an added directory.
    if (!hooked && i.scope === "project" && !i.name.startsWith("rules/")) {
      const inProject = join(project, i.name);
      if (existsSync(inProject) && sha256File(inProject) === sha256File(src)) { notes.push(`skipped ${i.name}: Antigravity already loads the project's copy`); continue; }
    }
    if (!hooked && i.scope === "rules" && existsSync(join(project, ".agents", i.name)) && sha256File(join(project, ".agents", i.name)) === sha256File(src)) {
      notes.push(`skipped ${i.name}: Antigravity already loads the project's copy`); continue;
    }
    parts.push(`## ${i.name}\n\n${readFileSync(src, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()}`);
  }
  const projectSkills = new Set(["project"]);
  const carried = harness.skills.filter((s) => hooked || !(projectSkills.has(s.scope ?? "") && existsSync(join(project, ".agents", "skills", s.name))));
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
  if (hooked) {
    parts.push(`## Your workspace\n\nYour project is in ${toPosix(project)}. The current directory is an empty scratch workspace: do your work in the project, with absolute paths.`);
  }
  let preamble = parts.join("\n\n");
  if (preamble.length > PREAMBLE_LIMIT) {
    preamble = preamble.slice(0, PREAMBLE_LIMIT) + "\n\n[the rest of the standing instructions was cut to fit the command line]";
    notes.push(`the standing instructions were cut to ${PREAMBLE_LIMIT} characters to fit the command line`);
  }
  writeFileSync(join(runDir, "instructions.md"), preamble + "\n");
  files.push("instructions.md");

  let preventsCalls = false;
  let approvalsDir: string | undefined;
  if (hooked) {
    const hookDir = join(runDir, "asp-hook");
    mkdirSync(hookDir, { recursive: true });
    mkdirSync(join(workspace, ".agents"), { recursive: true });
    copyInto(MANDATE_HOOK, join(hookDir, "asp-mandate-hook.mjs"));
    const gate = opts.mandateGate && opts.mandateGate.scopes.length ? opts.mandateGate : undefined;
    writeJson(join(hookDir, "asp-mandate.json"), { scopes: [...opts.mandateScopes!].sort(), ...(gate ? { gate } : {}), ...(opts.mandateKnownBad?.length ? { knownBad: opts.mandateKnownBad } : {}), ...(opts.mandateHosts?.length ? { hosts: opts.mandateHosts } : {}) });
    // agy runs hook commands through cmd and mangles quoted paths (checked live): plain `node` from PATH and an unquoted
    // script path, which on Windows must have no spaces, so a folder name with spaces is turned into its 8.3 short form.
    const script = hookPathFor(join(hookDir, "asp-mandate-hook.mjs"), notes);
    const cmd = (phase: string) => `node ${script} ${phase}`;
    writeJson(join(workspace, ".agents", "hooks.json"), { asp: {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: cmd("pre"), timeout: (gate?.mode === "ask" ? gate.waitSeconds : 0) + 15 }] }],
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: cmd("post"), timeout: 15 }] }],
    } });
    files.push("workspace/", "asp-hook/");
    preventsCalls = true;
    if (gate?.mode === "ask") approvalsDir = join(runDir, "approvals");
    notes.push(`pre-call Mandate hook active: calls outside ${opts.mandateScopes!.length ? opts.mandateScopes!.join(", ") : "an empty scope list"} are blocked before they run`);
  }
  const model = opts.model;
  const extra = (opts.env.ASP_ANTIGRAVITY_ARGS ?? "").split(/\s+/).filter(Boolean);
  const args: string[] = [];
  if (opts.prompt !== undefined) {
    args.push("-p", `${preamble}\n\n---\n\nYour task:\n\n${opts.prompt}`, "--output-format", "stream-json", "--print-timeout", opts.env.ASP_ANTIGRAVITY_TIMEOUT ?? "15m");
  }
  if (model) args.push("--model", model);
  else if (harness.model && opts.sourceRuntime === RUNTIME) args.push("--model", harness.model);
  if (hooked) args.push("--add-dir", toPosix(project));
  args.push(...extra);
  notes.push("headless agy soft-denies shell commands that are not pre-approved; set ASP_ANTIGRAVITY_ARGS=--dangerously-skip-permissions only for a run you trust");
  if (!hooked) notes.push("no pre-call hook outside a contract: an out-of-scope call would only be detected, not prevented");

  // ASP_ANTIGRAVITY_SCRIPT lets tests run a fake agy under node.
  const finalArgs = opts.env.ASP_ANTIGRAVITY_SCRIPT ? [opts.env.ASP_ANTIGRAVITY_SCRIPT, ...args] : args;
  return {
    command: resolveAgy(opts.env), args: finalArgs, cwd: hooked ? workspace : project, env: {}, files, runDir, memoryDir: memDir, missingSecrets: [], notes,
    ...(opts.prompt !== undefined ? { checkOutputForAction: agyActionParser(), checkOutputForFailure: agyFailure } : {}),
    ...(hooked ? { preventsCalls, checkOutputForResult: agyResultParser(), executedCallsFile: join(runDir, "executed-calls.ndjson"), blockedCallsFile: join(runDir, "blocked-calls.ndjson"), ...(approvalsDir ? { approvalsDir } : {}) } : {}),
  };
}

export const antigravity: RuntimeAdapter = { name: RUNTIME, capture, materialize };
