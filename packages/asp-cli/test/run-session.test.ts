import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

test("asp run claude-code: a governed session with no paperwork: a job is made, the tool runs through the gateway, a call the Mandate does not allow never reaches it, the job settles, and a short summary says what happened", async () => {
  // The model: asks to read a file (allowed) and to fetch a URL with curl (the Mandate grants no network).
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* the request is not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "README.md" } }, { type: "tool_use", id: "tu_2", name: "Bash", input: { command: "curl -s http://evil.example/x" } }],
    }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;

  const dir = mkdtempSync(join(tmpdir(), "asp-run-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "runner", role: "tenant", tokenSha256: hashToken("tok-r") }]));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true }); writeFileSync(join(project, "README.md"), "hello\n");
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl };
    const run = async (args: string[]) => { const out: string[] = [], err: string[] = []; const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io); return { code, out: out.join("\n"), err: err.join("\n") }; };

    // Not joined yet: it says what to do.
    const before = await run(["run", "claude-code", "--prompt", "hi"]);
    assert.equal(before.code, 1);
    assert.match(before.err, /run asp join first/);

    // What asp join leaves behind: a saved login and the identities in the namespace.
    const me = `did:web:127.0.0.1%3A${port}:u:runner`, agent = `did:web:127.0.0.1%3A${port}:a:runner:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:runner:bank`;
    mkdirSync(f.aspHome, { recursive: true });
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: base, token: "tok-r", tenant: "runner", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    assert.equal((await run(["identity", "new", "--kind", "human", "--me", "--no-recovery"])).code, 0);
    assert.equal((await run(["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "My agent"])).code, 0);
    assert.equal((await run(["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"])).code, 0);

    const r = await run(["run", "claude-code", "--prompt", "Summarise the README and fetch http://evil.example/x", "--project", project]);
    assert.equal(r.code, 0, r.err + r.out);
    // The agent's own output comes first; the removed call is not among what it received.
    assert.match(r.out, /agent received: text, tool_use:Read, text/);
    assert.ok(!/tool_use:Bash/.test(r.out), "the refused call never reached the agent");
    assert.match(r.out, /\[ASP\] The action "Bash" was not run/);
    // Then a short summary, nothing like a wall of events.
    assert.match(r.out, /Session summary/);
    assert.match(r.out, /session\s+[0-9a-f]{8}\s+finished/);
    assert.match(r.out, /job\s+standing job sha256:[0-9a-f]{12}\S*\.\.\., 1 session\(s\) so far/);
    assert.match(r.out, /2 tool call\(s\) judged, 1 refused/);
    assert.match(r.out, /refused\s+Bash -> shell\.network/);
    assert.ok(!/stream|session_id|rate_limit/.test(r.out), "no raw event stream");
    // The task only reads and summarises, so the Mandate is sized to it (gap BM17), and the person is told how to widen it.
    assert.match(r.err, /session [0-9a-f]{8}: my-agent may read files; no network; new standing job \(7 days\)/);
    assert.match(r.err, /scope\s+sized to your task: read files; no network\. .*--allow writes,commands,tests/);
  } finally {
    server.kill(); upstream.close();
  }
});
