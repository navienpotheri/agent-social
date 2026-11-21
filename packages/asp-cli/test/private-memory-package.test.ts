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
  const pk2 = principalMemoryKey(home2, ALICE);
  const run2 = new PrivateMemoryRun({ dir: join(fresh, "memory", "private"), pair: { principal: ALICE, agent: CODER }, agentKey: unsealAgentMemoryKey(fresh, pk2.privateKey), principalPublic: pk2.publicKey, allowed: ["notes"] });
  assert.equal(run2.read("notes"), PLAIN);

  // without the principal's key (a fresh home with none) a new key is made, and it cannot open the agent's key
  const home3 = mkdtempSync(join(tmpdir(), "asp-home3-"));
  const stranger = principalMemoryKey(home3, ALICE);
  assert.throws(() => unsealAgentMemoryKey(fresh, stranger.privateKey), /cannot be opened/);
});
