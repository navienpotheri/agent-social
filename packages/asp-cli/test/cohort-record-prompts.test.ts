// The open-model strand, step B: every model call can be recorded as sent (system text, messages after folding and the cache marks, tool definitions, max_tokens) with its reply, so that a prompt can be rebuilt and replayed through an open model for activations. Local only; the key is not in the record.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, DEFAULT_ECONOMY, type SocietyToolSet } from "@agent-social/asp-package";

const servers: Server[] = []; after(() => { for (const s of servers) s.close(); });
test("recordTurn receives each request as sent and its reply, with no key in it", async () => {
  let n = 0;
  const s = createServer((req, res) => { const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => { if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; } n++; const content = n < 2 ? [{ type: "tool_use", id: `t${n}`, name: "mcp__society__look", input: {} }] : [{ type: "text", text: "done" }]; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "m", stop_reason: n < 2 ? "tool_use" : "end_turn", content, usage: { input_tokens: 50, output_tokens: 5 } })); }); });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  const toolset = (): SocietyToolSet => ({ tools: [{ name: "look", description: "Look around.", input_schema: { type: "object", properties: {} }, run: async () => ({ ok: true, text: "A quiet square." }) }], system: () => "You are a citizen.", opening: () => "You arrive.", summary: () => "- looked" });
  const got: Array<{ agent: string; turn: number; request: { system: unknown; messages: unknown[]; tools: unknown[]; max_tokens: number }; reply: { content: unknown[]; usage: unknown } }> = [];
  await runCohort({ agents: ["a"], toolsetFor: () => toolset(), model: "m", keyEnv: "K", env: { K: "sk-ant-FAKE-record-0123456789" }, perAgentUsd: 50, totalUsd: 50, runDir: mkdtempSync(join(tmpdir(), "asp-rec-")), upstream: `http://127.0.0.1:${(s.address() as { port: number }).port}`, signal: new AbortController().signal, limits: { maxTurns: 10, maxTokens: 1_000_000 }, loop: { equivalentCalls: 1000, nearRepeats: 1000 }, economy: { ...DEFAULT_ECONOMY, cache: false, historyTurns: 8 }, replyTokens: 2048, recordTurn: (agent: string, e: never) => got.push({ agent, ...(e as object) } as never) } as never);
  assert.equal(got.length, 2, "one record for each model call");
  assert.equal(got[0]!.agent, "a"); assert.equal(got[0]!.request.max_tokens, 2048); assert.match(JSON.stringify(got[0]!.request.system), /You are a citizen/); assert.equal(got[0]!.request.tools.length, 1);
  assert.ok(got[1]!.request.messages.length > got[0]!.request.messages.length, "the second request carries the history as sent");
  assert.deepEqual((got[0]!.reply.content[0] as { type: string }).type, "tool_use"); assert.ok(got[0]!.reply.usage);
  assert.doesNotMatch(JSON.stringify(got), /sk-ant-FAKE/, "no key in a record");
});
