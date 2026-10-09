#!/usr/bin/env node
// The pre-call half of the kill switch, for an ASP agent running in the Antigravity CLI (agy) under a Mandate.
//
// `asp run --contract <id>` snapshots the contract's live Mandate scopes into asp-mandate.json next to this script
// and registers it in the run workspace's .agents/hooks.json for PreToolUse and PostToolUse. Before every tool call
// the hook maps the call to an ASP scope and answers {"decision":"deny"} unless the Mandate grants it, so an
// out-of-scope call never runs. An "allow" does not widen what agy itself permits (checked on agy 1.3.1: a shell
// command that headless agy would refuse is still refused). agy treats a hook that crashes as a denied call (checked
// the same way), and this script also answers deny for any error of its own, so it fails CLOSED. It makes no network calls.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---- the call-to-scope mapping: a copy of scopeForAgyTool and scopeForShellCommand (antigravity.ts, codex-actions.ts);
// ---- test/antigravity-hook.test.ts checks the copies agree.
const READ_TOOLS = new Set(["view_file", "list_dir", "grep_search", "find_by_name", "list_resources", "read_resource"]);
const WRITE_TOOLS = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"]);
const EXEC_TOOLS = new Set(["send_command_input", "notebook_execution", "run_workflow"]);
const WEB_TOOLS = new Set(["read_url_content", "search_web", "search_marketplace"]);
const BROWSER_READ = new Set(["read_browser_page", "browser_get_dom", "browser_get_network_request", "browser_list_network_requests", "list_browser_pages", "capture_browser_console_logs", "capture_browser_screenshot"]);
export const NO_SCOPE_TOOLS = new Set([
  "ask_permission", "ask_custom_permission", "ask_question", "command_status", "finish", "list_permissions", "list_plugin_accounts",
  "manage_task", "manage_inbox", "send_message", "wait", "wait_5_seconds", "manage_subagents", "define_subagent",
]);

function deriveScopeForTool(tool, arg) {
  if (tool === "Bash" || tool === "PowerShell") {
    if (/^git push/.test(arg)) return "repo.push";
    if (/^gh pr (create|merge)/.test(arg)) return arg.startsWith("gh pr merge") ? "pr.merge" : "pr.open";
    if (/(test|pytest|jest|vitest|cargo test|go test)/.test(arg)) return "tests.run";
    if (/\b(curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet|Invoke-WebRequest|Invoke-RestMethod|iwr)\b/i.test(arg)) return "shell.network";
    if (/\bhttps?:\/\/\S+/i.test(arg)) return "shell.network";
    return "shell.exec";
  }
  if (tool.startsWith("mcp__")) {
    const [, server, name] = tool.split("__");
    return `mcp.${server.toLowerCase().replace(/[^a-z0-9_]/g, "_")}${name ? `.${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}` : ""}`;
  }
  return `tool.${tool.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
}

const SHELL_READ_ONLY = new Set([
  "cat", "type", "ls", "dir", "pwd", "head", "tail", "wc", "grep", "rg", "findstr", "find", "tree", "stat", "file", "echo",
  "get-content", "get-childitem", "select-string", "get-item", "test-path", "get-location", "resolve-path", "measure-object",
  "gc", "gci", "sls", "write-output", "write-host",
]);
const GIT_READ = /^git\s+(status|diff|log|show|branch|ls-files|rev-parse|blame)\b/i;
const SHELL_WRITES = /(^|\s)(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|clear-content|mkdir|md|rm|del|cp|copy|mv|move|touch|tee|sed\s+-i|ni|ri|si|sc|ac)\b|>>?(?!&)/i;

function unwrapShell(command) {
  const m = /^\s*"?[^"]*?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:-\w+\s+)*-Command\s+(.+)$/is.exec(command)
    ?? /^\s*"?[^"]*?(?:bash|sh|zsh)(?:\.exe)?"?\s+-\w*c\s+(.+)$/is.exec(command)
    ?? /^\s*"?[^"]*?cmd(?:\.exe)?"?\s+\/c\s+(.+)$/is.exec(command);
  if (!m) return command.trim();
  const inner = m[1].trim();
  const q = inner[0];
  return (q === "'" || q === "\"") && inner.endsWith(q) ? inner.slice(1, -1).replace(/''/g, "'") : inner;
}

function scopeForShellCommand(command) {
  const inner = unwrapShell(command);
  const segments = inner.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  if (SHELL_WRITES.test(inner)) {
    const other = deriveScopeForTool("Bash", inner);
    return other === "shell.exec" ? "repo.write" : other;
  }
  const readOnly = segments.length > 0 && segments.every((s) => {
    const first = s.trim().replace(/^&\s*/, "").split(/\s+/)[0]?.replace(/^["']|["']$/g, "").toLowerCase() ?? "";
    return SHELL_READ_ONLY.has(first) || GIT_READ.test(s.trim());
  });
  if (readOnly) return "repo.read";
  return deriveScopeForTool("Bash", inner);
}

/** The scope of one agy tool call, or undefined for the agent's own bookkeeping. */
export function scopeForAgyTool(name, params = {}) {
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
  return `tool.${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
}


/**
 * The known-bad check: a shell command whose fingerprint an upheld report has marked harmful is blocked even
 * when its scope is granted. Copy of unwrapShell/normalizeCommand/shellArtifact in codex-actions.ts (a test keeps them in step).
 */
function unwrapShellForFingerprint(command) {
  const m = /^\s*"?[^"]*?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:-\w+\s+)*-Command\s+(.+)$/is.exec(command)
    ?? /^\s*"?[^"]*?(?:bash|sh|zsh)(?:\.exe)?"?\s+-\w*c\s+(.+)$/is.exec(command)
    ?? /^\s*"?[^"]*?cmd(?:\.exe)?"?\s+\/c\s+(.+)$/is.exec(command);
  if (!m) return command.trim();
  const inner = m[1].trim();
  const q = inner[0];
  return (q === "'" || q === "\"") && inner.endsWith(q) ? inner.slice(1, -1).replace(/''/g, "'") : inner;
}
export function shellFingerprint(command) {
  const normalized = unwrapShellForFingerprint(command).trim().replace(/\s+/g, " ");
  return `asp://shell-command#sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

/** Exact membership, like the log's own check. `gate` is the Mandate's irreversible policy (see the Claude Code hook). */
export function decide(event, scopes, gate, knownBad) {
  const call = event?.toolCall;
  if (typeof call?.name !== "string") return { allow: false, scope: "", reason: "ASP Mandate hook: the call has no tool name" };
  const scope = scopeForAgyTool(call.name, call.args ?? {});
  if (scope === undefined) return { allow: true, scope: "" };
  if (knownBad?.length && call.name === "run_command") {
    const cmd = call.args?.CommandLine ?? call.args?.command ?? call.args?.command_line ?? call.args?.cmd;
    const hit = typeof cmd === "string" ? knownBad.find((k) => k.fingerprint === shellFingerprint(cmd)) : undefined;
    if (hit) return { allow: false, scope, reason: `ASP Mandate: the known-bad list (an upheld report, ${hit.report}) marks this command harmful, so it was blocked before it ran` };
  }
  if (scopes.includes(scope)) {
    if (gate?.scopes?.includes(scope)) {
      if (gate.mode === "deny") return { allow: false, scope, reason: `ASP Mandate: the scope ${scope} is forbidden by this job's irreversible policy, so this call was blocked before it ran` };
      return { allow: true, ask: true, scope };
    }
    return { allow: true, scope };
  }
  return { allow: false, scope, reason: `ASP Mandate: the scope ${scope} is not granted by this job's Mandate, so this call was blocked before it ran` };
}

