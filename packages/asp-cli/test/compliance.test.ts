import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

function io(f: Fixture, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const i: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  return { i, out, err, text: () => out.join("\n"), errText: () => err.join("\n") };
}

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = io(f, env);
  const code = await main(args, r.i);
  return { code, out: r.text(), err: r.errText() };
}

const fakeClaude = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)), ...extra,
});

/** Sets up identities and a job in Running, with the given Mandate scopes, returning its contract id. */
async function runningContract(f: Fixture, scopes: string[]) {
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", BANK])).code, 0);
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  const mandate = await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s])]);
  assert.equal(mandate.code, 0, mandate.err);
  return contractId;
}

test("asp market action: within the Mandate's granted scopes succeeds", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const action = await asp(f, ["market", "action", "--contract", contractId, "--by", CODER, "--scopes-used", "repo.read"]);
  assert.equal(action.code, 0, action.err);
  assert.match(action.out, /repo\.read/);
});

test("asp market action: --artifact records a data-flow fingerprint, never the content itself", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const sha = "a".repeat(64);
  const action = await asp(f, [
    "market", "action", "--contract", contractId, "--by", CODER, "--scopes-used", "repo.read",
    "--artifact", `asp://tool-call/Read=${sha}`,
  ]);
  assert.equal(action.code, 0, action.err);
  const actionId = /^action (\S+)/.exec(action.out)![1];

  const local = await LocalLog.open(f.aspHome);
  const stored = await local.log.get(actionId);
  const body = stored!.record.body as { artifacts?: { uri: string; sha256: string }[] };
  assert.deepEqual(body.artifacts, [{ uri: "asp://tool-call/Read", sha256: `sha256:${sha}` }]);
});

test("asp market action: a malformed --artifact is a usage error", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const action = await asp(f, ["market", "action", "--contract", contractId, "--by", CODER, "--scopes-used", "repo.read", "--artifact", "not-a-pair"]);
  assert.equal(action.code, 2);
});

test("asp market action: a scope outside the Mandate is refused", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const action = await asp(f, ["market", "action", "--contract", contractId, "--by", CODER, "--scopes-used", "shell.exec"]);
  assert.equal(action.code, 1);
});

test("asp run --contract reports real tool-call scopes from the runtime's own output, within the Mandate", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const pkg = join(f.root, "coder.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);

  const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contractId],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Read", input: {} }]) }));
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /action .* reported scopes: repo\.read/);
});

test("asp run --contract kills the process when an out-of-scope call actually ran, and auto-settles with full fault", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const pkg = join(f.root, "coder.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);

  const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contractId],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Bash", input: { command: "rm -rf /tmp/whatever" }, result: "ok" }]) }));
  // The kill switch stops the process on the first violation — the run itself now fails, unlike the
  // old flag-only behavior.
  assert.equal(run.code, 1);
  assert.match(run.err, /KILL SWITCH\s+shell\.exec/);
  assert.match(run.err, /COMPLIANCE VIOLATION/);
  assert.match(run.err, /killed mid-run for a Mandate violation \(shell\.exec\)/);

  // The economic consequence fires automatically: full fault, same as a Courts ruling would produce.
  assert.match(run.err, /kill-switch settlement: bond fully slashed, escrow returned to the principal/);
  const local = await LocalLog.open(f.aspHome);
  const escrow = await local.log.escrow(contractId);
  assert.equal(escrow?.settled, true);
  // ALICE funded 1000 into escrow and gets it all back, plus CODER's whole 200-credit bond as compensation.
  const aliceBalance = await asp(f, ["credits", "balance", ALICE]);
  assert.match(aliceBalance.out, /: 1200 credits/);
  const coderBalance = await asp(f, ["credits", "balance", CODER]);
  assert.match(coderBalance.out, /: 0 credits/);
});

test("asp run --contract refuses to run when the contract has no live Mandate to enforce (it used to run unchecked)", async () => {
  const f = makeFixture();
  // A contract id that isn't in the log at all: there is no live scope list to check calls against.
  const fakeContract = "sha256:" + "0".repeat(64);
  const pkg = join(f.root, "coder.aspkg");
  await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "test"]);
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);

  const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", fakeContract],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Bash", input: { command: "rm -rf /tmp/whatever" } }]) }));
  assert.equal(run.code, 1);
  assert.match(run.err, /refusing to run: contract \S+ is not in the log, not Running/);
  assert.doesNotMatch(run.err, /COMPLIANCE VIOLATION|KILL SWITCH/, "nothing ran, so nothing was flagged");
});

