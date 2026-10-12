import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicKeyFromSeed, randomSeed } from "../src/crypto.ts";
import { didKeyFromPublicKey, isDidKeyFor, publicKeyFromDidKey } from "../src/didkey.ts";

test("encode/decode round-trips for random keys, and every DID has the right shape", () => {
  for (let i = 0; i < 20; i++) {
    const pub = publicKeyFromSeed(randomSeed());
    const did = didKeyFromPublicKey(pub);
    assert.match(did, /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/, "did:key, multibase base58btc (no 0/O/I/l)");
    assert.deepEqual(publicKeyFromDidKey(did), pub);
    assert.equal(isDidKeyFor(did, pub), true);
  }
});

test("every did:key starts with the fixed multicodec prefix for ed25519-pub, base58btc-encoded", () => {
  // multicodec ed25519-pub = 0xed, varint-encoded as [0xed, 0x01]; z6Mk is that prefix's fixed
  // base58btc rendering (shared by every Ed25519 did:key, independent of the key that follows it).
  for (let i = 0; i < 5; i++) {
    const did = didKeyFromPublicKey(publicKeyFromSeed(randomSeed()));
    assert.match(did, /^did:key:z6Mk/, "the multicodec+multibase prefix is the same for every Ed25519 did:key");
  }
});

test("didKeyFromPublicKey rejects a key that isn't 32 bytes", () => {
  assert.throws(() => didKeyFromPublicKey(new Uint8Array(31)), /32 bytes/);
  assert.throws(() => didKeyFromPublicKey(new Uint8Array(33)), /32 bytes/);
});

test("publicKeyFromDidKey rejects a non-did:key string, including one with invalid base58 characters", () => {
  assert.throws(() => publicKeyFromDidKey("did:web:example.com"), /not a did:key/);
  // 0/O/I/l are excluded from base58btc, so this is caught as malformed before base58-decoding even runs.
  assert.throws(() => publicKeyFromDidKey("did:key:zNotBase580OIl"), /not a did:key/);
});

test("conformance/keys.json's did_key field (this file's own output) matches re-deriving it now", () => {
  const dir = fileURLToPath(new URL("../../../conformance/", import.meta.url));
  const keys = JSON.parse(readFileSync(dir + "keys.json", "utf8")).keys as { seed_hex: string; did_key: string }[];
  assert.ok(keys.length >= 3, "sanity check: the fixture actually loaded");
  for (const k of keys) {
    assert.equal(didKeyFromPublicKey(publicKeyFromSeed(Buffer.from(k.seed_hex, "hex"))), k.did_key);
  }
});

test("isDidKeyFor is false for a different key or a malformed DID, never throws", () => {
  const pub = publicKeyFromSeed(randomSeed());
  const did = didKeyFromPublicKey(pub);
  const other = publicKeyFromSeed(randomSeed());
  assert.equal(isDidKeyFor(did, other), false);
  assert.equal(isDidKeyFor("not-a-did", pub), false);
  assert.equal(isDidKeyFor("did:key:zInvalid0OIl", pub), false);
});
