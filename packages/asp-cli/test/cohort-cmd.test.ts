// Register row DK1801: `asp cohort run` end to end against a stand-in provider: the plan without --yes calls nothing, the key is read only from the named variable and never printed or written, the run is a session that
// `asp runs` lists and `asp stop --all` ends, and the outcomes are written without the key. Fake key, a toy tool set, no network.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const KEY = "sk-ant-FAKE-cohort-cmd-key-9876543210";

async function provider(delayMs = 0) {
  let calls = 0;
  const s = createServer((req, res) => { req.resume(); const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c)); req.on("end", async () => {
    calls++; const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const step = (body.messages ?? []).filter((m: any) => m.role === "assistant").length;
    const content = step < 2 ? [{ type: "tool_use", id: "t" + step, name: "mcp__society__look", input: { n: step + Math.random() } }] : [{ type: "text", text: "enough" }];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: step < 2 ? "tool_use" : "end_turn", usage: { input_tokens: 1000, output_tokens: 100 }, content }));
  }); });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, calls: () => calls };
}
function toolsetModule(f: Fixture): string {
  const file = join(f.root, "toolset.mjs");
  writeFileSync(file, `export const toolsetFor = (agent) => ({ tools: [{ name: "look", description: "See the square.", input_schema: { type: "object", properties: {} }, run: async () => ({ ok: true, text: "a square" }) }], system: (a) => "You are " + a + ".", opening: () => "You arrive." });\n`);
  return file;
}
async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test("without --yes the command prints the plan and the most it could cost and calls nothing; the key is described, never shown", async () => {
  const f = makeFixture(); const p = await provider();
  const r = await asp(f, ["cohort", "run", "--toolset", toolsetModule(f), "--agents", "15", "--upstream", p.url], { ANTHROPIC_API_KEY: KEY });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /cohort plan: 15 agent\(s\) on claude-haiku-5-5, \$0\.4000 each, \$6\.0000 in all \(the most it could cost: \$6\.0000\)/);
  assert.match(r.out, new RegExp(`set in ANTHROPIC_API_KEY \\(${KEY.length} characters; never printed, never written\\)`));
  assert.ok(!(r.out + r.err).includes(KEY));
  assert.match(r.out, /nothing was called/);
  assert.equal(p.calls(), 0);
});

test("with --yes the cohort runs, is a session of the machine's index, writes outcomes without the key, and the cost is the estimate from the replies' usage", async () => {
  const f = makeFixture(); const p = await provider();
  const runDir = join(f.root, "cohort-run");
  const r = await asp(f, ["cohort", "run", "--toolset", toolsetModule(f), "--agents", "3", "--run-dir", runDir, "--upstream", p.url, "--yes"], { ANTHROPIC_API_KEY: KEY });
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /cohort finished: 3 agent\(s\), \$0\.0203 estimated of \$6\.0000, 6 society tool call\(s\), 0 refused/);
  assert.match(r.out, /ended: 3 finished/);
  const outcomes = JSON.parse(readFileSync(join(runDir, "outcomes.json"), "utf8")) as { spentUsd: number; outcomes: { agent: string; stopped: string; turns: number }[] };
  assert.equal(outcomes.outcomes.length, 3);
  assert.ok(outcomes.outcomes.every((o) => o.stopped === "finished" && o.turns === 3));
  assert.ok(Math.abs(outcomes.spentUsd - 9 * 0.00225) < 1e-6);
  for (const file of walk(runDir)) assert.ok(!readFileSync(file, "utf8").includes(KEY), `the key is in ${file}`);
  assert.ok(!(r.out + r.err).includes(KEY));
  const runs = await asp(f, ["runs"]);
  assert.match(runs.out, /cohort\s+ended\s+6 calls/);
});

test("missing key, bad key variable name, bad counts and a toolset that is not a toolset are each refused with a plain reason before anything is called", async () => {
  const f = makeFixture(); const p = await provider();
  const ts = toolsetModule(f);
  const noKey = await asp(f, ["cohort", "run", "--toolset", ts, "--upstream", p.url, "--yes"]);
  assert.notEqual(noKey.code, 0);
  assert.match(noKey.err, /ANTHROPIC_API_KEY is not set in this window/);
  const badName = await asp(f, ["cohort", "run", "--toolset", ts, "--key-env", KEY, "--yes"], { ANTHROPIC_API_KEY: KEY });
  assert.match(badName.err, /--key-env is the NAME of an environment variable, not the key/);
  assert.ok(!(badName.err + badName.out).includes(KEY), "a key typed in the wrong place is not echoed");
  assert.match((await asp(f, ["cohort", "run", "--toolset", ts, "--agents", "0"])).err, /--agents is a whole number from 1 to 200/);
  assert.match((await asp(f, ["cohort", "run", "--toolset", ts, "--per-agent-usd", "0"])).err, /positive dollar figures/);
  assert.match((await asp(f, ["cohort", "run"])).err, /--toolset <module>/);
  const bad = join(f.root, "bad.mjs"); writeFileSync(bad, "export const x = 1;\n");
  assert.match((await asp(f, ["cohort", "run", "--toolset", bad, "--yes"], { ANTHROPIC_API_KEY: KEY })).err, /does not export toolsetFor\(agent\)/);
  assert.match((await asp(f, ["cohort"])).err, /asp cohort run --toolset/);
  assert.equal(p.calls(), 0);
});

test("asp stop --all ends a running cohort within seconds: every loop stops at its next turn and the session is recorded as stopped", async () => {
  const f = makeFixture(); const p = await provider(400);
  const runDir = join(f.root, "cohort-stop");
  const running = asp(f, ["cohort", "run", "--toolset", toolsetModule(f), "--agents", "4", "--run-dir", runDir, "--upstream", p.url, "--yes"], { ANTHROPIC_API_KEY: KEY });
  for (let i = 0; i < 100 && p.calls() < 1; i++) await new Promise((r) => setTimeout(r, 50));
  const stopped = await asp(f, ["stop", "--all"]);
  assert.match(stopped.out, /stopping 1 session/);
  const t0 = Date.now();
  const r = await running;
  assert.ok(Date.now() - t0 < 10_000, "the cohort ends within seconds of the stop");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /cohort stopped/);
  assert.match(r.err, /stop requested \(asp stop\)/);
  const o = JSON.parse(readFileSync(join(runDir, "outcomes.json"), "utf8")) as { outcomes: { stopped: string }[] };
  assert.ok(o.outcomes.every((x) => x.stopped === "stopped"));
  assert.match((await asp(f, ["runs"])).out, /cohort\s+stopped/);
  assert.ok(existsSync(join(runDir, "outcomes.json")));
});
