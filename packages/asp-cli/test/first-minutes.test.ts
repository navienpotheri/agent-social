// Row T1 (found by the clean-machine live check, scripts/live/01-clean-machine.mjs): the first things a stranger types work. `asp --version`, `asp -v` and `asp version` say which asp this is (`--version` is also a string
// option of `asp pack`, so it used to fail with "argument missing"), and `asp --help` is the reference, not the source file's first lines, whatever the line endings of the checkout. No model agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

async function asp(args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: mkdtempSync(join(tmpdir(), "asp-first-")) }, cwd: tmpdir() };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp --version, -v and version say the version and the node it runs on", async () => {
  for (const flag of ["--version", "-v", "version"]) {
    const r = await asp([flag]);
    assert.equal(r.code, 0, `${flag}: ${r.err}`);
    assert.match(r.out, /^asp \d+\.\d+\.\d+ \(node v\d+\.\d+\.\d+\)$/, flag);
  }
});

test("--version is still a value for the commands that take one (asp pack --version is not the version command)", async () => {
  const r = await asp(["pack", "--version"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /argument missing|--version/, "a missing value is still reported for a command that needs one");
});

test("asp --help prints the reference from its first line, with no shebang or comment opener, and asp help all is the same text", async () => {
  const h = await asp(["--help"]);
  assert.equal(h.code, 0);
  assert.ok(!h.out.includes("#!/usr/bin/env node"), "no shebang");
  assert.ok(!h.out.startsWith("/**"), "no comment opener");
  assert.match(h.out, /^asp: the Agent Social portability tool/);
  assert.ok(h.out.length > 5000);
  assert.equal((await asp(["help", "all"])).out, h.out);
});
