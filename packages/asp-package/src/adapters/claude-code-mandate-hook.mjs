#!/usr/bin/env node
// The pre-call half of the kill switch, for an ASP agent running in Claude Code under a Mandate.
//
// `asp run --contract <id>` snapshots the contract's live Mandate scopes into asp-mandate.json next
// to this script's plugin. Before every tool call this PreToolUse hook maps the call to an ASP scope
// and blocks it (exit 2) unless the Mandate grants that scope, so an out-of-scope call never runs.
// Claude Code treats any other failure of a hook as "do not block", so this hook fails CLOSED: any
// error at all (bad input, a missing or corrupt Mandate file) blocks. It makes no network calls.
import { appendFileSync, readFileSync } from "node:fs";
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

/** Same call-to-scope mapping the compliance bridge uses on the live stream. */
export function scopeOfCall(event) {
  const arg = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";
  return deriveScopeForTool(event.tool_name, arg);
}

/** Exact membership, like the log's own check (`EventLog.checkAction`). */
export function decide(event, scopes) {
  if (typeof event?.tool_name !== "string") return { allow: false, scope: "", reason: "ASP Mandate hook: the call has no tool_name" };
  const scope = scopeOfCall(event);
  if (scopes.includes(scope)) return { allow: true, scope };
  return { allow: false, scope, reason: `ASP Mandate: the scope ${scope} is not granted by this job's Mandate, so this call was blocked before it ran` };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(here, "..");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input);
  const mandate = JSON.parse(readFileSync(join(pluginRoot, "asp-mandate.json"), "utf8"));
  if (!Array.isArray(mandate.scopes)) throw new Error("asp-mandate.json has no scopes list");
  const d = decide(event, mandate.scopes);
  if (d.allow) return;
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
