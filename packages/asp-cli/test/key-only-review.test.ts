// Row DK546: the Clinic signs the quarantine the sponsor-less review asked for (`asp clinic keyonly-freeze`), and the society's tools are served over MCP. Fake keys and a stand-in service only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { CLINIC_DID, PendingQuarantines } from "@agent-social/asp-log";
import { openLog } from "@agent-social/asp-package";
import { Keystore } from "@agent-social/asp-package";
import { clinicCmd } from "../src/clinic.ts";
import { main, type Io } from "../src/cli.ts";
import { mcpHandle, mcpTools, serveMcpStdio, type McpContext } from "../src/mcp-society.ts";
import { makeFixture } from "./fixture.ts";

const TARGET = "did:web:example.com:users:ko-abuser";

test("DK546: asp clinic keyonly-freeze signs one interim quarantine per waiting agent, appends it, acknowledges it, and says so when none waits", async () => {
  const f = makeFixture();
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  for (const d of [CLINIC_DID, TARGET]) assert.equal(await main(["identity", "new", "--kind", "human", "--did", d], io), 0);
  const pending = new PendingQuarantines();
  assert.equal(pending.add({ did: TARGET, tenant: "ko-abuser", slashes: 2, at: "2026-11-19T00:00:00Z" }), true);
  assert.equal(pending.add({ did: TARGET, tenant: "ko-abuser", slashes: 2, at: "2026-11-19T00:00:01Z" }), false, "listed once");
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/admin/keyonly-pending/ack") return void res.end(JSON.stringify({ ok: true, acknowledged: pending.ack(JSON.parse(b).dids) }));
      res.end(JSON.stringify({ ok: true, pending: pending.list() }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const log = await openLog(f.aspHome, {} as never);
    const keys = new Keystore(f.aspHome);
    const opts = (service?: { url: string; token: string }) => ({ service, log, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), signerFor: (d: string) => keys.forDid(d)!, actions: async () => [], flags: {} });
    await assert.rejects(clinicCmd("keyonly-freeze", opts(undefined) as never), /needs the service and an admin token/);
    assert.equal(await clinicCmd("keyonly-freeze", opts({ url, token: "admin-token" }) as never), 0);
    assert.match(out.join("\n"), /frozen at halt until/);
    assert.ok(seen.every((s) => s.endsWith("Bearer admin-token")));
    const qs = (await log.log.quarantinesOf(TARGET)) as unknown as { type: string; body: { members: string[]; level: string } }[];
    assert.equal(qs.length, 1);
    assert.deepEqual(qs[0].body.members, [TARGET]);
    assert.equal(pending.list().length, 0, "acknowledged");
    out.length = 0;
    assert.equal(await clinicCmd("keyonly-freeze", opts({ url, token: "admin-token" }) as never), 0);
    assert.match(out.join("\n"), /no quarantine is waiting/);
  } finally { server.close(); }
});

test("DK546: the society's tools are served over MCP: initialize, list, a public call, a call that needs the token, enrol through the callback", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (u: URL, init?: RequestInit) => { calls.push(`${init?.method} ${u.pathname} ${(init?.headers as Record<string, string>).authorization ?? "-"}`); return new Response(JSON.stringify({ ok: true, open: true }), { status: 200 }); }) as unknown as typeof fetch;
  const ctx: McpContext = { base: "https://society.example", fetchImpl, enrol: async (name) => { ctx.token = "tok"; return { ok: true, text: `enrolled as ${name}` }; } };
  const init = (await mcpHandle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, ctx)) as { result: { capabilities: { tools: object }; serverInfo: { name: string } } };
  assert.ok(init.result.capabilities.tools);
  assert.equal(await mcpHandle({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx), undefined, "a notification gets no reply");
  const list = (await mcpHandle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx)) as { result: { tools: { name: string; inputSchema: object }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), mcpTools().map((t) => t.name));
  assert.ok(list.result.tools.some((t) => t.name === "society_enrol") && list.result.tools.every((t) => t.inputSchema));
  const info = (await mcpHandle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "society_info", arguments: {} } }, ctx)) as { result: { content: { text: string }[]; isError?: boolean } };
  assert.equal(info.result.isError, undefined);
  assert.deepEqual(calls, ["GET /signup -"]);
  const needsToken = (await mcpHandle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "society_account", arguments: {} } }, ctx)) as { result: { isError?: boolean } };
  assert.equal(needsToken.result.isError, true);
  const noTerms = (await mcpHandle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "society_enrol", arguments: { name: "x-agent" } } }, ctx)) as { result: { isError?: boolean } };
  assert.equal(noTerms.result.isError, true, "terms must be accepted");
  const enrol = (await mcpHandle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "society_enrol", arguments: { name: "x-agent", accept_terms: true } } }, ctx)) as { result: { content: { text: string }[] } };
  assert.equal(enrol.result.content[0].text, "enrolled as x-agent");
  await mcpHandle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "society_account", arguments: {} } }, ctx);
  assert.equal(calls.at(-1), "GET /account Bearer tok", "the token saved by enrolment is used");
  const unknown = (await mcpHandle({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nope", arguments: {} } }, ctx)) as { error: { code: number } };
  assert.equal(unknown.error.code, -32602);
});

test("DK546: the MCP server speaks one JSON message per line on stdio", async () => {
  const input = new PassThrough();
  const lines: string[] = [];
  const done = serveMcpStdio({ base: "https://society.example", enrol: async () => ({ ok: true, text: "" }) }, input, { write: (s) => lines.push(String(s)) });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\nnot json\n");
  input.end();
  await done;
  assert.equal(lines.length, 2);
  const msgs = lines.map((l) => JSON.parse(l));
  assert.deepEqual(msgs.find((m) => m.id === 1), { jsonrpc: "2.0", id: 1, result: {} });
  assert.equal(msgs.find((m) => m.id === null).error.code, -32700);
});
