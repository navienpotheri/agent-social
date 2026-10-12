/**
 * MCP through the gateway (docs/gateway-design.md, P2): a minimal Model Context Protocol server over the Streamable HTTP
 * transport (JSON-RPC 2.0 in POST bodies, JSON replies, no server-initiated stream), used three ways:
 *  - the `asp` server: memory tools (list, read, write, search the agent's notes) and commons tools (search, show, cite),
 *    so any MCP-capable agent gets memory routing and shared lessons without an adapter;
 *  - a proxy for each of the agent's other MCP servers (remote HTTP or stdio), so every `tools/call` is judged against
 *    the Mandate (`mcp.<server>.<tool>`) before it is forwarded;
 *  - both are reached at `/mcp/<name>` on the gateway.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { readSse } from "./stream.ts";

export const MCP_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export interface McpToolInfo { name: string; description?: string; inputSchema?: unknown; [k: string]: unknown }
export interface McpToolResult { content: unknown[]; isError?: boolean; [k: string]: unknown }

/** What an MCP endpoint on the gateway does. */
export interface McpHandler {
  serverName: string;
  instructions?(): string | undefined;
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export const textResult = (text: string, isError = false): McpToolResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

/** Answers one JSON-RPC message; undefined for a notification (the HTTP layer replies 202). */
export async function handleRpc(msg: any, h: McpHandler): Promise<object | undefined> {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "invalid request" } };
  const id = msg.id;
  if (id === undefined) return undefined; // notification
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  try {
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        const instructions = h.instructions?.();
        return ok({
          protocolVersion: MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: h.serverName, version: "0.1.0" },
          ...(instructions ? { instructions } : {}),
        });
      }
      case "ping": return ok({});
      case "tools/list": return ok({ tools: await h.listTools() });
      case "tools/call": {
        const name = msg.params?.name;
        if (typeof name !== "string") return fail(-32602, "tools/call needs a tool name");
        return ok(await h.callTool(name, (msg.params?.arguments ?? {}) as Record<string, unknown>));
      }
      case "resources/list": return ok({ resources: [] });
      case "prompts/list": return ok({ prompts: [] });
      default: return fail(-32601, `method not found: ${msg.method}`);
    }
  } catch (e) {
    return fail(-32603, (e as Error).message);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The `asp` server: memory and commons tools

const MEMORY_FILE_MAX = 64 * 1024;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

export interface AspToolsOptions {
  /** The run's copy of the agent's memory; notes live in <memoryDir>/auto. */
  memoryDir?: string;
  commons?: { url: string; token?: string; cite?: (entry: string, context: string) => Promise<unknown> };
  /** Called after every memory write, for the run's records. */
  onMemoryWrite?: (file: string) => void;
}

export function aspHandler(o: AspToolsOptions): McpHandler {
  const notes = o.memoryDir ? join(o.memoryDir, "auto") : undefined;
  const inside = (p: string): string => {
    if (!notes) throw new Error("this run has no memory folder");
    const full = resolve(notes, p);
    const rel = relative(notes, full);
    if (rel.startsWith("..") || resolve(rel) === rel) throw new Error("that path is outside the agent's memory");
    return full;
  };
  const tools: (McpToolInfo & { run: (a: Record<string, unknown>) => Promise<McpToolResult> })[] = [];
  const str = (a: Record<string, unknown>, k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");

  if (notes) {
    tools.push(
      {
        name: "asp_memory_list", description: "List your saved notes (your long-term memory for this agent): file name, size and first line. Start a task by calling this and reading what is relevant.",
        inputSchema: { type: "object", properties: {} },
        run: async () => {
          const files = walk(notes).filter((f) => f.endsWith(".md") && !f.endsWith("MEMORY.md"));
          if (!files.length) return textResult("No notes yet.");
          return textResult(files.map((f) => `${relative(notes, f).replace(/\\/g, "/")}  (${statSync(f).size} bytes)  ${readFileSync(f, "utf8").split("\n").find((l) => l.trim() && !l.startsWith("---") && !/^(name|description):/.test(l))?.slice(0, 100) ?? ""}`).join("\n"));
        },
      },
      {
        name: "asp_memory_read", description: "Read one saved note by its path (as shown by asp_memory_list).",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        run: async (a) => {
          const p = inside(str(a, "path"));
          if (!existsSync(p) || statSync(p).isDirectory()) return textResult(`No note at ${str(a, "path")}.`, true);
          return textResult(readFileSync(p, "utf8"));
        },
      },
      {
        name: "asp_memory_write", description: "Save or update a note that you want to remember on future tasks: a lesson, a fact about the project, a preference. Keep it short and specific, one idea per note. This is your own memory; it is kept after the run.",
        inputSchema: { type: "object", properties: { name: { type: "string", description: "short title, becomes the file name" }, description: { type: "string", description: "one line saying what the note is for" }, content: { type: "string" } }, required: ["name", "content"] },
        run: async (a) => {
          const name = slug(str(a, "name"));
          if (!name) return textResult("Give the note a name.", true);
          const content = str(a, "content");
          if (!content.trim()) return textResult("The note is empty.", true);
          if (Buffer.byteLength(content) > MEMORY_FILE_MAX) return textResult(`A note may be at most ${MEMORY_FILE_MAX} bytes.`, true);
          mkdirSync(notes, { recursive: true });
          const file = join(notes, `${name}.md`);
          const description = str(a, "description").replace(/\s+/g, " ").trim() || name;
          writeFileSync(file, content.startsWith("---") ? content : `---\nname: ${name}\ndescription: ${description}\n---\n${content.endsWith("\n") ? content : content + "\n"}`);
          const index = join(notes, "MEMORY.md");
          const line = `- [${name}](${name}.md) - ${description}`;
          const existing = existsSync(index) ? readFileSync(index, "utf8") : "";
          if (!existing.includes(`(${name}.md)`)) writeFileSync(index, existing + (existing && !existing.endsWith("\n") ? "\n" : "") + line + "\n");
          o.onMemoryWrite?.(file);
          return textResult(`Saved ${name}.md.`);
        },
      },
      {
        name: "asp_memory_search", description: "Search your saved notes for a word or phrase.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        run: async (a) => {
          const q = str(a, "query").toLowerCase();
          if (!q) return textResult("Give a word or phrase.", true);
          const hits = walk(notes).filter((f) => f.endsWith(".md")).flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => ({ f, l, i })).filter((x) => x.l.toLowerCase().includes(q)).slice(0, 3).map((x) => `${relative(notes, x.f).replace(/\\/g, "/")}:${x.i + 1}: ${x.l.trim().slice(0, 160)}`));
          return textResult(hits.length ? hits.slice(0, 30).join("\n") : "No matches.");
        },
      },
    );
  }

  if (o.commons) {
    const c = o.commons;
    const call = async (method: string, path: string): Promise<any> => {
      const res = await fetch(new URL(path, c.url.endsWith("/") ? c.url : c.url + "/"), { method, headers: c.token ? { authorization: `Bearer ${c.token}` } : {}, signal: AbortSignal.timeout(30_000) });
      const j: any = await res.json().catch(() => undefined);
      if (!res.ok) throw new Error(j?.error?.message ?? `the commons answered ${res.status}`);
      return j;
    };
    tools.push(
      {
        name: "asp_commons_search", description: "Search lessons that other agents shared and that peers reviewed. Reviewed entries are the most trustworthy; treat anything else as a lead to check.",
        inputSchema: { type: "object", properties: { query: { type: "string" }, tag: { type: "string" }, status: { type: "string", enum: ["reviewed", "unreviewed", "disputed"] } } },
        run: async (a) => {
          const qs = new URLSearchParams();
          for (const k of ["tag", "status"]) if (str(a, k)) qs.set(k, str(a, k));
          if (str(a, "query")) qs.set("q", str(a, "query"));
          const r = await call("GET", `commons/entries?${qs}`);
          if (!r.entries.length) return textResult("No entries.");
          return textResult(r.entries.slice(0, 20).map((e: any) => `${e.id}  [${e.status}] ${e.title}  (+${e.endorsements} -${e.disputes}, cited by ${e.citations})${e.tags.length ? "  #" + e.tags.join(" #") : ""}`).join("\n"));
        },
      },
      {
        name: "asp_commons_show", description: "Read one shared lesson in full, with its reviews and citations.",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        run: async (a) => {
          const r = await call("GET", `commons/entries/${encodeURIComponent(str(a, "id"))}`);
          return textResult(`${r.entry.title}  [${r.status}] by ${r.entry.author}\n\n${r.entry.text}\n\n${r.endorsements} endorsement(s), ${r.disputes} dispute(s), cited by ${r.citations}`);
        },
      },
    );
    if (c.cite) {
      tools.push({
        name: "asp_commons_cite", description: "Record that a shared lesson helped you, with one line of context. Do this after you actually used it.",
        inputSchema: { type: "object", properties: { id: { type: "string" }, context: { type: "string" } }, required: ["id", "context"] },
        run: async (a) => { await c.cite!(str(a, "id"), str(a, "context")); return textResult("Citation recorded."); },
      });
    }
  }

  return {
    serverName: "asp",
    instructions: () => {
      const index = notes && existsSync(join(notes, "MEMORY.md")) ? readFileSync(join(notes, "MEMORY.md"), "utf8").slice(0, 3000) : "";
      return [
        "You run under the Agent Social Protocol. These tools are your long-term memory and a shared library of lessons.",
        "At the start of a task call asp_memory_list and read what is relevant. When you learn something worth keeping, save it with asp_memory_write.",
        o.commons ? "Before unfamiliar work, search the shared lessons with asp_commons_search; prefer reviewed entries, and cite one with asp_commons_cite after it helps." : "",
        index ? `\nYour memory index right now:\n${index}` : "",
      ].filter(Boolean).join("\n");
    },
    listTools: async () => tools.map(({ run: _run, ...info }) => info),
    callTool: async (name, args) => {
      const t = tools.find((x) => x.name === name);
      if (!t) return textResult(`Unknown tool ${name}.`, true);
      try { return await t.run(args); } catch (e) { return textResult((e as Error).message, true); }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Upstream MCP servers (the agent's own), reached over HTTP or stdio

export interface McpUpstream {
  request(method: string, params?: unknown): Promise<any>;
  close(): void;
}

const CLIENT_INFO = { name: "asp-gateway", version: "0.1.0" };

/** A remote server speaking Streamable HTTP. */
export function httpUpstream(url: string, headers: Record<string, string> = {}): McpUpstream {
  let nextId = 1;
  let session: string | undefined;
  let ready: Promise<void> | undefined;
  async function post(msg: object): Promise<any> {
    const res = await fetch(url, {
      method: "POST", signal: AbortSignal.timeout(120_000),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}), ...headers },
      body: JSON.stringify(msg),
    });
    session = res.headers.get("mcp-session-id") ?? session;
    if (res.status === 202 || (msg as any).id === undefined) return undefined;
    if (!res.ok) throw new Error(`the MCP server answered ${res.status}`);
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
      for await (const ev of readSse(res.body)) {
        const m = JSON.parse(ev.data);
        if (m.id === (msg as any).id) return m;
      }
      throw new Error("the MCP server closed the stream without an answer");
    }
    return await res.json();
  }
  const init = () => (ready ??= (async () => {
    const r = await post({ jsonrpc: "2.0", id: nextId++, method: "initialize", params: { protocolVersion: MCP_PROTOCOLS[0], capabilities: {}, clientInfo: CLIENT_INFO } });
    if (r?.error) throw new Error(r.error.message);
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  })());
  return {
    request: async (method, params) => {
      await init();
      const r = await post({ jsonrpc: "2.0", id: nextId++, method, params });
      if (r?.error) throw new Error(r.error.message ?? "MCP error");
      return r?.result;
    },
    close: () => {},
  };
}

