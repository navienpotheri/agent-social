import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecorder, hashAfter, lastUserText, readRunLog, replyText, runLogArtifact } from "../src/index.ts";

const fresh = () => join(mkdtempSync(join(tmpdir(), "asp-runlog-")), "run-log.ndjson");

test("the run log is a hash chain: it verifies, commits to its head, and any edit or cut is found", () => {
  const path = fresh();
  const rec = new RunRecorder(path);
  rec.event("run_start", { contract: "c1" });
  rec.event("tool_call", { tool: "bash", scope: "shell.exec", allowed: false, reason: "not granted" });
  const mid = rec.head();
  rec.event("run_end", { exit_code: 0 });
  const ok = readRunLog(path);
  assert.equal(ok.ok, true);
  assert.equal(ok.events.length, 3);
  assert.equal(ok.head.hash, rec.head().hash);
  // An Action that committed to the first two events can be checked later against the file.
  assert.equal(hashAfter(ok.events, 2), mid.hash);
  assert.deepEqual(runLogArtifact(mid), { uri: "asp://run-log/2", sha256: mid.hash });
  // Editing a line is found; so is dropping one from the middle.
  const lines = readFileSync(path, "utf8").trim().split("\n");
  writeFileSync(path, [lines[0], lines[1].replace("not granted", "fine"), lines[2]].join("\n") + "\n");
  assert.match(readRunLog(path).problem!, /event 2 was changed/);
  writeFileSync(path, [lines[0], lines[2]].join("\n") + "\n");
  assert.match(readRunLog(path).problem!, /does not follow/);
});

test("secrets are masked and long text is cut before anything is written", () => {
  const path = fresh();
  const rec = new RunRecorder(path, 60);
  rec.event("model_request", { prompt: "use key sk-ant-api03-abcdefghijklmnopqrstuvwx and Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789 then run curl -u me:hunter2@x" });
  rec.event("model_reply", { text: "x".repeat(500) });
  const raw = readFileSync(path, "utf8");
  assert.ok(!raw.includes("sk-ant-api03"), "the API key is masked");
  assert.ok(!raw.includes("abcdefghijklmnopqrstuvwxyz0123456789"), "the bearer token is masked");
  assert.match(raw, /\.\.\.\[\+4\d\d chars\]/);
  assert.ok(rec.redactions >= 2);
});

test("the last user message and the reply text are read out of all three API shapes", () => {
  assert.equal(lastUserText({ messages: [{ role: "system", content: "s" }, { role: "user", content: "first" }, { role: "assistant", content: "a" }, { role: "user", content: [{ type: "text", text: "second" }] }] }), "second");
  assert.equal(lastUserText({ messages: [{ role: "user", content: "q" }, { role: "assistant", content: null }, { role: "tool", content: "out" }] }), "[tool result]");
  assert.equal(lastUserText({ input: "hello" }), "hello");
  assert.equal(lastUserText({ input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "from codex" }] }] }), "from codex");
  assert.equal(replyText({ choices: [{ message: { content: "chat" } }] }), "chat");
  assert.equal(replyText({ content: [{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }] }), "ab");
  assert.equal(replyText({ output: [{ type: "message", content: [{ type: "output_text", text: "resp" }] }] }), "resp");
});

test("the gateway writes the run log for streamed and whole replies on the chat and Messages APIs: request, reply text, tokens, tool calls", async () => {
  const { createServer } = await import("node:http");
  const { createGateway, openaiChunks, anthropicEvents } = await import("../src/index.ts");
  const chat = { id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "Looking.", tool_calls: [{ id: "a", type: "function", function: { name: "read_file", arguments: "{\"path\":\"n\"}" } }, { id: "b", type: "function", function: { name: "write_file", arguments: "{\"path\":\"y\"}" } }] } }] };
  const msg = { id: "m", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 7, output_tokens: 3 }, content: [{ type: "text", text: "Done reading." }] };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const r: any = req.url!.includes("messages") ? msg : chat;
    if (body.stream) { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of r.choices ? openaiChunks(r) : anthropicEvents(r)) res.write(e); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(r));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const path = fresh();
  const rec = new RunRecorder(path);
  const g = createGateway({ openaiUpstream: `${base}/v1`, anthropicUpstream: base, scopes: ["repo.read"], runLog: rec });
  const port = await g.listen();
  const url = `http://127.0.0.1:${port}`;
  const post = (p: string, b: unknown) => fetch(url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.text());
  await post("/v1/chat/completions", { model: "gpt-x", messages: [{ role: "user", content: "read n" }] });
  await post("/v1/chat/completions", { model: "gpt-x", stream: true, messages: [{ role: "user", content: "read n again" }] });
  await post("/v1/messages", { model: "claude-x", max_tokens: 5, stream: true, messages: [{ role: "user", content: [{ type: "text", text: "summarise" }] }] });
  await g.close();
  server.close();
  const events = readRunLog(path).events;
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds.filter((k) => k !== "tool_call"), ["model_request", "model_reply", "model_request", "model_reply", "model_request", "model_reply"]);
  const replies = events.filter((e) => e.kind === "model_reply").map((e) => e.data as any);
  assert.equal(replies[0].text, "Looking.", "whole reply text");
  assert.equal(replies[1].text, "Looking.", "streamed reply text");
  assert.equal(replies[2].text, "Done reading.", "streamed Messages text");
  assert.deepEqual([replies[0].tokens_in, replies[0].tokens_out], [10, 5]);
  assert.deepEqual([replies[2].tokens_in, replies[2].tokens_out], [7, 3]);
  const requests = events.filter((e) => e.kind === "model_request").map((e) => e.data as any);
  assert.deepEqual(requests.map((r) => [r.model, r.prompt]), [["gpt-x", "read n"], ["gpt-x", "read n again"], ["claude-x", "summarise"]]);
  const calls = events.filter((e) => e.kind === "tool_call").map((e) => e.data as any);
  assert.deepEqual(calls.map((c) => [c.tool, c.allowed]), [["read_file", true], ["write_file", false], ["read_file", true], ["write_file", false]]);
});

