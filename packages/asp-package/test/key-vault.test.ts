// DK1359: agent keys kept in an organisation's own vault through a program it runs (a stand-in vault here: a script that keeps seeds in a file it owns). No real vault was tried. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keystore } from "../src/home.ts";

function standIn() {
  const dir = mkdtempSync(join(tmpdir(), "asp-vault-"));
  const store = join(dir, "vault.json");
  const log = join(dir, "calls.log");
  const script = join(dir, "vault.mjs");
  writeFileSync(script, [
    'import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";',
    "const [op, arg] = process.argv.slice(2);",
    `appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");`,
    `const data = existsSync(${JSON.stringify(store)}) ? JSON.parse(readFileSync(${JSON.stringify(store)}, "utf8")) : {};`,
    'if (process.env.VAULT_DOWN) { console.error("vault is sealed"); process.exit(3); }',
    `if (op === "put") { let seed = ""; for await (const c of process.stdin) seed += c; data[arg] = seed.trim(); writeFileSync(${JSON.stringify(store)}, JSON.stringify(data)); }`,
    'else if (op === "get") { if (!data[arg]) process.exit(1); console.log(JSON.stringify({ seed_hex: data[arg] })); }',
    'else if (op === "list") { for (const k of Object.keys(data)) if (k.startsWith(arg + "#")) console.log(k); }',
    "else process.exit(2);",
  ].join("\n"));
  return { dir, store, log, cmd: `"${process.execPath}" "${script}"` };
}

test("with a vault named, a key is made and kept through it and no key file is written; the key is found again by its did, and the seed never appears on a command line", () => {
  const v = standIn();
  const home = mkdtempSync(join(tmpdir(), "asp-home-"));
  const ks = new Keystore(home, () => undefined, v.cmd);
  assert.equal(ks.usesVault, true);
  const did = "did:web:acme.example:agents:a1";
  const signer = ks.create(`${did}#key-1`);
  assert.equal(existsSync(join(home, "keys")) ? readdirSync(join(home, "keys")).length : 0, 0, "no key file on this machine");
  const kept = JSON.parse(readFileSync(v.store, "utf8"));
  assert.equal(kept[`${did}#key-1`], Buffer.from(signer.seed).toString("hex"), "the vault holds the seed");
  const again = new Keystore(home, () => undefined, v.cmd);                       // another process
  const found = again.forDid(did)!;
  assert.equal(found.kid, `${did}#key-1`);
  assert.deepEqual(Buffer.from(found.seed), Buffer.from(signer.seed));
  assert.deepEqual(Buffer.from(found.publicKey), Buffer.from(signer.publicKey), "the same key signs");
  assert.ok(!readFileSync(v.log, "utf8").includes(Buffer.from(signer.seed).toString("hex")), "the seed was given on standard input, not as an argument");
  assert.equal(new Keystore(home, () => undefined, v.cmd).forDid("did:web:acme.example:agents:nobody"), undefined);
});

test("a vault that refuses stops the creation with its reason; a vault that is down finds nothing and never falls back to a file; with no vault, keys are files as before", () => {
  const v = standIn();
  const home = mkdtempSync(join(tmpdir(), "asp-home-"));
  const ks = new Keystore(home, () => undefined, v.cmd);
  process.env.VAULT_DOWN = "1";
  try {
    assert.throws(() => ks.create("did:web:acme.example:agents:a2#key-1"), /the key vault refused to keep did:web:acme\.example:agents:a2#key-1: vault is sealed/);
    assert.equal(ks.find("did:web:acme.example:agents:a2#key-1"), undefined);
  } finally { delete process.env.VAULT_DOWN; }
  assert.equal(existsSync(join(home, "keys")), false, "nothing was written to disk as a fallback");
  const plain = new Keystore(home, () => undefined, "");
  assert.equal(plain.usesVault, false);
  plain.create("did:web:acme.example:agents:a3#key-1");
  assert.equal(readdirSync(join(home, "keys")).length, 1);
});
