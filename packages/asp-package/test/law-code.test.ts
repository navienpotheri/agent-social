import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { didKeyFromPublicKey, randomSeed, signerFromSeed } from "@agent-social/asp-core";
import { CODE_FILE, CODE_MARKER, compactCode, pinCode, readCode, signCode, verifyCode } from "../src/index.ts";

// Gap LW1: the Code is a versioned, hashed, signable thing, and it cannot change without a new version.
const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), "code-"));
  const code = join(dir, "code.md"), versions = join(dir, "versions.json");
  copyFileSync(CODE_FILE, code);
  return { dir, code, versions, files: { code, versions } };
};
const operator = () => { const seed = randomSeed(); const pub = signerFromSeed("x", seed).publicKey; const did = didKeyFromPublicKey(pub); return signerFromSeed(`${did}#key-1`, seed); };

test("the repository's own Code is pinned: editing docs/law/code.md without raising the version and pinning it again fails here", () => {
  const info = readCode();
  assert.ok(info.pin, `version ${info.version} of the Code is not pinned: run asp law pin`);
  assert.deepEqual(verifyCode(info).problems, []);
});

test("a text with no pin, a changed text and a version in force that is edited are all caught", () => {
  const t = copy();
  const info = readCode(t.files);
  assert.match(verifyCode(info).problems[0], /has no pin/);
  pinCode(info, t.versions);
  assert.deepEqual(verifyCode(readCode(t.files)).problems, []);
  writeFileSync(t.code, readFileSync(t.code, "utf8").replace("Only what you were given.", "Only what you were handed."));
  assert.match(verifyCode(readCode(t.files)).problems[0], /has changed since it was pinned.*raise the version/);
  // A version in force is never re-pinned with other text.
  const inForce = copy();
  writeFileSync(inForce.code, readFileSync(inForce.code, "utf8").replace("draft 0.2", "version 1.0"));
  pinCode(readCode(inForce.files), inForce.versions);
  writeFileSync(inForce.code, readFileSync(inForce.code, "utf8") + "\nOne more line.\n");
  assert.throws(() => pinCode(readCode(inForce.files), inForce.versions), /in force and cannot be changed/);
});

test("the operator signs the pinned hash; the signature verifies, and fails for another text", () => {
  const t = copy();
  pinCode(readCode(t.files), t.versions);
  const op = operator();
  const sig = signCode(readCode(t.files), op, t.versions);
  assert.equal(sig.by, op.kid.split("#")[0]);
  const ok = verifyCode(readCode(t.files));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.signed, true);
  // Another text under the same pin: the hash no longer matches, so the signature is for something else.
  writeFileSync(t.code, readFileSync(t.code, "utf8") + "\nAn extra sentence.\n");
  const bad = verifyCode(readCode(t.files));
  assert.match(bad.problems.join(" "), /has changed since it was pinned/);
  // A forged signature does not verify.
  const forged = JSON.parse(readFileSync(t.versions, "utf8"));
  forged.versions[0].sha256 = readCode(t.files).sha256;
  forged.versions[0].signed.signature = forged.versions[0].signed.signature.slice(0, -4) + "AAAA";
  writeFileSync(t.versions, JSON.stringify(forged));
  assert.match(verifyCode(readCode(t.files)).problems.join(" "), /does not verify/);
});

test("signing needs the pin first", () => {
  const t = copy();
  assert.throws(() => signCode(readCode(t.files), operator(), t.versions), /pin this text first/);
});

test("the short form carries every article, the version and the start of the hash, and says to stop and ask", () => {
  const info = readCode();
  const c = compactCode(info);
  assert.ok(c.startsWith(CODE_MARKER));
  assert.match(c, new RegExp(`${info.version}, sha256 ${info.sha256.slice(0, 12)}`));
  for (let n = 1; n <= 12; n++) assert.match(c, new RegExp(`^${n}\. `, "m"), `article ${n}`);
  assert.match(c, /stop and ask your principal; never look for another way/);
  assert.ok(c.split(/\s+/).length < 600, `about ${c.split(/\s+/).length} words`);
});