const summarize = (call) => {
  const text = typeof call.args?.CommandLine === "string" ? call.args.CommandLine : JSON.stringify(call.args ?? {});
  return text.length > 2000 ? text.slice(0, 2000) + "..." : text;
};

/** Holds a gated call until `asp run` writes the principal's decision; no answer in time is a refusal. */
async function askPrincipal(root, event, scope, waitSeconds) {
  const dir = join(root, "approvals");
  mkdirSync(dir, { recursive: true });
  const id = `step-${event.stepIdx ?? randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, "_");
  const tmp = join(dir, `${id}.request.tmp`);
  writeFileSync(tmp, JSON.stringify({ id, tool: event.toolCall.name, scope, summary: summarize(event.toolCall), requested_at: new Date().toISOString() }));
  renameSync(tmp, join(dir, `${id}.request.json`));
  const decisionFile = join(dir, `${id}.decision.json`);
  const poll = Number(process.env.ASP_HOOK_POLL_MS) > 0 ? Number(process.env.ASP_HOOK_POLL_MS) : 200;
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    if (existsSync(decisionFile)) {
      const decision = JSON.parse(readFileSync(decisionFile, "utf8"));
      return decision.approved === true ? { approved: true } : { approved: false, reason: decision.reason };
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  return { approved: false, reason: `no answer within ${waitSeconds} seconds` };
}

const answer = (o) => process.stdout.write(JSON.stringify(o) + "\n");

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "..");
  const phase = process.argv[2];
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input);
  // PostToolUse: a record of calls that actually ran, which `asp run` trusts instead of guessing from result text.
  if (phase === "post") {
    appendFileSync(join(root, "executed-calls.ndjson"), JSON.stringify({
      at: new Date().toISOString(), id: `step-${event.stepIdx}`, tool: event.toolCall?.name, failed: !!event.error,
      scope: scopeForAgyTool(event.toolCall?.name ?? "", event.toolCall?.args ?? {}),
    }) + "\n");
    answer({});
    return;
  }
  const mandate = JSON.parse(readFileSync(join(here, "asp-mandate.json"), "utf8"));
  if (!Array.isArray(mandate.scopes)) throw new Error("asp-mandate.json has no scopes list");
  const d = decide(event, mandate.scopes, mandate.gate, Array.isArray(mandate.knownBad) ? mandate.knownBad : undefined);
  if (d.allow && !d.ask) { answer({ decision: "allow" }); return; }
  if (d.ask) {
    const a = await askPrincipal(root, event, d.scope, mandate.gate.waitSeconds ?? 600);
    if (a.approved) { answer({ decision: "allow" }); return; }
    d.reason = `ASP Mandate: the scope ${d.scope} needs the principal's approval and it was not given${a.reason ? `: ${a.reason}` : ""}`;
  }
  try {
    appendFileSync(join(root, "blocked-calls.ndjson"), JSON.stringify({ at: new Date().toISOString(), tool: event.toolCall?.name, scope: d.scope }) + "\n");
  } catch { /* the block itself must not depend on the record of it */ }
  answer({ decision: "deny", reason: d.reason });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    // Fail closed: any error of this script is a denied call (a PostToolUse failure only loses its record).
    answer(process.argv[2] === "post" ? {} : { decision: "deny", reason: `ASP Mandate hook failed closed: ${e.message}` });
  });
}
