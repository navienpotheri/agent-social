import { test } from "node:test";
import assert from "node:assert/strict";
import { codexActionParser, scopeForShellCommand, unwrapShell } from "../src/adapters/codex-actions.ts";

const PS = (cmd: string) => `"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command '${cmd}'`.replace(/\\\\/g, "\\");

test("unwrapShell removes the PowerShell, bash and cmd wrappers Codex adds", () => {
  assert.equal(unwrapShell(PS("Get-Content -LiteralPath notes.txt")), "Get-Content -LiteralPath notes.txt");
  assert.equal(unwrapShell(`/bin/bash -lc "cat notes.txt"`), "cat notes.txt");
  assert.equal(unwrapShell("cmd.exe /c dir"), "dir");
  assert.equal(unwrapShell("git status"), "git status");
});

test("inspection commands read the repo; file changes write it; everything else is shell.exec", () => {
  assert.equal(scopeForShellCommand(PS("Get-Content -LiteralPath notes.txt")), "repo.read");
  assert.equal(scopeForShellCommand(`/bin/bash -lc "rg -n foo src | head -5"`), "repo.read");
  assert.equal(scopeForShellCommand("git diff HEAD~1"), "repo.read");
  assert.equal(scopeForShellCommand(PS("echo hi > out.txt")), "repo.write");
  assert.equal(scopeForShellCommand(PS("Set-Content a.txt hello")), "repo.write");
  assert.equal(scopeForShellCommand("rm -rf build"), "repo.write");
  assert.equal(scopeForShellCommand("node build.js"), "shell.exec");
  assert.equal(scopeForShellCommand("cat a.txt; node evil.js"), "shell.exec", "one non-read segment makes the whole command shell.exec");
});

test("network, push and test commands keep their stronger scopes", () => {
  assert.equal(scopeForShellCommand("git push origin main"), "repo.push");
  assert.equal(scopeForShellCommand("curl https://example.com"), "shell.network");
  assert.equal(scopeForShellCommand("curl https://example.com > page.html"), "shell.network");
  assert.equal(scopeForShellCommand("npm test"), "tests.run");
});

test("the parser reads real codex exec --json events once per item, ignoring messages", () => {
  const parse = codexActionParser();
  const started = JSON.stringify({ type: "item.started", item: { id: "item_1", type: "command_execution", command: PS("Get-Content -LiteralPath notes.txt"), status: "in_progress" } });
  const done = JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: PS("Get-Content -LiteralPath notes.txt"), exit_code: 0, status: "completed" } });
  const msg = JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "hi" } });
  const first = parse(started)!;
  assert.equal(first.length, 1);
  assert.equal(first[0].id, "item_1");
  assert.equal(first[0].scope, "repo.read");
  assert.match(first[0].artifact!.uri, /^asp:\/\/tool-call\/command_execution$/);
  assert.equal(parse(done), undefined, "the completion of an already-seen item is not a second call");
  assert.equal(parse(msg), undefined);
  assert.equal(parse("not json {"), undefined);
  const patch = parse(JSON.stringify({ type: "item.completed", item: { id: "item_2", type: "file_change", changes: [{ path: "a.ts", kind: "update" }], status: "completed" } }))!;
  assert.equal(patch[0].scope, "repo.write", "a patch is reported when it completes");
  const mcp = parse(JSON.stringify({ type: "item.started", item: { id: "item_3", type: "mcp_tool_call", server: "github", tool: "create_issue" } }))!;
  assert.equal(mcp[0].scope, "mcp.github.create_issue");
});
