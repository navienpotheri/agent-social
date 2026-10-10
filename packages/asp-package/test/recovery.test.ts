import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptKeys, encryptKeys, recoveryCodeFor, seedFromRecoveryCode } from "../src/index.ts";

test("a recovery code round-trips its seed, forgives spacing, case and look-alike letters, and catches a typo before anything is signed", () => {
  const seed = randomBytes(32);
  const code = recoveryCodeFor(seed);
  assert.match(code, /^ASP-([0-9A-Z]{6}-){8}[0-9A-Z]{6}$/);
  assert.deepEqual(Buffer.from(seedFromRecoveryCode(code)), seed);
  assert.deepEqual(Buffer.from(seedFromRecoveryCode(code.toLowerCase().replaceAll("-", " "))), seed);
  assert.deepEqual(Buffer.from(seedFromRecoveryCode(code.slice(4))), seed, "the ASP- prefix is optional");
  // One wrong character, a short code, and a character that cannot be in a code are all refused.
  const body = code.slice(4);
  const wrong = body[0] === "2" ? "3" : "2";
  assert.throws(() => seedFromRecoveryCode("ASP-" + wrong + body.slice(1)), /does not check out/);
  assert.throws(() => seedFromRecoveryCode(code.slice(0, -7)), /wrong length/);
  assert.throws(() => seedFromRecoveryCode(code.slice(0, -1) + "U"), /cannot be in one|does not check out/);
  // Different seeds, different codes.
  assert.notEqual(recoveryCodeFor(randomBytes(32)), code);
});

test("a key backup opens only with the passphrase, notices tampering, binds to its DID and refuses a short passphrase", () => {
  const keys = [{ kid: "did:web:x:a#key-1", seed_hex: "ab".repeat(32) }, { kid: "did:web:x:a#key-2", seed_hex: "cd".repeat(32) }];
  const b = encryptKeys("did:web:x:a", keys, "a long enough passphrase", "2026-10-11T00:00:00Z");
  assert.ok(!JSON.stringify(b).includes("abab"), "the seeds are not in the file");
  assert.deepEqual(decryptKeys(b, "a long enough passphrase"), keys);
  assert.throws(() => decryptKeys(b, "another passphrase!"), /passphrase is wrong/);
  assert.throws(() => decryptKeys({ ...b, did: "did:web:x:other" }, "a long enough passphrase"), /passphrase is wrong, or the backup file was changed/);
  assert.throws(() => decryptKeys({ ...b, ct: Buffer.from("tampered").toString("base64") }, "a long enough passphrase"), /changed/);
  assert.throws(() => encryptKeys("did:web:x:a", keys, "short", "now"), /at least 10 characters/);
  assert.notEqual(encryptKeys("did:web:x:a", keys, "a long enough passphrase", "t").ct, b.ct, "a fresh salt and nonce each time");
});
