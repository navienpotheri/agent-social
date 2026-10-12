import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { didOf, randomSeed, signerFromSeed } from "@agent-social/asp-core";
import { appendCheckpoint, readCheckpoints, signCheckpoint, verifyCheckpointSignature } from "../src/checkpoint.ts";

const alice = signerFromSeed("did:web:example.com:users:alice#key-1", randomSeed());

test("signCheckpoint produces a signature verifyCheckpointSignature accepts", () => {
  const cp = signCheckpoint({ seq: 5, logHash: "sha256:" + "a".repeat(64) }, alice, new Date("2026-10-01T00:00:00Z"));
  assert.equal(cp.seq, 5);
  assert.equal(cp.signer, alice.kid);
  assert.equal(cp.signedAt, "2026-10-01T00:00:00Z");
  assert.equal(verifyCheckpointSignature(cp, alice.publicKey), true);
  assert.equal(verifyCheckpointSignature(cp, alice.publicKey, didOf(alice.kid)), true, "signer DID matches when checked");
});

test("verifyCheckpointSignature rejects a tampered checkpoint, the wrong key, or a mismatched issuer", () => {
  const cp = signCheckpoint({ seq: 5, logHash: "sha256:" + "a".repeat(64) }, alice);
  const other = signerFromSeed("did:web:example.com:users:mallory#key-1", randomSeed());
  assert.equal(verifyCheckpointSignature({ ...cp, seq: 6 }, alice.publicKey), false, "tampered seq");
  assert.equal(verifyCheckpointSignature({ ...cp, logHash: "sha256:" + "b".repeat(64) }, alice.publicKey), false, "tampered hash");
  assert.equal(verifyCheckpointSignature(cp, other.publicKey), false, "wrong key");
  assert.equal(verifyCheckpointSignature(cp, alice.publicKey, didOf(other.kid)), false, "signer DID mismatch");
});

test("appendCheckpoint/readCheckpoints round-trip through an ndjson file, in append order", () => {
  const file = join(mkdtempSync(join(tmpdir(), "asp-cp-")), "checkpoints.ndjson");
  assert.deepEqual(readCheckpoints(file), [], "no file yet");
  const a = signCheckpoint({ seq: 1, logHash: "sha256:" + "1".repeat(64) }, alice, new Date("2026-10-01T00:00:00Z"));
  const b = signCheckpoint({ seq: 2, logHash: "sha256:" + "2".repeat(64) }, alice, new Date("2026-10-02T00:00:00Z"));
  appendCheckpoint(file, a);
  appendCheckpoint(file, b);
  assert.deepEqual(readCheckpoints(file), [a, b]);
});
