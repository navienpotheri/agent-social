// The open-model strand: smoke-endpoint against a tiny local HTTP server that mimics /v1/messages (vLLM and SGLang serve the Anthropic Messages API): a good server is OK; a server that never calls the tool is reported as no tool call; a server that answers 404 is reached but refused; a closed port is not reachable; the key goes only in the header.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { main, type Io } from "../src/cli.ts";
import { smokeEndpoint } from "../src/cohort/smoke-endpoint.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const serve = (handler: (body: { messages: Array<{ role: string; content: unknown }> }, headers: Record<string, string | string[] | undefined>) => { status?: number; json: unknown }): Promise<string> => new Promise((res) => {
  const s = createServer((req, rsp) => { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => { const out = req.url === "/v1/messages" ? handler(JSON.parse(raw), req.headers) : { status: 404, json: { error: "not found" } }; rsp.writeHead(out.status ?? 200, { "content-type": "application/json" }); rsp.end(JSON.stringify(out.json)); }); });
  s.listen(0, "127.0.0.1", () => { servers.push(s); res(`http://127.0.0.1:${(s.address() as { port: number }).port}`); });
});
const good = (body: { messages: Array<{ role: string; content: unknown }> }, headers: Record<string, string | string[] | undefined>) => {
  void headers;
  const last = body.messages.at(-1)!;
  if (Array.isArray(last.content) && (last.content as Array<{ type: string }>)[0]?.type === "tool_result") return { json: { content: [{ type: "text", text: "The tool said hello." }], usage: { input_tokens: 40, output_tokens: 6 }, stop_reason: "end_turn" } };
  return { json: { content: [{ type: "tool_use", id: "toolu_1", name: "echo", input: { text: "hello" } }], usage: { input_tokens: 30, output_tokens: 12 }, stop_reason: "tool_use" } };
};
test("a good endpoint is OK with latency, usage and text", async () => {
  let seenKey = "";
  const url = await serve((b, h) => { seenKey = String(h["x-api-key"] ?? ""); return good(b, h); });
  const r = await smokeEndpoint({ baseUrl: url, model: "m", key: "any-text" });
  assert.equal(r.reachable && r.toolUse && r.toolArgsParsed && r.usage && r.secondRoundTrip, true, JSON.stringify(r)); assert.match(r.verdict, /^OK/); assert.equal(r.latencyMs.length, 2); assert.match(r.text, /hello/); assert.equal(seenKey, "any-text");
});
test("no tool call, a refusal and a closed port are each said plainly", async () => {
  const noTool = await serve(() => ({ json: { content: [{ type: "text", text: "Sure: hello." }], usage: { input_tokens: 5, output_tokens: 3 }, stop_reason: "end_turn" } }));
  assert.match((await smokeEndpoint({ baseUrl: noTool, model: "m" })).verdict, /NO TOOL CALL/);
  const refuse = await serve(() => ({ status: 400, json: { error: { message: "unknown model" } } }));
  assert.match((await smokeEndpoint({ baseUrl: refuse, model: "m" })).verdict, /REFUSED: status 400/);
  assert.match((await smokeEndpoint({ baseUrl: "http://127.0.0.1:1", model: "m" })).verdict, /NOT REACHABLE/);
  const noUsage = await serve((b, h) => { const g = good(b, h); return { json: { ...(g.json as object), usage: undefined } }; });
  const nu = await smokeEndpoint({ baseUrl: noUsage, model: "m" }); assert.equal(nu.usage, false); assert.match(nu.verdict, /^PROBLEMS: .*no usage/);
});
test("the command prints the table and exits 0 for a good endpoint, 2 for a bad one", async () => {
  const url = await serve(good), lines: string[] = [], io: Io = { out: (l) => lines.push(l), err: (l) => lines.push(l), env: { SMOKE_KEY: "x" }, cwd: "." };
  assert.equal(await main(["society", "cohort", "smoke-endpoint", "--provider-url", url, "--model", "m", "--api-key-env", "SMOKE_KEY"], io), 0);
  assert.match(lines.join("\n"), /tool_use returned: yes[^]*Verdict: OK/);
  assert.equal(await main(["society", "cohort", "smoke-endpoint", "--provider-url", "http://127.0.0.1:1", "--model", "m"], io), 2);
});
