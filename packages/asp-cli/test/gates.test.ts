import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalLog } from "@agent-social/asp-package";
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

/** A fake Claude Code that makes its calls through the plugin's real pre-call hook, with fast polling. */
const runtime = (calls: unknown[]) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)),
  FAKE_CLAUDE_HOOK_CALLS: JSON.stringify(calls), ASP_APPROVAL_POLL_MS: "100", ASP_HOOK_POLL_MS: "50",
});
const READ = { name: "Read", input: { file_path: "README.md" } };
const SHELL = { name: "Bash", input: { command: "echo spike > marker.txt" } };

/** A job in Running whose Mandate grants repo.read and shell.exec and gates the given scopes. */
async function gatedJob(f: Fixture, mandateFlags: string[] | null) {
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Ship the fix"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", BANK])).code, 0);
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Ship it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"]);
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", /^intent (\S+)/.exec(intent.out)![1], "--price", "1000", "--plan", "x", "--eta", "2026-11-01T00:00:00Z"]);
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", /^intent (\S+)/.exec(intent.out)![1], "--offer", /^offer (\S+)/.exec(offer.out)![1]]);
  const id = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", id, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  if (mandateFlags) {
    const mandate = await asp(f, ["market", "mandate", "--contract", id, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--scopes", "shell.exec", ...mandateFlags]);
    assert.equal(mandate.code, 0, mandate.err);
  }
  const pkg = join(f.root, "coder.aspkg");
  assert.equal((await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg])).code, 0);
  return { id, pkg };
}
const run = (f: Fixture, job: { id: string; pkg: string }, calls: unknown[], extra: string[] = []) =>
  asp(f, ["run", job.pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", job.id, ...extra], runtime(calls));

/** What the principal does from another process: wait for the Checkpoint, then answer it. */
async function answerWhenAsked(f: Fixture, id: string, verdict: string, correction?: string) {
  for (let i = 0; i < 300; i++) {
    const local = await LocalLog.open(f.aspHome);
    if ((await local.log.chainInfo(id))?.state === "Checkpoint") {
      return asp(f, ["market", "resolve", "--contract", id, "--by", ALICE, "--verdict", verdict, ...(correction ? ["--correction", correction] : [])]);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("no Checkpoint appeared");
}
const stateOf = async (f: Fixture, id: string) => (await (await LocalLog.open(f.aspHome)).log.chainInfo(id))?.state;
const actionBody = async (f: Fixture, err: string) => {
  const actionId = /action\s+(\S+) reported scopes/.exec(err)![1];
  return (await (await LocalLog.open(f.aspHome)).log.get(actionId))!.record.body as { scopes_used: string[]; blocked_attempts?: unknown[] };
};

test("a gated call is held, raised as a Checkpoint, and runs only once the principal's signed approval arrives", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, ["--gate", "shell.exec"]);
  const [res, answer] = await Promise.all([run(f, job, [READ, SHELL]), answerWhenAsked(f, job.id, "approved")]);
  assert.equal(answer.code, 0, answer.err);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /approval needed from the principal for: shell\.exec/);
  assert.match(res.err, /APPROVAL NEEDED\s+shell\.exec: echo spike > marker\.txt/);
  assert.match(res.err, /approval granted for shell\.exec/);
  assert.doesNotMatch(res.err, /KILL SWITCH|strike|did not run/);
  assert.deepEqual((await actionBody(f, res.err)).scopes_used, ["repo.read", "shell.exec"]);
  assert.equal(await stateOf(f, job.id), "Running", "the resolution returned the job to Running");
});

test("a refusal (corrected, with the reason) blocks the call: nothing ran, no strike, no slash, and the agent is told why", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, ["--gate", "shell.exec"]);
  const [res] = await Promise.all([run(f, job, [READ, SHELL]), answerWhenAsked(f, job.id, "corrected", "do not write files; open a PR instead")]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /approval refused for shell\.exec: do not write files; open a PR instead/);
  assert.match(res.err, /gate\s+shell\.exec was not approved, so the call did not run/);
  assert.doesNotMatch(res.err, /strike|KILL SWITCH/);
  const body = await actionBody(f, res.err);
  assert.deepEqual(body.scopes_used, ["repo.read"], "only what actually ran");
  assert.equal(body.blocked_attempts, undefined);
  assert.equal((await (await LocalLog.open(f.aspHome)).log.escrow(job.id))?.settled, false);
});

