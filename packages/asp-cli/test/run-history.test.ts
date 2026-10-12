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
import { openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const scriptOf = (n: string) => fileURLToPath(new URL(`./${n}`, import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 20_000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 80)); } };

test("asp runs lists and explains governed sessions, and asp stop ends a running one from another window: the job is revoked and the tool is ended", async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "ok" }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-history-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "hist", role: "tenant", tokenSha256: hashToken("tok-h") }]));
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
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:hist`, agent = `did:web:127.0.0.1%3A${port}:a:hist:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:hist:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: base, token: "tok-h", tenant: "hist", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = (script: string) => ({ ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: scriptOf(script), ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_GATEWAY_POLL_MS: "200" });
    const call = async (script: string, args: string[]) => { const out: string[] = [], err: string[] = []; const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: env(script), cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io); return { code, out: out.join("\n"), err: err.join("\n") }; };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call("fake-claude-gateway.mjs", a)).code, 0);

    // No sessions yet.
    assert.match((await call("fake-claude-gateway.mjs", ["runs"])).out, /no sessions yet/);
    assert.match((await call("fake-claude-gateway.mjs", ["stop"])).out, /nothing is running/);

    // A finished session appears in the history and can be explained.
    const done = await call("fake-claude-gateway.mjs", ["run", "claude-code", "--prompt", "A finished task", "--project", project]);
    assert.equal(done.code, 0, done.err + done.out);
    const id = /\(asp runs ([0-9a-f]{8})\)/.exec(done.out)![1];
    const list = await call("fake-claude-gateway.mjs", ["runs"]);
    assert.match(list.out, new RegExp(`${id}\\s+\\d+s ago\\s+claude-code\\s+ended\\s+\\d+ calls, 0 refused\\s+A finished task`));
    const detail = await call("fake-claude-gateway.mjs", ["runs", id]);
    assert.equal(detail.code, 0, detail.err);
    assert.match(detail.out, /task\s+A finished task/);
    assert.match(detail.out, /mandate\s+repo\.read, repo\.write, shell\.exec, tests\.run; no network\s+\(standing job sha256:/);
    assert.match(detail.out, /ended\s+\S+ \(ended, exit 0\)/);
    assert.match(detail.out, /in the log \d+ records on the standing job/);
    assert.equal((await call("fake-claude-gateway.mjs", ["runs", "zzzzzzzz"])).code, 1);

    // A session that keeps going: stop it from "another window" and the tool ends.
    const running = call("fake-claude-wait.mjs", ["run", "claude-code", "--prompt", "A long task", "--project", project]);
    await until("the running session in the history", async () => /running\?/.test((await call("fake-claude-gateway.mjs", ["runs"])).out));
    const stop = await call("fake-claude-gateway.mjs", ["stop"]);
    assert.equal(stop.code, 0, stop.err);
    assert.match(stop.out, /stopping session [0-9a-f]{8}: its tool ends within a few seconds/);
    const finished = await running;
    assert.match(finished.out, /stopped by you/);
    const after = await call("fake-claude-gateway.mjs", ["runs"]);
    assert.match(after.out, /A long task/);
    assert.match(after.out, /stopped/);
    assert.match((await call("fake-claude-gateway.mjs", ["stop"])).out, /nothing is running/);

    // The standing job: later sessions reuse the first's job, so each costs only its Action reports, not a dozen records.
    const head = async () => (await (await openLog(f.aspHome, { ASP_LOG_URL: base, ASP_LOG_TOKEN: "tok-h" })).log.head()).seq;
    const standingBefore = await call("fake-claude-gateway.mjs", ["standing"]);
    assert.match(standingBefore.out, /my-agent\s+repo\.read,repo\.write,shell\.exec,tests\.run\s+2 session\(s\), until /, standingBefore.out);
    const seq0 = await head();
    const again = await call("fake-claude-gateway.mjs", ["run", "claude-code", "--prompt", "A third task", "--project", project]);
    assert.match(again.err, /standing job, session 3, until /);
    const grew = (await head()) - seq0;
    assert.ok(grew >= 1 && grew <= 3, `a session adds its Action report(s), not a job: ${grew} records`);
    // A different permission set is a different standing job; ending them settles them and the next run makes a new one.
    const net = await call("fake-claude-gateway.mjs", ["run", "claude-code", "--prompt", "Needs the web", "--project", project, "--allow-network", "docs.example.org"]);
    assert.match(net.err, /reach docs\.example\.org; new standing job/);
    assert.match((await call("fake-claude-gateway.mjs", ["standing"])).out, /\+docs\.example\.org/);
    assert.match((await call("fake-claude-gateway.mjs", ["standing", "end"])).out, /2 standing job\(s\) ended/);
    assert.match((await call("fake-claude-gateway.mjs", ["standing"])).out, /no standing jobs yet/);
    assert.match((await call("fake-claude-gateway.mjs", ["run", "claude-code", "--prompt", "After ending", "--project", project])).err, /new standing job \(7 days\)/);
  } finally {
    server.kill(); upstream.close();
  }
});
