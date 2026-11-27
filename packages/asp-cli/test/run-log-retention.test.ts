// Row E6: run-log retention applied without a command. `asp run-log retention --days n` keeps a period; every run that starts deletes the run logs older than it and says so; `off` clears it; ASP_RUN_LOG_DAYS overrides.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp, type Server } from "node:http";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const fake = fileURLToPath(new URL("./fake-claude-rehearsal.mjs", import.meta.url));
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
async function asp(f: Fixture, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io;
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
async function upstream() {
  const s = createHttp((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: "text", text: "ok" }] })); }); });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
const old = (f: Fixture, name: string, daysAgo: number) => {
  const dir = join(f.aspHome, "local", "runs", name); mkdirSync(dir, { recursive: true });
  const file = join(dir, "run-log.ndjson"); writeFileSync(file, "{}\n");
  const t = new Date(Date.now() - daysAgo * 86_400_000); utimesSync(file, t, t);
  return file;
};

test("retention: setting, showing, clearing and refusing nonsense", async () => {
  const f = makeFixture(); mkdirSync(f.aspHome, { recursive: true });
  assert.match((await asp(f, ["run-log", "retention"])).out, /no retention period is set/);
  assert.match((await asp(f, ["run-log", "retention", "--days", "30"])).out, /deleted 30 days after/);
  assert.match((await asp(f, ["run-log", "retention"])).out, /deleted after 30 days/);
  assert.match((await asp(f, ["run-log", "retention"], { ASP_RUN_LOG_DAYS: "7" })).out, /after 7 days \(set by ASP_RUN_LOG_DAYS\)/);
  assert.notEqual((await asp(f, ["run-log", "retention", "--days", "0"])).code, 0);
  assert.match((await asp(f, ["run-log", "retention", "--days", "off"])).out, /retention is off/);
  assert.match((await asp(f, ["run-log", "retention"])).out, /no retention period is set/);
});

test("a run that starts deletes the run logs older than the period, keeps newer ones, and says so; with no period it deletes nothing", async () => {
  const up = await upstream();
  const f = makeFixture();
  const project = join(f.root, "project"); mkdirSync(project, { recursive: true }); mkdirSync(f.aspHome, { recursive: true });
  const env = { ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fake, ASP_RUN_ANTHROPIC_UPSTREAM: up };
  const run = () => asp(f, ["run", "claude-code", "--local", "--prompt", "x", "--project", project], env);
  const ancient = old(f, "gateway-old-1", 90), recent = old(f, "gateway-recent-1", 2);
  const first = await run();
  assert.equal(first.code, 0, first.err);
  assert.ok(existsSync(ancient) && existsSync(recent), "no period set: nothing is deleted");
  await asp(f, ["run-log", "retention", "--days", "30"]);
  const second = await run();
  assert.equal(second.code, 0, second.err);
  assert.ok(!existsSync(ancient), "the 90-day-old log is gone");
  assert.ok(existsSync(recent), "the 2-day-old log stays");
  assert.match(second.err, /retention\s+deleted 1 run log older than 30 days/);
  assert.doesNotMatch(second.err, /deleted 0 run log/, "nothing is said when nothing was deleted");
});