test("Claude Code and Codex output lines become run-log events: text, calls with inputs, results, how it ended", async () => {
  const { claudeCodeRunLogEvents, codexRunLogEvents } = await import("../src/index.ts");
  const j = (o: unknown) => JSON.stringify(o);
  assert.deepEqual(claudeCodeRunLogEvents(j({ type: "assistant", message: { content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } }] } })),
    [{ kind: "assistant_text", data: { text: "Reading." } }, { kind: "tool_call", data: { tool: "Bash", id: "t1", input: "ls -la" } }]);
  assert.deepEqual(claudeCodeRunLogEvents(j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "file.txt" }] }] } })),
    [{ kind: "tool_result", data: { id: "t1", text: "file.txt" } }]);
  const blocked = claudeCodeRunLogEvents(j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "ASP Mandate: the scope shell.exec is not granted" }] } }));
  assert.deepEqual(blocked[0].data, { id: "t2", text: "ASP Mandate: the scope shell.exec is not granted", error: true, blocked: true });
  assert.deepEqual(claudeCodeRunLogEvents(j({ type: "result", subtype: "success", num_turns: 3, duration_ms: 900, usage: { input_tokens: 10, output_tokens: 4 }, total_cost_usd: 0.01 })),
    [{ kind: "run_result", data: { status: "success", turns: 3, ms: 900, tokens_in: 10, tokens_out: 4, cost_usd: 0.01 } }]);
  assert.deepEqual(claudeCodeRunLogEvents("not json"), []);
  assert.deepEqual(claudeCodeRunLogEvents(j({ type: "system", subtype: "init" })), []);

  assert.deepEqual(codexRunLogEvents(j({ type: "item.started", item: { id: "i1", type: "command_execution", command: "ls" } })), [], "only completed items are kept");
  const cmd = codexRunLogEvents(j({ type: "item.completed", item: { id: "i1", type: "command_execution", command: "npm test", aggregated_output: "1 failing", exit_code: 1 } }));
  assert.deepEqual(cmd.map((e) => e.kind), ["tool_call", "tool_result"]);
  assert.deepEqual(cmd[1].data, { id: "i1", text: "1 failing", error: true, exit_code: 1 });
  assert.deepEqual(codexRunLogEvents(j({ type: "item.completed", item: { id: "i2", type: "agent_message", text: "Done." } })), [{ kind: "assistant_text", data: { text: "Done." } }]);
  assert.equal(codexRunLogEvents(j({ type: "item.completed", item: { id: "i3", type: "mcp_tool_call", server: "gh", tool: "issues", arguments: { n: 1 }, result: { content: [{ text: "ok" }] } } }))[0].data.tool, "mcp__gh__issues");
  assert.deepEqual(codexRunLogEvents(j({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 2 } })), [{ kind: "run_result", data: { tokens_in: 5, tokens_out: 2 } }]);
});

test("tool results are read out of the three API shapes, and the gateway keeps each once with the MCP calls it served", async () => {
  const { toolResultsIn, createGateway, RunRecorder: Rec } = await import("../src/index.ts");
  assert.deepEqual(toolResultsIn({ messages: [{ role: "user", content: "q" }, { role: "tool", tool_call_id: "a", content: "out-a" }] }), [{ id: "a", text: "out-a" }]);
  assert.deepEqual(toolResultsIn({ messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: [{ type: "text", text: "out-b" }] }] }] }), [{ id: "b", text: "out-b" }]);
  assert.deepEqual(toolResultsIn({ input: [{ type: "function_call_output", call_id: "c", output: "out-c" }] }), [{ id: "c", text: "out-c" }]);

  const { createServer } = await import("node:http");
  const server = createServer(async (req, res) => { for await (const _ of req) { /* drain */ } res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] })); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const path = fresh();
  const rec = new Rec(path);
  const g = createGateway({ openaiUpstream: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, scopes: ["repo.read"], runLog: rec, mcp: { asp: { memoryDir: mkdtempSync(join(tmpdir(), "asp-mem-")) }, upstreams: {} } });
  const url = `http://127.0.0.1:${await g.listen()}`;
  const chat = (messages: unknown[]) => fetch(`${url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages }) }).then((r) => r.text());
  await chat([{ role: "user", content: "go" }, { role: "assistant", content: null }, { role: "tool", tool_call_id: "a", content: "first result" }]);
  await chat([{ role: "user", content: "go" }, { role: "tool", tool_call_id: "a", content: "first result" }, { role: "tool", tool_call_id: "b", content: "second result with sk-ant-api03-abcdefghijklmnopqrstuvwx" }]);
  const rpc = (body: unknown) => fetch(`${url}/mcp/asp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "asp_memory_write", arguments: { name: "n", description: "d", content: "remember this" } } });
  await g.close();
  server.close();
  const events = readRunLog(path).events;
  const results = events.filter((e) => e.kind === "tool_result").map((e) => e.data as any);
  assert.deepEqual(results.map((r) => r.id), ["a", "b"], "a result in the history is recorded once");
  assert.ok(!readFileSync(path, "utf8").includes("sk-ant-api03"));
  const mcp = events.filter((e) => e.kind === "mcp_call").map((e) => e.data as any);
  assert.equal(mcp.length, 1);
  assert.deepEqual([mcp[0].server, mcp[0].tool], ["asp", "asp_memory_write"]);
  assert.match(mcp[0].result, /Saved n\.md/);
});
