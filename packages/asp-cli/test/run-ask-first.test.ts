// Row US1: `asp run --ask-first` shows the plan in words before anything runs and waits for the person. Without a terminal nobody can answer, so the run does not start unless --yes says the plan was
// read; with --yes it runs as before. (The interactive answer is read from a terminal and is not driven here.) Fake runtime and provider; local mode, no service.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(home: string, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...env }, cwd: home, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io;
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}

test("--ask-first prints the plan and does not start without an answer; --yes starts it", async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Done." }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  servers.push(upstream);
  const env = { ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: `http://127.0.0.1:${(upstream.address() as { port: number }).port}` };
  const f = makeFixture();
  const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
  mkdirSync(f.aspHome, { recursive: true });

  const held = await asp(f.aspHome, ["run", "claude-code", "--local", "--ask-first", "--prompt", "Say done", "--project", project], env);
  assert.equal(held.code, 1, held.err + held.out);
  assert.match(held.err, /may read files/, "the plan is shown in words");
  assert.match(held.err, /confirm {2}no one can answer here/);
  assert.match(held.err, /confirm {2}the run was not started/);
  assert.doesNotMatch(held.out, /Session summary/, "nothing ran");
  assert.match((await asp(join(f.aspHome, "local"), ["runs"])).out, /stopped|0 calls/, "the session is recorded as stopped, not left running");

  const go = await asp(f.aspHome, ["run", "claude-code", "--local", "--ask-first", "--yes", "--prompt", "Say done", "--project", project], env);
  assert.equal(go.code, 0, go.err + go.out);
  assert.match(go.out, /Session summary[\s\S]*finished/);
});

test("a run says in one line what the job-data term covers", async () => {
  const upstream = createHttp(async (req, res) => { for await (const _ of req) { /* not inspected */ } res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "Done." }] })); });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  servers.push(upstream);
  const env = { ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: `http://127.0.0.1:${(upstream.address() as { port: number }).port}` };
  const f = makeFixture();
  const project = join(f.root, "project"); mkdirSync(project, { recursive: true }); mkdirSync(f.aspHome, { recursive: true });
  const r = await asp(f.aspHome, ["run", "claude-code", "--local", "--prompt", "Say done", "--project", project], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /a job's data is shared for the job only and is deleted when the job settles \(asp job-data delete\)/);
});
