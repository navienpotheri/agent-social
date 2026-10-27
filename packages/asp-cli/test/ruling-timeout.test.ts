import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

// Gap M10: a dispute no one rules on settles by a stated split after the contract's ruling window, so a slow ruling does not lock the escrow for ever.
const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const i: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, i);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function disputed(window?: number) {
  const f = makeFixture();
  for (const a of [["identity", "new", "--kind", "human", "--did", ALICE], ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix it"], ["identity", "new", "--kind", "human", "--did", BANK]]) assert.equal((await asp(f, a)).code, 0);
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z", "--verification", "principal"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId, ...(window ? ["--ruling-window-seconds", String(window)] : [])]);
  assert.equal(contract.code, 0, contract.err);
  const id = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", id, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await asp(f, ["market", "mandate", "--contract", id, "--principal", ALICE, "--performer", CODER]);
  await asp(f, ["market", "deliver", "--contract", id, "--by", CODER, "--summary", "Fixed it"]);
  const rej = await asp(f, ["market", "reject", "--contract", id, "--by", ALICE, "--reasons", "still flaky"]);
  assert.equal(rej.code, 0, rej.err);
  return { f, id };
}
const settle = (f: Fixture, id: string, extra: string[] = []) => asp(f, ["market", "settle", "--contract", id, "--bank", BANK, "--basis", "ruling_timeout", ...extra]);

test("past the ruling window with no ruling, the bank settles by the stated split: half the escrow released, the bond returned", async () => {
  const { f, id } = await disputed(1);
  await new Promise((r) => setTimeout(r, 2300));
  const s = await settle(f, id);
  assert.equal(s.code, 0, s.err);
  assert.match(s.out, /state Settled/);
  assert.match((await asp(f, ["credits", "balance", CODER])).out, /700 credits/, "the performer got half the price and its bond back");
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /500 credits/, "the principal got the other half back");
});

test("the bank cannot pick another split: the log refuses it", async () => {
  const { f, id } = await disputed(1);
  await new Promise((r) => setTimeout(r, 2300));
  const s = await settle(f, id, ["--escrow-released", "1000", "--bond-slashed", "0", "--bond-returned", "200"]);
  assert.equal(s.code, 1);
  assert.match(s.err, /settlement_mismatches_timeout|escrow_released must be 500/);
  const slash = await settle(f, id, ["--escrow-released", "500", "--bond-slashed", "100", "--bond-returned", "100"]);
  assert.equal(slash.code, 1, "no slashing: neither side is at fault for the delay");
});

test("before the window has passed, and with no window on the contract, a timeout settlement is refused", async () => {
  const early = await disputed(3600);
  const e = await settle(early.f, early.id);
  assert.equal(e.code, 1);
  assert.match(e.err, /GUARD_FAILED/);
  const none = await disputed();
  await new Promise((r) => setTimeout(r, 2300));
  const n = await settle(none.f, none.id);
  assert.equal(n.code, 1, "a dispute waits for its ruling when the contract sets no window");
  assert.match(n.err, /GUARD_FAILED/);
});

test("a bad window is refused when the contract is made", async () => {
  const f = makeFixture();
  const r = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", "x", "--offer", "y", "--ruling-window-seconds", "0"]);
  assert.notEqual(r.code, 0);
});
