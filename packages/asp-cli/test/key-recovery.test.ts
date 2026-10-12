import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

async function asp(f: Fixture, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ALICE = "did:web:example.com:users:alice", BOB = "did:web:example.com:users:bob", CODER = "did:web:example.com:agents:alice-coder";
const show = async (f: Fixture, did: string) => JSON.parse((await asp(f, ["identity", "show", did])).out);
const dropKeys = (f: Fixture, did: string) => { const dir = join(f.aspHome, "keys"); for (const n of readdirSync(dir)) if (JSON.parse(readFileSync(join(dir, n), "utf8")).kid.startsWith(did + "#")) rmSync(join(dir, n)); };
const codeIn = (out: string) => /RECOVERY CODE[^\n]*\n\s+(ASP-\S+)/.exec(out)![1];
const INTENT = ["--purpose", "x", "--budget", "0", "--deadline", "2026-12-01T00:00:00Z"];

test("key loss: a person gets a recovery code once, can prove it was written down, and recovers a lost key with it; the old key is revoked", async () => {
  const f = makeFixture();
  const made = await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  assert.equal(made.code, 0, made.err);
  const code = codeIn(made.out);
  assert.match(made.out, /not stored on this machine/);
  const keysDir = join(f.aspHome, "keys");
  assert.ok(!readdirSync(keysDir).some((n) => readFileSync(join(keysDir, n), "utf8").includes("recovery")), "the recovery key is not on this machine");
  const s = await show(f, ALICE);
  assert.deepEqual(s.body.keys.map((k: any) => k.id), [`${ALICE}#key-1`, `${ALICE}#recovery-1`]);
  assert.equal(s.recovery, "recovery key set");

  // The check: right, mistyped, and the code of another identity.
  assert.equal((await asp(f, ["identity", "recovery-check", ALICE], { ASP_RECOVERY_CODE: code })).code, 0);
  const typo = await asp(f, ["identity", "recovery-check", ALICE], { ASP_RECOVERY_CODE: code.slice(0, 8) + (code[8] === "2" ? "3" : "2") + code.slice(9) });
  assert.equal(typo.code, 1);
  assert.match(typo.err, /does not check out/);
  const other = codeIn((await asp(f, ["identity", "new", "--kind", "human", "--did", BOB])).out);
  const wrongId = await asp(f, ["identity", "recovery-check", ALICE], { ASP_RECOVERY_CODE: other });
  assert.equal(wrongId.code, 1);
  assert.match(wrongId.out, /NOT the one/);
  assert.equal((await asp(f, ["identity", "recovery-check", ALICE])).code, 2, "the code is read from the environment, never a flag");

  // The key is lost: Alice can no longer sign.
  dropKeys(f, ALICE);
  assert.notEqual((await asp(f, ["market", "intent", "--by", ALICE, ...INTENT])).code, 0);
  // Recovery with the code: a new key, the old one revoked, Alice signs again.
  const rec = await asp(f, ["identity", "recover", ALICE], { ASP_RECOVERY_CODE: code });
  assert.equal(rec.code, 0, rec.err);
  assert.match(rec.out, new RegExp(`new key ${ALICE}#key-2`));
  const after = await show(f, ALICE);
  assert.deepEqual(after.body.keys.map((k: any) => k.id), [`${ALICE}#key-2`, `${ALICE}#recovery-1`]);
  assert.ok(after.keys.find((k: any) => k.kid === `${ALICE}#key-1`).revokedAt, "the lost key is revoked in the log");
  assert.equal((await asp(f, ["market", "intent", "--by", ALICE, ...INTENT])).code, 0);
  // A wrong code recovers nothing.
  assert.equal((await asp(f, ["identity", "recover", ALICE], { ASP_RECOVERY_CODE: other })).code, 1);
});

test("key loss: an agent's sponsor issues it a new key; an identity made without a recovery key, or a did:key one, says it cannot be recovered with a code", async () => {
  const f = makeFixture();
  await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  const agent = await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  assert.match(agent.out, /its sponsor can issue a new one: asp identity recover .* --by-sponsor/);
  assert.equal((await show(f, CODER)).recovery, "recoverable by its sponsor");
  dropKeys(f, CODER);
  const rec = await asp(f, ["identity", "recover", CODER, "--by-sponsor"]);
  assert.equal(rec.code, 0, rec.err);
  const after = await show(f, CODER);
  assert.deepEqual(after.body.keys.map((k: any) => k.id), [`${CODER}#key-2`]);
  assert.ok(after.keys.find((k: any) => k.kid === `${CODER}#key-1`).revokedAt);
  assert.ok(after.keysOnThisMachine.includes(`${CODER}#key-2`));
  // Without the sponsor's key here, --by-sponsor is refused.
  const g = makeFixture();
  assert.equal((await asp(g, ["identity", "recover", ALICE, "--by-sponsor"])).code, 1);

  const noRec = makeFixture();
  const bare = await asp(noRec, ["identity", "new", "--kind", "human", "--did", BOB, "--no-recovery"]);
  assert.match(bare.out, /no recovery key: if the key on this machine is lost this identity cannot be recovered/);
  assert.match((await show(noRec, BOB)).recovery, /NOT SET/);
  const nope = await asp(noRec, ["identity", "recover", BOB], { ASP_RECOVERY_CODE: "ASP-AAAAAA" });
  assert.equal(nope.code, 1);
  assert.match(nope.err, /has no recovery key/);
  const dk = await asp(noRec, ["identity", "new", "--kind", "human", "--method", "did:key"]);
  assert.match(dk.out, /no recovery key/);
});

test("key backup: an encrypted file restores an identity's keys on another machine; a wrong or short passphrase does not", async () => {
  const f = makeFixture();
  await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  const file = join(f.root, "alice.keys.json");
  const env = { ASP_BACKUP_PASSPHRASE: "correct horse battery" };
  const seedOf = (fx: Fixture) => JSON.parse(readFileSync(join(fx.aspHome, "keys", readdirSync(join(fx.aspHome, "keys"))[0]), "utf8")).seed_hex as string;
  assert.equal((await asp(f, ["identity", "backup", ALICE, "--out", file])).code, 2, "the passphrase comes from the environment");
  assert.equal((await asp(f, ["identity", "backup", ALICE, "--out", file], { ASP_BACKUP_PASSPHRASE: "short" })).code, 1);
  const done = await asp(f, ["identity", "backup", ALICE, "--out", file], env);
  assert.equal(done.code, 0, done.err);
  assert.ok(!readFileSync(file, "utf8").includes(seedOf(f)), "no seed in the file");
  assert.equal((await asp(f, ["identity", "backup", ALICE, "--out", file], env)).code, 1, "an existing file is not overwritten");

  const second = makeFixture();
  assert.equal((await asp(second, ["identity", "restore", file], { ASP_BACKUP_PASSPHRASE: "not the passphrase!" })).code, 1);
  const restored = await asp(second, ["identity", "restore", file], env);
  assert.equal(restored.code, 0, restored.err);
  assert.match(restored.out, /restored 1 key\(s\) for did:web:example.com:users:alice/);
  assert.ok((await asp(second, ["identity", "restore", file], env)).out.includes("already here"), "nothing is overwritten");
  assert.equal(seedOf(second), seedOf(f), "the same key is back");
  assert.ok(existsSync(join(second.aspHome, "keys")));
});
