import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const sleeper = fileURLToPath(new URL("./fake-claude-sleeper.mjs", import.meta.url));

async function asp(home: string, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...env }, cwd: home, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io;
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

// Found by the Ctrl-C test (2026-10-13): interrupting `asp run` left the session "running? no end recorded" for ever and the agent's command alive.
test("Ctrl-C in the middle of a session ends it as stopped, removes the stop file, and the next session works", async () => {
  const upstream = createHttp(async (req, res) => { for await (const _ of req) { /* not inspected */ } res.writeHead(200); res.end("{}"); });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const env = { ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: sleeper, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_GATEWAY_KILL_GRACE_MS: "0" };
    const lhome = join(f.aspHome, "local");

    const running = asp(f.aspHome, ["run", "claude-code", "--local", "--prompt", "Wait", "--project", project], env);
    // The session is up once its start is in the index; then the user presses Ctrl-C.
    const started = Date.now();
    while (Date.now() - started < 20000) {
      if (existsSync(join(lhome, "runs.ndjson")) && (await asp(lhome, ["runs"])).out.includes("running")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    process.emit("SIGINT");
    const done = await running;
    assert.match(done.err, /Ctrl-C: ending the session/);
    assert.match(done.out, /stopped by you/);
    assert.match((await asp(lhome, ["runs"])).out, /claude-code\s+stopped/, "recorded as stopped, not 'running?'");
    assert.ok(!readdirSync(lhome).some((n) => n.startsWith("stop-")), "no stale stop file");

    // A session killed outright (the terminal force-closed, power cut) leaves a start with no end; its process is gone, so it reads as interrupted, not "running?".
    appendFileSync(join(lhome, "runs.ndjson"), JSON.stringify({ t: "start", pid: 2147483646, sid: "deadbeef", contract: "c", at: new Date().toISOString(), runtime: "claude-code", agent: "a", me: "m", bank: "b", purpose: "killed", scopes: [], hosts: [] }) + "\n");
    assert.match((await asp(lhome, ["runs"])).out, /deadbeef\s.*claude-code\s+interrupted/);

    // An interactive session (no prompt): the tool owns Ctrl-C, so asp does not end the session on it; the session ends when the tool does. A closed terminal still stops it.
    const brief = { ...env, ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude-brief.mjs", import.meta.url)) };
    const waitRunning = async () => { const t0 = Date.now(); while (Date.now() - t0 < 20000 && !(await asp(lhome, ["runs"])).out.split("\n")[0].includes("running")) await new Promise((r) => setTimeout(r, 150)); };
    const inter = asp(f.aspHome, ["run", "claude-code", "--local", "--project", project], brief);
    await waitRunning();
    process.emit("SIGINT");
    const interDone = await inter;
    assert.doesNotMatch(interDone.err, /Ctrl-C: ending the session/, "Ctrl-C belongs to the tool in an interactive session");
    assert.match(interDone.out, /finished/, interDone.err + interDone.out);
    const hup = asp(f.aspHome, ["run", "claude-code", "--local", "--project", project], brief);
    await waitRunning();
    process.emit("SIGHUP");
    assert.match((await hup).out, /stopped by you/, "a closed terminal still stops an interactive session");

    // The handler is gone after the session, and the next session is a normal one.
    assert.equal(process.listenerCount("SIGINT") <= 1, true);
    const again = await asp(f.aspHome, ["run", "claude-code", "--local", "--prompt", "Again", "--project", project], { ...env, ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url)) });
    assert.match(again.err, /standing job, session 4/);
  } finally { upstream.close(); }
});
