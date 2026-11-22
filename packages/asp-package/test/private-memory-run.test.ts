// Rows DK272 and D12 (docs/private-memory-run-design.md, section 5, tests 1 to 4 and the key custody): an agent writes a private scope during a run through the gateway's MCP tools; the sealed file exists and the
// plaintext is nowhere on disk or in the run log; the pair can open it and nobody else; a scope the Mandate does not name is refused and counted; the limits hold. Not covered here: an account export and import
// (test 5) and a recorded run with a real runtime (test 6), which stay open.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGateway, ensureAgentMemoryKey, newMemoryKey, openPrivateScope, PrivateMemoryRun, principalMemoryKey, RunRecorder, unsealAgentMemoryKey, MAX_SCOPE_BYTES, type Gateway, type PrivateMemoryEvent } from "../src/index.ts";

const gateways: Gateway[] = [];
after(async () => { for (const g of gateways) await g.close(); });

const PRINCIPAL = "did:web:example.com:users:ann", AGENT = "did:web:example.com:agents:ann:scribe", OTHER = "did:web:example.com:agents:ann:other";
const SECRET_TEXT = "my private plan: the vault code is 4-8-15-16-23-42";
const walkFiles = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walkFiles(p) : [p]; });

function world(allowed: string[], pass?: string) {
  const root = mkdtempSync(join(tmpdir(), "asp-pm-"));
  const home = join(root, "home"), pkg = join(root, "package"), runDir = join(root, "run");
  mkdirSync(pkg, { recursive: true });
  const pk = principalMemoryKey(home, PRINCIPAL, pass);
  ensureAgentMemoryKey(pkg, pk.publicKey);
  const agentKey = unsealAgentMemoryKey(pkg, pk.privateKey);
  const events: PrivateMemoryEvent[] = [];
  const rec = new RunRecorder(join(runDir, "run-log.ndjson"));
  const pm = new PrivateMemoryRun({ dir: join(pkg, "memory", "private"), pair: { principal: PRINCIPAL, agent: AGENT }, agentKey, principalPublic: pk.publicKey, allowed, onEvent: (e) => { events.push(e); rec.event("private_memory", { ...e }); } });
  return { root, home, pkg, runDir, pk, agentKey, pm, events, rec };
}

