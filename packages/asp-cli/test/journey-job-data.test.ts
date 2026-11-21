// Row JO3 (journey wording): the sponsor view of an agent's journey says, on the settlement step, what the log reads of the job data: unconfirmed until the performer cites its deletion chain, then confirmed
// with the chain head, and not applicable when the contract allows retention. The public view says nothing of it. Confirmed means the performer said so and bound it to a chain; the service cannot check the files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function settled(f: Fixture, extra: string[] = []) {
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Journey", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer, ...extra])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  await ok(f, ["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "ok"]);
  await ok(f, ["market", "accept", "--contract", contract, "--by", ALICE]);
  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "accepted", "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0", "--fees", "0"]);
  return contract;
}
const journey = async (f: Fixture, extra: string[]) => (await ok(f, ["journey", CODER, "--json", ...extra])).out;

test("the sponsor journey says unconfirmed, then confirmed with the chain head; the public one says nothing; retention reads not applicable", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "3000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "600"]);
  const contract = await settled(f);
  assert.match(await journey(f, ["--sponsor-view"]), /job data: unconfirmed \(the performer has not cited its deletion chain\)/);
  const work = join(f.root, "jwork"); mkdirSync(work, { recursive: true }); writeFileSync(join(work, "a.txt"), "x");
  await ok(f, ["job-data", "delete", "--contract", contract, "--path", work, "--by", CODER]);
  const after = await journey(f, ["--sponsor-view"]);
  assert.match(after, /job data: confirmed \(chain head [0-9a-f]{64}\)/);
  assert.doesNotMatch(await journey(f, []), /job data:/, "the public view carries no job-data line");
  const kept = await settled(f, ["--retain-days", "30"]);
  assert.ok(kept);
  assert.match(await journey(f, ["--sponsor-view"]), /job data: not applicable \(the contract allows retention\)/);
});
