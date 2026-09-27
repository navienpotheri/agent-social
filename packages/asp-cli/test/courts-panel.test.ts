import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const JURORS = ["did:web:example.com:users:juror-1", "did:web:example.com:users:juror-2", "did:web:example.com:users:juror-3"];

function io(f: Fixture) {
  const out: string[] = [];
  const err: string[] = [];
  const i: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { i, out, err, text: () => out.join("\n"), errText: () => err.join("\n") };
}

async function asp(f: Fixture, args: string[]) {
  const r = io(f);
  const code = await main(args, r.i);
  return { code, out: r.text(), err: r.errText() };
}

async function setup() {
  const f = makeFixture();
  for (const did of [ALICE, BANK, ...JURORS]) {
    assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", did])).code, 0);
  }
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"])).code, 0);
  return f;
}

/** Registers all three jurors with a real stake, minting credits first. */
async function seatJurors(f: Fixture, stake = 100) {
  for (const j of JURORS) {
    assert.equal((await asp(f, ["credits", "grant", "--to", j, "--amount", String(stake)])).code, 0);
    const reg = await asp(f, ["market", "juror", "register", "--by", j, "--stake", String(stake)]);
    assert.equal(reg.code, 0, reg.err);
  }
}

/** contract -> bond -> mandate -> deliver -> reject, opening a dispute (assignment mode, zero-value). */
async function disputed(f: Fixture) {
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "0", "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "0", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "0", "--escrow-payer", ALICE, "--escrow-amount", "0"]);
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER]);
  await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "First attempt"]);
  await asp(f, ["market", "reject", "--contract", contractId, "--by", ALICE, "--reasons", "not good enough"]);
  return contractId;
}

test("juror register locks real credits; juror show reflects the stake", async () => {
  const f = await setup();
  await asp(f, ["credits", "grant", "--to", JURORS[0], "--amount", "500"]);
  const reg = await asp(f, ["market", "juror", "register", "--by", JURORS[0], "--stake", "200"]);
  assert.equal(reg.code, 0, reg.err);
  assert.match((await asp(f, ["credits", "balance", JURORS[0]])).out, /300 credits/);
  assert.match((await asp(f, ["market", "juror", "show", JURORS[0]])).out, /staked 200 credits/);
});

test("panel draw shows the real drawn panel once jurors are seated", async () => {
  const f = await setup();
  await seatJurors(f);
  const contractId = await disputed(f);
  const draw = await asp(f, ["market", "panel", "draw", "--contract", contractId]);
  assert.equal(draw.code, 0, draw.err);
  assert.match(draw.out, /drawn panel/);
  for (const j of JURORS) assert.match(draw.out, new RegExp(j));
});

test("a ruling by a lone drawn juror, without quorum, is refused", async () => {
  const f = await setup();
  await seatJurors(f);
  const contractId = await disputed(f);
  const draw = /drawn panel for \S+: (.+)$/.exec((await asp(f, ["market", "panel", "draw", "--contract", contractId])).out)![1].split(", ");
  const rule = await asp(f, ["market", "rule", "--contract", contractId, "--by", draw[0], "--verdict", "split", "--fault", `${ALICE}=500`, "--fault", `${CODER}=500`]);
  assert.equal(rule.code, 1);
  assert.match(rule.err, /needs 2 of the drawn panel/);
});

test("a ruling cosigned by a majority of the drawn panel succeeds and settles for real", async () => {
  const f = await setup();
  await seatJurors(f);
  const contractId = await disputed(f);
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  const draw = /drawn panel for \S+: (.+)$/.exec((await asp(f, ["market", "panel", "draw", "--contract", contractId])).out)![1].split(", ");

  const rule = await asp(f, ["market", "rule", "--contract", contractId, "--by", draw[0], "--cosign-by", draw[1],
    "--verdict", "for_performer", "--fault", `${ALICE}=1000`]);
  assert.equal(rule.code, 0, rule.err);

  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "ruling",
    "--escrow-released", "0", "--bond-returned", "0", "--bond-slashed", "0"]);
  assert.equal(settle.code, 0, settle.err);
  assert.match(settle.out, /state Settled/);
});

test("with no jurors registered, asp market rule keeps the original mocked behavior (any neutral DID)", async () => {
  const f = await setup();
  const contractId = await disputed(f);
  const rule = await asp(f, ["market", "rule", "--contract", contractId, "--by", BANK, "--verdict", "for_performer", "--fault", `${ALICE}=1000`]);
  assert.equal(rule.code, 0, rule.err);
});
