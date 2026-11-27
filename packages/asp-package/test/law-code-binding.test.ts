// Row LW1 (mutation check, launch-bar-2, 2026-11-22): the operator's signature on the Code binds the version as well as the hash, and the heading and the pin must agree on whether the text is a draft or in force.
// The older tests changed the text and forged the signature, but a signature for one version accepted as another version's, and a draft heading over an in-force pin, went unnoticed. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { didKeyFromPublicKey, randomSeed, signerFromSeed } from "@agent-social/asp-core";
import { pinCode, readCode, signCode, verifyCode, type CodeInfo } from "../src/index.ts";

const operator = () => { const seed = randomSeed(); const pub = signerFromSeed("x", seed).publicKey; const did = didKeyFromPublicKey(pub); return signerFromSeed(`${did}#key-1`, seed); };

function signedPin(version: string) {
  const dir = mkdtempSync(join(tmpdir(), "code-bind-"));
  const code = join(dir, "code.md"), versions = join(dir, "versions.json");
  writeFileSync(code, `# The Code of the City: draft ${version}\n\n**Article 1. Only what you were given.** x\n`);
  const info = readCode({ code, versions });
  pinCode(info, versions);
  signCode(readCode({ code, versions }), operator(), versions);
  return { info: readCode({ code, versions }), versions };
}

test("a signature made for one version does not verify as the signature of another version with the same hash", () => {
  const a = signedPin("0.5");
  assert.deepEqual(verifyCode(a.info).problems, [], "the honest pin verifies");
  const stolen = a.info.pin!.signed!;
  const other: CodeInfo = { ...a.info, version: "9.9", pin: { version: "9.9", sha256: a.info.sha256, status: "draft", signed: stolen } };
  const v = verifyCode(other);
  assert.equal(v.signed, false);
  assert.match(v.problems.join(" "), /does not verify/);
});

test("a draft heading over an in-force pin, and the reverse, are problems", () => {
  const a = signedPin("0.5");
  const forced: CodeInfo = { ...a.info, pin: { ...a.info.pin!, status: "in_force" } };
  assert.match(verifyCode(forced).problems.join(" "), /the heading says draft and the pin says in_force/);
  const reverse: CodeInfo = { ...a.info, status: "in_force" };
  assert.match(verifyCode(reverse).problems.join(" "), /the heading says in_force and the pin says draft/);
  assert.equal(JSON.parse(readFileSync(a.versions, "utf8")).versions.length, 1);
});