async function viaGateway(w: ReturnType<typeof world>) {
  const g = createGateway({ scopes: ["repo.read"], runLog: w.rec, mcp: { asp: { memoryDir: join(w.runDir, "memory"), privateMemory: w.pm } } });
  gateways.push(g);
  const port = await g.listen();
  let id = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await fetch(`http://127.0.0.1:${port}/mcp/asp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) });
    const j: any = await r.json();
    return { text: String(j.result?.content?.[0]?.text ?? j.error?.message ?? ""), isError: !!j.result?.isError || !!j.error };
  };
  return { g, call };
}

test("an agent writes and reads a private scope through the gateway; the sealed file exists and the plaintext is nowhere on disk or in the run log", async () => {
  const w = world(["notes"]);
  const { call } = await viaGateway(w);
  const wr = await call("asp_memory_private_write", { scope: "notes", text: SECRET_TEXT });
  assert.equal(wr.isError, false, wr.text);
  assert.ok(readdirSync(join(w.pkg, "memory", "private")).includes("notes.sealed.json"));
  assert.equal((await call("asp_memory_private_read", { scope: "notes" })).text, SECRET_TEXT);
  assert.match((await call("asp_memory_private_list", {})).text, /notes/);
  for (const f of [...walkFiles(w.root)]) assert.ok(!readFileSync(f, "utf8").includes("vault code"), `plaintext found in ${f}`);
  const log = readFileSync(join(w.runDir, "run-log.ndjson"), "utf8");
  assert.ok(!log.includes("4-8-15-16-23-42"));
  assert.match(log, /"kind":"private_memory"/);
  assert.match(log, /"kind":"mcp_call".*asp_memory_private_write/);
  const wrote = w.events.find((e) => e.kind === "write")!;
  assert.equal(wrote.scope, "notes");
  assert.equal(wrote.bytes, Buffer.byteLength(SECRET_TEXT));
  assert.match(wrote.sha256 ?? "", /^[0-9a-f]{64}$/);
});

test("the pair opens the scope; a second agent of the same sponsor, a wrong scope name, a node key and the agent's key file read without the principal's key cannot", async () => {
  const w = world(["notes"]);
  w.pm.write("notes", SECRET_TEXT);
  const sealed = JSON.parse(readFileSync(join(w.pkg, "memory", "private", "notes.sealed.json"), "utf8"));
  const pair = { principal: PRINCIPAL, agent: AGENT };
  // the principal, with their own private key and the agent's public key
  assert.equal(openPrivateScope(sealed, w.pk.privateKey, w.agentKey.publicKey, pair, "notes").toString("utf8"), SECRET_TEXT);
  // another agent of the same sponsor (its own memory key, the principal's public key)
  const other = newMemoryKey();
  assert.throws(() => openPrivateScope(sealed, other.privateKey, w.pk.publicKey, { principal: PRINCIPAL, agent: OTHER }, "notes"), /cannot be opened/);
  // the right agent key under a wrong scope name or pair
  assert.throws(() => openPrivateScope(sealed, w.agentKey.privateKey, w.pk.publicKey, pair, "other"), /not that private scope/);
  assert.throws(() => openPrivateScope(sealed, w.agentKey.privateKey, w.pk.publicKey, { principal: PRINCIPAL, agent: OTHER }, "notes"), /cannot be opened/);
  // a host with only public keys or a signing (node) key has no memory key at all: any private key it invents fails
  assert.throws(() => openPrivateScope(sealed, newMemoryKey().privateKey, w.agentKey.publicKey, pair, "notes"), /cannot be opened/);
  // the agent's key file does not hold its private half in the clear, and a stranger's principal key cannot open it
  const keyFile = readFileSync(join(w.pkg, "keys", "memory.json"), "utf8");
  assert.ok(!keyFile.includes(w.agentKey.privateKey));
  assert.throws(() => unsealAgentMemoryKey(w.pkg, newMemoryKey().privateKey), /cannot be opened/);
});

test("a scope the Mandate does not name is refused and counted; the size, the number of scopes and the name are limited", async () => {
  const w = world(["notes", ...Array.from({ length: 16 }, (_, i) => `s${i}`)]);
  const { call } = await viaGateway(w);
  const refused = await call("asp_memory_private_write", { scope: "diary", text: "x" });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /not one this run's Mandate names/);
  assert.equal(w.pm.blocked, 1);
  assert.equal(w.events.at(-1)?.kind, "refused");
  assert.equal((await call("asp_memory_private_read", { scope: "diary" })).isError, true);
  assert.equal(w.pm.blocked, 2);
  // limits
  const big = await call("asp_memory_private_write", { scope: "notes", text: "a".repeat(MAX_SCOPE_BYTES + 1) });
  assert.match(big.text, /at most 256 KiB/);
  assert.equal((await call("asp_memory_private_write", { scope: "notes", text: "a".repeat(MAX_SCOPE_BYTES) })).isError, false, "exactly the limit is fine");
  for (let i = 0; i < 15; i++) assert.equal((await call("asp_memory_private_write", { scope: `s${i}`, text: "t" })).isError, false);
  const seventeenth = await call("asp_memory_private_write", { scope: "s15", text: "t" });
  assert.match(seventeenth.text, /at most 16 private scopes/);
  assert.match((await call("asp_memory_private_write", { scope: "Bad Name!", text: "t" })).text, /1 to 64 characters/);
  assert.match((await call("asp_memory_private_write", { scope: "a".repeat(65), text: "t" })).text, /1 to 64 characters/);
  // an existing scope can still be rewritten at the limit of scopes
  assert.equal((await call("asp_memory_private_write", { scope: "s0", text: "again" })).isError, false);
});

test("the principal's key is sealed with the passphrase when one is set, and without a run the agent has no private tools", async () => {
  const w = world(["notes"], "correct horse battery staple");
  const file = readFileSync(join(w.home, "memory-keys", `${PRINCIPAL.replace(/[^A-Za-z0-9._-]+/g, "_")}.json`), "utf8");
  assert.ok(!file.includes(w.pk.privateKey), "not in the clear");
  assert.throws(() => principalMemoryKey(w.home, PRINCIPAL), /protected with a passphrase/);
  assert.equal(principalMemoryKey(w.home, PRINCIPAL, "correct horse battery staple").publicKey, w.pk.publicKey);
  assert.throws(() => principalMemoryKey(w.home, PRINCIPAL, "wrong"), /./);
  const g = createGateway({ scopes: ["repo.read"], mcp: { asp: { memoryDir: join(w.root, "m") } } });
  gateways.push(g);
  const port = await g.listen();
  const r: any = await (await fetch(`http://127.0.0.1:${port}/mcp/asp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json();
  assert.ok(!r.result.tools.some((t: any) => /private/.test(t.name)));
});

test("the model's own call to a private tool and the result it gets back are kept out of the run log and the telemetry copy", async () => {
  const { createServer } = await import("node:http");
  const { CognitionTap } = await import("../src/index.ts");
  const w = world(["notes"]);
  const up = createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "p1", type: "function", function: { name: "mcp__asp__asp_memory_private_write", arguments: JSON.stringify({ scope: "notes", text: SECRET_TEXT }) } }] } }] })); }); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
  const tap = new CognitionTap({ runtime: "claude-code" });
  const g = createGateway({ openaiUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}/v1`, scopes: ["repo.read", "mcp.asp.asp_memory_private_write", "mcp.asp.asp_memory_private_read"], runLog: w.rec, cognition: tap, mcp: { asp: { memoryDir: join(w.runDir, "memory"), privateMemory: w.pm } } });
  gateways.push(g);
  const port = await g.listen();
  const ask = (messages: unknown[]) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages }) }).then((r) => r.json());
  await ask([{ role: "user", content: "save it" }]);
  // the next request carries the read result back to the model
  await ask([{ role: "user", content: "save it" }, { role: "assistant", content: null, tool_calls: [{ id: "p1", type: "function", function: { name: "mcp__asp__asp_memory_private_write", arguments: "{}" } }] }, { role: "tool", tool_call_id: "p1", content: SECRET_TEXT }]);
  up.close();
  const log = readFileSync(join(w.runDir, "run-log.ndjson"), "utf8");
  assert.ok(!log.includes("4-8-15-16-23-42"), "no plaintext in the run log");
  assert.match(log, /private memory; not logged/);
  const items = tap.drain().map((i) => i.content).join("\n");
  assert.ok(!items.includes("4-8-15-16-23-42"), "no plaintext in the telemetry copy of the actions");
});
