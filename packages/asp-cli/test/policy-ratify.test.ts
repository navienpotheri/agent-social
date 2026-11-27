// Row DK1: the owner signs the monetary policy. `asp credits ratify --by <did>` signs the hash of the policy text with the owner's own key and writes a statement next to it; without --by it checks
// the statement against the text, so a policy edited after it was signed is caught, and nobody else's key can sign for the owner. Fake keys only. Credits are mock accounting entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

test("the owner signs the monetary policy; the check passes until the text changes, and only the holder of the key can sign", async () => {
  const f = makeFixture();
  const asp = async (args: string[]) => { const out: string[] = []; const err: string[] = []; const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root }; return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") }; };
  const owner = "did:web:example.com:users:owner";
  const r0 = await asp(["identity", "new", "--kind", "human", "--did", owner]);
  assert.equal(r0.code, 0, r0.err);
  const policy = join(f.root, "credits.md");
  writeFileSync(policy, "# Monetary policy\n\nCredits are minted only by signed operator mints.\n");

  assert.equal((await asp(["credits", "ratify", "--file", policy])).code, 1, "not signed yet");
  const stranger = await asp(["credits", "ratify", "--by", "did:web:example.com:users:nobody", "--file", policy]);
  assert.notEqual(stranger.code, 0);
  assert.match(stranger.err, /no key for/);

  const signed = await asp(["credits", "ratify", "--by", owner, "--file", policy]);
  assert.equal(signed.code, 0, signed.err);
  assert.equal(existsSync(join(f.root, "credits.ratified.json")), true);
  const stmt = JSON.parse(readFileSync(join(f.root, "credits.ratified.json"), "utf8"));
  assert.equal(stmt.by, owner);
  assert.match(stmt.sha256, /^[0-9a-f]{64}$/);

  const check = await asp(["credits", "ratify", "--file", policy]);
  assert.equal(check.code, 0, check.err);
  assert.match(check.out, /signed by did:web:example\.com:users:owner and the text has not changed/);

  writeFileSync(policy, "# Monetary policy\n\nCredits are minted by anyone.\n");
  const changed = await asp(["credits", "ratify", "--file", policy]);
  assert.equal(changed.code, 1);
  assert.match(changed.err, /has changed since it was signed/);
});
