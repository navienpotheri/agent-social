import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway, httpUpstream, stdioUpstream, type Gateway } from "../src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

const rpc = async (url: string, method: string, params?: unknown, id: number | null = 1) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }) });
  return { status: res.status, body: res.status === 202 ? undefined : ((await res.json()) as any) };
};
async function start(opts: Record<string, unknown>) {
  const g = createGateway({ scopes: ["mcp.fake.echo", "repo.read"], ...opts });
  const port = await g.listen();
  gateways.push(g);
  return { g, base: `http://127.0.0.1:${port}` };
}
const text = (r: any) => r.body.result.content[0].text as string;

test("the asp MCP server: handshake with the memory index as instructions, and memory tools that write, read, list and search the agent's notes", async () => {
  const mem = mkdtempSync(join(tmpdir(), "gw-mem-"));
  mkdirSync(join(mem, "auto"));
  writeFileSync(join(mem, "auto", "MEMORY.md"), "- [old](old.md) - an earlier lesson\n");
  writeFileSync(join(mem, "auto", "old.md"), "---\nname: old\n---\nAlways run migrations first.\n");
  const wrote: string[] = [];
  const { base } = await start({ mcp: { asp: { memoryDir: mem, onMemoryWrite: (f: string) => wrote.push(f) } } });
  const url = `${base}/mcp/asp`;

  const init = await rpc(url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.match(init.body.result.instructions, /asp_memory_list/);
  assert.match(init.body.result.instructions, /\[old\]\(old\.md\) - an earlier lesson/, "the memory index is handed to the agent up front");
  assert.equal((await rpc(url, "notifications/initialized", undefined, null)).status, 202);

  const tools = (await rpc(url, "tools/list")).body.result.tools.map((t: any) => t.name);
  assert.deepEqual(tools, ["asp_memory_list", "asp_memory_read", "asp_memory_write", "asp_memory_search"], "no commons tools without a commons");

  const save = await rpc(url, "tools/call", { name: "asp_memory_write", arguments: { name: "Refund race!", description: "lock the row first", content: "Take a row lock before refunding." } });
  assert.equal(text(save), "Saved refund-race.md.");
  assert.equal(wrote.length, 1);
  const file = readFileSync(join(mem, "auto", "refund-race.md"), "utf8");
  assert.match(file, /^---\nname: refund-race\ndescription: lock the row first\n---\nTake a row lock/);
  assert.match(readFileSync(join(mem, "auto", "MEMORY.md"), "utf8"), /- \[refund-race\]\(refund-race\.md\) - lock the row first/);
  await rpc(url, "tools/call", { name: "asp_memory_write", arguments: { name: "refund-race", content: "Updated." } });
  assert.equal(readFileSync(join(mem, "auto", "MEMORY.md"), "utf8").match(/refund-race\.md/g)!.length, 1, "updating a note does not duplicate its index line");

  assert.match(text(await rpc(url, "tools/call", { name: "asp_memory_list", arguments: {} })), /old\.md[\s\S]*refund-race\.md/);
  assert.match(text(await rpc(url, "tools/call", { name: "asp_memory_read", arguments: { path: "old.md" } })), /Always run migrations first/);
  assert.match(text(await rpc(url, "tools/call", { name: "asp_memory_search", arguments: { query: "MIGRATIONS" } })), /old\.md:\d+: Always run migrations first/);

  const outside = await rpc(url, "tools/call", { name: "asp_memory_read", arguments: { path: "../../etc/passwd" } });
  assert.equal(outside.body.result.isError, true);
  assert.match(text(outside), /outside the agent's memory/);
  const abs = await rpc(url, "tools/call", { name: "asp_memory_read", arguments: { path: join(tmpdir(), "x") } });
  assert.equal(abs.body.result.isError, true);
  const big = await rpc(url, "tools/call", { name: "asp_memory_write", arguments: { name: "big", content: "x".repeat(70_000) } });
  assert.equal(big.body.result.isError, true);
  assert.ok(!existsSync(join(mem, "auto", "big.md")));
  assert.equal((await rpc(url, "nope")).body.error.code, -32601);
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(`${base}/mcp/unknown`, { method: "POST", body: "{}" })).status, 404);
});

