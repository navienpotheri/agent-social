import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
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
const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 25_000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 150)); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startService(dir: string, tokens: string, port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let buf = "";
    server.stdout!.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(server); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
  });
}

// UC-35: the laptop sleeps or the wifi drops in the middle of a session. Two places it hurts: while a call is held for the person's yes (the service is out of reach), and while the model is answering.
test("the service is unreachable for a few seconds while a call is held for approval: the session waits it out, and the approval still works when the service is back", async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Running it." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "npm run build" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-drop-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "drop", role: "tenant", tokenSha256: hashToken("tok-d") }]));
  const port = await freePort();
  let server = await startService(dir, tokens, port);
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:drop`, agent = `did:web:127.0.0.1%3A${port}:a:drop:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:drop:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: `http://127.0.0.1:${port}`, token: "tok-d", tenant: "drop", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_APPROVAL_POLL_MS: "150", ASP_GATEWAY_POLL_MS: "300" };
    const call = async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);

    const held = call(["run", "claude-code", "--prompt", "Build it", "--project", project, "--ask", "commands"]);
    await until("an approval waiting", async () => /npm run build/.test((await call(["approvals"])).out));
    // The wifi drops: the service cannot be reached for a few seconds, then it is back.
    server.kill();
    await sleep(3500);
    const during = await call(["approvals"]);
    assert.match(during.err + during.out, /cannot reach the (log )?service at .*nothing is answering there/s, "while it is out of reach, a command says so plainly");
    server = await startService(dir, tokens, port);
    await until("the approval after the drop", async () => /npm run build/.test((await call(["approvals"])).out));
    assert.match((await call(["approvals", "approve"])).out, /approved/);
    const done = await held;
    assert.equal(done.code, 0, done.err + done.out);
    assert.match(done.out, /agent received: text, tool_use:Bash/, "approved after the drop: the call reached the agent\n" + done.err);
    assert.match((await call(["approvals"])).out, /nothing is waiting/);
  } finally { server.kill(); upstream.close(); }
});

test("you answer yes at the prompt while the service cannot be reached: the answer is kept and sent when it is back, and the call goes through", async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Running it." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "npm run build" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-drop3-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "drop", role: "tenant", tokenSha256: hashToken("tok-d") }]));
  const port = await freePort();
  let server = await startService(dir, tokens, port);
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:drop`, agent = `did:web:127.0.0.1%3A${port}:a:drop:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:drop:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: `http://127.0.0.1:${port}`, token: "tok-d", tenant: "drop", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_APPROVAL_POLL_MS: "150", ASP_GATEWAY_POLL_MS: "300" };
    const call = async (args: string[], ask?: (q: string) => Promise<string>) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()), ...(ask ? { ask } : {}) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);
    // The wifi drops just as you type y: the service goes away while the prompt is open, and comes back a few seconds later.
    const done = await call(["run", "claude-code", "--prompt", "Build it", "--project", project, "--ask", "commands"], async () => {
      server.kill();
      setTimeout(() => { void startService(dir, tokens, port).then((s) => { server = s; }); }, 4000);
      await sleep(500);
      return "y";
    });
    assert.equal(done.code, 0, done.err + done.out);
    assert.match(done.err, /your answer \(yes\) is kept: the log service cannot be reached/, done.err);
    assert.match(done.err, /your answer was recorded/, done.err);
    assert.match(done.out, /agent received: text, tool_use:Bash/, "the call went through once the answer was recorded\n" + done.err);
  } finally { server.kill(); upstream.close(); }
});

test("the service drops during an ordinary session and stays down until it ends: the session still ends cleanly and says what could not be recorded, and the next session works once the service is back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-drop2-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "drop", role: "tenant", tokenSha256: hashToken("tok-d") }]));
  const port = await freePort();
  let server = await startService(dir, tokens, port);
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Working." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "echo hi" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:drop`, agent = `did:web:127.0.0.1%3A${port}:a:drop:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:drop:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: `http://127.0.0.1:${port}`, token: "tok-d", tenant: "drop", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: join(fileURLToPath(new URL(".", import.meta.url)), "fake-claude-late.mjs"), ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_GATEWAY_POLL_MS: "300" };
    const call = async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);
    const running = call(["run", "claude-code", "--prompt", "Work for a while", "--project", project]);
    await until("the session to be running", async () => /running/.test((await call(["runs"])).out.split("\n")[0] ?? ""));
    server.kill();
    const done = await running;
    // The agent did its work; only the record could not be sent, and the summary says so instead of calling the session failed or claiming the Action is in the log.
    assert.match(done.out, /session +[0-9a-f]{8} +finished/, done.out);
    assert.match(done.out, /\n {2}record {3}NOT recorded in the log: the service could not be reached/, done.out);
    assert.match(done.out, /this session's signed Action is not in the log/, done.out);
    assert.doesNotMatch(done.out, /the signed Action reports are in the log/);
    assert.match(done.out, /run log +.*run-log\.ndjson/, "the local run log is named");
    server = await startService(dir, tokens, port);
    const next = await call(["run", "claude-code", "--prompt", "Again", "--project", project]);
    assert.equal(next.code, 0, next.err + next.out);
    assert.match(next.out, /the signed Action reports are in the log/, "the next session records normally");
    assert.match((await call(["runs"])).out, /claude-code\s+ended\s+1 calls.*\n.*claude-code\s+ended\s+1 calls/, "both sessions are listed as ended");
  } finally { server.kill(); upstream.close(); }
});

test("the provider cuts the connection while the model is answering: the person is told which provider and why, and the next session works", async () => {
  let cut = true;
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    if (cut) { res.writeHead(200, { "content-type": "application/json" }); res.write('{"id":"msg","type":"mes'); setTimeout(() => req.socket.destroy(), 50); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "All good." }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl };
    const run = async (prompt: string) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(["run", "claude-code", "--local", "--prompt", prompt, "--project", project], { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    const dropped = await run("Answer me");
    assert.match(dropped.out, /\n {2}provider lost the connection to 127\.0\.0\.1:\d+ while it was answering/, dropped.out);
    assert.match(dropped.err, /\n {2}provider +lost the connection/, "said while the session runs too");
    assert.doesNotMatch(dropped.out, /agent received: text/, "the agent was not handed half an answer");
    cut = false;
    const again = await run("Answer me again");
    assert.equal(again.code, 0, again.err + again.out);
    assert.match(again.out, /agent received: text\nAll good\./, "the next session gets its answer");
    assert.doesNotMatch(again.out, /\n {2}provider /);
  } finally { upstream.close(); }
});
