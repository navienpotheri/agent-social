// Row DK1 (mutation check, launch-bar-2, 2026-11-22): the owner's signature on a policy is checked, not only the hash. A tampered signature, a statement that names another policy, a statement that names another
// signer's key and a missing statement are all refused. The older test changed the text of the policy only, so a verifier that skipped the signature check, or a signature that did not bind the policy
// name, went unnoticed. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { didKeyFromPublicKey, randomSeed, signerFromSeed } from "@agent-social/asp-core";
import { ratifyPolicy, verifyRatification } from "../src/policy-ratify.ts";

const signer = () => { const seed = randomSeed(); const pub = signerFromSeed("x", seed).publicKey; const did = didKeyFromPublicKey(pub); return signerFromSeed(`${did}#key-1`, seed); };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ratify-"));
  const file = join(dir, "policy.md");
  const out = join(dir, "policy.ratified.json");
  writeFileSync(file, "# A policy\n\nCredits are mock accounting entries.\n");
  return { dir, file, out };
}
const edit = (out: string, f: (r: Record<string, unknown>) => void) => { const r = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>; f(r); writeFileSync(out, JSON.stringify(r)); };

test("a signed policy verifies, and its statement is written with the signer's own did", () => {
  const s = setup();
  const k = signer();
  const r = ratifyPolicy({ policy: "monetary-policy", file: s.file, out: s.out, signer: k, now: "2026-11-22T00:00:00Z" });
  assert.equal(r.by, k.kid.split("#")[0]);
  const v = verifyRatification({ statement: s.out, file: s.file });
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);
});

test("a tampered signature is refused", () => {
  const s = setup();
  ratifyPolicy({ policy: "monetary-policy", file: s.file, out: s.out, signer: signer(), now: "2026-11-22T00:00:00Z" });
  edit(s.out, (r) => { r.signature = String(r.signature).slice(0, -4) + "AAAA"; });
  const v = verifyRatification({ statement: s.out, file: s.file });
  assert.equal(v.ok, false);
  assert.match(v.problems.join(" "), /does not verify/);
});

test("the signature binds the policy name: the same signature under another name is refused", () => {
  const s = setup();
  ratifyPolicy({ policy: "monetary-policy", file: s.file, out: s.out, signer: signer(), now: "2026-11-22T00:00:00Z" });
  edit(s.out, (r) => { r.policy = "legal-review-A1-A11"; });
  const v = verifyRatification({ statement: s.out, file: s.file });
  assert.equal(v.ok, false);
  assert.match(v.problems.join(" "), /does not verify/);
});

test("a statement that names another signer's key is refused, and a missing statement is not a pass", () => {
  const s = setup();
  ratifyPolicy({ policy: "monetary-policy", file: s.file, out: s.out, signer: signer(), now: "2026-11-22T00:00:00Z" });
  const other = signer();
  edit(s.out, (r) => { r.kid = other.kid; r.by = other.kid.split("#")[0]; });
  assert.equal(verifyRatification({ statement: s.out, file: s.file }).ok, false, "the signature is not by the key it names");
  const none = verifyRatification({ statement: join(s.dir, "absent.json"), file: s.file });
  assert.equal(none.ok, false);
  assert.match(none.problems.join(" "), /has not been signed/);
});

test("a Windows path is written with forward slashes in the statement", () => {
  const s = setup();
  const r = ratifyPolicy({ policy: "p", file: s.file, out: s.out, signer: signer(), now: "2026-11-22T00:00:00Z" });
  assert.ok(!r.file.includes("\\"), r.file);
});
