#!/usr/bin/env node
// Path-scoped rules for an ASP agent running in Claude Code.
//
// Claude Code loads `.claude/rules/*.md` with `paths:` globs only from the project itself. An agent
// package carries its own rules, so this PreToolUse hook re-creates the behavior: the first time the
// agent reads or edits a file that matches a rule's globs, the rule is injected as additionalContext.
// Rules live next to this script's plugin in asp-rules.json; injected rule names are remembered per
// session in state/<session_id>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Glob → RegExp over POSIX paths: `**` any depth, `*` within a segment, `?` one char, `{a,b}` alternatives. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += `(?:${glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function matchingRules(rules, relPath, already) {
  return rules.filter((r) => !already.includes(r.name) && r.globs.some((g) => globToRegExp(g).test(relPath)));
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(here, "..");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input || "{}");
  const t = event.tool_input ?? {};
  const file = t.file_path ?? t.notebook_path ?? t.path;
  if (!file || !event.cwd) return;
  const rel = relative(event.cwd, resolve(event.cwd, file)).split("\\").join("/");
  if (rel.startsWith("../")) return;

  const rules = JSON.parse(readFileSync(join(pluginRoot, "asp-rules.json"), "utf8"));
  const stateDir = join(pluginRoot, "state");
  const stateFile = join(stateDir, `${String(event.session_id ?? "default").replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  const already = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : [];
  const hits = matchingRules(rules, rel, already);
  if (!hits.length) return;

  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify([...already, ...hits.map((r) => r.name)]));
  const text = hits.map((r) => `Rule ${r.name} (applies to ${r.globs.join(", ")}):\n\n${r.text}`).join("\n\n---\n\n");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event.hook_event_name ?? "PreToolUse", additionalContext: text },
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`asp rules hook: ${e.message}\n`);
    process.exit(0); // never block the agent over a rules lookup
  });
}
