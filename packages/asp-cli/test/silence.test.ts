import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

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

/** intent (with --review-deadline) -> offer -> contract -> bond -> mandate -> deliver, stopping before settle. */
async function delivered(f: Fixture, reviewDeadline: string) {
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000",
    "--deadline", "2026-12-01T00:00:00Z", "--verification", "principal", "--review-deadline", reviewDeadline]);
  assert.equal(intent.code, 0, intent.err);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER]);
  await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "Fixed it"]);
  return contractId;
}

test("silence past the review deadline settles as if accepted, without the principal ever signing an acceptance", async () => {
  const f = await setup();
  const contractId = await delivered(f, "2020-01-01T00:00:00Z"); // long past
  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "silence",
    "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0"]);
  assert.equal(settle.code, 0, settle.err);
  assert.match(settle.out, /state Settled/);
  assert.match((await asp(f, ["credits", "balance", CODER])).out, /1200 credits/);
});

test("a silence settlement before the review deadline has passed is refused", async () => {
  const f = await setup();
  const contractId = await delivered(f, "2099-01-01T00:00:00Z"); // far in the future
  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "silence",
    "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0"]);
  assert.equal(settle.code, 1);
  assert.match(settle.err, /GUARD_FAILED/);
  assert.match((await asp(f, ["credits", "balance", CODER])).out, /0 credits/, "nothing moved");
});

test("without a review_deadline on the contract, a silence settlement is refused outright", async () => {
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
  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "silence",
    "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0"]);
  assert.equal(settle.code, 1);
});
