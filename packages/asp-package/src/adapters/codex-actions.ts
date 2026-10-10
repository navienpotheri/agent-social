/**
 * The compliance bridge for Codex: real tool calls from `codex exec --json`, mapped to ASP scopes.
 *
 * Codex does everything through a shell (plus apply_patch, MCP and web search), so a shell command is
 * classified by what it does: inspection-only commands read the repo, commands that change files
 * write it, anything else is `shell.exec` (which a Mandate must grant explicitly). Unknown is never
 * guessed down to a weaker scope. Codex has no pre-call hook we can install, so these calls can be
 * detected (and the run stopped) but not prevented.
 */
import { sha256Id } from "@agent-social/asp-core";
import { deriveScopeForTool } from "../package.ts";

const READ_ONLY = new Set([
  "cat", "type", "ls", "dir", "pwd", "head", "tail", "wc", "grep", "rg", "findstr", "find", "tree", "stat", "file", "echo",
  "get-content", "get-childitem", "select-string", "get-item", "test-path", "get-location", "resolve-path", "measure-object",
  "gc", "gci", "sls", "write-output", "write-host",
]);
const GIT_READ = /^git\s+(status|diff|log|show|branch|ls-files|rev-parse|blame)\b/i;
const WRITES = /(^|\s)(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|clear-content|mkdir|md|rm|del|cp|copy|mv|move|touch|tee|sed\s+-i|ni|ri|si|sc|ac)\b|>>?(?!&)/i;

/** The command Codex really ran: unwraps `powershell -Command '...'`, `bash -lc "..."` and `cmd /c ...`. */
export function unwrapShell(command: string): string {
  const m = /^\s*"?[^"]*?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:-\w+\s+)*-Command\s+(.+)$/is.exec(command)
    ?? /^\s*"?[^"]*?(?:bash|sh|zsh)(?:\.exe)?"?\s+-\w*c\s+(.+)$/is.exec(command)
    ?? /^\s*"?[^"]*?cmd(?:\.exe)?"?\s+\/c\s+(.+)$/is.exec(command);
  if (!m) return command.trim();
  const inner = m[1].trim();
  const q = inner[0];
  return (q === "'" || q === "\"") && inner.endsWith(q) ? inner.slice(1, -1).replace(/''/g, "'") : inner;
}

/** A shell command as one comparable string: the wrapper removed, whitespace collapsed. */
export function normalizeCommand(command: string): string {
  return unwrapShell(command).trim().replace(/\s+/g, " ");
}

/**
 * The data-flow fingerprint of a shell command, the same for every runtime, so the contagion watcher can see one command
 * spreading between agents on different runtimes. A hash of the normalized command, never the command itself.
 */
export function shellArtifact(command: string): { uri: string; sha256: string } {
  return { uri: "asp://shell-command", sha256: sha256Id(new TextEncoder().encode(normalizeCommand(command))) };
}

export function scopeForShellCommand(command: string): string {
  const inner = unwrapShell(command);
  const segments = inner.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  if (WRITES.test(inner)) {
    // Writing files is repo.write only when nothing in the command is network, push or a PR.
    const other = deriveScopeForTool("Bash", inner);
    return other === "shell.exec" ? "repo.write" : other;
  }
  const readOnly = segments.length > 0 && segments.every((s) => {
    const first = s.trim().replace(/^&\s*/, "").split(/\s+/)[0]?.replace(/^["']|["']$/g, "").toLowerCase() ?? "";
    return READ_ONLY.has(first) || GIT_READ.test(s.trim());
  });
  if (readOnly) return "repo.read";
  return deriveScopeForTool("Bash", inner);
}

type Call = { id?: string; scope: string; artifact?: { uri: string; sha256: string } };

/** Builds the per-run line parser. Stateful: a command is seen at item.started and again at item.completed. */
export function codexActionParser(): (line: string) => Call[] | undefined {
  const seen = new Set<string>();
  return (line) => {
    if (!line.includes("\"item.")) return undefined;
    let o: any;
    try { o = JSON.parse(line); } catch { return undefined; }
    if ((o.type !== "item.started" && o.type !== "item.completed") || !o.item) return undefined;
    const it = o.item;
    const id = typeof it.id === "string" ? it.id : undefined;
    if (id && seen.has(id)) return undefined;
    let scope: string | undefined;
    let tool = it.type as string;
    if (it.type === "command_execution" && typeof it.command === "string") scope = scopeForShellCommand(it.command);
    else if (it.type === "file_change") scope = "repo.write";
    else if (it.type === "web_search") scope = "web.read";
    else if (it.type === "mcp_tool_call" && typeof it.server === "string") {
      tool = `mcp__${it.server}__${it.tool ?? ""}`;
      scope = deriveScopeForTool(tool, "");
    }
    if (!scope) return undefined; // messages, reasoning, plans: no scope
    if (id) seen.add(id);
    if (it.type === "command_execution" && typeof it.command === "string") return [{ ...(id ? { id } : {}), scope, artifact: shellArtifact(it.command) }];
    return [{ ...(id ? { id } : {}), scope, artifact: { uri: `asp://tool-call/${tool}`, sha256: sha256Id(new TextEncoder().encode(JSON.stringify(it.command ?? it.changes ?? it.query ?? it.arguments ?? {}))) } }];
  };
}
