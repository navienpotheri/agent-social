// Rows D12 and DK272 (design section 5, test 5): a package that holds a private scope still verifies; an export of the package carries the sealed file and not the plaintext; a copy opened on a fresh machine
// with the same keys reads it, and without them it cannot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateMemoryRun, ensureAgentMemoryKey, packDirectory, principalMemoryKey, unpackToTemp, unsealAgentMemoryKey, verifyPackage } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const PLAIN = "private plan: the vault code is 4-8-15-16-23-42";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test("a package with a private scope verifies, exports sealed (no plaintext), and a fresh machine with the same keys reads it and without them cannot", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Keeps a secret"]);
  const pkg = join(f.root, "coder.aspkg");
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal((await verifyPackage(pkg)).ok, true, "a fresh package verifies");

  const pk = principalMemoryKey(f.aspHome, ALICE);
  ensureAgentMemoryKey(pkg, pk.publicKey);
  const agentKey = unsealAgentMemoryKey(pkg, pk.privateKey);
  const run = new PrivateMemoryRun({ dir: join(pkg, "memory", "private"), pair: { principal: ALICE, agent: CODER }, agentKey, principalPublic: pk.publicKey, allowed: ["notes"] });
  run.write("notes", PLAIN);
  const v = await verifyPackage(pkg);
  assert.equal(v.ok, true, `the package still verifies with a private scope in it: ${v.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.detail ?? ""}`).join("; ")}`);

  // the export: the package archived (what account export carries) holds the sealed file and no plaintext
  const archive = join(f.root, "coder.tgz");
  await packDirectory(pkg, archive);
  const fresh = await unpackToTemp(archive);
  assert.ok(existsSync(join(fresh, "memory", "private", "notes.sealed.json")), "the sealed file travels with the package");
  for (const file of walk(fresh)) assert.ok(!readFileSync(file, "utf8").includes("vault code"), `plaintext in ${file}`);
  assert.equal((await verifyPackage(fresh)).ok, true, "the imported copy verifies");

  // a fresh machine with the same keys (the principal's key file carried over) opens it
  const home2 = mkdtempSync(join(tmpdir(), "asp-home2-"));
  mkdirSync(join(home2, "keys"), { recursive: true });
  cpSync(join(f.aspHome, "keys"), join(home2, "keys"), { recursive: true });
  cpSync(join(f.aspHome, "memory-keys"), join(home2, "memory-keys"), { recursive: true });
  const pk2 = principalMemoryKey(home2, ALICE);
  const run2 = new PrivateMemoryRun({ dir: join(fresh, "memory", "private"), pair: { principal: ALICE, agent: CODER }, agentKey: unsealAgentMemoryKey(fresh, pk2.privateKey), principalPublic: pk2.publicKey, allowed: ["notes"] });
  assert.equal(run2.read("notes"), PLAIN);

  // without the principal's key (a fresh home with none) a new key is made, and it cannot open the agent's key
  const home3 = mkdtempSync(join(tmpdir(), "asp-home3-"));
  const stranger = principalMemoryKey(home3, ALICE);
  assert.throws(() => unsealAgentMemoryKey(fresh, stranger.privateKey), /cannot be opened/);
});

test("the pair publishes the public halves of its memory keys in the log (S1604): the principal's own, the agent's from its package; show reads them; a second publish is a no-op; only public bytes are recorded", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Keeps a secret"]);
  const pkg = join(f.root, "coder.aspkg");
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.match((await ok(f, ["keys", "memory", "show", ALICE])).out, /no memory key is published/);
  const p = await ok(f, ["keys", "memory", "publish", "--by", ALICE]);
  assert.match(p.out, /published memory key memory-1/);
  const a = await ok(f, ["keys", "memory", "publish", "--by", CODER, "--package", pkg, "--principal", ALICE]);
  assert.match(a.out, /published memory key memory-1/);
  const shownP = (await ok(f, ["keys", "memory", "show", ALICE])).out;
  const shownA = (await ok(f, ["keys", "memory", "show", CODER])).out;
  assert.match(shownP, /live memory key memory-1 \(([A-Za-z0-9_-]{43})\)/);
  assert.match(shownA, /live memory key memory-1 \(([A-Za-z0-9_-]{43})\)/);
  assert.notEqual(/\(([A-Za-z0-9_-]{43})\)/.exec(shownP)![1], /\(([A-Za-z0-9_-]{43})\)/.exec(shownA)![1], "two different keys");
  // the published halves are the real public halves: the pair can seal and open with them
  const { principalMemoryKey, unsealAgentMemoryKey, spkiOfRawPublicKey, sealPrivateScope, openPrivateScope } = await import("@agent-social/asp-package");
  const pk = principalMemoryKey(f.aspHome, ALICE);
  const agentKey = unsealAgentMemoryKey(pkg, pk.privateKey);
  const pubA = spkiOfRawPublicKey(/\(([A-Za-z0-9_-]{43})\)/.exec(shownA)![1]);
  const pubP = spkiOfRawPublicKey(/\(([A-Za-z0-9_-]{43})\)/.exec(shownP)![1]);
  assert.equal(pubA, agentKey.publicKey);
  assert.equal(pubP, pk.publicKey);
  const sealed = sealPrivateScope(PLAIN, pk.privateKey, pubA, { principal: ALICE, agent: CODER }, "notes");
  assert.equal(openPrivateScope(sealed, agentKey.privateKey, pubP, { principal: ALICE, agent: CODER }, "notes").toString("utf8"), PLAIN);
  // a second publish of the same key changes nothing
  assert.match((await ok(f, ["keys", "memory", "publish", "--by", ALICE])).out, /already published/);
  // nobody publishes for another identity: no signing key, no record
  const lone = await asp(f, ["keys", "memory", "publish", "--by", "did:web:example.com:agents:stranger"]);
  assert.notEqual(lone.code, 0);
  assert.match(lone.err + lone.out, /only the identity itself publishes/);
});
