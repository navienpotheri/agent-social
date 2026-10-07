import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NO_SCOPE_TOOLS, deriveScopeForTool } from "../src/index.ts";
// @ts-expect-error: plain .mjs without type declarations
import { NO_SCOPE_TOOLS as HOOK_NO_SCOPE_TOOLS, decide, deriveScopeForTool as hookScope } from "../src/adapters/claude-code-mandate-hook.mjs";

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

test("the hook's list of scope-free planning tools matches package.ts, and they pass any Mandate", () => {
  assert.deepEqual(HOOK_NO_SCOPE_TOOLS, NO_SCOPE_TOOLS);
  for (const tool of NO_SCOPE_TOOLS) assert.equal(decide({ tool_name: tool, tool_input: {} }, []).allow, true, tool);
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

test("gates: a gated granted scope is held (ask) or blocked (deny); ungated and ungranted scopes are unchanged", () => {
  const scopes = ["repo.read", "shell.exec"];
  const bash = { tool_name: "Bash", tool_input: { command: "echo hi" } };
  assert.deepEqual(decide(bash, scopes, { scopes: ["shell.exec"], mode: "ask" }), { allow: true, ask: true, scope: "shell.exec" });
  const denied = decide(bash, scopes, { scopes: ["shell.exec"], mode: "deny" });
  assert.equal(denied.allow, false);
  assert.match(denied.reason!, /ASP Mandate: the scope shell\.exec is forbidden/);
  assert.deepEqual(decide({ tool_name: "Read", tool_input: {} }, scopes, { scopes: ["shell.exec"], mode: "ask" }), { allow: true, scope: "repo.read" });
  assert.equal(decide(bash, ["repo.read"], { scopes: ["shell.exec"], mode: "ask" }).allow, false, "a gate never grants a scope");
});

/** Starts the hook on a gated call and resolves with its exit code once it exits; `onRequest` sees the request file. */
function gatedCall(waitSeconds: number, onRequest?: (dir: string, id: string) => void) {
  const { run, script } = pluginRun(JSON.stringify({ scopes: ["repo.push"], gate: { scopes: ["repo.push"], mode: "ask", waitSeconds } }));
  const child = spawn(process.execPath, [script], { env: { ...process.env, ASP_HOOK_POLL_MS: "30" } });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  child.stdin.end(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin main" }, tool_use_id: "toolu_X1", session_id: "s" }));
  const dir = join(run, "approvals");
  const watcher = setInterval(() => {
    if (existsSync(dir) && readdirSync(dir).includes("toolu_X1.request.json")) { clearInterval(watcher); onRequest?.(dir, "toolu_X1"); }
  }, 20);
  return new Promise<{ code: number | null; stderr: string; dir: string }>((done) => child.on("exit", (code) => { clearInterval(watcher); done({ code, stderr, dir }); }));
}

test("the hook holds a gated call for an answer: approved runs it, refused or silent blocks it", async () => {
  const approved = await gatedCall(10, (dir, id) => writeFileSync(join(dir, `${id}.decision.json`), JSON.stringify({ approved: true })));
  assert.equal(approved.code, 0);
  const request = JSON.parse(readFileSync(join(approved.dir, "toolu_X1.request.json"), "utf8"));
  assert.deepEqual([request.tool, request.scope, request.summary], ["Bash", "repo.push", "git push origin main"]);

  const refused = await gatedCall(10, (dir, id) => writeFileSync(join(dir, `${id}.decision.json`), JSON.stringify({ approved: false, reason: "open a PR instead" })));
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /needs the principal's approval and it was not given: open a PR instead/);

  const silent = await gatedCall(1);
  assert.equal(silent.code, 2);
  assert.match(silent.stderr, /no answer within 1 seconds/);

  const garbled = await gatedCall(10, (dir, id) => writeFileSync(join(dir, `${id}.decision.json`), "{ not json"));
  assert.equal(garbled.code, 2, "an unreadable decision is a refusal, never an approval");
});
