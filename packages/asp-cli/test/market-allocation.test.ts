import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const PANEL = "did:web:example.com:users:panel-1";

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
  for (const [did, extra] of [[ALICE, []], [BANK, []], [PANEL, []]] as [string, string[]][]) {
    assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", did, ...extra])).code, 0);
  }
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"])).code, 0);
  return f;
}

test("allocation mode: call -> propose -> allocate -> contract, performer defaults from the proposal's team", async () => {
  const f = await setup();
  const call = await asp(f, ["market", "call", "--by", ALICE, "--purpose", "Fix the flaky test", "--budget", "1000",
    "--panel", PANEL, "--deadline", "2026-12-01T00:00:00Z"]);
  assert.equal(call.code, 0, call.err);
  const callId = /^call (\S+)/.exec(call.out)![1];

  const propose = await asp(f, ["market", "propose", "--by", CODER, "--call", callId, "--plan", "fix the race", "--budget-asked", "1000"]);
  assert.equal(propose.code, 0, propose.err);
  const proposalId = /^proposal (\S+)/.exec(propose.out)![1];

  const allocate = await asp(f, ["market", "allocate", "--by", PANEL, "--proposal", proposalId]);
  assert.equal(allocate.code, 0, allocate.err);
  assert.match(allocate.out, /selects proposal/);

  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--call", callId, "--proposal", proposalId]);
  assert.equal(contract.code, 0, contract.err);
  assert.match(contract.out, new RegExp(`${ALICE} -> ${CODER}, price 1000 credits`));
});

test("allocation mode: contract requires both --call and --proposal, not one alone", async () => {
  const f = await setup();
  const call = await asp(f, ["market", "call", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--panel", PANEL, "--deadline", "2026-12-01T00:00:00Z"]);
  const callId = /^call (\S+)/.exec(call.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--call", callId]);
  assert.equal(contract.code, 2);
  assert.match(contract.err, /needs both --call and --proposal/);
});

test("assignment and allocation mode cannot mix; giving neither is a usage error", async () => {
  const f = await setup();
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--performer", CODER]);
  assert.equal(contract.code, 2);
  assert.match(contract.err, /--intent and --offer.*or --call and --proposal/);
});

test("Courts: a reject opens a dispute; a neutral ruling settles it without a redelivery", async () => {
  const f = await setup();
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER]);
  await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "First attempt"]);

  const reject = await asp(f, ["market", "reject", "--contract", contractId, "--by", ALICE, "--reasons", "doesn't fix the race"]);
  assert.equal(reject.code, 0, reject.err);
  assert.match(reject.out, /state Disputed/);

  const rule = await asp(f, ["market", "rule", "--contract", contractId, "--by", PANEL, "--verdict", "for_performer", "--fault", `${ALICE}=0`]);
  assert.equal(rule.code, 0, rule.err);
  assert.match(rule.out, /for_performer/);

  // --escrow-released/--bond-slashed omitted: derived from the ruling's fault (0‰ on the performer).
  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "ruling", "--bond-returned", "200"]);
  assert.equal(settle.code, 0, settle.err);
  assert.match(settle.out, /state Settled/);
  assert.match((await asp(f, ["credits", "balance", CODER])).out, /1200 credits/, "the ruling favored the performer: paid in full, bond back");
});

test("Courts: settle derives escrow_released/bond_slashed from the ruling's fault when the caller omits them", async () => {
  const f = await setup();
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER]);
  await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "First attempt"]);
  await asp(f, ["market", "reject", "--contract", contractId, "--by", ALICE, "--reasons", "not good enough"]);
  await asp(f, ["market", "rule", "--contract", contractId, "--by", PANEL, "--verdict", "split", "--fault", `${CODER}=400`, "--fault", `${ALICE}=600`]);

  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "ruling", "--bond-returned", "120"]);
  assert.equal(settle.code, 0, settle.err);
  // 400 permille performer fault: released = floor(1000*600/1000)=600, slashed = ceil(200*400/1000)=80.
  assert.match((await asp(f, ["credits", "balance", CODER])).out, /720 credits/, "paid 600, bond partly returned (120 of 200)");
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /480 credits/, "unreleased escrow (400) plus the slashed bond (80)");
});

test("Courts: a reject can instead be followed by a redelivery, then acceptance settles normally", async () => {
  const f = await setup();
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER]);
  await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "First attempt"]);
  await asp(f, ["market", "reject", "--contract", contractId, "--by", ALICE, "--reasons", "not quite"]);

  const redeliver = await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "Second attempt"]);
  assert.equal(redeliver.code, 0, redeliver.err);
  assert.match(redeliver.out, /state Delivered/);

  const accept = await asp(f, ["market", "accept", "--contract", contractId, "--by", ALICE]);
  assert.equal(accept.code, 0, accept.err);

  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "accepted",
    "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0"]);
  assert.equal(settle.code, 0, settle.err);
  assert.match(settle.out, /state Settled/);
});
