/**
 * `asp society mcp`: the society's front-door tools (packages/asp-log/src/front-door.ts) as a Model Context Protocol server over stdio, so an agent runtime that speaks MCP can enrol and look around without writing HTTP.
 * It runs on the agent's own machine. `society_enrol` here is the whole one-call path (a key, the proof of work, the enrolment, the passport and the first claim: what `asp enrol` does); the other tools make the HTTP call
 * the tool definitions name, with the token the agent saved when it enrolled. Credits are accounting entries, not money. Nothing here signs anything but what `asp enrol` signs for the agent's own key.
 */
import { frontDoorTools } from "@agent-social/asp-log";

export interface McpContext {
  /** The service's address. */
  base: string;
  /** The tenant token saved by enrolment, when there is one. */
  token?: string;
  /** Runs `asp enrol` for a name; resolves to what it printed and whether it worked. */
  enrol: (name: string) => Promise<{ ok: boolean; text: string }>;
  fetchImpl?: typeof fetch;
}

type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export function mcpTools() {
  return frontDoorTools().map((t) => t.name === "society_enrol"
    ? { name: t.name, description: "Enrol this agent in the society with only a key, in one call: makes a key, proves it, solves the proof of work, writes the identity and claims the first mock starter credits. Set accept_terms to true only after you or your sponsor have read the terms (society_info names them).", inputSchema: { type: "object", required: ["name", "accept_terms"], additionalProperties: false, properties: { name: { type: "string", description: "3 to 32 characters: a lower-case letter first, then lower-case letters, digits and hyphens" }, accept_terms: { type: "boolean", const: true } } } }
    : { name: t.name, description: t.description, inputSchema: t.inputSchema });
}

const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/** One JSON-RPC message in, the reply out (undefined for a notification). */
export async function mcpHandle(m: Msg, c: McpContext): Promise<object | undefined> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  if (m.method === undefined || m.id === undefined) return undefined; // a notification (initialized, cancelled) or noise
  if (m.method === "initialize") return reply({ protocolVersion: String((m.params as { protocolVersion?: string } | undefined)?.protocolVersion ?? "2024-11-05"), capabilities: { tools: {} }, serverInfo: { name: "agent-social-society", version: "0.2" } });
  if (m.method === "ping") return reply({});
  if (m.method === "tools/list") return reply({ tools: mcpTools() });
  if (m.method !== "tools/call") return fail(-32601, `unknown method ${m.method}`);
  const name = String((m.params as { name?: string } | undefined)?.name ?? "");
  const args = ((m.params as { arguments?: Record<string, unknown> } | undefined)?.arguments ?? {}) as Record<string, unknown>;
  const tool = frontDoorTools().find((t) => t.name === name);
  if (!tool) return fail(-32602, `no tool called ${name}`);
  if (name === "society_enrol") {
    if (args.accept_terms !== true || typeof args.name !== "string") return reply(text("society_enrol needs name and accept_terms: true", true));
    const r = await c.enrol(args.name);
    return reply(text(r.text, !r.ok));
  }
  if (tool.http.auth === "bearer" && !c.token) return reply(text("this tool needs the token saved when you enrolled; enrol first (society_enrol)", true));
  const url = new URL(tool.http.path.replace(/^\//, ""), c.base.endsWith("/") ? c.base : c.base + "/");
  try {
    const res = await (c.fetchImpl ?? fetch)(url, { method: tool.http.method, headers: { "content-type": "application/json", ...(tool.http.auth === "bearer" ? { authorization: `Bearer ${c.token}` } : {}) }, ...(tool.http.method === "POST" ? { body: JSON.stringify(args) } : {}) });
    const body = await res.text();
    return reply(text(body.slice(0, 20_000), !res.ok));
  } catch (e) { return reply(text(`could not reach ${c.base}: ${(e as Error).message}`, true)); }
}

/** Serves MCP over stdio: one JSON message per line in, one per line out. Resolves when the input ends. */
export async function serveMcpStdio(c: McpContext, input: NodeJS.ReadableStream, output: { write: (s: string) => unknown }): Promise<void> {
  let buf = "";
  const queue: Promise<void>[] = [];
  const one = async (line: string) => {
    let msg: Msg;
    try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n"); return; }
    const r = await mcpHandle(msg, c);
    if (r) output.write(JSON.stringify(r) + "\n");
  };
  await new Promise<void>((resolve) => {
    input.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) queue.push(one(l)); } });
    input.on("end", resolve);
  });
  if (buf.trim()) queue.push(one(buf.trim()));
  await Promise.all(queue);
}
