import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

async function packed() {
  const f = makeFixture();
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", HUMAN])).code, 0);
  const pkg = join(f.root, "memory.aspkg");
  const res = await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(res.code, 0, res.err);
  return { f, pkg };
}
const fake = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)), ...extra,
});
const topicFiles = (pkg: string) => readdirSync(join(pkg, "memory", "auto")).filter((n) => n !== "MEMORY.md");

test("two runs of one agent: the second write-back merges onto the first instead of replacing it", async () => {
  const { f, pkg } = await packed();
  const autoDir = join(pkg, "memory", "auto");
  // This run learns "refund-race"; while it runs, another run writes back its own lesson into the package.
  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi"], fake({ FAKE_CLAUDE_OTHER_RUN: autoDir }));
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /another run changed this agent's memory while this one ran; the two were merged/);
  assert.match(res.err, /memory updated during a claude-code run: .*merged with another run/);
  const files = topicFiles(pkg);
  assert.ok(files.includes("refund-race.md"), "this run's lesson is kept");
  assert.ok(files.includes("from-the-other-run.md"), "and so is the other run's, which used to be overwritten");
  const index = readFileSync(join(autoDir, "MEMORY.md"), "utf8");
  assert.ok(index.includes("(refund-race.md)") && index.includes("(from-the-other-run.md)"));
  assert.equal((await asp(f, ["verify", pkg])).code, 0, "the merged package still verifies");
});

test("memory over budget is pruned, oldest first, and the lineage update says so", async () => {
  const { f, pkg } = await packed();
  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--memory-max-files", "4"], fake({ FAKE_CLAUDE_LEARN_FILES: "6" }));
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /memory over budget: pruned/);
  assert.match(res.err, /pruned \d+ over budget/);
  const files = topicFiles(pkg);
  assert.ok(files.length <= 4, `at most 4 topic files, got ${files.length}`);
  const index = readFileSync(join(pkg, "memory", "auto", "MEMORY.md"), "utf8");
  for (const m of index.matchAll(/\]\(([^)]+\.md)\)/g)) assert.ok(existsSync(join(pkg, "memory", "auto", m[1])) || existsSync(join(pkg, "memory", m[1])), `${m[1]} is in the index, so it must still exist`);
  assert.equal((await asp(f, ["verify", pkg])).code, 0);

  const bad = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--memory-max-files", "0"], fake());
  assert.equal(bad.code, 2);
});

test("a run within budget and alone writes back exactly as before", async () => {
  const { f, pkg } = await packed();
  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi"], fake());
  assert.equal(res.code, 0, res.err);
  assert.doesNotMatch(res.err, /merged|over budget/);
  assert.ok(topicFiles(pkg).includes("refund-race.md"));
});
