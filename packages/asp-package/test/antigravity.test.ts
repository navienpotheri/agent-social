import { test } from "node:test";
import assert from "node:assert/strict";
import { agyActionParser, agyFailure, scopeForAgyTool } from "../src/adapters/antigravity.ts";

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
  assert.equal(scopeForAgyTool("task_boundary"), undefined);
  assert.equal(scopeForAgyTool("notify_user"), undefined);
  assert.equal(scopeForAgyTool("some_new_tool"), "tool.some_new_tool", "an unknown tool is not assumed harmless");
});

test("the parser reads the documented stream-json events: one call per tool step, at its start", () => {
  const parse = agyActionParser();
  const step = (state: string, over: Record<string, unknown> = {}) => JSON.stringify({
    type: "step_update", payload: { step_index: 3, step_type: "tool", state, tool_info: { name: "run_command", parameters: { CommandLine: "node x.js" } }, ...over },
  });
  const first = parse(step("ACTIVE"))!;
  assert.equal(first.length, 1);
  assert.equal(first[0].id, "step-3");
  assert.equal(first[0].scope, "shell.exec");
  assert.match(first[0].artifact!.uri, /asp:\/\/tool-call\/run_command/);
  assert.equal(parse(step("DONE")), undefined, "the same step finishing is not a second call");
  assert.equal(parse(JSON.stringify({ type: "step_update", payload: { step_index: 4, step_type: "agent_response", state: "DONE", text_delta: "hi" } })), undefined);
  assert.equal(parse(JSON.stringify({ type: "init", payload: { cwd: "/p" } })), undefined);
  assert.equal(parse(JSON.stringify({ type: "step_update", payload: { step_index: 5, step_type: "tool", state: "ACTIVE", tool_info: { name: "task_boundary", parameters: {} } } })), undefined);
  assert.equal(parse("not json {"), undefined);
});

test("a result with status ERROR is a failed run even though agy may exit 0", () => {
  assert.match(agyFailure(JSON.stringify({ type: "result", payload: { status: "ERROR", error: "quota" } }))!, /ERROR: quota/);
  assert.equal(agyFailure(JSON.stringify({ type: "result", payload: { status: "SUCCESS" } })), undefined);
  assert.equal(agyFailure("plain text"), undefined);
});