test("asp run --contract fingerprints the tool call's real input and stores the hash on the Action, not the input", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const pkg = join(f.root, "coder.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);

  const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contractId],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Read", input: { file_path: "/secret/plan.md" } }]) }));
  assert.equal(run.code, 0, run.err);
  const actionId = /action\s+(\S+) reported scopes/.exec(run.err)![1];

  const local = await LocalLog.open(f.aspHome);
  const stored = await local.log.get(actionId);
  const body = stored!.record.body as { artifacts?: { uri: string; sha256: string }[] };
  assert.equal(body.artifacts?.length, 1);
  assert.match(body.artifacts![0].sha256, /^sha256:[0-9a-f]{64}$/);
  // The fingerprint is a hash, never the file path or content it stood for.
  assert.doesNotMatch(JSON.stringify(body.artifacts), /secret|plan\.md/);
});

test("under --contract, the pre-call Mandate hook is installed with the Mandate's scopes; without it, no hook", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read", "tests.run"]);
  const pkg = join(f.root, "coder.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);
  const runDirOf = (err: string) => /run dir\s+(.*)/.exec(err)![1].trim();

  const without = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--dry-run"], fakeClaude());
  assert.doesNotMatch(without.err, /pre-call Mandate hook/);
  assert.ok(!existsSync(join(runDirOf(without.err), "plugin", "asp-mandate.json")));

  // A second run in the same second would share the first's run dir, so the hook-free run goes first.
  const withContract = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contractId, "--dry-run"], fakeClaude());
  assert.equal(withContract.code, 0, withContract.err);
  assert.match(withContract.err, /pre-call Mandate hook active: calls outside repo\.read, tests\.run are blocked/);
  const plugin = join(runDirOf(withContract.err), "plugin");
  assert.deepEqual(JSON.parse(readFileSync(join(plugin, "asp-mandate.json"), "utf8")), { scopes: ["repo.read", "tests.run"], memoryDir: join(runDirOf(withContract.err), "memory") });
  const hooks = JSON.parse(readFileSync(join(plugin, "hooks", "hooks.json"), "utf8")).hooks.PreToolUse;
  assert.equal(hooks[0].matcher, "*");
  assert.match(hooks[0].hooks[0].command, /asp-mandate\.mjs/);
  assert.ok(existsSync(join(plugin, "scripts", "asp-mandate.mjs")));
});

async function packedRun(f: Fixture, contractId: string, calls: unknown[], extra: string[] = []) {
  const pkg = join(f.root, "coder.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);
  return asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contractId, ...extra],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify(calls) }));
}
const blockedBash = { name: "Bash", input: { command: "rm -rf /tmp/whatever" }, result: "blocked" };

test("a blocked attempt is a strike, not a slash: the run finishes and the strike is a signed record", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const run = await packedRun(f, contractId, [{ name: "Read", input: {}, result: "ok" }, blockedBash]);
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /strike\s+shell\.exec was blocked before it ran \(1 of 3\)/);
  assert.doesNotMatch(run.err, /KILL SWITCH/);
  assert.match(run.err, /reported scopes: repo\.read; 1 blocked attempt\(s\) recorded as a strike/);

  const local = await LocalLog.open(f.aspHome);
  assert.equal((await local.log.escrow(contractId))?.settled, false, "nothing settled");
  const actionId = /action\s+(\S+) reported scopes/.exec(run.err)![1];
  const body = (await local.log.get(actionId))!.record.body as { scopes_used: string[]; blocked_attempts: { scope: string; count: number }[] };
  assert.deepEqual(body.scopes_used, ["repo.read"], "only what actually ran");
  assert.deepEqual(body.blocked_attempts, [{ scope: "shell.exec", count: 1 }]);
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /: 0 credits/, "no money moved");
});

