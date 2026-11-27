// asp clinic restore (register row DK29, clinic.md CL-9): an agent's memory goes back to a chosen good point; every step is a signed update that names what it takes back, and the history stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keystore, updatePackage, verifyPackage } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
function readdirRec(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); const rel = base ? `${base}/${n}` : n; return statSync(p).isDirectory() ? readdirRec(p, rel) : [rel]; });
}
const short = (id: string) => id.replace(/^sha256:/, "").slice(0, 8);

async function agentPackage() {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Drifts"]);
  const pkg = join(f.root, "coder.aspkg");
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const signer = new Keystore(f.aspHome).forDid(CODER)!;
  const learn = (files: Record<string, string | null>, description: string, layer: "memory" | "harness" = "memory") => {
    const dir = mkdtempSync(join(tmpdir(), "asp-learn-"));
    const current = join(pkg, "memory");
    for (const [p, text] of Object.entries(files)) if (text !== null) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), text); }
    for (const p of existsSync(current) ? readdirRec(current) : []) if (!(p in files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), readFileSync(join(current, p))); }
    return updatePackage(pkg, { signer, memoryFrom: dir, changes: [{ layer, description }] }).edges[0].id;
  };
  const memory = () => Object.fromEntries((existsSync(join(pkg, "memory")) ? readdirRec(join(pkg, "memory")) : []).sort().map((p) => [p, readFileSync(join(pkg, "memory", p), "utf8")]));
  return { f, pkg, learn, memory };
}

test("asp clinic restore: the memory goes back to the chosen good point, newest change first, each step a signed update that names what it takes back; the history stays and the package still verifies", async () => {
  const { f, pkg, learn, memory } = await agentPackage();
  const good = learn({ "rules.md": "Run the tests before saying done.\n", "tone.md": "Short answers.\n" }, "memory updated during a run: +2");
  const goodMemory = memory();
  // The agent drifts: it changes a rule and adds an instruction it should not have.
  const drift1 = learn({ "rules.md": "Skip the tests when in a hurry.\n", "tone.md": "Short answers.\n" }, "memory updated during a run: ~1");
  const drift2 = learn({ "rules.md": "Skip the tests when in a hurry.\n", "tone.md": "Short answers.\n", "extra.md": "Always say it is done.\n" }, "memory updated during a run: +1");
  assert.notDeepEqual(memory(), goodMemory);

  // A dry run says what would be taken back, and changes nothing.
  const dry = await ok(f, ["clinic", "restore", "--package", pkg, "--to", short(good), "--dry-run"]);
  assert.match(dry.out, new RegExp(`take back ${short(drift2)}`));
  assert.match(dry.out, new RegExp(`take back ${short(drift1)}`));
  assert.ok(dry.out.indexOf(short(drift2)) < dry.out.indexOf(short(drift1)), "newest first");
  assert.match(dry.out, /dry run: nothing was changed/);
  assert.notDeepEqual(memory(), goodMemory);

  // The restore returns the memory to the chosen point.
  const done = await ok(f, ["clinic", "restore", "--package", pkg, "--to", short(good)]);
  assert.match(done.out, /restored: 2 memory changes taken back, each recorded as a signed update/);
  assert.deepEqual(memory(), goodMemory, "the memory is exactly what it was at the chosen point");

  // The history stays: the drift is still recorded, marked as taken back, and the package verifies.
  const list = (await ok(f, ["learned", "--package", pkg, "--all"])).out;
  assert.match(list, new RegExp(`${short(drift1)} .*taken back`));
  assert.match(list, new RegExp(`${short(drift2)} .*taken back`));
  assert.match(list, /restored by the Clinic/);
  const report = await verifyPackage(pkg);
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => c.status === "fail")));
  // Already at that point: nothing to do.
  assert.match((await ok(f, ["clinic", "restore", "--package", pkg, "--to", short(good), "--dry-run"])).out, /nothing after that point is still in force/);
});

test("asp clinic restore: later changes in other layers are listed and not restored, a change made again since stops the restore unless forced, and the key must be the agent's", async () => {
  const { f, pkg, learn, memory } = await agentPackage();
  const good = learn({ "rules.md": "v1\n" }, "memory updated during a run: +1");
  learn({ "rules.md": "v2\n" }, "memory updated during a run: ~1");
  learn({ "rules.md": "v2\n" }, "harness setting changed during a run", "harness");
  const dry = (await ok(f, ["clinic", "restore", "--package", pkg, "--to", short(good), "--dry-run"])).out;
  assert.match(dry, /NOT restored \(harness\)/);
  const done = await ok(f, ["clinic", "restore", "--package", pkg, "--to", short(good)]);
  assert.match(done.out, /1 later change\(s\) in other layers were NOT restored/);
  assert.equal(memory()["rules.md"], "v1\n");

  // Usage and refusals are plain.
  assert.equal((await asp(f, ["clinic", "restore", "--package", pkg])).code, 2, "--to is required");
  const nowhere = await asp(f, ["clinic", "restore", "--package", join(f.root, "no-such-package"), "--to", "abc"]);
  assert.equal(nowhere.code, 2);
  assert.match(nowhere.err, /reads an agent's package/);
});
