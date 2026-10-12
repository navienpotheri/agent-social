import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const HUMAN = "did:web:example.com:users:navien";
const AGENT = "did:web:example.com:agents:coder";

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function setup(f = makeFixture()) {
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", HUMAN])).code, 0);
  return f;
}

const fakeClaude = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)), ...extra,
});

test("pack --out *.aspkg.tgz produces one file, not a directory", async () => {
  const f = await setup();
  const pkg = join(f.root, "coder.aspkg.tgz");
  const res = await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /package\s+\S+coder\.aspkg\.tgz \(single file\)/);
  assert.ok(statSync(pkg).isFile());
});

test("verify accepts a single-file package and leaves it untouched", async () => {
  const f = await setup();
  const pkg = join(f.root, "coder.aspkg.tgz");
  await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const before = readFileSync(pkg);
  const res = await asp(f, ["verify", pkg]);
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /VERIFIED/);
  assert.deepEqual(readFileSync(pkg), before, "verify never rewrites the archive");
});

test("run --dry-run works against a single-file package without unpacking it visibly", async () => {
  const f = await setup();
  const pkg = join(f.root, "coder.aspkg.tgz");
  await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--dry-run"], fakeClaude());
  assert.equal(res.code, 0, res.err);
  assert.ok(statSync(pkg).isFile(), "still a single file, not left unpacked in place");
});

test("a real run against an archive re-packs it in place after write-back", async () => {
  const f = await setup();
  const pkg = join(f.root, "coder.aspkg.tgz");
  await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const before = readFileSync(pkg);

  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "go"], fakeClaude());
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /recorded memory updated/);
  assert.ok(statSync(pkg).isFile(), "the archive stays a single file");
  assert.notDeepEqual(readFileSync(pkg), before, "the archive was rewritten with the signed update");

  const verified = await asp(f, ["verify", pkg]);
  assert.equal(verified.code, 0, verified.out);
});

test("orchestrate against an archive re-packs it after consolidation, and never leaves the extracted copy behind", async () => {
  const f = await setup();
  const pkg = join(f.root, "coder.aspkg.tgz");
  await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--task", "one task"],
    { GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude-fleet.mjs", import.meta.url)) });
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /recorded consolidated fleet memory/);
  assert.ok(statSync(pkg).isFile());
  assert.equal((await asp(f, ["verify", pkg])).code, 0);
});

test("a failed run does not repack the archive at all", async () => {
  const f = await setup();
  const pkg = join(f.root, "coder.aspkg.tgz");
  await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const before = readFileSync(pkg);
  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "go"],
    fakeClaude({ FAKE_CLAUDE_EXIT: "1" }));
  assert.notEqual(res.code, 0);
  assert.deepEqual(readFileSync(pkg), before);
});

test("a directory package still works exactly as before (no archive involved)", async () => {
  const f = await setup();
  const pkg = join(f.root, "coder.aspkg");
  const res = await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(res.code, 0, res.err);
  assert.doesNotMatch(res.out, /single file/);
  assert.ok(statSync(pkg).isDirectory());
  assert.ok(existsSync(join(pkg, "manifest.json")));
});
