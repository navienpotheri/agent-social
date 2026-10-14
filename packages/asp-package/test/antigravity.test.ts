import { test } from "node:test";
import assert from "node:assert/strict";
import { agyActionParser, agyFailure, agyReadable, scopeForAgyTool } from "../src/adapters/antigravity.ts";

test("agy tools map to scopes: reads, writes, web, shell by what the command does, bookkeeping none, unknown fails safe", () => {
  assert.equal(scopeForAgyTool("view_file", { AbsolutePath: "/p/a.ts" }), "repo.read");
  assert.equal(scopeForAgyTool("grep_search"), "repo.read");
  assert.equal(scopeForAgyTool("write_to_file"), "repo.write");
  assert.equal(scopeForAgyTool("replace_file_content"), "repo.write");
  assert.equal(scopeForAgyTool("read_url_content"), "web.read");
  assert.equal(scopeForAgyTool("run_command", { CommandLine: "git status" }), "repo.read");
  assert.equal(scopeForAgyTool("run_command", { command: "echo hi > out.txt" }), "repo.write");
  assert.equal(scopeForAgyTool("run_command", { CommandLine: "node build.js" }), "shell.exec");
  assert.equal(scopeForAgyTool("run_command", { CommandLine: "curl https://example.com" }), "shell.network");
  assert.equal(scopeForAgyTool("finish"), undefined);
  assert.equal(scopeForAgyTool("ask_permission"), undefined);
  assert.equal(scopeForAgyTool("command_status"), undefined);
  assert.equal(scopeForAgyTool("sed_file"), "repo.write");
  assert.equal(scopeForAgyTool("send_command_input"), "shell.exec");
  assert.equal(scopeForAgyTool("browser_click_element"), "browser.use");
  assert.equal(scopeForAgyTool("read_browser_page"), "web.read");
  assert.equal(scopeForAgyTool("call_mcp_tool", { ServerName: "github", ToolName: "create_issue" }), "mcp.github.create_issue");
  assert.equal(scopeForAgyTool("invoke_subagent"), "tool.invoke_subagent", "spawning a subagent is not assumed harmless");
  assert.equal(scopeForAgyTool("some_new_tool"), "tool.some_new_tool", "an unknown tool is not assumed harmless");
});

test("the parser reads the documented stream-json events: one call per tool step, at its start", () => {
  const parse = agyActionParser();
  const step = (state: string, over: Record<string, unknown> = {}) => JSON.stringify({
    event: "step_update", step_update: { conversation_id: "c", step_index: 3, step_type: "tool", state, tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "node x.js" } }, ...over },
  });
  const first = parse(step("ACTIVE"))!;
  assert.equal(first.length, 1);
  assert.equal(first[0].id, "step-3");
  assert.equal(first[0].scope, "shell.exec");
  assert.equal(first[0].artifact!.uri, "asp://shell-command", "a shell command has the same fingerprint on every runtime");
  assert.equal(parse(step("DONE")), undefined, "the same step finishing is not a second call");
  assert.equal(parse(JSON.stringify({ event: "step_update", step_update: { step_index: 4, step_type: "agent_response", state: "DONE", text_delta: "hi" } })), undefined);
  assert.equal(parse(JSON.stringify({ event: "init", init: { cwd: "/p" } })), undefined);
  assert.equal(parse(JSON.stringify({ event: "step_update", step_update: { step_index: 5, step_type: "tool", state: "ACTIVE", tool_name: "finish", tool_info: { name: "finish", parameters: {} } } })), undefined, "finish needs no scope");
  assert.equal(parse("not json {"), undefined);
});

test("a result with status ERROR is a failed run even though agy may exit 0", () => {
  assert.match(agyFailure(JSON.stringify({ event: "result", result: { status: "ERROR", error: "quota" } }))!, /ERROR: quota/);
  assert.equal(agyFailure(JSON.stringify({ event: "result", result: { status: "SUCCESS" } })), undefined);
  assert.equal(agyFailure("plain text"), undefined);
});

// Found in the owner's live run (UC-13): about thirty lines of agy's JSON events were printed to the terminal, and agy's own headless denial was a line in the middle of them.
test("agy's event stream is shown as readable lines: the answer, a failed tool in a short line, and a note when headless mode denied a command; other events show nothing", () => {
  const init = JSON.stringify({ event: "init", init: { cwd: "C:\\x", tools: ["list_dir"] } });
  const done = JSON.stringify({ event: "step_update", step_update: { state: "DONE", step_type: "agent_response", usage: { total_tokens: 5 } } });
  const active = JSON.stringify({ event: "step_update", step_update: { state: "ACTIVE", step_type: "tool", tool_name: "run_command" } });
  const failed = JSON.stringify({ event: "step_update", step_update: { state: "ERROR", step_type: "tool", tool_name: "run_command", error: { type: "TOOL_ERROR", message: "permission check failed for command Get-ChildItem -Force: user denied permission to run command\nDo not attempt to circumvent this denial" } } });
  for (const quiet of [init, done, active, "", "   "]) assert.equal(agyReadable(quiet), undefined, quiet);
  assert.equal(agyReadable(failed), "  agy      run_command failed: user denied permission to run command");
  const note = agyReadable('jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied. Add an allow-rule');
  assert.match(note!, /note\s+agy's headless mode cannot ask you/);
  assert.match(note!, /ASP_ANTIGRAVITY_ARGS=--dangerously-skip-permissions/);
  const answered = JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "There are 3 files.", denied_actions: [] } });
  assert.equal(agyReadable(answered), "There are 3 files.");
  const denied = JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "", denied_actions: [{ action: "command", display_name: "RunCommand" }] } });
  assert.equal(agyReadable(denied), "  note     agy's own permission check denied: RunCommand");
  assert.equal(agyReadable("plain text from agy"), "plain text from agy", "anything that is not an event passes as it is");
});
