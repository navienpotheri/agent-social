import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, ownPort } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));

function startService(dir: string, tokens: string, port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let buf = "";
    server.stdout!.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(server); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
  });
}

// T16 / UC-236: the account's record limit is full. The principle is that a person is never stopped from running their own agent, and a session that did its work never reads as failed.
test("a full record quota: sessions still run and succeed, say why in one sentence, keep their reports, and send them by themselves once there is room", { timeout: 150_000 }, async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Working." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "echo hi" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-quota-"));
  const tokens = join(dir, "tokens.json");
  const writeTokens = (recordQuota: number) => writeFileSync(tokens, JSON.stringify([{ name: "q", role: "tenant", tokenSha256: hashToken("tok-q"), recordQuota }]));
  writeTokens(14);
  const port = await ownPort();
  let server = await startService(dir, tokens, port);
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:q`, agent = `did:web:127.0.0.1%3A${port}:a:q:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:q:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: `http://127.0.0.1:${port}`, token: "tok-q", tenant: "q", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl };
    const call = async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);

    // Run until the account is full.
    let full: { code: number; out: string; err: string } | undefined;
    for (let i = 1; i <= 14 && !full; i++) {
      const r = await call(["run", "claude-code", "--prompt", `Task ${i}`, "--project", project]);
      // Every session's summary shows credits (the owner's choice, 2026-10-13): this account has none, and the session moved none.
      assert.match(r.out, /\n {2}credits {2}you 0, my-agent 0 {2}\(asp credits has the detail\)/, `a credits line in the summary\n${r.out}`);
      if (/NOT recorded in the log yet/.test(r.out)) full = r; else assert.equal(r.code, 0, r.err + r.out);
    }
    assert.ok(full, "the account filled up");
    // The agent worked, so the session is a success; the person is told the cause and that nothing is theirs to do.
    assert.equal(full!.code, 0, "only the record failed: not a failing exit code\n" + full!.err + full!.out);
    assert.match(full!.out, /session +[0-9a-f]{8} +finished/);
    assert.match(full!.out, /record +NOT recorded in the log yet: your account's record limit is full\. Your agent ran and the run log below is complete\. This report is kept and is sent by itself the next time there is room and a connection\. To make room, ask the operator to raise the limit/, full!.out);
    assert.doesNotMatch(full!.out, /the service refused it/, "the cause is named, not 'refused'");
    assert.ok(readdirSync(join(f.aspHome, "outbox")).length >= 1, "the report is kept");
    // More sessions while it is full: each still runs and succeeds; the reports wait.
    const more = await call(["run", "claude-code", "--prompt", "Another", "--project", project]);
    assert.equal(more.code, 0, more.err + more.out);
    const waiting = readdirSync(join(f.aspHome, "outbox")).length;
    assert.ok(waiting >= 2, `reports wait: ${waiting}`);
    // asp status says it, before and after, in one place.
    const st = await call(["status"]);
    assert.match(st.out, /of 14 record\(s\) written/);
    assert.match(st.out, /report\(s\) from earlier sessions are waiting to be sent/);
    assert.match(st.out, /your account is (full|nearly full) \(\d+ of 14 records\)/);

    // The operator raises the limit. The next session sends what was waiting, without being asked.
    server.kill();
    writeTokens(500);
    server = await startService(dir, tokens, port);
    const after = await call(["run", "claude-code", "--prompt", "After the raise", "--project", project]);
    assert.equal(after.code, 0, after.err + after.out);
    assert.match(after.err, new RegExp(`sent ${waiting} earlier report\\(s\\) that had been waiting`), after.err);
    assert.doesNotMatch(after.out, /NOT recorded/);
    assert.ok(!existsSync(join(f.aspHome, "outbox")) || readdirSync(join(f.aspHome, "outbox")).length === 0, "nothing is left waiting");
    assert.match((await call(["status"])).out, /of 500 record\(s\) written/);
  } finally { server.kill(); upstream.close(); }
});