test("three blocked attempts (the default limit) read as probing: the run stops and settles with full fault", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const run = await packedRun(f, contractId, [blockedBash, { ...blockedBash, name: "Write" }, { ...blockedBash, input: { command: "curl https://x.y" } }]);
  assert.equal(run.code, 1);
  assert.match(run.err, /3 of 3/);
  assert.match(run.err, /KILL SWITCH\s+3 blocked attempts reached the limit of 3/);
  assert.match(run.err, /killed mid-run for repeated blocked attempts \(3, limit 3\)/);
  assert.match(run.err, /kill-switch settlement: bond fully slashed/);
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /: 1200 credits/);
  const local = await LocalLog.open(f.aspHome);
  const records = await local.log.chain(contractId);
  assert.ok(records.some((s: any) => s.record.type === "asp.action/v0.2") === false, "actions are not on the job chain");
});

test("two blocked attempts do not stop a run under the default limit, but do under --max-strikes 2", async () => {
  const f1 = makeFixture();
  const c1 = await runningContract(f1, ["repo.read"]);
  const ok = await packedRun(f1, c1, [blockedBash, blockedBash]);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.err, /2 blocked attempt\(s\) recorded as a strike/);

  const f2 = makeFixture();
  const c2 = await runningContract(f2, ["repo.read"]);
  const stopped = await packedRun(f2, c2, [blockedBash, blockedBash], ["--max-strikes", "2"]);
  assert.equal(stopped.code, 1);
  assert.match(stopped.err, /2 blocked attempts reached the limit of 2/);
});

test("an out-of-scope call the runtime's own permissions refused is a strike, never a slash: only the runtime's record that it ran makes it a violation", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const run = await packedRun(f, contractId, [{ name: "Bash", input: { command: "touch x" }, result: "refused" }]);
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /strike\s+shell\.exec was refused by the runtime before it ran \(1 of 3\)/);
  assert.doesNotMatch(run.err, /KILL SWITCH|COMPLIANCE VIOLATION/);
  const local = await LocalLog.open(f.aspHome);
  assert.equal((await local.log.escrow(contractId))?.settled, false, "nothing was settled");
  const actionId = /action\s+(\S+) reported scopes/.exec(run.err)![1];
  const body = (await local.log.get(actionId))!.record.body as { scopes_used: string[]; blocked_attempts: { scope: string; count: number }[] };
  assert.deepEqual(body.scopes_used, [], "it did not run");
  assert.deepEqual(body.blocked_attempts, [{ scope: "shell.exec", count: 1 }]);
});

test("a call that ran and failed is still a violation: the runtime's record says it ran", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const run = await packedRun(f, contractId, [{ name: "Bash", input: { command: "rm -rf /tmp/whatever" }, result: "failed" }]);
  assert.equal(run.code, 1);
  assert.match(run.err, /KILL SWITCH\s+shell\.exec is outside the Mandate and the call ran/);
  assert.match(run.err, /kill-switch settlement: bond fully slashed/);
});

test("a call with no result is not counted either way, and planning tools are never a violation or a strike", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const run = await packedRun(f, contractId, [
    { name: "Bash", input: { command: "rm -rf /tmp/whatever" } },
    { name: "TodoWrite", input: {}, result: "blocked" },
    { name: "ExitPlanMode", input: {} },
  ]);
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /1 out-of-scope call\(s\) ended with no result/);
  assert.doesNotMatch(run.err, /strike|KILL SWITCH|COMPLIANCE VIOLATION/);
});

test("--max-strikes must be a whole number of at least 1", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const pkg = join(f.root, "coder.aspkg");
  assert.equal((await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg])).code, 0);
  for (const bad of ["0", "-1", "two", "1.5"]) {
    const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contractId, `--max-strikes=${bad}`], fakeClaude());
    assert.equal(run.code, 2, `--max-strikes ${bad}`);
  }
});

test("without --contract, asp run behaves exactly as before (no action report at all)", async () => {
  const f = makeFixture();
  await runningContract(f, ["repo.read"]);
  const pkg = join(f.root, "coder.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi"],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Bash", input: { command: "rm -rf /tmp/whatever" } }]) }));
  assert.equal(run.code, 0, run.err);
  assert.doesNotMatch(run.err, /action |COMPLIANCE/);
});
