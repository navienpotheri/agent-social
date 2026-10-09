import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const fakeClaude = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)), ...extra,
});

async function packedJob(f: Fixture, scopes: string[]) {
  const ok = async (args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
  await ok(["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s])]);
  const pkg = join(f.root, "coder.aspkg");
  await ok(["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  return { contract, pkg };
}

test("asp run keeps a run log from the runtime's output: calls, results, scope verdicts, masked secrets; the Action commits to it", async () => {
  const f = makeFixture();
  const { contract, pkg } = await packedJob(f, ["repo.read"]);
  const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contract],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Read", input: { file_path: "/work/notes-sk-ant-api03-abcdefghijklmnopqrstuvwx.txt" }, result: "ok" }]) }));
  assert.equal(run.code, 0, run.err);
  const logPath = /run log {2}(\S+run-log\.ndjson)/.exec(run.err)![1];
  const raw = readFileSync(logPath, "utf8");
  assert.ok(!raw.includes("sk-ant-api03"), "the key in the call's input is masked");
  const shown = (await asp(f, ["run-log", "show", logPath])).out;
  assert.match(shown, /run_start +contract .* agent did:web:example\.com:agents:coder; scopes repo\.read/);
  assert.match(shown, /tool_call +/);
  assert.match(shown, /call_judged +/);
  assert.match(shown, /tool_result/);
  assert.match(shown, /run_end +/);
  const kinds = shown.split("\n").map((l) => l.split(/\s+/)[1]);
  assert.ok(kinds.indexOf("tool_call") < kinds.indexOf("tool_result"), "the call comes before its result");
  const verified = await asp(f, ["run-log", "verify", logPath, "--contract", contract]);
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /1 of 1 Action commitment\(s\) match/);
  // The mail finds the run log of an `asp run` job too.
  assert.match((await asp(f, ["mail", "preview", "--contract", contract])).out, /The run log has \d+ event\(s\) and checks out/);
  // --no-run-log turns it off.
  const off = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contract, "--no-run-log"],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Read", input: {}, result: "ok" }]) }));
  assert.equal(off.code, 0, off.err);
  assert.doesNotMatch(off.err, /run log {2}/);
});

test("asp run: a kill is in the run log: the call, the verdict, the kill, how it ended", async () => {
  const f = makeFixture();
  const { contract, pkg } = await packedJob(f, ["repo.read"]);
  const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contract],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Bash", input: { command: "rm -rf /tmp/whatever" }, result: "ok" }]) }));
  assert.equal(run.code, 1);
  const logPath = /run log {2}(\S+run-log\.ndjson)/.exec(run.err)![1];
  const events = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const kinds = events.map((e) => e.kind);
  for (const k of ["run_start", "tool_call", "call_judged", "kill", "run_end"]) assert.ok(kinds.includes(k), k);
  assert.equal(events.find((e) => e.kind === "run_end").data.killed, "violation");
  assert.deepEqual(events.find((e) => e.kind === "call_judged").data.granted, false);
  // The log refuses the killed run's Action (its scope is outside the Mandate: the paper trail); the run log is what keeps the story.
  assert.match(run.err, /COMPLIANCE VIOLATION|kill-switch settlement/);
});
