import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keystore, updatePackage, verifyPackage } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";

// UC-261, gap D10: what an agent learned, and Keep, Edit and Undo for its principal.
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function agentPackage() {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Learns"]);
  const pkg = join(f.root, "coder.aspkg");
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const signer = new Keystore(f.aspHome).forDid(CODER)!;
  /** What a run's write-back does: replaces the package's memory with the run's, recorded as a signed update. */
  const learn = (files: Record<string, string | null>, description: string) => {
    const dir = mkdtempSync(join(tmpdir(), "asp-learn-"));
    const current = join(pkg, "memory");
    for (const [p, text] of Object.entries(files)) if (text !== null) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), text); }
    // carry over what the package already holds and the run did not touch
    for (const p of existsSync(current) ? (readdirRec(current)) : []) if (!(p in files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), readFileSync(join(current, p))); }
    return updatePackage(pkg, { signer, memoryFrom: dir, changes: [{ layer: "memory", description }] }).edges[0].id;
  };
  return { f, pkg, learn };
}
function readdirRec(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); const rel = base ? `${base}/${n}` : n; return statSync(p).isDirectory() ? readdirRec(p, rel) : [rel]; });
}
const short = (id: string) => id.replace(/^sha256:/, "").slice(0, 8);

test("asp learned lists each memory change with what it added, changed and removed, shows the lines, and Keep notes a review without signing anything", async () => {
  const { f, pkg, learn } = await agentPackage();
  assert.match((await ok(f, ["learned", "--package", pkg])).out, /has not changed its memory yet/);

  const e1 = learn({ "feedback.md": "Run the tests before saying done.\n", "tone.md": "Short answers.\n" }, "memory updated during a run: +2");
  const e2 = learn({ "feedback.md": "Run the tests before saying done.\nNever push to main.\n", "tone.md": null }, "memory updated during a run: ~1 -1");

  const list = (await ok(f, ["learned", "--package", pkg])).out;
  assert.match(list, /What coder has learned: 2 memory changes, 2 not reviewed yet/);
  assert.match(list, new RegExp(`${short(e2)} .*not reviewed +memory updated during a run: ~1 -1`));
  assert.match(list, /1 changed, 1 removed: feedback\.md, tone\.md/);
  assert.match(list, new RegExp(`${short(e1)} `));
  assert.match(list, /2 added: feedback\.md, tone\.md/);
  assert.ok(list.indexOf(short(e2)) < list.indexOf(short(e1)), "newest first");

  const show = (await ok(f, ["learned", "show", short(e2), "--package", pkg])).out;
  assert.match(show, /feedback\.md {2}\(changed\)/);
  assert.match(show, /\+ Never push to main\./);
  assert.match(show, /tone\.md {2}\(removed\)/);
  assert.match(show, /- Short answers\./);
  assert.doesNotMatch(show, /\+ Run the tests/, "a line that did not change is not shown as new");

  const before = readFileSync(join(pkg, "records", "history.ndjson"), "utf8");
  assert.match((await ok(f, ["learned", "keep", short(e2), "--package", pkg])).out, /not a signed record/);
  assert.equal(readFileSync(join(pkg, "records", "history.ndjson"), "utf8"), before, "keeping adds no record");
  assert.match((await ok(f, ["learned", "--package", pkg])).out, new RegExp(`${short(e2)} .*kept `));
  assert.match((await ok(f, ["learned", "--package", pkg])).out, /1 not reviewed yet/);
  assert.equal(JSON.parse((await ok(f, ["learned", "--package", pkg, "--json"])).out).length, 2);
  assert.equal((await verifyPackage(pkg)).ok, true, "the package still verifies with the learned folder in it");

  assert.equal((await asp(f, ["learned", "show", "ffffffff", "--package", pkg])).code, 1);
  assert.equal((await asp(f, ["learned", "--package", join(f.root, "nowhere")])).code, 2);
});

