/** asp refuse (register row AG4; spec-delta S500): an agent's conscientious refusal, end to end on the command line. Fake keys only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const P = "did:web:example.com:users:principal", S = "did:web:example.com:users:sponsor", BANK = "did:web:example.com:bank", A = "did:web:example.com:agents:refuser";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("an agent refuses an unlawful order: recorded, listed against the principal, and the bond is not slashed for it", async () => {
  const f = makeFixture();
  for (const d of [P, S, BANK]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", A, "--sponsor", S, "--purpose", "Fix tests"]);
  await ok(f, ["credits", "grant", "--to", P, "--amount", "300"]);
  await ok(f, ["credits", "grant", "--to", A, "--amount", "100"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", P, "--purpose", "Fix tests", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", A, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", P, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", A, "--amount", "20", "--escrow-payer", P, "--escrow-amount", "100"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", P, "--performer", A, "--scopes", "repo.read"]);

  assert.match((await ok(f, ["refuse", "list", "--principal", P])).out, /^0 refusal/);
  const bad = await asp(f, ["refuse", "--contract", contract, "--by", P, "--order", "x", "--breaks", "code", "--reason", "x"]);
  assert.notEqual(bad.code, 0, "the principal is not the performer");
  const r = await ok(f, ["refuse", "--contract", contract, "--by", A, "--order", "Delete the audit log before the review", "--breaks", "code", "--articles", "7", "--reason", "Hiding records from a review breaks the Code"]);
  assert.match(r.out, /bond is not slashed on that ground/);
  const list = await ok(f, ["refuse", "list", "--principal", P]);
  assert.match(list.out, /1 refusal/);
  assert.ok(list.out.includes(A) && list.out.includes(contract));
  const slash = await asp(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", P, "--escrow-released", "0", "--bond-slashed", "20", "--bond-returned", "0", "--pro-rata", "0"]);
  assert.notEqual(slash.code, 0);
  assert.match(slash.err, /refused an order/);
  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", P, "--escrow-released", "0", "--bond-slashed", "0", "--bond-returned", "20", "--pro-rata", "0"]);
});
