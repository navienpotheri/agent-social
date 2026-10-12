/**
 * How many network requests a tool call makes, and to which hosts (gap H17). A rate limit that counts tool calls is gone round by putting many requests in one
 * command, so the limit counts requests: every URL a curl or wget names, a curl range (page[1-50]) or brace list (page{1..50}) as many, a loop around a
 * network command (for, while, xargs, parallel, foreach, a range) as many as it runs, and a scanner or flood tool, or a recursive download, as an
 * unbounded number (counted as 1000, so any rate limit refuses it). It is a reading of the command text, not a measurement: a script that makes its own
 * requests counts as one. The pre-call hooks carry a copy (test/rate.test.ts keeps them in step on a table of commands).
 */
import { hostsOf } from "./judge.ts";
import type { ToolCall } from "./judge.ts";
import { commandOf } from "./judge.ts";

export interface RequestCounts { perHost: Record<string, number>; /** Requests whose host could not be read. */ unknown: number; total: number }

/** What a command or tool with no bound counts as. */
export const UNBOUNDED = 1000;

const SCANNERS = /\b(nmap|masscan|zmap|hydra|medusa|ncrack|nikto|gobuster|dirb|dirbuster|ffuf|wfuzz|sqlmap|ab|wrk|siege|hey|vegeta|slowhttptest|hping3|nping)\b/i;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s\/@'"<>]*@)?(\[[0-9a-f:]+\]|[a-z0-9._-]+)/gi;
const NET_VERB = /\b(curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet|ping|nslookup|dig|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i;
const URL_ONE = new RegExp(URL_RE.source, "i");
const BARE_HOST = /^(?:[^@\s]+@)?((?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::|$|\/)/i;

/** How many strings a brace list (a{1,2,3}), a numeric brace range (a{1..9}) or a curl range (a[1-9]) in a token stands for. */
function globCount(token: string): number {
  let n = 1;
  for (const m of token.matchAll(/\{(\d+)\.\.(\d+)(?:\.\.(\d+))?\}/g)) n *= Math.floor(Math.abs(Number(m[2]) - Number(m[1])) / Math.max(1, Number(m[3] ?? 1))) + 1;
  for (const m of token.matchAll(/\{([^{}]*,[^{}]*)\}/g)) n *= m[1].split(",").length;
  for (const m of token.matchAll(/\[(\d+)-(\d+)\]/g)) n *= Math.abs(Number(m[2]) - Number(m[1])) + 1;
  for (const m of token.matchAll(/\[([a-z])-([a-z])\]/gi)) n *= Math.abs(m[2].charCodeAt(0) - m[1].charCodeAt(0)) + 1;
  return Math.min(n, UNBOUNDED);
}

/** How many times a loop (or a pipe into xargs, parallel or foreach) runs what is inside it; 1 when there is no loop; UNBOUNDED when it cannot be told. */
function loopFactor(cmd: string): number {
  let f = 1;
  let any = false;
  const mul = (n: number) => { any = true; f = Math.min(UNBOUNDED, f * Math.max(1, n)); };
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
export function requestsOfCommand(command: string): RequestCounts {
  const perHost: Record<string, number> = {};
  let unknown = 0;
  const add = (host: string | undefined, n: number) => {
    if (host) perHost[host] = Math.min(UNBOUNDED * 10, (perHost[host] ?? 0) + n); else unknown += n;
  };
  const loop = loopFactor(command);
  for (const segment of command.split(/\s*(?:&&|\|\||;|\n|\|)\s*/)) {
    if (!segment.trim()) continue;
    const scanner = SCANNERS.test(segment);
    const verb = NET_VERB.exec(segment)?.[1]?.toLowerCase();
    if (!scanner && !verb && !URL_ONE.test(segment)) continue;
    const tokens = segment.trim().split(/\s+/);
    let hosts = 0;
    for (const tok of tokens) {
      const clean = tok.replace(/^["']|["']$/g, "");
      const url = URL_ONE.exec(clean);
      const host = url ? url[1].replace(/^\[|\]$/g, "").toLowerCase() : (verb || scanner) && !clean.startsWith("-") ? BARE_HOST.exec(clean)?.[1]?.toLowerCase() : undefined;
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

/** The requests a tool call makes: a shell command is read as above; a fetch or a browser open is one request to its URL's host. */
export function requestsOf(call: ToolCall, scope: string): RequestCounts {
  if (scope === "shell.network") {
    const cmd = commandOf(call.args);
    if (cmd) { const r = requestsOfCommand(cmd); if (r.total > 0) return r; }
  }
  const hosts = hostsOf(call, scope);
  const perHost: Record<string, number> = {};
  for (const h of hosts) perHost[h] = (perHost[h] ?? 0) + 1;
  return { perHost, unknown: hosts.length ? 0 : 1, total: Math.max(1, hosts.length) };
}
