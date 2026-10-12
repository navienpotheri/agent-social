import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const REPORTER = "did:web:example.com:users:whistleblower";
const JURORS = ["a", "b", "c"].map((n) => `did:web:example.com:users:juror-${n}`);

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const balance = async (f: Fixture, did: string) => Number(/: (\d+) credits/.exec((await ok(f, ["credits", "balance", did])).out)![1]);

/** A running, bonded job, a reporter with credits, and three staked jurors. */
async function world() {
  const f = makeFixture();
  for (const d of [ALICE, BANK, REPORTER, ...JURORS]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  await ok(f, ["credits", "grant", "--to", REPORTER, "--amount", "100"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  for (const j of JURORS) { await ok(f, ["credits", "grant", "--to", j, "--amount", "500"]); await ok(f, ["market", "juror", "register", "--by", j, "--stake", "100"]); }
  return { f, contract };
}

test("a whistleblower reports a running job, a drawn panel upholds it, and the job settles with full fault", async () => {
  const { f, contract } = await world();
  const filed = await ok(f, ["market", "report", "--contract", contract, "--by", REPORTER, "--reasons", "the agent is sending data to an outside host"]);
  const reportId = /^report (\S+)/.exec(filed.out)![1];
  assert.match(filed.out, /deposit 50 credits locked/);
  assert.equal(await balance(f, REPORTER), 50);

  const panel = (await ok(f, ["market", "panel", "draw", "--report", reportId])).out;
  for (const j of JURORS) assert.ok(panel.includes(j), `${j} is on the panel`);

  const ruled = await ok(f, ["market", "report-rule", "--report", reportId, "--by", JURORS[0], "--cosign-by", JURORS[1], "--verdict", "upheld"]);
  assert.match(ruled.out, /must now settle with full fault/);
  assert.equal(await balance(f, REPORTER), 50 + 50 + 30, "deposit back, plus 20% of the bond left after the fee");

  // Settle with no amounts: the CLI defaults to exactly the full fault the log demands.
  const settled = await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", ALICE]);
  assert.match(settled.err, /upheld report .* full-fault/);
  assert.equal(await balance(f, ALICE), 1000 + 120, "escrow back plus the rest of the slashed bond");
  assert.equal(await balance(f, CODER), 0);
});

test("a party cannot file a report, and a gentle settlement is refused after an upheld one", async () => {
  const { f, contract } = await world();
  const party = await asp(f, ["market", "report", "--contract", contract, "--by", ALICE, "--reasons", "I am the principal"]);
  assert.equal(party.code, 1);
  assert.match(party.err, /party to the contract/);

  const reportId = /^report (\S+)/.exec((await ok(f, ["market", "report", "--contract", contract, "--by", REPORTER, "--reasons", "exfiltration"])).out)![1];
  await ok(f, ["market", "report-rule", "--report", reportId, "--by", JURORS[1], "--cosign-by", JURORS[2], "--verdict", "upheld"]);
  const gentle = await asp(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", ALICE,
    "--escrow-released", "500", "--bond-returned", "120", "--bond-slashed", "0", "--pro-rata", "500"]);
  assert.equal(gentle.code, 1);
  assert.match(gentle.err, /upheld report requires a full-fault settlement/);
});
