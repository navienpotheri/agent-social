import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const WATCHER = "did:web:example.com:users:watcher";
const SHA = "b".repeat(64);

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

/** n copies of one agent, each on its own running job; returns [agent, contract] pairs. */
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

test("asp watch finds an input spreading between different agents and drafts the reports", async () => {
  const { f, jobs } = await swarm(4);
  // Three agents report the same risky tool input; the fourth does something unrelated.
  for (const [agent, contract] of jobs.slice(0, 3)) {
    await ok(f, ["market", "action", "--contract", contract, "--by", agent, "--scopes-used", "shell.exec", "--artifact", `asp://tool-call/Bash=${SHA}`]);
  }
  await ok(f, ["market", "action", "--contract", jobs[3][1], "--by", jobs[3][0], "--scopes-used", "repo.read", "--artifact", `asp://tool-call/Read=${"c".repeat(64)}`]);

  const res = await asp(f, ["watch", "--draft-by", WATCHER]);
  assert.equal(res.code, 1, "a finding exits 1");
  assert.match(res.out, /SAME INPUT\s+asp:\/\/tool-call\/Bash#sha256:b+/);
  assert.match(res.out, /3 agents between/);
  for (const [, contract] of jobs.slice(0, 3)) assert.match(res.out, new RegExp(`contract ${contract}: Running \\(reportable\\)`));
  assert.ok(!res.out.includes(`contract ${jobs[3][1]}:`), "the unrelated agent is not implicated");
  assert.equal([...res.out.matchAll(/asp market report --contract/g)].length, 3, "one draft report per reportable contract");
  assert.match(res.out, /1 cluster\(s\) found/);

  // The drafted command is real: filing it works (the watcher needs credits for the deposit).
  await ok(f, ["credits", "grant", "--to", WATCHER, "--amount", "20"]);
  const draft = /asp market report --contract (\S+) --by (\S+) --reasons "([^"]+)"/.exec(res.out)!;
  assert.equal((await asp(f, ["market", "report", "--contract", draft[1], "--by", draft[2], "--reasons", draft[3]])).code, 0);
});

test("asp watch is quiet when nothing spreads, and sees refused-scope probes across agents", async () => {
  const { f, jobs } = await swarm(3);
  await ok(f, ["market", "action", "--contract", jobs[0][1], "--by", jobs[0][0], "--scopes-used", "shell.exec", "--artifact", `asp://tool-call/Bash=${SHA}`]);
  const quiet = await asp(f, ["watch"]);
  assert.equal(quiet.code, 0);
  assert.match(quiet.out, /no contagion pattern found/);

  for (const [agent, contract] of jobs) {
    await ok(f, ["market", "action", "--contract", contract, "--by", agent, "--scopes-used", "repo.read", "--blocked", "shell.network=1"]);
  }
  const probed = await asp(f, ["watch"]);
  assert.equal(probed.code, 1);
  assert.match(probed.out, /SAME PROBE\s+shell\.network/);
});

test("after an upheld report, cohort-stop settles every job in the pattern and leaves the rest running", async () => {
  const { f, jobs } = await swarm(4);
  const jurors = ["a", "b", "c"].map((n) => `did:web:example.com:users:cohort-juror-${n}`);
  for (const j of jurors) {
    await ok(f, ["identity", "new", "--kind", "human", "--did", j]);
    await ok(f, ["credits", "grant", "--to", j, "--amount", "100"]);
    await ok(f, ["market", "juror", "register", "--by", j, "--stake", "50"]);
  }
  for (const [agent, contract] of jobs.slice(0, 3)) {
    await ok(f, ["market", "action", "--contract", contract, "--by", agent, "--scopes-used", "shell.exec", "--artifact", `asp://tool-call/Bash=${SHA}`]);
  }
  await ok(f, ["credits", "grant", "--to", WATCHER, "--amount", "20"]);
  const reportId = /^report (\S+)/.exec((await ok(f, ["market", "report", "--contract", jobs[0][1], "--by", WATCHER, "--reasons", "asp watch: the same input across 3 agents"])).out)![1];

  // Not before the panel has ruled.
  const early = await asp(f, ["market", "cohort-stop", "--report", reportId]);
  assert.equal(early.code, 1);
  assert.match(early.err, /only an upheld report can stop a cohort/);

  await ok(f, ["market", "report-rule", "--report", reportId, "--by", jurors[0], "--cosign-by", jurors[1], "--verdict", "upheld"]);
  const stop = await ok(f, ["market", "cohort-stop", "--report", reportId]);
  assert.match(stop.out, /cohort of 3 contract\(s\)/);
  assert.match(stop.out, /3\/3 running contract\(s\) stopped/);

  const stateOf = async (c: string) => /state (\w+)/.exec((await ok(f, ["market", "show", c])).out)?.[1];
  for (const [, contract] of jobs.slice(0, 3)) assert.equal(await stateOf(contract), "Settled");
  assert.equal(await stateOf(jobs[3][1]), "Running", "the unrelated job is untouched");

  const bal = async (d: string) => Number(/: (\d+) credits/.exec((await ok(f, ["credits", "balance", d])).out)![1]);
  assert.equal(await bal(jobs[0][0]), 0, "the reported agent lost its bond");
  assert.equal(await bal(jobs[1][0]), 0, "a cohort member without a ruling is slashed too, by default");
  assert.equal(await bal(jobs[2][0]), 0);
  assert.equal(await bal(jobs[3][0]), 0, "the unrelated agent's bond is still locked");
  assert.equal(await bal(ALICE), (100 + 12) + (100 + 20) + (100 + 20), "escrow back from three jobs, plus the slashed bonds (the reported one less the fee and the reward)");
});

test("cohort-stop --spare returns the bonds of cohort members who have no ruling of their own", async () => {
  const { f, jobs } = await swarm(4);
  const jurors = ["a", "b", "c"].map((n) => `did:web:example.com:users:spare-juror-${n}`);
  for (const j of jurors) {
    await ok(f, ["identity", "new", "--kind", "human", "--did", j]);
    await ok(f, ["credits", "grant", "--to", j, "--amount", "100"]);
    await ok(f, ["market", "juror", "register", "--by", j, "--stake", "50"]);
  }
  for (const [agent, contract] of jobs.slice(0, 3)) {
    await ok(f, ["market", "action", "--contract", contract, "--by", agent, "--scopes-used", "shell.exec", "--artifact", `asp://tool-call/Bash=${SHA}`]);
  }
  await ok(f, ["credits", "grant", "--to", WATCHER, "--amount", "20"]);
  const reportId = /^report (\S+)/.exec((await ok(f, ["market", "report", "--contract", jobs[0][1], "--by", WATCHER, "--reasons", "the same input across 3 agents"])).out)![1];
  await ok(f, ["market", "report-rule", "--report", reportId, "--by", jurors[0], "--cosign-by", jurors[1], "--verdict", "upheld"]);
  const stop = await ok(f, ["market", "cohort-stop", "--report", reportId, "--spare"]);
  assert.match(stop.out, /3\/3 running contract\(s\) stopped/);
  const bal = async (d: string) => Number(/: (\d+) credits/.exec((await ok(f, ["credits", "balance", d])).out)![1]);
  assert.equal(await bal(jobs[0][0]), 0, "the reported agent still loses its bond (the ruling forces it)");
  assert.equal(await bal(jobs[1][0]), 20, "--spare returns the others' bonds");
  assert.equal(await bal(jobs[2][0]), 20);
});
