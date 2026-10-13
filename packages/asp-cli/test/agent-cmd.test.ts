import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

test("asp agent: add more agents, list them with their state, choose the default, run a named one; the service caps how many a tenant has", async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "ok" }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-agents-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "multi", role: "tenant", tokenSha256: hashToken("tok-m") }]));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`, "--max-agents", "3"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:multi`, first = `did:web:127.0.0.1%3A${port}:a:multi:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:multi:bank`;
    const cfgPath = join(f.aspHome, "config.json");
    writeFileSync(cfgPath, JSON.stringify({ service: base, token: "tok-m", tenant: "multi", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent: first, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl };
    const call = async (args: string[]) => { const out: string[] = [], err: string[] = []; const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io); return { code, out: out.join("\n"), err: err.join("\n") }; };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "First"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);

    const one = await call(["agent", "list"]);
    assert.equal(one.code, 0, one.err);
    // Three lines per agent: the name, the identity address, the key (which one, never the secret), and the use.
    assert.match(one.out, /my-agent {2}\(default\)\n {6}identity {2}did:\S+\n {6}key {7}here on this machine \(key-1\); the secret is never shown; recoverable by you\n {6}sessions {2}0\n/);
    // Add one; it is a different identity with its own key, sponsored by you.
    const added = await call(["agent", "add", "helper", "--purpose", "Writes the tests"]);
    assert.equal(added.code, 0, added.err);
    assert.match(added.out, new RegExp(`added agent helper: did:web:127\\.0\\.0\\.1%3A${port}:a:multi:helper`));
    assert.match(added.out, /asp run claude-code --agent helper/);
    assert.equal((await call(["agent", "add", "helper"])).code, 1, "the name is taken");
    assert.equal((await call(["agent", "add", "Bad_Name"])).code, 2);
    // Run the named agent; the history shows which agent ran.
    const ran = await call(["run", "claude-code", "--agent", "helper", "--prompt", "Write a test", "--project", project]);
    assert.equal(ran.code, 0, ran.err);
    assert.match(ran.err, /session [0-9a-f]{8}: helper may read and write files/);
    const list = await call(["agent", "list"]);
    assert.match(list.out, /helper\n {6}identity {2}did:\S+\n {6}key {7}here on this machine[^\n]*recoverable by you\n {6}sessions {2}1, last \d+s ago; standing job until /);
    assert.match(list.out, /my-agent {2}\(default\)\n {6}identity {2}did:\S+\n {6}key {7}here on this machine[^\n]*\n {6}sessions {2}0\n/);
    assert.ok(!/seed|[0-9a-f]{64}/.test(list.out), "the secret is never in the list");
    assert.match(list.out, /2 agent\(s\)/);
    // The default: asp run without --agent uses it.
    assert.equal((await call(["agent", "use", "helper"])).code, 0);
    assert.equal(JSON.parse(readFileSync(cfgPath, "utf8")).identities.agent, `did:web:127.0.0.1%3A${port}:a:multi:helper`);
    assert.match((await call(["agent", "list"])).out, /helper\s+\(default\)/);
    assert.match((await call(["run", "claude-code", "--prompt", "Another", "--project", project])).err, /session [0-9a-f]{8}: helper may/);
    assert.equal((await call(["agent", "use", "nobody"])).code, 1);
    // The service's cap (three here): the third is fine, the fourth is refused.
    assert.equal((await call(["agent", "add", "third"])).code, 0);
    const fourth = await call(["agent", "add", "fourth"]);
    assert.equal(fourth.code, 1);
    assert.match(fourth.err, /already has 3 agents; the beta allows 3/);
    // Not joined: it says so.
    const lone = makeFixture();
    const o: string[] = [], e: string[] = [];
    const code = await main(["agent", "list"], { out: (l) => o.push(l), err: (l) => e.push(l), env: { ASP_HOME: lone.aspHome }, cwd: lone.root });
    assert.equal(code, 1);
    assert.match(e.join("\n"), /run asp join first/);
  } finally {
    server.kill(); upstream.close();
  }
});
