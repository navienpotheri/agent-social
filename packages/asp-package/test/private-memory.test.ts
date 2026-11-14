/**
 * The private memory scope of one principal-agent pair (register row DK272): the principal and the agent read what the agent wrote; another agent of the same sponsor, a host that holds only a node key or only
 * public keys, and anyone using the wrong pair or scope name cannot; a changed scope is refused. Fresh keys made in the test, nothing real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newMemoryKey, openPrivateScope, sealPrivateScope } from "../src/index.ts";

const PRINCIPAL = "did:web:example.com:users:alice", AGENT = "did:web:example.com:agents:coder", SIBLING = "did:web:example.com:agents:other";
const pair = { principal: PRINCIPAL, agent: AGENT };
const alice = newMemoryKey(), coder = newMemoryKey(), other = newMemoryKey(), node = newMemoryKey();
const secret = "alice's dentist is on Elm Street; the passphrase hint is the dog's name";

test("the agent writes a private scope; the principal and the agent both read it", () => {
  const sealed = sealPrivateScope(secret, coder.privateKey, alice.publicKey, pair, "notes");
  assert.equal(openPrivateScope(sealed, coder.privateKey, alice.publicKey, pair, "notes").toString("utf8"), secret, "the agent");
  assert.equal(openPrivateScope(sealed, alice.privateKey, coder.publicKey, pair, "notes").toString("utf8"), secret, "the principal");
  assert.equal(JSON.stringify(sealed).includes("dentist"), false, "nothing readable in what is stored");
});

test("another agent of the same sponsor, and a host holding only a node key or only the public keys, cannot read it", () => {
  const sealed = sealPrivateScope(secret, coder.privateKey, alice.publicKey, pair, "notes");
  // the sibling agent has its own key: with the principal's public key it derives a different key, under its own pair or the real one
  assert.throws(() => openPrivateScope(sealed, other.privateKey, alice.publicKey, pair, "notes"));
  assert.throws(() => openPrivateScope(sealed, other.privateKey, alice.publicKey, { principal: PRINCIPAL, agent: SIBLING }, "notes"));
  // the host: a node key with either public key, and a public key where a private one belongs
  assert.throws(() => openPrivateScope(sealed, node.privateKey, alice.publicKey, pair, "notes"));
  assert.throws(() => openPrivateScope(sealed, node.privateKey, coder.publicKey, pair, "notes"));
  assert.throws(() => openPrivateScope(sealed, coder.publicKey, alice.publicKey, pair, "notes"));
});

test("the wrong pair, the wrong scope name and any change to the stored scope are refused", () => {
  const sealed = sealPrivateScope(secret, coder.privateKey, alice.publicKey, pair, "notes");
  assert.throws(() => openPrivateScope(sealed, coder.privateKey, alice.publicKey, { principal: "did:web:example.com:users:bob", agent: AGENT }, "notes"));
  assert.throws(() => openPrivateScope(sealed, coder.privateKey, alice.publicKey, pair, "diary"), /not that private scope/);
  assert.throws(() => openPrivateScope({ ...sealed, scope: "diary" }, coder.privateKey, alice.publicKey, pair, "diary"));
  const ct = Buffer.from(sealed.ct, "base64"); ct[0] ^= 1;
  assert.throws(() => openPrivateScope({ ...sealed, ct: ct.toString("base64") }, coder.privateKey, alice.publicKey, pair, "notes"), /cannot be opened/);
});

test("two seals of the same text differ (a fresh nonce each), and an empty scope and a binary one round-trip", () => {
  const a = sealPrivateScope(secret, coder.privateKey, alice.publicKey, pair, "notes"), b = sealPrivateScope(secret, coder.privateKey, alice.publicKey, pair, "notes");
  assert.notEqual(a.ct, b.ct);
  assert.equal(openPrivateScope(sealPrivateScope("", coder.privateKey, alice.publicKey, pair, "empty"), alice.privateKey, coder.publicKey, pair, "empty").length, 0);
  const bytes = Buffer.from([0, 255, 7, 128, 1]);
  assert.deepEqual(openPrivateScope(sealPrivateScope(bytes, coder.privateKey, alice.publicKey, pair, "bin"), coder.privateKey, alice.publicKey, pair, "bin"), bytes);
});
