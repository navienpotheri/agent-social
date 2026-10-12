// A tiny MCP server over stdio (one JSON message per line) for the gateway tests: tools "echo" and "deploy".
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === "initialize") return send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  if (m.method === "tools/list") return send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }, { name: "deploy", description: "Deploy", inputSchema: { type: "object" } }] } });
  if (m.method === "tools/call") return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `${m.params.name} ran with ${JSON.stringify(m.params.arguments)}` }] } });
  send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no such method" } });
});
