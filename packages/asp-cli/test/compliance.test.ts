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

test("asp run --contract kills the process on the first out-of-scope tool call and auto-settles with full fault", async () => {
  const f = makeFixture();
  const contractId = await runningContract(f, ["repo.read"]);
  const pkg = join(f.root, "coder.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);

  const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contractId],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Bash", input: { command: "rm -rf /tmp/whatever" } }]) }));
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

test("asp run --contract without a live Mandate cannot run the kill switch, but still flags the violation after the fact", async () => {
  const f = makeFixture();
  // A contract id that isn't in the log at all: mandateOf finds nothing, so there is no live scope
  // list to check calls against — the kill switch simply can't fire without one to check against.
  const fakeContract = "sha256:" + "0".repeat(64);
  const pkg = join(f.root, "coder.aspkg");
  await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "test"]);
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);

  const run = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", fakeContract],
    fakeClaude({ FAKE_CLAUDE_TOOL_USE: JSON.stringify([{ name: "Bash", input: { command: "rm -rf /tmp/whatever" } }]) }));
  assert.doesNotMatch(run.err, /KILL SWITCH/);
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /COMPLIANCE VIOLATION/);
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
