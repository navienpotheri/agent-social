// asp audit-export export|verify (DK1374, S1417) through the real commands: an organisation's records are written as JSON lines, a second run with the cursor file holds only what is new, and a changed file fails the check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ORG = "did:web:example.com:orgs:audit-cmd-co";

test("an export is written, checked, made incremental with a cursor file, and a tampered file fails", async () => {
  setClock(() => new Date("2026-11-21T10:00:00Z"));
  try {
    const f = makeFixture();
    assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ORG])).code, 0);
    const FLEET = `${ORG}:fleets:all`;
    assert.equal((await asp(f, ["fleet", "declare", "--org", ORG, "--name", "All", "--purpose", "everything"])).code, 0);
    const file = join(f.root, "audit1.jsonl"), cursor = join(f.root, "cursor.json");
    const e1 = await asp(f, ["audit-export", "export", "--org", ORG, "--out", file, "--since-file", cursor]);
    assert.equal(e1.code, 0, e1.err);
    assert.match(e1.out, /record\(s\) .* of did:web:example.com:orgs:audit-cmd-co written to/);
    const v = await asp(f, ["audit-export", "verify", file]);
    assert.equal(v.code, 0, v.err + v.out);
    assert.match(v.out, /the manifest and every signature that can be checked from the file check/);
    const first = readFileSync(file, "utf8").split("\n").filter(Boolean);
    assert.ok(first.length >= 3, "the passport and the fleet, at least");
    assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", "did:web:example.com:agents:audit-cmd-a", "--sponsor", ORG, "--fleet", FLEET])).code, 0);
    const file2 = join(f.root, "audit2.jsonl");
    const e2 = await asp(f, ["audit-export", "export", "--org", ORG, "--out", file2, "--since-file", cursor]);
    assert.match(e2.out, /since position \d+/);
    const second = readFileSync(file2, "utf8").split("\n").filter(Boolean);
    assert.equal(second.length - 1, 2, "the new agent passport and its signer's passport, which travels so the file checks");
    // tampering
    const tampered = join(f.root, "audit-bad.jsonl");
    const lines = [...first];
    const o = JSON.parse(lines[1]); o.record.body.purpose = "changed"; lines[1] = JSON.stringify(o);
    writeFileSync(tampered, lines.join("\n") + "\n");
    const bad = await asp(f, ["audit-export", "verify", tampered]);
    assert.equal(bad.code, 1);
    assert.match(bad.err + bad.out, /does not check/);
    assert.notEqual((await asp(f, ["audit-export", "export"])).code, 0, "a usage line");
    assert.notEqual((await asp(f, ["audit-export", "verify"])).code, 0);
  } finally { setClock(undefined); }
});
