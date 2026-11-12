/**
 * The requests a script makes (gap H17). A rate limit that reads the command text counts `python scan.py` as one request however many the script sends. When the command runs a
 * script that is inside the project, the gateway reads the script too: a shell script is read as a command; a Python or JavaScript file is read for the calls that make a request
 * (requests, httpx, urllib, fetch, axios, sockets, a subprocess running curl or wget) and for loops around them. A request call inside a loop, a thread pool or a gather counts as
 * unbounded (1000), unless it is `range(N)` with a number. The hosts are the URLs written in the file. It is still a reading of text: a script that imports another module, or
 * builds its target from input, is only seen as far as the file named on the command line (left in H17; the sandbox's egress proxy counts what such a script really connects to).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { requestsOf, requestsOfCommand, UNBOUNDED, type RequestCounts } from "./requests.ts";
import { commandOf, type ToolCall } from "./judge.ts";

const MAX_BYTES = 200_000;
const SCRIPT = /\.(py|js|mjs|cjs|ts|sh|bash)$/i;
const CALLS = /\b(?:requests|httpx|session|client|aiohttp|urllib3?|http)\.(?:get|post|put|delete|head|patch|request)\s*\(|\burlopen\s*\(|\burlretrieve\s*\(|\bhttp\.client\b|\bfetch\s*\(|\baxios(?:\.\w+)?\s*\(|\bhttps?\.(?:get|request)\s*\(|\bsocket\.(?:connect|create_connection)\b|\bconnect_ex\s*\(|\bnet\.(?:connect|createConnection)\s*\(|(?:subprocess|os\.system|exec|spawn)[^\n]*\b(?:curl|wget)\b/g;
const LOOPS = /\b(?:for|while)\b|\.forEach\s*\(|\.map\s*\(|asyncio\.gather|Promise\.all|ThreadPool|ProcessPool|\bimap\b/;
const URL_LIT = /\bhttps?:\/\/(\[[0-9a-f:]+\]|[a-z0-9._-]+)/gi;

/** The requests one script file makes, or undefined when it makes none that can be seen. `text` is the file; `lang` says how to read it. */
export function requestsOfScript(text: string, lang: "shell" | "other"): RequestCounts | undefined {
  if (lang === "shell") { const r = requestsOfCommand(text); return r.total > 0 && (Object.keys(r.perHost).length || r.unknown) ? r : undefined; }
  const calls = [...text.matchAll(CALLS)].length;
  if (!calls) return undefined;
  let per = calls;
  if (LOOPS.test(text)) {
    const bounded = /\bfor\s+\w+\s+in\s+range\(\s*(\d+)\s*\)/.exec(text);
    per = bounded && !/\bwhile\b/.test(text) ? calls * Number(bounded[1]) : UNBOUNDED;
  }
  per = Math.min(per, UNBOUNDED);
  const hosts = [...new Set([...text.matchAll(URL_LIT)].map((m) => m[1].replace(/^\[|\]$/g, "").toLowerCase()))];
  if (!hosts.length) return { perHost: {}, unknown: per, total: per };
  // The count is for the script as a whole: it is spread over the hosts it names, never less than one each.
  const perHost: Record<string, number> = {};
  const share = Math.max(1, Math.ceil(per / hosts.length));
  for (const h of hosts) perHost[h] = per >= UNBOUNDED ? UNBOUNDED : share;
  const total = Object.values(perHost).reduce((n, c) => n + c, 0);
  return { perHost, unknown: 0, total };
}

/** The requests of the scripts a shell command runs (files inside `projectDir`), or undefined when it runs none that make requests. */
export function scriptRequestsOf(call: ToolCall, projectDir?: string): RequestCounts | undefined {
  if (!projectDir) return undefined;
  const cmd = commandOf(call.args);
  if (!cmd) return undefined;
  const root = resolve(projectDir);
  let out: RequestCounts | undefined;
  for (const tok of cmd.split(/\s+/)) {
    const t = tok.replace(/^["']|["']$/g, "");
    if (!SCRIPT.test(t)) continue;
    const file = isAbsolute(t) ? resolve(t) : resolve(root, t);
    if (file !== root && !file.startsWith(root + sep)) continue;
    let text: string;
    try { if (!existsSync(file) || statSync(file).size > MAX_BYTES) continue; text = readFileSync(file, "utf8"); } catch { continue; }
    const r = requestsOfScript(text, /\.(sh|bash)$/i.test(t) ? "shell" : "other");
    if (!r) continue;
    const perHost: Record<string, number> = { ...(out?.perHost ?? {}) };
    for (const [h, n] of Object.entries(r.perHost)) perHost[h] = Math.max(perHost[h] ?? 0, n);
    const unknown = (out?.unknown ?? 0) + r.unknown;
    out = { perHost, unknown, total: Object.values(perHost).reduce((n, c) => n + c, 0) + unknown };
  }
  return out;
}

/**
 * The requests a tool call makes, counting the script a shell command runs when that script is a file inside `projectDir`: the larger of the command's own count and the script's,
 * per host. Without a project directory, or when no script makes requests, it is `requestsOf` alone.
 */
export function requestsOfCall(call: ToolCall, scope: string, projectDir?: string): RequestCounts {
  const base = requestsOf(call, scope);
  if (scope !== "shell.network") return base;
  const script = scriptRequestsOf(call, projectDir);
  if (!script) return base;
  const perHost: Record<string, number> = { ...base.perHost };
  for (const [h, n] of Object.entries(script.perHost)) perHost[h] = Math.max(perHost[h] ?? 0, n);
  // A command that named no host is counted as one request of unknown host; the script's count replaces that.
  const unknown = Math.max(base.unknown === 1 && Object.keys(script.perHost).length ? 0 : base.unknown, script.unknown);
  return { perHost, unknown, total: Object.values(perHost).reduce((n, c) => n + c, 0) + unknown };
}
