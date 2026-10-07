import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveScopeForTool } from "../src/index.ts";
// @ts-expect-error: plain .mjs without type declarations
import { decide, deriveScopeForTool as hookScope } from "../src/adapters/claude-code-mandate-hook.mjs";

const HOOK = fileURLToPath(new URL("../src/adapters/claude-code-mandate-hook.mjs", import.meta.url));

test("the hook maps calls to the same scopes the compliance bridge does", () => {
  const calls: [string, string][] = [
    ["Read", ""], ["Grep", ""], ["Edit", ""], ["Write", ""], ["WebFetch", ""], ["WebSearch", ""],
    ["Bash", "ls -la"], ["Bash", "git push origin main"], ["Bash", "gh pr create --fill"], ["Bash", "gh pr merge 3"],
    ["Bash", "npm test"], ["Bash", "pytest -q"], ["Bash", "curl https://example.com"], ["Bash", "ssh me@host"],
    ["Bash", "python fetch.py https://example.com/x"], ["Bash", "rm -rf /tmp/x"], ["PowerShell", "Invoke-WebRequest -Uri https://x.y"],
    ["mcp__github__create_issue", ""], ["mcp__Slack-Bot__post.message", ""], ["TodoWrite", ""], ["Task", ""], ["Skill", ""],
  ];
  for (const [tool, arg] of calls) assert.equal(hookScope(tool, arg), deriveScopeForTool(tool, arg), `${tool} ${arg}`);
});

test("decide allows a granted scope and blocks anything else, by exact scope", () => {
  const scopes = ["repo.read", "tests.run"];
  assert.equal(decide({ tool_name: "Read", tool_input: { file_path: "/x" } }, scopes).allow, true);
  assert.equal(decide({ tool_name: "Bash", tool_input: { command: "npm test" } }, scopes).allow, true);
  const blocked = decide({ tool_name: "Bash", tool_input: { command: "rm -rf /tmp/x" } }, scopes);
  assert.equal(blocked.allow, false);
  assert.equal(blocked.scope, "shell.exec");
  assert.match(blocked.reason!, /shell\.exec is not granted/);
  assert.equal(decide({ tool_name: "Edit", tool_input: {} }, scopes).allow, false);
  assert.equal(decide({ tool_name: "Read", tool_input: {} }, []).allow, false, "an empty Mandate grants nothing");
  assert.equal(decide({}, scopes).allow, false, "a call with no tool name is blocked");
});

/** A plugin dir laid out like the adapter's: <run>/plugin/{asp-mandate.json,scripts/asp-mandate.mjs}. */
function pluginRun(mandate: string | undefined) {
  const run = mkdtempSync(join(tmpdir(), "asp-mh-"));
  const plugin = join(run, "plugin");
  mkdirSync(join(plugin, "scripts"), { recursive: true });
  writeFileSync(join(plugin, "scripts", "asp-mandate.mjs"), readFileSync(HOOK));
  if (mandate !== undefined) writeFileSync(join(plugin, "asp-mandate.json"), mandate);
  return { run, script: join(plugin, "scripts", "asp-mandate.mjs") };
}
const callHook = (script: string, stdin: string) => spawnSync(process.execPath, [script], { input: stdin, encoding: "utf8" });
const event = (tool_name: string, command?: string) => JSON.stringify({ tool_name, tool_input: command ? { command } : {}, session_id: "s" });

test("the hook script exits 0 for a granted call and 2 with a reason for a blocked one, and records the block", () => {
  const { run, script } = pluginRun(JSON.stringify({ scopes: ["repo.read"] }));
  assert.equal(callHook(script, event("Read")).status, 0);
  const res = callHook(script, event("Bash", "rm -rf /tmp/x"));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /shell\.exec is not granted by this job's Mandate/);
  const lines = readFileSync(join(run, "blocked-calls.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].tool, lines[0].scope], ["Bash", "shell.exec"]);
  assert.ok(!existsSync(join(run, "plugin", "blocked-calls.ndjson")));
});

test("the hook fails closed: bad input, a missing or corrupt Mandate file, and a malformed scope list all block", () => {
  const good = pluginRun(JSON.stringify({ scopes: ["repo.read"] }));
  assert.equal(callHook(good.script, "not json").status, 2, "unparseable hook input");
  assert.equal(callHook(good.script, "").status, 2, "empty hook input");
  assert.equal(callHook(pluginRun(undefined).script, event("Read")).status, 2, "no Mandate file");
  assert.equal(callHook(pluginRun("{ not json").script, event("Read")).status, 2, "corrupt Mandate file");
  assert.equal(callHook(pluginRun(JSON.stringify({ scopes: "repo.read" })).script, event("Read")).status, 2, "scopes is not a list");
  assert.match(callHook(pluginRun(undefined).script, event("Read")).stderr, /failed closed/);
});
