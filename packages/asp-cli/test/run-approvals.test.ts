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
const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 20_000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 80)); } };

test("inline approvals: a call on a gated scope waits for your yes; asked in the terminal, or answered from another window with asp approvals; yes lets it through, no keeps it from the agent", async () => {
  // The model asks to run a command.
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Running it." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "npm run build" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-approvals-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "appr", role: "tenant", tokenSha256: hashToken("tok-a") }]));
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
    const me = `did:web:127.0.0.1%3A${port}:u:appr`, agent = `did:web:127.0.0.1%3A${port}:a:appr:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:appr:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: base, token: "tok-a", tenant: "appr", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_APPROVAL_POLL_MS: "150", ASP_GATEWAY_POLL_MS: "300" };
    const call = async (args: string[], ask?: (q: string) => Promise<string>) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()), ...(ask ? { ask } : {}) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);

    // --ask must name a scope the session has.
    const bad = await call(["run", "claude-code", "--prompt", "x", "--project", project, "--ask", "repo.push"]);
    assert.equal(bad.code, 2);
    assert.match(bad.err, /--ask repo\.push: that scope is not in this session's Mandate/);

    // 1. Not at a terminal: the session says where to answer; the agent's call is held until you do, from another window.
    const held = call(["run", "claude-code", "--prompt", "Push the branch", "--project", project, "--ask", "commands"]);
    await until("an approval waiting", async () => /npm run build/.test((await call(["approvals"])).out));
    const list = await call(["approvals"]);
    assert.match(list.out, /1\s+May .* run Bash \(shell\.exec\)\?\s+npm run build/);
    assert.match(list.out, /asp approvals approve \[n\]/);
    assert.match((await call(["approvals", "approve"])).out, /approved: May .* run Bash/);
    const done1 = await held;
    assert.equal(done1.code, 0, done1.err + done1.out);
    assert.match(done1.err, /approval needed for shell\.exec: npm run build +\(answer in another window: asp approvals approve/);
    assert.match(done1.err, /asks you first for shell\.exec/);
    assert.match(done1.out, /agent received: text, tool_use:Bash/, "approved: the call reached the agent");
    assert.match((await call(["approvals"])).out, /nothing is waiting/);

    // 2. At a terminal (answered here by the test): yes lets it through.
    const asked: string[] = [];
    const yes = await call(["run", "claude-code", "--prompt", "Push again", "--project", project, "--ask", "commands"], async (q) => { asked.push(q); return "y"; });
    assert.equal(yes.code, 0, yes.err);
    assert.match(asked[0], /Allow shell\.exec: npm run build\? \[y\/N\/a\]/);
    assert.match(yes.out, /tool_use:Bash/);
    // ... and no keeps it from the agent, which is told why.
    const no = await call(["run", "claude-code", "--prompt", "Push once more", "--project", project, "--ask", "commands"], async () => "n");
    assert.equal(no.code, 0, no.err);
    assert.ok(!/tool_use:Bash/.test(no.out), "refused: the call never reached the agent");
    assert.match(no.out, /\[ASP\] The action "Bash" was not run: the scope shell\.exec needs the principal's approval and it was not given: refused by you/);
    // The same standing job served all three sessions, and the gate is in its Mandate.
    assert.match((await call(["standing"])).out, /3 session\(s\)/);
    // A session that does not ask about commands is a different standing job (no gate).
    assert.match((await call(["run", "claude-code", "--prompt", "No gate", "--project", project])).err, /new standing job/);
  } finally {
    server.kill(); upstream.close();
  }
});
