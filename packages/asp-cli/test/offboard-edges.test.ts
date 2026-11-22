// The offboarding export check's edges (register row DK1384; found loose by a mutation check): a manifest whose count is wrong and one whose root is wrong are each refused on their own (the older test altered both at once), and a
// badly damaged export reports at most ten records, not thousands. Real commands, fake keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ORG = "did:web:edge.example:org";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, text: out.join("\n") + err.join("\n") };
}
const ok = async (f: Fixture, a: string[]) => { const r = await asp(f, a); assert.equal(r.code, 0, `${a.join(" ")}: ${r.text}`); return r; };

async function exported() {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ORG, "--no-recovery"]);
  for (let i = 0; i < 10; i++) await ok(f, ["identity", "new", "--kind", "agent", "--did", `did:web:edge.example:agents:e${i}`, "--sponsor", ORG, "--purpose", "Work"]);
  const out = join(f.root, "export");
  await ok(f, ["offboard", "export", "--org", ORG, "--out", out]);
  return { f, out };
}

test("an export whose manifest count is wrong is refused, and so is one whose root is wrong, each on its own", async () => {
  const { f, out } = await exported();
  assert.equal((await asp(f, ["offboard", "verify", "--from", out])).code, 0, "untouched, it verifies");
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ ...manifest, records: manifest.records + 1 }));
  const count = await asp(f, ["offboard", "verify", "--from", out]);
  assert.notEqual(count.code, 0);
  assert.match(count.text, /the manifest says \d+ records, the file has \d+/);
  assert.doesNotMatch(count.text, /root of the record ids/, "the root was untouched");
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ ...manifest, root: "0".repeat(64) }));
  const root = await asp(f, ["offboard", "verify", "--from", out]);
  assert.notEqual(root.code, 0);
  assert.match(root.text, /root of the record ids is not the manifest's/);
  assert.doesNotMatch(root.text, /the manifest says/, "the count was untouched");
});

test("a damaged export names at most ten bad records", async () => {
  const { f, out } = await exported();
  const lines = readFileSync(join(out, "records.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const x of lines) if (x.record?.sig) x.record.sig = { ...x.record.sig, value: "AAAA" };
  writeFileSync(join(out, "records.ndjson"), lines.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const r = await asp(f, ["offboard", "verify", "--from", out]);
  assert.notEqual(r.code, 0);
  const named = (r.text.match(/record sha256:/g) ?? []).length;
  assert.ok(named >= 1 && named <= 10, `${named} records named`);
});
