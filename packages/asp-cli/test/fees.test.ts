import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const PLATFORM_DID = "did:web:asp.local:platform";

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
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", BANK])).code, 0);
  return f;
}

test("settlement fees are deducted from escrow and credited to the mock platform account", async () => {
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
  await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "Fixed it"]);
  await asp(f, ["market", "accept", "--contract", contractId, "--by", ALICE]);

  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "accepted",
    "--escrow-released", "950", "--bond-returned", "200", "--bond-slashed", "0", "--fees", "50"]);
  assert.equal(settle.code, 0, settle.err);

  assert.match((await asp(f, ["credits", "balance", CODER])).out, /1150 credits/, "950 paid + 200 bond back");
  assert.match((await asp(f, ["credits", "balance", PLATFORM_DID])).out, /50 credits/);
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /0 credits/, "950 + 50 fees = the full 1000 escrow");
});

test("fees pushing past what the escrow actually locked are refused", async () => {
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
  await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "Fixed it"]);
  await asp(f, ["market", "accept", "--contract", contractId, "--by", ALICE]);

  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "accepted",
    "--escrow-released", "990", "--bond-returned", "200", "--bond-slashed", "0", "--fees", "50"]);
  assert.equal(settle.code, 1);
  assert.match((await asp(f, ["credits", "balance", PLATFORM_DID])).out, /0 credits/);
});
