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
const fakeAgent = fileURLToPath(new URL("./fake-openai-agent.mjs", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

test("asp run codex and asp run goose: governed sessions with the person's own API key, which the gateway holds and the tool never sees; a call the Mandate does not allow never arrives", async () => {
  // The model provider: asks the tool to run a curl; records the key it was given.
  const keysSeen: string[] = [];
  const provider = createHttp(async (req, res) => {
    keysSeen.push(String(req.headers.authorization ?? ""));
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 4, completion_tokens: 3 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "Fetching it.", tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: JSON.stringify({ command: "curl -s http://evil.example/x" }) } }] } }] }));
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const provUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
  const dir = mkdtempSync(join(tmpdir(), "asp-runtimes-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "rt", role: "tenant", tokenSha256: hashToken("tok-r") }]));
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
    const me = `did:web:127.0.0.1%3A${port}:u:rt`, agent = `did:web:127.0.0.1%3A${port}:a:rt:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:rt:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: base, token: "tok-r", tenant: "rt", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const baseEnv = { ASP_HOME: f.aspHome, ASP_CODEX_BIN: fakeAgent, ASP_GOOSE_BIN: fakeAgent, ASP_RUN_OPENAI_UPSTREAM: provUrl };
    const call = async (args: string[], extra: Record<string, string> = {}) => { const out: string[] = [], err: string[] = []; const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ...baseEnv, ...extra }, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io); return { code, out: out.join("\n"), err: err.join("\n") }; };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);

    // What is needed is said plainly: a task, a model for Goose, the person's own key.
    const noPrompt = await call(["run", "codex", "--project", project], { OPENAI_API_KEY: "sk-real-key" });
    assert.equal(noPrompt.code, 2);
    assert.match(noPrompt.err, /asp run codex needs --prompt/);
    assert.match((await call(["run", "goose", "--prompt", "x", "--project", project], { OPENAI_API_KEY: "sk-real-key" })).err, /asp run goose needs --model/);
    const noKey = await call(["run", "codex", "--prompt", "x", "--project", project]);
    assert.equal(noKey.code, 2);
    assert.match(noKey.err, /uses your own openai key: set the environment variable OPENAI_API_KEY/);
    assert.match((await call(["run", "codex", "--prompt", "x", "--provider", "nope"], { OPENAI_API_KEY: "k" })).err, /--provider is openai or openrouter/);

    // Codex: the call is refused before the tool receives it; the tool's key is the gateway's placeholder, the real one went to the provider.
    const codex = await call(["run", "codex", "--prompt", "Fetch the page", "--project", project], { OPENAI_API_KEY: "sk-real-key" });
    assert.equal(codex.code, 0, codex.err + codex.out);
    assert.match(codex.out, /agent received tool calls: none/);
    assert.match(codex.out, /\[ASP\] The action "shell" was not run/);
    assert.ok(!codex.out.includes("sk-real-key") && !codex.err.includes("sk-real-key"), "the real key never reaches the tool or the screen");
    assert.match(codex.out, /argv: exec --skip-git-repo-check/);
    assert.match(codex.out, /calls\s+1 tool call\(s\) judged, 1 refused/);
    assert.match(codex.out, /refused\s+shell -> shell\.network/);
    assert.ok(keysSeen.includes("Bearer sk-real-key"), "the provider got the person's own key");

    // Goose with OpenRouter and a named key variable.
    const goose = await call(["run", "goose", "--prompt", "Fetch the page", "--model", "some/model", "--provider", "openrouter", "--api-key-env", "MY_OR_KEY", "--project", project], { MY_OR_KEY: "sk-or-key" });
    assert.equal(goose.code, 0, goose.err + goose.out);
    assert.match(goose.out, /argv: run --with-builtin/);
    assert.match(goose.out, /refused\s+shell -> shell\.network/);
    assert.ok(keysSeen.includes("Bearer sk-or-key"));
    assert.ok(!goose.out.includes("sk-or-key"));
    // The sessions are in the history, with their runtime, under the same standing job.
    const runs = await call(["runs"]);
    assert.match(runs.out, /codex\s+ended\s+1 calls, 1 refused/);
    assert.match(runs.out, /goose\s+ended\s+1 calls, 1 refused/);
    assert.match((await call(["standing"])).out, /2 session\(s\)/);
    // OpenHands and Antigravity are sessions too (S112, tested in run-hooked.test.ts); like Codex they need a task.
    const oh = await call(["run", "openhands"]);
    assert.equal(oh.code, 2);
    assert.match(oh.err, /asp run openhands needs --prompt/);
  } finally {
    server.kill(); provider.close();
  }
});
