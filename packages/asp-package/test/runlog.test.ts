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
