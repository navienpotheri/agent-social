// Register row T11: the origin of a piece of work. `asp work attest` signs the hash of each file with the agent's own key, under a contract and its Mandate; `asp work verify` is the one command a recipient runs and checks
// the files, the signature, and (when a log can be read) that the key is the agent's current key and the contract and Mandate are in the log. Fake names, fake keys, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";
import { checkFiles, hashWork, ORIGIN_VERSION, shapeProblem, signOrigin, verifyOriginSignature, type WorkOriginBody } from "../src/work-origin.ts";
import { randomSeed, publicKeyFromSeed, didKeyFromPublicKey } from "@agent-social/asp-core";

const ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:coder", BANK = "did:web:example.com:bank";
async function asp(f: Fixture, args: string[], cwd = f.root, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
async function runningContract(f: Fixture) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--scopes", "repo.write"]);
  return contract;
}

test("hashWork walks a folder without .git and node_modules, in order, with forward slashes; checkFiles names what is missing and what changed", () => {
  const f = makeFixture();
  const dir = join(f.root, "work"); mkdirSync(join(dir, "src"), { recursive: true }); mkdirSync(join(dir, ".git"), { recursive: true }); mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "a.txt"), "alpha"); writeFileSync(join(dir, "src", "b.ts"), "beta"); writeFileSync(join(dir, ".git", "config"), "x"); writeFileSync(join(dir, "node_modules", "n.js"), "y");
  const files = hashWork([dir], dir);
  assert.deepEqual(files.map((x) => x.path), ["a.txt", "src/b.ts"]);
  assert.match(files[0].sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(checkFiles({ files }, dir).ok, true);
  writeFileSync(join(dir, "a.txt"), "ALPHA");
  assert.deepEqual(checkFiles({ files }, dir).changed, ["a.txt"]);
  writeFileSync(join(dir, "src", "b.ts"), "beta");
  const gone = { files: [...files, { path: "gone.txt", sha256: "sha256:" + "0".repeat(64), bytes: 1 }, { path: "../escape.txt", sha256: "sha256:" + "0".repeat(64), bytes: 1 }] };
  assert.deepEqual(checkFiles(gone, dir).missing, ["gone.txt", "../escape.txt"], "a path that leaves the folder is missing, not read");
  assert.throws(() => hashWork([join(dir, "nope")], dir), /does not exist/);
});

test("a signed statement verifies with the signer's key and fails when one byte of it changes or another key is used", () => {
  const seed = randomSeed(); const pub = publicKeyFromSeed(seed); const agent = didKeyFromPublicKey(pub);
  const body: WorkOriginBody = { v: ORIGIN_VERSION, kind: "origin", agent, contract: "sha256:" + "1".repeat(64), files: [{ path: "a", sha256: "sha256:" + "2".repeat(64), bytes: 1 }], createdAt: "2026-11-22T00:00:00Z" };
  const doc = signOrigin(body, { kid: agent + "#" + agent.split(":")[2], seed });
  assert.equal(shapeProblem(doc), undefined);
  assert.equal(verifyOriginSignature(doc, pub), true);
  assert.equal(verifyOriginSignature({ ...doc, contract: "sha256:" + "3".repeat(64) }, pub), false, "a changed field");
  assert.equal(verifyOriginSignature({ ...doc, files: [{ ...doc.files[0], sha256: "sha256:" + "4".repeat(64) }] }, pub), false, "a changed hash");
  assert.equal(verifyOriginSignature(doc, publicKeyFromSeed(randomSeed())), false, "another key");
  assert.equal(verifyOriginSignature({ ...doc, sig: "!!" }, pub), false, "a broken signature");
  for (const bad of [null, {}, { ...doc, v: "x" }, { ...doc, files: [] }, { ...doc, agent: "did:web:other" }, { ...doc, files: [{ path: "a", sha256: "nope" }] }]) assert.ok(shapeProblem(bad), JSON.stringify(bad).slice(0, 40));
});

