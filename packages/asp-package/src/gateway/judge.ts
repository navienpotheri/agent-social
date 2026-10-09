/**
 * The gateway's tool-call judge (docs/gateway-design.md): maps a tool call that a model asked for to an ASP scope and
 * decides whether the live Mandate allows it. Runtime-neutral: it looks at the tool's name and arguments, the same way
 * for any agent, using the same mappings the compliance bridge and the pre-call hooks use.
 */
import { sha256Id } from "@agent-social/asp-core";
import { scopeForShellCommand, shellArtifact } from "../adapters/codex-actions.ts";
import { deriveScopeForTool } from "../package.ts";

export interface ToolCall { id?: string; name: string; args: Record<string, unknown> }
export interface KnownBadRef { fingerprint: string; report: string }
export interface Judgement {
  allow: boolean;
  /** "" for bookkeeping tools that need no scope. */
  scope: string;
  artifact?: { uri: string; sha256: string };
  reason?: string;
}

const SHELL = new Set(["bash", "shell", "sh", "zsh", "powershell", "pwsh", "cmd", "run_command", "run_shell_command", "execute_command", "exec_command", "local_shell", "terminal", "execute", "command", "run_terminal_cmd", "shell_command"]);
const READ = new Set(["read", "read_file", "readfile", "view_file", "view", "cat", "ls", "list", "list_files", "list_dir", "list_directory", "glob", "grep", "search", "search_files", "find", "find_by_name", "grep_search", "notebookread", "open_file"]);
const WRITE = new Set(["write", "write_file", "writefile", "edit", "edit_file", "str_replace", "str_replace_editor", "str_replace_based_edit_tool", "apply_patch", "create_file", "multiedit", "notebookedit", "write_to_file", "replace_file_content", "insert", "delete_file"]);
const WEB = new Set(["web_fetch", "webfetch", "fetch", "web_search", "websearch", "browse", "read_url_content", "search_web"]);
/** Planning and bookkeeping tools with no side effects. */
const NO_SCOPE = new Set(["todowrite", "todo_write", "exitplanmode", "update_plan", "think", "task_complete", "finish"]);

/** The command text a shell-like tool call carries. */
export function commandOf(args: Record<string, unknown>): string | undefined {
  for (const k of ["command", "cmd", "CommandLine", "command_line", "script", "input", "code"]) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v;
    if (Array.isArray(v) && v.every((x) => typeof x === "string") && v.length) return v.join(" ");
  }
  return undefined;
}

/** A tool call's scope and fingerprint, without deciding anything. */
export function classify(call: ToolCall): { scope: string; artifact?: { uri: string; sha256: string }; shell?: string } {
  const n = call.name.toLowerCase();
  if (NO_SCOPE.has(n)) return { scope: "" };
  const cmd = SHELL.has(n) ? commandOf(call.args) : undefined;
  if (SHELL.has(n)) {
    if (cmd === undefined) return { scope: "shell.exec", artifact: { uri: `asp://tool-call/${call.name}`, sha256: sha256Id(new TextEncoder().encode(JSON.stringify(call.args))) } };
    return { scope: scopeForShellCommand(cmd), artifact: shellArtifact(cmd), shell: cmd };
  }
  const generic = { uri: `asp://tool-call/${call.name}`, sha256: sha256Id(new TextEncoder().encode(JSON.stringify(call.args))) };
  if (READ.has(n)) return { scope: "repo.read", artifact: generic };
  if (WRITE.has(n)) return { scope: "repo.write", artifact: generic };
  if (WEB.has(n)) return { scope: "web.read", artifact: generic };
  if (call.name.startsWith("mcp__")) return { scope: deriveScopeForTool(call.name, ""), artifact: generic };
  return { scope: `tool.${n.replace(/[^a-z0-9_]/g, "_")}`, artifact: generic };
}

/** Exact scope membership, like the log's own check, plus the known-bad list (blocked even when the scope is granted). */
export function judge(call: ToolCall, scopes: readonly string[], knownBad: readonly KnownBadRef[] = [], ownTools: (name: string) => boolean = () => false): Judgement {
  // The gateway's own memory and commons tools are the agent's bookkeeping, like a planning tool: no scope.
  if (ownTools(call.name)) return { allow: true, scope: "" };
  const c = classify(call);
  if (c.scope === "") return { allow: true, scope: "" };
  if (c.shell !== undefined && c.artifact) {
    const fp = `${c.artifact.uri}#${c.artifact.sha256}`;
    const hit = knownBad.find((k) => k.fingerprint === fp);
    if (hit) return { allow: false, scope: c.scope, artifact: c.artifact, reason: `the known-bad list (an upheld report, ${hit.report}) marks this command harmful` };
  }
  if (!scopes.includes(c.scope)) return { allow: false, scope: c.scope, artifact: c.artifact, reason: `the scope ${c.scope} is not granted by this job's Mandate` };
  return { allow: true, scope: c.scope, artifact: c.artifact };
}
