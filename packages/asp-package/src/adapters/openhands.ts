/**
 * OpenHands CLI adapter (openhands 1.16 / SDK 1.21; on Windows it runs inside WSL).
 *
 * capture: repo context files (AGENTS.md, CLAUDE.md, GEMINI.md, .cursorrules), skills (.agents/skills,
 *   .openhands/skills), legacy microagents (.openhands/microagents: no triggers = always-on instructions,
 *   with triggers = on-demand skills), .openhands/hooks.json; with --include-user also the user's skills,
 *   microagents, hooks, MCP servers (~/.openhands/mcp.json) and model (agent_settings.json, model only).
 * materialize: never writes into the project or the real ~/.openhands. A launch script builds a "shadow
 *   home" in the run dir: every entry of the real home is symlinked (so git, ssh and toolchains keep
 *   working) except .agents and .openhands, which hold the agent's own skills, always-on instructions,
 *   hooks and MCP config, plus links to the real OpenHands settings and credentials. HOME points there
 *   for the run. MCP secrets are expanded from the environment into a private file removed on exit.
 *
 * Verified offline against the installed SDK (2026-09-27): HOME selects user skills; a legacy microagent
 * without triggers lands in the system prompt; SKILL.md skills are advertised on demand; the project's
 * CLAUDE.md/AGENTS.md load natively; skills have keyword/task triggers only (no path triggers).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sha256Id } from "@agent-social/asp-core";
import { copyInto, listFiles, sha256File, writeJson } from "../files.ts";
import { deriveScopeForTool } from "../package.ts";
import { scopeForShellCommand } from "./codex-actions.ts";
import { asList, frontmatter } from "../frontmatter.ts";
import type { Capture, Component, Harness, LaunchPlan, McpServer, RuntimeAdapter } from "../harness.ts";
import { stripSecrets, toEnvRefs } from "../secrets.ts";
import { onWindows, toWslPath, wslDistroArgs, wslEnvFor, wslHomeAsWindowsPath } from "../wsl.ts";

export const RUNTIME = "openhands";

/** OpenHands tools with no side effects (seen live: a plain answer ends with a `finish` call). */
const NO_SCOPE_OPENHANDS_TOOLS = new Set(["finish", "think", "task_tracker"]);

