#!/usr/bin/env node
// The pre-call half of the kill switch, for an ASP agent running in the Antigravity CLI (agy) under a Mandate.
//
// `asp run --contract <id>` snapshots the contract's live Mandate scopes into asp-mandate.json next to this script
// and registers it in the run workspace's .agents/hooks.json for PreToolUse and PostToolUse. Before every tool call
// the hook maps the call to an ASP scope and answers {"decision":"deny"} unless the Mandate grants it, so an
// out-of-scope call never runs. An "allow" does not widen what agy itself permits (checked on agy 1.3.1: a shell
// command that headless agy would refuse is still refused). agy treats a hook that crashes as a denied call (checked
// the same way), and this script also answers deny for any error of its own, so it fails CLOSED. It makes no network calls.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
// ---- Default-deny egress (S67, H11): a copy of isNetworkScope and hostAllowed (asp-core network.ts) and hostsOf (gateway/judge.ts);
// ---- a test keeps the copies in step. When the Mandate names hosts, a network call to any other host, or to one that cannot be read, is blocked.
export function isNetworkScope(scope) {
  return scope === "shell.network" || scope.startsWith("web.") || scope.startsWith("net.") || scope.startsWith("browser.");
}
export function hostAllowed(host, patterns) {
  const h = host.toLowerCase().replace(/\.$/, "");
  return patterns.some((p) => {
    const q = p.toLowerCase();
    return q.startsWith("*.") ? h.endsWith(q.slice(1)) && h.length > q.length - 1 : h === q;
  });
}
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s\/@'"<>]*@)?(\[[0-9a-f:]+\]|[a-z0-9._-]+)/gi;
const HOST_VERB_RE = /\b(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet|ping|nslookup|dig)\b([^|;&\n]*)/gi;
const BARE_HOST_RE = /^(?:[^@\s]+@)?((?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::|$|\/)/i;
/** The hosts a shell command or a URL argument would reach, as far as they can be read. */
export function hostsOfText(text) {
  const hosts = new Set();
  const add = (h) => hosts.add(h.replace(/^\[|\]$/g, "").toLowerCase());
  for (const m of text.matchAll(URL_RE)) add(m[1]);
  for (const verb of text.matchAll(HOST_VERB_RE)) {
    for (const tok of verb[1].trim().split(/\s+/)) {
      if (tok.startsWith("-") || tok.includes("://")) continue;
      const m = BARE_HOST_RE.exec(tok.replace(/^["']|["']$/g, ""));
      if (m) add(m[1]);
    }
  }
  return [...hosts];
}
/**
 * The refusal reason for a network call under a Mandate that names hosts, or undefined. `command` is a shell command (scope shell.network);
 * `urls` are the URL-like arguments of a web or browser tool. A call with neither (a web search) names no host and is not limited.
 */
export function hostRefusal(scope, command, urls, hosts) {
  if (!hosts || !isNetworkScope(scope)) return undefined;
  const texts = scope === "shell.network" ? [command ?? ""] : urls.filter((u) => typeof u === "string").map((u) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`));
  if (scope !== "shell.network" && !texts.length) return undefined;
  const found = [...new Set(texts.flatMap(hostsOfText))];
  if (!found.length) return "this job's Mandate limits network access to named hosts and this call's host cannot be determined";
  const outside = found.find((h) => !hostAllowed(h, hosts));
  return outside ? `the host ${outside} is not one this job's Mandate allows (${hosts.join(", ")})` : undefined;
}

// ---- Rate limits on network calls (H1, H17): a copy of RateLimiter (gateway/rate.ts). A hook is a new process for every call, so the calls of the last minute are
// ---- kept in a file (one line a call) and counted from it. The ledger is locked while a call is counted, so calls that start at the same moment are counted one after the other (H16).
const RATE_WINDOW_MS = 60_000;
// ---- requestsOfCommand: a copy of gateway/requests.ts (test/rate.test.ts keeps the two in step on a table of commands).
/** What a command or tool with no bound counts as. */
const UNBOUNDED = 1000;

const R_SCANNERS = /\b(nmap|masscan|zmap|hydra|medusa|ncrack|nikto|gobuster|dirb|dirbuster|ffuf|wfuzz|sqlmap|ab|wrk|siege|hey|vegeta|slowhttptest|hping3|nping)\b/i;
const R_URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s\/@'"<>]*@)?(\[[0-9a-f:]+\]|[a-z0-9._-]+)/gi;
const R_NET_VERB = /\b(curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet|ping|nslookup|dig|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i;
const R_URL_ONE = new RegExp(R_URL_RE.source, "i");
const R_BARE_HOST = /^(?:[^@\s]+@)?((?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::|$|\/)/i;

/** How many strings a brace list (a{1,2,3}), a numeric brace range (a{1..9}) or a curl range (a[1-9]) in a token stands for. */
function globCount(token) {
  let n = 1;
  for (const m of token.matchAll(/\{(\d+)\.\.(\d+)(?:\.\.(\d+))?\}/g)) n *= Math.floor(Math.abs(Number(m[2]) - Number(m[1])) / Math.max(1, Number(m[3] ?? 1))) + 1;
  for (const m of token.matchAll(/\{([^{}]*,[^{}]*)\}/g)) n *= m[1].split(",").length;
  for (const m of token.matchAll(/\[(\d+)-(\d+)\]/g)) n *= Math.abs(Number(m[2]) - Number(m[1])) + 1;
  for (const m of token.matchAll(/\[([a-z])-([a-z])\]/gi)) n *= Math.abs(m[2].charCodeAt(0) - m[1].charCodeAt(0)) + 1;
  return Math.min(n, UNBOUNDED);
}

/** How many times a loop (or a pipe into xargs, parallel or foreach) runs what is inside it; 1 when there is no loop; UNBOUNDED when it cannot be told. */
function loopFactor(cmd) {
  let f = 1;
  let any = false;
  const mul = (n) => { any = true; f = Math.min(UNBOUNDED, f * Math.max(1, n)); };
  // for x in a b c; do ... done
  for (const m of cmd.matchAll(/\bfor\s+\w+\s+in\s+([^;\n]*?)\s*(?:;|\n)\s*do\b/g)) {
    const list = m[1].trim();
    const seq = /(?:\$\(\s*)?\bseq\s+(?:-\w+\s+)*(\d+)(?:\s+(\d+))?(?:\s+(\d+))?/.exec(list);
    if (seq) { const [a, b, c] = [seq[1], seq[2], seq[3]].filter((x) => x !== undefined).map(Number); mul(c !== undefined ? Math.floor((c - a) / Math.max(1, b)) + 1 : b !== undefined ? b - a + 1 : a); continue; }
    if (/\$\(|\`|\*|\$\w/.test(list)) { mul(UNBOUNDED); continue; }
    mul(list.split(/\s+/).filter(Boolean).reduce((n, tok) => n + globCount(tok), 0));
  }
  // for ((i=0;i<N;i++))
  for (const m of cmd.matchAll(/\bfor\s*\(\(\s*\w+\s*=\s*(\d+)\s*;\s*\w+\s*(<=|<)\s*(\d+)/g)) mul(Number(m[3]) - Number(m[1]) + (m[2] === "<=" ? 1 : 0));
  if (/\bwhile\b|\buntil\b/.test(cmd) && /\bdo\b/.test(cmd)) mul(UNBOUNDED);
  if (/\|\s*(xargs|parallel)\b|\b(xargs|parallel)\b.*\bcurl\b/.test(cmd)) mul(UNBOUNDED);
  // PowerShell: 1..50 | ForEach-Object { ... }, foreach ($x in ...) { ... }, for ($i...)
  // A range (1..20) is a loop bound in PowerShell; inside braces (page{1..8}) it is a brace expansion, counted where the URL is.
  for (const m of cmd.matchAll(/(?<![{\w])(\d+)\s*\.\.\s*(\d+)\b/g)) mul(Math.abs(Number(m[2]) - Number(m[1])) + 1);
  if (/\b(ForEach-Object|foreach|%\s*\{)/i.test(cmd) && !/(?<![{\w])\d+\s*\.\.\s*\d+\b/.test(cmd)) mul(UNBOUNDED);
  if (/\bfor\s*\(\s*\$/i.test(cmd)) mul(UNBOUNDED);
  return any ? f : 1;
}

/** The requests a shell command makes, per host. Text in, counts out. */
export function requestsOfCommand(command) {
  const perHost = {};
  let unknown = 0;
  const add = (host, n) => {
    if (host) perHost[host] = Math.min(UNBOUNDED * 10, (perHost[host] ?? 0) + n); else unknown += n;
  };
  const loop = loopFactor(command);
  for (const segment of command.split(/\s*(?:&&|\|\||;|\n|\|)\s*/)) {
    if (!segment.trim()) continue;
    const scanner = R_SCANNERS.test(segment);
    const verb = R_NET_VERB.exec(segment)?.[1]?.toLowerCase();
    if (!scanner && !verb && !R_URL_ONE.test(segment)) continue;
    const tokens = segment.trim().split(/\s+/);
    let hosts = 0;
    for (const tok of tokens) {
      const clean = tok.replace(/^["']|["']$/g, "");
      const url = R_URL_ONE.exec(clean);
      const host = url ? url[1].replace(/^\[|\]$/g, "").toLowerCase() : (verb || scanner) && !clean.startsWith("-") ? R_BARE_HOST.exec(clean)?.[1]?.toLowerCase() : undefined;
      if (!host) continue;
      hosts++;
      add(host, (scanner ? UNBOUNDED : globCount(clean)) * loop);
    }
    // A recursive download, or a ping with no count, is as many as it likes.
    if (verb === "wget" && /\s(-\w*[rm]\w*|--recursive|--mirror)\b/.test(segment)) for (const h of Object.keys(perHost)) perHost[h] = Math.max(perHost[h], UNBOUNDED);
    if (verb === "ping") {
      const count = /\s-[cn]\s*(\d+)/.exec(segment);
      if (!count) { for (const h of Object.keys(perHost)) perHost[h] = Math.max(perHost[h], UNBOUNDED); }
      else for (const h of Object.keys(perHost)) perHost[h] = Math.min(UNBOUNDED, perHost[h] * Math.max(1, Number(count[1])));
    }
    if (!hosts) add(undefined, (scanner ? UNBOUNDED : 1) * loop);
  }
  const total = Object.values(perHost).reduce((n, c) => n + c, 0) + unknown;
  return { perHost, unknown, total };
}

/**
 * The refusal reason for a network call over the Mandate's rate limit, or undefined (and the call is counted). A call counts as the requests it makes (requestsOfCommand);
 * the ledger has one line a call with its per-host counts.
 */
/** Runs fn with the ledger locked (H16): a directory is made next to it, which only one process can do at a time; a lock older than five seconds is a crashed hook's and is taken over. */
function withLedgerLock(ledgerPath, fn) {
  const lock = ledgerPath + ".lock";
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const deadline = Date.now() + 3000;
  for (;;) {
    try { mkdirSync(lock); break; } catch (e) {
      if (e?.code !== "EEXIST") break; // the folder is not writable: count without a lock rather than not at all
      try { if (Date.now() - statSync(lock).mtimeMs > 5000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() > deadline) break;
      sleep(5 + Math.floor(Math.random() * 15));
    }
  }
  try { return fn(); } finally { try { rmSync(lock, { recursive: true, force: true }); } catch { /* already gone */ } }
}
export function rateRefusal(scope, command, urls, rate, ledgerPath, now = Date.now()) {
  if (!rate || !isNetworkScope(scope)) return undefined;
  return withLedgerLock(ledgerPath, () => rateRefusalLocked(scope, command, urls, rate, ledgerPath, now));
}
function rateRefusalLocked(scope, command, urls, rate, ledgerPath, now) {
  let counts = scope === "shell.network" && command ? requestsOfCommand(command) : undefined;
  if (!counts || counts.total === 0) {
    const texts = scope === "shell.network" ? [command ?? ""] : urls.filter((u) => typeof u === "string").map((u) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`));
    const hosts = texts.flatMap(hostsOfText);
    const perHost = {};
    for (const h of hosts) perHost[h] = (perHost[h] ?? 0) + 1;
    counts = { perHost, unknown: hosts.length ? 0 : 1, total: Math.max(1, hosts.length) };
  }
  const recent = [];
  if (existsSync(ledgerPath)) {
    for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
      if (!line) continue;
      try { const e = JSON.parse(line); if (e.t > now - RATE_WINDOW_MS) recent.push(e); } catch { /* a half-written line is not a call yet */ }
    }
  }
  const made = recent.reduce((n, e) => n + (e.total ?? 1), 0);
  if (rate.total_per_minute !== undefined && made + counts.total > rate.total_per_minute) {
    return counts.total > 1
      ? `this call makes about ${counts.total} network requests and ${made} were made in the last minute; this job's Mandate allows ${rate.total_per_minute} a minute`
      : `this job's Mandate allows ${rate.total_per_minute} network calls a minute and ${made} were made in the last minute`;
  }
  if (rate.per_host_per_minute !== undefined) {
    for (const [h, n] of Object.entries(counts.perHost)) {
      const before = recent.reduce((k, e) => k + (e.perHost?.[h] ?? 0), 0);
      if (before + n > rate.per_host_per_minute) {
        return n > 1
          ? `this call makes about ${n} requests to ${h} and ${before} were made in the last minute; this job's Mandate allows ${rate.per_host_per_minute} a minute to any one host`
          : `the host ${h} was called ${before} times in the last minute; this job's Mandate allows ${rate.per_host_per_minute} a minute to any one host`;
      }
    }
  }
  appendFileSync(ledgerPath, JSON.stringify({ t: now, perHost: counts.perHost, total: counts.total }) + "\n");
  return undefined;
}

/** Counts a network call that is going to run against the Mandate's rate limit; the refusal reason, or undefined. */
function rateCheck(event, d, mandate, root) {
  const call = event.toolCall ?? {};
  const cmd = call.name === "run_command" ? (call.args?.CommandLine ?? call.args?.command ?? call.args?.command_line ?? call.args?.cmd) : undefined;
  return rateRefusal(d.scope, typeof cmd === "string" ? cmd : undefined, [call.args?.Url, call.args?.url, call.args?.URL], mandate.rate, join(root, "rate-calls.ndjson"));
}

export function decide(event, scopes, gate, knownBad, hosts) {
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
    const cmd = call.name === "run_command" ? (call.args?.CommandLine ?? call.args?.command ?? call.args?.command_line ?? call.args?.cmd) : undefined;
    const refusal = hostRefusal(scope, typeof cmd === "string" ? cmd : undefined, [call.args?.Url, call.args?.url, call.args?.URL], hosts);
    if (refusal) return { allow: false, scope, reason: `ASP Mandate: ${refusal}, so this call was blocked before it ran` };
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
      let decision;
      try { decision = JSON.parse(readFileSync(decisionFile, "utf8")); } catch { decision = undefined; } // half written: read it again on the next poll
      if (decision) return decision.approved === true ? { approved: true } : { approved: false, reason: decision.reason };
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
  const d = decide(event, mandate.scopes, mandate.gate, Array.isArray(mandate.knownBad) ? mandate.knownBad : undefined, Array.isArray(mandate.hosts) && mandate.hosts.length ? mandate.hosts : undefined);
  const refuseRate = (reason) => {
    try { appendFileSync(join(root, "rate-limited.ndjson"), JSON.stringify({ at: new Date().toISOString(), tool: event.toolCall?.name, scope: d.scope }) + "\n"); } catch { /* the refusal does not depend on the record of it */ }
    answer({ decision: "deny", reason: `ASP rate limit: ${reason}, so this call was not run` });
  };
  if (d.allow && !d.ask) {
    const slow = rateCheck(event, d, mandate, root);
    if (slow) refuseRate(slow); else answer({ decision: "allow" });
    return;
  }
  if (d.ask) {
    const a = await askPrincipal(root, event, d.scope, mandate.gate.waitSeconds ?? 600);
    if (a.approved) {
      const slow = rateCheck(event, d, mandate, root);
      if (slow) refuseRate(slow); else answer({ decision: "allow" });
      return;
    }
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
