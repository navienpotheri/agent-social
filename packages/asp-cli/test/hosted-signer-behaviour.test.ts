// CY8 (mutation check 2026-11-22): the breach-case review states what the service-held signer does; this test RUNS the signer so a change to the cipher, the passphrase rule or the forget rule fails it
// (hosted-key-texts.test.ts only reads the source). Fake keys and a fake passphrase only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostedSigner, HostedSignerError } from "../../asp-package/src/hosted-signer.ts";

const PASS = "a long enough fake passphrase";
const DID = "did:web:example.com:agents:hosted-1";

test("CY8: the store is encrypted at rest, opens only with its passphrase, refuses a short passphrase and a tampered file, signs only for what it made, and forgets on request", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-hosted-signer-"));
  const file = join(dir, "hosted.keys");
  assert.throws(() => new HostedSigner(file, "short"), HostedSignerError, "under 12 characters is refused");
  const s = new HostedSigner(file, PASS);
  const { kid, publicKey } = s.create(DID);
  assert.equal(kid, `${DID}#key-1`);
  const raw = readFileSync(file, "utf8");
  assert.equal(raw.includes(DID), false, "the DID and the seed are not in the file in the clear");
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["data", "iv", "salt", "tag", "v"], "a sealed store: salt, iv, tag and data");
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600, "mode 0600");
  const rec = s.sign(DID, { type: "passport", subject: DID, body: { did: DID }, prev: null, issued_at: "2026-11-22T00:00:00Z" });
  assert.equal(rec.issuer, DID);
  assert.ok(publicKey.length === 32);
  // reopening: the right passphrase finds the key, a wrong one does not open the file, a local agent's key is not here
  assert.equal(new HostedSigner(file, PASS).has(DID), true);
  assert.throws(() => new HostedSigner(file, "another long fake passphrase"), HostedSignerError, "the file does not open with another passphrase");
  assert.throws(() => s.signerFor("did:web:example.com:agents:local-agent"), HostedSignerError, "it signs only for a bot it made");
  // a changed byte of the ciphertext is refused (authenticated encryption)
  const sealed = JSON.parse(raw) as { data: string };
  const flipped = { ...sealed, data: (sealed.data[0] === "A" ? "B" : "A") + sealed.data.slice(1) };
  const tampered = join(dir, "tampered.keys");
  writeFileSync(tampered, JSON.stringify(flipped));
  assert.throws(() => new HostedSigner(tampered, PASS), HostedSignerError, "a tampered store is refused");
  // taking custody back: the seed is deleted, so the service cannot sign for the identity again, even after a restart
  assert.equal(s.forget(DID), true);
  assert.equal(new HostedSigner(file, PASS).has(DID), false);
  assert.equal(s.forget(DID), false);
  assert.throws(() => new HostedSigner(file, PASS).signerFor(DID), HostedSignerError);
});
