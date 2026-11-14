import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keystore, isSealed, open, passphraseFrom, seal } from "../src/index.ts";

// Gaps U5, P20: keys sealed at rest with a passphrase; plain files keep working.
const hex = (u: Uint8Array | undefined) => (u ? Buffer.from(u).toString("hex") : undefined);
const home = () => mkdtempSync(join(tmpdir(), "rest-"));
const fileOf = (h: string) => join(h, "keys", readdirSync(join(h, "keys"))[0]);

test("seal and open: a wrong passphrase or a changed file is refused", () => {
  const s = seal("secret-seed", "correct horse");
  assert.equal(isSealed(s), true);
  assert.equal(open(s, "correct horse"), "secret-seed");
  assert.throws(() => open(s, "wrong"), /wrong passphrase, or the protected file was changed/);
  assert.throws(() => open({ ...s, ct: Buffer.from("tampered tampered").toString("base64") }, "correct horse"), /wrong passphrase/);
  assert.notEqual(seal("secret-seed", "correct horse").ct, s.ct, "a new salt and nonce every time");
  assert.equal(JSON.stringify(s).includes("secret-seed"), false);
});

test("the passphrase comes from the environment; empty is none", () => {
  assert.equal(passphraseFrom({ ASP_KEY_PASSPHRASE: "x" }), "x");
  assert.equal(passphraseFrom({ ASP_KEY_PASSPHRASE: "" }), undefined);
  assert.equal(passphraseFrom({}), undefined);
});

test("with no passphrase a key is a plain file, as before", () => {
  const h = home();
  const ks = new Keystore(h, () => undefined);
  const s = ks.create("did:key:abc#key-1");
  const raw = JSON.parse(readFileSync(fileOf(h), "utf8"));
  assert.equal(raw.seed_hex, Buffer.from(s.seed).toString("hex"));
  assert.deepEqual(ks.status(), { plain: 1, sealed: 0 });
});

test("with a passphrase a key is written sealed, and read back", () => {
  const h = home();
  const ks = new Keystore(h, () => "pass-1");
  const s = ks.create("did:key:abc#key-1");
  const text = readFileSync(fileOf(h), "utf8");
  assert.equal(text.includes(Buffer.from(s.seed).toString("hex")), false, "the seed is not on disk");
  assert.equal(JSON.parse(text).kid, "did:key:abc#key-1", "the name stays readable");
  assert.equal(hex(ks.find("did:key:abc#key-1")?.seed), hex(s.seed));
  assert.equal(hex(ks.forDid("did:key:abc")?.seed), hex(s.seed));
  assert.deepEqual(ks.entriesFor("did:key:abc").map((e) => e.seed_hex), [Buffer.from(s.seed).toString("hex")], "a backup still gets the seed");
  assert.deepEqual(ks.status(), { plain: 0, sealed: 1 });
});

test("a sealed key without the passphrase, or with the wrong one, says so", () => {
  const h = home();
  new Keystore(h, () => "pass-1").create("did:key:abc#key-1");
  assert.throws(() => new Keystore(h, () => undefined).find("did:key:abc#key-1"), /did:key:abc#key-1 it is protected with a passphrase: set ASP_KEY_PASSPHRASE/);
  assert.throws(() => new Keystore(h, () => "other").find("did:key:abc#key-1"), /wrong passphrase/);
});

test("protect seals the plain keys already on disk; unprotect undoes it; a key keeps its seed", () => {
  const h = home();
  const plain = new Keystore(h, () => undefined);
  const a = plain.create("did:key:aaa#key-1");
  const b = plain.create("did:key:bbb#key-1");
  assert.equal(plain.protect("pw"), 2);
  assert.equal(plain.protect("pw"), 0, "already sealed: nothing to do");
  assert.deepEqual(plain.status(), { plain: 0, sealed: 2 });
  const withPw = new Keystore(h, () => "pw");
  assert.equal(hex(withPw.find("did:key:aaa#key-1")?.seed), hex(a.seed));
  assert.equal(hex(withPw.find("did:key:bbb#key-1")?.seed), hex(b.seed));
  assert.throws(() => plain.unprotect("wrong"), /wrong passphrase/);
  assert.equal(plain.unprotect("pw"), 2);
  assert.deepEqual(plain.status(), { plain: 2, sealed: 0 });
  assert.equal(hex(new Keystore(h, () => undefined).find("did:key:aaa#key-1")?.seed), hex(a.seed));
});

test("a passphrase set later leaves older plain keys readable", () => {
  const h = home();
  const s = new Keystore(h, () => undefined).create("did:key:aaa#key-1");
  assert.equal(hex(new Keystore(h, () => "pw").find("did:key:aaa#key-1")?.seed), hex(s.seed));
});

test("a key file is never half written", () => {
  const h = home();
  new Keystore(h, () => "pw").create("did:key:aaa#key-1");
  assert.equal(readdirSync(join(h, "keys")).some((f) => f.endsWith(".part")), false);
  writeFileSync(join(h, "keys", "stray.txt"), "not a key");
  assert.deepEqual(new Keystore(h, () => "pw").status(), { plain: 0, sealed: 1 }, "other files are ignored");
});