/** Repo files OpenHands reads natively as context (third-party skill files). */
const CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules"];
/** Hook events OpenHands supports. */
const HOOK_EVENTS = new Set(["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "SessionEnd", "Stop"]);
/** Other runtimes' tool names → OpenHands tool names, for hook matchers. */
const TOOL_NAMES: Record<string, string> = {
  Bash: "terminal", PowerShell: "terminal", shell: "terminal",
  Read: "file_editor", Edit: "file_editor", Write: "file_editor", MultiEdit: "file_editor", NotebookEdit: "file_editor", apply_patch: "file_editor",
  TodoWrite: "task_tracker",
};

const skillSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill";
const stripFm = (t: string) => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

// ---------- capture ----------

function openhandsHome(home: string | undefined, env: NodeJS.ProcessEnv): string {
  if (home) return home;
  if (onWindows) return wslHomeAsWindowsPath(env) ?? homedir();
  return homedir();
}

async function capture(opts: { project: string; includeUser: boolean; home?: string; staging: string }): Promise<Capture> {
  const { project, includeUser, staging } = opts;
  const home = openhandsHome(opts.home, process.env);
  const ohHome = join(home, ".openhands");
  const hdir = join(staging, "harness");
  const warnings: string[] = [];
  const secrets = new Set<string>();
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
  const addSkillDir = (dir: string, name: string, scope: "project" | "user") => {
    if (seen.has(name)) { warnings.push(`skipped ${scope} skill "${name}": another skill has the same name`); return; }
    seen.add(name);
    copyInto(dir, join(hdir, "skills", name));
    const fm = frontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
    harness.skills.push({ name, path: `skills/${name}`, scope, ...(typeof fm.description === "string" ? { description: fm.description } : {}) } satisfies Component);
  };
  /** A legacy microagent: no triggers → an always-on instruction; triggers → an on-demand skill. */
  const addMicroagent = (file: string, rel: string, scope: "project" | "user") => {
    const text = readFileSync(file, "utf8");
    const fm = frontmatter(text);
    const triggers = asList(fm.triggers);
    if (!triggers?.length) { addInstruction(file, `microagents/${rel}`, scope === "user" ? "user" : "project"); return; }
    const name = skillSlug(typeof fm.name === "string" ? fm.name : rel.replace(/\.md$/, ""));
    if (seen.has(name)) { warnings.push(`skipped microagent "${name}": a skill has the same name`); return; }
    seen.add(name);
    const description = `Use when the task mentions: ${triggers.join(", ")}`;
    mkdirSync(join(hdir, "skills", name), { recursive: true });
    writeFileSync(join(hdir, "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\ntriggers: [${triggers.map((t) => JSON.stringify(t)).join(", ")}]\n---\n${stripFm(text)}\n`);
    harness.skills.push({ name, path: `skills/${name}`, scope, description });
  };
  const scan = (root: string, scope: "project" | "user") => {
    for (const sub of [join(root, ".agents", "skills"), join(root, ".openhands", "skills")]) {
      for (const e of existsSync(sub) ? readdirSync(sub).sort() : []) {
        const p = join(sub, e);
        if (e.startsWith(".") || e === "installed") continue;
        if (statSync(p).isDirectory() && existsSync(join(p, "SKILL.md"))) addSkillDir(p, e, scope);
        else if (e.endsWith(".md") && statSync(p).isFile()) addMicroagent(p, e, scope);
      }
    }
    const legacy = join(root, ".openhands", "microagents");
    for (const f of listFiles(legacy).filter((f) => f.endsWith(".md"))) addMicroagent(join(legacy, f), f, scope);
  };

  if (includeUser) scan(home, "user");
  for (const f of CONTEXT_FILES) if (existsSync(join(project, f))) addInstruction(join(project, f), f, "project");
  scan(project, "project");

  // Hooks (same shape as Claude Code's), MCP servers and model.
  const readHooks = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).hooks ?? {} : {});
  harness.hooks = { ...(includeUser ? readHooks(join(ohHome, "hooks.json")) : {}), ...readHooks(join(project, ".openhands", "hooks.json")) };
  if (includeUser) {
    const mcp = existsSync(join(ohHome, "mcp.json")) ? JSON.parse(readFileSync(join(ohHome, "mcp.json"), "utf8")).mcpServers ?? {} : {};
    for (const [name, s] of Object.entries(mcp as Record<string, McpServer>)) {
      const out: McpServer = { ...s };
      if (s.env) out.env = stripSecrets(s.env as Record<string, string>, secrets);
      if (s.headers) out.headers = stripSecrets(s.headers as Record<string, string>, secrets);
      harness.mcp_servers[name] = out;
    }
    // agent_settings.json also holds the API key: read only the model name.
    const settings = join(ohHome, "agent_settings.json");
    if (existsSync(settings)) {
      const model = JSON.parse(readFileSync(settings, "utf8"))?.llm?.model;
      if (typeof model === "string") harness.model = model;
    }
  }
  if (secrets.size) harness.secrets = [...secrets].sort();

  mkdirSync(join(staging, "memory"), { recursive: true });
  mkdirSync(join(staging, "experience"), { recursive: true });
  writeFileSync(join(staging, "experience", "sessions.ndjson"), "");
  warnings.push("OpenHands sessions are not indexed yet");
  writeJson(join(hdir, "harness.json"), harness);
  return { dir: staging, harness, sessions: 0, warnings, runtime: { name: RUNTIME, model: harness.model } };
}

// ---------- materialize ----------

function mapHooks(hooks: Record<string, unknown[]>, notes: string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  const dropped: string[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!HOOK_EVENTS.has(event)) { dropped.push(event); continue; }
    out[event] = (groups as any[]).map((g) => ({
      ...g, ...(typeof g.matcher === "string" ? { matcher: [...new Set(g.matcher.split("|").map((t: string) => TOOL_NAMES[t] ?? t))].join("|") } : {}),
    }));
  }
  if (dropped.length) notes.push(`hooks for ${dropped.join(", ")} are dropped: OpenHands has no such events`);
  if (Object.keys(out).length) notes.push("hook matchers are translated to OpenHands tool names (terminal, file_editor, task_tracker)");
  return out;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function launchScript(o: { run: string; project: string; args: string[]; hasMcp: boolean }): string {
  return `#!/usr/bin/env bash
# Generated by asp: runs an ASP agent on OpenHands with a shadow home. See packages/asp-package/src/adapters/openhands.ts.
set -uo pipefail
RUN=${q(o.run)}
SHADOW="$RUN/home"
REAL="$HOME"
mkdir -p "$SHADOW/.openhands"

# Shadow home: the real home's entries, except the agent's own .agents and .openhands.
for e in "$REAL"/.[!.]* "$REAL"/*; do
  [ -e "$e" ] || continue
  n=$(basename "$e")
  case "$n" in .agents|.openhands) continue ;; esac
  [ -e "$SHADOW/$n" ] || ln -s "$e" "$SHADOW/$n"
done
# The real OpenHands settings and credentials, without its skills, hooks, MCP or conversations.
if [ -d "$REAL/.openhands" ]; then
  for e in "$REAL/.openhands"/.[!.]* "$REAL/.openhands"/*; do
    [ -e "$e" ] || continue
    n=$(basename "$e")
    case "$n" in microagents|skills|hooks.json|mcp.json|conversations) continue ;; esac
    [ -e "$SHADOW/.openhands/$n" ] || ln -s "$e" "$SHADOW/.openhands/$n"
  done
fi
${o.hasMcp ? `
# MCP config: \${VAR} references expanded from the environment into a private file on the Linux
# filesystem (a Windows drive can't hold private files), linked into the shadow home, removed on exit.
SECRETS="$(mktemp -d)"
trap 'rm -rf "$SECRETS"; rm -f "$SHADOW/.openhands/mcp.json"' EXIT
umask 077
python3 - "$RUN/mcp.template.json" "$SECRETS/mcp.json" <<'PY' || exit 1
import json, os, re, sys
text = open(sys.argv[1]).read()
def sub(m):
    value = os.environ.get(m.group(1))
    if value is None:
        sys.exit("asp: missing secret " + m.group(1))
    return json.dumps(value)[1:-1]
open(sys.argv[2], "w").write(re.sub(r"\\$\\{([A-Za-z_][A-Za-z0-9_]*)\\}", sub, text))
PY
umask 022
ln -sf "$SECRETS/mcp.json" "$SHADOW/.openhands/mcp.json"
` : ""}
export HOME="$SHADOW"
export OPENHANDS_CONVERSATIONS_DIR="$RUN/conversations"
export OPENHANDS_WORK_DIR=${q(o.project)}
export OPENHANDS_SUPPRESS_BANNER=1
cd "$OPENHANDS_WORK_DIR" || exit 1
CMD="\${ASP_OPENHANDS_CMD:-$(PATH="$REAL/.local/bin:$PATH" command -v openhands)}"
if [ -z "$CMD" ]; then echo "asp: openhands is not installed in this environment" >&2; exit 127; fi
$CMD ${o.args.map(q).join(" ")}
`;
}

/**
 * The compliance bridge for OpenHands' headless --json stream: one ActionEvent per tool call, with
 * `tool_name` and an `action` payload. Built to the SDK's documented event shape, not yet checked
 * against a live run (docs/backlog.md); anything unrecognized yields no scope rather than a guess.
 */
function checkOutputForAction(line: string): { scope: string; artifact?: { uri: string; sha256: string } }[] | undefined {
  if (!line.includes("ActionEvent")) return undefined;
  let o: any;
  try { o = JSON.parse(line); } catch { return undefined; }
  if (o.kind !== "ActionEvent" || typeof o.tool_name !== "string") return undefined;
  // The agent's own bookkeeping (ending its turn, thinking aloud, its task list) touches nothing: no scope, never a violation.
  if (NO_SCOPE_OPENHANDS_TOOLS.has(o.tool_name)) return undefined;
  const action = o.action ?? {};
  const scope = o.tool_name === "terminal"
    // By what the command does (a read-only `ls` or `cat` is repo.read), as for Codex and Antigravity; checked live on OpenHands 1.16 with an open-weight model.
    ? scopeForShellCommand(typeof action.command === "string" ? action.command : "")
    : o.tool_name === "file_editor"
      ? (action.command === "view" ? "repo.read" : "repo.write")
      : deriveScopeForTool(o.tool_name, "");
  return [{ scope, artifact: { uri: `asp://tool-call/${o.tool_name}`, sha256: sha256Id(new TextEncoder().encode(JSON.stringify(action))) } }];
}

async function materialize(opts: {
  pkgDir: string; harness: Harness; project: string; runDir: string; agentName: string; prompt?: string;
  env: NodeJS.ProcessEnv; model?: string; endpoint?: string; apiKeyEnv?: string; sourceRuntime?: string;
}): Promise<LaunchPlan> {
  const { pkgDir, harness, project, runDir } = opts;
  const h = join(pkgDir, "harness");
  const lx = onWindows ? toWslPath : (p: string) => p;
  const notes: string[] = [];
  const home = join(runDir, "home");
  const skillsDir = join(home, ".agents", "skills");
  const oh = join(home, ".openhands");
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(join(oh, "microagents"), { recursive: true });

  // Skills: native (SKILL.md, advertised on demand). Commands and subagent roles go alongside as files.
  for (const s of harness.skills) copyInto(join(h, s.path), join(skillsDir, s.name));
  const lib = join(runDir, "agent");
  for (const a of harness.subagents) copyInto(join(h, a.path), join(lib, a.path));
  for (const c of harness.commands) copyInto(join(h, c.path), join(lib, c.path));

  // Path-scoped rules become on-demand skills that name their globs (OpenHands has no path triggers).
  const parts: string[] = [`# Agent: ${opts.agentName}\n\nYou are running as the ASP agent ${opts.agentName}. These are your standing instructions, carried in your agent package.`];
  for (const i of harness.instructions) {
    const src = join(h, i.path);
    if (i.scope !== "user" && CONTEXT_FILES.includes(i.name) && existsSync(join(project, i.name)) && sha256File(join(project, i.name)) === sha256File(src)) {
      notes.push(`skipped ${i.name}: OpenHands already loads the project's copy`);
      continue;
    }
    const text = stripFm(readFileSync(src, "utf8"));
    if (i.applies_to?.length) {
      const name = `rule-${skillSlug(i.name.replace(/\.md$/, ""))}`;
      mkdirSync(join(skillsDir, name), { recursive: true });
      writeFileSync(join(skillsDir, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${JSON.stringify(`Rules for files matching ${i.applies_to.join(", ")}. Read before reading or editing such files.`)}\n---\n${text}\n`);
    } else parts.push(`## ${i.name}\n\n${text}`);
  }
  if (harness.instructions.some((i) => i.applies_to)) notes.push("path-scoped rules are on-demand skills naming their globs (OpenHands has no path triggers)");
  if (harness.commands.length) {
    parts.push(["## Your commands", "When the user asks for one of these by name (e.g. `/ship`), open its file and follow it.",
      ...harness.commands.map((c) => `- /${c.name}${c.description ? `: ${c.description}` : ""} (file: ${lx(join(lib, c.path))})`)].join("\n"));
  }
  if (harness.subagents.length) {
    parts.push(["## Your subagent roles", "Specialist roles you can delegate to, or adopt yourself. Each file holds the role's instructions.",
      ...harness.subagents.map((a) => `- ${a.name}${a.description ? `: ${a.description}` : ""} (file: ${lx(join(lib, a.path))})`)].join("\n"));
  }
  if (harness.permissions.deny.length || harness.permissions.ask.length) {
    parts.push(["## Limits set by your principal", ...harness.permissions.deny.map((r) => `- Never: ${r}`), ...harness.permissions.ask.map((r) => `- Ask the user first: ${r}`)].join("\n"));
    notes.push("permission rules are stated in the prompt; OpenHands does not enforce them");
  }
  const memDir = join(runDir, "memory");
  if (existsSync(join(pkgDir, "memory"))) copyInto(join(pkgDir, "memory"), memDir);
  mkdirSync(join(memDir, "auto"), { recursive: true });
  const index = join(memDir, "auto", "MEMORY.md");
  parts.push([
    "## Your memory",
    `Your memory lives in ${lx(join(memDir, "auto"))}. MEMORY.md is its index; each entry links a topic file.`,
    "When you learn something durable about this project or your principal's preferences, write or update a topic file there and add a one-line pointer to MEMORY.md. Never store secrets.",
    existsSync(index) ? `The index:\n\n${readFileSync(index, "utf8").trim()}` : "The index is empty.",
  ].join("\n\n"));
  // A legacy microagent with no triggers: always in the system prompt.
  writeFileSync(join(oh, "microagents", "asp-agent.md"), parts.join("\n\n") + "\n");

  const hooks = mapHooks(harness.hooks as Record<string, unknown[]>, notes);
  if (Object.keys(hooks).length) writeJson(join(oh, "hooks.json"), { hooks });

  // MCP: a template with ${NAME} references; the launch script expands it from the environment.
  const env: Record<string, string> = {};
  const missing = new Set<string>();
  const hasMcp = Object.keys(harness.mcp_servers).length > 0;
  if (hasMcp) {
    const servers = Object.fromEntries(Object.entries(harness.mcp_servers).map(([k, s]) => [k, {
      ...s, ...(s.env ? { env: toEnvRefs(s.env) } : {}), ...(s.headers ? { headers: toEnvRefs(s.headers) } : {}),
    }]));
    writeJson(join(runDir, "mcp.template.json"), { mcpServers: servers });
  }
  for (const name of harness.secrets ?? []) {
    if (opts.env[name] === undefined) missing.add(name);
    else env[name] = opts.env[name]!;
  }

  // ASP_OPENHANDS_CMD replaces the openhands command inside the launch script (live checks use it).
  if (opts.env.ASP_OPENHANDS_CMD) env.ASP_OPENHANDS_CMD = opts.env.ASP_OPENHANDS_CMD;
  const model = opts.model ?? (opts.sourceRuntime === RUNTIME ? harness.model : undefined);
  if (!opts.model && harness.model && opts.sourceRuntime !== RUNTIME) notes.push(`not using the packed model ${harness.model} (a ${opts.sourceRuntime} model); OpenHands uses its configured model unless you pass --model`);
  const args: string[] = [];
  if (opts.endpoint && !model) notes.push("--endpoint has no effect without --model (use a LiteLLM name, e.g. openai/llama3 or ollama/llama3)");
  if (model) { env.LLM_MODEL = model; args.push("--override-with-envs"); }
  if (model && opts.endpoint) {
    env.LLM_BASE_URL = opts.endpoint;
    if (opts.apiKeyEnv) {
      if (opts.env[opts.apiKeyEnv] === undefined) missing.add(opts.apiKeyEnv);
      else env.LLM_API_KEY = opts.env[opts.apiKeyEnv]!;
    } else env.LLM_API_KEY = "local";
    notes.push(`model served from ${opts.endpoint}${opts.apiKeyEnv ? "" : " (placeholder API key; pass --api-key-env for a hosted endpoint)"}`);
  }
  if (opts.prompt !== undefined) {
    writeFileSync(join(runDir, "task.md"), opts.prompt + "\n");
    args.push("--headless", "--json", "-f", lx(join(runDir, "task.md")));
    notes.push("headless OpenHands auto-approves every action; it runs with your WSL user's full permissions");
  }

  const script = join(runDir, "launch.sh");
  writeFileSync(script, launchScript({ run: lx(runDir), project: lx(project), args, hasMcp }), { mode: 0o755 });
  const files = ["home/", "launch.sh", ...(hasMcp ? ["mcp.template.json"] : []), "memory/"];

  let command: string;
  let cmdArgs: string[];
  if (opts.env.ASP_OPENHANDS_BIN) { command = opts.env.ASP_OPENHANDS_BIN; cmdArgs = [...(opts.env.ASP_OPENHANDS_SCRIPT ? [opts.env.ASP_OPENHANDS_SCRIPT] : []), script]; }
  else if (onWindows) {
    command = "wsl.exe";
    cmdArgs = [...wslDistroArgs(opts.env), "--", "bash", lx(script)];
    env.WSLENV = wslEnvFor(Object.keys(env), opts.env.WSLENV);
  } else { command = "bash"; cmdArgs = [script]; }

  return {
    command, args: cmdArgs, cwd: project, env, files, runDir, memoryDir: memDir, missingSecrets: [...missing].sort(), notes,
    checkOutputForAction: opts.prompt === undefined ? undefined : checkOutputForAction,
    // OpenHands' headless --json mode exits 0 even after a fatal error (e.g. an LLM auth failure);
    // ConversationErrorEvent is how it reports that on the JSONL stream, so asp checks for it itself.
    checkOutputForFailure: opts.prompt === undefined ? undefined : (line: string) => {
      if (!line.includes('"kind":"ConversationErrorEvent"') && !line.includes('"kind": "ConversationErrorEvent"')) return undefined;
      try {
        const e = JSON.parse(line);
        return e.detail ? `${e.code ?? "OpenHands error"}: ${e.detail}` : (e.code ?? "OpenHands reported a conversation error");
      } catch {
        return "OpenHands reported a conversation error";
      }
    },
  };
}

export const openhands: RuntimeAdapter = { name: RUNTIME, capture, materialize };
