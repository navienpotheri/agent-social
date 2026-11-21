// What a tool call is aimed at, as short tokens (register row DK92): host:<name>, path:<relative path>, cmd:<program>[/<first argument>]. The gateway records the tokens of a refused call
// and of the calls that ran, so the circumvention detector can see a refused action come back in allowed pieces. Tokens only: never a query string, a header, a secret or a command line.
import { commandOf, type ToolCall } from "./judge.ts";

const MAX_TOKEN = 200;
const PATH_KEYS = ["path", "file_path", "filePath", "file", "filename", "target_file", "AbsolutePath", "TargetFile"];
const URL_RE = /\bhttps?:\/\/([A-Za-z0-9.-]+)/gi;

const clean = (s: string): string | undefined => {
  const t = s.replace(/\\/g, "/").replace(/^\.\//, "").replace(/[?#].*$/, "");
  return /^[!-~]{1,200}$/.test(t) ? t : undefined;
};

/** Up to eight distinct tokens for a call; empty when the call names nothing we can state safely. */
export function targetsOf(call: ToolCall): string[] {
  const out = new Set<string>();
  const add = (kind: string, v: string | undefined) => { if (v && `${kind}:${v}`.length <= MAX_TOKEN + 5) out.add(`${kind}:${v}`); };
  for (const k of PATH_KEYS) { const v = call.args[k]; if (typeof v === "string") add("path", clean(v)); }
  for (const v of Object.values(call.args)) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(URL_RE)) add("host", m[1].toLowerCase());
  }
  const cmd = commandOf(call.args);
  if (cmd) {
    for (const m of cmd.matchAll(URL_RE)) add("host", m[1].toLowerCase());
    const words = cmd.trim().split(/\s+/);
    const prog = clean((words[0] ?? "").split("/").pop() ?? "");
    if (prog && /^[A-Za-z0-9._-]+$/.test(prog)) {
      // Only an immediate sub-command (git push, npm publish): a word after a flag may be a header value or a secret.
      const sub = words[1] && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(words[1]) ? words[1] : undefined;
      add("cmd", sub ? `${prog}/${sub}` : prog);
    }
  }
  return [...out].slice(0, 8);
}
