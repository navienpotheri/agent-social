/**
 * The gateway's tool-call judge (docs/gateway-design.md): maps a tool call that a model asked for to an ASP scope and
 * decides whether the live Mandate allows it. Runtime-neutral: it looks at the tool's name and arguments, the same way
 * for any agent, using the same mappings the compliance bridge and the pre-call hooks use.
 */
import { hostAllowed, isNetworkScope, sha256Id } from "@agent-social/asp-core";
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

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s\/@'"<>]*@)?(\[[0-9a-f:]+\]|[a-z0-9._-]+)/gi;
/** Commands that take a host as an argument without a URL: curl example.com, nc host 80, ssh user@host, scp file host:path. */
const HOST_VERB_RE = /\b(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet|ping|nslookup|dig)\b([^|;&\n]*)/gi;
const BARE_HOST_RE = /^(?:[^@\s]+@)?((?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::|$|\/)/i;

/** The hosts a network-bound call would reach, as far as they can be read from it. `[]` means the call reaches the network but no host could be read. */
export function hostsOf(call: ToolCall, scope: string): string[] {
  const hosts = new Set<string>();
  const add = (h: string) => hosts.add(h.replace(/^\[|\]$/g, "").toLowerCase());
  const fromText = (text: string) => {
    for (const m of text.matchAll(URL_RE)) add(m[1]);
    for (const verb of text.matchAll(HOST_VERB_RE)) {
      for (const tok of verb[1].trim().split(/\s+/)) {
        if (tok.startsWith("-") || tok.includes("://")) continue;
        const m = BARE_HOST_RE.exec(tok.replace(/^["']|["']$/g, ""));
        if (m) add(m[1]);
      }
    }
  };
  if (scope === "shell.network") {
    const cmd = commandOf(call.args);
    if (cmd) fromText(cmd);
  } else {
    for (const k of ["url", "uri", "href", "link", "address"]) {
      const v = call.args[k];
      if (typeof v === "string") fromText(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    }
  }
  return [...hosts];
}

/** Exact scope membership, like the log's own check, plus the known-bad list (blocked even when the scope is granted). */
export function judge(call: ToolCall, scopes: readonly string[], knownBad: readonly KnownBadRef[] = [], ownTools: (name: string) => boolean = () => false, hosts?: readonly string[]): Judgement {
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
  // The Mandate names the hosts its network scopes may reach (default-deny egress): any other host is refused, and so is a call whose host cannot be read.
  if (hosts && isNetworkScope(c.scope)) {
    const found = hostsOf(call, c.scope);
    const searchOnly = c.scope !== "shell.network" && !["url", "uri", "href", "link", "address"].some((k) => typeof call.args[k] === "string");
    if (!searchOnly) {
      if (!found.length) return { allow: false, scope: c.scope, artifact: c.artifact, reason: `this job's Mandate limits network access to named hosts and this call's host cannot be determined` };
      const outside = found.find((h) => !hostAllowed(h, hosts));
      if (outside) return { allow: false, scope: c.scope, artifact: c.artifact, reason: `the host ${outside} is not one this job's Mandate allows (${hosts.join(", ")})` };
    }
  }
  return { allow: true, scope: c.scope, artifact: c.artifact };
}