test("commons tools: search and show read the shared library, cite signs through the caller", async () => {
  const seen: string[] = [];
  const commons = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url!.includes("/entries/")
      ? { ok: true, id: "sha256:a", status: "reviewed", entry: { title: "Migrations first", author: "did:x", text: "Run migrations first." }, endorsements: 2, disputes: 0, citations: 1 }
      : { ok: true, entries: [{ id: "sha256:a", title: "Migrations first", status: "reviewed", endorsements: 2, disputes: 0, citations: 1, tags: ["db"] }] }));
  });
  await new Promise<void>((r) => commons.listen(0, "127.0.0.1", r));
  servers.push(commons);
  const cited: string[] = [];
  const { base } = await start({ mcp: { asp: { commons: { url: `http://127.0.0.1:${(commons.address() as { port: number }).port}`, token: "t", cite: async (id: string, ctx: string) => { cited.push(`${id}|${ctx}`); } } } } });
  const url = `${base}/mcp/asp`;
  assert.deepEqual((await rpc(url, "tools/list")).body.result.tools.map((t: any) => t.name), ["asp_commons_search", "asp_commons_show", "asp_commons_cite"]);
  assert.match(text(await rpc(url, "tools/call", { name: "asp_commons_search", arguments: { query: "migrations", status: "reviewed" } })), /sha256:a {2}\[reviewed\] Migrations first {2}\(\+2 -0, cited by 1\) {2}#db/);
  assert.match(seen[0], /GET \/commons\/entries\?status=reviewed&q=migrations Bearer t/);
  assert.match(text(await rpc(url, "tools/call", { name: "asp_commons_show", arguments: { id: "sha256:a" } })), /Run migrations first\.[\s\S]*2 endorsement\(s\)/);
  await rpc(url, "tools/call", { name: "asp_commons_cite", arguments: { id: "sha256:a", context: "fixed my seed" } });
  assert.deepEqual(cited, ["sha256:a|fixed my seed"]);
});

test("the MCP proxy judges every call: an allowed tool is forwarded, a refused one never reaches the server and is a strike (stdio and HTTP upstreams)", async () => {
  const fake = fileURLToPath(new URL("./fake-mcp-server.mjs", import.meta.url));
  const up = stdioUpstream(process.execPath, [fake]);
  const { g, base } = await start({ mcp: { upstreams: { fake: up } } });
  const url = `${base}/mcp/fake`;
  assert.equal((await rpc(url, "initialize", { protocolVersion: "2025-06-18" })).body.result.serverInfo.name, "fake");
  assert.deepEqual((await rpc(url, "tools/list")).body.result.tools.map((t: any) => t.name), ["echo", "deploy"]);
  assert.equal(text(await rpc(url, "tools/call", { name: "echo", arguments: { a: 1 } })), 'echo ran with {"a":1}');
  const refused = await rpc(url, "tools/call", { name: "deploy", arguments: { env: "prod" } });
  assert.equal(refused.body.result.isError, true);
  assert.match(text(refused), /The action "deploy" was not run: the scope mcp\.fake\.deploy is not granted/);
  const s = g.summary();
  assert.deepEqual(s.scopesUsed, ["mcp.fake.echo"]);
  assert.deepEqual(s.blocked, [{ scope: "mcp.fake.deploy", count: 1 }]);
  assert.equal(s.strikes, 1);

  // The same proxy in front of a remote Streamable HTTP server (JSON replies and an SSE reply).
  const calls: string[] = [];
  const remote = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const m = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push(m.method);
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = m.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "remote", version: "1" } }
      : m.method === "tools/list" ? { tools: [{ name: "echo" }] } : { content: [{ type: "text", text: "remote echo" }] };
    if (m.method === "tools/call") { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`); return; }
    res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
  });
  await new Promise<void>((r) => remote.listen(0, "127.0.0.1", r));
  servers.push(remote);
  const second = await start({ scopes: ["mcp.remote.echo"], mcp: { upstreams: { remote: httpUpstream(`http://127.0.0.1:${(remote.address() as { port: number }).port}/mcp`) } } });
  assert.equal(text(await rpc(`${second.base}/mcp/remote`, "tools/call", { name: "echo", arguments: {} })), "remote echo");
  assert.deepEqual(calls, ["initialize", "notifications/initialized", "tools/call"], "the gateway completes the handshake itself");
});

test("an MCP call counts toward probing, and a stopped run refuses MCP too", async () => {
  const fake = fileURLToPath(new URL("./fake-mcp-server.mjs", import.meta.url));
  const { g, base } = await start({ maxStrikes: 2, mcp: { upstreams: { fake: stdioUpstream(process.execPath, [fake]) } } });
  const url = `${base}/mcp/fake`;
  for (let i = 0; i < 2; i++) await rpc(url, "tools/call", { name: "deploy", arguments: {} });
  assert.match(g.summary().stopped!, /2 blocked attempts/);
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 403);
});

test("the gateway's own asp tools need no scope when the gateway serves them, and an unrelated server called asp does not get that", async () => {
  const reply = { id: "c", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "mcp__asp__asp_memory_write", arguments: "{}" } }] } }] };
  const upstream = createServer((req, res) => { req.resume(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  servers.push(upstream);
  const up = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`;
  const ask = async (extra: Record<string, unknown>) => {
    const g = createGateway({ openaiUpstream: up, scopes: ["repo.read"], ...extra });
    const port = await g.listen();
    gateways.push(g);
    const r: any = await (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [] }) })).json();
    return { reply: r, summary: g.summary() };
  };
  const served = await ask({ mcp: { asp: { memoryDir: mkdtempSync(join(tmpdir(), "gw-mem-")) } } });
  assert.equal(served.reply.choices[0].message.tool_calls.length, 1);
  assert.equal(served.summary.strikes, 0);
  const notServed = await ask({});
  assert.equal(notServed.reply.choices[0].message.tool_calls, undefined);
  assert.deepEqual(notServed.summary.blocked, [{ scope: "mcp.asp.asp_memory_write", count: 1 }]);
});
