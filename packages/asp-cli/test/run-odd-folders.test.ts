import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, ownPort } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));

// UC-16, gap T2: the folders a first session meets that are not a tidy git repository. (Spaces and non-ASCII characters in the path are in evals/smoke-first-minutes.mjs.)
test("a folder that is not a git repository, and a folder of 10,000 files, are ordinary: the session starts promptly, finishes, and the summary says so", { timeout: 900_000 }, async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Done." }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-oddfolders-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "of", role: "tenant", tokenSha256: hashToken("tok-of") }]));
  const port = await ownPort();
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`, "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    mkdirSync(f.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:of`, agent = `did:web:127.0.0.1%3A${port}:a:of:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:of:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: `http://127.0.0.1:${port}`, token: "tok-of", tenant: "of", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_GATEWAY_POLL_MS: "300" };
    const call = async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);
    const session = (project: string) => call(["run", "claude-code", "--prompt", "Do it", "--allow", "all", "--project", project]);

    // Not a git repository: a plain folder with a file in it. Nothing in the session may need git.
    const plain = join(f.root, "not-a-repo"); mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, "notes.txt"), "hello\n");
    assert.ok(!existsSync(join(plain, ".git")), "the folder is not a repository");
    const a = await session(plain);
    assert.equal(a.code, 0, a.err);
    assert.match(a.out + a.err, /finished/);
    assert.doesNotMatch(a.err, /not a git|git repository|fatal/i);

    // A very large folder: small files in nested folders, 10,000 by default (ASP_TEST_BIG_FILES=100000 for the size in gap T2). The tool, not asp, would read them; asp must not walk them to start.
    const files = Math.max(100, Number(process.env.ASP_TEST_BIG_FILES) || 10_000);
    const big = join(f.root, "big"); mkdirSync(big, { recursive: true });
    for (let d = 0; d < Math.ceil(files / 100); d++) {
      const sub = join(big, `d${d}`); mkdirSync(sub);
      for (let i = 0; i < 100; i++) writeFileSync(join(sub, `f${i}.txt`), "x");
    }
    const t0 = Date.now();
    const b = await session(big);
    const took = Date.now() - t0;
    assert.equal(b.code, 0, b.err);
    assert.match(b.out + b.err, /finished/);
    assert.ok(took < 60_000, `a session in a folder of ${files} files took ${took} ms`);
  } finally {
    server.kill(); upstream.close();
  }
});
