import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const CODER2 = "did:web:example.com:agents:coder-2";
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

/** intent -> offer -> contract -> bond -> mandate, backed by CODER, price/bond as given. */
async function bonded(f: Fixture, performer: string, price: number, bond: number) {
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", String(price)]);
  await asp(f, ["credits", "grant", "--to", performer, "--amount", String(bond)]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", String(price), "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", performer, "--intent", intentId, "--price", String(price), "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  const bondRes = await asp(f, ["market", "bond", "--contract", contractId, "--backer", performer, "--amount", String(bond), "--escrow-payer", ALICE, "--escrow-amount", String(price)]);
  if (bondRes.code !== 0) return { bondRes, contractId };
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", performer]);
  return { bondRes, contractId };
}

test("a slash demotes the backer's tier, shown in identity show", async () => {
  const f = await setup();
  const { contractId } = await bonded(f, CODER, 1000, 200);
  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "revoked",
    "--escrow-released", "0", "--bond-returned", "0", "--bond-slashed", "200", "--pro-rata", "0"]);
  assert.equal(settle.code, 0, settle.err);

  const show = JSON.parse((await asp(f, ["identity", "show", CODER])).out);
  assert.deepEqual(show.reputation, { tier: 0, slashCount: 1, strikes: 0 });
});

test("a tier-0 agent (demoted by a slash) is excluded from bonding at all", async () => {
  const f = await setup();
  const { contractId } = await bonded(f, CODER, 1000, 200);
  await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "revoked",
    "--escrow-released", "0", "--bond-returned", "0", "--bond-slashed", "200", "--pro-rata", "0"]);

  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "500"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it again", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId2 = /^contract (\S+):/.exec(contract.out)![1];

  const bond = await asp(f, ["market", "bond", "--contract", contractId2, "--backer", CODER, "--amount", "500", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  assert.equal(bond.code, 1);
  assert.match(bond.err, /tier 0/);
});

test("a clean agent (never slashed) can still bond and settle normally", async () => {
  const f = await setup();
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER2, "--sponsor", ALICE, "--purpose", "Fix the flaky test"])).code, 0);
  const { bondRes, contractId } = await bonded(f, CODER2, 1000, 200);
  assert.equal(bondRes.code, 0, bondRes.err);
  const settle = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "revoked",
    "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0", "--pro-rata", "1000"]);
  assert.equal(settle.code, 0, settle.err);
  const show = JSON.parse((await asp(f, ["identity", "show", CODER2])).out);
  assert.deepEqual(show.reputation, { tier: 1, slashCount: 0, strikes: 0 }, "never slashed: reputation reflects its untouched declared tier");
});
