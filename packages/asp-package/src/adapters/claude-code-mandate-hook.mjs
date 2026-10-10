#!/usr/bin/env node
// The pre-call half of the kill switch, for an ASP agent running in Claude Code under a Mandate.
//
// `asp run --contract <id>` snapshots the contract's live Mandate scopes into asp-mandate.json next
// to this script's plugin. Before every tool call this PreToolUse hook maps the call to an ASP scope
// and blocks it (exit 2) unless the Mandate grants that scope, so an out-of-scope call never runs.
// Claude Code treats any other failure of a hook as "do not block", so this hook fails CLOSED: any
// error at all (bad input, a missing or corrupt Mandate file) blocks. It makes no network calls.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  const isShell = event.tool_name === "Bash" || event.tool_name === "PowerShell";
  return rateRefusal(d.scope, isShell ? event.tool_input?.command : undefined, [event.tool_input?.url], mandate.rate, join(root, "..", "rate-calls.ndjson"));
}

export function decide(event, scopes, gate, memoryDir, knownBad, hosts) {
  if (typeof event?.tool_name !== "string") return { allow: false, scope: "", reason: "ASP Mandate hook: the call has no tool_name" };
  if (NO_SCOPE_TOOLS.includes(event.tool_name)) return { allow: true, scope: "" };
  if (isOwnMemoryWrite(event.tool_name, event.tool_input, memoryDir)) return { allow: true, scope: "" };
  const scope = scopeOfCall(event);
  if (knownBad?.length && (event.tool_name === "Bash" || event.tool_name === "PowerShell") && typeof event.tool_input?.command === "string") {
    const hit = knownBad.find((k) => k.fingerprint === shellFingerprint(event.tool_input.command));
    if (hit) return { allow: false, scope, reason: `ASP Mandate: the known-bad list (an upheld report, ${hit.report}) marks this command harmful, so it was blocked before it ran` };
  }
  if (scopes.includes(scope)) {
    const isShell = event.tool_name === "Bash" || event.tool_name === "PowerShell";
    const refusal = hostRefusal(scope, isShell ? event.tool_input?.command : undefined, [event.tool_input?.url], hosts);
    if (refusal) return { allow: false, scope, reason: `ASP Mandate: ${refusal}, so this call was blocked before it ran` };
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
      let decision;
      try { decision = JSON.parse(readFileSync(decisionFile, "utf8")); } catch { decision = undefined; } // half written: read it again on the next poll
      if (decision) return decision.approved === true ? { approved: true } : { approved: false, reason: decision.reason };
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  return { approved: false, reason: `no answer within ${waitSeconds} seconds` };
}

/** A call over the rate limit is refused without a strike: it goes in rate-limited.ndjson, not blocked-calls.ndjson, and its message does not say "ASP Mandate". */
function refuseRate(pluginRoot, event, scope, reason) {
  try { appendFileSync(join(pluginRoot, "..", "rate-limited.ndjson"), JSON.stringify({ at: new Date().toISOString(), tool: event.tool_name, scope }) + "\n"); } catch { /* the refusal does not depend on the record of it */ }
  process.stderr.write(`ASP rate limit: ${reason}, so this call was not run\n`);
  process.exit(2);
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
  const d = decide(event, mandate.scopes, mandate.gate, typeof mandate.memoryDir === "string" ? mandate.memoryDir : undefined, Array.isArray(mandate.knownBad) ? mandate.knownBad : undefined, Array.isArray(mandate.hosts) && mandate.hosts.length ? mandate.hosts : undefined);
  if (d.allow && !d.ask) {
    const slow = rateCheck(event, d, mandate, pluginRoot);
    if (!slow) return;
    return refuseRate(pluginRoot, event, d.scope, slow);
  }
  if (d.ask) {
    const answer = await askPrincipal(pluginRoot, event, d.scope, mandate.gate.waitSeconds ?? 600);
    if (answer.approved) {
      const slow = rateCheck(event, d, mandate, pluginRoot);
      if (!slow) return;
      return refuseRate(pluginRoot, event, d.scope, slow);
    }
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
