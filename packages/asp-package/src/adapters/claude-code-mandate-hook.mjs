#!/usr/bin/env node
// The pre-call half of the kill switch, for an ASP agent running in Claude Code under a Mandate.
//
// `asp run --contract <id>` snapshots the contract's live Mandate scopes into asp-mandate.json next
// to this script's plugin. Before every tool call this PreToolUse hook maps the call to an ASP scope
// and blocks it (exit 2) unless the Mandate grants that scope, so an out-of-scope call never runs.
// Claude Code treats any other failure of a hook as "do not block", so this hook fails CLOSED: any
// error at all (bad input, a missing or corrupt Mandate file) blocks. It makes no network calls.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Must stay in step with `deriveScopeForTool` in packages/asp-package/src/package.ts (the compliance
 * bridge maps the same calls with it); test/mandate-hook.test.ts checks the two agree.
 */
export function deriveScopeForTool(tool, arg) {
  if (["Read", "Grep", "Glob", "LS", "NotebookRead"].includes(tool)) return "repo.read";
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) return "repo.write";
  if (tool === "WebFetch" || tool === "WebSearch") return "web.read";
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

/** Planning tools with no side effects; a copy of NO_SCOPE_TOOLS in package.ts (a test keeps them in step). */
export const NO_SCOPE_TOOLS = ["TodoWrite", "ExitPlanMode"];

/** Same call-to-scope mapping the compliance bridge uses on the live stream. */
export function scopeOfCall(event) {
  const arg = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";
  return deriveScopeForTool(event.tool_name, arg);
}

/**
 * Exact membership, like the log's own check (`EventLog.checkAction`). `gate` is the Mandate's
 * irreversible policy: a granted scope it names needs the principal's approval (`mode: "ask"`, the
 * call is held until a signed resolution answers it) or is forbidden outright (`mode: "deny"`).
 */

/**
 * The known-bad check: a shell command whose fingerprint an upheld report has marked harmful is blocked even
 * when its scope is granted. Copy of unwrapShell/normalizeCommand/shellArtifact in codex-actions.ts (a test keeps them in step).
 */
function unwrapShell(command) {
  const m = /^\s*"?[^"]*?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:-\w+\s+)*-Command\s+(.+)$/is.exec(command)
    ?? /^\s*"?[^"]*?(?:bash|sh|zsh)(?:\.exe)?"?\s+-\w*c\s+(.+)$/is.exec(command)
    ?? /^\s*"?[^"]*?cmd(?:\.exe)?"?\s+\/c\s+(.+)$/is.exec(command);
  if (!m) return command.trim();
  const inner = m[1].trim();
  const q = inner[0];
  return (q === "'" || q === "\"") && inner.endsWith(q) ? inner.slice(1, -1).replace(/''/g, "'") : inner;
}
export function shellFingerprint(command) {
  const normalized = unwrapShell(command).trim().replace(/\s+/g, " ");
  return `asp://shell-command#sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

/** Copy of isOwnMemoryWrite in package.ts: a write into the agent's own memory folder for this run needs no scope. */
export function isOwnMemoryWrite(tool, input, memoryDir) {
  if (!memoryDir || !["Write", "Edit", "MultiEdit"].includes(tool)) return false;
  const target = input?.file_path;
  if (typeof target !== "string" || !target) return false;
  const norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();
  const root = norm(memoryDir).replace(/\/$/, "") + "/";
  return norm(target).startsWith(root);
}

export function decide(event, scopes, gate, memoryDir, knownBad) {
  if (typeof event?.tool_name !== "string") return { allow: false, scope: "", reason: "ASP Mandate hook: the call has no tool_name" };
  if (NO_SCOPE_TOOLS.includes(event.tool_name)) return { allow: true, scope: "" };
  if (isOwnMemoryWrite(event.tool_name, event.tool_input, memoryDir)) return { allow: true, scope: "" };
  const scope = scopeOfCall(event);
  if (knownBad?.length && (event.tool_name === "Bash" || event.tool_name === "PowerShell") && typeof event.tool_input?.command === "string") {
    const hit = knownBad.find((k) => k.fingerprint === shellFingerprint(event.tool_input.command));
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

const summarize = (event) => {
  const text = typeof event.tool_input?.command === "string" ? event.tool_input.command : JSON.stringify(event.tool_input ?? {});
  return text.length > 2000 ? text.slice(0, 2000) + "..." : text;
};

/**
 * Holds a gated call: drops a request for `asp run` (which raises the Checkpoint in the log) and waits
 * for its decision file, which `asp run` writes once the principal's signed checkpoint_resolution is
 * in the log. No answer in time is a refusal, never an approval.
 */
async function askPrincipal(pluginRoot, event, scope, waitSeconds) {
  const dir = join(resolve(pluginRoot, ".."), "approvals");
  mkdirSync(dir, { recursive: true });
  const id = String(event.tool_use_id ?? randomUUID()).replace(/[^A-Za-z0-9_-]/g, "_");
  const tmp = join(dir, `${id}.request.tmp`);
  writeFileSync(tmp, JSON.stringify({ id, tool: event.tool_name, scope, summary: summarize(event), requested_at: new Date().toISOString() }));
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

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(here, "..");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input);
  // The same script is registered for the runtime's post-call events. PostToolUse and PostToolUseFailure
  // fire only for a call that actually ran (never for one a hook blocked or the runtime's own
  // permissions refused), so this record is what asp run trusts, instead of guessing from result text.
  if (event.hook_event_name === "PostToolUse" || event.hook_event_name === "PostToolUseFailure") {
    appendFileSync(join(pluginRoot, "..", "executed-calls.ndjson"), JSON.stringify({
      at: new Date().toISOString(), id: event.tool_use_id, tool: event.tool_name, failed: event.hook_event_name === "PostToolUseFailure",
    }) + "\n");
    return;
  }
  const mandate = JSON.parse(readFileSync(join(pluginRoot, "asp-mandate.json"), "utf8"));
  if (!Array.isArray(mandate.scopes)) throw new Error("asp-mandate.json has no scopes list");
  const d = decide(event, mandate.scopes, mandate.gate, typeof mandate.memoryDir === "string" ? mandate.memoryDir : undefined, Array.isArray(mandate.knownBad) ? mandate.knownBad : undefined);
  if (d.allow && !d.ask) return;
  if (d.ask) {
    const answer = await askPrincipal(pluginRoot, event, d.scope, mandate.gate.waitSeconds ?? 600);
    if (answer.approved) return;
    d.reason = `ASP Mandate: the scope ${d.scope} needs the principal's approval and it was not given${answer.reason ? `: ${answer.reason}` : ""}`;
  }
  try {
    appendFileSync(join(pluginRoot, "..", "blocked-calls.ndjson"), JSON.stringify({ at: new Date().toISOString(), tool: event.tool_name, scope: d.scope }) + "\n");
  } catch { /* the block itself must not depend on the record of it */ }
  process.stderr.write(d.reason + "\n");
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`ASP Mandate hook failed closed: ${e.message}\n`);
    process.exit(2);
  });
}