test("asp work attest and verify, end to end: verified against the log; a changed file, a changed statement, a wrong contract and no log each say so", async () => {
  const f = makeFixture();
  const c = await runningContract(f);
  const work = join(f.root, "deliverable"); mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "fix.patch"), "--- a\n+++ b\n"); writeFileSync(join(work, "NOTES.md"), "what I did");
  const att = await asp(f, ["work", "attest", "deliverable", "--contract", c, "--by", CODER, "--out", "deliverable/work-origin.json", "--note", "refund test"], f.root);
  assert.equal(att.code, 0, att.err + att.out);
  assert.match(att.out, /wrote deliverable\/work-origin\.json: 2 file\(s\) signed by did:web:example\.com:agents:coder under contract .* and its Mandate/);
  const doc = JSON.parse(readFileSync(join(work, "work-origin.json"), "utf8"));
  assert.equal(doc.files.length, 2, "two files: the statement does not list itself");
  const v1 = await asp(f, ["work", "verify", "deliverable/work-origin.json"], f.root);
  assert.equal(v1.code, 0, v1.err + v1.out);
  assert.match(v1.out, /^VERIFIED {2}2 file\(s\)/);
  assert.match(v1.out, /every file is exactly what was signed/);
  assert.match(v1.out, /valid, by a current key of the agent in the log/);
  assert.match(v1.out, /does not show that the work is good/);
  // a changed file
  writeFileSync(join(work, "fix.patch"), "--- a\n+++ CHANGED\n");
  const v2 = await asp(f, ["work", "verify", "deliverable/work-origin.json"], f.root);
  assert.equal(v2.code, 1);
  assert.match(v2.out, /^DOES NOT VERIFY/);
  assert.match(v2.out, /problem {3}changed since it was signed: fix\.patch/);
  writeFileSync(join(work, "fix.patch"), "--- a\n+++ b\n");
  // a changed statement: a different contract named in it
  const tampered = { ...doc, contract: "sha256:" + "9".repeat(64) };
  writeFileSync(join(work, "tampered.json"), JSON.stringify(tampered));
  const v3 = await asp(f, ["work", "verify", "deliverable/tampered.json"], f.root);
  assert.equal(v3.code, 1);
  assert.match(v3.out, /signature not shown valid|does not verify/);
  // the json form
  const j = JSON.parse((await asp(f, ["work", "verify", "deliverable/work-origin.json", "--json"], f.root)).out);
  assert.deepEqual([j.verdict, j.signature_ok, j.key_checked_against_log, j.problems], ["VERIFIED", true, true, []]);
  // a recipient with no log of the agent's: the signature cannot be checked against a key they trust
  const stranger = makeFixture();
  const v4 = await asp(stranger, ["work", "verify", join(work, "work-origin.json")], stranger.root);
  assert.equal(v4.code, 1);
  assert.match(v4.out, /DOES NOT VERIFY/);
  assert.match(v4.out, /is not a current key of did:web:example\.com:agents:coder in the log that was read/);
  // usage errors
  assert.notEqual((await asp(f, ["work", "attest", "deliverable"], f.root)).code, 0);
  assert.notEqual((await asp(f, ["work", "verify"], f.root)).code, 0);
  assert.notEqual((await asp(f, ["work", "nope"], f.root)).code, 0);
});

test("an agent that is its own did:key is verified offline from its name, with no log at all, and a file changed afterwards fails", async () => {
  const f = makeFixture();
  const work = join(f.root, "w"); mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "x.txt"), "x");
  const seed = randomSeed(); const agent = didKeyFromPublicKey(publicKeyFromSeed(seed));
  const files = hashWork([work], work);
  const doc = signOrigin({ v: ORIGIN_VERSION, kind: "origin", agent, contract: "sha256:" + "1".repeat(64), files, createdAt: "2026-11-22T00:00:00Z" }, { kid: agent + "#key-1", seed });
  writeFileSync(join(work, "origin.json"), JSON.stringify(doc));
  // note: the origin file itself sits in the folder but is not named by the statement
  const v = await asp(f, ["work", "verify", "w/origin.json"], f.root);
  assert.equal(v.code, 0, v.err + v.out);
  assert.match(v.out, /^SIGNATURE VALID/);
  assert.match(v.out, /the key was not checked against a log/);
  writeFileSync(join(work, "x.txt"), "xx");
  assert.equal((await asp(f, ["work", "verify", "w/origin.json"], f.root)).code, 1);
});
