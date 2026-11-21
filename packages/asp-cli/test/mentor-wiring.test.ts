/**
 * `asp bank mentor` through the real command line (register row DK1220; spec-delta S1452): the options are read, the offer file is written and read back, and the log's rule for a mentor below tier 2 is passed on
 * with a non-zero exit and nothing appended. (The rules themselves, and the success path, are tested on a log with a tier-2 mentor in packages/asp-log/test/mentor-cmd.test.ts.) Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const SP1 = "did:web:example.com:users:mw-sponsor-1";
const SP2 = "did:web:example.com:users:mw-sponsor-2";
const PROTEGE = "did:web:example.com:agents:mw-protege";
const MENTOR = "did:web:example.com:agents:mw-mentor";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp bank mentor offer writes a file signed by the protege alone; accept by a mentor below tier 2 is refused by the log's rule and appends nothing; usage errors say what to type", async () => {
  const f = makeFixture();
  const ok = async (a: string[]) => { const r = await asp(f, a); assert.equal(r.code, 0, `${a.join(" ")}: ${r.err || r.out}`); return r; };
  for (const d of [SP1, SP2]) await ok(["identity", "new", "--kind", "human", "--did", d]);
  await ok(["identity", "new", "--kind", "agent", "--did", PROTEGE, "--sponsor", SP1, "--purpose", "A first job"]);
  await ok(["identity", "new", "--kind", "agent", "--did", MENTOR, "--sponsor", SP2, "--purpose", "A mentor"]);
  const file = join(f.root, "offer.json");
  const offer = await ok(["bank", "mentor", "offer", "--protege", PROTEGE, "--mentor", MENTOR, "--note", "teach me", "--out", file]);
  assert.match(offer.out, /not in the log/);
  assert.ok(existsSync(file));
  const rec = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(rec.issuer, PROTEGE); assert.equal(rec.body.mentor, MENTOR);
  const accept = await asp(f, ["bank", "mentor", "accept", "--file", file, "--mentor", MENTOR]);
  assert.notEqual(accept.code, 0);
  assert.match(accept.err + accept.out, /mentor_tier|tier 2 or above|tier 1/);
  const show = await ok(["bank", "mentor", "show", "--agent", PROTEGE]);
  assert.match(show.out, /no mentorship/);
  const bad = await asp(f, ["bank", "mentor", "offer", "--protege", PROTEGE]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /asp bank mentor offer --protege/);
  const wrong = await asp(f, ["bank", "mentor", "accept", "--file", file, "--mentor", SP2]);
  assert.notEqual(wrong.code, 0);
  assert.match(wrong.err, /not .*you do not countersign/);
});
