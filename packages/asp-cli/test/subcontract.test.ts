import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const LEAD = "did:web:example.com:agents:lead";
const SUB = "did:web:example.com:agents:sub";
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
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", LEAD, "--sponsor", ALICE, "--purpose", "Lead a decomposed job"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", SUB, "--sponsor", ALICE, "--purpose", "Sub-task work"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", BANK])).code, 0);
  return f;
}

async function makeContract(f: Fixture, principal: string, performer: string, price: number, parentContract?: string) {
  await asp(f, ["credits", "grant", "--to", principal, "--amount", String(price)]);
  const intent = await asp(f, ["market", "intent", "--by", principal, "--purpose", "Fix it", "--budget", String(price), "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", performer, "--intent", intentId, "--price", String(price), "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const args = ["market", "contract", "--principal", principal, "--bank", BANK, "--intent", intentId, "--offer", offerId];
  if (parentContract) args.push("--parent-contract", parentContract);
  return asp(f, args);
}

test("the lead agent (the parent's own performer) can subcontract to a sub-agent", async () => {
  const f = await setup();
  const parent = await makeContract(f, ALICE, LEAD, 1000);
  assert.equal(parent.code, 0, parent.err);
  const parentId = /^contract (\S+):/.exec(parent.out)![1];

  const child = await makeContract(f, LEAD, SUB, 300, parentId);
  assert.equal(child.code, 0, child.err);
  assert.match(child.out, new RegExp(`${LEAD} -> ${SUB}, price 300 credits`));
});

test("only the parent's own performer may subcontract under it, not the principal or an outsider", async () => {
  const f = await setup();
  const parent = await makeContract(f, ALICE, LEAD, 1000);
  const parentId = /^contract (\S+):/.exec(parent.out)![1];

  // alice (the parent's principal) tries to claim the subcontract instead of LEAD.
  const bogus = await makeContract(f, ALICE, SUB, 300, parentId);
  assert.equal(bogus.code, 1);
  assert.match(bogus.err, /subcontract_principal_mismatch|must be the parent contract's own performer/);
});

test("subcontracting under an unknown or already-settled parent is refused", async () => {
  const f = await setup();
  const unknown = await makeContract(f, LEAD, SUB, 300, "sha256:" + "9".repeat(64));
  assert.equal(unknown.code, 1);
});
