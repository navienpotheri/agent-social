/**
 * Reading a script file for the requests it makes (gap H17): the calls it contains, the loop around them, and the URLs it names. Self-contained (node:fs and node:path only)
 * so it is the one source for the gateway (script-requests.ts imports it) and for the Claude Code and Antigravity pre-call hooks, copied in by adapters/guard-copy.ts the way
 * gateway/paths.ts is (gap H29); the two readings cannot drift apart. A script that imports a sibling file inside the project is read one level in (that file's own imports are
 * not followed); a script that imports an installed package, a binary, or builds its target at run time is still only seen as far as what is written in the files read (left in
 * H17).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";

export interface RequestCounts { perHost: Record<string, number>; unknown: number; total: number }
export const UNBOUNDED = 1000;

const MAX_BYTES = 200_000;
const SCRIPT_EXT = /\.(py|js|mjs|cjs|ts|sh|bash)$/i;
const CALLS = /\b(?:requests|httpx|session|client|aiohttp|urllib3?|http)\.(?:get|post|put|delete|head|patch|request)\s*\(|\burlopen\s*\(|\burlretrieve\s*\(|\bhttp\.client\b|\bfetch\s*\(|\baxios(?:\.\w+)?\s*\(|\bhttps?\.(?:get|request)\s*\(|\bsocket\.(?:connect|create_connection)\b|\bconnect_ex\s*\(|\bnet\.(?:connect|createConnection)\s*\(|(?:subprocess|os\.system|exec|spawn)[^\n]*\b(?:curl|wget)\b/g;
const LOOPS = /\b(?:for|while)\b|\.forEach\s*\(|\.map\s*\(|asyncio\.gather|Promise\.all|ThreadPool|ProcessPool|\bimap\b/;
const URL_LIT = /\bhttps?:\/\/(\[[0-9a-f:]+\]|[a-z0-9._-]+)/gi;
const JS_IMPORT = /\bfrom\s+["'](\.{1,2}\/[^"']+)["']|\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
const PY_IMPORT = /^\s*(?:from\s+(\.+[\w.]*)\s+import|import\s+(\w[\w.]*)\s*$)/gm;

/**
 * The requests one script's text makes, or undefined when it makes none that can be seen. `lang` says how to read it; a shell script is read as a command, so it needs
 * `requestsOfCommand` (the gateway's copy, or a hook's own) — without one, a shell script is not read.
 */
export function requestsOfScript(text: string, lang: "shell" | "other", requestsOfCommand?: (command: string) => RequestCounts): RequestCounts | undefined {
  if (lang === "shell") {
    if (!requestsOfCommand) return undefined;
    const r = requestsOfCommand(text);
    return r.total > 0 && (Object.keys(r.perHost).length || r.unknown) ? r : undefined;
  }
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

function merge(a: RequestCounts | undefined, b: RequestCounts | undefined): RequestCounts | undefined {
  if (!a) return b;
  if (!b) return a;
  const perHost: Record<string, number> = { ...a.perHost };
  for (const [h, n] of Object.entries(b.perHost)) perHost[h] = Math.max(perHost[h] ?? 0, n);
  const unknown = a.unknown + b.unknown;
  return { perHost, unknown, total: Object.values(perHost).reduce((n, c) => n + c, 0) + unknown };
}

function readScript(file: string): string | undefined {
  try {
    if (!existsSync(file) || statSync(file).size > MAX_BYTES) return undefined;
    return readFileSync(file, "utf8");
  } catch { return undefined; }
}
function langOf(file: string): "shell" | "other" { return /\.(sh|bash)$/i.test(file) ? "shell" : "other"; }

/** A script file's own relative imports, resolved to sibling files that exist (gap H17: followed one level in; what they in turn import is not read). */
export function scriptImports(file: string, text: string): string[] {
  if (langOf(file) === "shell") return [];
  const dir = dirname(file);
  const out = new Set<string>();
  for (const m of text.matchAll(JS_IMPORT)) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    for (const ext of ["", ".js", ".mjs", ".cjs", ".ts"]) {
      const p = resolve(dir, spec + ext);
      if (existsSync(p) && statSync(p).isFile()) { out.add(p); break; }
    }
  }
  for (const m of text.matchAll(PY_IMPORT)) {
    const mod = (m[1] ?? m[2])?.replace(/^\.+/, "").split(".").filter(Boolean).pop();
    if (!mod) continue;
    const p = resolve(dir, `${mod}.py`);
    if (existsSync(p) && statSync(p).isFile()) out.add(p);
  }
  return [...out];
}

/** One script file's requests, plus one level of the sibling files it imports (gap H17). */
export function requestsOfScriptFile(file: string, requestsOfCommand?: (command: string) => RequestCounts): RequestCounts | undefined {
  const text = readScript(file);
  if (text === undefined) return undefined;
  let out = requestsOfScript(text, langOf(file), requestsOfCommand);
  for (const sib of scriptImports(file, text)) {
    const sibText = readScript(sib);
    if (sibText === undefined) continue;
    out = merge(out, requestsOfScript(sibText, langOf(sib), requestsOfCommand));
  }
  return out;
}

/** The script files a shell command names that live inside `root`: absolute or relative tokens ending in a script extension, resolved and confined to root. */
export function scriptFilesIn(command: string, root: string): string[] {
  const out: string[] = [];
  for (const tok of command.split(/\s+/)) {
    const t = tok.replace(/^["']|["']$/g, "");
    if (!SCRIPT_EXT.test(t)) continue;
    const file = isAbsolute(t) ? resolve(t) : resolve(root, t);
    if (file !== root && !file.startsWith(root + sep)) continue;
    out.push(file);
  }
  return out;
}

/** The requests the scripts a shell command runs make (gap H17), each followed one level into its own relative imports, or undefined when none are inside `root` or make a request that can be seen. */
export function scriptRequestsOfCommand(command: string, root: string, requestsOfCommand?: (command: string) => RequestCounts): RequestCounts | undefined {
  let out: RequestCounts | undefined;
  for (const file of scriptFilesIn(command, root)) out = merge(out, requestsOfScriptFile(file, requestsOfCommand));
  return out;
}
