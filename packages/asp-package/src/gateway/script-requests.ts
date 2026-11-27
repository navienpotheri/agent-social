/**
 * The requests a script makes (gap H17). A rate limit that reads the command text counts `python scan.py` as one request however many the script sends. When the command runs a
 * script that is inside the project, the gateway reads the script too: a shell script is read as a command; a Python or JavaScript file is read for the calls that make a request
 * (requests, httpx, urllib, fetch, axios, sockets, a subprocess running curl or wget) and for loops around them, and for one level of the sibling files it imports. A request call
 * inside a loop, a thread pool or a gather counts as unbounded (1000), unless it is `range(N)` with a number. The hosts are the URLs written in the file. It is still a reading of
 * text: a script that imports a package or a binary, or builds its target from input, is only seen as far as the file (and the one level of imports) that can be read (left in
 * H17; the sandbox's egress proxy counts what such a script really connects to). The reading itself (gateway/script-scan.ts) is the one source copied into the runtime hooks
 * (adapters/guard-copy.ts), so the gateway and the hooks read a script the same way (gap H29).
 */
import { resolve } from "node:path";
import { requestsOf, requestsOfCommand, type RequestCounts } from "./requests.ts";
import { commandOf, type ToolCall } from "./judge.ts";
import { requestsOfScript as requestsOfScriptText, scriptRequestsOfCommand } from "./script-scan.ts";

/** `script-scan.ts`'s reading of one script's text, with the gateway's own `requestsOfCommand` behind a shell script. */
export function requestsOfScript(text: string, lang: "shell" | "other"): RequestCounts | undefined {
  return requestsOfScriptText(text, lang, requestsOfCommand);
}

/** The requests of the scripts a shell command runs (files inside `projectDir`, followed one level into their own relative imports), or undefined when it runs none that make requests. */
export function scriptRequestsOf(call: ToolCall, projectDir?: string): RequestCounts | undefined {
  if (!projectDir) return undefined;
  const cmd = commandOf(call.args);
  if (!cmd) return undefined;
  return scriptRequestsOfCommand(cmd, resolve(projectDir), requestsOfCommand);
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