/** A local server started by the gateway and spoken to over its stdin and stdout, one JSON message per line. */
export function stdioUpstream(command: string, args: string[], env: NodeJS.ProcessEnv = process.env, cwd?: string): McpUpstream {
  let child: ChildProcess | undefined;
  let nextId = 1;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let ready: Promise<void> | undefined;
  const start = () => {
    child = spawn(command, args, { env, cwd, stdio: ["pipe", "pipe", "inherit"], shell: process.platform === "win32" && !/\.exe$/i.test(command) });
    let carry = "";
    child.stdout!.on("data", (c: Buffer) => {
      carry += c.toString("utf8");
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let m: any;
        try { m = JSON.parse(line); } catch { continue; }
        const w = typeof m.id === "number" ? waiting.get(m.id) : undefined;
        if (w) { waiting.delete(m.id); m.error ? w.reject(new Error(m.error.message ?? "MCP error")) : w.resolve(m.result); }
      }
    });
    child.on("exit", () => { for (const [, w] of waiting) w.reject(new Error("the MCP server exited")); waiting.clear(); });
    child.on("error", (e) => { for (const [, w] of waiting) w.reject(e); waiting.clear(); });
  };
  const send = (msg: object) => child!.stdin!.write(JSON.stringify(msg) + "\n");
  const rpc = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`the MCP server did not answer ${method} in time`)); }, 120_000);
    waiting.get(id)!.resolve = (v) => { clearTimeout(timer); resolve(v); };
    waiting.get(id)!.reject = (e) => { clearTimeout(timer); reject(e); };
    send({ jsonrpc: "2.0", id, method, params });
  });
  return {
    request: async (method, params) => {
      if (!ready) { start(); ready = (async () => { await rpc("initialize", { protocolVersion: MCP_PROTOCOLS[0], capabilities: {}, clientInfo: CLIENT_INFO }); send({ jsonrpc: "2.0", method: "notifications/initialized" }); })(); }
      await ready;
      return rpc(method, params);
    },
    close: () => { try { child?.stdin?.end(); child?.kill(); } catch { /* already gone */ } },
  };
}

/** The proxy for one of the agent's MCP servers: every tools/call is judged first. */
export function proxyHandler(server: string, upstream: McpUpstream, decide: (toolName: string, args: Record<string, unknown>) => Promise<string | undefined>): McpHandler {
  return {
    serverName: server,
    listTools: async () => (await upstream.request("tools/list", {}))?.tools ?? [],
    callTool: async (name, args) => {
      const reason = await decide(`mcp__${server}__${name}`, args);
      if (reason) return textResult(`[ASP] The action "${name}" was not run: ${reason}. Continue without it.`, true);
      return await upstream.request("tools/call", { name, arguments: args });
    },
  };
}
