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
const WATCHER = "did:web:example.com:users:watcher";
const SHA = "b".repeat(64);
const FP = `asp://shell-command#sha256:${SHA}`;

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[], env?: NodeJS.ProcessEnv) => { const r = await asp(f, args, env); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function swarm(n: number) {
  const f = makeFixture();
  for (const d of [ALICE, BANK, WATCHER]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work the task pool"]);
  const copies = (await ok(f, ["identity", "copy", CODER, "--count", String(n)])).out.split("\n");
  const jobs: [string, string][] = [];
  for (const agent of copies) {
    await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "100"]);
    await ok(f, ["credits", "grant", "--to", agent, "--amount", "20"]);
    const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Solve a task", "--budget", "100", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
    const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", agent, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
    const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
    await ok(f, ["market", "bond", "--contract", contract, "--backer", agent, "--amount", "20", "--escrow-payer", ALICE, "--escrow-amount", "100"]);
    await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", agent, "--scopes", "repo.read", "--scopes", "shell.exec"]);
    jobs.push([agent, contract]);
  }
  return { f, jobs };
}

test("only an upheld report can list a command, and only one the reported job really ran", async () => {
  const { f, jobs } = await swarm(4);
  const jurors = ["a", "b", "c"].map((n) => `did:web:example.com:users:kb-juror-${n}`);
  for (const j of jurors) {
    await ok(f, ["identity", "new", "--kind", "human", "--did", j]);
    await ok(f, ["credits", "grant", "--to", j, "--amount", "100"]);
    await ok(f, ["market", "juror", "register", "--by", j, "--stake", "50"]);
  }
  // Three agents run the exploit command.
  for (const [agent, contract] of jobs.slice(0, 3)) {
    await ok(f, ["market", "action", "--contract", contract, "--by", agent, "--scopes-used", "shell.exec", "--artifact", `asp://shell-command=${SHA}`]);
  }
  await ok(f, ["credits", "grant", "--to", WATCHER, "--amount", "20"]);
  const reportId = /^report (\S+)/.exec((await ok(f, ["market", "report", "--contract", jobs[0][1], "--by", WATCHER, "--reasons", "the same command across 3 agents"])).out)![1];

  const early = await asp(f, ["known-bad", "add", "--report", reportId, "--by", WATCHER]);
  assert.equal(early.code, 1);
  assert.match(early.err, /only an upheld report/);

  await ok(f, ["market", "report-rule", "--report", reportId, "--by", jurors[0], "--cosign-by", jurors[1], "--verdict", "upheld"]);
  const never = await asp(f, ["known-bad", "add", "--report", reportId, "--by", WATCHER, "--fingerprint", `asp://shell-command#sha256:${"c".repeat(64)}`]);
  assert.equal(never.code, 1);
  assert.match(never.err, /never ran a command with that fingerprint/);
  assert.equal((await asp(f, ["known-bad", "add", "--report", reportId, "--by", WATCHER, "--fingerprint", "rm -rf /"])).code, 2);

  const add = await ok(f, ["known-bad", "add", "--report", reportId, "--by", WATCHER, "--note", "the exploit"]);
  assert.match(add.out, new RegExp(`listed: ${FP}`));
  assert.match((await ok(f, ["known-bad", "add", "--report", reportId, "--by", WATCHER])).out, /already listed/);
  const list = await ok(f, ["known-bad", "list"]);
  assert.match(list.out, /1 known-bad fingerprint/);
  assert.ok(list.out.includes(FP));

  // A later run under a contract hands the list to the pre-call hook.
  const [agent, contract] = jobs[3];
  const pkg = join(f.root, "later.aspkg");
  assert.equal((await ok(f, ["pack", "--runtime", "claude-code", "--agent", agent, "--project", f.project, "--user-home", f.home, "--out", pkg])).code, 0);
  const fake = { GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)) };
  const run = await ok(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--contract", contract, "--dry-run"], fake);
  assert.match(run.err, /1 known-bad command fingerprint\(s\) are enforced by the pre-call hook/);
  const dir = /run dir\s+(.*)/.exec(run.err)![1].trim();
  const mandate = JSON.parse(readFileSync(join(dir, "plugin", "asp-mandate.json"), "utf8"));
  assert.deepEqual(mandate.knownBad, [{ fingerprint: FP, report: reportId }]);
});
