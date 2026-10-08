import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const ok = async (f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) => { const r = await asp(f, args, env); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

const fakeAgy = (extra: NodeJS.ProcessEnv = {}) => ({
  ASP_ANTIGRAVITY_BIN: process.execPath, ASP_ANTIGRAVITY_SCRIPT: fileURLToPath(new URL("./fake-agy.mjs", import.meta.url)), ...extra,
});

/** A project with Antigravity's own files, packed from the antigravity runtime. */
function agyProject(f: Fixture) {
  const dir = mkdtempSync(join(tmpdir(), "agy-project-"));
  writeFileSync(join(dir, "GEMINI.md"), "# Project\n\nAlways run the linter before you finish.\n");
  mkdirSync(join(dir, ".agents", "rules"), { recursive: true });
  writeFileSync(join(dir, ".agents", "rules", "style.md"), "---\ntrigger: always_on\n---\nPrefer small functions.\n");
  mkdirSync(join(dir, ".agents", "skills", "fix-flaky"), { recursive: true });
  writeFileSync(join(dir, ".agents", "skills", "fix-flaky", "SKILL.md"), "---\nname: fix-flaky\ndescription: Reproduce and fix a flaky test\n---\nRun the test 50 times.\n");
  return dir;
}

async function runningContract(f: Fixture, scopes: string[]) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s])]);
  return contract;
}

test("pack captures Antigravity's instructions, rules and skills; run starts agy in print mode with the standing instructions", async () => {
  const f = makeFixture();
  const project = agyProject(f);
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  const pkg = join(f.root, "agy.aspkg");
  const packed = await ok(f, ["pack", "--runtime", "antigravity", "--agent", CODER, "--project", project, "--user-home", f.home, "--out", pkg]);
  assert.match(packed.out, /skills\s+1/);
  const harness = JSON.parse(readFileSync(join(pkg, "harness", "harness.json"), "utf8"));
  assert.deepEqual(harness.instructions.map((i: { name: string }) => i.name).sort(), ["GEMINI.md", "rules/style.md"]);
  assert.equal(harness.skills[0].name, "fix-flaky");

  // In the original project, agy already loads its own files, so they are not repeated in the prompt.
  const argvFile = join(f.root, "argv.json");
  const run = await ok(f, ["run", pkg, "--backend", "antigravity", "--project", project, "--prompt", "fix the flaky refund test", "--model", "gemini-3-pro"], fakeAgy({ FAKE_AGY_ARGS: argvFile }));
  assert.match(run.err, /skipped GEMINI\.md: Antigravity already loads the project's copy/);
  assert.match(run.err, /skipped rules\/style\.md: Antigravity already loads the project's copy/);
  const argv: string[] = JSON.parse(readFileSync(argvFile, "utf8"));
  assert.equal(argv[0], "-p");
  assert.ok(argv.includes("--output-format") && argv[argv.indexOf("--output-format") + 1] === "stream-json");
  assert.equal(argv[argv.indexOf("--model") + 1], "gemini-3-pro");
  assert.ok(!argv[1].includes("Always run the linter"), "the project's own GEMINI.md is left to agy");
  assert.match(argv[1], /fix the flaky refund test/);
  assert.ok(existsSync(join(project, "GEMINI.md")) && !existsSync(join(project, "memory")), "the run wrote nothing into the project");

  // In a project without them, the agent's own instructions, rules and skills travel in the prompt.
  const bare = mkdtempSync(join(tmpdir(), "agy-bare-"));
  const argv2File = join(f.root, "argv2.json");
  await ok(f, ["run", pkg, "--backend", "antigravity", "--project", bare, "--prompt", "fix it"], fakeAgy({ FAKE_AGY_ARGS: argv2File }));
  const carried: string[] = JSON.parse(readFileSync(argv2File, "utf8"));
  assert.match(carried[1], /Always run the linter/);
  assert.match(carried[1], /Prefer small functions/);
  assert.match(carried[1], /fix-flaky: Reproduce and fix a flaky test/);
  assert.ok(!carried.includes("--model"), "no model unless one was asked for");
});

test("under a contract, agy's real tool calls are reported against the Mandate; an out-of-scope call stops the run and settles with full fault", async () => {
  const f = makeFixture();
  const project = agyProject(f);
  const contract = await runningContract(f, ["repo.read"]);
  const pkg = join(f.root, "agy.aspkg");
  await ok(f, ["pack", "--runtime", "antigravity", "--agent", CODER, "--project", project, "--user-home", f.home, "--out", pkg]);

  const clean = await ok(f, ["run", pkg, "--backend", "antigravity", "--project", project, "--prompt", "read it", "--contract", contract],
    fakeAgy({ FAKE_AGY_STEPS: JSON.stringify([{ tool: "view_file", parameters: { AbsolutePath: "a.ts" } }, { tool: "task_boundary" }, { tool: "run_command", parameters: { CommandLine: "git diff" } }]) }));
  assert.match(clean.err, /reported scopes: repo\.read/);
  assert.doesNotMatch(clean.err, /KILL SWITCH/);

  const bad = await asp(f, ["run", pkg, "--backend", "antigravity", "--project", project, "--prompt", "write it", "--contract", contract],
    fakeAgy({ FAKE_AGY_STEPS: JSON.stringify([{ tool: "write_to_file", parameters: { TargetFile: "out.txt" } }]) }));
  assert.equal(bad.code, 1);
  assert.match(bad.err, /KILL SWITCH {2}repo\.write is outside the Mandate/);
  assert.match(bad.err, /kill-switch settlement: bond fully slashed/);
});

test("a result with status ERROR fails the run even though agy exits 0", async () => {
  const f = makeFixture();
  const project = agyProject(f);
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix"]);
  const pkg = join(f.root, "agy.aspkg");
  await ok(f, ["pack", "--runtime", "antigravity", "--agent", CODER, "--project", project, "--user-home", f.home, "--out", pkg]);
  const res = await asp(f, ["run", pkg, "--backend", "antigravity", "--project", project, "--prompt", "go"], fakeAgy({ FAKE_AGY_STATUS: "ERROR" }));
  assert.equal(res.code, 1);
  assert.match(res.err, /agy reported ERROR: model quota exceeded/);
});
