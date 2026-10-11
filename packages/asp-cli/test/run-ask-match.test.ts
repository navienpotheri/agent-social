import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

test("per-command approval: only risky commands (or the ones you match) are asked about, 'a' remembers an exact command, and it can be taken back", async () => {
  let command = "npm run build";
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Running it." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-askmatch-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "am", role: "tenant", tokenSha256: hashToken("tok-am") }]));
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
    const me = `did:web:127.0.0.1%3A${port}:u:am`, agent = `did:web:127.0.0.1%3A${port}:a:am:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:am:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: base, token: "tok-am", tenant: "am", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_APPROVAL_POLL_MS: "150", ASP_GATEWAY_POLL_MS: "300" };
    const call = async (args: string[], ask?: (q: string) => Promise<string>) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()), ...(ask ? { ask } : {}) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);
    const session = (extra: string[], ask?: (q: string) => Promise<string>) => call(["run", "claude-code", "--prompt", "Do it", "--project", project, ...extra], ask);
    const neverAsked = async (q: string) => { throw new Error(`should not have been asked: ${q}`); };

    // A harmless command with --ask risky: not asked about, and it reaches the agent.
    const quiet = await session(["--ask", "risky"], neverAsked);
    assert.equal(quiet.code, 0, quiet.err);
    assert.match(quiet.out, /tool_use:Bash/);

    // A risky one is asked about; no keeps it from the agent.
    command = "cd app && git push origin main";
    const asked: string[] = [];
    const no = await session(["--ask", "risky"], async (q) => { asked.push(q); return "n"; });
    assert.equal(no.code, 0, no.err);
    assert.match(asked[0], /Allow shell\.exec: cd app && git push origin main\? \[y\/N\/a\]/);
    assert.ok(!/tool_use:Bash/.test(no.out));

    // "a": allowed now, and remembered as that exact command for this agent.
    const always = await session(["--ask", "risky"], async () => "a");
    assert.match(always.out, /tool_use:Bash/);
    assert.match(always.err, /remembered: my-agent may run that exact command without asking/);
    const file = join(f.aspHome, "always-allow.json");
    assert.ok(existsSync(file));
    assert.equal(Object.values(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown[]>)[0].length, 1);
    assert.match((await call(["approvals", "always"])).out, /1\s+my-agent\s+cd app && git push origin main/);
    // The next session runs it without asking (even with --ask commands, which asks about everything else) ...
    const again = await session(["--ask", "commands"], neverAsked);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /tool_use:Bash/);
    // ... but a different command is still asked about, and so is the same words with something added.
    command = "cd app && git push origin main --force";
    const other: string[] = [];
    await session(["--ask", "commands"], async (q) => { other.push(q); return "n"; });
    assert.equal(other.length, 1);

    // Taking it back: it is asked about again.
    command = "cd app && git push origin main";
    assert.match((await call(["approvals", "forget", "1"])).out, /forgot 1 command/);
    assert.match((await call(["approvals", "always"])).out, /no command is allowed for always/);
    const back: string[] = [];
    await session(["--ask", "risky"], async (q) => { back.push(q); return "n"; });
    assert.equal(back.length, 1);

    // Your own patterns: only what matches is asked about.
    command = "make deploy";
    const mine: string[] = [];
    await session(["--ask-match", "re:\\bdeploy\\b"], async (q) => { mine.push(q); return "n"; });
    assert.equal(mine.length, 1);
    command = "make docs";
    assert.match((await session(["--ask-match", "re:\\bdeploy\\b"], neverAsked)).out, /tool_use:Bash/);
    // A masked or cut-short command is shown but cannot be remembered: no "a" is offered.
    command = "GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 git push origin main";
    const masked: string[] = [];
    await session(["--ask", "risky"], async (q) => { masked.push(q); return "n"; });
    assert.match(masked[0], /\[y\/N\] $/);
    // A bad pattern is a usage error, before anything starts.
    const badRe = await session(["--ask-match", "re:("]);
    assert.equal(badRe.code, 2);
    assert.match(badRe.err, /not a valid regular expression/);
    assert.equal((await call(["approvals", "forget"])).code, 2);
  } finally {
    server.kill(); upstream.close();
  }
});
