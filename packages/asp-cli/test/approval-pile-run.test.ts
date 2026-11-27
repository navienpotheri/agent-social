// Row P29 (spec-delta S1453): on the package path (the pre-call hooks of a runtime run by `asp run`), nobody answering the approval requests ends the asking: the first requests wait out their time and expire, the next are refused at once with no Checkpoint raised, the person is told once on the terminal and in the run log, and an agent that keeps asking is stopped, with no strike, no kill-switch and no slash. Fake runtime, fake keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
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
const runtime = (calls: unknown[], graceMs = "20000") => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)),
  FAKE_CLAUDE_HOOK_CALLS: JSON.stringify(calls), ASP_APPROVAL_POLL_MS: "100", ASP_HOOK_POLL_MS: "50",
  // How long to wait for the runtime's post-call record before judging a call not run: generous, so a loaded machine
  // cannot turn a call that ran into one that "did not run" (it only waits when the record is missing).
  ASP_RAN_GRACE_MS: graceMs,
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
// These tests are about the gate itself, so they ask about every command (--ask commands). What a gate asks about by default is the last tests of this file (gap T21).
const run = (f: Fixture, job: { id: string; pkg: string }, calls: unknown[], extra: string[] = []) =>
  asp(f, ["run", job.pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", job.id, ...(extra.includes("--ask") ? [] : ["--ask", "commands"]), ...extra],
    // A call the runtime refuses never gets a record, so those tests must not wait out the generous grace period.
    runtime(calls, JSON.stringify(calls).includes("runtimeRefuses") ? "500" : "20000"));

const stateOf = async (f: Fixture, id: string) => (await (await LocalLog.open(f.aspHome)).log.chainInfo(id))?.state;
const actionBody = async (f: Fixture, err: string) => {
  const actionId = /action\s+(\S+) reported scopes/.exec(err)![1];
  return (await (await LocalLog.open(f.aspHome)).log.get(actionId))!.record.body as { scopes_used: string[]; blocked_attempts?: unknown[] };
};


test("two requests nobody answers expire; the next are refused at once with a notice; an agent that keeps asking is stopped without a strike or a slash", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, ["--gate", "shell.exec"]);
  const shell = (n: number) => ({ name: "Bash", input: { command: `echo spike-${n} > marker-${n}.txt` } });
  const t0 = Date.now();
  const res = await asp(f, ["run", job.pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", job.id, "--ask", "commands", "--approval-wait", "1"],
    { ...runtime([READ, shell(1), shell(2), shell(3), shell(4), shell(5), shell(6)]), ASP_MAX_UNANSWERED_APPROVALS: "2", ASP_STOP_AFTER_UNANSWERED: "2" });
  assert.match(res.err, /approval expired for shell\.exec/, res.err);
  assert.match(res.err, /approvals are piling up: 2 request\(s\)/, "two requests went unanswered (the second was queued behind the first and timed out with it)");
  assert.equal((res.err.match(/NOTICE\s+approvals are piling up/g) ?? []).length, 1, "the person is told once");
  assert.match(res.err, /stopped\s+the agent kept asking for a call nobody approved/);
  assert.match(res.err, /no strike and no slash/);
  assert.doesNotMatch(res.err, /strike\s+shell|KILL SWITCH|kill-switch settlement/);
  assert.equal(await stateOf(f, job.id), "Running", "the Checkpoints expired and nothing was slashed: the job is still running");
  assert.ok(Date.now() - t0 < 60_000);
  // the run log carries it
  const runLogFile = /run log\s+(\S+run-log\.ndjson)/.exec(res.err)![1];
  const events = readFileSync(runLogFile, "utf8").split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l.trim()));
  assert.ok(events.some((e) => e.kind === "approvals_piling"), JSON.stringify(events.map((e) => e.kind)));
  assert.ok(events.some((e) => e.kind === "approvals_stopped_run"));
});

test("when the principal does answer, approvals keep being asked: nothing piles up", async () => {
  const f = makeFixture();
  const job = await gatedJob(f, ["--gate", "shell.exec"]);
  const res = await asp(f, ["run", job.pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", job.id, "--ask", "commands", "--approval-wait", "1"],
    { ...runtime([READ, SHELL]), ASP_MAX_UNANSWERED_APPROVALS: "2" });
  assert.equal((res.err.match(/approval expired/g) ?? []).length, 1);
  assert.doesNotMatch(res.err, /piling up|stopped\s+the agent kept asking/, "one silent request is not a pile");
  assert.equal(res.code, 0, res.err);
});
