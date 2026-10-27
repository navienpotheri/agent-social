import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

// Gap LW1: asp law shows the Code with its version and hash and checks it against what was pinned.
test("asp law: show, the short form, verify, and sign needs a key", async () => {
  const f = makeFixture();
  mkdirSync(f.aspHome, { recursive: true });
  const run = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.aspHome } as Io;
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const show = await run(["law", "show"]);
  assert.equal(show.code, 0);
  assert.match(show.out, /^# The Code of the City: draft/);
  assert.match(show.out, /\*\*Article 8\. When blocked, stop and ask\./);
  assert.match(show.err, /draft 0\.2, sha256 [0-9a-f]{64}, not signed; a draft is not in force/);
  const compact = await run(["law", "show", "--compact"]);
  assert.match(compact.out, /^The Code of the City \(draft 0\.2, sha256 [0-9a-f]{12}\)/);
  assert.match(compact.out, /^8\. When blocked, stop and ask: /m);
  const verify = await run(["law", "verify"]);
  assert.equal(verify.code, 0, verify.err);
  assert.match(verify.out, /pinned: draft, hash matches/);
  assert.match(verify.out, /signed: no/);
  assert.match(verify.out, /a draft, so not in force/);
  const sign = await run(["law", "sign", "--by", "did:key:zNobody"]);
  assert.notEqual(sign.code, 0);
  assert.match(sign.err, /no key for did:key:zNobody here/);
  assert.notEqual((await run(["law", "frobnicate"])).code, 0);
});
