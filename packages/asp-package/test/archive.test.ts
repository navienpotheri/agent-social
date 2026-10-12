import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishPackage, packDirectory, resolvePackage } from "../src/archive.ts";

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "asp-archive-src-"));
  mkdirSync(join(dir, "harness", "skills", "x"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), '{"ok":true}\n');
  writeFileSync(join(dir, "harness", "skills", "x", "SKILL.md"), "hello\n");
  return dir;
}

test("packDirectory then resolvePackage round-trips every file and its content", async () => {
  const src = makeDir();
  const archive = join(tmpdir(), `asp-rt-${Date.now()}.tgz`);
  await packDirectory(src, archive);
  assert.ok(statSync(archive).isFile());

  const resolved = await resolvePackage(archive);
  assert.notEqual(resolved.dir, src);
  assert.equal(resolved.archivePath, archive);
  assert.equal(readFileSync(join(resolved.dir, "manifest.json"), "utf8"), '{"ok":true}\n');
  assert.equal(readFileSync(join(resolved.dir, "harness", "skills", "x", "SKILL.md"), "utf8"), "hello\n");
  await finishPackage(resolved, false);
});

test("resolvePackage on a directory returns it unchanged, with no archivePath", async () => {
  const src = makeDir();
  const resolved = await resolvePackage(src);
  assert.equal(resolved.dir, src);
  assert.equal(resolved.archivePath, undefined);
  await finishPackage(resolved, true); // a no-op for directories
  assert.ok(existsSync(src), "the original directory is never touched");
});

test("finishPackage(mutated=false) removes the temp copy without touching the archive", async () => {
  const src = makeDir();
  const archive = join(tmpdir(), `asp-rt-${Date.now()}-b.tgz`);
  await packDirectory(src, archive);
  const before = readFileSync(archive);

  const resolved = await resolvePackage(archive);
  writeFileSync(join(resolved.dir, "manifest.json"), '{"ok":false}\n'); // a change that should NOT be saved
  await finishPackage(resolved, false);

  assert.ok(!existsSync(resolved.dir), "the temp extraction is removed");
  assert.deepEqual(readFileSync(archive), before, "the archive is untouched");
});

test("finishPackage(mutated=true) rewrites the archive with the temp copy's current content", async () => {
  const src = makeDir();
  const archive = join(tmpdir(), `asp-rt-${Date.now()}-c.tgz`);
  await packDirectory(src, archive);

  const resolved = await resolvePackage(archive);
  writeFileSync(join(resolved.dir, "manifest.json"), '{"ok":"updated"}\n');
  await finishPackage(resolved, true);

  assert.ok(!existsSync(resolved.dir));
  const reread = await resolvePackage(archive);
  assert.equal(readFileSync(join(reread.dir, "manifest.json"), "utf8"), '{"ok":"updated"}\n');
  await finishPackage(reread, false);
});
