import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const VERIFIER = "did:web:example.com:verifiers:lab";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const idOf = (out: string, word: string) => new RegExp(`^${word} (\\S+)`).exec(out)![1].replace(/:$/, "");

/** Everyone registered, a job with a named verifier taken through bond and mandate, then delivered with two claims. */
async function deliveredJob(f: Fixture, opts: { verifier?: string | false } = {}) {
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Screen materials"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", BANK])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", VERIFIER])).code, 0);
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const verifier = opts.verifier === undefined ? VERIFIER : opts.verifier;
  const intent = await asp(f, [
    "market", "intent", "--by", ALICE, "--purpose", "Screen candidate materials", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z",
    "--verification", "outcome", ...(verifier ? ["--verifier", verifier] : []),
  ]);
  assert.equal(intent.code, 0, intent.err);
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", idOf(intent.out, "intent"), "--price", "1000", "--plan", "simulate", "--eta", "2026-11-01T00:00:00Z"]);
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", idOf(intent.out, "intent"), "--offer", idOf(offer.out, "offer")]);
  assert.equal(contract.code, 0, contract.err);
  const contractId = idOf(contract.out, "contract");
  await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  assert.equal((await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER])).code, 0);
  const delivery = await asp(f, [
    "market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "two candidate oxides",
    "--claim", "the band gap is 2.35 eV::predicted", "--claim", "the structure is stable::simulated::asp://trace/span-7=" + "ab".repeat(32),
  ]);
  assert.equal(delivery.code, 0, delivery.err);
  return { contractId, deliveryId: idOf(delivery.out, "delivery") };
}

test("the verifier named on the Intent is mirrored onto the Contract and recorded", async () => {
  const f = makeFixture();
  const { contractId, deliveryId } = await deliveredJob(f);
  const local = await LocalLog.open(f.aspHome);
  assert.equal(((await local.log.get(contractId))!.record.body as any).verifier, VERIFIER);
  const claims = ((await local.log.get(deliveryId))!.record.body as any).result.claims;
  assert.deepEqual(claims.map((c: any) => c.grade), ["predicted", "simulated"]);
  assert.match(claims[1].evidence.sha256, /^sha256:[0-9a-f]{64}$/);
});

test("accept is refused until the verifier confirms; then acceptance and settlement go through", async () => {
  const f = makeFixture();
  const { contractId, deliveryId } = await deliveredJob(f);
  const early = await asp(f, ["market", "accept", "--contract", contractId, "--by", ALICE]);
  assert.equal(early.code, 1);
  assert.match(early.err, /verification_required|needs a confirming verification/);

  const verified = await asp(f, ["market", "verify", "--contract", contractId, "--by", VERIFIER, "--verdict", "confirmed", "--grade", "0=predicted", "--grade", "1=simulated"]);
  assert.equal(verified.code, 0, verified.err);
  assert.match(verified.out, new RegExp(`verification \\S+ on delivery ${deliveryId}: confirmed by ${VERIFIER}`));

  const accepted = await asp(f, ["market", "accept", "--contract", contractId, "--by", ALICE]);
  assert.equal(accepted.code, 0, accepted.err);
  const settled = await asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "accepted", "--escrow-released", "1000", "--bond-returned", "200"]);
  assert.equal(settled.code, 0, settled.err);
  assert.match((await asp(f, ["credits", "balance", CODER])).out, /: 1200 credits/, "1000 earned plus the 200 bond back");
});

test("a downgraded claim cannot be called confirmed; partly_confirmed records what was established", async () => {
  const f = makeFixture();
  const { contractId } = await deliveredJob(f);
  const wrong = await asp(f, ["market", "verify", "--contract", contractId, "--by", VERIFIER, "--verdict", "confirmed", "--grade", "0=unverified", "--grade", "1=simulated"]);
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /partly_confirmed at best/);
  const partly = await asp(f, ["market", "verify", "--contract", contractId, "--by", VERIFIER, "--verdict", "partly_confirmed", "--grade", "0=unverified", "--grade", "1=simulated"]);
  assert.equal(partly.code, 0, partly.err);
  assert.equal((await asp(f, ["market", "accept", "--contract", contractId, "--by", ALICE])).code, 0, "the principal may accept knowing what was established");
});

test("a verifier who is the principal, or anyone but the named verifier, is refused", async () => {
  const f = makeFixture();
  const { contractId } = await deliveredJob(f);
  const principal = await asp(f, ["market", "verify", "--contract", contractId, "--by", ALICE, "--verdict", "confirmed", "--grade", "0=predicted", "--grade", "1=simulated"]);
  assert.equal(principal.code, 1);
  assert.match(principal.err, /not the verifier/);
  const performer = await asp(f, ["market", "verify", "--contract", contractId, "--by", CODER, "--verdict", "confirmed", "--grade", "0=predicted", "--grade", "1=simulated"]);
  assert.equal(performer.code, 1);
});

test("a contract with no verifier is unchanged: no verification needed, and none can be given", async () => {
  const f = makeFixture();
  const { contractId } = await deliveredJob(f, { verifier: false });
  const verify = await asp(f, ["market", "verify", "--contract", contractId, "--by", VERIFIER, "--verdict", "confirmed", "--grade", "0=predicted", "--grade", "1=simulated"]);
  assert.equal(verify.code, 1);
  assert.match(verify.err, /names no verifier/);
  assert.equal((await asp(f, ["market", "accept", "--contract", contractId, "--by", ALICE])).code, 0);
});

test("bad --claim, --grade and --verdict values are usage errors", async () => {
  const f = makeFixture();
  const { contractId } = await deliveredJob(f);
  const base = ["market", "verify", "--contract", contractId, "--by", VERIFIER];
  assert.equal((await asp(f, [...base, "--verdict", "great"])).code, 2);
  assert.equal((await asp(f, [...base, "--verdict", "confirmed", "--grade", "zero=measured"])).code, 2);
  assert.equal((await asp(f, [...base, "--verdict", "confirmed", "--grade", "0=certain"])).code, 2);
  const bad = await asp(f, ["market", "deliver", "--contract", contractId, "--by", CODER, "--summary", "x", "--claim", "no grade here"]);
  assert.equal(bad.code, 2);
});