test("asp learned undo puts the files back, as a new signed update that names the one it rolls back; it refuses when the files changed again, unless forced; and edit is a signed update too", async () => {
  const { f, pkg, learn } = await agentPackage();
  const e1 = learn({ "feedback.md": "Run the tests before saying done.\n" }, "first lesson");
  const e2 = learn({ "feedback.md": "Run the tests before saying done.\nAlways say what you skipped.\n", "habit.md": "Skip the lint step.\n" }, "second lesson (a bad one)");

  // Undo the second: feedback.md goes back to one line, habit.md is gone.
  const undone = await ok(f, ["learned", "undo", short(e2), "--package", pkg]);
  assert.match(undone.out, /took back .* 2 files put back as they were; recorded as a signed update that names the one it rolls back/);
  assert.equal(readFileSync(join(pkg, "memory", "feedback.md"), "utf8"), "Run the tests before saying done.\n");
  assert.equal(existsSync(join(pkg, "memory", "habit.md")), false);
  const history = readFileSync(join(pkg, "records", "history.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const revert = history.filter((r) => r.type === "asp.lineage/v0.2").at(-1);
  assert.equal(revert.body.change.reverts, e2, "the new edge names the one it rolls back");
  assert.equal(revert.body.edge, "update");
  assert.equal((await verifyPackage(pkg)).ok, true);
  const list = (await ok(f, ["learned", "--package", pkg])).out;
  assert.match(list, new RegExp(`${short(e2)} .*taken back`));
  assert.match(list, /took back "second lesson/);
  // It cannot be taken back twice.
  assert.match((await asp(f, ["learned", "undo", short(e2), "--package", pkg])).err, /already rolled back/);

  // A later change to the same file: undoing the earlier lesson would lose it, so it is refused, and --force does it.
  const e3 = learn({ "feedback.md": "Run the tests before saying done.\nAsk before deleting.\n" }, "third lesson");
  void e3;
  const refused = await asp(f, ["learned", "undo", short(e1), "--package", pkg]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /feedback\.md has been changed again since this change/);
  assert.equal(readFileSync(join(pkg, "memory", "feedback.md"), "utf8"), "Run the tests before saying done.\nAsk before deleting.\n", "refused: nothing changed");
  await ok(f, ["learned", "undo", short(e1), "--package", pkg, "--force"]);
  assert.equal(existsSync(join(pkg, "memory", "feedback.md")), false, "forced: the first lesson's file is gone, as the first change added it");

  // Edit: the principal's own text, recorded and itself takeable back.
  const text = join(f.root, "mine.md");
  writeFileSync(text, "Always ask before spending money.\n");
  const edited = await ok(f, ["learned", "edit", "rules.md", "--from", text, "--package", pkg]);
  assert.match(edited.out, /edited rules\.md: recorded as a signed update/);
  assert.equal(readFileSync(join(pkg, "memory", "rules.md"), "utf8"), "Always ask before spending money.\n");
  assert.match((await ok(f, ["learned", "--package", pkg])).out, /edited +edited rules\.md at the principal's request/);
  await ok(f, ["learned", "edit", "rules.md", "--text", "Ask first.\n", "--package", pkg]);
  assert.equal(readFileSync(join(pkg, "memory", "rules.md"), "utf8"), "Ask first.\n");
  assert.equal((await asp(f, ["learned", "edit", "../outside.md", "--text", "x", "--package", pkg])).code, 1, "a path out of the memory folder is refused");
  assert.equal(existsSync(join(f.root, "outside.md")), false);
  assert.equal((await verifyPackage(pkg)).ok, true);
});

test("a memory change made before asp learned existed is listed without detail: it can be kept, and cannot be taken back automatically", async () => {
  const { f, pkg, learn } = await agentPackage();
  const e1 = learn({ "old.md": "From before.\n" }, "an early lesson");
  // Remove the kept text, as if the change were made by an older version.
  rmSync(join(pkg, "learned"), { recursive: true, force: true });
  const list = (await ok(f, ["learned", "--package", pkg])).out;
  assert.match(list, /no detail kept \(made before asp learned\)/);
  assert.match((await ok(f, ["learned", "show", short(e1), "--package", pkg])).out, /no detail was kept for this change/);
  assert.match((await ok(f, ["learned", "keep", short(e1), "--package", pkg])).out, /kept/);
  const undo = await asp(f, ["learned", "undo", short(e1), "--package", pkg]);
  assert.equal(undo.code, 1);
  assert.match(undo.err, /made before asp learned existed/);
});
