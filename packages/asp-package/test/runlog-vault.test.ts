import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDisclosures, discloseRunLog, openRunLog, sealRunLog, sealedShapeProblem } from "../src/runlog-vault.ts";
import { publicKeyFromSeed, randomSeed } from "@agent-social/asp-core";

const person = (did: string) => {
  const main = randomSeed(), recovery = randomSeed();
  return {
    did, main, recovery,
    keys: [{ did, kid: `${did}#key-1`, edPublic: publicKeyFromSeed(main) }, { did, kid: `${did}#recovery-1`, edPublic: publicKeyFromSeed(recovery) }],
  };
};
const LOG = Buffer.from('{"n":1,"kind":"run_start","data":{"contract":"c1"}}\n{"n":2,"kind":"tool_call","data":{"tool":"bash"}}\n');

test("a sealed run log opens for its owner's signing key and for their recovery key, and for no one else; any change is found", () => {
  const alice = person("did:web:x:u:alice"), mallory = person("did:web:x:u:mallory");
  const env = sealRunLog(LOG, { id: "c1.aa", contract: "c1", owner: alice.keys, createdAt: "2026-10-11T10:00:00Z" });
  assert.equal(env.recipients.length, 2);
  assert.ok(!JSON.stringify(env).includes("bash"), "no plaintext in the envelope");
  assert.deepEqual(openRunLog(env, alice.did, alice.main), LOG);
  assert.deepEqual(openRunLog(env, alice.did, alice.recovery), LOG, "the recovery key opens it too");
  assert.throws(() => openRunLog(env, alice.did, mallory.main), /cannot open/);
  assert.throws(() => openRunLog(env, mallory.did, mallory.main), /not sealed for/);
  // Changing the ciphertext, or the header the key was bound to, is found.
  const flipped = { ...env, ct: env.ct.slice(0, 10) + (env.ct[10] === "A" ? "B" : "A") + env.ct.slice(11) };
  assert.throws(() => openRunLog(flipped, alice.did, alice.main), /does not decrypt/);
  assert.throws(() => openRunLog({ ...env, contract: "c2" }, alice.did, alice.main), /cannot open|does not decrypt/);
  assert.throws(() => openRunLog({ ...env, run_log_sha256: "0".repeat(64) }, alice.did, alice.main), /does not decrypt/);
});

test("a disclosure wraps the key to the named jurors without re-encrypting, is signed by the owner, and a forged or foreign one is found", () => {
  const alice = person("did:web:x:u:alice"), juror = person("did:web:x:court:j1"), other = person("did:web:x:court:j2");
  const env = sealRunLog(LOG, { id: "c1.aa", contract: "c1", owner: alice.keys, createdAt: "2026-10-11T10:00:00Z" });
  assert.throws(() => openRunLog(env, juror.did, juror.main), /not sealed for/);
  assert.throws(() => discloseRunLog(env, { did: juror.did, seed: juror.main }, juror.keys, "me", "t"), /only the owner/);
  assert.throws(() => discloseRunLog(env, { did: alice.did, seed: alice.main }, juror.keys, " ", "t"), /say why/);
  const d = discloseRunLog(env, { did: alice.did, seed: alice.main }, juror.keys, "dispute over the refactor job", "2026-10-12T09:00:00Z");
  assert.equal(d.ct, env.ct, "the ciphertext is not re-encrypted");
  assert.equal(env.disclosures.length, 0, "the original is unchanged");
  assert.deepEqual(openRunLog(d, juror.did, juror.main), LOG);
  assert.throws(() => openRunLog(d, other.did, other.main), /not sealed for/);
  const ownerKeys = alice.keys.map((k) => k.edPublic);
  assert.deepEqual(checkDisclosures(d, ownerKeys), []);
  // A statement signed by someone else, or edited after signing, does not check out.
  assert.match(checkDisclosures(d, other.keys.map((k) => k.edPublic))[0], /not signed by the owner/);
  const edited = { ...d, disclosures: [{ ...d.disclosures[0], reason: "something else" }] };
  assert.match(checkDisclosures(edited, ownerKeys)[0], /not signed by the owner/);
  const elsewhere = { ...d, disclosures: [{ ...d.disclosures[0], run_log_sha256: "0".repeat(64) }] };
  assert.match(checkDisclosures(elsewhere, ownerKeys)[0], /different log/);
  // A recipient already present is not wrapped twice.
  const again = discloseRunLog(d, { did: alice.did, seed: alice.recovery }, juror.keys, "again", "2026-10-12T10:00:00Z");
  assert.equal(again.recipients.length, d.recipients.length);
  assert.equal(again.disclosures.length, 2);
});

test("the service's shape check keeps out anything that is not a sealed envelope for the run it is stored under", () => {
  const alice = person("did:web:x:u:alice");
  const env = sealRunLog(LOG, { id: "c1.aa", contract: "c1", owner: alice.keys, createdAt: "t" });
  assert.equal(sealedShapeProblem(env, "c1.aa"), undefined);
  assert.match(sealedShapeProblem(env, "c1.bb")!, /different run/);
  assert.match(sealedShapeProblem({ ...env, kind: "x" }, "c1.aa")!, /not a sealed/);
  assert.match(sealedShapeProblem({ ...env, recipients: [] }, "c1.aa")!, /no recipients/);
  assert.match(sealedShapeProblem({ ...env, ct: "" }, "c1.aa")!, /no ct/);
  assert.match(sealedShapeProblem("text", "c1.aa")!, /not a sealed/);
});
