import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

// Gaps U5, P20: asp keys protect seals the key files and the saved login under ASP_KEY_PASSPHRASE; without it nothing changes.
test("asp keys: status, protect, a sealed key and login need the passphrase, unprotect", { timeout: 120_000 }, async () => {
  const f = makeFixture();
  mkdirSync(f.aspHome, { recursive: true });
  const run = async (args: string[], env: Record<string, string> = {}) => {
    const out: string[] = [], err: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.aspHome } as Io;
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const keyText = () => readdirSync(join(f.aspHome, "keys")).filter((n) => n.endsWith(".json")).map((n) => readFileSync(join(f.aspHome, "keys", n), "utf8")).join("\n");
  const login = () => JSON.parse(readFileSync(join(f.aspHome, "config.json"), "utf8"));

  { const r = await run(["identity", "new", "--kind", "human", "--method", "did:key", "--no-recovery"]); assert.equal(r.code, 0, r.err + r.out); }
  writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: "http://127.0.0.1:1", token: "tok-plain-123", tenant: "t", joinedAt: "2026-10-28T00:00:00Z" }));
  assert.match(keyText(), /seed_hex/);

  const st = await run(["keys", "status"]);
  assert.match(st.out, /keys: 0 protected, 1 plain \(readable by anything/);
  assert.match(st.out, /saved login: plain/);
  assert.match(st.out, /ASP_KEY_PASSPHRASE is not set/);

  // Protecting needs the passphrase, from the environment only.
  const bad = await run(["keys", "protect"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /set ASP_KEY_PASSPHRASE in your shell first/);

  const env = { ASP_KEY_PASSPHRASE: "correct horse battery" };
  const prot = await run(["keys", "protect"], env);
  assert.equal(prot.code, 0, prot.err);
  assert.match(prot.out, /protected 1 key file\(s\) and the saved login/);
  assert.doesNotMatch(keyText(), /seed_hex/);
  assert.equal(login().token, undefined, "the plain token is gone");
  assert.ok(login().token_sealed?.ct, "the sealed token is there");
  assert.equal(readFileSync(join(f.aspHome, "config.json"), "utf8").includes("tok-plain-123"), false);

  assert.match((await run(["keys", "status"], env)).out, /keys: 1 protected, 0 plain[\s\S]*saved login: protected[\s\S]*is set in this shell/);

  // A sealed key and login without the passphrase: a plain-words error, not garbage.
  const noPass = await run(["status"]);
  assert.notEqual(noPass.code, 0);
  assert.match(noPass.err, /your saved login it is protected with a passphrase: set ASP_KEY_PASSPHRASE/);
  const wrong = await run(["keys", "unprotect"], { ASP_KEY_PASSPHRASE: "wrong" });
  assert.notEqual(wrong.code, 0);
  assert.match(wrong.err, /wrong passphrase/);

  const un = await run(["keys", "unprotect"], env);
  assert.equal(un.code, 0, un.err);
  assert.match(un.out, /took the protection off 1 key file\(s\) and the saved login/);
  assert.match(keyText(), /seed_hex/);
  assert.equal(login().token, "tok-plain-123", "the login is back as it was");
  assert.equal(login().token_sealed, undefined);
});
