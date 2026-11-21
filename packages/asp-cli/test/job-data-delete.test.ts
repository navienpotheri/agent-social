// Row JO3: `asp job-data delete` removes the performer's working copies only after the job settles, writes a hash-chained line that says how many files went, keeps copies for the days a contract allows and
// says when deletion is due, and `asp job-data show` checks the chain. The line is the performer's own statement; the service cannot check it. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

async function job(f: Fixture, extra: string[] = []) {
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Delete", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer, ...extra])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  return contract;
}
const settle = async (f: Fixture, contract: string) => {
  await ok(f, ["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "ok"]);
  await ok(f, ["market", "accept", "--contract", contract, "--by", ALICE]);
  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "accepted", "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0", "--fees", "0"]);
};

test("copies are removed only after settlement, with a chained line; show checks the chain", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const contract = await job(f);
  const work = join(f.root, "work-copy"); mkdirSync(join(work, "sub"), { recursive: true });
  writeFileSync(join(work, "a.txt"), "hello"); writeFileSync(join(work, "sub", "b.txt"), "world!");

  const early = await asp(f, ["job-data", "delete", "--contract", contract, "--path", work]);
  assert.equal(early.code, 1);
  assert.match(early.out, /not settled/);
  assert.ok(existsSync(work), "nothing was removed before settlement");

  await settle(f, contract);
  const done = await ok(f, ["job-data", "delete", "--contract", contract, "--path", work]);
  assert.match(done.out, /deleted 2 file\(s\), 11 byte\(s\)/);
  assert.equal(existsSync(work), false);
  const line = JSON.parse(readFileSync(join(f.aspHome, "job-data.ndjson"), "utf8").trim());
  assert.equal(line.kind, "data_deleted");
  assert.equal(line.files, 2);
  assert.match(line.hash, /^sha256:[0-9a-f]{64}$/);
  assert.match((await ok(f, ["job-data", "show"])).out, /1 line\(s\); the chain checks out/);
  assert.equal((await asp(f, ["job-data", "delete", "--contract", contract, "--path", work])).code, 1, "a folder that is gone is said so");
});

test("a contract that allows retention keeps the copies until the day it names, and the line says when deletion is due", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const contract = await job(f, ["--retain-days", "30"]);
  await settle(f, contract);
  const work = join(f.root, "kept"); mkdirSync(work, { recursive: true }); writeFileSync(join(work, "x.txt"), "x");
  const r = await ok(f, ["job-data", "delete", "--contract", contract, "--path", work]);
  assert.match(r.out, /kept until \d{4}-\d{2}-\d{2}T/);
  assert.ok(existsSync(work), "the copies stay inside the retention period");
  assert.match(readFileSync(join(f.aspHome, "job-data.ndjson"), "utf8"), /"kind":"data_retained"/);
});

test("with --by the performer cites the chain head in a late Action and the log reads the job data as confirmed; without it, unconfirmed", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const contract = await job(f);
  await settle(f, contract);
  assert.match((await ok(f, ["job-data", "show", "--contract", contract])).out, /job data as: unconfirmed/, "a settlement that cites no chain is data_unconfirmed");
  const work = join(f.root, "confirm-copy"); mkdirSync(work, { recursive: true }); writeFileSync(join(work, "a.txt"), "x");
  const r = await ok(f, ["job-data", "delete", "--contract", contract, "--path", work, "--by", CODER]);
  assert.match(r.out, /confirmed: the Action /);
  const show = (await ok(f, ["job-data", "show", "--contract", contract])).out;
  assert.match(show, /job data as: confirmed \(chain head [0-9a-f]{64}\)/);
  const head = /head ([0-9a-f]{64})/.exec(show)![1];
  assert.match(show, new RegExp(`chain head ${head}`), "the log holds the head that the local chain printed");
  assert.equal((await asp(f, ["market", "action", "--contract", contract, "--by", CODER, "--job-data-chain", "XYZ"])).code, 2, "a bad hash is refused");
});
