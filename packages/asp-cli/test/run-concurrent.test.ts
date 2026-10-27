import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, ownPort } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));
const freePort = ownPort;
/** A wait that names itself when it is stuck, so a hang fails with where, not after two minutes of nothing. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const within =<T,>(label: string, p: Promise<T>, ms = 45_000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`stuck waiting for ${label}`)), ms))]);
const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 20_000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 150)); } };

// Two terminals on one agent (UC-138). Found while writing it: the watcher read the job's state as unknown while the other session wrote the log, took that for the job ending, and stopped.
test("two sessions of one agent at once share the standing job: approvals are asked one at a time, neither session fails, and ending one leaves the other undisturbed", { timeout: 120_000 }, async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Running it." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "npm run build" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-interrupt-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "intr", role: "tenant", tokenSha256: hashToken("tok-i") }]));
  const port = await freePort();
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
    const me = `did:web:127.0.0.1%3A${port}:u:intr`, agent = `did:web:127.0.0.1%3A${port}:a:intr:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:intr:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: `http://127.0.0.1:${port}`, token: "tok-i", tenant: "intr", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_APPROVAL_POLL_MS: "150", ASP_GATEWAY_POLL_MS: "300", ASP_GATEWAY_KILL_GRACE_MS: "0" };
    const call = async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    // Answering can fail for a moment on a busy machine (the service is slow to answer); a person just tries again, so the test does too, and shows the real error if it keeps failing.
    const approve = async () => {
      let last = { code: 0, out: "", err: "" };
      for (let i = 0; i < 4; i++) { last = await call(["approvals", "approve"]); if (/approved/.test(last.out)) return last; await sleep(1000); }
      assert.fail(`approvals approve did not succeed in 4 tries: ${last.err || "no output"}`);
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);

    // Both sessions ask about the same command. A job has one open Checkpoint at a time, so the second request waits its turn and is shown once the first is answered; neither fails.
    const A = call(["run", "claude-code", "--prompt", "Session A", "--project", project, "--allow", "all", "--ask", "commands"]);
    await until("the first approval", async () => /npm run build/.test((await call(["approvals"])).out));
    const B = call(["run", "claude-code", "--prompt", "Session B", "--project", project, "--allow", "all", "--ask", "commands"]);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal((await call(["approvals"])).out.match(/npm run build/g)?.length, 1, "one request is shown at a time");
    await approve();
    await until("the second approval", async () => /npm run build/.test((await call(["approvals"])).out));
    await approve();
    for (const d of await within("sessions A and B to finish", Promise.all([A, B]))) { assert.equal(d.code, 0, d.err + d.out); assert.match(d.out, /agent received: text, tool_use:Bash/, "approved: the call reached the agent"); }
    assert.match((await call(["standing"])).out, /2 session\(s\)/);
    assert.match((await call(["approvals"])).out, /nothing is waiting/);

    // One terminal is ended with asp stop while the other is still held: the ended one takes its own request with it, the other is not disturbed and is asked next.
    const C = call(["run", "claude-code", "--prompt", "Session C", "--project", project, "--allow", "all", "--ask", "commands"]);
    await until("C's approval", async () => /npm run build/.test((await call(["approvals"])).out));
    const D = call(["run", "claude-code", "--prompt", "Session D", "--project", project, "--allow", "all", "--ask", "commands"]);
    await new Promise((r) => setTimeout(r, 2500));
    const cId = (await call(["runs"])).out.split("\n").find((l) => /Session C/.test(l))!.trim().split(/\s+/)[0];
    assert.equal((await call(["stop", cId])).code, 0);
    assert.match((await within("session C to stop", C)).out, /stopped by you/);
    await until("D's approval", async () => /npm run build/.test((await call(["approvals"])).out));
    await approve();
    const dd = await within("session D to finish", D).catch(async (e) => { const contract = Object.values(JSON.parse(readFileSync(join(f.aspHome, "standing.json"), "utf8")) as Record<string, { contract: string }>)[0].contract; console.error("DIAG approvals:", (await call(["approvals"])).out, "\nDIAG runs:", (await call(["runs"])).out, "\nDIAG job:", (await call(["market", "show", contract])).out.slice(0, 1500), "\nDIAG D stderr is not available until it ends"); throw e; });
    assert.equal(dd.code, 0, dd.err + dd.out);
    assert.match(dd.out, /finished/);
    assert.match((await call(["approvals"])).out, /nothing is waiting/, "nothing is left waiting");
  } finally {
    server.kill(); upstream.close();
  }
});