test("an approved call the runtime then refuses on its own is not counted as having run", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, ["--gate", "shell.exec"]);
  const [res] = await Promise.all([run(f, job, [READ, { ...SHELL, runtimeRefuses: true }]), answerWhenAsked(f, job.id, "approved")]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /approval granted for shell\.exec/);
  assert.match(res.err, /gate\s+shell\.exec was approved, but the runtime did not run the call/);
  assert.deepEqual((await actionBody(f, res.err)).scopes_used, ["repo.read"]);
});

test("no answer in time is a refusal, never an approval; the Checkpoint stays open until the principal answers", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, ["--gate", "shell.exec"]);
  const res = await run(f, job, [READ, SHELL], ["--approval-wait", "1"]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /gate\s+shell\.exec was not approved/);
  assert.doesNotMatch(res.err, /strike|KILL SWITCH/);
  assert.deepEqual((await actionBody(f, res.err)).scopes_used, ["repo.read"]);
  assert.equal(await stateOf(f, job.id), "Checkpoint");
  const late = await asp(f, ["market", "resolve", "--contract", job.id, "--by", ALICE, "--verdict", "approved"]);
  assert.equal(late.code, 0, late.err);
  assert.equal(await stateOf(f, job.id), "Running");
});

test("policy forbid blocks a gated scope outright, and trying it is a strike", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, ["--gate", "shell.exec", "--irreversible", "forbid"]);
  const res = await run(f, job, [SHELL]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /forbidden by the Mandate for: shell\.exec/);
  assert.match(res.err, /strike\s+shell\.exec was blocked before it ran \(1 of 3\)/);
  assert.doesNotMatch(res.err, /APPROVAL NEEDED/);
  assert.equal(await stateOf(f, job.id), "Running");
});

test("policy allow leaves the scope ungated; and with no --gate nothing is held", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, ["--gate", "shell.exec", "--irreversible", "allow"]);
  const res = await run(f, job, [SHELL]);
  assert.equal(res.code, 0, res.err);
  assert.doesNotMatch(res.err, /APPROVAL NEEDED|approval needed/);
  assert.deepEqual((await actionBody(f, res.err)).scopes_used, ["shell.exec"]);
});

test("a gate must name a scope the Mandate grants; and resolve needs a Checkpoint and, to refuse, a reason", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, null);
  const stray = await asp(f, ["market", "mandate", "--contract", job.id, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--gate", "repo.push"]);
  assert.equal(stray.code, 1);
  assert.match(stray.err, /does not grant|gate_not_granted/);
  assert.equal((await asp(f, ["market", "mandate", "--contract", job.id, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"])).code, 0);
  assert.equal((await asp(f, ["market", "resolve", "--contract", job.id, "--by", ALICE, "--verdict", "approved"])).code, 1, "no Checkpoint to resolve");
  assert.equal((await asp(f, ["market", "resolve", "--contract", job.id, "--by", ALICE, "--verdict", "corrected"])).code, 2, "a refusal needs its reason");
  assert.equal((await asp(f, ["market", "resolve", "--contract", job.id, "--by", ALICE, "--verdict", "maybe"])).code, 2);
  const noWait = await run(f, job, [], ["--approval-wait", "0"]);
  assert.equal(noWait.code, 2);
});

test("secrets in a gated command never reach the log or the terminal, but the principal still sees what it does", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, ["--gate", "shell.exec"]);
  const ghp = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
  const command = `API_TOKEN=hunter2hunter2 ./deploy.sh --password=s3cr3t-value-123 --note ${ghp}`;
  const [res] = await Promise.all([
    run(f, job, [{ name: "Bash", input: { command } }]),
    answerWhenAsked(f, job.id, "approved"),
  ]);
  assert.equal(res.code, 0, res.err);
  for (const secret of ["hunter2hunter2", "s3cr3t-value-123", ghp]) assert.ok(!res.err.includes(secret), `${secret} reached the terminal`);
  assert.match(res.err, /APPROVAL NEEDED\s+shell\.exec: API_TOKEN=\[redacted\] \.\/deploy\.sh --password \[redacted\]|APPROVAL NEEDED\s+shell\.exec: API_TOKEN=\[redacted\] \.\/deploy\.sh/);
  assert.match(res.err, /secret-looking text was masked/);

  const chain = await (await LocalLog.open(f.aspHome)).log.chain(job.id);
  const checkpoint = chain.find((s) => s.record.type === "asp.checkpoint/v0.2")!;
  const logged = JSON.stringify(checkpoint.record);
  for (const secret of ["hunter2hunter2", "s3cr3t-value-123", ghp]) assert.ok(!logged.includes(secret), `${secret} reached the log`);
  assert.match((checkpoint.record.body as { proposed_action: string }).proposed_action, /deploy\.sh/);
});
