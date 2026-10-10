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

/** intent -> offer -> contract -> bond, past the credits grants a caller needs first. */
async function bonded(f: Fixture, price: number, bond: number) {
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", String(price)]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", String(bond)]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix the flaky test", "--criteria", "test passes 50 times",
    "--budget", String(price), "--deadline", "2026-12-01T00:00:00Z"]);
  assert.equal(intent.code, 0, intent.err);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];

  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", String(price), "--plan", "fix the race",
    "--eta", "2026-11-01T00:00:00Z"]);
  assert.equal(offer.code, 0, offer.err);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];

  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--performer", CODER, "--bank", BANK,
    "--intent", intentId, "--offer", offerId]);
  assert.equal(contract.code, 0, contract.err);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];

  const bondRes = await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", String(bond),
    "--escrow-payer", ALICE, "--escrow-amount", String(price)]);
  return { f, intentId, offerId, contractId, bondRes };
}

test("credits: grant bootstraps a balance; balance reads it back", async () => {
  const f = await setup();
  const grant = await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "500"]);
  assert.equal(grant.code, 0, grant.err);
  const balance = await asp(f, ["credits", "balance", ALICE]);
  assert.equal(balance.code, 0);
  assert.match(balance.out, /500 credits/);
});

test("market: intent -> offer -> contract -> bond locks real credits", async () => {
  const f = await setup();
  const { contractId, bondRes } = await bonded(f, 1000, 200);
  assert.equal(bondRes.code, 0, bondRes.err);
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /0 credits/);
  assert.match((await asp(f, ["credits", "balance", CODER])).out, /0 credits/);

  const show = await asp(f, ["market", "show", contractId]);
  assert.equal(show.code, 0);
  assert.match(show.out, /state Bonded/);
  assert.match(show.out, /escrow: 1000 locked from .*alice.*200 bond from .*coder/);
});

test("market: bonding without enough balance is refused, and nothing is locked", async () => {
  const f = await setup();
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "999"]); // one short
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--performer", CODER, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  const bond = await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "0", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  assert.equal(bond.code, 1);
  assert.match(bond.err, /has 999 credits, needs 1000/);
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /999 credits/);
});

test("market: mandate, deliver, accept, settle pays the performer and closes the job", async () => {
  const f = await setup();
  const { contractId } = await bonded(f, 1000, 200);

  const mandate = await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  assert.equal(mandate.code, 0, mandate.err);

  const deliver = await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "Fixed the race"]);
  assert.equal(deliver.code, 0, deliver.err);

  const accept = await asp(f, ["market", "accept", "--contract", contractId, "--by", ALICE]);
  assert.equal(accept.code, 0, accept.err);

  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "accepted",
    "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0"]);
  assert.equal(settle.code, 0, settle.err);
  assert.match(settle.out, /state Settled/);

  assert.match((await asp(f, ["credits", "balance", CODER])).out, /1200 credits/, "paid the price, plus its bond back");
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /0 credits/, "all escrow was released; nothing left over");

  const show = await asp(f, ["market", "show", contractId]);
  assert.match(show.out, /settled: true/);
});

test("market: a revoked job pays pro-rata and returns the rest, the shortest path to Settled", async () => {
  const f = await setup();
  const { contractId } = await bonded(f, 1000, 200);
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER]);

  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "revoked",
    "--escrow-released", "400", "--bond-returned", "200", "--bond-slashed", "0", "--pro-rata", "400"]);
  assert.equal(settle.code, 0, settle.err);

  assert.match((await asp(f, ["credits", "balance", CODER])).out, /600 credits/, "400 pro-rata pay + 200 bond back");
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /600 credits/, "the unreleased 600 escrow returns");
});

test("market: settlement cannot release more than the Bond locked", async () => {
  const f = await setup();
  const { contractId } = await bonded(f, 1000, 200);
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER]);
  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "revoked",
    "--escrow-released", "5000", "--bond-returned", "0", "--bond-slashed", "0", "--pro-rata", "1000"]);
  assert.equal(settle.code, 1);
  assert.match(settle.err, /exceeds the 1000 locked/);
});
