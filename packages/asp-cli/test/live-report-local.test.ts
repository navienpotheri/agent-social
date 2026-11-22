// The owner's run of 2026-11-22: a `--local` run records its signed Action reports in the LOCAL log, but `asp live report` read the session's records through the saved login (the hosted service) and said "0 record(s)
// on the job, 0 signed Action report(s)". A session of --local is reported from the local log, whatever login is saved or set in the environment.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const fake = fileURLToPath(new URL("./fake-claude-rehearsal.mjs", import.meta.url));
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

test("a --local session is reported from the local log (signed Action reports counted) even with a hosted login saved and ASP_LOG_URL set", { timeout: 120_000 }, async () => {
  const up = createHttp((req, res) => { req.on("data", () => undefined); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 30, output_tokens: 5 }, content: [{ type: "text", text: "done" }] })); }); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
  const upUrl = `http://127.0.0.1:${(up.address() as { port: number }).port}`;
  const f = makeFixture();
  const project = join(f.root, "project"); mkdirSync(project, { recursive: true }); mkdirSync(f.aspHome, { recursive: true });
  // a saved login for a service that is not there: reading a local session through it finds nothing
  writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: "http://127.0.0.1:9", token: "tok-hosted", tenant: "someone", joinedAt: "2026-11-01T00:00:00Z", identities: { me: "did:web:x:u:s", agent: "did:web:x:a:s:b", bank: "did:web:x:u:s:bank" } }));
  const call = async (args: string[], env: Record<string, string> = {}) => {
    const out: string[] = [], err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io;
    const code = await main(args, io);
    return { code, all: out.join("\n") + "\n" + err.join("\n") };
  };
  const run = await call(["run", "claude-code", "--local", "--project", project, "--prompt", "Say done"], { ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fake, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ANTHROPIC_API_KEY: "sk-ant-fake", REHEARSAL_N: "1" });
  assert.equal(run.code, 0, run.all);
  assert.match(run.all, /the signed Action reports are in the log/);
  const rep = await call(["live", "report"], { ASP_LOG_URL: "http://127.0.0.1:9", ASP_LOG_TOKEN: "tok-hosted" });
  assert.equal(rep.code, 0, rep.all);
  assert.match(rep.all, /in the log\s+\d+ record\(s\) on the job, 1 signed Action report\(s\)/);
  // the other readers of a --local session read the local log too, whatever login is saved
  const hosted = { ASP_LOG_URL: "http://127.0.0.1:9", ASP_LOG_TOKEN: "tok-hosted" };
  const sid = /session\s+(\S+)\s+finished|session (\w{8})/.exec(run.all)?.slice(1).find(Boolean) ?? /^\s+(\w{8})\s+\S+ ago/m.exec((await call(["runs"], hosted)).all)![1]!;
  const detail = await call(["runs", sid], hosted);
  assert.equal(detail.code, 0, detail.all);
  assert.match(detail.all, /in the log \d+ records on the standing job, 1 signed Action report\(s\)/);
  const ids = JSON.parse((await import("node:fs")).readFileSync(join(f.aspHome, "local", "local-identities.json"), "utf8")) as { agent: string };
  const jr = await call(["journey", ids.agent, "--sponsor-view"], hosted);
  assert.equal(jr.code, 0, jr.all);
  assert.doesNotMatch(jr.all, /cannot reach|could not be reached|ECONNREFUSED/i, "the journey did not go to the hosted service");
  assert.match(jr.all, /journey|step/i);
  const today = await call(["today"], hosted);
  assert.equal(today.code, 0, today.all);
  assert.match(today.all, /claude-code|session|agent/i);
});
